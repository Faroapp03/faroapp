// Entrada pública del motor de cursos: lo único que puede importar el resto de la app (src/api, src/presentacion,
// src/plataforma, src/dominio, herramientas y pruebas). Los archivos internos del motor se importan entre sí con rutas
// relativas; desde fuera, solo desde aquí. Ver motores/cursos/README.md.

export type {
  CitilabDelInforme,
  CursoCitilab,
  CursoCitilabOficial,
  DatosCitilab,
  FranjaCitilab,
  MomentoCitilab,
  TramoCitilab,
} from '../../../compartido/contratos/tipos-citilab.ts';
export type {
  DatosComarcas,
  DatosTemarios,
  EquivalenciaDeMunicipio,
  TemarioOficial,
} from '../../../compartido/contratos/tipos-comarcas-y-temarios.ts';
export type {
  CertificacionActic,
  CertificacionDelTramo,
  ContactoEntidad,
  Correspondencia,
  CursoRelacionado,
  DatosActic,
  DatosConsorci,
  DatosFormacion,
  DestinatariosCurso,
  EdicionesRelacionadas,
  EdicionRelacionada,
  EnlacesComprobados,
  EspecialidadRelacionada,
  EspecialidadTransversal,
  FormacionRelacionada,
  FormacionTransversal,
  MomentoCurso,
  PrevistaRelacionada,
  ProgramaOficial,
  TramoTransversal,
} from '../../../compartido/contratos/tipos-formacion.ts';
export type {
  CursoAbierto,
  DatosFormacionAbierta,
  FormacionAbierta,
  NivelAbierto,
} from '../../../compartido/contratos/tipos-formacion-abierta.ts';
export type { CibernariumDelInforme, DatosBarcelonaActiva, FormacionCibernarium } from './barcelona-activa.ts';
export { fichaDeBarcelonaActiva } from './barcelona-activa.ts';
export { FUENTES_DE_CURSOS } from './bolsa-de-cursos.ts';
export type { FiltrosDeCursos } from './catalogo-de-cursos.ts';
export { catalogoDeCursos, OPCIONES_DE_CURSOS } from './catalogo-de-cursos.ts';
export type { CriterioDigitalTransversal } from './criterio-digital-transversal.ts';
export { CATALOGO_SEPE, consorciDe, formacionComprobada } from './enlaces-comprobados.ts';
export { formacionDelGrupo, formacionPara } from './formacion.ts';
export { formacionAbiertaDelInforme } from './formacion-abierta.ts';
export { citilabDelInforme, itinerarioCitilab } from './formacion-citilab.ts';
export { entidadesQueLaOfrecen, programadasSinFecha } from './formacion-consorci.ts';
export type { FormacionDelInforme, OfertaPrevista, PeticionDeFormacion } from './formacion-del-informe.ts';
export { formacionDeLaOcupacion, formacionDelInforme } from './formacion-del-informe.ts';
export type { DatosFundae } from './formacion-fundae.ts';
export { formacionDigitalTransversal } from './formacion-transversal.ts';
export type { OfertaDeFormacion } from './oferta-de-formacion.ts';
export { descripcionDeLaOferta, MODOS_FORMACION_ABIERTA, OFERTA_POR_DEFECTO } from './oferta-de-formacion.ts';
export { diasEntreFechas, MAX_DIAS_COPIA_CURSOS, ordenDeConvocatorias } from './vigencia-cursos.ts';
