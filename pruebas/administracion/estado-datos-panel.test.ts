import assert from 'node:assert/strict';
import test from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { instantaneaSaludV4 } from '../ayudas/salud-datos.ts';

const LONGITUD_HUELLA = 64;
const HUELLA_HEX = 'a'.repeat(LONGITUD_HUELLA);
const AHORA = '2026-10-16T14:20:00Z';
const MAXIMO_REGISTROS = 64;
const CLAVE_HASTA_V4 = 'formacionAbiertaCaduca';
const CLAVE_DESDE_V5 = 'formacionAbiertaRevisionPendiente';
const VERSION_CATALOGO = 4;
const VERSION_REVISION_PENDIENTE = 5;
const VERSION_INEXISTENTE = 6;
/** Copia de un documento con una clave renombrada en su sitio: así se pasa de una versión del contrato a la otra. */
function renombrada(entrada: object, de: string, a: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entrada).map(([clave, valor]) => [clave === de ? a : clave, valor]));
}
function documento() {
  return {
    version: 1,
    observadoEn: AHORA,
    fuentes: [{ id: 'consorci', politica: 'mensual', fecha: '2024-02-29', plazoDias: 0 }],
    modulos: ['consorci', 'paquete'].map((id) => ({
      id,
      ultimoIntento: AHORA,
      veredicto: 'verde',
      ultimaVersionBuena: { fecha: AHORA, huella: HUELLA_HEX },
      fallos: 0,
      proximoReintento: null,
    })),
    formacionAbiertaCaduca: null,
  };
}
test('DTO devuelve copia profunda congelada y conserva valores/orden sin información técnica', () => {
  const entrada = documento();
  const copia = leerEstadoDatosPanel(entrada);
  assert.deepEqual(copia, entrada);
  assert.equal(JSON.stringify(copia), JSON.stringify(entrada));
  assert.equal(Object.hasOwn(copia, 'comprobaciones'), false);
  assert.equal(Object.hasOwn(copia.fuentes[0] ?? {}, 'ultimaOperacion'), false);
  assert.notEqual(copia, entrada);
  assert.notEqual(copia.fuentes, entrada.fuentes);
  assert.notEqual(copia.modulos[0]?.ultimaVersionBuena, entrada.modulos[0]?.ultimaVersionBuena);
  for (const valor of [
    copia,
    copia.fuentes,
    copia.fuentes[0],
    copia.modulos,
    copia.modulos[0],
    copia.modulos[0]?.ultimaVersionBuena,
  ]) {
    assert.equal(Object.isFrozen(valor), true);
  }
  const primera = entrada.fuentes[0];
  assert.ok(primera);
  primera.fecha = '2020-01-01';
  assert.equal(copia.fuentes[0]?.fecha, '2024-02-29');
});
test('v5 publica la revisión pendiente con su nombre fiel; v4 y anteriores se siguen leyendo con el suyo', () => {
  const v4 = instantaneaSaludV4({ formacionAbiertaCaduca: '2026-11-01' });
  const v5 = { ...renombrada(v4, CLAVE_HASTA_V4, CLAVE_DESDE_V5), version: VERSION_REVISION_PENDIENTE };
  const leidaV4 = leerEstadoDatosPanel(v4);
  assert.deepEqual(leidaV4, v4);
  const leidaV5 = leerEstadoDatosPanel(v5);
  assert.ok(leidaV5.version === VERSION_REVISION_PENDIENTE);
  assert.equal(leidaV5.formacionAbiertaRevisionPendiente, '2026-11-01');
  assert.equal(Object.hasOwn(leidaV5, CLAVE_HASTA_V4), false);
  assert.deepEqual(leidaV5, v5);
  // Cada versión exige su nombre: ni la v5 admite el antiguo ni la v4 el nuevo, y nunca los dos a la vez.
  assert.throws(() => leerEstadoDatosPanel({ ...v4, version: VERSION_REVISION_PENDIENTE }));
  assert.throws(() => leerEstadoDatosPanel({ ...v5, version: VERSION_CATALOGO }));
  assert.throws(() => leerEstadoDatosPanel({ ...v5, [CLAVE_HASTA_V4]: null }));
  assert.throws(() => leerEstadoDatosPanel({ ...documento(), [CLAVE_DESDE_V5]: null }));
  assert.throws(() => leerEstadoDatosPanel({ ...v5, version: VERSION_INEXISTENTE }));
});
test('contrato cerrado rechaza tipos, políticas, números y contenido técnico añadido', () => {
  for (const cambios of [
    { version: 2 },
    { observadoEn: null },
    { fuentes: [] },
    { modulos: [] },
    { motivo: 'no copiar' },
    { informe: '/privado' },
    { formacionAbiertaCaduca: '' },
  ]) {
    assert.throws(() => leerEstadoDatosPanel({ ...documento(), ...cambios }));
  }
  for (const cambios of [
    { politica: 'manual-nueva' },
    { plazoDias: -1 },
    { plazoDias: 0.5 },
    { plazoDias: Number.POSITIVE_INFINITY },
    { fecha: 0 },
    { id: '../fuente' },
    { id: 'paquete' },
  ]) {
    const entrada = documento();
    assert.throws(() => leerEstadoDatosPanel({ ...entrada, fuentes: [{ ...entrada.fuentes[0], ...cambios }] }));
  }
  for (const cambios of [
    { veredicto: 'ambar' },
    { fallos: -1 },
    { fallos: Number.MAX_SAFE_INTEGER + 1 },
    { ultimaVersionBuena: { fecha: AHORA, huella: HUELLA_HEX.toUpperCase() } },
    { secreto: 'no-copiar' },
  ]) {
    const entrada = documento();
    assert.throws(() =>
      leerEstadoDatosPanel({ ...entrada, modulos: entrada.modulos.map((m) => ({ ...m, ...cambios })) }),
    );
  }
});
test('fechas deben ser reales y UTC explícita; no se normalizan días imposibles o zonas', () => {
  for (const fecha of ['2025-02-29', '2024-02-30', '2026-13-01', '0000-01-01', '2026-1-01', '2026-10-16T00:00:00Z']) {
    const entrada = documento();
    assert.throws(() => leerEstadoDatosPanel({ ...entrada, formacionAbiertaCaduca: fecha }));
  }
  for (const observadoEn of [
    '2026-02-30T10:20:00Z',
    '2026-10-16T24:00:00Z',
    '2026-10-16T14:20:60Z',
    '2026-10-16T14:20:00+00:00',
    '2026-10-16T14:20:00.000000Z',
    '2026-10-16',
    '0000-01-01T00:00:00Z',
  ]) {
    assert.throws(() => leerEstadoDatosPanel({ ...documento(), observadoEn }));
  }
});
test('IDs únicos acotados y módulos corresponden exactamente a fuentes más paquete', () => {
  const entrada = documento();
  for (const cambios of [
    { fuentes: [entrada.fuentes[0], entrada.fuentes[0]] },
    { modulos: [entrada.modulos[0], entrada.modulos[0]] },
    { modulos: [entrada.modulos[0]] },
    { modulos: [...entrada.modulos, { ...entrada.modulos[0], id: 'ajeno' }] },
    { fuentes: Array.from({ length: MAXIMO_REGISTROS + 1 }, () => entrada.fuentes[0]) },
    { fuentes: [{ ...entrada.fuentes[0], id: 'a'.repeat(MAXIMO_REGISTROS + 1) }] },
  ]) {
    assert.throws(() => leerEstadoDatosPanel({ ...entrada, ...cambios }));
  }
});
test('rechaza herencia, getters, símbolos, no enumerables y huecos sin ejecutar accesores', () => {
  let llamadas = 0;
  const entrada = documento();
  const getter = Object.defineProperty({ ...entrada }, 'observadoEn', {
    get: () => {
      llamadas++;
      return AHORA;
    },
    enumerable: true,
  });
  const oculta = Object.defineProperty({ ...entrada }, 'observadoEn', { value: AHORA, enumerable: false });
  const lista = [...entrada.fuentes];
  Object.defineProperty(lista, '0', {
    get: () => {
      llamadas++;
      return entrada.fuentes[0];
    },
    enumerable: true,
  });
  for (const valor of [
    getter,
    oculta,
    Object.create(entrada),
    { ...entrada, [Symbol()]: true },
    { ...entrada, fuentes: lista },
    { ...entrada, fuentes: new Array(1) },
  ]) {
    assert.throws(() => leerEstadoDatosPanel(valor));
  }
  assert.equal(llamadas, 0);
});

