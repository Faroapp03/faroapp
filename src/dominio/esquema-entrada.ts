// La forma completa de la entrada interna del informe. Admite los casos locales del dominio (referencias
// equivalentes, estimaciones sin firma y de ejemplo); la API aplica además sus restricciones en api/esquemas.ts.

import { esBooleano, esFormaDe, esListaDe, esNumero, esOpcional, esTexto, type Guarda } from '../comun/json.ts';
import { esParDeNumeros } from './esquemas-paquete.ts';
import type { Entrada, TareaEntrada, Tiempo } from './tipos-entrada.ts';

function esTiempo(valor: unknown): valor is Tiempo {
  return valor === 'mucho' || valor === 'algo' || valor === 'poco';
}

const esReferencia = esFormaDe({
  tareaOit: esTexto,
  relacion: (valor: unknown): valor is 'propia' | 'equivalente' => valor === 'propia' || valor === 'equivalente',
});

const esEstimacion = esFormaDe({
  valor: esNumero,
  margen: esParDeNumeros,
  origen: (valor: unknown): valor is 'faro' | 'faro-sin-validar' | 'ejemplo' =>
    valor === 'faro' || valor === 'faro-sin-validar' || valor === 'ejemplo',
  referenciaCercana: esOpcional(esTexto),
  competencias: esOpcional(esListaDe(esTexto)),
  iaPodria: esOpcional(esTexto),
  loTuyo: esOpcional(esTexto),
  firma: esOpcional(esTexto),
  referencias: esOpcional(
    (valor: unknown): valor is 'ocupacion' | 'subgrupo' | 'oit' =>
      valor === 'ocupacion' || valor === 'subgrupo' || valor === 'oit',
  ),
  incierta: esOpcional(esBooleano),
});

const esTarea: Guarda<TareaEntrada> = esFormaDe({
  id: esTexto,
  texto: esTexto,
  tiempo: esTiempo,
  referencia: esOpcional(esReferencia),
  estimacion: esOpcional(esEstimacion),
});

/** Entrada interna con todos sus campos comprobados, sin normalizar ni sustituir sus datos. */
export const esEntrada: Guarda<Entrada> = esFormaDe({
  ocupacionEsco: esOpcional(esTexto),
  isco08: esOpcional(esTexto),
  isco08Secundario: esOpcional(esTexto),
  ocupacionPersona: esOpcional(esTexto),
  grupoPropuestoPorIa: esOpcional(esBooleano),
  sinIa: esOpcional(esBooleano),
  tareas: esListaDe(esTarea),
  fecha: esTexto,
});
