import assert from 'node:assert/strict';
import test from 'node:test';
import { proyectarObservaciones } from '../../src/biblioteca/observaciones-lecturas.ts';

const LONGITUD_SHA = 64;
const HTTP_NO_ENCONTRADO = 404;
const HTTP_RETIRADO = 410;
const PLAZO_MS = 604_800_000;
const SHA = 'a'.repeat(LONGITUD_SHA);
const URL = 'https://example.org/publicaciones/lectura';
const OBJETIVOS = [{ objetivo: 'uno:enlace', id: 'uno', campo: 'enlace', url: URL }] as const;
const CAPTURA = '2026-10-20T08:00:00.000001+00:00';
const AHORA = '2026-10-23T09:00:00Z';
function positiva() {
  return {
    url: URL,
    url_final: URL,
    capturado_utc: CAPTURA,
    cuerpo_sha256: SHA,
    content_type: 'text/html',
    resultado: 'respuesta',
    codigo_http: null,
    error_tipo: null,
    estado: 'verificado',
    identidad_acreditada: true,
    vence_utc: '2026-10-27T08:00:00.000001+00:00',
    lectura_tecnica: { estado: 'legible_html', metodo: 'HTMLParser-texto-visible-conservador' },
  };
}
function documento(
  ultimo: { estado: string } = positiva(),
  confirmacion: unknown = positiva(),
  evidencia: unknown = ['fallo_temporal', 'http_error', 'servicio_no_disponible', 'limite_tamano'].includes(
    ultimo.estado,
  )
    ? confirmacion
    : ultimo,
) {
  return {
    version: 2,
    catalogo_sha256: SHA,
    validez_dias: 7,
    revision_editorial: 'fuera_del_alcance',
    objetivos: [
      {
        ...OBJETIVOS[0],
        estado: ultimo.estado,
        ultimo_intento: ultimo,
        ultima_confirmacion: confirmacion,
        ultima_evidencia: evidencia,
      },
    ],
    verificados: ultimo.estado === 'verificado' ? 1 : 0,
  };
}
function proyectar(observaciones: unknown, ahora = AHORA) {
  return proyectarObservaciones({ catalogoSha256: SHA, objetivos: OBJETIVOS, observaciones, ahora });
}
function fallo() {
  return {
    ...positiva(),
    capturado_utc: '2026-10-23T08:00:00Z',
    estado: 'fallo_temporal',
    resultado: 'fallo_temporal',
    url_final: null,
    cuerpo_sha256: null,
    content_type: '',
    identidad_acreditada: false,
    vence_utc: '2026-10-30T08:00:00Z',
    lectura_tecnica: { estado: 'fallo_temporal' },
  };
}

