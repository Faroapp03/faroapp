import assert from 'node:assert/strict';
import test from 'node:test';
import { leerPaginaCatalogoPrivado, paginarCatalogoPrivado } from '../../src/administracion/catalogo-privado.js';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { catalogoPrivado } from '../ayudas/catalogo-privado.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { prepararPanel } from './panel-dom.ts';

const INICIO = 1_000_000,
  INACTIVIDAD = 900_000,
  ABSOLUTA = 28_800_000,
  TOTAL = 53,
  UNIDADES_MIXTAS = 5,
  PUBLICADAS = 3;
function activa(pagina = 0): Extract<EstadoClientePanel, { estado: 'activa' }> {
  return {
    estado: 'activa',
    ocupado: false,
    controles: { version: 2, revision: 0, api: 'habilitada', mcp: false, a2a: false },
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    ocultas: {
      sesion: {
        estado: 'activa',
        iniciadaEn: INICIO,
        ultimaActividadEn: INICIO,
        caducaPorInactividadEn: INICIO + INACTIVIDAD,
        caducaAbsolutaEn: INICIO + ABSOLUTA,
      },
      ofertasOcultas: paginarCatalogoPrivado(catalogoPrivado(TOTAL), { tipo: 'todos', pagina, revision: null }),
      reciboTerminadoEn: '2026-10-16T12:00:00Z',
      intentosFuentes: [{ id: 'prueba', ultimoIntento: '2026-10-16T11:00:00Z', veredicto: 'rojo' }],
    },
  };
}
test('vista privada muestra causa, fechas independientes, referencias; ES/CA sin consulta y borrado al perder sesión', async (t) => {
  const p = await prepararPanel(t);
  t.after(() => activarIdiomaPanel());
  p.publicar(activa());
  assert.match(p.campo('ocultas-resumen').textContent, /53.*página 1/);
  const lista = p.campo('ocultas-lista');
  assert.match(lista.textContent, /Curso conservado <sin HTML>/);
  assert.equal(lista.querySelector('sin'), null);
  assert.match(lista.textContent, /no acredita disponibilidad pública/);
  assert.match(lista.textContent, /2026-10-15T10:00:00Z/);
  assert.match(lista.textContent, /2026-10-16T11:00:00Z/);
  assert.match(lista.textContent, /SHA-256/);
  assert.match(lista.textContent, /Parámetros y fragmento omitidos/);
  assert.equal(p.campo('ocultas-siguiente').disabled, false);
  p.campo('ocultas-siguiente').dispatchEvent(new Event('click'));
  assert.deepEqual(p.registros, [{ tipo: 'todos', pagina: 1 }]);
  p.publicar({ ...activa(), avisoOcultas: 'ocultas_no_disponibles' });
  assert.match(p.campo('ocultas-estado').textContent, /conserva la última observación/);
  assert.match(lista.textContent, /Curso conservado/);
  const antes = p.registros.length;
  p.cambiarIdioma('ca');
  assert.equal(p.registros.length, antes);
  assert.match(lista.textContent, /Darrera comprovació vàlida/);
  assert.match(p.campo('ocultas-estado').textContent, /darrera observació coneguda/);
  p.publicar({ estado: 'caducada', aviso: 'sesion_inactiva' });
  assert.equal(p.campo('ofertas-ocultas').hidden, true);
  assert.equal(lista.textContent, '');
});
test('sin autoridad se explica como desconocido, sin cifra de cero', async (t) => {
  const p = await prepararPanel(t);
  const estado = activa();
  assert.ok(estado.ocultas);
  p.publicar({
    ...estado,
    ocultas: { ...estado.ocultas, ofertasOcultas: { estado: 'sin-registro', catalogo: null } },
  });
  assert.match(p.campo('ocultas-estado').textContent, /Sin registro disponible/);
  assert.equal(p.campo('ocultas-resumen').textContent, '');
  assert.equal(p.campo('ocultas-lista').textContent, '');
  p.publicar({ ...estado, ocultas: null, avisoOcultas: 'ocultas_no_disponibles' });
  assert.match(p.campo('ocultas-estado').textContent, /Sin registro disponible.*no hay una observación anterior/);
});
test('avisos internos de revisión y de fallo, y motivos antiguos legibles, sin cambiar la unidad', async (t) => {
  const p = await prepararPanel(t);
  t.after(() => activarIdiomaPanel());
  const estado = activa();
  assert.ok(estado.ocultas);
  const catalogo = catalogoPrivado(2, (u) =>
    u.id === 'unidad-0'
      ? {
          ...u,
          revisarEl: '2000-01-01T00:00:00Z',
          ultimoIntentoFallidoEl: '2026-10-15T11:30:00Z',
          motivos: ['limite_publicado_alcanzado', 'enlace_de_ficha_no_encontrado'],
        }
      : {
          ...u,
          revisarEl: '2999-01-01T00:00:00Z',
          decision: 'comprobacion-caducada',
          motivoRetencion: 'confirmacion_vencida_en_corte',
        },
  );
  const ofertasOcultas = paginarCatalogoPrivado(catalogo, { tipo: 'todos', pagina: 0, revision: null });
  const copia = JSON.stringify(ofertasOcultas);
  p.publicar({ ...estado, ocultas: { ...estado.ocultas, ofertasOcultas } });
  const [primera, segunda] = p.campo('ocultas-lista').querySelectorAll('article');
  assert.ok(primera && segunda);
  assert.match(
    primera.textContent,
    /Revisión pendiente: venció hace \d+ días, el 1 ene. 2000 a la 1:00 \(registro en UTC: 2000-01-01T00:00:00Z\)/,
  );
  assert.match(primera.textContent, /La última consulta falló [^(]+\(registro en UTC: 2026-10-15T11:30:00Z\)/);
  assert.match(primera.textContent, /fecha límite publicada por la fuente \(limite_publicado_alcanzado\)/);
  assert.match(primera.textContent, /no consta un cierre del curso \(enlace_de_ficha_no_encontrado\)/);
  assert.doesNotMatch(segunda.textContent, /Revisión pendiente|consulta falló/);
  assert.match(segunda.textContent, /Comprobación caducada/);
  assert.match(segunda.textContent, /La comprobación ya había vencido en el corte conservado/);
  assert.equal(JSON.stringify(ofertasOcultas), copia);
  p.cambiarIdioma('ca');
  const catalan = p.campo('ocultas-lista').textContent;
  assert.match(
    catalan,
    /Revisió pendent: va vèncer fa \d+ dies, l’1 de gen. del 2000 a la 1:00 \(registre en UTC: 2000-01-01T00:00:00Z\)/,
  );
  assert.match(catalan, /La darrera consulta va fallar [^(]+\(registre en UTC: 2026-10-15T11:30:00Z\)/);
});
function catalogoMixto() {
  const publicada = { motivoRetencion: null, decision: 'disponible-publicamente' };
  return catalogoPrivado(UNIDADES_MIXTAS, (u) => {
    switch (u.id) {
      case 'unidad-0':
        return {
          ...u,
          motivoRetencion: 'resultado_de_evaluacion_anterior',
          incidenciaEnlace: { el: '2026-10-15T09:00:00Z', origen: 'ficha', tipo: 'http', codigoHttp: 410 },
        };
      case 'unidad-1':
        return {
          ...u,
          ...publicada,
          revisarEl: '2001-05-01T00:00:00Z',
          ultimoIntentoFallidoEl: '2026-10-15T11:30:00Z',
        };
      case 'unidad-2':
        return { ...u, ...publicada, revisarEl: '2000-01-01T00:00:00Z' };
      case 'unidad-3':
        return {
          ...u,
          ...publicada,
          revisarEl: '2999-01-01T00:00:00Z',
          incidenciaEnlace: { el: '2026-10-15T11:00:00Z', origen: 'catalogo', tipo: 'http', codigoHttp: 404 },
        };
      default:
        return u;
    }
  });
}
test('resumen de cursos publicados con revisión vencida o consulta fallida: avisa y siguen publicados', async (t) => {
  const p = await prepararPanel(t);
  t.after(() => activarIdiomaPanel());
  const estado = activa();
  assert.ok(estado.ocultas);
  const catalogo = catalogoMixto();
  const ofertasOcultas = leerPaginaCatalogoPrivado(
    JSON.parse(JSON.stringify(paginarCatalogoPrivado(catalogo, { tipo: 'todos', pagina: 0, revision: null }))),
  );
  assert.deepEqual(ofertasOcultas.catalogo?.avisosPublicadas, {
    revisiones: ['2000-01-01T00:00:00Z', '2001-05-01T00:00:00Z', '2999-01-01T00:00:00Z'],
    fallidas: 1,
    incidencias: 1,
  });
  p.publicar({ ...estado, ocultas: { ...estado.ocultas, ofertasOcultas } });
  const lista = p.campo('ocultas-lista');
  assert.match(
    lista.textContent,
    /revisión interna pendiente: 2 \(la más antigua venció [^(]+\(registro en UTC: 2000-01-01T00:00:00Z\)\)/,
  );
  assert.match(lista.textContent, /última consulta falló: 1\. Siguen publicados/);
  assert.match(lista.textContent, /formato anterior y está pendiente de reevaluarse/);
  assert.match(lista.textContent, /dirección dio un error en la última revisión: 1\. Siguen publicados con su enlace/);
  assert.match(
    lista.textContent,
    /Error de la dirección de la ficha en la última revisión: [^(]+\(registro en UTC: 2026-10-15T09:00:00Z\) · http · HTTP 410/,
  );
  assert.doesNotMatch(lista.textContent, /cierre|apartar|retirad/iu);
  // Las publicadas no pasan a retenidas ni cambian su decisión.
  assert.equal(ofertasOcultas.catalogo?.total, 2);
  assert.ok(!ofertasOcultas.catalogo?.unidades.some((u) => ['unidad-1', 'unidad-2', 'unidad-3'].includes(u.id)));
  assert.equal(catalogo.unidades.filter((u) => u.motivoRetencion === null).length, PUBLICADAS);
  p.cambiarIdioma('ca');
  assert.match(lista.textContent, /revisió interna pendent: 2/);
  assert.match(lista.textContent, /darrera consulta dels quals ha fallat: 1/);
  assert.match(lista.textContent, /adreça dels quals va donar un error a la darrera revisió: 1/);
  assert.match(
    lista.textContent,
    /Error de l’adreça de la fitxa a la darrera revisió: [^(]+\(registre en UTC: 2026-10-15T09:00:00Z\)/,
  );
});
