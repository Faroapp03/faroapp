import { normalizar } from '../comun/texto.ts';
import type { EntregaCatalogo, OfertaCatalogo } from './contrato.ts';
import historial from './historial-idioma-cibernarium.json' with { type: 'json' };
import type { IdiomaEnriquecido } from './idioma-nivel.ts';

const CORTE_HISTORIAL = Date.parse(historial.fechaObservacion);
const MIN_EDICIONES = 40;
const MIN_PROGRAMAS = 15;
const FRECUENCIA_MINIMA = 0.95;
const PROGRAMAS_CON_VARIACION = new Set(Object.keys(historial.programasConOtroIdioma));
const TITULOS_CON_VARIACION = new Set(Object.values(historial.programasConOtroIdioma));
type Observacion = readonly [edicion: string, programa: string, modalidad: string, idiomas: readonly string[]];
export type OrientadorIdioma = (oferta: OfertaCatalogo) => IdiomaEnriquecido | null;

const ARCHIVO: readonly Observacion[] = historial.ediciones.map(([id, p, m, lengua]) => [
  `cibernarium-edicion:${id}`,
  p ?? '',
  m ?? '',
  [lengua ?? ''],
]);

function calibrar(modalidad: string, observaciones: readonly Observacion[]): boolean {
  const ediciones = observaciones.filter((e) => e[2] === modalidad);
  const catalan = ediciones.filter((e) => e[3].length === 1 && e[3][0] === 'ca').length;
  return (
    ediciones.length >= MIN_EDICIONES &&
    new Set(ediciones.map((e) => e[1])).size >= MIN_PROGRAMAS &&
    catalan / ediciones.length >= FRECUENCIA_MINIMA
  );
}

function modalidadesCalibradas(observaciones: readonly Observacion[]): ReadonlySet<string> {
  return new Set(['presencial', 'en-linea'].filter((modo) => calibrar(modo, observaciones)));
}

function orientar(
  oferta: OfertaCatalogo,
  modalidades: ReadonlySet<string>,
  programasConVariacion: ReadonlySet<string>,
): IdiomaEnriquecido | null {
  const { sincronia, modalidad, idiomas_declarados: idioma } = oferta.hechos;
  if (
    oferta.proveedor_id !== 'cibernarium' ||
    oferta.unidad.tipo !== 'edicion' ||
    !/^cibernarium-edicion:\d+$/u.test(oferta.unidad.id) ||
    !/^cibernarium:\d+$/u.test(oferta.unidad.programa_id) ||
    oferta.evidencia_materia?.edicion_id !== oferta.unidad.id ||
    oferta.evidencia_materia.programa_id !== oferta.unidad.programa_id ||
    sincronia.motivo !== 'conocido' ||
    sincronia.valor !== 'sincrona' ||
    modalidad.motivo !== 'conocido' ||
    !modalidades.has(String(modalidad.valor)) ||
    !['no_consta_en_evidencia', 'sin_soporte_de_campo'].includes(idioma.motivo) ||
    programasConVariacion.has(oferta.unidad.programa_id) ||
    TITULOS_CON_VARIACION.has(normalizar(oferta.titulo_programa))
  ) {
    return null;
  }
  return {
    valores: ['ca'],
    origen: 'faro',
    alcance: 'historial-cibernarium',
    evidencias: [],
    motivo: {
      es: 'Idioma probable según ediciones de la misma modalidad. Comprueba la lengua de esta sesión en la ficha.',
      ca: 'Idioma probable segons edicions de la mateixa modalitat. Comprova la llengua d’aquesta sessió a la fitxa.',
    },
  };
}

/**
 * El historial orienta cualquier entrega posterior a su observación, sin caducar por el paso del tiempo: solo lo
 * retira una observación que lo contradiga (una edición declarada en otro idioma o una modalidad que deja de ser
 * casi siempre en catalán). Una entrega anterior no puede apoyarse en ediciones que aún no se habían observado.
 */
function historialAplicable(corte: number): boolean {
  return corte >= CORTE_HISTORIAL;
}
const MODALIDADES_ARCHIVO = modalidadesCalibradas(ARCHIVO);

/** Orienta la lectura individual cuando solo está disponible el histórico fechado. */
export function orientarIdiomaCibernarium(oferta: OfertaCatalogo): IdiomaEnriquecido | null {
  return historialAplicable(Date.parse(oferta.corte_evaluacion_utc))
    ? orientar(oferta, MODALIDADES_ARCHIVO, PROGRAMAS_CON_VARIACION)
    : null;
}

function declaracionActual(oferta: OfertaCatalogo): Observacion | null {
  const { sincronia, modalidad, idiomas_declarados: idioma } = oferta.hechos;
  if (
    oferta.proveedor_id !== 'cibernarium' ||
    oferta.unidad.tipo !== 'edicion' ||
    sincronia.valor !== 'sincrona' ||
    modalidad.motivo !== 'conocido' ||
    idioma.motivo !== 'conocido' ||
    idioma.alcance !== 'edicion' ||
    !Array.isArray(idioma.valor) ||
    !idioma.valor.length
  ) {
    return null;
  }
  const idiomas = idioma.valor.map((valor) => {
    const lengua = normalizar(String(valor));
    return ['ca', 'catala', 'catalan'].includes(lengua) ? 'ca' : lengua;
  });
  return [oferta.unidad.id, oferta.unidad.programa_id, String(modalidad.valor), [...new Set(idiomas)]];
}

/** Cada entrega incorpora sus propias declaraciones verificadas y detecta cambios de idioma. */
export function orientadorDelCatalogo(catalogo: EntregaCatalogo): OrientadorIdioma {
  const archivo = historialAplicable(Date.parse(catalogo.corte_proyeccion_utc)) ? ARCHIVO : [];
  const observaciones = new Map(archivo.map((e) => [e[0], e]));
  const programasConVariacion = new Set(PROGRAMAS_CON_VARIACION);
  for (const oferta of catalogo.ofertas) {
    const declaracion = declaracionActual(oferta);
    if (declaracion) {
      observaciones.set(declaracion[0], declaracion);
      if (declaracion[3].some((lengua) => lengua !== 'ca')) {
        programasConVariacion.add(declaracion[1]);
      }
    }
  }
  const modalidades = modalidadesCalibradas([...observaciones.values()]);
  return (oferta) => orientar(oferta, modalidades, programasConVariacion);
}
