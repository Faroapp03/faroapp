// paso-informe.js real y su filtro HTML real; la red, la conversación y la página son dobles (limites-del-paso). Cada
// prueba importa una instancia nueva del módulo para que su estado interno (el informe en curso) no pase a la siguiente.
import './limites-del-paso/carga.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../src/api/problemas.ts';
import { HtmlNoAdmitido } from '../../web/scripts/confianza/informe.js';
import { ErrorFaro, errorDeLaRespuesta } from '../../web/scripts/recorrido/api/errores.js';
import { Nodo, navegador, pagina } from '../web-controles/ayudas.js';
import { CURSOS_DE_LA_HOJA, prueba, reiniciar } from './limites-del-paso/dobles.ts';

/** Un fallo interno del motor al preparar el informe. */
const FALLO_INTERNO = 500;
const SOLICITUD_INCORRECTA = 400;
const BUENO = '<p>Informe de ensayo</p>';
const MALO = '<p>Informe</p><script>alert(1)</script>';
/** Lo que exporta el paso real; se importa con una consulta para tener una instancia nueva en cada prueba. */
type PasoDelInforme = typeof import('../../web/scripts/recorrido/paso-informe.js');
type Envio = Parameters<PasoDelInforme['verMiInforme']>[0];
let numero = 0;
class Boton extends Nodo {
  disabled = false;
  click() {
    if (!this.disabled) {
      this.dispatchEvent(new Event('click'));
    }
  }
}
class Informe extends Nodo {
  escrituras: string[] = [];
  set innerHTML(valor: string) {
    this.escrituras.push(String(valor));
  }
}
async function preparar(t: TestContext, respuestas: Promise<string>[]) {
  reiniciar();
  prueba.respuestas = respuestas;
  const dom = pagina(t);
  const informe = new Informe();
  dom.ids.set('informe', informe);
  dom.ids.set('nota-idioma-informe', new Nodo());
  Object.assign(dom.document, { createElement: (tipo: string) => (tipo === 'button' ? new Boton() : new Nodo()) });
  navegador(t, { HTMLLinkElement: Nodo });
  const errores: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errores.push(args));
  const modulo: PasoDelInforme = await import(`../../web/scripts/recorrido/paso-informe.js?ensayo=${++numero}`);
  return { modulo, informe, errores };
}
// El envío del formulario: el paso solo llama a preventDefault y no mira quién lo envía.
const evento = (): Envio => Object.assign(new Event('submit', { cancelable: true }), { submitter: null });
const opciones = { alBorrar() {} };
const asentar = () => new Promise((resolver) => setImmediate(resolver));

test('un HTML rechazado ofrece reintento: dos clics no duplican la petición ni pintan HTML inseguro', async (t) => {
  const segunda = Promise.withResolvers<string>();
  const p = await preparar(t, [Promise.resolve(MALO), segunda.promise]);
  await p.modulo.verMiInforme(evento(), opciones);
  assert.deepEqual(p.informe.escrituras, []);
  assert.deepEqual(prueba.confirmadas, [true, false]);
  assert.deepEqual(prueba.agentes, ['trabajando', 'fallo']);
  const boton = prueba.botones.at(-1);
  assert.ok(boton instanceof Boton);
  boton.click();
  boton.click();
  assert.equal(boton.disabled, true);
  assert.equal(prueba.pedidos, 2);
  segunda.resolve(BUENO);
  await asentar();
  assert.deepEqual(p.informe.escrituras, [BUENO]);
  assert.deepEqual(prueba.confirmadas, [true, false, true]);
  assert.equal(prueba.agentes.at(-1), 'hecho');
});

test('con el reloj atrasado, la entrega cuenta la explicación una sola vez y el reintento funciona al corregir el reloj', async (t) => {
  const primera = Promise.withResolvers<string>();
  const p = await preparar(t, [primera.promise, Promise.resolve(BUENO)]);
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  const solo = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe');
  assert.ok(solo?.accion);
  solo.accion();
  const atrasado = errorDeLaRespuesta(SOLICITUD_INCORRECTA, { type: `${RAIZ_DE_LOS_PROBLEMAS}reloj_atrasado` });
  primera.reject(atrasado);
  await trabajo;
  await asentar();
  assert.deepEqual(prueba.fallos, [atrasado]);
  assert.ok(!prueba.dichos.includes('recorrido.informe.fallo-al-prepararlo'));
  assert.ok(!prueba.efectos.includes('error'));
  assert.deepEqual(p.informe.escrituras, []);
  const reintento = prueba.sugerencias.findLast((s) => s.texto === 'recorrido.reintentar');
  assert.ok(reintento?.accion);
  reintento.accion();
  await asentar();
  assert.equal(prueba.pedidos, 2);
  assert.deepEqual(p.informe.escrituras, [BUENO]);
  assert.equal(prueba.agentes.at(-1), 'hecho');
  assert.equal(prueba.fallos.length, 1);
});

