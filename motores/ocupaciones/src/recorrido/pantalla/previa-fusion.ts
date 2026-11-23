// La previa calibrada combina léxico, vectores disponibles, clasificador y ocupados por grupo en Cataluña.
// Se entrega como Entrada.previa al motor de preguntas, con probabilidades explícitas y sin recorte en cero.
// La pantalla nunca afirma sin confirmación (umbralAfirmar = 2); propone la ocupación o pregunta para distinguirla.
// Los vectores y el clasificador se cargan aparte: mientras faltan, se usa el modelo previsto sin esa señal.
// Con vectores se usa modelo-estatico.json; sin ellos, modelo-lexico.json. Cada uno dispone también de un
// modelo sin clasificador para no sustituir una señal ausente por una estimación inventada.

import type { Idioma } from '../../../../../src/comun/idioma.ts';
import { normalizar } from '../../../../../src/comun/texto.ts';
import type { Datos } from '../../../../../src/dominio/tipos-paquete.ts';
import modeloEstatico from '../../../modelos/modelo-estatico.json' with { type: 'json' };
import modeloEstaticoSinClasificador from '../../../modelos/modelo-estatico-sin-clasificador.json' with {
  type: 'json',
};
import modeloLexico from '../../../modelos/modelo-lexico.json' with { type: 'json' };
import modeloLexicoSinClasificador from '../../../modelos/modelo-lexico-sin-clasificador.json' with { type: 'json' };
import type { ResultadoDeBusqueda } from '../../busqueda/analisis.ts';
import { buscarConContexto } from '../../busqueda/analisis.ts';
import type { Area } from '../../busqueda/area.ts';
import { DENOMINACIONES_DE_DICCIONARIO } from '../../busqueda/denominaciones-de-diccionario.ts';
import { textoComoEnEsco } from '../../busqueda/ocupaciones.ts';
import { palabrasDe } from '../../busqueda/palabras.ts';
import type { ClasificadorMovil, GrupoProbable } from '../fusion/clasificador-movil.ts';
import {
  comprobarModelo,
  type DecisionDeFusion,
  fusionar,
  type ModeloDeFusion,
  type PreviaDeFusion,
  previaParaElMotor,
  type SimilitudesDeConsulta,
} from '../fusion/faro-fusion.ts';
import type { VectoresMovil } from '../fusion/vectores-movil.ts';
import { CONFIGURACION } from '../preguntas/motor.ts';
import type { Atributos, CandidataBusqueda, Configuracion, PreviaExplicita } from '../preguntas/tipos.ts';
import { type ContextoDePrevia, type Previa, previaLexica, textoDeBusqueda, tituloOcupacion } from './servicio.ts';

/** Los vectores de la consulta, uno por modelo de `modelo.vectores`; null si aún no hay (se usa `sinVectores`). */
type VectoresDeConsulta = (texto: string, idioma: 'es' | 'ca') => readonly SimilitudesDeConsulta[] | null;

/** Ajustes del motor asociados al modelo de fusión. */
interface AjusteDeFusion {
  /** Probabilidad con que el motor propone (con preguntas hechas o sin ellas). */
  readonly umbralProponer: number;
  /** Masa mínima que se deja a los grupos no candidatos. */
  readonly fondoMinimo: number;
  /** Probabilidad de que la persona se equivoque al responder. */
  readonly error: number;
  /** Umbral de propuesta sin rival cercano y probabilidad del segundo grupo que define ese rival. */
  readonly umbralSinRival?: number;
  readonly rivalCercano?: number;
}

/** Un modelo de fusión con el ajuste del motor elegido para él. */
interface ModeloConAjuste {
  readonly modelo: ModeloDeFusion;
  /** Modelo entrenado sin el rasgo del clasificador, para cuando este no está cargado. */
  readonly modeloSinClasificador?: ModeloDeFusion;
  readonly ajuste: AjusteDeFusion;
}