test('una captura identificada conserva su estado y su fecha pasado el plazo técnico', () => {
  const actual = proyectar(documento()).objetivos[0];
  assert.equal(actual?.abrir, true);
  assert.equal(actual?.comprobado_utc, CAPTURA);
  assert.equal(actual?.estado, 'verificado');
  assert.equal(actual?.incidencia, null);
  assert.equal('vence_utc' in (actual ?? {}), false);
  for (const ahora of ['2026-10-27T08:00:00.000001Z', '2027-10-27T08:00:00Z']) {
    const pasada = proyectar(documento(), ahora).objetivos[0];
    assert.deepEqual(pasada, { ...actual });
  }
});
test('fallo temporal conserva la positiva y su fecha también pasado el plazo', () => {
  const entrada = documento(fallo(), positiva());
  const actual = proyectar(entrada).objetivos[0];
  assert.equal(actual?.estado, 'verificado_con_fallo_reciente');
  assert.equal(actual?.comprobado_utc, CAPTURA);
  assert.equal(actual?.ultimo_intento_utc, '2026-10-23T08:00:00Z');
  const pasada = proyectar(entrada, '2026-10-28T00:00:00Z').objetivos[0];
  assert.equal(pasada?.abrir, true);
  assert.equal(pasada?.estado, 'verificado_con_fallo_reciente');
  assert.equal(pasada?.comprobado_utc, CAPTURA);
});
/** Respuesta contraria (404/410) capturada en `instante`. */
function contraria(codigo: number, instante: string) {
  const estado = codigo === HTTP_RETIRADO ? 'http_retirado' : 'http_no_encontrado';
  const fin = new Date(Date.parse(instante) + PLAZO_MS).toISOString().replace('.000Z', 'Z');
  return { ...fallo(), estado, resultado: 'http_error', codigo_http: codigo, capturado_utc: instante, vence_utc: fin };
}
test('404 y 410 son incidencias del enlace: sigue abierto, con su tipo y fecha, sin retirar la ficha', () => {
  for (const codigo of [HTTP_NO_ENCONTRADO, HTTP_RETIRADO]) {
    const error = contraria(codigo, '2026-10-23T08:00:00Z');
    const salida = proyectar(documento(error));
    assert.equal(salida.objetivos.length, 1);
    assert.equal(salida.objetivos[0]?.abrir, true);
    assert.equal(salida.objetivos[0]?.motivo, error.estado);
    assert.deepEqual(salida.objetivos[0]?.incidencia, { tipo: error.estado, fecha: error.capturado_utc });
    assert.equal(salida.objetivos[0]?.comprobado_utc, CAPTURA);
    assert.equal(salida.objetivos[0]?.estado, 'comprobado_antes_con_evidencia_contraria');
    const nunca = proyectar(documento(error, null, error)).objetivos[0];
    assert.equal(nunca?.estado, 'no_comprobado');
    assert.equal(nunca?.comprobado_utc, null);
    assert.equal(nunca?.abrir, true);
  }
});
test('ni un 404 ni varios desactivan el enlace; la incidencia conserva la fecha de la última', () => {
  const segunda = contraria(HTTP_NO_ENCONTRADO, '2026-10-23T08:00:00Z');
  const salida = proyectar(documento(segunda, positiva(), segunda)).objetivos[0];
  assert.equal(salida?.abrir, true);
  assert.deepEqual(salida?.incidencia, { tipo: 'http_no_encontrado', fecha: segunda.capturado_utc });
  assert.equal(salida?.comprobado_utc, CAPTURA);
});
test('una confirmación posterior a un 404 retira la incidencia y renueva la fecha', () => {
  const confirmada = {
    ...positiva(),
    cuerpo_sha256: 'c'.repeat(LONGITUD_SHA),
    capturado_utc: '2026-10-23T08:00:00Z',
    vence_utc: '2026-10-30T08:00:00Z',
  };
  const salida = proyectar(documento(confirmada, confirmada, confirmada)).objetivos[0];
  assert.equal(salida?.abrir, true);
  assert.equal(salida?.incidencia, null);
  assert.equal(salida?.comprobado_utc, confirmada.capturado_utc);
});
test('una caída posterior no borra la incidencia intermedia ni cierra el enlace', () => {
  const retirada = contraria(HTTP_RETIRADO, '2026-10-23T08:00:00Z');
  const posterior = { ...fallo(), capturado_utc: '2026-10-23T08:30:00Z', vence_utc: '2026-10-30T08:30:00Z' };
  const salida = proyectar(documento(posterior, positiva(), retirada)).objetivos[0];
  assert.equal(salida?.abrir, true);
  assert.equal(salida?.motivo, 'http_retirado');
  assert.deepEqual(salida?.incidencia, { tipo: 'http_retirado', fecha: retirada.capturado_utc });
  assert.equal(salida?.ultimo_intento_utc, posterior.capturado_utc);
  assert.equal(salida?.comprobado_utc, CAPTURA);
});
test('un destino genérico es incidencia; un destino no seguro sigue sin enlazarse', () => {
  const generica = {
    ...positiva(),
    estado: 'redireccion_generica',
    identidad_acreditada: false,
    cuerpo_sha256: 'b'.repeat(LONGITUD_SHA),
    capturado_utc: '2026-10-23T08:00:00Z',
    vence_utc: '2026-10-30T08:00:00Z',
  };
  const abierta = proyectar(documento(generica)).objetivos[0];
  assert.equal(abierta?.abrir, true);
  assert.equal(abierta?.incidencia?.tipo, 'redireccion_generica');
  const insegura = { ...fallo(), estado: 'destino_no_seguro', error_tipo: 'DestinoNoSeguro' };
  const cerrada = proyectar(documento(insegura)).objetivos[0];
  assert.equal(cerrada?.abrir, false);
  assert.equal(cerrada?.estado, 'comprobado_antes_con_evidencia_contraria');
  assert.equal(cerrada?.motivo, 'destino_no_seguro');
  assert.equal(cerrada?.incidencia, null);
  assert.equal(cerrada?.comprobado_utc, CAPTURA);
});
test('recuperación exige positiva identificada nueva y repetición es idéntica', () => {
  const recuperada = {
    ...positiva(),
    cuerpo_sha256: 'c'.repeat(LONGITUD_SHA),
    capturado_utc: '2026-10-23T08:00:00Z',
    vence_utc: '2026-10-30T08:00:00Z',
  };
  const entrada = documento(recuperada, recuperada);
  assert.equal(proyectar(entrada).objetivos[0]?.abrir, true);
  assert.deepEqual(proyectar(entrada), proyectar(entrada));
});
test('archivo ausente es desconocido, no un catálogo vacío ni 75 verificaciones', () => {
  const salida = proyectar(null);
  assert.equal(salida.disponibilidad_observaciones, 'no_disponible');
  assert.equal(salida.objetivos.length, 1);
  assert.equal(salida.objetivos[0]?.estado, 'sin_observacion');
  assert.equal(salida.objetivos[0]?.abrir, true);
  assert.equal(salida.objetivos[0]?.comprobado_utc, null);
});
test('rechaza catálogo distinto, inventario incompleto, duplicados y URL cambiada', () => {
  const original = documento();
  for (const entrada of [
    { ...original, catalogo_sha256: 'b'.repeat(LONGITUD_SHA) },
    { ...original, objetivos: [] },
    { ...original, objetivos: [...original.objetivos, ...original.objetivos] },
    { ...original, objetivos: [{ ...original.objetivos[0], url: `${URL}/otra` }] },
  ]) {
    assert.throws(() => proyectar(entrada));
  }
});
test('rechaza confirmación falsa, futura, plazo alterado y captura ajena', () => {
  for (const alterada of [
    { ...positiva(), identidad_acreditada: false },
    { ...positiva(), capturado_utc: '2026-10-24T08:00:00Z' },
    { ...positiva(), vence_utc: '2026-10-28T08:00:00.000001Z' },
    { ...positiva(), url: 'https://example.org/otra' },
  ]) {
    assert.throws(() => proyectar(documento(alterada, alterada)));
  }
});
test('un error sin confirmación conserva el enlace editorial sin presentarlo como comprobado', () => {
  const salida = proyectar(documento(fallo(), null)).objetivos[0];
  assert.equal(salida?.abrir, true);
  assert.equal(salida?.estado, 'no_comprobado');
  assert.equal(salida?.comprobado_utc, null);
  assert.equal(salida?.motivo, 'fallo_temporal');
});
test('variante de idioma requiere su propia evidencia', () => {
  const ca = { objetivo: 'uno:enlace_ca', id: 'uno', campo: 'enlace_ca', url: `${URL}/ca` };
  const entrada = documento();
  const salida = proyectarObservaciones({
    catalogoSha256: SHA,
    objetivos: [...OBJETIVOS, ca],
    ahora: AHORA,
    observaciones: {
      ...entrada,
      objetivos: [
        ...entrada.objetivos,
        { ...ca, estado: 'sin_observacion', ultimo_intento: null, ultima_confirmacion: null, ultima_evidencia: null },
      ],
    },
  });
  assert.equal(salida.objetivos[0]?.abrir, true);
  assert.equal(salida.objetivos[1]?.abrir, true);
  assert.equal(salida.objetivos[1]?.comprobado_utc, null);
});
test('locales requieren integridad local explícita, ajena a comprobación remota', () => {
  const local = { objetivo: 'propia:enlace', id: 'propia', campo: 'enlace', url: 'entender-ia.html' };
  const entrada = { catalogoSha256: SHA, objetivos: [local], observaciones: null, ahora: AHORA };
  assert.equal(proyectarObservaciones(entrada).objetivos[0]?.abrir, false);
  const salida = proyectarObservaciones({
    ...entrada,
    integridadLocal: [{ objetivo: local.objetivo, url: local.url, sha256: SHA }],
  });
  assert.equal(salida.objetivos[0]?.estado, 'integridad_local');
  assert.equal(salida.objetivos[0]?.comprobado_utc, null);
  assert.equal(salida.objetivos[0]?.abrir, true);
});

