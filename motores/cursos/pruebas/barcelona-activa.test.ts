// Selección de enlaces de Barcelona Activa con fechas inyectadas y datos autónomos, sin paquete ni informe completo.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { EdicionCibernarium } from '../../../compartido/contratos/tipos-barcelona-activa.ts';
import { cibernariumDelInforme, type DatosBarcelonaActiva, fichaDeBarcelonaActiva } from '../src/barcelona-activa.ts';

const HOY = '2026-10-10';
/**
 * Recorte fijo de un paquete de forma anterior: las 9 actividades de datos/barcelonactiva.json (sha256
 * d60cddf5da1af4c53dd0c454ad4e0744269589c9a75e4be2aa89374efbc77bad, el publicado el 15/11/2026) cuya edición no es
 * la propia: 1 «pendiente» y 8 «fechas-coincidentes». No lee datos/, que la operación regenera.
 */
const PAQUETE_ANTERIOR = new URL('./cibernarium-paquete-forma-anterior.json', import.meta.url);
const ANTIGUAS_EN_EL_RECORTE = 9;
const DIA_MS = 86_400_000;
const FIN_FECHA = 10;
/** Cifras hexadecimales de una huella SHA-256. */
const LARGO_SHA256 = 64;
/** Lo que deja ofrecer una actividad en línea ya empezada: el botón de inscripción que muestra la fuente. */
const CON_BOTON = {
  edicion: edicionPropia({
    inscripcion: { continuaDeclarada: null, apertura: null, botonVisible: true, estado: 'abierta' },
  }),
};
const DATOS: DatosBarcelonaActiva = {
  cita: 'Barcelona Activa · consulta de prueba',
  consulta: '2026-10-07',
  url_ficha: 'https://treball.barcelonactiva.cat/ca/cataleg-ocupacions?idFicha=',
  url_actividad: 'https://cibernarium.barcelonactiva.cat/ficha-actividad?activityId=',
  ocupaciones: { '1112.1': 'uuid-1' },
  cibernarium: [
    { id: '3', titulo: 'Tercera', inicio: '2026-11-02', fin: '2026-11-02', modalidad: 'presencial' },
    { id: '1', titulo: 'Hoy', inicio: HOY, fin: '2026-10-12', modalidad: 'en-linea', ...CON_BOTON },
    { id: '2', titulo: 'Segunda', inicio: '2026-10-11', fin: '2026-10-20', modalidad: 'en-linea' },
    { id: '4', titulo: 'Empezada', inicio: '2026-10-09', fin: '2026-10-30', modalidad: 'presencial' },
  ],
};

function datosCon(actividades: DatosBarcelonaActiva['cibernarium']): DatosBarcelonaActiva {
  return { ...DATOS, cibernarium: actividades };
}

function formaciones(datos: DatosBarcelonaActiva, hoy: string = HOY) {
  const informe = cibernariumDelInforme(datos, hoy);
  assert.ok(informe, 'la muestra debe tener formaciones seleccionadas');
  return informe.formaciones;
}

test('la ficha solo coincide con el código ESCO exacto y conserva la dirección oficial', () => {
  assert.equal(fichaDeBarcelonaActiva(DATOS, '1112.1'), `${DATOS.url_ficha}uuid-1`);
  for (const esco of ['1112', '1112.1.1', '1112.2', '', null]) {
    assert.equal(fichaDeBarcelonaActiva(DATOS, esco), null);
  }
  assert.equal(fichaDeBarcelonaActiva(undefined, '1112.1'), null);
});

test('una propiedad heredada no es una ficha del catálogo', () => {
  for (const esco of ['constructor', 'toString', '__proto__']) {
    assert.equal(fichaDeBarcelonaActiva(DATOS, esco), null);
  }
});

