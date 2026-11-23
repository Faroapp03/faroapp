// Guardas del contrato factual, sin completar desconocidos ni decidir acceso personal.
import { esBooleano, esNuloO, esObjeto, type Guarda } from '../comun/json.ts';
import { esCalendario, esDiaCivil } from './calendarios.ts';
import {
  ALCANCES_HECHO,
  CAMPOS_CALENDARIO,
  CAMPOS_HECHOS,
  CAMPOS_SIN_PROYECCION,
  type CalendarioCatalogo,
  type CampoHecho,
  COLECTIVOS_FUNDAE,
  COSTES,
  type EntregaCatalogo,
  type EvidenciaMateriaCatalogo,
  type HechoCatalogo,
  type HechosCatalogo,
  MAX_FILAS_CATALOGO,
  MAX_IDIOMAS_CATALOGO,
  MODALIDADES,
  MOTIVOS_HECHO,
  type OfertaCatalogo,
  SINCRONIAS,
  VERSION_CATALOGO,
  VERSION_CATALOGO_ANTERIOR,
  VERSION_CATALOGO_CON_CLASIFICACION,
  VERSION_CATALOGO_CON_MATERIA,
} from './contrato.ts';
import { esClasificacion } from './forma-clasificacion.ts';
import {
  compararTextos,
  esFecha,
  esSha,
  esTexto,
  esUrl,
  esUrlDeDominioPublico,
  forma,
  lista,
  unaDe,
} from './guardas.ts';
import { TEMAS_CURSOS } from './temario.ts';

export { compararTextos, esFecha, esSha, esUrl };

const esNulo = (valor: unknown): valor is null => valor === null;
const esNumero = (valor: unknown): valor is number => typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
const esCuenta = (valor: unknown): valor is number =>
  esNumero(valor) && Number.isSafeInteger(valor) && valor <= MAX_FILAS_CATALOGO;

const esMoneda = (valor: unknown): valor is string => typeof valor === 'string' && /^[A-Z]{3}$/u.test(valor);
const camposHecho = {
  valor: (valor: unknown): valor is HechoCatalogo['valor'] =>
    valor === null ||
    esTexto(valor) ||
    esNumero(valor) ||
    esBooleano(valor) ||
    lista(esTexto, MAX_IDIOMAS_CATALOGO)(valor) ||
    esCalendario(valor),
  motivo: unaDe(MOTIVOS_HECHO),
  unidad: esNuloO(unaDe(['h'])),
  moneda: esNuloO(esMoneda),
  alcance: unaDe(ALCANCES_HECHO),
};
const hechoSinPlazo = forma(camposHecho);
const hechoComprobado = forma({
  ...camposHecho,
  vigencia: forma({ comprobado_el: esFecha }),
});
function formaHecho(valor: unknown): valor is HechoCatalogo {
  return hechoSinPlazo(valor) || (hechoComprobado(valor) && valor.motivo === 'conocido');
}
function idiomasOrdenados(idiomas: readonly string[]): boolean {
  let anterior: string | undefined;
  for (const idioma of idiomas) {
    if (anterior !== undefined && compararTextos(anterior, idioma) >= 0) {
      return false;
    }
    anterior = idioma;
  }
  return true;
}
const esIdiomas = (valor: unknown): valor is readonly string[] =>
  lista(esTexto, MAX_IDIOMAS_CATALOGO)(valor) && valor.length > 0 && idiomasOrdenados(valor);
const VALORES: Record<CampoHecho, Guarda<unknown>> = {
  idiomas_declarados: esIdiomas,
  idiomas_material_observado: esIdiomas,
  modalidad: unaDe(MODALIDADES),
  sincronia: unaDe(SINCRONIAS),
  horas_publicadas: esNumero,
  coste_formacion_tipo: unaDe(COSTES),
  coste_formacion: esNumero,
  certificado_gratuito: esBooleano,
  coste_certificado: esNumero,
  coste_practicas: esNumero,
  requiere_registro_previo: esBooleano,
  requisitos_publicados: esNulo,
  acceso_fundae: esNulo,
  marca_comercial: esNulo,
  nivel_entrada: esNulo,
  nivel_salida: esNulo,
  calendario_matricula: (v): v is CalendarioCatalogo => esCalendario(v) && v.tipo === 'matricula',
  calendario_formacion: (v): v is CalendarioCatalogo =>
    esCalendario(v) && (v.tipo === 'periodo-formativo' || v.tipo === 'sesiones'),
  calendario_aula: (v): v is CalendarioCatalogo => esCalendario(v) && v.tipo === 'ventana-acceso',
};
const MONETARIOS: readonly string[] = ['coste_formacion', 'coste_certificado', 'coste_practicas'];

