// POST /api/clasificar: búsqueda local por palabras sobre el texto minimizado.
// Conserva las candidatas oficiales y las pistas de búsqueda en castellano y catalán.
import {
  type BusquedaCompleta,
  buscarConTodo,
  buscarEnElRelato,
  type Candidata,
} from '../../../motores/ocupaciones/src/index.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { IDIOMA_DE_LOS_DATOS, IDIOMA_POR_DEFECTO, type Idioma } from '../../comun/idioma.ts';
import { marcaIa } from '../../dominio/marca-ia.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import { AVISO_BUSQUEDA_POR_PALABRAS, AVISO_BUSQUEDA_POR_PALABRAS_CA } from '../../seguridad/avisos.ts';
import { MAX_BUSQUEDA } from '../../seguridad/limites.ts';
import { textoParaBuscar } from '../../seguridad/texto-para-buscar.ts';
import { type ContextoApi, responder, responderUnProblema } from '../contexto-api.ts';
import { candidataTraducida } from '../datos-traducidos.ts';
import { ESQUEMA_CLASIFICAR } from '../esquemas.ts';
import { conTareasTipicas } from '../fichas.ts';
import { leerCuerpoJson, problema, SolicitudInvalida } from '../http.ts';

const MIN_TEXTO = 2;
const PIDE_TEXTO = 'escribe a qué te dedicas';
const PIDE_TEXTO_SEGUN_IDIOMA: Record<Idioma, string> = { es: PIDE_TEXTO, ca: 'escriu a què et dediques' };
const AVISOS: Record<Idioma, string> = { es: AVISO_BUSQUEDA_POR_PALABRAS, ca: AVISO_BUSQUEDA_POR_PALABRAS_CA };
const SELECCION_NO_DISPONIBLE: Record<Idioma, string> = {
  es: 'La selección de ocupación no está disponible en esta instalación.',
  ca: 'La selecció d’ocupació no està disponible en aquesta instal·lació.',
};

/** El texto buscable conserva la misma minimización y el mismo límite que la consulta de ocupaciones. */
function textoBuscable(texto: string): string {
  return textoParaBuscar(texto, { omitirCorchetes: true }).slice(0, MAX_BUSQUEDA);
}

function candidatasParaEnsenar(
  datos: Datos,
  textoBuscado: string,
  candidatas: readonly Candidata[],
  idioma: Idioma,
): readonly Candidata[] {
  return candidatas.length > 0 ? candidatas : buscarEnElRelato(datos, textoBuscado, undefined, { idioma });
}

function busquedaParaLaPersona(
  { pistasDeSector, necesitaPrecision, area }: BusquedaCompleta,
  candidatasEnsenadas: readonly unknown[],
) {
  const sinComprension = candidatasEnsenadas.length === 0;
  if (!pistasDeSector.length && !necesitaPrecision && !area && !sinComprension) {
    return {};
  }
  return {
    busqueda: {
      ...(pistasDeSector.length ? { pistasDeSector } : {}),
      ...(necesitaPrecision ? { necesitaPrecision } : {}),
      ...(area ? { area } : {}),
      ...(sinComprension ? { sinComprension } : {}),
    },
  };
}

function candidatasParaLaPersona(datos: Datos, candidatas: readonly Candidata[], idioma: Idioma) {
  const conTareas = conTareasTipicas(datos, candidatas);
  if (idioma === IDIOMA_DE_LOS_DATOS) {
    return conTareas;
  }
  return conTareas.map((candidata) => candidataTraducida(datos, candidata, idioma));
}

/** La clasificación factual presenta candidatas oficiales y pistas de búsqueda. */
export async function clasificar(contexto: ContextoApi, peticion: Request): Promise<Response> {
  const { texto, idioma = IDIOMA_POR_DEFECTO } = await leerCuerpoJson(peticion, ESQUEMA_CLASIFICAR, PIDE_TEXTO);
  if (texto.trim().length < MIN_TEXTO) {
    throw new SolicitudInvalida(PIDE_TEXTO_SEGUN_IDIOMA[idioma]);
  }
  const { datos } = contexto;
  const textoBuscado = textoBuscable(texto);
  const busqueda = buscarConTodo(datos, textoBuscado, undefined, { idioma });
  const { candidatas } = busqueda;
  if (!contexto.caminoAMano) {
    return responderUnProblema(
      contexto,
      peticion,
      problema(ESTADO_HTTP.noDisponible, 'seleccion_no_disponible', SELECCION_NO_DISPONIBLE[idioma]),
    );
  }
  const paraLaPersona = candidatasParaLaPersona(
    datos,
    candidatasParaEnsenar(datos, textoBuscado, candidatas, idioma),
    idioma,
  );
  return responder(contexto, peticion, ESTADO_HTTP.correcto, {
    decision: 'explorar',
    grupos: [],
    candidatas: paraLaPersona,
    ...busquedaParaLaPersona(busqueda, paraLaPersona),
    avisos: [{ tipo: 'busqueda-por-palabras', texto: AVISOS[idioma] }],
    marcaIa: marcaIa([], {
      '/decision': 'reglas-de-faro',
      '/candidatas': 'datos-oficiales',
      '/avisos': 'reglas-de-faro',
    }),
  });
}
