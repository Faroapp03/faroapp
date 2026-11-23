// Los nombres de persona que quita la limpieza de datos personales (privacidad.ts). Solo se quitan donde no hay duda
// (una presentación, un tratamiento o el papel de otra persona): un nombre suelto no se distingue con seguridad de otra
// palabra con mayúscula. Tras una presentación, la lista oficial de nombres y apellidos del INE
// (comun/nombres-propios.ts) reconoce también el nombre en minúsculas, tras «soy» o con el artículo catalán («soy laura
// pérez», «Sóc na Maria»), y lo que lo sigue: los nombres compuestos y los apellidos, también con partícula («María del
// Carmen López de la Fuente», «Jordi Puig i Ferrer»); nunca un oficio («soy pastora»). Un nombre de cualquier origen
// que la lista no tiene se reconoce por su mayúscula tras «me llamo», «soy», «em dic» o «sóc» («Hola, soy Nkechi
// Okafor»), si no es un oficio, una palabra corriente, un lugar ni una empresa. Con las mismas reglas se quita el
// nombre de otra persona tras su papel: «mi jefe Juan García», «la clienta Marta», «el meu cap, en Jordi». Las
// expresiones de las presentaciones y los tratamientos están en patrones-de-nombres.ts; aquí, la lectura del nombre.

import { CON_MAYUSCULA_INICIAL, formaDeNombre, segunLaLista } from '../comun/nombres-propios.ts';
import { sinDistinguirMayusculas } from '../comun/sin-distinguir-mayusculas.ts';
import type { Limpieza } from './limpieza.ts';
import { type ContextoDelRol, PRONOMBRES_TRAS_EL_NOMBRE, papelesDeOtrasPersonas } from './otras-personas.ts';
import { ACABA_COMO_UN_OFICIO, expresionDePresentacion, patronesDeNombres } from './patrones-de-nombres.ts';

/** Los patrones de las presentaciones y los tratamientos, sin distinguir mayúsculas en las palabras que los abren. */
const NOMBRES = patronesDeNombres(sinDistinguirMayusculas);

