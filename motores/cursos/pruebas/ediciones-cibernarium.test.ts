// Hechos de la edición propia del censo de IA en la bolsa: lo completo no se ofrece y el botón publicado confirma.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ActividadCibernarium, EdicionCibernarium } from '../../../compartido/contratos/tipos-barcelona-activa.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { bolsaDeCursos } from '../src/bolsa-de-cursos.ts';

const HOY = '2026-10-21';
/** Cifras hexadecimales de una huella SHA-256. */
const LARGO_SHA256 = 64;
const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
assert.ok(datos.barcelonaActiva);
const base = datos.barcelonaActiva;

function edicion(
  inscripcion: Partial<EdicionCibernarium['inscripcion']>,
  plazas: EdicionCibernarium['plazas'],
): EdicionCibernarium {
  return {
    idFuente: 'x',
    identidadInterna: `ba-edicion-v1:${'0'.repeat(LARGO_SHA256)}`,
    vinculacion: 'id-edicion-publicado',
    modalidad: 'en-linea',
    sincronia: null,
    horas: null,
    duracionPublicada: null,
    idioma: null,
    disponibilidad: null,
    sesiones: [],
    inscripcion: { continuaDeclarada: null, apertura: null, botonVisible: null, estado: null, ...inscripcion },
    plazas,
    evidencia: {
      url: 'https://cibernarium.barcelonactiva.cat/ca/web/guest/formacions',
      observadoUTC: '2026-10-21T08:00:00Z',
      origenFechaObservacion: 'consulta-http',
      sha256Captura: 'a'.repeat(LARGO_SHA256),
      normalizacionFechas: 'intervalo-publicado',
      localizador: 'activities[0].listEditions[0]',
    },
  };
}

function bolsaCon(...actividades: ActividadCibernarium[]) {
  const bolsa = bolsaDeCursos({ ...datos, barcelonaActiva: { ...base, cibernarium: actividades } }, HOY);
  return bolsa.filter((c) => c.fuente === 'cibernarium');
}

function empezada(id: string, propia?: EdicionCibernarium): ActividadCibernarium {
  return {
    id,
    titulo: `Curs ${id}`,
    inicio: '2026-10-01',
    fin: '2026-11-30',
    modalidad: 'en-linea',
    ...(propia ? { edicion: propia } : {}),
  };
}

test('con el botón de inscripción publicado, la empezada se ofrece como inscripción confirmada y con fecha', () => {
  const [c] = bolsaCon(empezada('1', edicion({ botonVisible: true, estado: 'abierta' }, null)));
  assert.ok(c);
  assert.equal(c.inscripcion, 'confirmada');
  assert.equal(c.conFecha, true);
});

test('con el botón oculto, sin ese dato o sin edición, la empezada no se ofrece', () => {
  assert.deepEqual(bolsaCon(empezada('2', edicion({ botonVisible: false }, null))), []);
  assert.deepEqual(bolsaCon(empezada('3', edicion({}, null))), []);
  assert.deepEqual(bolsaCon(empezada('4')), []);
});

test('lo que la fuente da por completo no se ofrece aunque muestre el botón', () => {
  assert.deepEqual(bolsaCon(empezada('5', edicion({ botonVisible: true, estado: 'abierta' }, 'sin-plazas'))), []);
});

test('lo que aún no ha empezado se ofrece con fecha y, sin botón, con la inscripción sin verificar', () => {
  const [c] = bolsaCon({ ...empezada('6'), inicio: '2026-11-02' });
  assert.ok(c);
  assert.equal(c.conFecha, true);
  assert.equal(c.inscripcion, 'sin-verificar');
});

test('con apertura futura (DISP52) y el botón visible, ni se ofrece empezada ni queda confirmada', () => {
  const futura = edicion({ botonVisible: true, estado: 'apertura-futura' }, null);
  assert.deepEqual(bolsaCon(empezada('7', futura)), []);
  const [c] = bolsaCon({ ...empezada('8', futura), inicio: '2026-11-02' });
  assert.ok(c);
  assert.equal(c.inscripcion, 'sin-verificar');
});
