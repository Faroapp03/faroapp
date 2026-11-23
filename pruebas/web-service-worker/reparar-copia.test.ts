// La reparación del lado del service worker (service-worker.js, «Reparar la copia»): la página la pide con
// REPARAR_COPIA y su número, y la versión activa rehace su copia como al instalar: lo baja a una copia provisional,
// cada comprobado solo si cuadra, y solo si llega todo lo copia sobre lo guardado. Si la red se corta a mitad o el
// servidor no entrega esta versión, la copia anterior sigue como estaba, la del paquete también, no se da de baja y lo
// dice; si falla al copiar, lo que siga estropeado se vuelve a detectar y la reparación se puede repetir. Una
// reparación cortada se reanuda sin volver a bajar lo que ya guardó, también si el service worker se ha detenido entre
// medias. La petición repetida por la página (su latido, con el mismo número) se une a la reparación en curso: un solo
// intento y una sola respuesta. Dos reparaciones con números distintos van una detrás de otra, y cada respuesta lleva
// el número de su petición; la que espera recibe avisos mientras dura la en curso y, si esa sale bien, su misma
// respuesta sin repetirla. El latido que llega tras la respuesta la recibe otra vez, sin otra reparación. La
// provisional que dejó una reparación sin terminar se borra cuando la sonda ve la copia entera y de esta versión, con
// el cerrojo libre. La página sabe que sigue por sus avisos de progreso. Y lo comprobado que
// falta en la copia (una copia estropeada) no es de paso: responde 500 y la sonda lo cuenta, para que la página vuelva
// a ofrecer la reparación.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mock, test } from 'node:test';
import { BASES, pedir, servicio } from './ayudas.ts';

const MOTOR = 'motor/src/plataforma/navegador/motor.js';
const WORKER = 'scripts/motor-local/worker.js';
const SONDA = 'motor/copia-comprobada.json';
const RECURSO = { mode: 'cors', method: 'GET' };
/** Los estados que se esperan: la copia estropeada (500) y la respuesta correcta. */
const LA_COPIA_HA_CAMBIADO = 500;
const CORRECTO = 200;
/** Lo que se deja pasar para que las dos reparaciones hayan empezado con la red parada. */
const UN_MOMENTO_MS = 5;
/** Las sondas seguidas con que se mira si la copia estropeada se vuelve a comprobar. */
const SONDAS = 5;
const ARCHIVOS = ['inicio.html', 'sin-conexion.html', 'estilos/base.css', 'js/pagina-inicio-0123456789abcdef.js'];
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** El service worker real instalado, con una copia del paquete que no debe tocarse y una red que se puede cortar. */
async function instalado(base: string, copias?: Parameters<typeof servicio>[2]) {
  const cuerpos: Record<string, string> = { [MOTOR]: 'MOTOR', [WORKER]: 'WORKER' };
  const sw = servicio(
    base,
    {
      archivos: ARCHIVOS,
      comprobados: [
        [MOTOR, sha256('MOTOR')],
        [WORKER, sha256('WORKER')],
      ],
      cuerpoDe: (ruta) => cuerpos[ruta] ?? ruta,
    },
    copias,
  );
  const red = { cortarTras: Number.POSITIVE_INFINITY, pedidas: 0 };
  sw.red.respuesta = (url) => {
    red.pedidas += 1;
    if (red.pedidas > red.cortarTras) {
      throw new TypeError('La red se ha cortado');
    }
    const ruta = new URL(url).pathname.slice(new URL(base).pathname.length);
    const tipo = ruta.endsWith('.html') ? 'text/html' : 'text/javascript';
    return new Response(cuerpos[ruta] ?? ruta, { headers: { 'content-type': tipo } });
  };
  sw.conectar();
  await sw.instalar();
  const paquete = String(sw.evaluar('COPIA_DEL_PAQUETE'));
  sw.guardadas.set(paquete, new Map([[sw.urlDe('paquete/x/manifiesto.json'), new Response('{}')]]));
  const bajas: string[] = [];
  Object.assign(sw.registro, { unregister: async () => bajas.push('baja') });
  // La copia guardada se estropea: el motor ya no es el de esta versión.
  sw.guardadas.get(sw.nombreCopia)?.set(sw.urlDe(MOTOR), new Response('MOTOR CAMBIADO'));
  return { sw, cuerpos, red, paquete, bajas };
}

