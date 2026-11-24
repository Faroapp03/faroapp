import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import type { Administrador } from '../../src/administracion/administradores.ts';
import {
  csvDeLista,
  montarAdministradores,
  pintarSinPermiso,
  resumenDeLista,
} from '../../web/administracion/vista-administradores.js';
import { TEXTOS_ADMINISTRADORES as CA } from '../../web/idiomas/ca/panel-administradores.js';
import { TEXTOS_ADMINISTRADORES as ES } from '../../web/idiomas/es/panel-administradores.js';
import { navegador } from '../web-controles/ayudas.js';
import { documento, Elemento, pulsar } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';

const INICIO = Date.parse('2026-11-23T09:00:00Z');
const CORRECTO = 200;
const CONFLICTO = 409;
const PASARELA = 502;
const PROHIBIDO = 403;

function dom(t: TestContext, idioma: 'es' | 'ca' = 'es') {
  navegador(t, {
    document: { createElement: (etiqueta: string) => new Elemento(etiqueta) },
    fetch: () => {
      throw new Error('La vista solo pide a través de la función que recibe');
    },
  });
  activarIdiomaPanel(idioma);
  t.after(() => activarIdiomaPanel());
  return new Elemento('div');
}
const html = (elemento: Elemento) => elemento as unknown as HTMLElement;
const fila = (parcial: Partial<Administrador> & { correo: string }): Administrador => ({
  estado: 'activo',
  anadidoPor: null,
  anadidoEn: INICIO,
  ultimaEntrada: null,
  segundoFactor: null,
  ...parcial,
});
const LISTA = {
  administradores: [
    fila({ correo: 'ana@faro.invalid', ultimaEntrada: INICIO, segundoFactor: true }),
    fila({ correo: 'berta@faro.invalid', estado: 'pendiente', anadidoPor: 'ana@faro.invalid' }),
    fila({ correo: 'carla@faro.invalid', estado: 'retirada-pendiente', anadidoPor: 'ana@faro.invalid' }),
  ],
  maximo: 50,
  sincronizacion: { estado: 'sin-configurar', falta: ['FARO_ADMIN_ACCESS_TOKEN'] },
};
/** Respuestas por ruta; cada petición queda anotada con su cuerpo. */
function panel(respuestas: Record<string, { estado: number; cuerpo: unknown }>) {
  const pedidos: [string, object][] = [];
  const pedir = async (ruta: string, cuerpo: object) => {
    pedidos.push([ruta, cuerpo]);
    const respuesta = respuestas[ruta];
    assert.ok(respuesta, `ruta inesperada: ${ruta}`);
    return respuesta;
  };
  return { pedir, pedidos };
}
/** La lista de ejemplo con el tipo que esperan el resumen y el CSV. */
const LISTA_TIPADA = LISTA as Parameters<typeof resumenDeLista>[0];
const leer = { 'administradores/leer': { estado: CORRECTO, cuerpo: LISTA } };

test('la lista muestra usuario, estado con icono y palabra, quién lo añadió, última entrada y la acción', async (t) => {
  const raiz = dom(t);
  const { pedir } = panel(leer);
  await montarAdministradores(html(raiz), { pedir, correoPropio: 'ana@faro.invalid' }).actualizar();
  const filas = raiz.querySelectorAll('.administradores-fila');
  assert.equal(filas.length, LISTA.administradores.length);
  const [ana, berta, carla] = filas.map((linea) => linea.textContent);
  assert.match(ana ?? '', /ana@faro\.invalid · tú.*Activo.*al instalar el servicio.*con segundo factor.*Retirar/);
  assert.match(berta ?? '', /Pendiente.*por ana@faro\.invalid.*Todavía no ha entrado/);
  assert.match(carla ?? '', /Retirada pendiente en Cloudflare.*Reintentar/);
  assert.equal(raiz.querySelectorAll('.administradores-icono').length, LISTA.administradores.length);
  assert.match(
    raiz.textContent,
    /La conexión con Cloudflare Access no está completa en la configuración del servicio.*pide a quien mantiene el servicio que la complete/,
  );
  const atencion = raiz.querySelector('.administradores-atencion');
  assert.equal(atencion?.getAttribute('data-requiere-atencion'), 'si');
  assert.match(atencion?.textContent ?? '', /^Requiere atención: carla@faro\.invalid ya no puede entrar/);
  // El resumen va en la barra de órdenes del apartado, no dentro de la tarjeta.
  assert.doesNotMatch(raiz.textContent, /invitación pendiente/u);
});

