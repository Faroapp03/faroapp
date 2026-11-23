/** Orientaciones de materia para el filtro; no modifican hechos, idioma ni dificultad. */
import { sha256Hex } from '../comun/huella.ts';
import { jsonCanonico } from '../comun/jcs.ts';
import { normalizar } from '../comun/texto.ts';
import type { EvaluacionClasificacion } from './clasificacion.ts';
import revisadas from './clasificacion-revisada.json' with { type: 'json' };
import type { OfertaCatalogo } from './contrato.ts';
import objetivos from './indicadores-objetivos.json' with { type: 'json' };
import indicadores from './indicadores-tema.json' with { type: 'json' };
import exteriores from './materias-proveedores.json' with { type: 'json' };
import materias from './materias-revisadas.json' with { type: 'json' };
import { TEMAS_CURSOS, type TemaCurso } from './temario.ts';

const TESAURO = indicadores as Readonly<Record<string, readonly string[]>>;
const HUELLA_OBJETIVOS = sha256Hex(new TextEncoder().encode(jsonCanonico(objetivos)));
const HUELLA_REGLAS = sha256Hex(new TextEncoder().encode(jsonCanonico(indicadores)));
const ANCLAS_CONTENIDO = new Map(materias.programas.map((item) => [item.programaId, item]));
const ANCLAS_EXTERNAS = new Map(exteriores.programas.map((item) => [item.programaId, item]));
const ANCLAS_EDITORIAL = new Map(revisadas.programas.map((item) => [item.programaId, item]));
const INDICADORES_POR_INICIO = new Map<string, { tema: TemaCurso; palabras: readonly string[] }[]>();
for (const tema of TEMAS_CURSOS) {
  for (const indicador of TESAURO[tema] ?? []) {
    const palabras = indicador.split(' ');
    const inicio = palabras[0];
    if (!inicio) {
      continue;
    }
    const entradas = INDICADORES_POR_INICIO.get(inicio) ?? [];
    entradas.push({ tema, palabras });
    INDICADORES_POR_INICIO.set(inicio, entradas);
  }
}
const NEGADORES = new Set(['no', 'sin', 'sense', 'ni', 'nunca', 'never', 'without', 'excepto', 'exclou']);
const REANUDADORES = new Set(['y', 'i', 'e', 'and', 'pero', 'but', 'para', 'per', 'for']);
const REQUISITOS_NEGADOS =
  /\b(?:sin|sense|without|no)\s+(?:(?:experiencia|experience|coneixements|conocimientos|knowledge)(?:\s+(?:previa|previas|previos|previs|previous|prior))?|(?:previa|previous|prior)\s+(?:experience|knowledge))\b/gu;