test('dos envíos mientras se espera el informe producen una petición y una intervención', async (t) => {
  const respuesta = Promise.withResolvers<string>();
  const p = await preparar(t, [respuesta.promise]);
  const primero = p.modulo.verMiInforme(evento(), opciones);
  await p.modulo.verMiInforme(evento(), opciones);
  assert.equal(prueba.pedidos, 1);
  assert.equal(prueba.efectos.filter((efecto) => efecto === 'persona').length, 1);
  respuesta.resolve(BUENO);
  await primero;
  assert.deepEqual(p.informe.escrituras, [BUENO]);
});

test('cancelar tras solicitar el reintento impide pintar o confirmar una respuesta tardía', async (t) => {
  const respuesta = Promise.withResolvers<string>();
  const p = await preparar(t, [Promise.resolve(MALO), respuesta.promise]);
  await p.modulo.verMiInforme(evento(), opciones);
  const boton = prueba.botones.at(-1);
  assert.ok(boton instanceof Boton);
  boton.click();
  assert.equal(prueba.pedidos, 2);
  prueba.controlador.abort();
  respuesta.resolve(BUENO);
  await asentar();
  assert.deepEqual(p.informe.escrituras, []);
  assert.deepEqual(prueba.confirmadas, [true, false]);
  assert.notEqual(prueba.agentes.at(-1), 'hecho');
});

test('la entrega en espera comunica el fallo una vez y el reintento entrega la carpeta', async (t) => {
  const primero = Promise.withResolvers<string>();
  const p = await preparar(t, [primero.promise, Promise.resolve(BUENO)]);
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  const solo = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe');
  assert.ok(solo?.accion);
  solo.accion();
  primero.resolve(MALO);
  await trabajo;
  await asentar();
  assert.deepEqual(p.informe.escrituras, []);
  assert.equal(prueba.efectos.filter((efecto) => efecto === 'fallo').length, 1);
  // Quien espera para entregar es quien lo cuenta: el agente no añade su propio mensaje de fallo.
  assert.ok(!prueba.efectos.includes('error'));
  assert.ok(p.errores[0]?.[0] instanceof HtmlNoAdmitido);
  const reintento = prueba.sugerencias.findLast((s) => s.texto === 'recorrido.reintentar');
  assert.ok(reintento?.accion);
  reintento.accion();
  await asentar();
  assert.equal(prueba.pedidos, 2);
  assert.deepEqual(p.informe.escrituras, [BUENO]);
  assert.ok(prueba.efectos.includes('carpeta'));
});

test('si falla el motor, Faro dice que el informe completo no ha salido y ofrece prepararlo solo con las oficiales', async (t) => {
  const pendiente = Promise.withResolvers<string>();
  const p = await preparar(t, [pendiente.promise]);
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe')?.accion?.();
  pendiente.reject(new ErrorFaro('motor', FALLO_INTERNO));
  await trabajo;
  await asentar();
  assert.equal(prueba.dichos.at(-1), 'recorrido.informe.fallo-al-prepararlo');
  assert.deepEqual(
    prueba.sugerencias.slice(-2).map((s) => s.texto),
    ['recorrido.reintentar', 'recorrido.informe.solo-oficiales'],
  );
});

test('si no se puede reunir el resultado para el informe solo con las oficiales, Faro lo dice', async (t) => {
  const pendiente = Promise.withResolvers<string>();
  const p = await preparar(t, [pendiente.promise]);
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe')?.accion?.();
  pendiente.reject(new ErrorFaro('motor', FALLO_INTERNO));
  await trabajo;
  await asentar();
  prueba.resultadoFalla = true;
  const rechazos: unknown[] = [];
  const anotar = (motivo: unknown) => rechazos.push(motivo);
  process.on('unhandledRejection', anotar);
  t.after(() => process.off('unhandledRejection', anotar));
  prueba.sugerencias.findLast((s) => s.texto === 'recorrido.informe.solo-oficiales')?.accion?.();
  await asentar();
  await asentar();
  assert.deepEqual(rechazos, []);
  assert.ok(prueba.fallos.at(-1) instanceof TypeError);
  assert.equal(prueba.agentes.at(-1), 'fallo');
  assert.equal(prueba.pedidosCodigo, 0);
  assert.deepEqual(p.informe.escrituras, []);
});

