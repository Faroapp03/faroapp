// Minimiza lo escrito por la persona antes de citarlo en el informe.
// La moderación del recorrido local pertenece al motor del dispositivo.
import type { Idioma } from '../comun/idioma.ts';
import { recortarEnPalabras } from '../comun/recorte.ts';
import { MAX_OCUPACION_PERSONA } from '../dominio/ocupacion-confirmada.ts';
import type { Entrada } from '../dominio/tipos-entrada.ts';
import { AVISO_DATOS, AVISO_DATOS_CA, type Aviso } from '../seguridad/avisos.ts';
import { limpiarDatosPersonales } from '../seguridad/privacidad.ts';

const AVISO_DATOS_SEGUN_IDIOMA: Record<Idioma, string> = { es: AVISO_DATOS, ca: AVISO_DATOS_CA };
interface Limpieza {
  entrada: Entrada;
  eliminados: number;
}
export interface LoQueSeCita {
  entrada: Entrada;
  avisos: Aviso[];
}

/** La entrada sin la palabra con que la persona nombró su trabajo. */
function sinPalabra(entrada: Entrada): Entrada {
  const { ocupacionPersona: _quitada, ...resto } = entrada;
  return resto;
}

/** La palabra de la persona sin datos personales, en una línea y recortada; si no queda nada, la entrada sin ella. */
function conPalabraLimpia(entrada: Entrada): Limpieza {
  if (entrada.ocupacionPersona === undefined) {
    return { entrada, eliminados: 0 };
  }
  const { texto, eliminados } = limpiarDatosPersonales(entrada.ocupacionPersona.replace(/\s+/g, ' ').trim());
  const palabra = recortarEnPalabras(texto, MAX_OCUPACION_PERSONA).trim();
  const base = sinPalabra(entrada);
  return { entrada: palabra ? { ...base, ocupacionPersona: palabra } : base, eliminados };
}

/** Cada tarea con su texto sin datos personales. */
function conTareasLimpias(entrada: Entrada): Limpieza {
  const limpias = entrada.tareas.map((tarea) => ({ tarea, ...limpiarDatosPersonales(tarea.texto) }));
  const tareas = limpias.map(({ tarea, texto }) => ({ ...tarea, texto }));
  const eliminados = limpias.reduce((suma, limpia) => suma + limpia.eliminados, 0);
  return { entrada: { ...entrada, tareas }, eliminados };
}

/** Conserva los límites del filtro compartido y avisa de las sustituciones realizadas. */
export function loQueSeCita(entrada: Entrada, idioma: Idioma): LoQueSeCita {
  const conPalabra = conPalabraLimpia(entrada);
  const limpia = conTareasLimpias(conPalabra.entrada);
  const eliminados = conPalabra.eliminados + limpia.eliminados;
  const avisos: Aviso[] = eliminados > 0 ? [{ tipo: 'datos-personales', texto: AVISO_DATOS_SEGUN_IDIOMA[idioma] }] : [];
  return { entrada: limpia.entrada, avisos };
}