interface OpcionesDeFusion {
  /** Sin vectores (aún cargando, o si fallan): solo léxico + ocupados. */
  readonly sinVectores: ModeloConAjuste;
  /** Con vectores: el modelo entrenado con ellos y la fuente de las similitudes de la consulta. */
  readonly conVectores?: ModeloConAjuste & { readonly vectores: VectoresDeConsulta };
  /** Si el contexto no los trae (pasoDePantalla sí los trae). */
  readonly atributos?: Atributos;
}

/** Ajuste del modelo solo léxico (modelo-lexico.json): umbral prudente cuando no hay vectores. */
// Sin vectores se exige 0,8 para proponer, o 0,6 si el segundo grupo no llega a 0,10.
// La excepción evita preguntas innecesarias cuando no hay una alternativa cercana.
const AJUSTE_LEXICO: AjusteDeFusion = {
  umbralProponer: 0.8,
  umbralSinRival: 0.6,
  rivalCercano: 0.1,
  fondoMinimo: 0.02,
  error: 0.2,
};
/** Ajuste del modelo con tabla estática (modelo-estatico.json, logit@faro-v1-estatico-256-int8). */
const AJUSTE_ESTATICO: AjusteDeFusion = { umbralProponer: 0.5, fondoMinimo: 0.02, error: 0.2 };

/** Un umbral de afirmar que nadie alcanza: el motor nunca afirma sin que la persona confirme. */
const NUNCA = 2;
/** Proponer ya: cualquier 1.ª llega. */
const YA = 0;
/** Puntos del buscador de un nombre de oficio: título (100) o alternativo oficial (hasta 110 con la descripción). */
const PUNTOS_NOMBRE_DE_OFICIO = 100;
/** Grupos que enseña una propuesta: el propuesto y sus 2 alternativas. */
const GRUPOS_DE_LA_PROPUESTA = 3;
/** Masa mínima de esos 3 grupos para proponer un nombre de oficio sin preguntar (valor de diseño, no ajustado). */
const MASA_PROPUESTA_DIRECTA = 0.8;
/** Parte de la previa que se reparte entre las ocupaciones de un área sin puesto (valor de diseño, no ajustado). */
const PESO_DEL_AREA = 0.3;

/** Si, quitado el lugar de trabajo, el texto no da ninguna candidata («TCAE en una residencia»). */
export function oficioVacio(datos: Datos, texto: string, busqueda: ResultadoDeBusqueda): boolean {
  if (!busqueda.lugar) {
    return false;
  }
  const sinLugar = normalizar(textoDeBusqueda(texto)).replace(busqueda.lugar, ' ').trim();
  return !sinLugar || buscarConContexto(datos, sinLugar).candidatas.length === 0;
}

/** Lo escrito es un nombre de oficio y la propuesta con sus alternativas reúne casi toda la probabilidad. */
function nombreDeOficioClaro(busqueda: ResultadoDeBusqueda, d: DecisionDeFusion): boolean {
  const masa = d.grupos.slice(0, GRUPOS_DE_LA_PROPUESTA).reduce((s, g) => s + g.p, 0);
  return (
    !busqueda.necesitaPrecision &&
    (busqueda.candidatas[0]?.puntos ?? 0) >= PUNTOS_NOMBRE_DE_OFICIO &&
    masa >= MASA_PROPUESTA_DIRECTA
  );
}

/** Umbral de afirmar 2 siempre; el de proponer, el del ajuste o 0 si hay que proponer sin preguntar. */
function configuracion(directa: boolean, ajuste: AjusteDeFusion): Partial<Configuracion> {
  const umbral = directa ? YA : ajuste.umbralProponer;
  return {
    umbralAfirmar: NUNCA,
    umbralProponer: umbral,
    umbralProponerSinPreguntas: umbral,
    error: ajuste.error,
    ...(directa || ajuste.umbralSinRival === undefined
      ? {}
      : { umbralProponerSinRival: ajuste.umbralSinRival, rivalCercano: ajuste.rivalCercano ?? 0 }),
  };
}

/**
 * Las candidatas que el motor usa para los títulos (propuesta, «¿Cuál de estos es tu puesto?»): las del léxico y las
 * ocupaciones que solo trae la previa (vectores, área), con su título de Faro. Los puntos no cuentan: manda la previa.
 */