test('página de fallo técnico no rejuvenece ni revoca confirmación dentro del plazo', () => {
  const servicio = {
    ...positiva(),
    estado: 'servicio_no_disponible',
    identidad_acreditada: false,
    capturado_utc: '2026-10-23T08:00:00Z',
    vence_utc: '2026-10-30T08:00:00Z',
    cuerpo_sha256: 'd'.repeat(LONGITUD_SHA),
    lectura_tecnica: { estado: 'servicio_no_disponible' },
  };
  const actual = proyectar(documento(servicio)).objetivos[0];
  assert.equal(actual?.estado, 'verificado_con_fallo_reciente');
  assert.equal(actual?.comprobado_utc, CAPTURA);
  assert.equal(actual?.motivo, 'servicio_no_disponible');
});

test('rechaza omitir o falsear la última evidencia y el contrato anterior', () => {
  const original = documento();
  const fila = original.objetivos[0];
  for (const entrada of [
    { ...original, version: 1 },
    { ...original, version: 3 },
    { ...original, objetivos: [{ ...fila, ultima_evidencia: null }] },
    { ...original, objetivos: [{ ...fila, ultima_evidencia: fallo() }] },
    {
      ...original,
      objetivos: [{ ...fila, ultima_evidencia: { ...positiva(), cuerpo_sha256: 'b'.repeat(LONGITUD_SHA) } }],
    },
  ]) {
    assert.throws(() => proyectar(entrada));
  }
});

