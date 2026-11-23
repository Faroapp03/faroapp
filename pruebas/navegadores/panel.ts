/** Sesión única y retirada/restauración pública, a través del formulario y HTTP reales. */
import assert from 'node:assert/strict';
import type { BrowserContext, Dialog, Page, Request, Route } from 'playwright-core';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { huella } from './artefacto.ts';
import { type FixtureDelPanel, RUTA_SONDEO_CONTROLES } from './fixture-panel.ts';

/** Lo que ofrece la bienvenida: abrir la sesión con el panel libre o retomar la propia abierta en otra pestaña. */
type Entrada = 'abrir' | 'retomar';
const BOTON_DE_ENTRADA: Record<Entrada, { clase: string; texto: string }> = {
  abrir: { clase: '.sesion-unica-abrir', texto: 'Abrir sesión única' },
  retomar: { clase: '.sesion-unica-retomar', texto: 'Cerrar aquella y abrirla aquí' },
};

/**
 * Entra como lo hace una persona tras Access: la bienvenida ofrece un único botón, que abre (o retoma) la sesión
 * única; solo entonces aparece el panel con sus controles.
 */
async function abrir(contexto: BrowserContext, origen: string, entrada: Entrada = 'abrir'): Promise<Page> {
  const pagina = await contexto.newPage();
  assert.equal((await pagina.goto(`${origen}/administracion`))?.status(), ESTADO_HTTP.correcto);
  const bienvenida = pagina.locator('#bienvenida-panel');
  const { clase, texto } = BOTON_DE_ENTRADA[entrada];
  await bienvenida.locator(clase).waitFor();
  assert.equal(await bienvenida.locator('button[data-accion]').count(), 1, 'La bienvenida ofrece un solo camino');
  assert.equal(await bienvenida.locator(clase).textContent(), texto);
  assert(await pagina.locator('#armazon-panel').isHidden(), 'Sin sesión única, el panel no muestra sus controles');
  await bienvenida.locator(clase).click();
  await pagina.locator('#armazon-panel').waitFor({ state: 'visible' });
  assert(await bienvenida.isHidden(), 'Con la sesión abierta, la bienvenida se retira');
  await pagina.waitForFunction(() => document.querySelector<HTMLFieldSetElement>('#campos')?.disabled === false);
  return pagina;
}

type Activacion = 'raton' | 'Space' | 'Enter';
const SONDEO_PANEL_MS = 5000;
const COMPROBAR_DOM_MS = 100;
// Margen real para comprobar que un rechazo no deja salir ninguna escritura.
const ESPERA_SIN_ESCRITURA_MS = 500;

/** Un gesto nativo atraviesa el turno del sondeo: no se reintenta ni se acepta perder la pulsación. */
async function pulsarConSondeo(pagina: Page, selector: string, control: string, activacion: Activacion): Promise<void> {
  const liberar = Promise.withResolvers<void>();
  let retener = false;
  const lectura = async (ruta: Route) => {
    if (retener) {
      await liberar.promise;
    }
    await ruta.continue();
  };
  await pagina.route(`**${RUTA_SONDEO_CONTROLES}`, lectura);
  try {
    const objetivo = pagina.locator(selector);
    // Al abrir, el panel lee también datos, trabajo y publicación; mientras tanto sus controles esperan deshabilitados.
    await pagina.locator(`${control}:enabled`).waitFor();
    assert(await pagina.locator(control).isEnabled(), 'El gesto debe empezar con el control habilitado');
    if (activacion === 'raton') {
      await objetivo.scrollIntoViewIfNeeded();
      const caja = await objetivo.boundingBox();
      assert(caja);
      await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
      await pagina.mouse.down();
    } else {
      await objetivo.focus();
      await pagina.keyboard.down(activacion);
    }
    retener = true;
    await pagina.clock.fastForward(SONDEO_PANEL_MS);
    if (activacion !== 'Enter') {
      assert(await pagina.locator(control).isEnabled(), 'El sondeo no debe anular el gesto iniciado');
    }
    if (activacion === 'raton') {
      await pagina.mouse.up();
    } else {
      await pagina.keyboard.up(activacion);
    }
  } finally {
    liberar.resolve();
    await pagina.unrouteAll({ behavior: 'wait' });
  }
}

/** Guardar pide confirmación con un resumen del cambio: la prueba lo acepta y devuelve su texto para comprobarlo. */
async function solicitarConSondeo(
  pagina: Page,
  operacion: 'leer' | 'cambiar',
  activacion: Activacion,
): Promise<string[]> {
  const ruta = `/administracion/api/secciones/${operacion}`;
  const dialogos: string[] = [];
  const aceptar = (dialogo: Dialog) => {
    dialogos.push(dialogo.message());
    void dialogo.accept();
  };
  pagina.on('dialog', aceptar);
  const control = operacion === 'leer' ? '#consultar-secciones' : '#guardar-secciones';
  const pedidos: string[] = [];
  const anotar = (peticion: Request) => {
    if (peticion.url().endsWith(ruta)) {
      pedidos.push(peticion.method());
    }
  };
  pagina.on('request', anotar);
  const respuesta = pagina.waitForResponse((r) => r.url().endsWith(ruta));
  // Si falla la guardia del gesto, cerrar el contexto cancela esta espera; la aserción original conserva el fallo.
  void respuesta.catch(() => {});
  try {
    await pulsarConSondeo(pagina, `${control}:enabled`, control, activacion);
    assert.equal((await respuesta).status(), ESTADO_HTTP.correcto);
    assert.deepEqual(pedidos, ['POST'], 'Un gesto debe producir una sola consulta o escritura, sin reintentos');
  } finally {
    pagina.off('request', anotar);
    pagina.off('dialog', aceptar);
  }
  return dialogos;
}