function candidatasConTitulos(datos: Datos, lexicas: readonly CandidataBusqueda[], previa: PreviaDeFusion) {
  const vistas = new Set(lexicas.map((c) => c.esco));
  const nuevas = previa.ocupaciones
    .filter((o) => !vistas.has(o.esco))
    .map((o) => {
      const titulo = tituloOcupacion(datos, o.esco);
      return { esco: o.esco, isco08: o.isco08, puntos: 0, titulo: titulo.es, tituloCa: titulo.ca };
    });
  return [...lexicas, ...nuevas];
}

/**
 * Con un área sin puesto («recursos humanos»: `area` del buscador, 1A), la previa reparte PESO_DEL_AREA de su masa
 * entre los grupos y las ocupaciones del área según su peso (relaciones oficiales de ESCO), para que el motor pueda
 * preguntar por todas, también las que el léxico deja lejos (nóminas, 4313, va la 13.ª). El resto, la fusión.
 */
function conArea(previa: PreviaDeFusion, area: Area | undefined): PreviaDeFusion {
  const total = area?.grupos.reduce((s, g) => s + g.peso, 0) ?? 0;
  if (!(area && total > 0)) {
    return previa;
  }
  const deGrupo = new Map(area.grupos.map((g) => [g.isco08, (PESO_DEL_AREA * g.peso) / total]));
  const enGrupo = new Map<string, number>();
  for (const o of area.ocupaciones) {
    enGrupo.set(o.isco08, (enGrupo.get(o.isco08) ?? 0) + o.peso);
  }
  const mezcla = (antes: Map<string, number>, extra: Map<string, number>) =>
    new Map(
      [...new Set([...antes.keys(), ...extra.keys()])].map((k) => [
        k,
        (1 - PESO_DEL_AREA) * (antes.get(k) ?? 0) + (extra.get(k) ?? 0),
      ]),
    );
  const grupos = mezcla(new Map(previa.grupos.map((g) => [g.isco08, g.p])), deGrupo);
  const isco = new Map([...previa.ocupaciones, ...area.ocupaciones].map((o) => [o.esco, o.isco08]));
  const extraOcu = new Map(
    area.ocupaciones.map((o) => [o.esco, ((deGrupo.get(o.isco08) ?? 0) * o.peso) / (enGrupo.get(o.isco08) || 1)]),
  );
  const ocupaciones = mezcla(new Map(previa.ocupaciones.map((o) => [o.esco, o.p])), extraOcu);
  return {
    grupos: [...grupos].map(([isco08, p]) => ({ isco08, p })),
    fondo: (1 - PESO_DEL_AREA) * previa.fondo,
    ocupaciones: [...ocupaciones].map(([esco, p]) => ({ esco, isco08: isco.get(esco) ?? '', p })),
  };
}

/** Los nombres de oficio del diccionario (denominaciones-de-diccionario.ts), en palabras normalizadas. */
const NOMBRES_DE_DICCIONARIO: ReadonlySet<string> = new Set(
  [...DENOMINACIONES_DE_DICCIONARIO.values()].flatMap((d) => [...d.es, ...d.ca].map((n) => palabrasDe(n).join(' '))),
);

/** Verbos con que se presenta el oficio («hago de canguro», «faig de cangur»): no cambian qué oficio es. */
const VERBOS_DE_OFICIO: ReadonlySet<string> = new Set(['hago', 'hace', 'hacia', 'faig', 'fa', 'feia']);

const vocabularioPorDatos = new WeakMap<Datos, ReadonlySet<string>>();

/** Las palabras de los nombres oficiales de las ocupaciones (castellano y catalán), preparadas una vez por paquete. */
function vocabularioDeOficios(datos: Datos): ReadonlySet<string> {
  const guardado = vocabularioPorDatos.get(datos);
  if (guardado) {
    return guardado;
  }
  const vocabulario = new Set<string>();
  for (const [esco, o] of Object.entries(datos.esco.ocupaciones)) {
    for (const nombre of [o.titulo, ...(o.alternativos ?? []), tituloOcupacion(datos, esco).ca]) {
      for (const palabra of palabrasDe(nombre ?? '')) {
        vocabulario.add(palabra);
      }
    }
  }
  vocabularioPorDatos.set(datos, vocabulario);
  return vocabulario;
}