const INCONCLUYENTES = [
  'identidad_no_acreditada',
  'acceso_restringido',
  'pdf_limite_paginas',
  'pdf_sin_texto_extraible',
];
function inconcluyente(estado: string) {
  return {
    ...positiva(),
    estado,
    identidad_acreditada: false,
    cuerpo_sha256: 'e'.repeat(LONGITUD_SHA),
    capturado_utc: '2026-10-23T08:30:00Z',
    vence_utc: '2026-10-30T08:30:00Z',
  };
}
test('falta de identidad, restricciones o límites de extracción no son bajas ni confirmaciones', () => {
  for (const estado of INCONCLUYENTES) {
    const intento = inconcluyente(estado);
    const salida = proyectar(documento(intento, null, null)).objetivos[0];
    assert.equal(salida?.abrir, true, estado);
    assert.equal(salida?.estado, 'no_comprobado');
    assert.equal(salida?.motivo, estado);
    assert.equal(salida?.comprobado_utc, null);
    assert.equal(salida?.ultimo_intento_utc, intento.capturado_utc);
  }
});
test('un intento inconcluyente conserva la confirmación previa sin renovar su fecha ni su plazo', () => {
  for (const estado of INCONCLUYENTES) {
    const entrada = documento(inconcluyente(estado), positiva(), positiva());
    const salida = proyectar(entrada).objetivos[0];
    assert.equal(salida?.abrir, true, estado);
    assert.equal(salida?.estado, 'verificado_con_intento_inconcluyente');
    assert.equal(salida?.comprobado_utc, CAPTURA);
    const pasada = proyectar(entrada, '2026-10-28T00:00:00Z').objetivos[0];
    assert.equal(pasada?.estado, 'verificado_con_intento_inconcluyente');
    assert.equal(pasada?.comprobado_utc, CAPTURA);
    assert.deepEqual(proyectar(entrada), proyectar(entrada));
  }
});
test('un intento inconcluyente no borra la incidencia de un destino ausente', () => {
  const ausente = contraria(HTTP_NO_ENCONTRADO, '2026-10-23T08:00:00Z');
  for (const estado of INCONCLUYENTES) {
    const salida = proyectar(documento(inconcluyente(estado), positiva(), ausente)).objetivos[0];
    assert.equal(salida?.abrir, true, estado);
    assert.equal(salida?.motivo, 'http_no_encontrado');
    assert.equal(salida?.incidencia?.fecha, ausente.capturado_utc);
    assert.equal(salida?.comprobado_utc, CAPTURA);
  }
});
test('el contrato rechaza promover incertidumbre a evidencia contraria', () => {
  for (const estado of INCONCLUYENTES) {
    const intento = inconcluyente(estado);
    assert.throws(() => proyectar(documento(intento, null, intento)));
  }
});
