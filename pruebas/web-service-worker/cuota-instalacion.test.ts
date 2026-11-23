import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASES, servicio } from './ayudas.ts';

const ARCHIVOS = ['inicio.html', 'sin-conexion.html', 'estilos/base.css'];

/**
 * Un disco que se llena al pasar los recursos a la copia definitiva: la descarga a la provisional ya ha terminado y la
 * definitiva ya tiene inicio.html cuando sin-conexion.html se rechaza con QuotaExceededError. Así el fallo cae a mitad
 * de la copia definitiva, no en la primera escritura ni en la descarga.
 */
function llenarElDiscoEnLaDefinitiva(sw: ReturnType<typeof servicio>) {
  const inicioEscrito = Promise.withResolvers<void>();
  const observado = { escritas: [] as string[], rechazos: 0, provisionalAlFallar: 0 };
  sw.copias.antesDeGuardar = async (nombre, clave) => {
    if (nombre !== sw.nombreCopia || clave !== sw.urlDe('sin-conexion.html')) {
      return;
    }
    await inicioEscrito.promise;
    observado.provisionalAlFallar = sw.guardadas.get(`${sw.nombreCopia}:provisional`)?.size ?? 0;
    observado.rechazos++;
    throw new DOMException('cuota de ensayo', 'QuotaExceededError');
  };
  sw.copias.despuesDeGuardar = (nombre, clave) => {
    if (nombre === sw.nombreCopia && clave === sw.urlDe('inicio.html')) {
      observado.escritas.push(clave);
      inicioEscrito.resolve();
    }
  };
  return observado;
}