// Nombres de la lista oficial del INE (comun/nombres-propios.ts) tras una presentación, también en minúsculas: «soy
// laura pérez garcía, enfermera», «Hola, soy Fatima», «Sóc na Maria», «me llamo juan carlos garcía y…»; y, con
// mayúscula, los de cualquier origen que la lista no tiene («Hola, soy Oluwaseun»). El nombre que encuentra un patrón
// de NOMBRES se alarga con lo que la lista reconoce detrás, y después se buscan los que ningún patrón ha encontrado: lo
// que quitan los patrones se sigue quitando. Las reglas no miran el género ni el origen, y la lista lleva los nombres
// de hombre y de mujer: el mismo caso da lo mismo con «Laura» que con «Juan», con «María del Carmen» que con «Juan de
// Dios» y con «Laura» que con «Nkechi».
/** La marca de un nombre quitado. */
const MARCA_DE_NOMBRE = '[nombre eliminado]';
/** Una presentación y el artículo que la sigue, si lo hay, sin distinguir mayúsculas (bandera `gu`). */
const PRESENTACION_Y_ARTICULO = expresionDePresentacion(sinDistinguirMayusculas);
/** Una palabra de un nombre, con apóstrofo, punto volado o guion dentro («D'Amico», «Marcel·la», «María-José»). */
// palabraEn fija lastIndex antes de cada lectura; la ejecución es síncrona.
const PALABRA_DE_NOMBRE = /[^\S\n]*(\p{L}+(?:['’·-]\p{L}+)*)/uy;
/** Lo que separa las partes de un nombre compuesto con guion. */
const GUION = '-';
/**
 * Donde acaba un nombre: el final de la línea o del texto, un signo, una cifra o una conjunción («soy laura pérez,
 * enfermera», «me llamo laura pérez y…», «em dic jordi puig i…»).
 */
// hayFrontera fija lastIndex antes de cada comprobación.
const FRONTERA = /[^\S\n]*(?:$|\n|[\d,.;:!?¡¿()[\]…"«»“”—–-]|(?:y|e|i|and)(?!\p{L}))/iuy;
/** Las partículas que unen las partes de un nombre o de un apellido: «María del Carmen», «López de la Fuente». */
const PARTICULAS = new Set(['de', 'del']);
/**
 * Las partículas de los apellidos compuestos de fuera que más lleva la lista del INE después de «de» y «del»: «El
 * Amrani» (220.792 personas tienen un primer apellido que empieza por «El»), «Da Silva» (27.816), «Dos Santos»
 * (16.258), «Ben Ali» (14.210), «Di Stefano» (5.574), «Van Dijk» (4.981) y «Ait Ali» (4.190). Solo unen con
 * mayúscula: en minúscula son también palabras corrientes («me llamo ana el martes…», «da igual»), y los apellidos de
 * la lista que van detrás se unen igual que siempre («me llamo joão dos santos»).
 */
const PARTICULAS_DE_FUERA = new Set(['el', 'da', 'dos', 'ben', 'di', 'van', 'ait']);
/** El artículo que puede llevar «de» en la partícula: «de la», «de los», «de las» y, en catalán, «de les». */
const ARTICULOS_DE_PARTICULA = new Set(['la', 'las', 'los', 'les']);
/** Entre dos apellidos catalanes va «i»: «Puig i Ferrer». */
const ENTRE_APELLIDOS = 'i';
/**
 * Segundas partes de los nombres compuestos con partícula más frecuentes que la lista no tiene como nombre por sí
 * solas: «Juan de Dios» (7.760 hombres según el INE), «María de la O» (2.579 mujeres) y «María de la Cabeza» (1.206).
 * Las demás (Carmen, Pilar, Ángeles, Mar, Borja, Asís, Cruz, Paula…) son nombres de la lista.
 */
const SEGUNDAS_PARTES_DE_COMPUESTO = new Set(['dios', 'o', 'cabeza']);
/** Nombres de la lista que tras «de» son la hora del turno: «soy laura de la mañana y repongo». */
const NO_SON_NOMBRE_TRAS_PARTICULA = new Set(['manana']);
/** Lo que abre, tras el nombre, de dónde es la persona o en qué trabaja: «soy laura de badalona», «de ventas». */
const ABREN_UN_COMPLEMENTO = new Set(['de', 'del', 'en']);
/**
 * Palabras gramaticales que la lista tiene porque alguien se llama o se apellida así («Nada», «Una», «Solo»), y que
 * tras «soy» nunca son un nombre: «soy una de las cocineras», «soy solo ayudante». Sin tildes, como las compara la
 * lista.
 */
const GRAMATICALES = new Set(
  [
    'a al ante asi con contra de del desde durante e el en entre hasta la las le les lo los me mi mis muy nada ni no',
    'nos o os para pero por que se si sin so sobre solo su sus te tu tus u un una uno unos unas y ya yo',
    'amb els em ens et fins i jo na per pel pels poc sense ses seu seva sota tot tots uns',
  ].flatMap((linea) => linea.split(' ')),
);
/**
 * Verbos con que se sigue contando el trabajo justo después del nombre, que la lista tiene como apellidos («Trabajo»,
 * «Porto», «Monto»): «me llamo laura trabajo de cajera», «soy ana limpio casas». Un apellido de verdad que coincide
 * con uno de ellos se queda; un verbo nunca se quita.
 */
const VERBOS_TRAS_EL_NOMBRE = new Set(
  [
    'soy estoy trabajo tengo llevo hago vivo cuido limpio atiendo preparo cocino vendo conduzco reparto coso corto',
    'pinto monto arreglo reparo instalo cargo ordeno gestiono ayudo doy cobro sirvo plancho lavo peino recojo coloco',
    'reviso controlo vigilo programo leo llamo contesto recibo pido hablo estudio busco voy vengo uso manejo fabrico',
    'soldo mido lijo pego pongo quito saco cojo tomo bajo paso guardo tejo bordo riego curo cuadro ando era tenia',
    'soc estic treballo tinc porto faig visc netejo cuino venc cuso tallo munto dono rento poso passo pujo tanco rego',
    'truco mesuro duc',
  ].flatMap((linea) => linea.split(' ')),
);
/**
 * Lugares y empresas que se nombran al contar dónde se trabaja, y palabras del trabajo que los textos oficiales no
 * usan, que con mayúscula tras «soy» no son el nombre de nadie («Soy Glovo», «Soy Interina»). Sin tildes, como las
 * compara la lista. No pretende estar completa: lo que falte se quita como si fuera un nombre.
 */
const LUGARES_EMPRESAS_Y_PALABRAS_DEL_TRABAJO = new Set(
  [
    'barcelona badalona catalunya cataluna espana espanya europa girona hospitalet lhospitalet lleida madrid manresa',
    'mataro reus sabadell tarragona terrassa',
    'adecco aldi alcampo amazon bbva bonpreu cabify caixabank caprabo carrefour clece condis correos decathlon',
    'deliveroo eroski eulen ferrovial glovo ikea inditex lidl mango mcdonalds mercadona movistar primark prosegur',
    'randstad renfe santander securitas starbucks telefonica telepizza uber zara',
    'becaria becario duena dueno freelance glover interina interino jubilada jubilado rider suplente',
  ].flatMap((linea) => linea.split(' ')),
);

// Nombres de otras personas, tras su papel (otras-personas.ts: «mi jefe Juan García», «la clienta Marta», «el meu cap,
// en Jordi»). Con mayúscula, vale un nombre de la lista del INE o, si el papel lo admite, uno de cualquier origen («mi
// compañero Oluwaseun»), nunca un oficio ni una palabra corriente («el cliente Final», «el usuario Administrador»).
// En minúsculas, como tras «soy», solo uno de la lista que no sea una palabra corriente ni un verbo y que acabe ahí,
// con un signo, «y» o un pronombre detrás («mi jefe juan me dice», «mi compañera laia y yo»). Un nombre suelto o dicho
// antes del papel («Juan, mi jefe») no se distingue con seguridad y se queda.
/** Lo que une los nombres de varias personas: «mis compañeros Ahmed, Laia y Nkechi». */
// siguienteNombre fija lastIndex antes de cada comprobación.
const ENTRE_NOMBRES = /[^\S\n]*(?:,|(?:y|e|i)(?!\p{L}))[^\S\n]*/uy;
/** Nombres seguidos tras un mismo papel, como mucho. */
const MAX_NOMBRES_TRAS_UN_ROL = 4;

/** Una palabra del texto y dónde está: de `desde` (incluido) a `hasta` (excluido). */
type Palabra = { texto: string; desde: number; hasta: number };
/** Un tramo del texto que se cambia por `sustituto`. */
type Tramo = { desde: number; hasta: number; sustituto: string };
/**
 * Qué asegura la presentación que va delante de un posible nombre. `cualquierOrigen`: tras «me llamo», «soy», «em dic»
 * o «sóc», un nombre que la lista no tiene se reconoce por su mayúscula; tras «me llaman» o «em diuen», no.
 */
type Presentacion = { inequivoca: boolean; cualquierOrigen: boolean; articulo: 'personal' | 'comun' | null };
/** Una parte más de un nombre: la palabra y, si la lleva delante, la partícula que la une («de la», «i»). */
type Parte = { palabra: Palabra; particula: string | null };
/** Lo que se sabe de un nombre mientras se lee: hasta dónde llega y qué puede seguirlo. */
type NombreLeido = {
  /** Donde acaba lo que ya es seguro que forma parte del nombre. */
  fin: number;
  /** Donde acaba la última parte leída. */
  hasta: number;
  /** Todas las partes leídas tras la primera llevan mayúscula inicial. */
  conMayuscula: boolean;
  /** Se ha leído más que la primera palabra: lo que sigue puede ser un apellido («López de la Fuente»). */
  conApellidos: boolean;
  /** Lo presenta «me llamo», «em dic» o el artículo personal: lo que sigue al nombre es nombre. */
  inequivoco: boolean;
};

/** La palabra que empieza en `desde`, saltando los blancos de la misma línea; `null` si lo que sigue no es una palabra. */
function palabraEn(texto: string, desde: number): Palabra | null {
  PALABRA_DE_NOMBRE.lastIndex = desde;
  const encontrada = PALABRA_DE_NOMBRE.exec(texto);
  if (!encontrada) {
    return null;
  }
  const hasta = PALABRA_DE_NOMBRE.lastIndex;
  // PALABRA_DE_NOMBRE tiene un único grupo obligatorio cuando exec encuentra una palabra.
  const palabra = encontrada[1] as string;
  return { texto: palabra, desde: hasta - palabra.length, hasta };
}

/** Si en `posicion` acaba el nombre: lo que sigue es el final, un signo, una cifra o una conjunción. */
function hayFrontera(texto: string, posicion: number): boolean {
  FRONTERA.lastIndex = posicion;
  return FRONTERA.test(texto);
}

/** Si una parte de un nombre está en la lista como nombre o como apellido y no es un oficio ni un verbo. */
function parteDelNombre(parte: string): boolean {
  const { forma, dePila, apellido, oficio } = segunLaLista(parte);
  if (oficio || GRAMATICALES.has(forma) || VERBOS_TRAS_EL_NOMBRE.has(forma)) {
    return false;
  }
  return dePila || apellido;
}

/**
 * Si cada parte puede seguir al nombre de pila: nombre o apellido de la lista. Una palabra ambigua que la lista
 * reconoce como apellido también puede quitarse («Marta llama»); no asegura ausencia de falsos positivos.
 */
function puedeSeguirAlNombre(palabra: string): boolean {
  return palabra.split(GUION).every(parteDelNombre);
}

/** Si la palabra puede ser el nombre de pila con que alguien se presenta: de la lista, y no un oficio («Pastora»). */
function puedeSerNombreDePila(palabra: string): boolean {
  const [primera, ...resto] = palabra.split(GUION);
  // split devuelve siempre una primera cadena, también para una cadena vacía.
  const { forma, dePila, oficio } = segunLaLista(primera as string);
  if (!dePila || oficio || GRAMATICALES.has(forma)) {
    return false;
  }
  return resto.every(parteDelNombre);
}

/**
 * Si una palabra con mayúscula es un nombre de cualquier origen, aunque la lista no lo tenga («Nkechi», «Okafor»,
 * «Xiaoling»): no es un oficio ni una palabra corriente de los textos oficiales en castellano o en catalán
 * (comun/nombres-propios.ts), ni un lugar, una empresa o una palabra del trabajo, ni una palabra gramatical o un verbo
 * con que se sigue contando el trabajo. En minúsculas no se puede saber: solo cuenta la lista.
 */
function nombreDeCualquierOrigen(palabra: string): boolean {
  if (!CON_MAYUSCULA_INICIAL.test(palabra)) {
    return false;
  }
  return palabra.split(GUION).every((parte) => {
    const { forma, noEsNombre } = segunLaLista(parte);
    if (noEsNombre || GRAMATICALES.has(forma) || VERBOS_TRAS_EL_NOMBRE.has(forma)) {
      return false;
    }
    return !LUGARES_EMPRESAS_Y_PALABRAS_DEL_TRABAJO.has(forma);
  });
}

/** Si tras «de», «del» o «en» viene de dónde es o en qué trabaja: «de Badalona», «de ventas, …», «en caja y…». */
function abreUnComplemento(texto: string, desde: number): boolean {
  const palabra = palabraEn(texto, desde);
  if (!palabra || GRAMATICALES.has(formaDeNombre(palabra.texto))) {
    return false;
  }
  return CON_MAYUSCULA_INICIAL.test(palabra.texto) || hayFrontera(texto, palabra.hasta);
}

/**
 * Si el nombre acaba en `posicion`: hay una frontera, o lo que sigue ya cuenta el trabajo o de dónde es la persona.
 * Un verbo («soy laura trabajo de cajera»), un oficio («soy laura cajera», «soy laura pastora») o un complemento
 * («hola soy laura de badalona y…», «soy laura de ventas, …»). Lo que sigue se queda en el texto.
 */
function acabaElNombre(texto: string, posicion: number): boolean {
  if (hayFrontera(texto, posicion)) {
    return true;
  }
  const siguiente = palabraEn(texto, posicion);
  if (!siguiente) {
    return false;
  }
  const { forma, dePila, apellido, oficio } = segunLaLista(siguiente.texto);
  if (GRAMATICALES.has(forma)) {
    return ABREN_UN_COMPLEMENTO.has(forma) && abreUnComplemento(texto, siguiente.hasta);
  }
  if (VERBOS_TRAS_EL_NOMBRE.has(forma) || oficio) {
    return true;
  }
  return !dePila && !apellido && ACABA_COMO_UN_OFICIO.test(forma);
}

/** La partícula que empieza en `desde` («de», «del», «de la», «de los», «i»), normalizada, y dónde acaba. */
function particulaEn(texto: string, desde: number): { forma: string; hasta: number } | null {
  const primera = palabraEn(texto, desde);
  const forma = primera?.texto.toLowerCase();
  if (!primera || !forma) {
    return null;
  }
  const deFuera = PARTICULAS_DE_FUERA.has(forma) && CON_MAYUSCULA_INICIAL.test(primera.texto);
  if (forma !== ENTRE_APELLIDOS && !PARTICULAS.has(forma) && !deFuera) {
    return null;
  }
  const articulo = forma === 'de' ? palabraEn(texto, primera.hasta) : null;
  const conArticulo = articulo?.texto.toLowerCase();
  if (articulo && conArticulo && ARTICULOS_DE_PARTICULA.has(conArticulo)) {
    return { forma: `${forma} ${conArticulo}`, hasta: articulo.hasta };
  }
  return { forma, hasta: primera.hasta };
}

/** La parte de un nombre que puede empezar en `desde`: una palabra, con la partícula que la une si la lleva. */
function parteEn(texto: string, desde: number): Parte | null {
  const particula = particulaEn(texto, desde);
  const palabra = palabraEn(texto, particula?.hasta ?? desde);
  return palabra ? { palabra, particula: particula?.forma ?? null } : null;
}

/** Si la palabra sigue a un nombre en el que todas las partes llevan mayúscula inicial. */
function sigueConMayuscula(palabra: Palabra, nombre: NombreLeido): boolean {
  return nombre.conMayuscula && CON_MAYUSCULA_INICIAL.test(palabra.texto);
}

/**
 * Un apellido que también es un oficio («Herrera», «Cabrera», «Pastor») sigue al nombre donde no puede ser el oficio
 * de la persona: con mayúscula («Soy Laura Herrera, enfermera»), tras «me llamo» («me llamo laura herrera») o entre
 * otros dos («soy lucía cabrera vera, cajera»). Suelto tras «soy», se queda: «soy laura herrera» puede ser una herrera.
 */
function esApellidoQueEsOficio(texto: string, palabra: Palabra, nombre: NombreLeido): boolean {
  const { forma, dePila, apellido, oficio } = segunLaLista(palabra.texto);
  if (!oficio || !(dePila || apellido) || palabra.texto.includes(GUION) || GRAMATICALES.has(forma)) {
    return false;
  }
  if (nombre.inequivoco || sigueConMayuscula(palabra, nombre)) {
    return true;
  }
  const siguiente = palabraEn(texto, palabra.hasta);
  return siguiente !== null && puedeSeguirAlNombre(siguiente.texto);
}

/**
 * Si, tras una partícula de fuera con mayúscula («El», «Da», «Ben»), la palabra es el apellido: con mayúscula, detrás
 * de un nombre escrito con mayúsculas, de la lista o de cualquier origen («Soy Fatima El Amrani», «Soy João Da Silva»).
 */
function apellidoDeFuera(palabra: Palabra, nombre: NombreLeido): boolean {
  return (
    sigueConMayuscula(palabra, nombre) && (puedeSeguirAlNombre(palabra.texto) || nombreDeCualquierOrigen(palabra.texto))
  );
}

/**
 * Si la palabra que sigue a una partícula continúa el nombre. Justo detrás del nombre de pila, solo un nombre («María
 * del Carmen», «Juan de Dios»): «soy laura de ventas» o «del Hospital del Mar» no son su nombre. Detrás de un apellido,
 * también un apellido («López de la Fuente», «Puig i Ferrer»), si lleva mayúscula como el resto del nombre o si lo
 * presenta «me llamo»: en minúsculas tras «soy», «de la cocina» o «i mare» son otra cosa.
 */
function sigueTrasParticula(parte: Parte, nombre: NombreLeido): boolean {
  const [primera, ...resto] = parte.palabra.texto.split(GUION);
  // split devuelve siempre una primera cadena, también para una cadena vacía.
  const { forma, dePila, apellido, oficio } = segunLaLista(primera as string);
  if (!resto.every(parteDelNombre)) {
    return false;
  }
  if (SEGUNDAS_PARTES_DE_COMPUESTO.has(forma)) {
    return parte.particula !== ENTRE_APELLIDOS;
  }
  if (oficio || NO_SON_NOMBRE_TRAS_PARTICULA.has(forma) || GRAMATICALES.has(forma)) {
    return false;
  }
  if (VERBOS_TRAS_EL_NOMBRE.has(forma) || !(dePila || apellido)) {
    return false;
  }
  const conMayuscula = nombre.conApellidos && sigueConMayuscula(parte.palabra, nombre);
  if (parte.particula === ENTRE_APELLIDOS) {
    return apellido && conMayuscula;
  }
  return dePila || nombre.inequivoco || conMayuscula;
}

/**
 * Si la parte continúa el nombre leído hasta ahora: un nombre o apellido de la lista, con su partícula si la lleva, o,
 * detrás de un nombre escrito con mayúsculas, un apellido de cualquier origen («Soy Nkechi Okafor», «Soy Laura Wang»,
 * «Soy Fatima El Amrani»).
 */
function sigueAlNombre(texto: string, parte: Parte, nombre: NombreLeido): boolean {
  const { palabra, particula } = parte;
  if (particula && PARTICULAS_DE_FUERA.has(particula)) {
    return apellidoDeFuera(palabra, nombre);
  }
  if (particula) {
    return sigueTrasParticula(parte, nombre);
  }
  if (puedeSeguirAlNombre(palabra.texto) || esApellidoQueEsOficio(texto, palabra, nombre)) {
    return true;
  }
  return sigueConMayuscula(palabra, nombre) && nombreDeCualquierOrigen(palabra.texto);
}

/**
 * Dónde acaba un nombre que empieza en `primera`: tras los nombres y apellidos de la lista que la siguen, con sus
 * partículas. Los que llevan mayúscula inicial entran todos seguidos; en minúsculas o en mayúsculas, solo hasta donde
 * acaba el nombre (acabaElNombre), para no llevarse lo que sigue: «soy laura pérez garcía, enfermera» sí; «soy laura
 * mesa de la cocina», no «mesa». `como` dice cómo se ha presentado y si `primera` lleva ya apellidos.
 */
function finDelNombre(texto: string, primera: Palabra, como: Pick<NombreLeido, 'inequivoco' | 'conApellidos'>): number {
  const nombre: NombreLeido = { fin: primera.hasta, hasta: primera.hasta, conMayuscula: true, ...como };
  let parte = parteEn(texto, nombre.hasta);
  // Cada parte contiene al menos una letra y avanza hasta: termina al acabar el texto.
  while (parte && sigueAlNombre(texto, parte, nombre)) {
    nombre.conMayuscula = sigueConMayuscula(parte.palabra, nombre);
    nombre.hasta = parte.palabra.hasta;
    nombre.conApellidos = true;
    if (nombre.conMayuscula || acabaElNombre(texto, nombre.hasta)) {
      nombre.fin = nombre.hasta;
    }
    parte = parteEn(texto, nombre.hasta);
  }
  return nombre.fin;
}

/**
 * Si se puede quitar el nombre que va de `primera` a `fin`. Tras «me llamo» o «em dic», o con el artículo personal
 * catalán («sóc en», «na»), siempre. Tras «soy», solo con algo más que lo asegure: la mayúscula («Hola, soy Fatima»),
 * un apellido («soy laura pérez») o que el nombre acabe ahí («soy laura, cajera», «soy laura trabajo de cajera»; con el
 * artículo, «sóc la laia.»). «soy clara con los clientes» no pierde nada.
 */
function nombreSeguro(texto: string, primera: Palabra, fin: number, presentacion: Presentacion): boolean {
  if (presentacion.inequivoca || presentacion.articulo === 'personal') {
    return true;
  }
  if (CON_MAYUSCULA_INICIAL.test(primera.texto) || fin > primera.hasta) {
    return true;
  }
  return acabaElNombre(texto, primera.hasta);
}

/** Qué asegura una presentación encontrada, según los grupos de PRESENTACION_Y_ARTICULO que ha llenado. */
function presentacionDe(grupos: Record<string, string | undefined>): Presentacion {
  const inequivoca = grupos.inequivoca !== undefined;
  const cualquierOrigen = grupos.apodo === undefined;
  if (grupos.personal !== undefined) {
    return { inequivoca, cualquierOrigen, articulo: 'personal' };
  }
  return { inequivoca, cualquierOrigen, articulo: grupos.comun !== undefined ? 'comun' : null };
}

/**
 * Si la palabra puede ser el nombre con que alguien se presenta: un nombre de pila de la lista o, si la presentación lo
 * admite, uno de cualquier origen escrito con mayúscula.
 */
function puedeSerSuNombre(palabra: string, presentacion: Presentacion): boolean {
  return puedeSerNombreDePila(palabra) || (presentacion.cualquierOrigen && nombreDeCualquierOrigen(palabra));
}

/** El nombre que sigue a una presentación que acaba en `desde`, como tramo que se sustituye por la marca. */
function nombreTrasPresentacion(texto: string, desde: number, presentacion: Presentacion): Tramo | null {
  const primera = palabraEn(texto, desde);
  if (!primera || !puedeSerSuNombre(primera.texto, presentacion)) {
    return null;
  }
  const inequivoco = presentacion.inequivoca || presentacion.articulo === 'personal';
  const fin = finDelNombre(texto, primera, { inequivoco, conApellidos: false });
  if (!nombreSeguro(texto, primera, fin, presentacion)) {
    return null;
  }
  return { desde: primera.desde, hasta: fin, sustituto: MARCA_DE_NOMBRE };
}

/**
 * Lo que encuentra un patrón de NOMBRES, alargado con lo que la lista reconoce detrás («Me llamo María» del Carmen
 * López, «Em dic Jordi Puig» i Ferrer). El de una presentación sigue con los apellidos si ya lleva más de una palabra; el
 * de un tratamiento («el Sr. García») es ya un apellido, y no se alarga más que con un nombre: «del Hospital del Mar»
 * no es su apellido.
 */
function tramoDelPatron(texto: string, encontrado: RegExpExecArray, tratamiento: boolean): Tramo {
  // Todos los patrones de NOMBRES tienen los grupos obligatorios presentación y nombre.
  const antes = encontrado[1] as string;
  const nombre = encontrado[2] as string;
  const desde = encontrado.index + antes.length;
  const primera = { texto: nombre, desde, hasta: desde + nombre.length };
  const conApellidos = !tratamiento && /\s/.test(nombre);
  return {
    desde,
    hasta: finDelNombre(texto, primera, { inequivoco: !tratamiento, conApellidos }),
    sustituto: MARCA_DE_NOMBRE,
  };
}

/** Los tramos que no se solapan con uno anterior, en el orden del texto. */
function sinSolapes(tramos: Tramo[]): Tramo[] {
  let hecho = 0;
  return [...tramos]
    .sort((a, b) => a.desde - b.desde)
    .filter((tramo) => {
      if (tramo.desde < hecho) {
        return false;
      }
      hecho = tramo.hasta;
      return true;
    });
}

/** Cambia cada tramo por su sustituto; uno que se solapa con el anterior se descarta. */
function sustituirTramos(texto: string, tramos: Tramo[]): Limpieza {
  const aplicados = sinSolapes(tramos);
  let resultado = '';
  let hecho = 0;
  for (const tramo of aplicados) {
    resultado += texto.slice(hecho, tramo.desde) + tramo.sustituto;
    hecho = tramo.hasta;
  }
  return { texto: resultado + texto.slice(hecho), eliminados: aplicados.length };
}

/**
 * Quita los nombres que encuentran los patrones de NOMBRES, cada uno con lo que la lista reconoce detrás.
 *
 * @param texto - El texto que se limpia.
 * @returns El texto con cada nombre cambiado por la marca y cuántos se han quitado.
 */
export function quitarNombresDeLosPatrones(texto: string): Limpieza {
  const tramos = NOMBRES.flatMap(({ patron, tratamiento }) =>
    [...texto.matchAll(patron)].map((encontrado) => tramoDelPatron(texto, encontrado, tratamiento)),
  );
  return sustituirTramos(texto, tramos);
}

/**
 * Quita los nombres de la lista que siguen a una presentación y que los patrones de NOMBRES no han quitado («soy laura
 * pérez», «Sóc na Maria»), cada uno como un dato eliminado más.
 *
 * @param texto - El texto que se limpia; en privacidad.ts, el que ya ha pasado por quitarNombresDeLosPatrones.
 * @returns El texto con cada nombre cambiado por la marca y cuántos se han quitado.
 */
export function quitarNombresDeLaLista(texto: string): Limpieza {
  const nombres = [...texto.matchAll(PRESENTACION_Y_ARTICULO)].flatMap((encontrada) => {
    const desde = encontrada.index + encontrada[0].length;
    return nombreTrasPresentacion(texto, desde, presentacionDe(encontrada.groups ?? {})) ?? [];
  });
  return sustituirTramos(texto, nombres);
}

/** Si la palabra que sigue a un papel puede ser el nombre de otra persona, sin mirar todavía lo que la sigue. */
function puedeSerNombreDeOtraPersona(palabra: string, contexto: ContextoDelRol): boolean {
  if (CON_MAYUSCULA_INICIAL.test(palabra)) {
    return puedeSerNombreDePila(palabra) || (contexto.cualquierOrigen && nombreDeCualquierOrigen(palabra));
  }
  if (!contexto.minusculas || !puedeSerNombreDePila(palabra)) {
    return false;
  }
  if (contexto.llamado) {
    return true;
  }
  // split devuelve siempre una primera cadena.
  const { forma, noEsNombre } = segunLaLista(palabra.split(GUION)[0] as string);
  return !noEsNombre && !VERBOS_TRAS_EL_NOMBRE.has(forma);
}

/** Dónde acaba un nombre en minúsculas que empieza en `primera`: tras los nombres y apellidos de la lista que lo siguen. */
function finEnMinusculas(texto: string, primera: Palabra): number {
  let hasta = primera.hasta;
  // Cada palabra contiene al menos una letra y avanza hasta: termina al acabar el texto.
  for (let siguiente = palabraEn(texto, hasta); siguiente && puedeSeguirAlNombre(siguiente.texto); ) {
    hasta = siguiente.hasta;
    siguiente = palabraEn(texto, hasta);
  }
  return hasta;
}

/** Si el nombre en minúsculas acaba en `posicion`: con un signo, el final, «y» o un pronombre («juan me dice»). */
function cierraElNombre(texto: string, posicion: number): boolean {
  if (hayFrontera(texto, posicion)) {
    return true;
  }
  const siguiente = palabraEn(texto, posicion);
  return siguiente !== null && PRONOMBRES_TRAS_EL_NOMBRE.has(siguiente.texto.toLowerCase());
}

/** El nombre de otra persona que empieza en `palabra`, con sus apellidos, como tramo; `null` si no lo es. */
function nombreDeOtraPersona(texto: string, palabra: Palabra, contexto: ContextoDelRol): Tramo | null {
  if (!puedeSerNombreDeOtraPersona(palabra.texto, contexto)) {
    return null;
  }
  const tramo = (hasta: number): Tramo => ({ desde: palabra.desde, hasta, sustituto: MARCA_DE_NOMBRE });
  if (CON_MAYUSCULA_INICIAL.test(palabra.texto)) {
    return tramo(finDelNombre(texto, palabra, { inequivoco: contexto.llamado, conApellidos: false }));
  }
  const hasta = finEnMinusculas(texto, palabra);
  return contexto.llamado || cierraElNombre(texto, hasta) ? tramo(hasta) : null;
}

/** Tras un nombre, el siguiente si se une con coma, «y» o «i» y lleva mayúscula: «Ahmed, Laia y Nkechi». */
function siguienteNombre(texto: string, desde: number): Palabra | null {
  ENTRE_NOMBRES.lastIndex = desde;
  if (!ENTRE_NOMBRES.test(texto)) {
    return null;
  }
  const palabra = palabraEn(texto, ENTRE_NOMBRES.lastIndex);
  return palabra && CON_MAYUSCULA_INICIAL.test(palabra.texto) ? palabra : null;
}

/**
 * Lo que asegura una serie de nombres con mayúscula unidos por comas o «y» tras el papel («mis compañeros Oluwaseun y
 * Nkechi»): son nombres de cualquier origen aunque el papel esté en plural.
 */
function contextoDeLaSerie(texto: string, primera: Palabra, contexto: ContextoDelRol): ContextoDelRol {
  const enSerie = CON_MAYUSCULA_INICIAL.test(primera.texto) && siguienteNombre(texto, primera.hasta) !== null;
  return enSerie ? { ...contexto, cualquierOrigen: true } : contexto;
}

/** Los nombres que siguen a un papel («mi jefe», «la clienta») desde `desde`, cada uno con sus apellidos. */
function nombresTrasUnRol(texto: string, desde: number, contextoDelPapel: ContextoDelRol): Tramo[] {
  const tramos: Tramo[] = [];
  let palabra = palabraEn(texto, desde);
  const contexto = palabra ? contextoDeLaSerie(texto, palabra, contextoDelPapel) : contextoDelPapel;
  while (palabra && tramos.length < MAX_NOMBRES_TRAS_UN_ROL) {
    const nombre = nombreDeOtraPersona(texto, palabra, contexto);
    if (!nombre) {
      break;
    }
    tramos.push(nombre);
    palabra = siguienteNombre(texto, nombre.hasta);
  }
  return tramos;
}

/**
 * Quita los nombres de otras personas que siguen a su papel («mi jefe Juan García»), cada uno como un dato eliminado
 * más.
 *
 * @param texto - El texto que se limpia.
 * @returns El texto con cada nombre cambiado por la marca y cuántos se han quitado.
 */
export function quitarNombresDeOtrasPersonas(texto: string): Limpieza {
  const nombres = papelesDeOtrasPersonas(texto).flatMap(({ desde, contexto }) =>
    nombresTrasUnRol(texto, desde, contexto),
  );
  return sustituirTramos(texto, nombres);
}