test('una clave propia se consulta aunque su nombre coincida con una propiedad heredada', () => {
  for (const esco of ['constructor', 'toString', '__proto__']) {
    const datos = { ...DATOS, ocupaciones: { [esco]: 'ficha-propia' } };
    assert.equal(fichaDeBarcelonaActiva(datos, esco), `${DATOS.url_ficha}ficha-propia`);
  }
  assert.equal(fichaDeBarcelonaActiva({ ...DATOS, ocupaciones: { '1112.1': '' } }, '1112.1'), null);
});

test('las próximas preceden a las en línea iniciadas y conservan todos sus campos y la cita', () => {
  assert.deepEqual(cibernariumDelInforme(DATOS, HOY), {
    formaciones: [
      {
        titulo: 'Segunda',
        enlace: `${DATOS.url_actividad}2`,
        inicio: '2026-10-11',
        fin: '2026-10-20',
        modalidad: 'en-linea',
      },
      {
        titulo: 'Tercera',
        enlace: `${DATOS.url_actividad}3`,
        inicio: '2026-11-02',
        fin: '2026-11-02',
        modalidad: 'presencial',
      },
      {
        titulo: 'Hoy',
        enlace: `${DATOS.url_actividad}1`,
        inicio: HOY,
        fin: '2026-10-12',
        modalidad: 'en-linea',
        edicion: CON_BOTON.edicion,
      },
    ],
    fuente: DATOS.cita,
    consulta: DATOS.consulta,
  });
});

test('la modalidad presencial solo se selecciona antes del inicio', () => {
  const datos = datosCon([{ id: 'p', titulo: 'Presencial', inicio: HOY, fin: '2026-10-12', modalidad: 'presencial' }]);
  for (const hoy of [HOY, '2026-10-11', '2026-10-12']) {
    assert.equal(cibernariumDelInforme(datos, hoy), null);
  }
});

test('sin revisión no se acredita inscripción aunque la en línea incluye el inicio y el día anterior al fin, y excluye el fin', () => {
  const datos = datosCon([{ id: 'l', titulo: 'En línea', inicio: HOY, fin: '2026-10-12', modalidad: 'en-linea' }]);
  assert.equal(cibernariumDelInforme(datos, '2026-10-12'), null);
  assert.equal(cibernariumDelInforme(datos, '2026-10-13'), null);
});

test('una actividad de un solo día se selecciona únicamente antes de ese día en ambas modalidades', () => {
  for (const modalidad of ['en-linea', 'presencial'] as const) {
    const datos = datosCon([{ id: 'u', titulo: 'Un día', inicio: HOY, fin: HOY, modalidad }]);
    assert.equal(cibernariumDelInforme(datos, HOY), null);
  }
});

test('el orden usa inicio para próximas y fin para iniciadas, con desempate alfabético catalán', () => {
  const datos = datosCon([
    { id: 'f2', titulo: 'Zebra', inicio: '2026-10-11', fin: '2026-12-01', modalidad: 'presencial' },
    { id: 'f1', titulo: 'Ànec', inicio: '2026-10-11', fin: '2026-12-02', modalidad: 'en-linea' },
    { id: 'f3', titulo: 'Abans', inicio: '2026-10-12', fin: '2026-10-12', modalidad: 'presencial' },
    { id: 'a3', titulo: 'Abans', inicio: '2026-10-01', fin: '2026-10-12', modalidad: 'en-linea', ...CON_BOTON },
    { id: 'a2', titulo: 'Zebra', inicio: '2026-10-02', fin: '2026-10-11', modalidad: 'en-linea', ...CON_BOTON },
    { id: 'a1', titulo: 'Ànec', inicio: '2026-10-03', fin: '2026-10-11', modalidad: 'en-linea', ...CON_BOTON },
  ]);
  assert.deepEqual(
    formaciones(datos).map(({ enlace }) => enlace.slice(DATOS.url_actividad.length)),
    ['f1', 'f2', 'f3', 'a1', 'a2', 'a3'],
  );
});

