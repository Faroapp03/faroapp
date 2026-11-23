// Las herramientas del servidor MCP: su definición (nombre, descripción, esquema de entrada estricto y anotaciones de
// solo lectura) y cómo se atiende una llamada. Son consultas a los datos comprobados de Faro, sujetas a los límites
// del canal y sin conservar el contenido de la consulta. Reciben texto de búsqueda o código oficial; el esquema no detecta datos personales.
// Una entrada que no cumple el esquema, un código que no existe o una ocupación que no es del grupo son errores de la
// herramienta (`isError`), con un mensaje que el asistente puede corregir; una herramienta que no existe es un error
// del protocolo (-32602), como pide la especificación.

import { validar } from '../../comun/esquema.ts';
import { EntradaInvalida } from '../../dominio/errores.ts';
import { esGrupoValido } from '../../dominio/grupos.ts';
import { HERRAMIENTAS as DEFINICIONES, type DefinicionDeHerramienta, LIMITES_DE_CANDIDATAS } from './definiciones.ts';

export { type DefinicionDeHerramienta, definiciones, HERRAMIENTA_DE_BUSQUEDA } from './definiciones.ts';

import {
  type AmbitoConsulta,
  acreditacionDeCompetencias,
  buscarOcupacion,
  type Consulta,
  contextoDelGrupo,
  explorarGrupos,
  fichaDelGrupo,
  formacionOficial,
  ocupacionDe,
} from './consultas.ts';
import { catalogoDatosGlobales, consultarDatosGlobales } from './datos-globales.ts';
import { CODIGO, ErrorMcp } from './protocolo.ts';

/** Límite en bytes UTF-8 del texto JSON de una respuesta de herramienta. */
export const MAX_RESPUESTA_BYTES = 32_000;
/** El contenido de texto de un resultado de herramienta (MCP, «CallToolResult»). */
interface ContenidoDeTexto {
  type: 'text';
  text: string;
}

/** El resultado de `tools/call`: un error que el asistente puede corregir, o el texto y los datos de la consulta. */
export type ResultadoDeHerramienta =
  | { content: ContenidoDeTexto[]; isError: true }
  | { content: ContenidoDeTexto[]; structuredContent: Consulta; isError: false };

/** Una herramienta: su definición pública (sin las anotaciones, iguales para todas) y cómo atiende sus argumentos ya validados. */
interface Herramienta extends Omit<DefinicionDeHerramienta, 'annotations'> {
  atender: (ambito: AmbitoConsulta, argumentos: Record<string, unknown>) => Consulta | null;
}

/** Argumento de texto (ya validado por el esquema). */
function texto(argumentos: Record<string, unknown>, clave: string): string | undefined {
  return typeof argumentos[clave] === 'string' ? argumentos[clave] : undefined;
}

/** El grupo de la consulta, que tiene que existir: un código bien formado puede no ser un grupo de la CIUO-08. */
function grupoExistente(ambito: AmbitoConsulta, argumentos: Record<string, unknown>): string {
  const isco = texto(argumentos, 'isco') ?? '';
  if (!esGrupoValido(ambito.datos, isco)) {
    throw new EntradaInvalida(`El grupo ${isco} no existe en la CIUO-08`);
  }
  return isco;
}

/** Error de herramienta: conserva el mensaje válido; una clave malformada no se copia al resultado firmado. */
function errorDeHerramienta(mensaje: string): ResultadoDeHerramienta {
  return {
    content: [
      {
        type: 'text',
        text: mensaje.isWellFormed() ? mensaje : 'Entrada no válida: los argumentos contienen Unicode malformado',
      },
    ],
    isError: true,
  };
}

/**
 * La atención de una herramienta que recibe un grupo existente y, si se da, una ocupación ESCO del mismo.
 *
 * @param consultar - La consulta, con el grupo ya comprobado y la ocupación opcional.
 * @returns La función `atender` de la herramienta.
 */
function conGrupoYOcupacion(
  consultar: (ambito: AmbitoConsulta, isco: string, esco: string | undefined) => Consulta | null,
): Herramienta['atender'] {
  return (ambito, argumentos) => consultar(ambito, grupoExistente(ambito, argumentos), texto(argumentos, 'esco'));
}

/** Ejecutores locales, asociados a las definiciones canónicas sin duplicar sus metadatos. */
const ATENDER: Record<string, Herramienta['atender']> = {
  buscar_ocupacion: (ambito, argumentos) =>
    buscarOcupacion(
      ambito,
      texto(argumentos, 'texto') ?? '',
      typeof argumentos.maximo === 'number' ? argumentos.maximo : LIMITES_DE_CANDIDATAS.porDefecto,
    ),
  explorar_grupos: (ambito, argumentos) => explorarGrupos(ambito, texto(argumentos, 'padre') ?? ''),
  ficha_grupo: (ambito, argumentos) => fichaDelGrupo(ambito, grupoExistente(ambito, argumentos)),
  formacion_oficial: conGrupoYOcupacion(formacionOficial),
  acreditacion_competencias: conGrupoYOcupacion(acreditacionDeCompetencias),
  contexto_del_grupo: conGrupoYOcupacion(contextoDelGrupo),
  catalogo_datos_globales: catalogoDatosGlobales,
  consultar_datos_globales: consultarDatosGlobales,
};
// Las definiciones canónicas tienen ejecutor; las pruebas verifican la correspondencia completa.
export const HERRAMIENTAS: readonly Herramienta[] = DEFINICIONES.map((definicion) => ({
  ...definicion,
  atender: ATENDER[definicion.name] as Herramienta['atender'],
}));

