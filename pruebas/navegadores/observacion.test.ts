/** La excepción nativa no permite ocultar estilos explícitos ni otras guardias del ensayo. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { BrowserContext } from 'playwright-core';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { type EntornoObservacion, type EventoCsp, esAvisoSelectWebKit } from './csp-panel.ts';
import { comprobarConsolaDeFormacion, type MensajeDeConsola } from './formacion.ts';
import { comprobarObservacion, observar } from './observacion.ts';

const LINEAS_SELECT_PANEL = {
  minima: 1,
  api: 52,
  conexion: 91,
  accion: 160,
  privacidad: 183,
  coste: 190,
  rotacion: 236,
};
const LINEA_FRACCIONARIA = 1.5;
const LINEAS_INVALIDAS = [
  undefined,
  null,
  '52',
  0,
  -1,
  LINEA_FRACCIONARIA,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_VALUE,
];
const ORIGEN = 'http://127.0.0.1:12345';

test('la consola conserva y reconoce el diagnóstico de teclado de WebKitGTK solo al abrir el recorrido', () => {
  const aviso: MensajeDeConsola = {
    fase: 'conectada',
    tipo: 'error',
    texto: 'Viewport argument key "interactive-widget" not recognized and ignored.',
    url: `${ORIGEN}/recorrido.html`,
  };
  assert.deepEqual(comprobarConsolaDeFormacion([aviso], ORIGEN, 'webkit', 'linux'), [aviso]);
  for (const otro of [
    { ...aviso, fase: 'sin-red' as const },
    { ...aviso, tipo: 'warning' },
    { ...aviso, texto: 'Viewport argument key "width" not recognized and ignored.' },
    { ...aviso, url: `${ORIGEN}/inicio.html` },
    { ...aviso, url: `${aviso.url}?externa=1` },
    { ...aviso, url: 'https://otro.invalid/recorrido.html' },
  ]) {
    assert.throws(() => comprobarConsolaDeFormacion([otro], ORIGEN, 'webkit', 'linux'), /errores en la consola/);
  }
  assert.throws(() => comprobarConsolaDeFormacion([aviso], ORIGEN, 'chromium', 'linux'), /errores en la consola/);
  assert.throws(() => comprobarConsolaDeFormacion([aviso], ORIGEN, 'webkit', 'darwin'), /errores en la consola/);
});

const ENTORNO: EntornoObservacion = { motor: 'webkit', contexto: 'panel', origen: ORIGEN };
const AVISO: EventoCsp = {
  directiva: 'style-src-attr',
  recurso: 'inline',
  muestra: 'text-overflow:inherit',
  documento: `${ORIGEN}/administracion`,
  elemento: 'SELECT',
  estilo: null,
  fuente: '',
  linea: 1,
  columna: 1,
  confiable: true,
};
function caso() {
  const fixture = {
    origen: ORIGEN,
    errores: [] as string[],
    peticiones: [{ ruta: '/administracion', metodo: 'GET', ua: IDENTIDAD_WEB['User-Agent'] }],
  };
  const contexto = new EventEmitter() as unknown as BrowserContext;
  return { fixture, registro: observar(contexto, fixture, ENTORNO) };
}

test('solo admite la firma nativa exacta en las dos rutas canónicas del panel WebKit', () => {
  for (const documento of [`${ORIGEN}/administracion`, `${ORIGEN}/administracion/`]) {
    const evento = { ...AVISO, documento };
    assert.equal(esAvisoSelectWebKit(evento, ENTORNO), true);
    const { registro, fixture } = caso();
    registro.csp.push(evento);
    comprobarObservacion(registro, fixture);
    assert.deepEqual(registro.csp, [evento], 'El registro crudo conserva el aviso');
  }
});

test('la línea conserva la posición del SELECT en documentos multilínea', () => {
  for (const linea of Object.values(LINEAS_SELECT_PANEL)) {
    const { registro, fixture } = caso();
    const evento = { ...AVISO, linea };
    registro.csp.push(evento);
    comprobarObservacion(registro, fixture);
    assert.deepEqual(registro.csp, [evento]);
  }
});

test('SELECT dinámico solo admite el módulo local reproducido y una posición positiva', () => {
  const fuente = `${ORIGEN}/administracion/vista-datos.js`;
  const dinamico = { ...AVISO, fuente, linea: 364, columna: 42 };
  const { registro, fixture } = caso();
  registro.csp.push(dinamico);
  comprobarObservacion(registro, fixture);
  assert.deepEqual(registro.csp, [dinamico], 'Conserva el evento crudo con fuente y posición');
  for (const cambio of [
    { fuente: `${ORIGEN}/administracion/panel.js` },
    { fuente: `${fuente}?x=1` },
    { fuente: `${fuente}#x` },
    { fuente: 'https://otro.example/administracion/vista-datos.js' },
    { elemento: 'P' },
    { estilo: 'text-overflow:inherit' },
    { estilo: '' },
    { muestra: 'color:red' },
    { confiable: false },
    ...LINEAS_INVALIDAS.flatMap((valor) => [{ linea: valor }, { columna: valor }]),
  ]) {
    assert.equal(esAvisoSelectWebKit({ ...dinamico, ...cambio }, ENTORNO), false);
  }
});

test('una línea ausente, no numérica o que no sea un entero positivo sigue bloqueando la guardia', () => {
  for (const linea of LINEAS_INVALIDAS) {
    const { registro, fixture } = caso();
    registro.csp.push({ ...AVISO, linea });
    assert.throws(() => comprobarObservacion(registro, fixture), /La CSP bloqueó un recurso/);
  }
});

test('otro motor, contexto u origen nunca recibe la excepción', () => {
  for (const cambio of [
    { motor: 'chromium' },
    { motor: 'firefox' },
    { contexto: 'recorrido' },
    { origen: 'http://127.0.0.1:54321' },
  ] as const) {
    const { registro, fixture } = caso();
    registro.entorno = { ...ENTORNO, ...cambio };
    registro.csp.push(AVISO);
    assert.throws(() => comprobarObservacion(registro, fixture), /La CSP bloqueó un recurso/);
  }
});

test('cualquier diferencia de documento, elemento, estilo o firma sigue bloqueando la guardia', () => {
  const cambios: Partial<EventoCsp>[] = [
    { documento: `${ORIGEN}/recorrido.html` },
    { documento: `${ORIGEN}/administracion/index.html` },
    { documento: `${ORIGEN}/administracion?x=1` },
    { documento: `${ORIGEN}/administracion#x` },
    { documento: 'https://otro.example/administracion' },
    { directiva: 'style-src' },
    { recurso: 'https://otro.example/estilo.css' },
    { muestra: '' },
    { muestra: 'color:red' },
    { elemento: 'P' },
    { elemento: null },
    { estilo: 'text-overflow:inherit' },
    { estilo: '' },
    { fuente: `${ORIGEN}/administracion/panel.js` },
    { linea: 0 },
    { columna: 0 },
    { confiable: false },
  ];
  for (const cambio of cambios) {
    const { registro, fixture } = caso();
    registro.csp.push({ ...AVISO, ...cambio });
    assert.throws(() => comprobarObservacion(registro, fixture), /La CSP bloqueó un recurso/);
  }
  for (const evento of [null, undefined, {}, [], 'style-src-attr']) {
    assert.equal(esAvisoSelectWebKit(evento, ENTORNO), false);
  }
});

test('el aviso conocido no oculta otro bloqueo CSP ni errores de las guardias existentes', () => {
  const alteraciones = [
    ({ registro }: ReturnType<typeof caso>) => registro.csp.push({ ...AVISO, muestra: 'color:red' }),
    ({ registro }: ReturnType<typeof caso>) => registro.erroresPagina.push('Error del motor'),
    ({ registro }: ReturnType<typeof caso>) => registro.eventosDom.push({ tipo: 'error' }),
    ({ registro }: ReturnType<typeof caso>) => registro.externas.push('https://otro.example/'),
    ({ registro }: ReturnType<typeof caso>) => registro.apiPost.push('/api/consulta'),
    ({ fixture }: ReturnType<typeof caso>) => fixture.errores.push('Error del transporte'),
    ({ fixture }: ReturnType<typeof caso>) => fixture.peticiones.splice(0),
    ({ fixture }: ReturnType<typeof caso>) => {
      fixture.peticiones[0] = { ruta: '/administracion', metodo: 'GET', ua: 'Otro' };
    },
  ];
  for (const alterar of alteraciones) {
    const prueba = caso();
    prueba.registro.csp.push(AVISO);
    alterar(prueba);
    assert.throws(() => comprobarObservacion(prueba.registro, prueba.fixture));
  }
});

/** La violación que provoca la sonda de Trusted Types, tal como la registran Chromium, Firefox y WebKit. */
const SONDA = {
  directiva: 'require-trusted-types-for',
  recurso: 'trusted-types-sink',
  muestra: 'Worker constructor|/scripts/motor-local/worker.js',
  documento: `${ORIGEN}/recorrido.html`,
};
const VISTA_DE_LA_SONDA = { ...SONDA, elemento: null, estilo: null, fuente: '', linea: 3, columna: 5, confiable: true };

