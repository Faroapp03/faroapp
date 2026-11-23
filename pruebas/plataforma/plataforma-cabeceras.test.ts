// Las cabeceras conservan la CSP, el aislamiento y los avisos; el mapa vigente identifica el único guion en línea admitido.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CABECERAS_WEB,
  cabecerasDePagina,
  cabecerasParaRuta,
  conCabecerasWeb,
  ENLACE_AL_CATALOGO,
  POLITICA_DE_CONTENIDOS,
  POLITICA_DE_INTEGRIDAD,
  PUNTO_DE_AVISOS,
  RUTA_DE_AVISOS,
  RUTA_REGLAS_DE_ESPECULACION,
  TIPO_REGLAS_DE_ESPECULACION,
  tipoPropioDe,
  VALOR_HSTS,
  VIGENCIA_DE_LOS_AVISOS_S,
} from '../../src/plataforma/cabeceras-web.ts';
import { HUELLA_DEL_MAPA_DE_MODULOS } from '../../src/plataforma/mapa-de-modulos.ts';

test('la CSP solo admite el mapa actual por huella y mantiene aislamiento y permisos denegados', () => {
  assert.doesNotMatch(POLITICA_DE_CONTENIDOS, /unsafe-inline|unsafe-eval|unsafe-hashes|\*/);
  assert.equal(HUELLA_DEL_MAPA_DE_MODULOS, '', 'la plantilla neutra no admite guiones en línea');
  assert.ok(POLITICA_DE_CONTENIDOS.includes("script-src 'self';"));
  assert.ok(POLITICA_DE_CONTENIDOS.endsWith(`report-to ${PUNTO_DE_AVISOS}`));
  assert.equal(CABECERAS_WEB['cross-origin-embedder-policy'], 'require-corp');
  assert.equal(CABECERAS_WEB['cross-origin-opener-policy'], 'same-origin');
  assert.equal(CABECERAS_WEB['cross-origin-resource-policy'], 'same-origin');
  assert.equal(CABECERAS_WEB['referrer-policy'], 'no-referrer');
  for (const permiso of ['camera', 'microphone', 'geolocation', 'display-capture', 'usb', 'payment']) {
    assert.ok(CABECERAS_WEB['permissions-policy']?.split(', ').includes(`${permiso}=()`));
  }
});

test('las cuatro cabeceras de avisos nombran el mismo punto propio y NEL solo pide fallos', () => {
  assert.equal(CABECERAS_WEB['reporting-endpoints'], `${PUNTO_DE_AVISOS}="${RUTA_DE_AVISOS}"`);
  assert.equal(
    CABECERAS_WEB.nel,
    JSON.stringify({
      report_to: PUNTO_DE_AVISOS,
      max_age: VIGENCIA_DE_LOS_AVISOS_S,
      success_fraction: 0,
      failure_fraction: 1,
    }),
  );
  assert.equal(
    CABECERAS_WEB['report-to'],
    JSON.stringify({
      group: PUNTO_DE_AVISOS,
      max_age: VIGENCIA_DE_LOS_AVISOS_S,
      endpoints: [{ url: RUTA_DE_AVISOS }],
    }),
  );
});

test('solo las páginas llevan integridad en modo informe, reglas de navegación y catálogo', () => {
  assert.deepEqual(cabecerasDePagina('/inicio.html'), {
    'integrity-policy-report-only': POLITICA_DE_INTEGRIDAD,
    'speculation-rules': `"${RUTA_REGLAS_DE_ESPECULACION}"`,
    link: ENLACE_AL_CATALOGO,
  });
  assert.deepEqual(cabecerasDePagina('/scripts/motor.js'), {});
  assert.equal(tipoPropioDe(RUTA_REGLAS_DE_ESPECULACION), TIPO_REGLAS_DE_ESPECULACION);
  assert.equal(tipoPropioDe('/otro.json'), null);
});

test('añadir cabeceras conserva estado, texto y cuerpo y añade HSTS sin mutar la respuesta recibida', async () => {
  const original = new Response('contenido exacto', {
    statusText: 'Correcto',
    headers: { 'x-sintetica': 'conservar' },
  });
  const respuesta = conCabecerasWeb(original, '/inicio.html');
  assert.equal(respuesta.status, original.status);
  assert.equal(respuesta.statusText, 'Correcto');
  assert.equal(await respuesta.text(), 'contenido exacto');
  assert.equal(respuesta.headers.get('x-sintetica'), 'conservar');
  assert.equal(respuesta.headers.get('strict-transport-security'), VALOR_HSTS);
  assert.equal(respuesta.headers.get('integrity-policy-report-only'), POLITICA_DE_INTEGRIDAD);
  assert.equal(original.headers.get('strict-transport-security'), null);
});

test('la web admite únicamente recursos propios y ningún marco externo', () => {
  const directivas = new Map(
    POLITICA_DE_CONTENIDOS.split('; ').map((linea) => {
      const [nombre, ...valores] = linea.split(' ');
      return [nombre, valores.join(' ')];
    }),
  );
  assert.equal(directivas.get('script-src'), "'self'");
  assert.equal(directivas.get('connect-src'), "'self'");
  assert.equal(directivas.get('frame-src'), "'none'");
});

test('la activación privada no conserva caché ni hereda emisores de avisos o precarga', async () => {
  const heredadas = {
    'speculation-rules': '"/otras-reglas.json"',
    'reporting-endpoints': 'otro="/otro-receptor"',
    'report-to': '{"group":"otro"}',
    nel: '{"report_to":"otro"}',
    'integrity-policy-report-only': 'blocked-destinations=(script)',
  };
  const original = new Response('activar', { headers: { ...heredadas, 'cache-control': 'public, max-age=3600' } });
  const respuesta = conCabecerasWeb(original, '/activar-acceso.html');
  const locales = cabecerasParaRuta('/activar-acceso.html');
  for (const nombre of Object.keys(heredadas)) {
    assert.equal(respuesta.headers.get(nombre), null, nombre);
    assert.equal(locales[nombre], undefined, nombre);
  }
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(locales['cache-control'], 'no-store');
  assert.equal(respuesta.headers.get('pragma'), 'no-cache');
  assert.equal(respuesta.headers.get('referrer-policy'), 'no-referrer');
  assert.doesNotMatch(respuesta.headers.get('content-security-policy') ?? '', /report-to|https?:/);
  assert.equal(original.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(await respuesta.text(), 'activar');
});
