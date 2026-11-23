// Transferencia real: los datos solo viajan en memoria y el fragmento jamás se guarda en el informe del ensayo.
import assert from 'node:assert/strict';

/**
 * Espera máxima de las cabeceras completas (allHeaders), con el informe ya restaurado y las peticiones terminadas.
 * WebKit no las entrega nunca para alguna navegación (la de /acceso-web tras la redirección del enlace, visto el
 * 02/11/2026); sin plazo, el ensayo esperaba indefinidamente.
 */
const PLAZO_CABECERAS_MS = 10_000;
const SIN_CABECERAS_COMPLETAS = Symbol('sin cabeceras completas');

function vigilarTransferencia(receptor, origen, codigo, tareas) {
  const fugas = [];
  const lecturasCabeceras = [];
  const terceros = [];
  receptor.on('request', (peticion) => {
    const destino = new URL(peticion.url());
    if (destino.origin !== origen.origin) {
      terceros.push('origen externo');
    }
    const lectura = peticion.allHeaders();
    // Se espera al final (comprobarCabeceras); un rechazo se ve allí y no queda como rechazo sin atender.
    lectura.catch(() => undefined);
    lecturasCabeceras.push({ peticion, lectura });
    const cuerpo = peticion.postData() ?? '';
    const ruta = peticion.url();
    if (
      ruta.includes(codigo) ||
      cuerpo.includes(codigo) ||
      cuerpo.includes(encodeURIComponent(codigo)) ||
      tareas.some((tarea) => cuerpo.includes(tarea) || cuerpo.includes(encodeURIComponent(tarea)))
    ) {
      fugas.push('fragmento en solicitud');
    }
  });
  return { fugas, terceros, lecturasCabeceras };
}

/**
 * El código del informe no puede ir en ninguna cabecera. Con las completas de cada petición o, solo en WebKit (el
 * motor que no las entrega para alguna navegación) y si no llegan en el plazo, con las que Playwright ya conoce de ella
 * (headers()). Las peticiones comprobadas así solo pueden ser navegaciones de documento (sus cabeceras las pone el
 * navegador, no el código de la página); se devuelven para el informe del ensayo. En Chromium y Firefox, cualquier
 * petición sin cabeceras completas hace fallar la prueba.
 */
async function comprobarCabeceras(lecturas, codigo, fugas, motor) {
  let plazo;
  const limite = new Promise((resolver) => {
    plazo = setTimeout(() => resolver(SIN_CABECERAS_COMPLETAS), PLAZO_CABECERAS_MS);
  });
  const provisionales = [];
  try {
    await Promise.all(
      lecturas.map(async ({ peticion, lectura }) => {
        let cabeceras = await Promise.race([lectura, limite]);
        if (cabeceras === SIN_CABECERAS_COMPLETAS) {
          cabeceras = peticion.headers();
          provisionales.push({ tipo: peticion.resourceType(), ruta: new URL(peticion.url()).pathname });
        }
        if (Object.values(cabeceras).some((valor) => valor.includes(codigo))) {
          fugas.push('fragmento en cabeceras');
        }
      }),
    );
  } finally {
    clearTimeout(plazo);
  }
  assert.deepEqual(
    provisionales.filter(({ tipo }) => motor !== 'webkit' || tipo !== 'document'),
    [],
    `En ${motor}, ninguna petición puede quedar sin cabeceras completas, salvo una navegación de documento en WebKit`,
  );
  return provisionales;
}

/** La página emisora ya muestra un informe real; el contexto receptor no tiene cookies ni datos previos. */
export async function probarQrIntegral({ emisora, receptor, origen, autenticar }) {
  const titulo = await emisora.locator('#informe [data-titulo-pdf]').innerText();
  const tareas = await emisora.locator('#informe .ib-tarea-nombre').allTextContents();
  assert.ok(tareas.length >= 2, 'El informe contiene las tareas oficiales elegidas');
  await emisora.locator('#pasar-al-final').click();
  const dialogo = emisora.locator('#dialogo-pasar');
  await dialogo.waitFor({ state: 'visible' });
  assert.ok((await dialogo.locator('#pasar-qr svg path').getAttribute('d'))?.length);
  const enlace = new URL(await dialogo.locator('#pasar-enlace').inputValue());
  assert.equal(enlace.origin, origen.origin);
  assert.equal(enlace.pathname, '/recorrido.html');
  assert.ok(enlace.hash.startsWith('#pasar='));
  const codigo = enlace.hash.slice('#pasar='.length);
  assert.ok(codigo.length > 0);
  const { fugas, terceros, lecturasCabeceras } = vigilarTransferencia(receptor, origen, codigo, tareas);
  await receptor.route('**/*', (ruta) =>
    new URL(ruta.request().url()).origin === origen.origin ? ruta.continue() : ruta.abort(),
  );
  const pagina = await receptor.newPage();
  try {
    await pagina.goto(enlace.href);
    await autenticar(pagina);
    await pagina.locator('#informe [data-titulo-pdf]').waitFor({ state: 'visible', timeout: 120_000 });
    assert.equal(await pagina.locator('#informe [data-titulo-pdf]').innerText(), titulo);
    const restauradas = await pagina.locator('#informe .ib-tarea-nombre').allTextContents();
    assert.ok(
      JSON.stringify(restauradas) === JSON.stringify(tareas),
      'Las tareas del informe se restauran sin alteración',
    );
    assert.equal(new URL(pagina.url()).hash, '', 'El fragmento se retira de la barra y el historial');
    const motor = receptor.browser()?.browserType().name();
    const cabecerasProvisionales = await comprobarCabeceras(lecturasCabeceras, codigo, fugas, motor);
    assert.deepEqual(fugas, [], 'El código del informe no viaja en las peticiones');
    assert.deepEqual(terceros, [], 'La transferencia no contacta terceros');
    const comprobado = { qrDibujado: true, informeRestaurado: true, fragmentoRetirado: true, fugas: 0, terceros: 0 };
    return { ...comprobado, cabecerasProvisionales };
  } finally {
    await pagina.close();
  }
}
