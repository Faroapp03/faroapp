import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { aBase64Url, deBase64Url } from '../../web/scripts/base64url.js';
import type { Resultado } from '../../web/scripts/otro-dispositivo/formato.js';
import {
  CodigoNoValido,
  codificar,
  codigoDelFragmento,
  comprobarFecha,
  crc16,
  decodificar,
  enlaceConCodigo,
  MAX_LETRAS_DEL_CODIGO,
  MAX_TAREAS,
} from '../../web/scripts/otro-dispositivo/formato.js';
import { cuerpoDelResultado } from '../../web/scripts/otro-dispositivo/recibir.js';
import { nuevaTarea } from '../../web/scripts/recorrido/estado.js';
import { navegador } from '../web-controles/ayudas.js';

// dialogo usa el idioma de la página al cargar; se restaura el global inmediatamente tras evaluar el módulo.
const documentoAntes = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { documentElement: { lang: 'es', dataset: {} } },
});
const { dibujoDelQr, resultadoDelRecorrido } = await import('../../web/scripts/otro-dispositivo/dialogo.js');
if (documentoAntes) {
  Object.defineProperty(globalThis, 'document', documentoAntes);
} else {
  Reflect.deleteProperty(globalThis, 'document');
}

const FECHA = '2026-10-14';
const CRC_VECTOR_CCITT_FALSE = 0x29b1;
const BANDERA_AJENA = 0x80;
const BASE: Resultado = {
  idioma: 'ca',
  isco08: '4226',
  ocupacionEsco: '4226.1.1',
  isco08Secundario: '4229',
  grupoPropuestoPorIa: true,
  fecha: FECHA,
  tareas: [
    { tareaOit: '4226-1', tiempo: 'mucho' },
    { tareaOit: '4229-3', tiempo: 'poco' },
  ],
  sinViajar: 1,
};
const MAXIMO: Resultado = {
  ...BASE,
  ocupacionEsco: '4226.999.999.999.999',
  sinIa: true,
  sinViajar: 0,
  tareas: Array.from({ length: MAX_TAREAS }, (_, i) => ({ tareaOit: `4226-${i + 1}`, tiempo: 'algo' })),
};
const FICHAS = new Map([
  [
    '4226',
    { tareas: [{ id: '4226-1', texto_es: 'Atender', texto_ca: 'Atendre' }], ocupaciones: [{ esco: '4226.1.1' }] },
  ],
  ['4229', { tareas: [{ id: '4229-3', texto_es: 'Informar' }], ocupaciones: [] }],
]);

function conSuma(cuerpo: Uint8Array): string {
  const suma = crc16(cuerpo);
  const byte = 256;
  return aBase64Url(Uint8Array.from([...cuerpo, Math.floor(suma / byte), suma % byte]));
}

test('base64url conserva bytes de vistas y rechaza alfabeto/longitud incorrectos', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (const vista of [bytes, bytes.subarray(1, -1), bytes.subarray(0, 0)]) {
    assert.deepEqual(deBase64Url(aBase64Url(vista)), vista);
  }
  for (const ajeno of ['A', '%%%%', 'AA=', 'AA AA']) {
    assert.equal(deBase64Url(ajeno), null);
  }
});

test('resultado mínimo/completo/máximo conserva campos y límites binarios, con CRC conocido independiente', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), CRC_VECTOR_CCITT_FALSE);
  for (const original of [BASE, MAXIMO, { ...BASE, tareas: [], sinViajar: 1 }]) {
    const codigo = codificar(original);
    assert.ok(codigo.length < MAX_LETRAS_DEL_CODIGO);
    assert.deepEqual(decodificar(codigo), original);
  }
});

test('rechaza cada corte, CRC dañado, versión/banderas ajenas y bytes sobrantes incluso con CRC recalculado', () => {
  const codigo = codificar(BASE);
  for (let i = 0; i < codigo.length; i++) {
    assert.throws(() => decodificar(codigo.slice(0, i)), CodigoNoValido);
  }
  const bytes = deBase64Url(codigo);
  assert.ok(bytes);
  const cuerpo = bytes.slice(0, -2);
  for (const ajeno of [Uint8Array.from([2, ...cuerpo.slice(1)]), Uint8Array.from([...cuerpo, 0])]) {
    assert.throws(() => decodificar(conSuma(ajeno)), CodigoNoValido);
  }
  cuerpo[1] = BANDERA_AJENA;
  assert.throws(() => decodificar(conSuma(cuerpo)), CodigoNoValido);
  assert.throws(() => decodificar(aBase64Url(Uint8Array.from([...bytes, 0]))), CodigoNoValido);
});

test('fecha creíble, combinaciones de grupos, tiempo, repeticiones y límite conjunto se validan', () => {
  for (const fecha of ['2026-10-01', FECHA, '2026-10-15']) {
    assert.doesNotThrow(() => comprobarFecha({ ...BASE, fecha }, new Date(`${FECHA}T12:00:00Z`)));
  }
  for (const fecha of ['2026-09-30', '2026-10-16']) {
    assert.throws(() => comprobarFecha({ ...BASE, fecha }, new Date(`${FECHA}T12:00:00Z`)), CodigoNoValido);
  }
  for (const original of [
    { ...BASE, isco08Secundario: BASE.isco08 },
    { ...BASE, fecha: '2026-02-30' },
    { ...BASE, ocupacionEsco: '4226.01' },
    { ...BASE, tareas: [BASE.tareas[0], BASE.tareas[0]] },
    { ...MAXIMO, sinViajar: 1 },
  ]) {
    assert.throws(() => codificar(original as Resultado), CodigoNoValido);
  }
});