test('la violación provocada por la sonda se acepta exactamente una vez y con su firma', () => {
  const { registro, fixture } = caso();
  registro.csp.push(VISTA_DE_LA_SONDA);
  comprobarObservacion(registro, fixture, [SONDA]);
  assert.deepEqual(registro.csp, [VISTA_DE_LA_SONDA], 'El registro crudo la conserva');
});

test('sin el aviso de la sonda, o con él dos veces, la observación falla', () => {
  const sinAviso = caso();
  assert.throws(() => comprobarObservacion(sinAviso.registro, sinAviso.fixture, [SONDA]), /una sola vez/);
  const doble = caso();
  doble.registro.csp.push(VISTA_DE_LA_SONDA, { ...VISTA_DE_LA_SONDA, linea: 9 });
  assert.throws(() => comprobarObservacion(doble.registro, doble.fixture, [SONDA]), /una sola vez/);
});

test('cualquier otra violación de CSP o de Trusted Types sigue fallando junto a la de la sonda', () => {
  const otras = [
    { ...VISTA_DE_LA_SONDA, muestra: 'Worker constructor|/scripts/otro.js' },
    { ...VISTA_DE_LA_SONDA, muestra: 'Element innerHTML|<b>' },
    { ...VISTA_DE_LA_SONDA, documento: `${ORIGEN}/inicio.html` },
    { ...VISTA_DE_LA_SONDA, directiva: 'img-src', recurso: `${ORIGEN}/favicon.ico`, muestra: '' },
  ];
  for (const otra of otras) {
    const { registro, fixture } = caso();
    registro.csp.push(VISTA_DE_LA_SONDA, otra);
    assert.throws(() => comprobarObservacion(registro, fixture, [SONDA]), /La CSP bloqueó un recurso/);
  }
  const sinDeclarar = caso();
  sinDeclarar.registro.csp.push(VISTA_DE_LA_SONDA);
  assert.throws(() => comprobarObservacion(sinDeclarar.registro, sinDeclarar.fixture), /La CSP bloqueó un recurso/);
});
