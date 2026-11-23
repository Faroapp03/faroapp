// La lengua de un informe: sus textos fijos en el idioma pedido y los datos oficiales en ese idioma,
// apuntando los que se quedan en otro (castellano o inglés) para que el HTML los marque con su `lang`. Las frases que
// escribió la IA en castellano pueden llegar traducidas en `frasesTraducidas` (el mapa se aporta
// desde fuera del dominio: el dominio no usa IA). Los datos originalmente castellanos no requieren traducción al
// castellano; los originales de otra lengua se apuntan para marcarlos con lang, también en un informe castellano.

import { IDIOMA_POR_DEFECTO, type Idioma, type IdiomaDeDato } from '../comun/idioma.ts';
import {
  type CampoDeTarea,
  type DatoEnIdioma,
  textoDeTareaEn,
  tituloCnoEn,
  tituloEscoEn,
  tituloIscoEn,
} from './datos-en-idioma.ts';
import { TEXTOS_INFORME_ES, type TextosInforme } from './textos-informe.ts';
import { TEXTOS_INFORME_CA } from './textos-informe-ca.ts';
import type { TextoSinTraducir } from './tipos-informe.ts';
import type { Datos } from './tipos-paquete.ts';

/** Con qué escribe un informe sus textos y sus datos oficiales. */
export interface Lengua {
  readonly idioma: Idioma;
  readonly textos: TextosInforme;
  /** El texto de un dato; si no está en el idioma del informe, se apunta. */
  usar(dato: DatoEnIdioma): string;
  /** Un texto de una fuente que Faro no traduce (CNO-11, competencias ESCO, SEPE…), en `idioma`. */
  original(texto: string, idioma: IdiomaDeDato): string;
  /** El título de un grupo ISCO-08 o, si no existe, su código. */
  tituloIsco(codigo: string): string;
  /** El título de un grupo CNO-11 o, si no existe, su código. */
  tituloCno(codigo: string): string;
  /** El título de una ocupación ESCO que existe, en el idioma del informe o, sin traducción, en castellano. */
  tituloEsco(esco: string): string;
  /** Un texto de una tarea oficial, o null si la tarea no lo tiene. */
  textoDeTarea(id: string, campo: CampoDeTarea): string | null;
  /**
   * Una frase escrita por la IA («La IA podría», «Lo tuyo»): traducida al idioma del informe si llegó su traducción;
   * si no, tal cual. No la apunta: eso lo hace usar().
   */
  fraseDeIa(frase: DatoEnIdioma): DatoEnIdioma;
  /** Los textos usados que no están en el idioma del informe, en el orden en que aparecieron y sin repetir. */
  sinTraducir(): TextoSinTraducir[];
  /** Si el informe usa alguna traducción de Faro. */
  hayTraducciones(): boolean;
}

/**
 * Los textos fijos del informe en `idioma`: los catalanes o, en cualquier otro caso, los castellanos.
 *
 * @param idioma - El idioma del informe.
 * @returns Los textos fijos de ese idioma.
 */
export function textosDelInforme(idioma: Idioma): TextosInforme {
  return idioma === 'ca' ? TEXTOS_INFORME_CA : TEXTOS_INFORME_ES;
}

/**
 * La lengua de un informe en `idioma`, sobre los datos del paquete, con las traducciones de las frases de la IA
 * (castellano → idioma del informe) aportadas por quien construye el informe.
 *
 * @param datos - El paquete de datos.
 * @param idioma - El idioma del informe; por defecto, el del producto.
 * @param frasesTraducidas - Frase en castellano → su traducción disponible.
 * @returns La lengua del informe.
 */
export function crearLengua(
  datos: Datos,
  idioma: Idioma = IDIOMA_POR_DEFECTO,
  frasesTraducidas: ReadonlyMap<string, string> = new Map(),
): Lengua {
  // Se indexa por texto: si el mismo texto se apunta con dos idiomas, el último idioma gana y el texto conserva la
  // posición de la primera vez.
  const apuntados = new Map<string, IdiomaDeDato>();
  let traducciones = 0;
  // Un nombre oficial en el idioma del informe no es una traducción de Faro: no lleva su aviso.
  const usar = ({ texto, idioma: delDato, oficial }: DatoEnIdioma): string => {
    if (delDato !== idioma) {
      apuntados.set(texto, delDato);
    } else if (idioma !== IDIOMA_POR_DEFECTO && !oficial) {
      traducciones += 1;
    }
    return texto;
  };
  return {
    idioma,
    textos: textosDelInforme(idioma),
    usar,
    original: (texto, delDato) => usar({ texto, idioma: delDato, oficial: true }),
    tituloIsco: (codigo) => {
      const titulo = tituloIscoEn(datos, codigo, idioma);
      return titulo ? usar(titulo) : codigo;
    },
    tituloCno: (codigo) => {
      const titulo = tituloCnoEn(datos, codigo, idioma);
      return titulo ? usar(titulo) : codigo;
    },
    tituloEsco: (esco) => usar(tituloEscoEn(datos, esco, idioma)),
    textoDeTarea: (id, campo) => {
      const texto = textoDeTareaEn(datos, id, campo, idioma);
      return texto ? usar(texto) : null;
    },
    fraseDeIa: (frase) => {
      const traducida = frase.idioma === idioma ? undefined : frasesTraducidas.get(frase.texto);
      return traducida === undefined ? frase : { texto: traducida, idioma };
    },
    sinTraducir: () => [...apuntados].map(([texto, delDato]) => ({ texto, idioma: delDato })),
    hayTraducciones: () => traducciones > 0,
  };
}