/**
 * Pide la reparación como la página `pagina`, con el número `id`, y devuelve lo que responde el service worker, sin
 * sus avisos de progreso (`alAvanzar` los recibe, si se quieren ver).
 */
async function reparar(
  sw: ReturnType<typeof servicio>,
  id = 1,
  pagina = 'pestana',
  alAvanzar?: (aviso: unknown) => void,
) {
  let trabajo = Promise.resolve<unknown>(undefined);
  const recibidos: unknown[] = [];
  const anotar = (mensaje: { type?: unknown }) => {
    const copia = JSON.parse(JSON.stringify(mensaje));
    if (mensaje.type === 'PROGRESO_DE_LA_REPARACION') {
      alAvanzar?.(copia);
    } else {
      recibidos.push(copia);
    }
  };
  sw.oyentes.get('message')?.({
    data: { type: 'REPARAR_COPIA', id },
    source: { id: pagina, postMessage: anotar },
    waitUntil: (valor: Promise<unknown>) => {
      trabajo = valor;
    },
  });
  await trabajo;
  return recibidos;
}

/** La respuesta del service worker a la petición `id`: con éxito o con su motivo. */
const contestacion = (id: number, motivo?: string) => [
  { type: 'COPIA_REPARADA', id, ok: motivo === undefined, ...(motivo ? { motivo } : {}) },
];
const sinProvisional = (sw: ReturnType<typeof servicio>) =>
  ![...sw.guardadas.keys()].some((nombre) => nombre.endsWith(':reparacion'));

/** Lo que tiene la copia de la web: cada dirección con su texto. */
async function contenido(sw: ReturnType<typeof servicio>) {
  const copia = sw.guardadas.get(sw.nombreCopia) ?? new Map<string, Response>();
  return Object.fromEntries(
    await Promise.all([...copia.entries()].map(async ([clave, r]) => [clave, await r.clone().text()] as const)),
  );
}

/** Lo que dice la sonda del motor: si el service worker ha rechazado algo comprobado. */
async function noCoincide(sw: ReturnType<typeof servicio>) {
  return (JSON.parse((await pedir(sw, SONDA, RECURSO)).cuerpo ?? '{}') as { noCoincide?: unknown }).noCoincide;
}

