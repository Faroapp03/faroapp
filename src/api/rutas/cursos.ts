// GET /api/cursos: la sección «Cursos» (motores/cursos/src/catalogo-de-cursos.ts): la bolsa de cursos del día filtrada,
// en una sola lista por páginas y con el recuento de cada opción de cada filtro. Solo lee: en el Worker cuenta en el
// límite de lecturas por red, como las demás consultas (exigirLecturaDeLaRed, api/contexto-api.ts).
// La consulta admite `q` (texto del nombre, la entidad o la familia), `cuando`, `modalidad`, `tema` («ia» o una familia
// profesional), `nivel`, `quien`, `fuente` y `pagina`, y `fecha` (AAAA-MM-DD) para la bolsa de ese día; por defecto,
// hoy en UTC.
// Los filtros se validan con su contrato (compartido/contratos/filtros-de-cursos.ts), sin cargar el motor; el catálogo
// se pide al motor de cursos por su puerta (plataforma/motor-de-cursos.ts), en su trabajador si lo tiene: si no está
// disponible, la ruta responde 503 y el resto de la API sigue igual.

import { FUENTES_DE_CURSOS, OPCIONES_DE_CURSOS } from '../../../compartido/contratos/filtros-de-cursos.ts';
import type { FiltrosDeCursos } from '../../../motores/cursos/src/index.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../comun/protocolo-web.ts';
import { hoyUtc } from '../../comun/tiempo.ts';
import { motorDeCursos, type PuertaDelMotor, type SinMotor } from '../../plataforma/motor-de-cursos.ts';
import { MAX_BUSQUEDA, MAX_RELATO } from '../../seguridad/limites.ts';
import { textoParaBuscar } from '../../seguridad/texto-para-buscar.ts';
import { type ContextoApi, type ManejadorRuta, responder, responderUnProblema } from '../contexto-api.ts';
import { SolicitudInvalida } from '../http.ts';

const FECHA = /^\d{4}-\d{2}-\d{2}$/u;
const LARGO_FECHA = 10;
/** El nombre de una familia profesional del catálogo no pasa de unas pocas palabras. */
const MAX_TEMA = 120;
const MAX_PAGINA = 10_000;

/** Una opción de la consulta que tiene que ser una de las admitidas; undefined si no viene o viene vacía. */
function opcion<Valor extends string>(url: URL, nombre: string, admitidas: readonly Valor[]): Valor | undefined {
  const valor = url.searchParams.get(nombre);
  if (valor === null || valor === '') {
    return undefined;
  }
  if (!(admitidas as readonly string[]).includes(valor)) {
    throw new SolicitudInvalida(`${nombre} no admite ese valor`);
  }
  return valor as Valor;
}

/** La fecha de la consulta, si es un día real; si no viene, hoy. */
function fechaDe(url: URL): string {
  const fecha = url.searchParams.get('fecha');
  if (fecha === null) {
    return hoyUtc();
  }
  const leida = new Date(`${fecha}T00:00:00Z`);
  if (!(FECHA.test(fecha) && !Number.isNaN(leida.getTime()) && leida.toISOString().slice(0, LARGO_FECHA) === fecha)) {
    throw new SolicitudInvalida('fecha tiene la forma AAAA-MM-DD y es un día real');
  }
  return fecha;
}

/** La página pedida: un entero de 1 en adelante. */
function paginaDe(url: URL): number {
  const texto = url.searchParams.get('pagina');
  if (texto === null) {
    return 1;
  }
  const pagina = Number(texto);
  if (!(Number.isInteger(pagina) && pagina >= 1 && pagina <= MAX_PAGINA)) {
    throw new SolicitudInvalida('pagina es un número entero desde 1');
  }
  return pagina;
}