test('si falla el motor, el informe solo con las oficiales rechaza HTML y permite volver a pedirlo', async (t) => {
  const pendiente = Promise.withResolvers<string>();
  const p = await preparar(t, [pendiente.promise]);
  prueba.recibos = [Promise.resolve(MALO), Promise.resolve(BUENO)];
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  const solo = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe');
  assert.ok(solo?.accion);
  solo.accion();
  const error = new ErrorFaro('motor', FALLO_INTERNO);
  pendiente.reject(error);
  await trabajo;
  await asentar();
  const local = prueba.sugerencias.findLast((s) => s.texto === 'recorrido.informe.solo-oficiales');
  assert.ok(local?.accion);
  local.accion();
  await asentar();
  assert.deepEqual(p.informe.escrituras, []);
  assert.equal(prueba.pedidosCodigo, 1);
  // El informe local que no pasa el filtro lo cuenta Faro una sola vez, con el rechazo del filtro, y la tarjeta del
  // agente lo marca como fallido.
  assert.equal(prueba.efectos.filter((efecto) => efecto === 'fallo').length, 1);
  assert.ok(prueba.fallos.at(-1) instanceof HtmlNoAdmitido);
  assert.equal(prueba.agentes.at(-1), 'fallo');
  const reintento = prueba.sugerencias.findLast((s) => s.texto === 'recorrido.reintentar');
  assert.ok(reintento?.accion);
  reintento.accion();
  await asentar();
  assert.equal(prueba.pedidosCodigo, 2);
  assert.deepEqual(p.informe.escrituras, [BUENO]);
  assert.equal(prueba.agentes.at(-1), 'hecho');
  assert.ok(prueba.efectos.includes('carpeta'));
});

test('el informe solo con las oficiales es un informe nuevo: pide contrastar la fecha del reloj del dispositivo', async (t) => {
  const pendiente = Promise.withResolvers<string>();
  const p = await preparar(t, [pendiente.promise]);
  prueba.recibos = [Promise.resolve(BUENO)];
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe')?.accion?.();
  pendiente.reject(new ErrorFaro('motor', FALLO_INTERNO));
  await trabajo;
  await asentar();
  prueba.sugerencias.findLast((s) => s.texto === 'recorrido.informe.solo-oficiales')?.accion?.();
  await asentar();
  assert.equal(prueba.opcionesDelCodigo.length, 1);
  assert.equal(prueba.opcionesDelCodigo[0]?.relojDelDispositivo, true);
});

test('la hoja no pintada ofrece reintento y entrega su tarjeta tras recuperarse', async (t) => {
  const p = await preparar(t, [Promise.resolve(BUENO)]);
  prueba.fallosHoja = 1;
  await p.modulo.verMiInforme(evento(), opciones);
  const si = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.si');
  assert.ok(si?.accion);
  si.accion();
  await asentar();
  assert.ok(prueba.efectos.includes('error'));
  const reintento = prueba.sugerencias.findLast((s) => s.texto === 'recorrido.reintentar');
  assert.ok(reintento?.accion);
  reintento.accion();
  assert.deepEqual(prueba.tarjetasHoja, [[CURSOS_DE_LA_HOJA, true]]);
});

test('al encargar el informe muestra el pensamiento y la frase del agente', async (t) => {
  const p = await preparar(t, [Promise.resolve(BUENO)]);
  await p.modulo.verMiInforme(evento(), opciones);
  assert.deepEqual(prueba.pensamientos[0], ['recorrido.agente.encargando', 'recorrido.agente.paralelo']);
  assert.equal(prueba.frases, 1);
  const fuente = readFileSync(new URL('../../web/scripts/recorrido/paso-informe.js', import.meta.url), 'utf8');
  assert.ok(!fuente.includes('motorEnElDispositivo'));
});

test('cancelar mientras llega el informe local evita insertar y entregar el resultado', async (t) => {
  const fallo = Promise.withResolvers<string>();
  const tardio = Promise.withResolvers<string>();
  const p = await preparar(t, [fallo.promise]);
  prueba.recibos = [tardio.promise];
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  const solo = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe');
  assert.ok(solo?.accion);
  solo.accion();
  const error = new ErrorFaro('motor', FALLO_INTERNO);
  fallo.reject(error);
  await trabajo;
  await asentar();
  const local = prueba.sugerencias.findLast((s) => s.texto === 'recorrido.informe.solo-oficiales');
  assert.ok(local?.accion);
  local.accion();
  assert.equal(prueba.pedidosCodigo, 1);
  prueba.controlador.abort();
  tardio.resolve(BUENO);
  await asentar();
  assert.deepEqual(p.informe.escrituras, []);
  assert.ok(!prueba.efectos.includes('carpeta'));
});