test('la barra de órdenes resume total y pendientes en singular o plural y en los dos idiomas', (t) => {
  dom(t);
  assert.equal(resumenDeLista(LISTA_TIPADA), '3 administradores · 1 invitación pendiente');
  const una = { ...LISTA_TIPADA, administradores: LISTA_TIPADA.administradores.slice(0, 1) };
  assert.equal(resumenDeLista(una), '1 administrador · 0 invitaciones pendientes');
  activarIdiomaPanel('ca');
  assert.equal(resumenDeLista(LISTA_TIPADA), '3 administradors · 1 invitació pendent');
});

test('«Exportar CSV» lleva usuario, estado, añadido por, fecha, última entrada y segundo factor', (t) => {
  dom(t);
  const lineas = csvDeLista(LISTA_TIPADA)
    .replace(/^\uFEFF/u, '')
    .trimEnd()
    .split('\r\n');
  assert.equal(lineas[0], 'Usuario;Estado;Añadido por;Fecha de alta;Última entrada;Segundo factor');
  assert.equal(lineas.length, LISTA.administradores.length + 1);
  assert.match(lineas[1] ?? '', /^ana@faro\.invalid;Activo;al instalar el servicio;[^;]+;[^;]+;Sí$/u);
  assert.match(lineas[2] ?? '', /^berta@faro\.invalid;Pendiente;ana@faro\.invalid;[^;]+;;$/u);
  assert.ok(csvDeLista(LISTA_TIPADA).startsWith('\uFEFF'));
});

test('lista vacía: avisa de que basta Access y pide empezar por el correo propio', async (t) => {
  const raiz = dom(t);
  const vacia = { ...LISTA, administradores: [], sincronizacion: { estado: 'configurada' } };
  const { pedir } = panel({ 'administradores/leer': { estado: CORRECTO, cuerpo: vacia } });
  await montarAdministradores(html(raiz), { pedir }).actualizar();
  assert.match(raiz.textContent, /Todavía no hay administradores en la lista.*Añade primero tu correo/);
  assert.equal(raiz.querySelector('.administradores-aviso-sin-configurar'), null);
});

test('añadir envía el correo escrito y cuenta en una frase lo que pasó', async (t) => {
  const raiz = dom(t);
  const { pedir, pedidos } = panel({
    ...leer,
    'administradores/anadir': { estado: PASARELA, cuerpo: { error: 'cloudflare_no_disponible' } },
  });
  await montarAdministradores(html(raiz), { pedir }).actualizar();
  const campo = raiz.querySelector('.administradores-alta-correo') as unknown as { value: string };
  campo.value = '  dani@faro.invalid ';
  pulsar(raiz.querySelector('.administradores-alta-enviar') as Elemento);
  await turno();
  assert.deepEqual(pedidos.at(-1), ['administradores/anadir', { correo: 'dani@faro.invalid' }]);
  const mensaje = raiz.querySelector('.administradores-mensaje');
  assert.match(mensaje?.textContent ?? '', /^Cloudflare Access no ha confirmado el alta, así que no se ha añadido\./);
  assert.equal(mensaje?.getAttribute('role'), 'status');
  assert.equal(mensaje?.getAttribute('data-resultado'), 'atencion');
});

test('retirar y reintentar van por su fila; un rechazo dice qué hacer', async (t) => {
  const raiz = dom(t);
  const { pedir, pedidos } = panel({
    ...leer,
    'administradores/retirar': { estado: CONFLICTO, cuerpo: { error: 'ultimo_activo' } },
    'administradores/reintentar': { estado: CORRECTO, cuerpo: { ...LISTA, cloudflare: 'fallida' } },
  });
  await montarAdministradores(html(raiz), { pedir }).actualizar();
  pulsar(raiz.querySelectorAll('.administradores-retirar')[0] as Elemento);
  pulsar(raiz.querySelector('.administradores-confirmar-retirada') as Elemento);
  await turno();
  assert.deepEqual(pedidos.at(-1), ['administradores/retirar', { correo: 'ana@faro.invalid' }]);
  assert.match(raiz.textContent, /No se puede retirar al último administrador activo\. Añade antes a otra persona/);
  // Tras el rechazo, la fila vuelve a su botón «Retirar» y el foco también.
  assert.equal(raiz.querySelector('.administradores-confirmacion'), null);
  assert.equal(documento.activeElement, raiz.querySelectorAll('.administradores-retirar')[0]);
  pulsar(raiz.querySelector('.administradores-reintentar') as Elemento);
  await turno();
  assert.deepEqual(pedidos.at(-1), ['administradores/reintentar', { correo: 'carla@faro.invalid' }]);
  assert.match(raiz.textContent, /Cloudflare Access no ha respondido\. Puedes reintentarlo desde su fila\./);
});

