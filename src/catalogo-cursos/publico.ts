/** Entrada portátil del lector público, separada de motores, SQLite y registro privado. */

export { sha256Hex } from '../comun/huella.ts';
export { RelojAtrasado } from '../comun/reloj-atrasado.ts';
export { rangosEncontrados } from './busqueda.ts';
export { esCalendario } from './calendarios.ts';
export { cargarCatalogo, type PublicacionCatalogo } from './carga.ts';
export {
  CLASIFICACION_CATALOGO_SHA256,
  type EvidenciaClasificacion,
  type IdiomaClasificado,
  idiomaClasificadoDelCurso,
  type MetadatosClasificados,
  metadatosClasificados,
  type NivelClasificado,
  type NivelCurso,
  type TextoClasificacion,
} from './clasificacion.ts';
export {
  type ConsultaCatalogo,
  type ContextoConsulta,
  consultarCatalogo,
  type FiltrosCatalogo,
  idiomasDelCurso,
  proximaRevision,
} from './consulta.ts';
export type { CalendarioCatalogo, EntregaCatalogo, HechoCatalogo, OfertaCatalogo } from './contrato.ts';
export { CatalogoNoValido } from './contrato.ts';
export { leerCatalogo, ofertasVigentes } from './lectura.ts';
export {
  CAMPOS_FILTRO,
  type ConsultaListado,
  consultarListado,
  esperaHastaCierre,
  type FichaListado,
  type HechoFicha,
  type ListadoCursos,
  type OrigenIdiomaFicha,
} from './listado.ts';
export { origenIdiomaDelCurso, proyectarListado } from './proyeccion-listado.ts';
export { TEMAS_CURSOS, type TemaCurso } from './temario.ts';
export { temasDelCurso } from './temas.ts';
export { antesDelLimitePublicado } from './vigencia.ts';