test('los empates completos conservan el orden de entrada dentro de cada bloque', () => {
  const datos = datosCon([
    { id: 'p2', titulo: 'Igual', inicio: '2026-10-11', fin: '2026-10-20', modalidad: 'presencial' },
    { id: 'a2', titulo: 'Igual', inicio: '2026-10-02', fin: '2026-10-12', modalidad: 'en-linea', ...CON_BOTON },
    { id: 'p1', titulo: 'Igual', inicio: '2026-10-11', fin: '2026-10-12', modalidad: 'en-linea' },
    { id: 'a1', titulo: 'Igual', inicio: '2026-10-03', fin: '2026-10-12', modalidad: 'en-linea', ...CON_BOTON },
  ]);
  assert.deepEqual(
    formaciones(datos).map(({ enlace }) => enlace.slice(DATOS.url_actividad.length)),
    ['p2', 'p1', 'a2', 'a1'],
  );
});

test('sin paquete, sin actividades o sin ninguna seleccionable el resultado es null', () => {
  assert.equal(cibernariumDelInforme(undefined, HOY), null);
  assert.equal(cibernariumDelInforme(datosCon([]), HOY), null);
  assert.equal(cibernariumDelInforme(DATOS, '2026-11-02'), null);
});

test('la selección y las fichas conservan intactos el paquete, las actividades y su orden', () => {
  const datos = structuredClone(DATOS);
  const antes = structuredClone(datos);
  for (const actividad of datos.cibernarium) {
    Object.freeze(actividad);
  }
  Object.freeze(datos.cibernarium);
  Object.freeze(datos.ocupaciones);
  Object.freeze(datos);
  assert.ok(cibernariumDelInforme(datos, HOY));
  assert.equal(fichaDeBarcelonaActiva(datos, '1112.1'), `${DATOS.url_ficha}uuid-1`);
  assert.deepEqual(datos, antes);
});

/** Una edición propia como la publica el censo de IA: solo hechos directos de la API, lo demás no consta. */
function edicionPropia(cambios: Partial<EdicionCibernarium> = {}): EdicionCibernarium {
  return {
    idFuente: 'fijo',
    identidadInterna: `ba-edicion-v1:${'0'.repeat(LARGO_SHA256)}`,
    vinculacion: 'id-edicion-publicado',
    modalidad: 'en-linea',
    sincronia: null,
    horas: null,
    duracionPublicada: null,
    idioma: null,
    disponibilidad: null,
    sesiones: [],
    inscripcion: { continuaDeclarada: null, apertura: null, botonVisible: null, estado: null },
    plazas: null,
    evidencia: {
      url: 'https://cibernarium.barcelonactiva.cat/ca/web/guest/formacions?pagina=0',
      observadoUTC: '2026-09-29T10:00:00Z',
      origenFechaObservacion: 'consulta-http',
      sha256Captura: 'a'.repeat(LARGO_SHA256),
      normalizacionFechas: 'intervalo-publicado',
      localizador: 'activities[0].listEditions[0]',
    },
    ...cambios,
  };
}

function horarioFijo(plazas: EdicionCibernarium['plazas'] = null): DatosBarcelonaActiva['cibernarium'][number] {
  return {
    id: 'fijo',
    titulo: 'Horari fix',
    inicio: '2026-10-01',
    fin: '2026-10-20',
    modalidad: 'en-linea',
    edicion: edicionPropia({
      sincronia: 'horario-fijo',
      sesiones: [{ fecha: '2026-10-01', inicioLocal: '10:00', finLocal: '12:00' }],
      plazas,
    }),
  };
}

test('una edición de horario fijo solo se ofrece antes de su inicio', () => {
  assert.equal(formaciones(datosCon([horarioFijo()]), '2026-09-30').length, 1);
  assert.equal(cibernariumDelInforme(datosCon([horarioFijo()]), HOY), null);
});

test('«sin-plazas» publicado en la edición propia no se ofrece; sin dato de plazas se ofrece según sus fechas', () => {
  assert.equal(cibernariumDelInforme(datosCon([horarioFijo('sin-plazas')]), '2026-09-30'), null);
  assert.equal(formaciones(datosCon([horarioFijo(null)]), '2026-09-30').length, 1);
});

