// Contrato de barcelonactiva.json en el paquete y de las formaciones del Cibernàrium en el informe. Solo declara
// formas; las reglas de selección por fechas están en el motor de cursos (motores/cursos/src/barcelona-activa.ts).

/** Una formación de IA del Cibernàrium en el paquete: lo justo para enlazarla. */
export interface ActividadCibernarium {
  id: string;
  /** El título tal como lo publica el Cibernàrium, en catalán: el nombre mínimo para el enlace. */
  titulo: string;
  /** Primer y último día (AAAA-MM-DD). */
  inicio: string;
  fin: string;
  modalidad: 'en-linea' | 'presencial';
  /** Revisión de esta edición; ausencia significa datos aún no acreditados. */
  edicion?: EdicionCibernarium;
}

/** Lo que trae el paquete barcelonactiva.json. */
export interface DatosBarcelonaActiva {
  cita: string;
  /** Día (AAAA-MM-DD) en que se guardaron las páginas. */
  consulta: string;
  /** La dirección de una ficha del catálogo sin su identificador, y la de una actividad del Cibernàrium. */
  url_ficha: string;
  url_actividad: string;
  /** El identificador de la ficha de cada código ESCO que tiene una sola. */
  ocupaciones: Record<string, string>;
  cibernarium: ActividadCibernarium[];
}

/** Una formación del Cibernàrium en el informe: su enlace, su título (en catalán), sus días y su modalidad. */
export interface FormacionCibernarium {
  titulo: string;
  enlace: string;
  inicio: string;
  fin: string;
  modalidad: ActividadCibernarium['modalidad'];
  edicion?: EdicionCibernarium;
}

/** Las formaciones del Cibernàrium del informe, con la cita de la fuente y el día de la copia. */
export interface CibernariumDelInforme {
  formaciones: FormacionCibernarium[];
  fuente: string;
  consulta: string;
}

/** Hechos de una única edición revisada; los desconocidos son null, no acceso acreditado. */
export interface EdicionCibernarium {
  idFuente: string | null;
  /** Identidad propia ba-edicion-v1:SHA256(actividad, disponibilidad, sesiones); nunca un ID atribuido a la fuente. */
  identidadInterna: string;
  /** La edición propia de la actividad: la de `listEditions` con su mismo `activityId`. */
  vinculacion: 'id-edicion-publicado';
  modalidad: 'en-linea' | 'presencial' | 'mixta' | null;
  sincronia: 'a-tu-ritmo' | 'horario-fijo' | null;
  horas: number | null;
  /** Literal factual de duración, sin objetivos ni descripción del curso. */
  duracionPublicada: string | null;
  idioma: string | null;
  disponibilidad: { desde: string; hasta: string } | null;
  sesiones: { fecha: string; inicioLocal: string | null; finLocal: string | null }[];
  inscripcion: {
    continuaDeclarada: boolean | null;
    apertura: { fecha: string; horaLocal: string | null } | null;
    /** Si la fuente muestra hoy el botón de inscripción; null si no lo dice o la formación no se ha visto hoy. */
    botonVisible: boolean | null;
    /** Estado de la inscripción que publica la fuente: DISP0 abierta, DISP52 apertura futura; null si no consta. */
    estado: 'abierta' | 'apertura-futura' | null;
  };
  /** «sin-plazas» si la fuente la da por completa; null si no consta. */
  plazas: 'sin-plazas' | null;
  evidencia: {
    url: string;
    observadoUTC: string;
    origenFechaObservacion: 'consulta-http' | 'mtime-captura-previa';
    sha256Captura: string;
    normalizacionFechas: 'intervalo-publicado' | 'ano-del-registro-original';
    localizador: string;
    /** Huella de la revisión de metadatos comprobada por preparar/validar. No contiene ni exige HTML. */
    revisionSha256?: string;
  };
}