/**
 * Texto que leen los vectores. Se eliminan palabras de una marca que no nombran un oficio; las palabras
 * profesionales se conservan. Si no queda contenido, devuelve texto vacío y prevalece la señal de la marca.
 */
/** Si lo escrito (en su forma de ESCO, sin los verbos de oficio) es, entero, un nombre del diccionario. */
function esNombreDelDiccionario(comoEnEsco: string): boolean {
  return NOMBRES_DE_DICCIONARIO.has(
    palabrasDe(comoEnEsco)
      .filter((p) => !VERBOS_DE_OFICIO.has(p))
      .join(' '),
  );
}

export function textoParaVectores(datos: Datos, texto: string, busqueda: ResultadoDeBusqueda): string {
  const comoEnEsco = textoComoEnEsco(textoDeBusqueda(texto));
  // Un nombre de oficio del diccionario, solo («canguro», «doctor»): manda el diccionario, revisado; los vectores leían
  // «canguro» como el animal y proponían cuidador de mascotas.
  if (esNombreDelDiccionario(comoEnEsco)) {
    return '';
  }
  const deOficio = vocabularioDeOficios(datos);
  const deMarcas = new Set(
    busqueda.pistasDeSector.flatMap((p) => (p.marca ? p.palabra.split(' ') : [])).filter((p) => !deOficio.has(p)),
  );
  if (deMarcas.size === 0) {
    return comoEnEsco;
  }
  const sinMarca = normalizar(comoEnEsco)
    .split(' ')
    .filter((p) => p && !deMarcas.has(p))
    .join(' ');
  return palabrasDe(sinMarca).length > 0 ? sinMarca : '';
}

/** Puntos (escala del buscador) que da el clasificador a un grupo seguro del todo. */
const PUNTOS_DEL_CLASIFICADOR = 100;
/** Probabilidad mínima de un grupo del clasificador para entrar en la fusión, y cuántos grupos se miran. */
const P_MINIMA_DEL_CLASIFICADOR = 0.05;
const GRUPOS_DEL_CLASIFICADOR = 5;
/** Grupos del clasificador que entran como candidatos sea cual sea su probabilidad. */
const CLASIFICADOS_SIEMPRE = 2;

const generalDelGrupo = new WeakMap<Datos, Map<string, string>>();

/** La ocupación más general de un grupo (menos niveles en su código ESCO; con empate, el código menor). */
function ocupacionGeneralDelGrupo(datos: Datos, grupo: string): string | undefined {
  let mapa = generalDelGrupo.get(datos);
  if (!mapa) {
    mapa = new Map();
    const niveles = (c: string) => c.split('.').length;
    for (const [esco, o] of Object.entries(datos.esco.ocupaciones)) {
      const antes = mapa.get(o.isco08);
      if (!antes || niveles(esco) < niveles(antes) || (niveles(esco) === niveles(antes) && esco < antes)) {
        mapa.set(o.isco08, esco);
      }
    }
    generalDelGrupo.set(datos, mapa);
  }
  return mapa.get(grupo);
}

/**
 * Añade a la búsqueda los grupos candidatos del clasificador, puntuados con 100 × p. Cada grupo nuevo usa
 * su ocupación más general; en los existentes solo se eleva la mejor candidata si mejora su puntuación.
 */
function conGruposDelClasificador(
  datos: Datos,
  busqueda: ResultadoDeBusqueda,
  predichos: readonly GrupoProbable[],
): ResultadoDeBusqueda {
  if (predichos.length === 0) {
    return busqueda;
  }
  const candidatas = [...busqueda.candidatas];
  for (const { grupo, p } of predichos) {
    const puntos = PUNTOS_DEL_CLASIFICADOR * p;
    const i = candidatas.findIndex((c) => c.isco08 === grupo);
    if (i >= 0) {
      const c = candidatas[i];
      if (c && c.puntos < puntos) {
        candidatas[i] = { ...c, puntos };
      }
      continue;
    }
    const esco = ocupacionGeneralDelGrupo(datos, grupo);
    if (esco) {
      candidatas.push({
        esco,
        isco08: grupo,
        puntos,
        titulo: tituloOcupacion(datos, esco).es,
        tituloIsco: '',
        descripcion: '',
        cno11: [],
      });
    }
  }
  return { ...busqueda, candidatas };
}

