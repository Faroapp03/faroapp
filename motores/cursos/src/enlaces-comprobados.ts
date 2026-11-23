// Aplica al informe las observaciones de enlaces registradas en el paquete: programas del SEPE, webs de entidades
// del Consorci y fichas de los cursos del SOC. No consulta la red ni garantiza que un enlace siga respondiendo.
// Solo enlaza el PDF de una especialidad cuando su código figura como comprobado; el catálogo del SEPE sirve de
// alternativa. Oculta las webs y los cursos que el paquete trae con la evidencia vigente de que su dirección no existe
// (un 404 o un 410 observados); en cuanto una observación posterior lo contradice, el paquete deja de traerlos.
// Un paquete de la forma anterior (sin versión) sigue ocultando lo que ocultaba, hasta que traiga observaciones propias.
// Las cachés se vinculan a la identidad de cada copia del paquete y de sus listas, que se consumen sin modificarlas.

import { CATALOGO_SEPE } from '../../../compartido/contratos/formacion-del-informe.ts';
import type {
  DatosConsorci,
  DatosFormacion,
  EnlaceOculto,
  EnlacesComprobados,
  EnlacesComprobadosAnteriores,
  ProgramaOficial,
  ProgramasSepe,
} from '../../../compartido/contratos/tipos-formacion.ts';
import type { Datos } from '../../../src/dominio/tipos-paquete.ts';

// El buscador del catálogo del SEPE es un dato del contrato compartido: la app lo usa sin cargar el motor.
export { CATALOGO_SEPE };
/** La carpeta donde el SEPE publica los programas en PDF, cada uno con el código de su especialidad. */
export const CARPETA_DE_PROGRAMAS = 'https://sede.sepe.gob.es/es/portaltrabaja/resources/pdf/especialidades/';

/** El conjunto de cada lista de códigos, creado una vez. Dueño: este archivo; vive lo que vive su lista. */
const conjuntos = new WeakMap<readonly (string | EnlaceOculto)[], Set<string>>();
/** Los datos del Consorci sin las webs ocultas, depurados una vez por paquete. Dueño: este archivo; vive lo que vive su clave. */
const consorciDepurado = new WeakMap<
  DatosConsorci,
  { ocultas: readonly (string | EnlaceOculto)[]; depurado: DatosConsorci }
>();
/** La formación sin los cursos ocultos, depurada una vez por paquete. Dueño: este archivo; vive lo que vive su clave. */
const formacionDepurada = new WeakMap<
  DatosFormacion,
  { ocultos: readonly (string | EnlaceOculto)[]; depurada: DatosFormacion }
>();

/** La clave de una entrada de una lista de ocultos: la propia dirección o identificador, o el campo de su evidencia. */
function claveDe(entrada: string | EnlaceOculto, campo: 'url' | 'id'): string[] {
  if (typeof entrada === 'string') {
    return [entrada];
  }
  const clave = entrada[campo];
  return clave === undefined ? [] : [clave];
}

/** El conjunto de una lista de códigos, direcciones o identificadores, para preguntar si uno está sin recorrerla. */
function conjuntoDe(lista: readonly (string | EnlaceOculto)[], campo: 'url' | 'id' = 'url'): Set<string> {
  const guardado = conjuntos.get(lista);
  if (guardado) {
    return guardado;
  }
  const conjunto = new Set(lista.flatMap((entrada) => claveDe(entrada, campo)));
  conjuntos.set(lista, conjunto);
  return conjunto;
}

/**
 * La dirección en que el SEPE publicaría el programa de una especialidad. Que exista no está garantizado: solo la de
 * los códigos registrados como comprobados en el paquete. Algunos códigos llevan espacios («CTRD0018 (FCOI0018)»).
 *
 * @param codigo - El código de la especialidad.
 * @returns La dirección del PDF.
 * @throws {URIError} Si el código contiene un sustituto Unicode sin su pareja.
 */
export function direccionDelPrograma(codigo: string): string {
  return `${CARPETA_DE_PROGRAMAS}${encodeURIComponent(codigo)}.pdf`;
}

