// Presentación de los periodos que declara la fuente, sin cambiar su corte ni inferir otro. Solo se reconoce
// su gramática mensual; cualquier denominación desconocida conserva el texto original y se marca en castellano.
import { alMesCatalan, nombresDeLosMeses } from '../../comun/fechas.js';
import { mesEnIdioma } from '../../comun/formato.ts';
import type { Idioma } from '../../comun/idioma.ts';
import { escapar } from '../html.ts';
import { conIdioma } from '../lengua-html.ts';

const MESES_DE_LA_FUENTE = new Set(nombresDeLosMeses('es'));
const PREFIJO_ANUAL = '12 meses a ';
const CIFRAS_DEL_ANIO = 4;

function mesDeLaFuente(valor: string): { mes: string; anio: string; anual: boolean } | null {
  const anual = valor.startsWith(PREFIJO_ANUAL);
  const partes = (anual ? valor.slice(PREFIJO_ANUAL.length) : valor).split(' de ');
  const [mes, anio] = partes;
  if (
    partes.length !== 2 ||
    !mes ||
    !MESES_DE_LA_FUENTE.has(mes) ||
    !anio ||
    anio.length !== CIFRAS_DEL_ANIO ||
    String(Number(anio)) !== anio
  ) {
    return null;
  }
  return { mes: mesEnIdioma(mes, 'ca'), anio, anual };
}

function hastaMes({ mes, anio }: { mes: string; anio: string }): string {
  return `${alMesCatalan(mes)} del ${anio}`;
}

/** Texto HTML de un periodo, con su idioma si la fuente usa una denominación ajena al contrato mensual. */
export function periodo(valor: string, idioma: Idioma): string {
  if (idioma === 'es') {
    return escapar(valor);
  }
  const fecha = mesDeLaFuente(valor);
  if (!fecha) {
    return conIdioma(escapar(valor), 'es');
  }
  return escapar(fecha.anual ? `12 mesos fins ${hastaMes(fecha)}` : `${fecha.mes} del ${fecha.anio}`);
}

/** Complemento de «hasta»: en catalán incluye su preposición y contracción correctas. */
export function finDelPeriodo(valor: string, idioma: Idioma): string {
  if (idioma === 'es') {
    return escapar(valor);
  }
  const fecha = mesDeLaFuente(valor);
  return fecha && !fecha.anual ? escapar(hastaMes(fecha)) : `a ${conIdioma(escapar(valor), 'es')}`;
}