function esHecho(campo: CampoHecho, valor: unknown): valor is HechoCatalogo {
  return (
    formaHecho(valor) &&
    (valor.valor !== null) === (valor.motivo === 'conocido') &&
    valor.unidad === (campo === 'horas_publicadas' ? 'h' : null) &&
    (MONETARIOS.includes(campo) || valor.moneda === null) &&
    (valor.valor === null || VALORES[campo](valor.valor)) &&
    (!CAMPOS_CALENDARIO.some((c) => c === campo) || ['unidad', 'edicion'].includes(valor.alcance)) &&
    (!CAMPOS_CALENDARIO.some((c) => c === campo) ||
      valor.valor === null ||
      (valor.alcance === 'edicion' && valor.vigencia !== undefined)) &&
    (!CAMPOS_SIN_PROYECCION.some((c) => c === campo) ||
      (valor.valor === null &&
        valor.motivo === 'sin_soporte_de_campo' &&
        (valor.alcance === 'unidad' || valor.alcance === 'edicion')))
  );
}

function esHechos(valor: unknown): valor is HechosCatalogo {
  return (
    esObjeto(valor) &&
    Object.keys(valor).length === CAMPOS_HECHOS.length &&
    CAMPOS_HECHOS.every((campo) => Object.hasOwn(valor, campo) && esHecho(campo, valor[campo]))
  );
}

const referencia = forma({
  url: esUrl,
  sha256: esSha,
  fecha_referencia: esFecha,
  alcance: unaDe(['entidad']),
  naturaleza_fecha: unaDe(['no_acreditada', 'declarada_historica', 'recepcion_conservada']),
  naturaleza_documento: unaDe(['no_acreditada', 'derivado_negocio']),
});
const proveedor = forma({ id: esTexto, nombre: esTexto });
const vinculoMateria = forma({
  url: esUrlDeDominioPublico,
  sha256: esSha,
  capturado_utc: esFecha,
  localizador: esTexto,
});
const camposContenidoMateria = {
  metodo: unaDe(['cibernarium-descripcion-api-v1']),
  sha256: esSha,
  url: esUrlDeDominioPublico,
  sha256_captura: esSha,
  capturado_utc: esFecha,
  localizador: esTexto,
};
const contenidoMateriaAnterior = forma(camposContenidoMateria);
const temaSugerido = unaDe(TEMAS_CURSOS.filter((tema) => tema !== 'no-indicado'));
const contenidoMateriaConTemas = forma({
  ...camposContenidoMateria,
  temas_sugeridos: (valor: unknown): valor is readonly (typeof TEMAS_CURSOS)[number][] =>
    Array.isArray(valor) && valor.length > 0 && valor.every(temaSugerido) && new Set(valor).size === valor.length,
  reglas_sha256: esSha,
});
const nivelSugerido = forma({
  valor: unaDe(['inicial', 'intermedio', 'avanzado']),
  origen: unaDe(['categoria', 'descripcion']),
  regla: unaDe(['nivel-cibernarium-v1', 'nivel-cibernarium-v2', 'nivel-cibernarium-v3']),
});
const contenidoMateria = (valor: unknown): valor is NonNullable<EvidenciaMateriaCatalogo['contenido']> => {
  if (!esObjeto(valor) || !Object.hasOwn(valor, 'nivel_sugerido')) {
    return contenidoMateriaAnterior(valor) || contenidoMateriaConTemas(valor);
  }
  const { nivel_sugerido, ...anterior } = valor;
  return nivelSugerido(nivel_sugerido) && (contenidoMateriaAnterior(anterior) || contenidoMateriaConTemas(anterior));
};
const censoMateria = forma({
  ambito: unaDe(['ia']),
  url: esUrlDeDominioPublico,
  sha256: esSha,
  capturado_utc: esFecha,
  localizador: esTexto,
});
const evidenciaMateria: Guarda<EvidenciaMateriaCatalogo> = forma({
  version: (valor: unknown): valor is 1 => valor === 1,
  actividad_id: esTexto,
  programa_id: esTexto,
  edicion_id: esTexto,
  vinculo: vinculoMateria,
  contenido: esNuloO(contenidoMateria),
  censo_ia: esNuloO(censoMateria),
  estado_censo: unaDe(['completo', 'parcial', 'sin-evidencia']),
});
const camposOferta = {
  unidad: forma({ tipo: unaDe(['recurso', 'edicion']), id: esTexto, programa_id: esTexto }),
  proveedor_id: esTexto,
  titulo_programa: esTexto,
  tipo_unidad: esTexto,
  url: esUrl,
  hechos: esHechos,
  referencias: lista(referencia),
  comprobado_el: esFecha,
  cierra_el: esNuloO(esFecha),
  incidencia_enlace_el: esNuloO(esFecha),
  corte_evaluacion_utc: esFecha,
};
const ofertaV4 = forma(camposOferta);
const camposConMateria = { ...camposOferta, evidencia_materia: esNuloO(evidenciaMateria) };
const ofertaV5 = forma(camposConMateria);
const colectivos = lista(unaDe(COLECTIVOS_FUNDAE), COLECTIVOS_FUNDAE.length);
const contactoIndividual = /@|(?:^|[^\p{L}\p{N}_])[6789][0-9]{8}(?:$|[^\p{L}\p{N}_])/u;
const textoPublicado = (valor: unknown): valor is string =>
  esTexto(valor) && valor.trim().length > 0 && !contactoIndividual.test(valor);