/**
 * El programa oficial de una especialidad si su código está registrado como comprobado en el paquete; si no, null.
 *
 * @param codigo - El código de la especialidad.
 * @param programas - Los programas comprobados del paquete.
 * @returns El programa con su fecha de comprobación, o null.
 */
export function programaOficial(codigo: string, programas: ProgramasSepe | undefined): ProgramaOficial | null {
  if (!programas || !conjuntoDe(programas.codigos).has(codigo)) {
    return null;
  }
  return { enlace: direccionDelPrograma(codigo), comprobado: programas.comprobado };
}

/** Las observaciones de enlaces de la forma nueva, o null si el paquete trae la forma anterior o ninguna. */
function observaciones(datos: Datos): EnlacesComprobados | null {
  const enlaces = datos.enlaces;
  return enlaces && 'version' in enlaces ? enlaces : null;
}

/** Lo que oculta la forma anterior del registro: webs rotas y cursos fuera de la oferta, sin evidencia por enlace. */
function anteriores(datos: Datos): EnlacesComprobadosAnteriores | null {
  const enlaces = datos.enlaces;
  return enlaces && !('version' in enlaces) ? enlaces : null;
}

/** Las webs que el paquete oculta, de cualquiera de sus dos formas. */
function websOcultas(datos: Datos): readonly (string | EnlaceOculto)[] | undefined {
  return observaciones(datos)?.webs.ocultas ?? anteriores(datos)?.webs.rotas;
}

/** Los cursos que el paquete oculta, de cualquiera de sus dos formas. */
function cursosOcultos(datos: Datos): readonly (string | EnlaceOculto)[] | undefined {
  return observaciones(datos)?.cursos.ocultos ?? anteriores(datos)?.cursos.fuera_de_la_oferta;
}

/** Un registro con la web de una entidad, sin ella si está entre las que no responden. */
function sinWebRota<Registro extends { web: string | null }>(registro: Registro, rotas: Set<string>): Registro {
  return registro.web && rotas.has(registro.web) ? { ...registro, web: null } : registro;
}

/**
 * Los datos del Consorci del paquete como los enseña el informe: sin las webs que el paquete trae ocultas. Null si
 * el paquete no trae el Consorci.
 *
 * @param datos - El paquete de datos.
 * @returns El Consorci depurado, o null.
 */
export function consorciDe(datos: Datos): DatosConsorci | null {
  const consorci = datos.consorci;
  const ocultas = websOcultas(datos);
  if (!consorci || !ocultas?.length) {
    return consorci ?? null;
  }
  const guardado = consorciDepurado.get(consorci);
  if (guardado?.ocultas === ocultas) {
    return guardado.depurado;
  }
  const conjunto = conjuntoDe(ocultas, 'url');
  const entidades = Object.fromEntries(
    Object.entries(consorci.entidades).map(([clave, entidad]) => [clave, sinWebRota(entidad, conjunto)]),
  );
  const depurado = {
    ...consorci,
    ediciones: consorci.ediciones.map((edicion) => sinWebRota(edicion, conjunto)),
    entidades,
  };
  consorciDepurado.set(consorci, { ocultas, depurado });
  return depurado;
}

/**
 * La formación del paquete como la enseña el informe: sin los cursos que el paquete trae ocultos. Undefined si
 * el paquete no trae la formación.
 *
 * @param datos - El paquete de datos.
 * @returns La formación depurada, o undefined.
 */
export function formacionComprobada(datos: Datos): DatosFormacion | undefined {
  const formacion = datos.formacion;
  const ocultos = cursosOcultos(datos);
  if (!formacion || !ocultos?.length) {
    return formacion;
  }
  const guardada = formacionDepurada.get(formacion);
  if (guardada?.ocultos === ocultos) {
    return guardada.depurada;
  }
  const conjunto = conjuntoDe(ocultos, 'id');
  const depurada = { ...formacion, cursos: formacion.cursos.filter((curso) => !conjunto.has(curso.id)) };
  formacionDepurada.set(formacion, { ocultos, depurada });
  return depurada;
}