/** Número de grupos del clasificador que se incorporan como rasgo de la fusión. */
const GRUPOS_CLASIFICADOS = 30;

/** Los 30 grupos más probables según el clasificador, o ninguno si aún no está cargado. */
function clasificacionesDelTexto(texto: string): GrupoProbable[] {
  // Con la forma de ESCO: «bienes raíces» no le dice nada; «inmobiliario», agente inmobiliario con 0,99.
  return clasificador?.predecir(textoComoEnEsco(textoDeBusqueda(texto)), GRUPOS_CLASIFICADOS) ?? [];
}

/** Probabilidad del clasificador y puntos del buscador desde los que, si coinciden en el grupo, mandan sobre los vectores. */
const P_CONSENSO = 0.8;
const PUNTOS_CONSENSO = 80;

/**
 * Consenso del buscador y el clasificador: misma primera candidata, con PUNTOS_CONSENSO y P_CONSENSO
 * respectivamente. Ese acuerdo prevalece sobre los vectores; sin ambos umbrales no se considera consenso.
 */
/** Raíz de una palabra sin tildes ni vocal final, para comparar «maquinista» con «maquinista de tren». */
function raiz(palabra: string): string {
  return normalizar(palabra).replace(/[aeo]s?$/, '');
}

/**
 * Si el área del buscador es de verdad un área («recursos humanos») y no un puesto: lo es si la primera candidata no
 * empieza por la misma palabra («maquinista» se detecta como área, pero «maquinista de tren» es un puesto; el motor
 * hace la misma prueba antes de preguntar por el área: motor.ts, esUnPuesto).
 */
function areaDeVerdad(busqueda: ResultadoDeBusqueda): boolean {
  if (!busqueda.area) {
    return false;
  }
  const primeraDelArea = busqueda.area.texto.split(' ')[0] ?? '';
  const primeraDelTitulo = (busqueda.candidatas[0]?.titulo ?? '').split(/[\s/]+/)[0] ?? '';
  return raiz(primeraDelArea) !== raiz(primeraDelTitulo);
}

/**
 * Consenso del diccionario: si lo escrito es, entero, un nombre del diccionario («portero»,
 * «canguro», una sigla) y la primera candidata del buscador es una ocupación del diccionario, manda el diccionario,
 * revisado con su fuente, también frente al clasificador: «portero» acababa en el portero de hotel porque el clasificador
 * lo asociaba al hotel. Hace de consenso: su grupo va en cabeza y se propone, con sus alternativas.
 */
function consensoDelDiccionario(
  texto: string,
  busqueda: ResultadoDeBusqueda,
  clasificados: readonly GrupoProbable[],
): GrupoProbable | null {
  const lexica = busqueda.candidatas[0];
  if (!lexica || busqueda.necesitaPrecision || busqueda.soloSector || !DENOMINACIONES_DE_DICCIONARIO.has(lexica.esco)) {
    return null;
  }
  if (!esNombreDelDiccionario(textoComoEnEsco(textoDeBusqueda(texto)))) {
    return null;
  }
  const p = clasificados.find((g) => g.grupo === lexica.isco08)?.p ?? 0;
  return { grupo: lexica.isco08, p: Math.max(p, P_CONSENSO) };
}

function grupoDeConsenso(busqueda: ResultadoDeBusqueda, predichos: readonly GrupoProbable[]): GrupoProbable | null {
  const lexica = busqueda.candidatas[0];
  const clasificada = predichos[0];
  if (!(lexica && clasificada) || busqueda.necesitaPrecision || areaDeVerdad(busqueda) || busqueda.soloSector) {
    return null;
  }
  const coinciden = lexica.isco08 === clasificada.grupo;
  return coinciden && lexica.puntos >= PUNTOS_CONSENSO && clasificada.p >= P_CONSENSO ? clasificada : null;
}