/**
 * Atiende `tools/call`: valida la entrada con el esquema de la herramienta y devuelve su resultado acotado.
 *
 * @param ambito - Los datos y la política con que se consulta.
 * @param parametros - Los `params` de la petición JSON-RPC: `name` y `arguments`.
 * @returns El resultado; una entrada no válida, un código que no existe o una respuesta que pasa de
 *   MAX_RESPUESTA_BYTES salen como resultado con `isError`, no como error del protocolo.
 * @throws {ErrorMcp} Si la herramienta no existe.
 */
export function llamarHerramienta(ambito: AmbitoConsulta, parametros: Record<string, unknown>): ResultadoDeHerramienta {
  const herramienta = HERRAMIENTAS.find((una) => una.name === parametros.name);
  if (!herramienta) {
    throw new ErrorMcp(CODIGO.parametros, 'Herramienta desconocida');
  }
  const argumentos = parametros.arguments ?? {};
  const errores = validar(argumentos, herramienta.inputSchema, 'arguments');
  if (errores.length) {
    return errorDeHerramienta('Entrada no válida: los argumentos no cumplen el esquema de la herramienta');
  }
  let resultado: Consulta | null;
  try {
    // validar acaba de comprobar que es un objeto: el esquema de cada herramienta es `type: 'object'`.
    resultado = herramienta.atender(ambito, argumentos as Record<string, unknown>);
  } catch (error) {
    if (error instanceof EntradaInvalida) {
      return errorDeHerramienta(error.message);
    }
    throw error;
  }
  if (!resultado) {
    return errorDeHerramienta('No existe ese código en la clasificación oficial');
  }
  const json = JSON.stringify(resultado);
  if (new TextEncoder().encode(json).byteLength > MAX_RESPUESTA_BYTES) {
    return errorDeHerramienta('La respuesta sería demasiado larga; pide un grupo más concreto');
  }
  return { content: [{ type: 'text', text: json }], structuredContent: resultado, isError: false };
}

/** Las herramientas que necesitan el motor de cursos: antes de atenderlas, se pide por su puerta. */
const HERRAMIENTAS_CON_EL_MOTOR: ReadonlySet<unknown> = new Set(['formacion_oficial']);

/**
 * La ocupación de una llamada a formacion_oficial, o null si sus argumentos no valen: entonces llamarHerramienta da el
 * error de la herramienta, sin pedir nada al motor.
 */
function ocupacionDeLaLlamada(ambito: AmbitoConsulta, parametros: Record<string, unknown>) {
  const herramienta = HERRAMIENTAS.find((una) => una.name === parametros.name);
  const argumentos = parametros.arguments ?? {};
  if (!herramienta || validar(argumentos, herramienta.inputSchema, 'arguments').length) {
    return null;
  }
  try {
    const leidos = argumentos as Record<string, unknown>;
    return ocupacionDe(ambito.datos, grupoExistente(ambito, leidos), texto(leidos, 'esco'));
  } catch {
    return null;
  }
}

/**
 * Atiende `tools/call` como llamarHerramienta, y antes, si la herramienta es de formación, pide la formación de la
 * ocupación al motor de cursos por la puerta del ámbito (operación formacionDeLaOcupacion, en su trabajador si lo
 * tiene): así su tiempo máximo solo lo espera esa consulta. Sin motor, la consulta de formación lo dice y las demás
 * responden igual.
 *
 * @param ambito - Los datos, la política y la puerta del motor de cursos.
 * @param parametros - Los `params` de la petición JSON-RPC: `name` y `arguments`.
 * @returns El resultado, como el de llamarHerramienta.
 * @throws {ErrorMcp} Si la herramienta no existe.
 */
export async function llamarHerramientaConElMotor(
  ambito: AmbitoConsulta,
  parametros: Record<string, unknown>,
): Promise<ResultadoDeHerramienta> {
  if (!HERRAMIENTAS_CON_EL_MOTOR.has(parametros.name) || !ambito.puertaDeCursos) {
    return llamarHerramienta(ambito, parametros);
  }
  const ocupacion = ocupacionDeLaLlamada(ambito, parametros);
  if (ocupacion === null) {
    return llamarHerramienta(ambito, parametros);
  }
  const formacionDeCursos = await ambito.puertaDeCursos.operar('formacionDeLaOcupacion', [ocupacion, ambito.hoy], {
    datos: ambito.datos,
  });
  return llamarHerramienta({ ...ambito, formacionDeCursos }, parametros);
}