const preinscripcion = forma({
  inicio: esDiaCivil,
  fin: esDiaCivil,
  centro: textoPublicado,
  sector: textoPublicado,
  colectivos: (v): v is readonly (typeof COLECTIVOS_FUNDAE)[number][] =>
    colectivos(v) && v.length > 0 && new Set(v).size === v.length,
});
const ofertaConPreinscripcion = forma({ ...camposConMateria, preinscripcion });
const idiomaPrograma = forma({
  valores: (v): v is readonly ['es'] => Array.isArray(v) && v.length === 1 && v[0] === 'es',
  url: esUrl,
  sha256: esSha,
});
const ofertaConPrograma = forma({ ...camposConMateria, idioma_programa: idiomaPrograma });
const ofertaConProgramaYPreinscripcion = forma({
  ...camposConMateria,
  preinscripcion,
  idioma_programa: idiomaPrograma,
});

/** Forma cerrada antes de comprobar relaciones y el intervalo admitido. */
const camposEntrega = {
  revision: esSha,
  corte_proyeccion_utc: esFecha,
  derechos: forma({
    alcance: unaDe(['indices_y_hechos_estructurados']),
    licencia_contenidos: esNulo,
    redistribuye_contenidos: (valor: unknown): valor is false => valor === false,
  }),
  proveedores: lista(proveedor),
  cobertura: forma({ recurso: esCuenta, edicion: esCuenta }),
};
const entregaV4 = forma({
  ...camposEntrega,
  schema_version: (valor: unknown): valor is typeof VERSION_CATALOGO_ANTERIOR => valor === VERSION_CATALOGO_ANTERIOR,
  ofertas: lista(ofertaV4),
});
const entregaV5 = forma({
  ...camposEntrega,
  schema_version: (valor: unknown): valor is typeof VERSION_CATALOGO_CON_MATERIA =>
    valor === VERSION_CATALOGO_CON_MATERIA,
  ofertas: lista(ofertaV5),
});
const evidenciaTemas = forma({
  unidad_id: esTexto,
  programa_id: esTexto,
  titulo: esTexto,
  url: esUrl,
  sha256: esSha,
  localizador: esTexto,
  reglas_sha256: esSha,
  temas: (v): v is readonly (typeof TEMAS_CURSOS)[number][] =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((t) => t !== 'no-indicado' && TEMAS_CURSOS.includes(t)) &&
    new Set(v).size === v.length,
});
const nivelObjetivos = forma({
  unidad_id: esTexto,
  programa_id: esTexto,
  titulo: esTexto,
  url: esUrl,
  sha256: esSha,
  localizador: esTexto,
  reglas_sha256: esSha,
  valor: unaDe(['inicial', 'intermedio', 'avanzado']),
  regla: esTexto,
  version: esTexto,
});
const nivelActividad = forma({
  valor: unaDe(['inicial', 'intermedio', 'avanzado']),
  literal: unaDe(['Básico', 'Intermedio', 'Avanzado']),
  actividad_id: esTexto,
  material_id: esTexto,
  url: esUrl,
  sha256: esSha,
  capturado_utc: esFecha,
  localizador: esTexto,
});
const nivelItinerario = forma({
  unidad_id: esTexto,
  programa_id: esTexto,
  titulo: esTexto,
  url: esUrl,
  sha256: esSha,
  localizador: esTexto,
  valor: unaDe(['inicial', 'intermedio']),
  version: unaDe(['cibernarium-itinerario-v1', 'cibernarium-ficha-tareas-v1']),
});
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: los campos opcionales se validan por separado.
function ofertaV6(valor: unknown): valor is OfertaCatalogo {
  if (!esObjeto(valor)) {
    return false;
  }
  if (Object.hasOwn(valor, 'nivel_objetivos')) {
    const { nivel_objetivos, ...resto } = valor;
    return nivelObjetivos(nivel_objetivos) && ofertaV6(resto);
  }
  if (Object.hasOwn(valor, 'nivel_actividad')) {
    const { nivel_actividad, ...resto } = valor;
    return nivelActividad(nivel_actividad) && ofertaV6(resto);
  }
  if (Object.hasOwn(valor, 'evidencia_temas')) {
    const { evidencia_temas, ...resto } = valor;
    return evidenciaTemas(evidencia_temas) && ofertaV6(resto);
  }
  if (Object.hasOwn(valor, 'nivel_itinerario')) {
    const { nivel_itinerario, ...resto } = valor;
    return nivelItinerario(nivel_itinerario) && ofertaV6(resto);
  }
  const programa = Object.hasOwn(valor, 'idioma_programa');
  const previa = Object.hasOwn(valor, 'preinscripcion');
  if (programa && previa) {
    return ofertaConProgramaYPreinscripcion(valor);
  }
  if (programa) {
    return ofertaConPrograma(valor);
  }
  if (previa) {
    return ofertaConPreinscripcion(valor);
  }
  return ofertaV5(valor);
}
const entregaV6 = forma({
  ...camposEntrega,
  schema_version: (valor: unknown): valor is typeof VERSION_CATALOGO => valor === VERSION_CATALOGO,
  ofertas: lista(ofertaV6),
});
/** La 7 es la 6 con el bloque `clasificacion` opcional en cada oferta. */
function ofertaV7(valor: unknown): valor is OfertaCatalogo {
  if (!(esObjeto(valor) && Object.hasOwn(valor, 'clasificacion'))) {
    return ofertaV6(valor);
  }
  const { clasificacion, ...resto } = valor;
  return esClasificacion(clasificacion) && ofertaV6(resto);
}
const entregaV7 = forma({
  ...camposEntrega,
  schema_version: (valor: unknown): valor is typeof VERSION_CATALOGO_CON_CLASIFICACION =>
    valor === VERSION_CATALOGO_CON_CLASIFICACION,
  ofertas: lista(ofertaV7),
});
export const esEntregaCatalogo: Guarda<EntregaCatalogo> = (valor): valor is EntregaCatalogo =>
  entregaV4(valor) || entregaV5(valor) || entregaV6(valor) || entregaV7(valor);