/** El grupo de consenso con la probabilidad del clasificador; lo demás (grupos, ocupaciones y fondo) se reparte el resto. */
function conProbabilidadDelClasificador(
  previa: PreviaDeFusion,
  consenso: GrupoProbable,
  suya: number,
  deLaCabeza: number,
): PreviaDeFusion {
  const nueva = Math.max(consenso.p, deLaCabeza, suya);
  const otros = suya < 1 ? (1 - nueva) / (1 - suya) : 0;
  const delGrupo = suya > 0 ? nueva / suya : 1;
  const escala = (isco08: string) => (isco08 === consenso.grupo ? delGrupo : otros);
  return {
    grupos: previa.grupos.map((g) => ({ ...g, p: g.isco08 === consenso.grupo ? nueva : g.p * otros })),
    fondo: previa.fondo * otros,
    ocupaciones: previa.ocupaciones.map((o) => ({ ...o, p: o.p * escala(o.isco08) })),
  };
}

/**
 * La previa con el grupo de consenso en cabeza. Si ya iba en cabeza, no cambia (subirlo escondía alternativas útiles:
 * «camarero» dejaba de ofrecer «camarero de barra»). Si otro grupo iba delante, se intercambian sus probabilidades
 * (y las de sus ocupaciones). Solo si la combinación no tiene opinión (ningún grupo llega al mínimo para proponer), el grupo
 * recibe la probabilidad del clasificador y lo demás se reparte el resto: con todo en el fondo, el motor no tenía a
 * quién proponer («bartender en un hotel» acababa en «no encontrada»).
 */
function conGrupoEnCabeza(previa: PreviaDeFusion, consenso: GrupoProbable): PreviaDeFusion {
  const suyo = previa.grupos.find((g) => g.isco08 === consenso.grupo);
  const cabeza = [...previa.grupos].sort((a, b) => b.p - a.p)[0];
  if (!(suyo && cabeza)) {
    return previa;
  }
  if (cabeza.p < CONFIGURACION.pMinimaPropuesta) {
    return conProbabilidadDelClasificador(previa, consenso, suyo.p, cabeza.p);
  }
  if (cabeza.isco08 === consenso.grupo) {
    return previa;
  }
  const factor = (isco08: string) => {
    if (isco08 === consenso.grupo) {
      return suyo.p > 0 ? cabeza.p / suyo.p : 1;
    }
    return isco08 === cabeza.isco08 ? suyo.p / cabeza.p : 1;
  };
  return {
    ...previa,
    grupos: previa.grupos.map((g) => ({ ...g, p: g.p * factor(g.isco08) })),
    ocupaciones: previa.ocupaciones.map((o) => ({ ...o, p: o.p * factor(o.isco08) })),
  };
}

/**
 * Si se propone sin preguntar: la fusión está segura, lo escrito es un nombre de oficio claro o el buscador y el
 * clasificador coinciden con seguridad; nunca tras un «No», con un área o con un sector solo (que preguntan).
 */
function proponerSinPreguntar(
  contexto: ContextoDePrevia,
  busqueda: ResultadoDeBusqueda,
  d: DecisionDeFusion,
  consenso: GrupoProbable | null,
): boolean {
  if (contexto.rechazada || busqueda.soloSector) {
    return false;
  }
  // El consenso ya descarta las áreas de verdad (grupoDeConsenso); un área que es un puesto («maquinista») no pregunta.
  if (consenso !== null) {
    return true;
  }
  return !busqueda.area && (d.esEsta || nombreDeOficioClaro(busqueda, d));
}