test('veredictos y fechas conservan las invariantes del productor sin imponer su política de espera', () => {
  const entrada = documento();
  const primera = entrada.modulos[0];
  assert.ok(primera);
  const validar = (cambios: Record<string, unknown>) =>
    leerEstadoDatosPanel({ ...entrada, modulos: [{ ...primera, ...cambios }, entrada.modulos[1]] });
  for (const cambios of [
    { veredicto: null },
    { ultimoIntento: null },
    { fallos: 1 },
    { proximoReintento: AHORA },
    { ultimoIntento: '2026-10-17T00:00:00Z' },
    { ultimaVersionBuena: { fecha: '2026-10-16T14:20:01Z', huella: HUELLA_HEX } },
    { veredicto: 'ámbar', fallos: 0 },
    { veredicto: 'rojo', fallos: 1 },
    { veredicto: 'rojo', fallos: 1, proximoReintento: AHORA },
    { veredicto: 'ámbar', fallos: 1, proximoReintento: '2026-10-15T00:00:00Z' },
  ]) {
    assert.throws(() => validar(cambios));
  }
  assert.doesNotThrow(() => validar({ veredicto: null, ultimoIntento: null, ultimaVersionBuena: null }));
  assert.doesNotThrow(() => validar({ veredicto: 'ámbar', fallos: 1, proximoReintento: '2026-10-16T14:20:01Z' }));
});