test('reconstrucción local solo usa texto oficial del paquete y rechaza ocupación/tarea ajenas', () => {
  const cuerpo = cuerpoDelResultado(BASE, FICHAS);
  assert.deepEqual(
    cuerpo.tareas.map((x) => [x.texto, x.tiempo, x.referencia?.tareaOit]),
    [
      ['Atendre', 'mucho', '4226-1'],
      ['Informar', 'poco', '4229-3'],
    ],
  );
  assert.equal('ocupacionPersona' in cuerpo, false);
  assert.throws(() => cuerpoDelResultado({ ...BASE, ocupacionEsco: '4229.1' }, FICHAS), CodigoNoValido);
  assert.throws(
    () => cuerpoDelResultado({ ...BASE, tareas: [{ tareaOit: '4226-99', tiempo: 'algo' }] }, FICHAS),
    CodigoNoValido,
  );
});

test('QR usa SVG geométrico y no transporta palabra, texto libre ni estimación; tercero íntegro MIT', () => {
  const resultado = resultadoDelRecorrido(
    { isco08: '4226', esco: null, isco08Secundario: null },
    [
      { ...nuevaTarea('Texto ficticio personal'), oficial: '4226-1', tiempo: 'algo' },
      { ...nuevaTarea('Otra tarea ficticia sin referencia'), tiempo: 'poco' },
    ],
    { idioma: 'es', fecha: FECHA },
  );
  assert.deepEqual(resultado.tareas, [{ tareaOit: '4226-1', tiempo: 'algo' }]);
  assert.equal(resultado.sinViajar, 1);
  const enlace = enlaceConCodigo('https://ensayo.invalid/Año%202026/inicio.html?x=1', codificar(resultado));
  assert.equal(new URL(enlace).search, '');
  assert.deepEqual(decodificar(codigoDelFragmento(new URL(enlace).hash) ?? ''), resultado);
  const dibujo = dibujoDelQr(enlace);
  assert.ok(dibujo.lado > 0);
  assert.match(dibujo.trazado, /^(M\d+ \d+h1v1h-1z)+$/);
  const qr = readFileSync(new URL('../../web/terceros/qrcode-generator/qrcode.js', import.meta.url));
  assert.equal(
    createHash('sha256').update(qr).digest('hex'),
    'ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0',
  );
  assert.match(
    readFileSync(new URL('../../web/terceros/qrcode-generator/LICENSE', import.meta.url), 'utf8'),
    /MIT License/,
  );
});

test('una tarea oficial sin tiempo no viaja con un tiempo que la persona no ha dado', () => {
  const sinTiempo = { ...nuevaTarea('Texto ficticio personal'), oficial: '4226-1' };
  assert.equal(sinTiempo.tiempo, null);
  assert.throws(
    () =>
      resultadoDelRecorrido({ isco08: '4226', esco: null, isco08Secundario: null }, [sinTiempo], {
        idioma: 'es',
        fecha: FECHA,
      }),
    TypeError,
  );
});

test('el fragmento se retira antes de arrancar; conserva consulta/estado, no crea historial nuevo', async (t) => {
  const llamadas: unknown[][] = [];
  const location = { hash: '#pasar=ABC', pathname: '/Año%202026/recorrido.html', search: '?idioma=ca' };
  navegador(t, {
    location,
    history: { state: { local: true }, replaceState: (...args: unknown[]) => llamadas.push(args) },
  });
  const modulo = await import('../../web/scripts/otro-dispositivo/fragmento.js');
  assert.equal(modulo.codigoRecibido, 'ABC');
  assert.deepEqual(llamadas, [[{ local: true }, '', `${location.pathname}${location.search}`]]);
  location.hash = '#otro';
  assert.equal(modulo.tomarCodigoDelFragmento(), null);
  assert.equal(llamadas.length, 1);
});

/** La copia del fragmento que publica cada extensión del registro, con su identificador. */
const FRAGMENTOS_DE_EXTENSIONES = EXTENSIONES.flatMap(({ id, publicacionesComunes }) => {
  const copia = publicacionesComunes['web/scripts/otro-dispositivo/fragmento.js'];
  return copia ? [[id, `../../${copia}?barrera-${id}`] as const] : [];
});

test('el fragmento transitorio se consume una vez en cada recorrido sin reponer URL', async (t) => {
  for (const [nombre, ruta] of [
    ['real', '../../web/scripts/otro-dispositivo/fragmento.js?barrera-real'] as const,
    ...FRAGMENTOS_DE_EXTENSIONES,
  ]) {
    const clave = Symbol.for('faro.fragmento.transitorio');
    const ventana: Record<symbol, unknown> = {};
    let entregas = 0;
    ventana[clave] = () => {
      entregas++;
      delete ventana[clave];
      return '#pasar=ABC';
    };
    const llamadas: unknown[][] = [];
    navegador(t, {
      window: ventana,
      location: { hash: '', pathname: '/recorrido.html', search: '' },
      history: { state: null, replaceState: (...args: unknown[]) => llamadas.push(args) },
    });
    const modulo = await import(ruta);
    assert.equal(modulo.codigoRecibido, 'ABC', nombre);
    assert.equal(entregas, 1, nombre);
    assert.equal(ventana[clave], undefined, nombre);
    assert.deepEqual(llamadas, [], nombre);
  }
});