/** El modelo y los vectores de esta consulta: con vectores si ya están y hay texto para ellos; si no, solo léxico. */
function elegir(opciones: OpcionesDeFusion, texto: string, idioma: Idioma) {
  const v = opciones.conVectores;
  const vectores = texto ? v?.vectores(texto, idioma) : null;
  const elegido = v && vectores ? { ...v, vectores } : { ...opciones.sinVectores, vectores: [] };
  return clasificador ? elegido : { ...elegido, modelo: elegido.modeloSinClasificador ?? elegido.modelo };
}

function decidir(
  datos: Datos,
  busqueda: ResultadoDeBusqueda,
  contexto: ContextoDePrevia,
  { elegido, clasificados }: { readonly elegido: Elegido; readonly clasificados: readonly GrupoProbable[] },
) {
  return fusionar(
    {
      lexico: busqueda.candidatas,
      clasificador: clasificados.map((g) => [g.grupo, g.p] as const),
      vectores: elegido.vectores,
      pistas: busqueda.pistasDeSector,
      necesitaPrecision: busqueda.necesitaPrecision,
      idioma: contexto.idioma,
      texto: textoDeBusqueda(contexto.texto),
      oficioVacio: oficioVacio(datos, contexto.texto, busqueda),
    },
    elegido.modelo,
    {
      grupoDe: (esco) => datos.esco.ocupaciones[esco]?.isco08,
      ocupados: (isco08) => elegido.atributos?.grupos[isco08]?.pr,
    },
  );
}

type Elegido = ReturnType<typeof elegir> & { readonly atributos: Atributos | undefined };

/**
 * La previa con la fusión calibrada. Si no hay candidatos del buscador ni de los vectores,
 * la previa léxica busca por las tareas contadas.
 */
function previaDeFusion(opciones: OpcionesDeFusion): Previa {
  return (datos, busqueda, contexto) => {
    const lexica = previaLexica(datos, busqueda, contexto);
    const elegido = {
      ...elegir(
        opciones,
        busqueda.soloSector ? '' : textoParaVectores(datos, contexto.texto, busqueda),
        contexto.idioma,
      ),
      atributos: contexto.atributos ?? opciones.atributos,
    };
    // Las 30 del clasificador van a la fusión como rasgo propio; las 5 primeras con p ≥ 0,05 entran además como
    // candidatas y deciden el consenso.
    const clasificados = clasificacionesDelTexto(contexto.texto);
    // Los 2 primeros del clasificador entran siempre como candidatos, aunque duden: sin esta regla y
    // sin vectores, «tengo licencia de taxi», con su grupo 1.º en el clasificador a 0,04, no llegaría a la combinación.
    const predichos = clasificados
      .slice(0, GRUPOS_DEL_CLASIFICADOR)
      .filter((g, i) => g.p >= P_MINIMA_DEL_CLASIFICADOR || i < CLASIFICADOS_SIEMPRE);
    const d = decidir(datos, conGruposDelClasificador(datos, busqueda, predichos), contexto, { elegido, clasificados });
    if (d.grupos.length === 0) {
      return lexica;
    }
    // Proponer sin preguntar solo vale hasta el primer «No»; después se permite distinguir mediante preguntas.
    // El consenso comprobado entre buscador y clasificador encabeza la propuesta.
    const consenso = contexto.rechazada
      ? null
      : (consensoDelDiccionario(contexto.texto, busqueda, clasificados) ?? grupoDeConsenso(busqueda, predichos));
    const directa = proponerSinPreguntar(contexto, busqueda, d, consenso);
    const conAreaYa = conArea(previaParaElMotor(d), busqueda.area);
    const base = consenso ? conGrupoEnCabeza(conAreaYa, consenso) : conAreaYa;
    const previa = conSueloDelClasificador(base, contexto);
    return {
      candidatas: candidatasConTitulos(datos, lexica.candidatas, previa),
      previa: { ...previa, fondo: Math.max(previa.fondo, elegido.ajuste.fondoMinimo) },
      configuracion: configuracion(directa, elegido.ajuste),
      // Los 30 del clasificador, para completar la última lista.
      reserva: clasificados.map((g) => g.grupo),
      // En las alternativas, solo sin vectores.
      reservaEnAlternativas: elegido.vectores.length === 0,
    };
  };
}

