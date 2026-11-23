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
import { Elemento, pulsar } from '../web-informe-lectura/dom-doble.ts';
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
  await turno();
  assert.deepEqual(pedidos.at(-1), ['administradores/retirar', { correo: 'ana@faro.invalid' }]);
  assert.match(raiz.textContent, /No se puede retirar al último administrador activo\. Añade antes a otra persona/);
  pulsar(raiz.querySelector('.administradores-reintentar') as Elemento);
  await turno();
  assert.deepEqual(pedidos.at(-1), ['administradores/reintentar', { correo: 'carla@faro.invalid' }]);
  assert.match(raiz.textContent, /Cloudflare Access no ha respondido\. Puedes reintentarlo desde su fila\./);
});

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