test('el paquete en ámbar o en rojo puede citar el código cerrado de su almacén de Cursos; sin él, forma anterior', () => {
  const entrada = documento();
  const [fuente, paquete] = entrada.modulos;
  assert.ok(fuente && paquete);
  const ambar = { ...paquete, veredicto: 'ámbar', fallos: 1, proximoReintento: '2026-10-16T14:20:01Z' };
  const leer = (filas: object[]) => leerEstadoDatosPanel({ ...entrada, modulos: filas });
  const leido = leer([fuente, { ...ambar, motivoAlmacen: 'almacen-ausente' }]);
  assert.equal(leido.modulos[1]?.motivoAlmacen, 'almacen-ausente');
  assert.equal(Object.hasOwn(leer([fuente, paquete]).modulos[1] ?? {}, 'motivoAlmacen'), false);
  for (const filas of [
    [fuente, { ...ambar, motivoAlmacen: 'almacen-roto' }],
    [fuente, { ...ambar, motivoAlmacen: null }],
    [fuente, { ...paquete, motivoAlmacen: 'almacen-vacio' }],
    [{ ...fuente, motivoAlmacen: 'almacen-vacio' }, paquete],
  ]) {
    assert.throws(() => leer(filas));
  }
});

test('política diaria conserva su plazo y no se convierte en mensual al leer el panel', () => {
  const entrada = documento();
  const primera = entrada.fuentes[0];
  assert.ok(primera);
  primera.politica = 'diaria';
  primera.plazoDias = 1;
  const salida = leerEstadoDatosPanel(entrada);
  assert.equal(salida.fuentes[0]?.politica, 'diaria');
  assert.equal(salida.fuentes[0]?.plazoDias, 1);
});

test('una fuente por ediciones trae la edición nueva observada solo cuando la hay, con su forma cerrada', () => {
  const base = instantaneaSaludV4();
  const [fila] = base.fuentes;
  assert.ok(fila);
  const porEdiciones = { ...fila, politica: 'edición' as const };
  const nueva = {
    estado: 'publicada-sin-microdatos',
    anio: '2026',
    observadoEn: base.observadoEn,
    huellaCatalogo: HUELLA_HEX,
  };
  const leer = (fuente: object) => leerEstadoDatosPanel({ ...base, fuentes: [fuente] });
  const leida = leer({ ...porEdiciones, edicionNueva: nueva });
  assert.deepEqual(
    leida.fuentes[0] && 'edicionNueva' in leida.fuentes[0] ? leida.fuentes[0].edicionNueva : null,
    nueva,
  );
  assert.equal(Object.hasOwn(leer(porEdiciones).fuentes[0] ?? {}, 'edicionNueva'), false);
  const conGrupos = leer({ ...porEdiciones, edicionNueva: nueva, gruposEnSuGranGrupo: 2 }).fuentes[0];
  assert.equal(conGrupos && 'gruposEnSuGranGrupo' in conGrupos ? conGrupos.gruposEnSuGranGrupo : null, 2);
  const conDescarte = leer({ ...porEdiciones, edicionNueva: nueva, avisoEdicion: 'observacion-anterior-descartada' });
  assert.ok(conDescarte.fuentes[0] && 'edicionNueva' in conDescarte.fuentes[0]);
  for (const aviso of ['edicion-no-verificable', 'sin-contraste-con-la-tich', 'sin-contraste-del-motivo']) {
    const conAviso = leer({ ...porEdiciones, avisoEdicion: aviso }).fuentes[0];
    assert.equal(conAviso && 'avisoEdicion' in conAviso ? conAviso.avisoEdicion : null, aviso);
  }
  for (const mala of [
    { ...fila, edicionNueva: nueva },
    { ...porEdiciones, edicionNueva: null },
    { ...porEdiciones, edicionNueva: { ...nueva, estado: 'fallo' } },
    { ...porEdiciones, edicionNueva: { ...nueva, anio: '26' } },
    { ...porEdiciones, edicionNueva: { ...nueva, observadoEn: '2026-10-16' } },
    { ...porEdiciones, edicionNueva: { ...nueva, observadoEn: '2099-01-01T00:00:00Z' } },
    { ...porEdiciones, edicionNueva: { ...nueva, huellaCatalogo: 'y'.repeat(LONGITUD_HUELLA) } },
    { ...porEdiciones, edicionNueva: { ...nueva, extra: 1 } },
    { ...porEdiciones, avisoEdicion: 'otro' },
    { ...porEdiciones, avisoEdicion: null },
    { ...fila, avisoEdicion: 'sin-contraste-con-la-tich' },
    { ...porEdiciones, edicionNueva: nueva, avisoEdicion: 'edicion-no-verificable' },
    { ...porEdiciones, avisoEdicion: 'observacion-anterior-descartada' },
    { ...porEdiciones, gruposEnSuGranGrupo: 0 },
    { ...porEdiciones, gruposEnSuGranGrupo: 1.5 },
    { ...fila, gruposEnSuGranGrupo: 1 },
  ]) {
    assert.throws(() => leer(mala));
  }
});