for (const base of BASES) {
  test(`un fallo de cuota en la copia definitiva rechaza install y permite un reintento completo: ${base}`, async () => {
    const sw = servicio(base, { archivos: ARCHIVOS });
    sw.conectar();
    const anterior = `faro:${base}:anterior`;
    const contenidoAnterior = new Map([[sw.urlDe('inicio.html'), new Response('anterior')]]);
    sw.guardadas.set(anterior, contenidoAnterior);
    const observado = llenarElDiscoEnLaDefinitiva(sw);
    await assert.rejects(
      sw.instalar(),
      (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError',
    );
    assert.deepEqual(observado, {
      escritas: [sw.urlDe('inicio.html')],
      rechazos: 1,
      provisionalAlFallar: ARCHIVOS.length,
    });
    // La versión que falla no se activa ni reclama pestañas, y la copia del trabajador anterior sigue intacta.
    assert.equal(sw.guardadas.has(`${sw.nombreCopia}:provisional`), false);
    assert.equal(sw.guardadas.get(anterior), contenidoAnterior);
    // La copia definitiva que creó este intento no queda a medias: el siguiente empieza de cero.
    assert.equal(sw.guardadas.has(sw.nombreCopia), false);
    assert.deepEqual([sw.saltos, sw.reclamaciones], [0, 0]);
    // Con espacio otra vez, un nuevo intento guarda todos los recursos y solo reclama las pestañas al activarse.
    delete sw.copias.antesDeGuardar;
    delete sw.copias.despuesDeGuardar;
    await sw.instalar();
    const definitiva = sw.guardadas.get(sw.nombreCopia);
    assert.ok(definitiva);
    assert.deepEqual([...definitiva.keys()].sort(), ARCHIVOS.map(sw.urlDe).sort());
    assert.deepEqual([sw.saltos, sw.reclamaciones], [0, 0]);
    await sw.activar();
    assert.deepEqual([sw.saltos, sw.reclamaciones], [0, 1]);
  });
}

/** Lo que se escribe en la copia definitiva durante una instalación, en orden. */
function escriturasEnLaDefinitiva(sw: ReturnType<typeof servicio>) {
  const escritas: string[] = [];
  sw.copias.despuesDeGuardar = (nombre, clave) => {
    if (nombre === sw.nombreCopia) {
      escritas.push(clave);
    }
  };
  return escritas;
}

/** Una imagen y una tipografía: el service worker las guarda en la pasada de lo complementario. */
const COMPLEMENTARIOS = ['imagenes/foto.webp', 'tipografias/letra.woff2'];
const CON_COMPLEMENTARIOS = [...ARCHIVOS, ...COMPLEMENTARIOS];
const TIPOS: Record<string, string> = { html: 'text/html', css: 'text/css', webp: 'image/webp', woff2: 'font/woff2' };

/** Lo que entrega a cada ruta la red de redConContenidoNuevo, de lo que salen sus huellas (ayudas.ts, cuerpoDe). */
const conLaRedNueva = (base: string) => ({ cuerpoDe: (ruta: string) => `red ${new URL(ruta, base).href}` });

/** La red contesta a cada archivo con bytes distintos de los de la copia activa, con su tipo de contenido. */
function redConContenidoNuevo(sw: ReturnType<typeof servicio>, falla?: string) {
  sw.red.respuesta = (url) => {
    if (url === falla) {
      return new Response('no disponible', { status: 503 });
    }
    return new Response(`red ${url}`, { headers: { 'content-type': TIPOS[url.split('.').at(-1) ?? ''] ?? '' } });
  };
}

/** La copia de la versión activa con `rutas`, y el objeto y los bytes de cada una de sus entradas. */
function copiaActiva(sw: ReturnType<typeof servicio>, rutas: string[]) {
  const entradas = new Map(
    rutas.map((ruta) => [sw.urlDe(ruta), { respuesta: new Response(`activa ${ruta}`), bytes: `activa ${ruta}` }]),
  );
  const activa = new Map([...entradas].map(([clave, { respuesta }]) => [clave, respuesta]));
  sw.guardadas.set(sw.nombreCopia, activa);
  return { activa, entradas };
}

/** Cada entrada de la copia activa sigue siendo el mismo objeto, con los mismos bytes. */
async function conservadas(
  activa: Map<string, Response>,
  entradas: Map<string, { respuesta: Response; bytes: string }>,
) {
  for (const [clave, { respuesta, bytes }] of entradas) {
    assert.equal(await activa.get(clave)?.clone().text(), bytes, clave);
    assert.equal(activa.get(clave), respuesta, clave);
  }
}

// Un cambio solo del código del service worker conserva VERSION y, con ella, el nombre de la copia de la versión
// activa. Esa copia no es de este intento: nunca se reescribe ni se borra; solo se le añade lo que le falte, también
// en la pasada de lo complementario.
for (const base of BASES) {
  test(`el service worker guarda las imágenes y tipografías en la pasada de lo complementario: ${base}`, () => {
    const sw = servicio(base, { archivos: CON_COMPLEMENTARIOS });
    assert.deepEqual(
      { imprescindibles: [...sw.evaluar('IMPRESCINDIBLES')], complementarios: [...sw.evaluar('COMPLEMENTARIOS')] },
      { imprescindibles: ARCHIVOS, complementarios: COMPLEMENTARIOS },
    );
  });

  test(`con la copia de la versión activa completa, la instalación no reescribe ninguna entrada: ${base}`, async () => {
    const sw = servicio(base, { archivos: CON_COMPLEMENTARIOS, ...conLaRedNueva(base) });
    sw.conectar();
    redConContenidoNuevo(sw);
    const { activa, entradas } = copiaActiva(sw, CON_COMPLEMENTARIOS);
    const escritas = escriturasEnLaDefinitiva(sw);
    await sw.instalar();
    await conservadas(activa, entradas);
    assert.deepEqual(escritas, []);
    assert.equal(sw.guardadas.get(sw.nombreCopia), activa);
    assert.deepEqual([...activa.keys()].sort(), CON_COMPLEMENTARIOS.map(sw.urlDe).sort());
    // Lo complementario que la copia ya tiene ni siquiera se pide a la red.
    assert.deepEqual(
      sw.peticiones.filter((url) => COMPLEMENTARIOS.map(sw.urlDe).includes(url)),
      [],
    );
    assert.deepEqual([sw.saltos, sw.reclamaciones], [0, 0]);
  });

  test(`a la copia de la versión activa le falta un complementario: la instalación añade solo ese y conserva los demás: ${base}`, async () => {
    const sw = servicio(base, { archivos: CON_COMPLEMENTARIOS, ...conLaRedNueva(base) });
    sw.conectar();
    redConContenidoNuevo(sw);
    const falta = sw.urlDe('tipografias/letra.woff2');
    const { activa, entradas } = copiaActiva(
      sw,
      CON_COMPLEMENTARIOS.filter((ruta) => sw.urlDe(ruta) !== falta),
    );
    const escritas = escriturasEnLaDefinitiva(sw);
    await sw.instalar();
    await conservadas(activa, entradas);
    assert.deepEqual(escritas, [falta]);
    assert.deepEqual([...activa.keys()].sort(), CON_COMPLEMENTARIOS.map(sw.urlDe).sort());
    assert.equal(await activa.get(falta)?.clone().text(), `red ${falta}`);
    assert.deepEqual(sw.avisos, []);
    assert.deepEqual([sw.saltos, sw.reclamaciones], [0, 0]);
  });

  test(`si el complementario que le falta a la copia de la versión activa no llega, la instalación termina sin escribir nada: ${base}`, async () => {
    const sw = servicio(base, { archivos: CON_COMPLEMENTARIOS, ...conLaRedNueva(base) });
    sw.conectar();
    const falta = sw.urlDe('imagenes/foto.webp');
    redConContenidoNuevo(sw, falta);
    const { activa, entradas } = copiaActiva(
      sw,
      CON_COMPLEMENTARIOS.filter((ruta) => sw.urlDe(ruta) !== falta),
    );
    const escritas = escriturasEnLaDefinitiva(sw);
    await sw.instalar();
    await conservadas(activa, entradas);
    assert.deepEqual(escritas, []);
    assert.equal(sw.guardadas.get(sw.nombreCopia), activa);
    assert.equal(activa.has(falta), false);
    // El fallo se cuenta en la consola del service worker; la versión no salta la espera ni reclama pestañas.
    assert.equal(sw.avisos.length, 1);
    assert.match(String(sw.avisos[0]?.[0]), /sin 1 de 2 /);
    assert.deepEqual([sw.saltos, sw.reclamaciones], [0, 0]);
  });

  test(`a la copia de la versión activa le falta un recurso: un fallo de cuota no la borra y el reintento solo la completa: ${base}`, async () => {
    const sw = servicio(base, { archivos: ARCHIVOS });
    sw.conectar();
    const falta = sw.urlDe('estilos/base.css');
    const activa = new Map(
      ARCHIVOS.filter((ruta) => sw.urlDe(ruta) !== falta).map((ruta) => [
        sw.urlDe(ruta),
        new Response(`activa ${ruta}`),
      ]),
    );
    const entradas = new Map(activa);
    sw.guardadas.set(sw.nombreCopia, activa);
    let rechazos = 0;
    sw.copias.antesDeGuardar = async (nombre, clave) => {
      if (nombre === sw.nombreCopia && clave === falta && rechazos === 0) {
        rechazos++;
        throw new DOMException('cuota de ensayo', 'QuotaExceededError');
      }
    };
    const escritas = escriturasEnLaDefinitiva(sw);
    await assert.rejects(
      sw.instalar(),
      (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError',
    );
    assert.equal(rechazos, 1);
    assert.deepEqual(escritas, []);
    assert.equal(sw.guardadas.get(sw.nombreCopia), activa);
    assert.deepEqual(activa, entradas);
    assert.equal(sw.guardadas.has(`${sw.nombreCopia}:provisional`), false);
    assert.deepEqual([sw.saltos, sw.reclamaciones], [0, 0]);
    await sw.instalar();
    assert.deepEqual(escritas, [falta]);
    assert.deepEqual([...activa.keys()].sort(), ARCHIVOS.map(sw.urlDe).sort());
    for (const [clave, respuesta] of entradas) {
      assert.equal(activa.get(clave), respuesta);
    }
  });
}
