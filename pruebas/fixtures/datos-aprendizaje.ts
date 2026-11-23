// Fichas y contexto mínimos del catálogo: no dependen del paquete oficial ni de datos personales.

import type {
  CursoAbierto,
  CursoCitilab,
  CursoRelacionado,
  EdicionRelacionada,
  EspecialidadRelacionada,
} from '../../motores/cursos/src/index.ts';
import type { ContextoDelCatalogo } from '../../src/dominio/aprendizaje.ts';
import type { Competencia, TareaInforme } from '../../src/dominio/tipos-informe.ts';

/** Fecha lógica común de las convocatorias. */
export const FECHA_APRENDIZAJE = '2026-10-13';

/** Tarea sin nota para probar objetivos e identidad sin estimación. */
export function tareaAprendizaje(id: string, competencias: Competencia[] = []): TareaInforme {
  return {
    id,
    nombre: id,
    texto: `Texto ${id}`,
    tiempo: 'algo',
    peso: 2,
    valor: null,
    margen: null,
    franja: null,
    evidencia: 'insuficiente',
    incierta: false,
    origenValor: '',
    referencia: null,
    iaPodria: null,
    loTuyo: null,
    textosIa: false,
    competencias,
  };
}

/** Contexto vacío de formación, con las tareas dadas. */
export function contextoAprendizaje(tareas: TareaInforme[] = []): ContextoDelCatalogo {
  return {
    ocupacion: { esco: null, isco08: '7512', secundario: null },
    tareas,
    formacion: null,
    transversal: null,
    otrasOpciones: [],
    otrosGrupos: [],
    ofertaPrevista: null,
  };
}

/** Programa relacionado oficialmente con la ocupación. */
export function especialidadAprendizaje(codigo: string): EspecialidadRelacionada {
  return {
    codigo,
    nombre: `Programa ${codigo}`,
    nivel: '1',
    horas: '20',
    familia: 'Prueba',
    modalidad: 'Presencial',
    programa: null,
    relacion: 'ocupacion',
    correspondencia: 'exacta',
  };
}

/** Convocatoria SOC ya relacionada, en la fecha lógica. */
export function cursoAprendizaje(id: string): CursoRelacionado {
  return {
    id,
    nombre: `Curs ${id}`,
    especialidad: 'PROGRAMA',
    modalidad: 'Teleformació',
    municipio: 'Reus',
    inicio: '2026-10-20',
    fin: '2026-11-20',
    horas: '20',
    centro: 'Entidad',
    enlace: `https://example.test/${id}`,
    sugerencia: false,
    momento: 'por-iniciar',
    destinatarios: 'en-busqueda-de-empleo',
    comprobado: FECHA_APRENDIZAJE,
    inscripcion: 'sin-verificar',
    aDistancia: true,
    programa: null,
  };
}

/** Edición con la página oficial de contacto, sin contacto de una persona física. */
export function edicionAprendizaje(id: string): EdicionRelacionada {
  const { centro: _centro, enlace: _enlace, inscripcion: _inscripcion, ...curso } = cursoAprendizaje(id);
  return {
    ...curso,
    destinatarios: 'personas-ocupadas',
    contacto: {
      entidad: null,
      web: null,
      correo: null,
      telefono: null,
      contacto_oficial: 'https://example.test/contacto-oficial',
    },
    inscripcion: 'con-la-entidad',
  };
}

/** Curso Citilab vigente sin modalidad ni duración confirmadas. */
export function citilabAprendizaje(id: number, cambios: Partial<CursoCitilab> = {}): CursoCitilab {
  return {
    id,
    titulo: `Curs ${id}`,
    enlace: `https://example.test/citilab/${id}`,
    publico: [],
    modalidad: null,
    requisitos: 'ninguno',
    horas: null,
    sesiones: null,
    inicio: '2026-10-20',
    fin: '2026-11-20',
    horario: null,
    coste: { gratuito: null, precio_eur: null, carnet_citilaber: false, descuento_paro_pct: null },
    lugar: null,
    momento: 'por-iniciar',
    tramo: 'para-empezar',
    ...cambios,
  };
}

/** Ficha abierta básica, catalana y gratuita como oyente. */
export function abiertaAprendizaje(id: string, cambios: Partial<CursoAbierto> = {}): CursoAbierto {
  return {
    id,
    titulo: `Curs ${id}`,
    entidad: 'Entidad',
    titular: 'publico',
    enlace: `https://example.test/abierta/${id}`,
    idioma: 'ca',
    traduccionAutomatica: false,
    tema: 'digital',
    nivel: 'A1',
    horas: null,
    aTuRitmo: true,
    fin: null,
    dirigidoA: null,
    certificado: null,
    comprobado: FECHA_APRENDIZAJE,
    ...cambios,
  };
}