/** Monta la lista de ejemplo y pulsa «Retirar» en la fila del correo dado; devuelve la fila y lo pedido. */
async function abrirConfirmacion(t: TestContext, correo: string, idioma: 'es' | 'ca' = 'es') {
  const raiz = dom(t, idioma);
  const lista = { ...LISTA, sincronizacion: { estado: 'configurada' } };
  const { pedir, pedidos } = panel({
    'administradores/leer': { estado: CORRECTO, cuerpo: lista },
    'administradores/retirar': { estado: CORRECTO, cuerpo: lista },
  });
  await montarAdministradores(html(raiz), { pedir }).actualizar();
  const linea = raiz.querySelectorAll('.administradores-fila').find((f) => f.getAttribute('data-correo') === correo);
  assert.ok(linea, `falta la fila de ${correo}`);
  const retirar = linea.querySelector('.administradores-retirar') as Elemento;
  pulsar(retirar);
  await turno();
  return { raiz, linea, retirar, pedidos };
}
const tecla = (elemento: Elemento, key: string) => elemento.dispatchEvent(Object.assign(new Event('keydown'), { key }));

test('«Retirar» no envía nada: la fila pregunta y deja el foco en «Cancelar»', async (t) => {
  const { linea, pedidos } = await abrirConfirmacion(t, 'ana@faro.invalid');
  assert.deepEqual(pedidos, [['administradores/leer', {}]]);
  const confirmacion = linea.querySelector('.administradores-confirmacion');
  assert.ok(confirmacion, 'la confirmación va dentro de la propia fila');
  assert.equal(confirmacion.getAttribute('role'), 'group');
  const pregunta = '¿Retirar a ana@faro.invalid? Este usuario dejará de poder entrar al Panel de Control.';
  assert.equal(linea.querySelector('.administradores-confirmacion-pregunta')?.textContent, pregunta);
  assert.equal(confirmacion.getAttribute('aria-label'), pregunta);
  assert.equal(linea.querySelector('.administradores-celda-confirmacion')?.getAttribute('colspan'), '5');
  const confirmar = linea.querySelector('.administradores-confirmar-retirada');
  const cancelar = linea.querySelector('.administradores-cancelar-retirada');
  assert.equal(confirmar?.textContent, 'Confirmar');
  assert.equal(confirmar?.getAttribute('aria-label'), 'Confirmar la retirada de ana@faro.invalid');
  assert.equal(cancelar?.textContent, 'Cancelar');
  assert.equal(cancelar?.getAttribute('aria-label'), 'Cancelar la retirada de ana@faro.invalid');
  assert.equal(documento.activeElement, cancelar);
  assert.equal(linea.querySelector('.administradores-retirar'), null);
});

test('una invitación pendiente se confirma con su propia pregunta', async (t) => {
  const { linea, pedidos } = await abrirConfirmacion(t, 'berta@faro.invalid');
  assert.equal(pedidos.length, 1);
  assert.equal(
    linea.querySelector('.administradores-confirmacion-pregunta')?.textContent,
    '¿Retirar la invitación de berta@faro.invalid? Este usuario no podrá entrar al Panel de Control.',
  );
});

test('«Cancelar» y Escape devuelven la fila como estaba, con el foco en «Retirar» y sin petición', async (t) => {
  const { linea, retirar, pedidos } = await abrirConfirmacion(t, 'ana@faro.invalid');
  pulsar(linea.querySelector('.administradores-cancelar-retirada') as Elemento);
  await turno();
  assert.equal(linea.querySelector('.administradores-confirmacion'), null);
  assert.equal(linea.querySelector('.administradores-retirar'), retirar);
  assert.equal(documento.activeElement, retirar);
  pulsar(retirar);
  const confirmacion = linea.querySelector('.administradores-confirmacion') as Elemento;
  tecla(confirmacion, 'Enter');
  assert.ok(linea.querySelector('.administradores-confirmacion'), 'solo Escape cancela');
  tecla(confirmacion, 'Escape');
  await turno();
  assert.equal(linea.querySelector('.administradores-confirmacion'), null);
  assert.equal(documento.activeElement, retirar);
  assert.match(linea.textContent, /Retirar$/);
  assert.deepEqual(pedidos, [['administradores/leer', {}]]);
});