/**
 * El panel muestra un apartado cada vez: se llega a Secciones como una persona, desplegando el grupo «Web» de la
 * navegación lateral si está plegado y pulsando su enlace.
 */
async function irASecciones(pagina: Page): Promise<void> {
  if (await pagina.locator('#apartado-secciones').isVisible()) {
    return;
  }
  const enlace = pagina.locator('#navegacion-panel a[data-ir="secciones"]');
  if (!(await enlace.isVisible())) {
    await pagina.locator('#navegacion-panel button[data-grupo="web"]').click();
  }
  await enlace.click();
  await pagina.locator('#consultar-secciones').waitFor({ state: 'visible' });
}

async function biblioteca(pagina: Page, abierta: boolean, activacion: Activacion = 'raton'): Promise<void> {
  await irASecciones(pagina);
  const dialogosLectura = await solicitarConSondeo(pagina, 'leer', activacion);
  assert.deepEqual(dialogosLectura, [], 'Consultar las secciones no abre ningún diálogo');
  await pagina.waitForFunction(
    () => document.querySelector<HTMLFieldSetElement>('#campos-secciones')?.disabled === false,
  );
  if ((await pagina.locator('#seccion-biblioteca').isChecked()) !== abierta) {
    await pulsarConSondeo(pagina, 'label[for="seccion-biblioteca"] span', '#seccion-biblioteca', 'raton');
  }
  assert.equal(await pagina.locator('#seccion-biblioteca').isChecked(), abierta, 'La etiqueta conserva su activación');
  const dialogos = await solicitarConSondeo(pagina, 'cambiar', activacion);
  assert.equal(dialogos.length, 1, 'Guardar pide una sola confirmación');
  assert.match(
    dialogos[0] ?? '',
    abierta
      ? /Abrir «Biblioteca»: las personas volverán a ver esta página y sus enlaces\./u
      : /Cerrar «Biblioteca»: las personas dejarán de ver esta página y sus enlaces\./u,
  );
  assert.match(dialogos[0] ?? '', /sin conexión verá el cambio cuando vuelva a conectarse/u);
  await pagina.waitForFunction(
    () => document.querySelector('#estado-secciones')?.textContent?.includes('Secciones guardadas') === true,
  );
}

/** Si la persona rechaza el resumen, no sale ninguna escritura y el interruptor vuelve a lo confirmado. */
async function rechazarCambio(pagina: Page): Promise<void> {
  await irASecciones(pagina);
  const confirmada = await pagina.locator('#seccion-biblioteca').isChecked();
  await pagina.locator('label[for="seccion-biblioteca"] span').click();
  assert.equal(await pagina.locator('#seccion-biblioteca').isChecked(), !confirmada);
  const dialogos: string[] = [];
  const rechazar = (dialogo: Dialog) => {
    dialogos.push(dialogo.message());
    void dialogo.dismiss();
  };
  const escrituras: string[] = [];
  const anotar = (peticion: Request) => {
    if (peticion.url().endsWith('/administracion/api/secciones/cambiar')) {
      escrituras.push(peticion.method());
    }
  };
  pagina.on('dialog', rechazar);
  pagina.on('request', anotar);
  try {
    await pagina.locator('#guardar-secciones:enabled').click();
    await pagina.waitForTimeout(ESPERA_SIN_ESCRITURA_MS);
  } finally {
    pagina.off('dialog', rechazar);
    pagina.off('request', anotar);
  }
  assert.equal(dialogos.length, 1);
  assert.match(
    dialogos[0] ?? '',
    confirmada
      ? /^Vas a guardar estos cambios:\n• Cerrar «Biblioteca»/u
      : /^Vas a guardar estos cambios:\n• Abrir «Biblioteca»/u,
  );
  assert.deepEqual(escrituras, [], 'Rechazar la confirmación no envía ningún cambio');
  assert.equal(
    await pagina.locator('#seccion-biblioteca').isChecked(),
    confirmada,
    'El interruptor vuelve a su estado',
  );
}