test('en línea ya empezada: solo con el botón visible hoy y la inscripción abierta; si no, no se ofrece', () => {
  const empezada = (
    botonVisible: boolean | null,
    estado: EdicionCibernarium['inscripcion']['estado'] = 'abierta',
  ): DatosBarcelonaActiva['cibernarium'][number] => ({
    id: 'e',
    titulo: 'Empezada',
    inicio: '2026-10-01',
    fin: '2026-10-30',
    modalidad: 'en-linea',
    edicion: edicionPropia({ inscripcion: { continuaDeclarada: null, apertura: null, botonVisible, estado } }),
  });
  assert.equal(formaciones(datosCon([empezada(true)])).length, 1);
  assert.equal(cibernariumDelInforme(datosCon([empezada(false)]), HOY), null);
  assert.equal(cibernariumDelInforme(datosCon([empezada(null)]), HOY), null);
  // Una apertura futura (DISP52) con el botón visible no dice que ya se pueda entrar.
  assert.equal(cibernariumDelInforme(datosCon([empezada(true, 'apertura-futura')]), HOY), null);
  assert.equal(cibernariumDelInforme(datosCon([empezada(true, null)]), HOY), null);
  const sinEdicion = {
    id: 's',
    titulo: 'Sense',
    inicio: '2026-10-01',
    fin: '2026-10-30',
    modalidad: 'en-linea' as const,
  };
  assert.equal(cibernariumDelInforme(datosCon([sinEdicion]), HOY), null);
});

test('una edición con otra vinculación no se aplica: sus hechos de edición no constan', () => {
  const desconocida = {
    id: 'v',
    titulo: 'Vinculada',
    inicio: '2026-10-20',
    fin: '2026-10-21',
    modalidad: 'presencial' as const,
    edicion: {
      ...edicionPropia({ sincronia: 'a-tu-ritmo', disponibilidad: { desde: '2026-10-01', hasta: '2026-12-31' } }),
      vinculacion: 'otra-cosa',
    } as unknown as EdicionCibernarium,
  };
  const [f] = formaciones(datosCon([desconocida]));
  assert.ok(f);
  assert.deepEqual([f.inicio, f.fin, f.modalidad, 'edicion' in f], ['2026-10-20', '2026-10-21', 'presencial', false]);
});

test('el paquete publicado de forma anterior: sus ediciones «pendiente» y «fechas-coincidentes» no se aplican', () => {
  const recorte = JSON.parse(readFileSync(PAQUETE_ANTERIOR, 'utf8')) as Pick<DatosBarcelonaActiva, 'cibernarium'>;
  const antiguas = recorte.cibernarium.filter(
    (a) => a.edicion && (a.edicion.vinculacion as string) !== 'id-edicion-publicado',
  );
  assert.equal(antiguas.length, ANTIGUAS_EN_EL_RECORTE);
  const paquete = DATOS;
  for (const actividad of antiguas) {
    // Un día antes de su inicio se selecciona por sus propias fechas, sin edición.
    const antes = new Date(Date.parse(`${actividad.inicio}T00:00:00Z`) - DIA_MS).toISOString().slice(0, FIN_FECHA);
    const informe = cibernariumDelInforme({ ...paquete, cibernarium: [actividad] }, antes);
    const f = informe?.formaciones[0];
    assert.ok(f, actividad.id);
    assert.deepEqual(
      [f.inicio, f.fin, f.modalidad, 'edicion' in f],
      [actividad.inicio, actividad.fin, actividad.modalidad, false],
    );
  }
});

test('a tu ritmo se ofrece hasta su fin publicado', () => {
  const ritmo = {
    ...horarioFijo(),
    edicion: edicionPropia({ sincronia: 'a-tu-ritmo', disponibilidad: { desde: '2026-10-01', hasta: '2026-10-20' } }),
  };
  assert.equal(formaciones(datosCon([ritmo])).length, 1);
  assert.equal(cibernariumDelInforme(datosCon([ritmo]), '2026-10-21'), null);
});