/** Los filtros de la consulta, con las opciones que admite su contrato. */
function filtrosDe(url: URL): FiltrosDeCursos {
  const texto = url.searchParams.get('q') ?? '';
  if (texto.length > MAX_RELATO) {
    throw new SolicitudInvalida('la consulta es demasiado larga');
  }
  const tema = url.searchParams.get('tema') ?? '';
  if (tema.length > MAX_TEMA) {
    throw new SolicitudInvalida('el tema es demasiado largo');
  }
  const elegidos = {
    cuando: opcion(url, 'cuando', OPCIONES_DE_CURSOS.cuando),
    modalidad: opcion(url, 'modalidad', OPCIONES_DE_CURSOS.modalidad),
    nivel: opcion(url, 'nivel', OPCIONES_DE_CURSOS.nivel),
    quien: opcion(url, 'quien', OPCIONES_DE_CURSOS.quien),
    fuente: opcion(url, 'fuente', FUENTES_DE_CURSOS),
    tema: tema || undefined,
  };
  // Lo que no viene no filtra: fuera del objeto, no como undefined.
  const puestos = Object.fromEntries(Object.entries(elegidos).filter(([, valor]) => valor !== undefined));
  return { texto: textoParaBuscar(texto).slice(0, MAX_BUSQUEDA), ...puestos } as FiltrosDeCursos;
}

/** El motivo del problema cuando falta el motor de cursos (el final de su `type`). */
const MOTIVO_SIN_MOTOR = 'motor_de_cursos_no_disponible';

/**
 * El 503 de una ruta que necesita el motor de cursos cuando no está disponible: un problema en castellano, sin el
 * motivo acotado, que queda en el registro.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param sin - Por qué no está el motor.
 * @param que - Lo que no se puede dar sin él, para la persona.
 * @returns La respuesta 503.
 */
export function responderSinMotorDeCursos(
  contexto: ContextoApi,
  peticion: Request,
  sin: SinMotor,
  que: string,
): Response {
  console.warn(`Faro: el motor de cursos no está disponible (${sin.motivo}).`);
  return responderUnProblema(contexto, peticion, {
    type: `${RAIZ_DE_LOS_PROBLEMAS}${MOTIVO_SIN_MOTOR}`,
    title: 'Motor de cursos no disponible',
    status: ESTADO_HTTP.noDisponible,
    detail: `${que} no está disponible ahora mismo. El resto de Faro sigue funcionando; vuelve a intentarlo más tarde.`,
    error: MOTIVO_SIN_MOTOR,
    motivo: sin.motivo,
  });
}

/**
 * GET /api/cursos con el motor de una puerta: la API de cada despliegue usa la de la app; las pruebas, la suya.
 *
 * @param puerta - La puerta del motor de cursos.
 * @returns El manejador de la ruta.
 */
export function cursosCon(puerta: PuertaDelMotor): ManejadorRuta {
  return async (contexto, peticion, url) => {
    const hoy = fechaDe(url);
    const pagina = paginaDe(url);
    // Los filtros se leen fuera de la operación: una consulta mal hecha es un 400, no un motor averiado.
    const filtros = filtrosDe(url);
    const resultado = await puerta.operar('catalogoDeCursos', [{ hoy, oferta: contexto.oferta, filtros, pagina }], {
      datos: contexto.datos,
      senal: peticion.signal,
    });
    peticion.signal.throwIfAborted();
    if (!resultado.disponible) {
      return responderSinMotorDeCursos(contexto, peticion, resultado, 'La sección «Cursos»');
    }
    return responder(contexto, peticion, ESTADO_HTTP.correcto, resultado.valor);
  };
}

/**
 * GET /api/cursos: los cursos del día que cumplen los filtros, la página pedida y el recuento de cada opción de cada
 * filtro.
 *
 * @param contexto - El contexto de la API.
 * @param peticion - La petición.
 * @param url - La dirección de la consulta.
 * @returns La página de la sección «Cursos».
 * @throws {Error} SolicitudInvalida si un parámetro no tiene un valor admitido.
 */
export const cursos: ManejadorRuta = cursosCon(motorDeCursos);