test('«Confirmar» envía una sola retirada aunque se pulse dos veces', async (t) => {
  const { raiz, linea, pedidos } = await abrirConfirmacion(t, 'ana@faro.invalid');
  const confirmar = linea.querySelector('.administradores-confirmar-retirada') as Elemento;
  pulsar(confirmar);
  pulsar(confirmar);
  await turno();
  const retiradas = pedidos.filter(([ruta]) => ruta === 'administradores/retirar');
  assert.deepEqual(retiradas, [['administradores/retirar', { correo: 'ana@faro.invalid' }]]);
  assert.match(raiz.textContent, /Administrador retirado\. Ya no puede entrar en el Panel de Control\./);
});

test('la confirmación en catalán', async (t) => {
  const { linea } = await abrirConfirmacion(t, 'ana@faro.invalid', 'ca');
  assert.equal(
    linea.querySelector('.administradores-confirmacion-pregunta')?.textContent,
    'Vols retirar ana@faro.invalid? Aquest usuari ja no podrà entrar al Tauler de Control.',
  );
  const confirmar = linea.querySelector('.administradores-confirmar-retirada');
  const cancelar = linea.querySelector('.administradores-cancelar-retirada');
  assert.equal(confirmar?.textContent, 'Confirmar');
  assert.equal(confirmar?.getAttribute('aria-label'), 'Confirmar la retirada de ana@faro.invalid');
  assert.equal(cancelar?.textContent, 'Cancel·lar');
  assert.equal(cancelar?.getAttribute('aria-label'), 'Cancel·lar la retirada de ana@faro.invalid');
  pulsar(cancelar as Elemento);
  pulsar(tablaDe(linea).querySelectorAll('.administradores-retirar')[1] as Elemento);
  assert.equal(
    tablaDe(linea).querySelector('.administradores-confirmacion-pregunta')?.textContent,
    'Vols retirar la invitació de berta@faro.invalid? Aquest usuari no podrà entrar al Tauler de Control.',
  );
});
/** La tabla que contiene una fila, para buscar en las demás filas. */
const tablaDe = (linea: Elemento) => linea.closest('.administradores-tabla') as Elemento;

test('en catalán, con la misma estructura y los mismos datos', async (t) => {
  const raiz = dom(t, 'ca');
  const { pedir } = panel(leer);
  await montarAdministradores(html(raiz), { pedir, correoPropio: 'ana@faro.invalid' }).actualizar();
  const [ana, berta, carla] = raiz.querySelectorAll('.administradores-fila').map((linea) => linea.textContent);
  assert.match(ana ?? '', /ana@faro\.invalid · tu.*Actiu.*en instal·lar el servei.*amb segon factor.*Retirar/);
  assert.match(berta ?? '', /Pendent.*per ana@faro\.invalid.*Encara no hi ha entrat/);
  assert.match(carla ?? '', /Retirada pendent a Cloudflare.*Tornar a provar/);
  assert.match(raiz.textContent, /Requereix atenció: carla@faro\.invalid/);
});

test('sin permiso: la página dice qué pasa y qué hacer, en los dos idiomas', (t) => {
  const raiz = dom(t);
  pintarSinPermiso(html(raiz), { error: 'no_es_administrador' });
  assert.equal(
    raiz.querySelector('.administradores-sin-permiso-texto')?.textContent,
    'Tu correo no figura como administrador de este Panel de Control. Pide a un administrador que te añada.',
  );
  pintarSinPermiso(html(raiz), { error: 'segundo_factor_requerido' });
  assert.match(raiz.textContent, /tienes que registrar un segundo factor/);
  activarIdiomaPanel('ca');
  pintarSinPermiso(html(raiz), { error: 'no_es_administrador' });
  assert.match(raiz.textContent, /^No pots entrar al Tauler de Control.*no consta com a administrador/);
  pintarSinPermiso(html(raiz), { error: 'desconocido', estado: PROHIBIDO });
  assert.match(raiz.textContent, /No s’ha pogut completar ara/);
});

test('los dos diccionarios tienen las mismas claves y ninguna vacía', () => {
  assert.deepEqual(Object.keys(CA).sort(), Object.keys(ES).sort());
  for (const valor of [...Object.values(ES), ...Object.values(CA)]) {
    assert.ok(typeof valor === 'string' && valor.trim().length > 0);
  }
});