/** Grupos del clasificador que entran siempre en la previa y el peso mínimo que reciben. */
const GRUPOS_DEL_SUELO = 10;
const SUELO_DEL_CLASIFICADOR = 0.01;

/**
 * Los diez grupos más probables del clasificador entran con al menos el 1 % de su masa desde la primera
 * respuesta. La pantalla inicial conserva la previa original; después, las preguntas pueden alcanzar grupos
 * que la combinación de señales dejó fuera.
 */
function conSueloDelClasificador<T extends PreviaExplicita>(previa: T, contexto: ContextoDePrevia): T {
  if (!contexto.conRespuestas) {
    return previa;
  }
  const predichos = clasificador?.predecir(textoComoEnEsco(textoDeBusqueda(contexto.texto)), GRUPOS_DEL_SUELO) ?? [];
  const nuevos = predichos.map((g) => g.grupo).filter((g) => !previa.grupos.some((x) => x.isco08 === g));
  if (nuevos.length === 0) {
    return previa;
  }
  const total = previa.grupos.reduce((s, g) => s + g.p, 0);
  return {
    ...previa,
    grupos: [...previa.grupos, ...nuevos.map((isco08) => ({ isco08, p: SUELO_DEL_CLASIFICADOR * total }))],
  } as T;
}

/**
 * Si la pantalla usa la tabla de vectores del dispositivo. Apagado, el navegador no la descarga.
 * Sustituir la tabla exige comprobar tanto cobertura como resultados del recorrido.
 */
export const VECTORES_EN_LA_PANTALLA = true;

/** La tabla de vectores del dispositivo, cuando ya está cargada; null mientras tanto. */
let tabla: Pick<VectoresMovil, 'similitudes'> | null = null;

/**
 * Da a la pantalla la tabla de vectores ya cargada y comprobada (o null para volver a solo léxico). La carga la hace
 * quien la tiene (el Worker del motor, o Node en las pruebas), sin que la pantalla la espere.
 */
export function usarVectores(cargada: Pick<VectoresMovil, 'similitudes'> | null): void {
  tabla = cargada;
}

/**
 * Si la pantalla usa el clasificador de fragmentos. Apagado, el navegador no lo descarga y utiliza el modelo
 * correspondiente sin esa señal.
 */
export const CLASIFICADOR_EN_LA_PANTALLA = true;

/** El clasificador de fragmentos, cuando ya está cargado (como la tabla de vectores); null mientras tanto. */
let clasificador: Pick<ClasificadorMovil, 'predecir'> | null = null;

/** Da a la pantalla el clasificador ya cargado y comprobado (o null para no usarlo). */
export function usarClasificador(cargado: Pick<ClasificadorMovil, 'predecir'> | null): void {
  clasificador = cargado;
}

/** Lo que la pantalla tiene cargado de su IA: la tabla de vectores y el clasificador de fragmentos. */
interface EstadoDeLaIa {
  readonly conVectores: boolean;
  readonly conClasificador: boolean;
}

/**
 * Si la tabla de vectores y el clasificador ya están cargados. Cada paso del recorrido lo lleva en su lectura
 * (ruta-local.ts): sin ellos la pantalla acierta menos con quien se equivoca al responder, y no debe pasar en silencio.
 */
export function estadoDeLaIa(): EstadoDeLaIa {
  return { conVectores: tabla !== null, conClasificador: clasificador !== null };
}

/** La previa de la pantalla: la fusión calibrada, con la tabla de vectores si ya está y solo léxica si no. */
export const previaCalibrada: Previa = previaDeFusion({
  sinVectores: {
    modelo: comprobarModelo(modeloLexico),
    modeloSinClasificador: comprobarModelo(modeloLexicoSinClasificador),
    ajuste: AJUSTE_LEXICO,
  },
  conVectores: {
    modelo: comprobarModelo(modeloEstatico),
    modeloSinClasificador: comprobarModelo(modeloEstaticoSinClasificador),
    ajuste: AJUSTE_ESTATICO,
    vectores: (texto, idioma) => (tabla ? [tabla.similitudes(texto, idioma)] : null),
  },
});