/** Solo señales completas afirmadas; una negación no elimina los demás temas del título. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: el recorrido mantiene el ámbito de cada negación.
export function sugerirTemasPorTitulo(titulo: string): readonly TemaCurso[] {
  let texto = normalizar(titulo);
  const presentacion = texto.indexOf(' presenta ');
  if (presentacion >= 0) {
    texto = texto.slice(presentacion + ' presenta '.length);
  }
  texto = texto.replace(REQUISITOS_NEGADOS, ' ').replace(/\bno solo\b/gu, ' ');
  const palabras = texto.split(/\s+/u).filter(Boolean);
  const webDestinataria = /\b(web|webs|pagina web|paginas web|lloc web)\b/u.test(texto);
  const encontrados = new Set<TemaCurso>();
  let negado = false;
  for (const [indice, palabra] of palabras.entries()) {
    if (NEGADORES.has(palabra)) {
      negado = true;
      continue;
    }
    if (REANUDADORES.has(palabra)) {
      negado = false;
      continue;
    }
    if (negado) {
      continue;
    }
    for (const entrada of INDICADORES_POR_INICIO.get(palabra) ?? []) {
      if (entrada.tema === 'oficio' && webDestinataria && /^(hosteleria|hostaleria)$/u.test(palabra)) {
        continue;
      }
      if (entrada.palabras.every((valor, desplazamiento) => palabras[indice + desplazamiento] === valor)) {
        encontrados.add(entrada.tema);
      }
    }
  }
  return TEMAS_CURSOS.filter((tema) => encontrados.has(tema));
}

/** Acepta solo materia proyectada para la misma edición y la versión de reglas vigente. */
function sugerenciasDeContenido(oferta: OfertaCatalogo, unidad: OfertaCatalogo['unidad']): readonly TemaCurso[] {
  const evidencia = oferta.evidencia_materia;
  const contenido = evidencia?.contenido;
  if (
    oferta.proveedor_id !== 'cibernarium' ||
    unidad.tipo !== 'edicion' ||
    !evidencia ||
    evidencia.version !== 1 ||
    evidencia.programa_id !== unidad.programa_id ||
    evidencia.edicion_id !== unidad.id ||
    unidad.programa_id !== `cibernarium:${evidencia.actividad_id}` ||
    !contenido ||
    contenido.metodo !== 'cibernarium-descripcion-api-v1' ||
    contenido.reglas_sha256 !== HUELLA_REGLAS ||
    !contenido.temas_sugeridos
  ) {
    return [];
  }
  return contenido.temas_sugeridos.filter((tema) => tema !== 'no-indicado' && TEMAS_CURSOS.includes(tema));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: la precedencia de anclajes debe ser explícita.
function decisionAnclada(
  oferta: OfertaCatalogo,
  evaluacion: EvaluacionClasificacion,
  unidad: OfertaCatalogo['unidad'],
): readonly TemaCurso[] | null {
  const anteriores = evaluacion.metadatos.temas;
  const programa = unidad.programa_id;
  const externa = ANCLAS_EXTERNAS.get(programa);
  if (externa) {
    const valida =
      unidad.tipo === 'recurso' &&
      unidad.id === externa.programaId &&
      externa.proveedorId === oferta.proveedor_id &&
      externa.titulo === oferta.titulo_programa &&
      oferta.referencias.some((r) => r.url === externa.evidencia.url && r.sha256 === externa.evidencia.sha256);
    return valida ? (externa.temas as TemaCurso[]) : anteriores;
  }
  // Una revisión conocida, incluida una lista vacía, es una decisión explícita. Si caduca, no se sustituye por heurística.
  if (ANCLAS_CONTENIDO.has(programa)) {
    return anteriores;
  }
  const editorial = ANCLAS_EDITORIAL.get(programa);
  if (editorial) {
    if (
      evaluacion.revision.estado === 'no-aplicada' &&
      evaluacion.revision.motivo === 'titulo-distinto' &&
      editorial.proveedorId === oferta.proveedor_id
    ) {
      // No se reutiliza la revisión antigua: se evalúa de cero el título actual admitido.
      const nuevas = sugerirTemasPorTitulo(oferta.titulo_programa);
      return nuevas.length ? nuevas : ['no-indicado'];
    }
    return anteriores;
  }
  if (
    evaluacion.revision.estado === 'no-aplicada' &&
    [
      'identidad-materia-distinta',
      'titulo-distinto',
      'proveedor-distinto',
      'firma-distinta',
      'unidad-sin-revision',
      'contenido-distinto',
    ].includes(evaluacion.revision.motivo)
  ) {
    return anteriores;
  }
  return null;
}

function sugerenciasDeObjetivos(oferta: OfertaCatalogo, unidad: OfertaCatalogo['unidad']): readonly TemaCurso[] {
  const fuenteObjetivos = oferta.evidencia_temas;
  return fuenteObjetivos &&
    fuenteObjetivos.unidad_id === unidad.id &&
    fuenteObjetivos.programa_id === unidad.programa_id &&
    fuenteObjetivos.titulo === oferta.titulo_programa &&
    fuenteObjetivos.reglas_sha256 === HUELLA_OBJETIVOS &&
    oferta.referencias.some((r) => r.url === fuenteObjetivos.url && r.sha256 === fuenteObjetivos.sha256)
    ? fuenteObjetivos.temas
    : [];
}

/** Conserva revisiones explícitas y orienta solo ofertas sin ancla editorial. */
export function temasParaFiltro(oferta: OfertaCatalogo, evaluacion: EvaluacionClasificacion): readonly TemaCurso[] {
  const unidad = oferta.unidad;
  const anteriores = decisionAnclada(oferta, evaluacion, unidad);
  if (anteriores) {
    return anteriores;
  }
  const evidencia = oferta.evidencia_materia;
  if (evidencia && (evidencia.edicion_id !== unidad.id || evidencia.programa_id !== unidad.programa_id)) {
    return evaluacion.metadatos.temas;
  }
  const propuestos = new Set<TemaCurso>([
    ...evaluacion.metadatos.temas.filter((tema) => tema !== 'no-indicado'),
    ...sugerenciasDeContenido(oferta, unidad),
    ...sugerenciasDeObjetivos(oferta, unidad),
    ...sugerirTemasPorTitulo(oferta.titulo_programa),
  ]);
  const resultado = TEMAS_CURSOS.filter((tema) => propuestos.has(tema));
  return resultado.length ? resultado : ['no-indicado'];
}