test('un borrado al recibir el resultado transferido no pinta ni anuncia contenido anterior', async (t) => {
  const p = await preparar(t, []);
  prueba.recibos = [Promise.resolve(BUENO)];
  prueba.cancelarAlRecibir = true;
  await p.modulo.abrirResultadoRecibido('codigo-sintetico', {
    alBorrar() {},
    signal: prueba.controlador.signal,
  });
  assert.equal(prueba.controlador.signal.aborted, true);
  assert.deepEqual(p.informe.escrituras, []);
  assert.ok(!prueba.efectos.includes('faro'));
  assert.deepEqual(p.errores, []);
});

test('si el informe aún se prepara, el pensamiento de la entrega empieza con la espera y se termina al llegar', async (t) => {
  const primero = Promise.withResolvers<string>();
  const p = await preparar(t, [primero.promise]);
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  const solo = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe');
  assert.ok(solo?.accion);
  solo.accion();
  await asentar();
  // Mientras se prepara: el pensamiento ya está empezado y la entrega todavía no ha dicho nada más.
  assert.deepEqual(prueba.empezados, ['recorrido.agente.entregando']);
  assert.equal(prueba.pensamientos.length, 1, 'Solo el pensamiento del encargo');
  assert.ok(!prueba.efectos.includes('carpeta'));
  primero.resolve(BUENO);
  await trabajo;
  await asentar();
  assert.deepEqual(prueba.pensamientos.at(-1), ['recorrido.agente.entregando']);
  assert.deepEqual(
    prueba.terminados.at(-1),
    { empezado: 'recorrido.agente.entregando' },
    'Termina el mismo pensamiento',
  );
  assert.ok(prueba.efectos.includes('carpeta'));
});

test('si el informe ya estaba listo, la entrega no empieza ningún pensamiento antes de tiempo', async (t) => {
  const p = await preparar(t, [Promise.resolve(BUENO)]);
  await p.modulo.verMiInforme(evento(), opciones);
  await asentar();
  const solo = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe');
  assert.ok(solo?.accion);
  solo.accion();
  await asentar();
  assert.deepEqual(prueba.empezados, []);
  assert.deepEqual(prueba.pensamientos.at(-1), ['recorrido.agente.ya-estaba-listo']);
  assert.equal(prueba.terminados.at(-1), null);
});

test('al volver a intentarlo, el pensamiento de la entrega empieza con la nueva preparación', async (t) => {
  const segundo = Promise.withResolvers<string>();
  const p = await preparar(t, [Promise.resolve(MALO), segundo.promise]);
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  const solo = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe');
  assert.ok(solo?.accion);
  solo.accion();
  await trabajo;
  await asentar();
  const reintento = prueba.sugerencias.findLast((s) => s.texto === 'recorrido.reintentar');
  assert.ok(reintento?.accion);
  reintento.accion();
  await asentar();
  assert.equal(prueba.pedidos, 2);
  assert.equal(prueba.empezados.at(-1), 'recorrido.agente.entregando', 'Empieza mientras se prepara el nuevo informe');
  assert.ok(!prueba.efectos.includes('carpeta'));
  segundo.resolve(BUENO);
  await asentar();
  await asentar();
  assert.deepEqual(prueba.pensamientos.at(-1), ['recorrido.agente.entregando']);
  assert.deepEqual(prueba.terminados.at(-1), { empezado: 'recorrido.agente.entregando' });
  assert.ok(prueba.efectos.includes('carpeta'));
});

test('si la persona borra mientras se espera la entrega, no se termina el pensamiento ni se cuenta un fallo', async (t) => {
  const primero = Promise.withResolvers<string>();
  const p = await preparar(t, [primero.promise]);
  const trabajo = p.modulo.verMiInforme(evento(), opciones);
  const solo = prueba.sugerencias.find((s) => s.texto === 'recorrido.agente.solo-informe');
  assert.ok(solo?.accion);
  solo.accion();
  await asentar();
  assert.deepEqual(prueba.empezados, ['recorrido.agente.entregando']);
  const antes = prueba.efectos.length;
  prueba.controlador.abort();
  primero.resolve(BUENO);
  await trabajo;
  await asentar();
  assert.equal(prueba.pensamientos.length, 1, 'Solo el pensamiento del encargo: el de la entrega no se termina');
  assert.deepEqual(p.informe.escrituras, []);
  assert.deepEqual(prueba.efectos.slice(antes), [], 'Ni carpeta ni fallo después de borrar');
});