for (const base of BASES) {
  test(`la reparación rehace la copia sin tocar la del paquete, sin darse de baja y sin provisional: ${base}`, async () => {
    const { sw, paquete, bajas } = await instalado(base);
    assert.deepEqual(await reparar(sw), contestacion(1));
    assert.equal((await contenido(sw))[sw.urlDe(MOTOR)], 'MOTOR', 'la copia vuelve a tener el motor de esta versión');
    assert.equal(sw.guardadas.get(paquete)?.size, 1, 'la copia del paquete sigue entera');
    assert.deepEqual(bajas, []);
    assert.ok(sinProvisional(sw), 'sin copia provisional');
  });

  test(`si la red se corta a mitad, la copia anterior y la del paquete siguen intactas y no hay baja: ${base}`, async () => {
    const { sw, red, paquete, bajas } = await instalado(base);
    const antes = await contenido(sw);
    red.pedidas = 0;
    red.cortarTras = 2;
    assert.deepEqual(await reparar(sw), contestacion(1, 'sin-completar'));
    assert.deepEqual(await contenido(sw), antes, 'ni una entrada cambiada: todo o nada');
    assert.equal(sw.guardadas.get(paquete)?.size, 1);
    assert.deepEqual(bajas, [], 'un corte de red no da de baja el service worker');
    // Con la red de vuelta, la reparación se puede volver a pedir y sale bien.
    red.cortarTras = Number.POSITIVE_INFINITY;
    assert.deepEqual(await reparar(sw, 2), contestacion(2));
    assert.equal((await contenido(sw))[sw.urlDe(MOTOR)], 'MOTOR');
    assert.ok(sinProvisional(sw), 'terminada la descarga, sin copia provisional');
  });

  test(`una reparación cortada se reanuda sin volver a bajar lo guardado, también tras detenerse: ${base}`, async () => {
    // Lo que baja una reparación entera.
    const entera = await instalado(base);
    entera.red.pedidas = 0;
    assert.deepEqual(await reparar(entera.sw), contestacion(1));
    const todas = entera.red.pedidas;
    const { sw, red, paquete } = await instalado(base);
    red.pedidas = 0;
    red.cortarTras = 2;
    assert.deepEqual(await reparar(sw), contestacion(1, 'sin-completar'));
    const provisional = sw.guardadas.get(`${sw.nombreCopia}:reparacion`);
    const guardadas = provisional?.size ?? 0;
    assert.ok(guardadas > 0 && guardadas < todas, `lo bajado y comprobado se queda: ${guardadas} de ${todas}`);
    // El navegador detiene el service worker y lo vuelve a poner en marcha: la provisional sigue.
    const otraVez = await instalado(base, sw.copias);
    await new Promise((listo) => setTimeout(listo, UN_MOMENTO_MS));
    assert.equal(otraVez.sw.guardadas.get(`${sw.nombreCopia}:reparacion`)?.size, guardadas, 'al ponerse en marcha');
    otraVez.sw.guardadas.get(sw.nombreCopia)?.set(otraVez.sw.urlDe(MOTOR), new Response('MOTOR CAMBIADO'));
    otraVez.red.pedidas = 0;
    const avisos: unknown[] = [];
    assert.deepEqual(await reparar(otraVez.sw, 2, 'pestana', (aviso) => avisos.push(aviso)), contestacion(2));
    assert.equal(otraVez.red.pedidas, todas - guardadas, `solo baja lo que faltaba: ${otraVez.red.pedidas}`);
    assert.deepEqual(avisos[0], { type: 'PROGRESO_DE_LA_REPARACION', id: 2 }, 'sin cifras: solo que sigue');
    assert.equal(avisos.length, 1 + todas - guardadas, 'al empezar y con cada archivo guardado');
    assert.equal((await contenido(otraVez.sw))[sw.urlDe(MOTOR)], 'MOTOR');
    assert.equal(otraVez.sw.guardadas.get(paquete)?.size, 1);
    assert.ok(sinProvisional(otraVez.sw));
  });

  test(`la petición repetida con el mismo número se une a la reparación en curso: un solo intento: ${base}`, async () => {
    const entera = await instalado(base);
    entera.red.pedidas = 0;
    await reparar(entera.sw);
    const todas = entera.red.pedidas;
    const { sw, red } = await instalado(base);
    const servir = sw.red.respuesta;
    const lenta = Promise.withResolvers<void>();
    sw.red.respuesta = async (url, opciones) => {
      await lenta.promise;
      return (servir as NonNullable<typeof servir>)(url, opciones);
    };
    red.pedidas = 0;
    const primera = reparar(sw, 1);
    await new Promise((listo) => setTimeout(listo, UN_MOMENTO_MS));
    const latido = reparar(sw, 1);
    lenta.resolve();
    assert.deepEqual(await primera, contestacion(1));
    assert.deepEqual(await latido, [], 'sin otra respuesta');
    assert.equal(red.pedidas, todas, 'cada archivo, una vez');
  });

  test(`la petición con otro número que espera recibe avisos de la en curso y su misma respuesta, sin repetirla: ${base}`, async () => {
    const entera = await instalado(base);
    entera.red.pedidas = 0;
    await reparar(entera.sw);
    const todas = entera.red.pedidas;
    const { sw, red } = await instalado(base);
    const servir = sw.red.respuesta as NonNullable<typeof sw.red.respuesta>;
    const peticiones = Array.from({ length: todas }, () => ({
      pedida: Promise.withResolvers<void>(),
      continuar: Promise.withResolvers<void>(),
    }));
    let numero = 0;
    sw.red.respuesta = async (url, opciones) => {
      const peticion = peticiones[numero++];
      assert.ok(peticion, 'la reparación no pide archivos de más');
      peticion.pedida.resolve();
      await peticion.continuar.promise;
      return servir(url, opciones);
    };
    red.pedidas = 0;
    const avisos: unknown[] = [];
    const primera = reparar(sw, 1, 'pestana');
    assert.ok(peticiones[0]);
    await peticiones[0].pedida.promise;
    let progreso = Promise.withResolvers<void>();
    const otra = reparar(sw, 2, 'otra-pestana', (aviso) => {
      avisos.push(aviso);
      progreso.resolve();
    });
    await progreso.promise;
    assert.deepEqual(avisos, [{ type: 'PROGRESO_DE_LA_REPARACION', id: 2 }], 'al recibirla, aunque espere');
    // La en curso tarda lo que tarde (más de 30 s en una red lenta): cada archivo que guarda es otro aviso para la que
    // espera, y su página no se rinde mientras la otra avanza.
    for (const [indice, peticion] of peticiones.entries()) {
      await peticion.pedida.promise;
      progreso = Promise.withResolvers<void>();
      peticion.continuar.resolve();
      await progreso.promise;
      assert.equal(avisos.length, indice + 2, 'un aviso por archivo que guarda la reparación en curso');
    }
    assert.deepEqual(await primera, contestacion(1));
    assert.deepEqual(await otra, contestacion(2), 'la misma respuesta, con su número');
    assert.equal(red.pedidas, todas, 'sin volver a bajar nada');
    assert.ok(avisos.every((aviso) => JSON.stringify(aviso) === '{"type":"PROGRESO_DE_LA_REPARACION","id":2}'));
  });

  test(`el latido que llega tras la respuesta recibe la misma, sin otra reparación: ${base}`, async () => {
    const { sw, red } = await instalado(base);
    assert.deepEqual(await reparar(sw, 1), contestacion(1));
    red.pedidas = 0;
    assert.deepEqual(await reparar(sw, 1), contestacion(1), 'la misma respuesta');
    assert.equal(red.pedidas, 0, 'ni una petición a la red');
  });

  test(`con la copia estropeada, la sonda no recalcula sus huellas hasta que la copia cambia: ${base}`, async () => {
    const { sw, red } = await instalado(base);
    red.cortarTras = red.pedidas + 2;
    assert.deepEqual(await reparar(sw), contestacion(1, 'sin-completar'));
    const cerrojos = sw.evaluar('navigator.locks') as { request: (n: string, a: () => Promise<void>) => Promise<void> };
    const huellas = mock.method(crypto.subtle, 'digest');
    // Cada sonda mira la provisional en segundo plano, con su cerrojo: se espera a que lo suelte.
    const calculadasEn = async (sondas: number) => {
      const antes = huellas.mock.callCount();
      for (let vuelta = 0; vuelta < sondas; vuelta += 1) {
        assert.equal(await noCoincide(sw), false);
        await cerrojos.request(`${sw.nombreCopia}:reparacion`, async () => undefined);
      }
      return huellas.mock.callCount() - antes;
    };
    try {
      const unaVez = await calculadasEn(1);
      assert.ok(unaVez > 0, 'la primera sonda calcula las huellas de la copia');
      assert.equal(await calculadasEn(SONDAS), 0, `${SONDAS} sondas más, sin volver a calcular`);
      // Falta un estilo y la página lo pide: el service worker lo trae de la red y lo guarda en la copia.
      sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe('estilos/base.css'));
      red.cortarTras = Number.POSITIVE_INFINITY;
      assert.equal((await pedir(sw, 'estilos/base.css', RECURSO)).estado, CORRECTO);
      assert.equal(await calculadasEn(SONDAS), unaVez, 'el service worker ha escrito en la copia: una vez más');
      red.cortarTras = red.pedidas;
      assert.deepEqual(await reparar(sw, 2), contestacion(2, 'sin-completar'));
      assert.equal(await calculadasEn(SONDAS), unaVez, 'tras otra reparación: una vez más');
      assert.ok(!sinProvisional(sw), 'con la copia aún estropeada, la provisional se queda');
    } finally {
      huellas.mock.restore();
    }
  });

  test(`el «no» guardado caduca cuando el propio service worker deja la copia entera: ${base}`, async () => {
    const { sw, red } = await instalado(base);
    // Antes de la primera sonda, la copia solo tiene un estilo de menos: el motor vuelve a ser el de esta versión.
    const copia = sw.guardadas.get(sw.nombreCopia);
    copia?.set(sw.urlDe(MOTOR), new Response('MOTOR'));
    copia?.delete(sw.urlDe('estilos/base.css'));
    red.cortarTras = red.pedidas + 2;
    assert.deepEqual(await reparar(sw), contestacion(1, 'sin-completar'));
    const cerrojos = sw.evaluar('navigator.locks') as { request: (n: string, a: () => Promise<void>) => Promise<void> };
    const sonda = async () => {
      assert.equal(await noCoincide(sw), false);
      await cerrojos.request(`${sw.nombreCopia}:reparacion`, async () => undefined);
    };
    await sonda();
    await sonda();
    assert.ok(!sinProvisional(sw), 'con el estilo de menos, la provisional se queda');
    red.cortarTras = Number.POSITIVE_INFINITY;
    assert.equal((await pedir(sw, 'estilos/base.css', RECURSO)).estado, CORRECTO);
    assert.ok(copia?.has(sw.urlDe('estilos/base.css')), 'el service worker lo ha guardado en la copia');
    await sonda();
    assert.ok(sinProvisional(sw), 'la copia está entera: el «no» guardado ya no vale y la provisional se borra');
  });

  test(`la provisional sin terminar se borra cuando la sonda ve la copia entera y de esta versión: ${base}`, async () => {
    const { sw, red } = await instalado(base);
    red.cortarTras = red.pedidas + 2;
    assert.deepEqual(await reparar(sw), contestacion(1, 'sin-completar'));
    assert.ok(!sinProvisional(sw), 'queda lo bajado, para reanudar');
    const nombre = `${sw.nombreCopia}:reparacion`;
    const primeros = sw.evaluar('navigator.locks') as { request: (n: string, a: () => Promise<void>) => Promise<void> };
    await noCoincide(sw);
    await primeros.request(nombre, async () => undefined);
    assert.ok(!sinProvisional(sw), 'con la copia aún estropeada, hay algo que reanudar');
    // La copia vuelve a ser de esta versión fuera de este service worker, que lo ve al volver a ponerse en marcha (el
    // navegador lo detiene y lo arranca), pero el cerrojo está tomado: no se toca.
    const activo = (await instalado(base, sw.copias)).sw;
    activo.guardadas.get(sw.nombreCopia)?.set(sw.urlDe(MOTOR), new Response('MOTOR'));
    const suelta = Promise.withResolvers<void>();
    const cerrojos = activo.evaluar('navigator.locks') as typeof primeros;
    const adquirido = Promise.withResolvers<void>();
    const tomado = cerrojos.request(nombre, () => {
      adquirido.resolve();
      return suelta.promise;
    });
    await adquirido.promise;
    await noCoincide(activo);
    assert.ok(!sinProvisional(activo), 'con el cerrojo tomado, no la borra');
    suelta.resolve();
    await tomado;
    await noCoincide(activo);
    // La sonda suelta el cerrojo después de comprobar las huellas y borrar la provisional.
    await cerrojos.request(nombre, async () => undefined);
    assert.ok(sinProvisional(activo), 'ya no hay nada que reanudar');
  });

  test(`si el servidor no entrega esta versión, deja constancia, conserva la copia y no se da de baja: ${base}`, async () => {
    const { sw, cuerpos, paquete, bajas } = await instalado(base);
    const antes = await contenido(sw);
    cuerpos[MOTOR] = 'MOTOR ALTERADO';
    assert.deepEqual(await reparar(sw), contestacion(1, 'no-coincide'));
    assert.deepEqual(await contenido(sw), antes);
    assert.ok(sw.guardadas.get(`faro-estado:${base}`)?.size, 'con constancia del motivo');
    assert.equal(sw.guardadas.get(paquete)?.size, 1);
    assert.deepEqual(bajas, []);
  });

  test(`lo comprobado que falta en la copia responde 500 y la sonda lo cuenta; reparar lo repone: ${base}`, async () => {
    const { sw } = await instalado(base);
    sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe(WORKER));
    const respuesta = await pedir(sw, WORKER, RECURSO);
    assert.equal(respuesta.estado, LA_COPIA_HA_CAMBIADO, 'una copia a la que le falta algo no es de paso');
    assert.equal(respuesta.cuerpo, 'El archivo del motor del dispositivo falta en la copia guardada.');
    assert.equal(await noCoincide(sw), true, 'para que la página vuelva a ofrecer «Reparar Faro»');
    assert.deepEqual(await reparar(sw), contestacion(1));
    assert.equal((await pedir(sw, WORKER, RECURSO)).estado, CORRECTO);
    assert.equal(await noCoincide(sw), false);
  });

  test(`si falla al copiar, lo estropeado se sigue detectando y la reparación se puede repetir: ${base}`, async () => {
    const { sw, paquete } = await instalado(base);
    sw.guardadas.get(sw.nombreCopia)?.set(sw.urlDe(WORKER), new Response('WORKER CAMBIADO'));
    assert.equal((await pedir(sw, MOTOR, RECURSO)).estado, LA_COPIA_HA_CAMBIADO);
    assert.equal(await noCoincide(sw), true);
    // Sin cuota tras la primera entrada copiada: lo comprobado no llega a reponerse.
    let copiadas = 0;
    sw.copias.antesDeGuardar = async (nombre) => {
      if (nombre === sw.nombreCopia && ++copiadas > 1) {
        throw new DOMException('Sin espacio', 'QuotaExceededError');
      }
    };
    assert.deepEqual(await reparar(sw), contestacion(1, 'sin-completar'));
    assert.equal(await noCoincide(sw), true, 'la página vuelve a ofrecer «Reparar Faro»');
    assert.equal((await pedir(sw, WORKER, RECURSO)).estado, LA_COPIA_HA_CAMBIADO, 'lo que sigue estropeado, se ve');
    assert.equal(sw.guardadas.get(paquete)?.size, 1);
    assert.ok(sinProvisional(sw));
    delete sw.copias.antesDeGuardar;
    assert.deepEqual(await reparar(sw, 2), contestacion(2));
    assert.equal((await pedir(sw, WORKER, RECURSO)).estado, CORRECTO);
    assert.equal((await pedir(sw, MOTOR, RECURSO)).estado, CORRECTO);
    assert.equal(await noCoincide(sw), false);
  });

  test(`dos reparaciones con números distintos van una detrás de otra y las dos salen bien: ${base}`, async () => {
    const { sw, paquete } = await instalado(base);
    const servir = sw.red.respuesta;
    const red = Promise.withResolvers<void>();
    sw.red.respuesta = async (url, opciones) => {
      await red.promise;
      return (servir as NonNullable<typeof servir>)(url, opciones);
    };
    const borradasAntes = sw.borradas.length;
    const primera = reparar(sw, 1);
    const segunda = reparar(sw, 2);
    await new Promise((listo) => setTimeout(listo, UN_MOMENTO_MS));
    const provisionalesBorradas = sw.borradas.slice(borradasAntes).filter((nombre) => nombre.endsWith(':reparacion'));
    assert.equal(provisionalesBorradas.length, 0, 'la segunda no toca la provisional de la primera mientras baja');
    red.resolve();
    assert.deepEqual(await primera, contestacion(1));
    assert.deepEqual(await segunda, contestacion(2));
    assert.equal((await contenido(sw))[sw.urlDe(MOTOR)], 'MOTOR');
    assert.equal(sw.guardadas.get(paquete)?.size, 1);
    assert.ok(sinProvisional(sw));
  });
}