/** Cerrar Biblioteca y deshacerlo: una sola confirmación que la vuelve a abrir, y la oferta desaparece. */
async function deshacerCierre(pagina: Page): Promise<void> {
  await biblioteca(pagina, false);
  const dialogos: string[] = [];
  const aceptar = (dialogo: Dialog) => {
    dialogos.push(dialogo.message());
    void dialogo.accept();
  };
  pagina.on('dialog', aceptar);
  const respuesta = pagina.waitForResponse((r) => r.url().endsWith('/administracion/api/secciones/cambiar'));
  void respuesta.catch(() => {});
  try {
    await pagina.locator('#deshacer:visible').click();
    assert.equal((await respuesta).status(), ESTADO_HTTP.correcto);
  } finally {
    pagina.off('dialog', aceptar);
  }
  assert.equal(dialogos.length, 1, 'Deshacer pide una sola confirmación');
  assert.match(dialogos[0] ?? '', /^Vas a guardar estos cambios:\n• Abrir «Biblioteca»/u);
  await pagina.waitForFunction(() => document.querySelector<HTMLInputElement>('#seccion-biblioteca')?.checked === true);
  assert(await pagina.locator('#deshacer').isHidden(), 'Deshacer se ofrece una sola vez');
}

async function rutas(fixture: FixtureDelPanel) {
  const respuestas: { ruta: string; status: number; sha256: string }[] = [];
  for (const ruta of ['/biblioteca.html', '/%62iblioteca.html', '//biblioteca.html', '/x/%2f../biblioteca.html']) {
    const respuesta = await fetch(`${fixture.origen}${ruta}`, {
      headers: { ...IDENTIDAD_WEB },
      redirect: 'manual',
    });
    respuestas.push({ ruta, status: respuesta.status, sha256: huella(new Uint8Array(await respuesta.arrayBuffer())) });
  }
  return respuestas;
}

async function sustituirSesion(contexto: BrowserContext, fixture: FixtureDelPanel, primera: Page): Promise<Page> {
  const anteriores = fixture.conflictosDelSondeo.length;
  const respuesta = primera.waitForResponse(
    (r) => r.url() === fixture.origen + RUTA_SONDEO_CONTROLES && r.status() === ESTADO_HTTP.conflicto,
  );
  void respuesta.catch(() => {});
  // La misma persona en otra pestaña: su sesión sigue abierta en la primera, así que la bienvenida ofrece retomarla.
  const segunda = await abrir(contexto, fixture.origen, 'retomar');
  await primera.bringToFront();
  await contexto.clock.fastForward(SONDEO_PANEL_MS);
  await respuesta;
  const conflictos = fixture.conflictosDelSondeo.slice(anteriores);
  assert.ok(conflictos.length, 'El servidor recibió el sondeo de la sesión sustituida');
  for (const cuerpo of conflictos) {
    assert.deepEqual(JSON.parse(cuerpo), { error: 'sesion_sustituida' });
  }
  // La pestaña sustituida vuelve a la bienvenida, que dice qué ha pasado, y retira los controles del panel.
  await primera.waitForFunction(
    () =>
      document
        .querySelector('#bienvenida-panel')
        ?.textContent?.includes('Has abierto el Panel de Control en otro dispositivo, así que aquí se ha cerrado.') ===
      true,
    undefined,
    { polling: COMPROBAR_DOM_MS },
  );
  assert(await primera.locator('#armazon-panel').isHidden(), 'La sesión expulsada debe retirar controles');
  await segunda.bringToFront();
  return segunda;
}

export async function probarPanel(contexto: BrowserContext, fixture: FixtureDelPanel): Promise<void> {
  // Los temporizadores del panel solo avanzan en los turnos explícitos; las esperas de Playwright siguen siendo reales.
  assert.equal(contexto.pages().length, 0, 'El reloj se controla antes de crear páginas');
  const inicio = Date.now();
  await contexto.clock.install({ time: inicio });
  await contexto.clock.pauseAt(inicio);
  const noAutorizada = await fetch(`${fixture.origen}/administracion`, { headers: { ...IDENTIDAD_WEB } });
  assert.equal(noAutorizada.status, ESTADO_HTTP.prohibido);
  await noAutorizada.arrayBuffer();
  const jwtInvalido = await fetch(`${fixture.origen}/administracion`, {
    headers: { ...IDENTIDAD_WEB, 'cf-access-jwt-assertion': 'no-es-un-jwt' },
  });
  assert.equal(jwtInvalido.status, ESTADO_HTTP.prohibido);
  await jwtInvalido.arrayBuffer();
  const iniciales = await rutas(fixture);
  assert.equal(iniciales[0]?.status, ESTADO_HTTP.correcto, 'Biblioteca canónica disponible antes del cierre');
  const primera = await abrir(contexto, fixture.origen);
  await biblioteca(primera, false);
  await rechazarCambio(primera);
  for (const respuesta of await rutas(fixture)) {
    assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado, respuesta.ruta);
  }
  await biblioteca(primera, true, 'Space');
  await biblioteca(primera, false, 'Enter');
  const segunda = await sustituirSesion(contexto, fixture, primera);
  await biblioteca(segunda, true);
  assert.deepEqual(await rutas(fixture), iniciales, 'Restauración exacta de estado y bytes de cada variante');
  await deshacerCierre(segunda);
  assert.deepEqual(await rutas(fixture), iniciales, 'Deshacer el cierre restaura el estado y los bytes');
  await primera.close();
  await segunda.close();
}
