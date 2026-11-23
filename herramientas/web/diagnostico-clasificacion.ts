/** Instantánea editorial de la entrega admitida, calculada con el mismo evaluador que la página de Cursos. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearEvaluadorClasificacion, type RevisionClasificacion } from '../../src/catalogo-cursos/clasificacion.ts';
import type { ReferenciaEntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';

export interface DiagnosticoClasificacion {
  readonly catalogoSha256: string;
  readonly revision: string;
  readonly revisionEditorialSha256: string;
  readonly revisionMateriasSha256: string;
  readonly total: number;
  readonly aplicadas: number;
  readonly unidades: readonly {
    readonly id: string;
    readonly tipo: 'recurso' | 'edicion';
    readonly proveedor: string;
    readonly titulo: string;
    readonly revision: RevisionClasificacion;
    readonly revisionNivel: RevisionClasificacion;
    readonly revisionContenido: RevisionClasificacion | null;
  }[];
}
export type ReferenciaDiagnostico = ReferenciaEntregaCatalogo & { readonly ruta: string };
const EDITORIAL = new URL('../../src/catalogo-cursos/clasificacion-revisada.json', import.meta.url);
const MATERIAS = new URL('../../src/catalogo-cursos/materias-revisadas.json', import.meta.url);
const SALIDA = 'administracion/clasificacion-catalogo.js';
const PLANTILLA = `/** En las fuentes no hay una instantánea construida. */
/** @type {import('./vista-clasificacion.js').Diagnostico|null} */
export const DIAGNOSTICO_CLASIFICACION = null;
`;

type RevisionEditorial = Parameters<typeof crearEvaluadorClasificacion>[0];
type RevisionMaterias = NonNullable<Parameters<typeof crearEvaluadorClasificacion>[1]>;
const SHA = /^[0-9a-f]{64}$/;

/** Copia las entradas una sola vez para compartir sus bytes con el evaluador y el paquete. */
export function capturarRevisiones(
  editorial: Uint8Array = readFileSync(EDITORIAL),
  materias: Uint8Array = readFileSync(MATERIAS),
): { readonly editorial: Uint8Array; readonly materias: Uint8Array } {
  const editorialCapturada = Uint8Array.from(editorial);
  const materiasCapturadas = Uint8Array.from(materias);
  return Object.freeze({
    get editorial() {
      return Uint8Array.from(editorialCapturada);
    },
    get materias() {
      return Uint8Array.from(materiasCapturadas);
    },
  });
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function textoBilingue(valor: unknown): boolean {
  return objeto(valor) && typeof valor.es === 'string' && !!valor.es && typeof valor.ca === 'string' && !!valor.ca;
}

function textoONulo(valor: unknown): boolean {
  return valor === null || typeof valor === 'string';
}

/** Valida la revisión de materia que se pasa al evaluador, a partir de sus propios bytes. */
function revisionMaterias(bytes: Uint8Array): RevisionMaterias {
  const dato: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!objeto(dato) || dato.schemaVersion !== 1 || !Array.isArray(dato.programas)) {
    throw new Error('Revisión de materias incompatible');
  }
  const ids = new Set<string>();
  for (const programa of dato.programas) {
    if (
      !objeto(programa) ||
      typeof programa.programaId !== 'string' ||
      !programa.programaId ||
      ids.has(programa.programaId) ||
      typeof programa.titulo !== 'string' ||
      !programa.titulo ||
      programa.proveedorId !== 'cibernarium' ||
      !Array.isArray(programa.temas) ||
      !programa.temas.every((t: unknown) => typeof t === 'string' && !!t) ||
      !objeto(programa.contenido) ||
      programa.contenido.metodo !== 'cibernarium-descripcion-api-v1' ||
      typeof programa.contenido.sha256 !== 'string' ||
      !SHA.test(programa.contenido.sha256) ||
      typeof programa.contenido.url !== 'string' ||
      !programa.contenido.url ||
      typeof programa.contenido.sha256Captura !== 'string' ||
      !SHA.test(programa.contenido.sha256Captura) ||
      typeof programa.contenido.capturadoEl !== 'string' ||
      !programa.contenido.capturadoEl ||
      typeof programa.contenido.localizador !== 'string' ||
      !programa.contenido.localizador
    ) {
      throw new Error('Programa de materias incompatible o duplicado');
    }
    ids.add(programa.programaId);
  }
  return dato.programas as unknown as RevisionMaterias;
}

/** Valida lo necesario para que el evaluador interprete la revisión sin inventar ausencias. */
function revisionEditorial(bytes: Uint8Array): RevisionEditorial {
  const dato: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !objeto(dato) ||
    dato.schemaVersion !== 1 ||
    typeof dato.catalogoSha256 !== 'string' ||
    !SHA.test(dato.catalogoSha256) ||
    !Array.isArray(dato.programas) ||
    !objeto(dato.unidadesRevisadas)
  ) {
    throw new Error('Revisión editorial incompatible');
  }
  const ids = new Set<string>();
  for (const programa of dato.programas) {
    if (!programaValido(programa) || ids.has(programa.programaId)) {
      throw new Error('Programa editorial incompatible o duplicado');
    }
    ids.add(programa.programaId);
  }
  comprobarFirmas(dato.unidadesRevisadas);
  return dato as unknown as RevisionEditorial;
}

function comprobarFirmas(unidades: Record<string, unknown>): void {
  for (const [identidad, firma] of Object.entries(unidades)) {
    let partes: unknown;
    try {
      partes = JSON.parse(identidad);
    } catch {
      throw new Error('Identidad editorial incompatible');
    }
    if (
      !Array.isArray(partes) ||
      partes.length !== 2 ||
      !['edicion', 'recurso'].includes(partes[0]) ||
      typeof partes[1] !== 'string' ||
      !partes[1] ||
      JSON.stringify(partes) !== identidad ||
      typeof firma !== 'string' ||
      !SHA.test(firma)
    ) {
      throw new Error('Firma editorial incompatible');
    }
  }
}

function programaValido(programa: unknown): programa is { programaId: string } {
  if (
    !objeto(programa) ||
    typeof programa.programaId !== 'string' ||
    !programa.programaId ||
    typeof programa.titulo !== 'string' ||
    !programa.titulo ||
    typeof programa.proveedorId !== 'string' ||
    !programa.proveedorId ||
    !Array.isArray(programa.temas) ||
    !programa.temas.every((t: unknown) => typeof t === 'string') ||
    !textoBilingue(programa.motivoTemas) ||
    !objeto(programa.nivel) ||
    !('evidencia' in programa.nivel) ||
    ![null, 'inicial', 'intermedio', 'avanzado'].includes(programa.nivel.valor as string | null) ||
    !['fuente', 'faro', 'por-confirmar'].includes(programa.nivel.origen as string) ||
    !textoBilingue(programa.nivel.motivo) ||
    !textoONulo(programa.nivel.literal) ||
    !textoONulo(programa.nivel.alcance) ||
    !textoONulo(programa.nivel.escala)
  ) {
    return false;
  }
  const evidencia = programa.nivel.evidencia;
  return (
    evidencia === null ||
    (objeto(evidencia) &&
      typeof evidencia.url === 'string' &&
      !!evidencia.url &&
      typeof evidencia.sha256 === 'string' &&
      SHA.test(evidencia.sha256))
  );
}

/** La referencia nula representa ausencia; una referencia presente exige el archivo y sus bytes exactos. */
function datosDeClasificacion(
  web: string,
  referencia: ReferenciaDiagnostico | null,
  editorial: Uint8Array,
  materias: Uint8Array = readFileSync(MATERIAS),
) {
  if (referencia === null) {
    return null;
  }
  if (
    !/^[0-9a-f]{64}$/.test(referencia.sha256) ||
    referencia.ruta !== `datos/catalogo-cursos/${referencia.sha256}.json`
  ) {
    throw new Error('Ruta de publicación de Cursos incompatible');
  }
  const catalogo = leerCatalogo(readFileSync(join(web, referencia.ruta)), referencia);
  const evaluador = crearEvaluadorClasificacion(revisionEditorial(editorial), revisionMaterias(materias));
  return { catalogo, evaluador, referencia };
}
function resumirClasificacion(
  datos: ReturnType<typeof datosDeClasificacion>,
  editorial: Uint8Array,
  materias: Uint8Array,
): DiagnosticoClasificacion | null {
  if (!datos) {
    return null;
  }
  const { catalogo, evaluador, referencia } = datos;
  const unidades = catalogo.ofertas.map((oferta) => {
    const evaluacion = evaluador.evaluarClasificacion(oferta);
    return {
      id: oferta.unidad.id,
      tipo: oferta.unidad.tipo,
      proveedor: oferta.proveedor_id,
      titulo: oferta.titulo_programa,
      revision: evaluacion.revision,
      revisionNivel: evaluacion.revisionNivel,
      revisionContenido: evaluacion.revisionContenido,
    };
  });
  return {
    catalogoSha256: referencia.sha256,
    revision: catalogo.revision,
    revisionEditorialSha256: createHash('sha256').update(editorial).digest('hex'),
    revisionMateriasSha256: createHash('sha256').update(materias).digest('hex'),
    total: unidades.length,
    aplicadas: unidades.filter((unidad) => unidad.revision.estado === 'aplicada').length,
    unidades,
  };
}

export function diagnosticoClasificacion(
  web: string,
  referencia: ReferenciaDiagnostico | null,
  editorial: Uint8Array,
  materias: Uint8Array = readFileSync(MATERIAS),
) {
  return resumirClasificacion(datosDeClasificacion(web, referencia, editorial, materias), editorial, materias);
}
/** Sustituye la plantilla neutra únicamente dentro de la candidata, antes de empaquetarla. */
export function prepararDiagnosticoClasificacion(
  web: string,
  referencia: ReferenciaDiagnostico | null = REFERENCIA,
  editorial: Uint8Array = readFileSync(EDITORIAL),
  materias: Uint8Array = readFileSync(MATERIAS),
) {
  if (readFileSync(join(web, SALIDA), 'utf8') !== PLANTILLA) {
    throw new Error('La plantilla de diagnóstico editorial no es neutra');
  }
  const datos = datosDeClasificacion(web, referencia, editorial, materias);
  const diagnostico = resumirClasificacion(datos, editorial, materias);
  writeFileSync(join(web, SALIDA), `export const DIAGNOSTICO_CLASIFICACION = ${JSON.stringify(diagnostico)};\n`);
  return datos;
}
