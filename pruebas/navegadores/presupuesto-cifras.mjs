// Las cifras del ensayo del presupuesto de rendimiento, calculadas del registro del servidor del ensayo: por vía, el
// JavaScript con el criterio del servidor que comparte con descargas-js.mjs (presupuesto-criterios.mjs), la compresión
// por tipo de contenido y las duplicaciones (mismo contenido bajo direcciones distintas y peticiones repetidas a la
// misma dirección). El resumen en Markdown está en presupuesto-resumen.mjs.
import { esJavaScriptDelServidor } from './presupuesto-criterios.mjs';
import { COMPRIMIBLE } from './presupuesto-servidor.mjs';

/**
 * Una respuesta comprimida que conserva más de esta fracción de su peso gana poco: se lista para revisarla (no es un
 * techo; nada falla por ello).
 */
export const POCA_GANANCIA = 0.9;
const CIFRAS_DE_HUELLA = 16;
const CORRECTO = 200;
const NO_AUTORIZADO = 401;

/**
 * La vía de una petición, por su destino (`sec-fetch-dest`), como en analisis-por-via: el propio service worker;
 * `fetch` (destino `empty`: la precarga y el paquete del service worker, y también los fetch() de la página, como los
 * diccionarios); y la página con sus Workers (documento, scripts, estilos, fuentes, imágenes, Workers).
 */
export const VIAS = Object.freeze({
  serviceWorker: 'el propio service worker (destino serviceworker)',
  fetch: 'fetch: precarga y paquete del service worker y fetch() de la página (destino empty)',
  pagina: 'la página y sus Workers (documento, script, style, font, image, worker…)',
});
export function viaDe(destino) {
  if (destino === 'serviceworker') {
    return 'serviceWorker';
  }
  return destino === 'empty' ? 'fetch' : 'pagina';
}

/** Los tipos de contenido del resumen de compresión, por su `content-type`; el primero que encaja. */
const TIPOS = [
  ['JS', /javascript/u],
  ['JSON', /json/u],
  ['HTML', /html/u],
  ['CSS', /css/u],
  ['fuentes', /^font\//u],
  ['imágenes', /^image\//u],
];
export const tipoDe = (tipo) => TIPOS.find(([, patron]) => patron.test(tipo ?? ''))?.[0] ?? 'otros';

const suma = (lista, campo) => lista.reduce((total, e) => total + (e[campo] ?? 0), 0);
/** El tamaño de la respuesta tal como sale; los registros anteriores a R1f solo traen `servidos`, que entonces lo era. */
const tamanoDe = (e) => e.tamano ?? e.servidos ?? 0;

const conCuerpo = (entradas) => entradas.filter((e) => e.metodo === 'GET' && e.estado === CORRECTO && e.sinComprimir);

/**
 * Los GET respondidos con 401 cuya ruta se vuelve a pedir después en el mismo grupo: peticiones reales, que siguen
 * contando en `peticiones` y en `repetidas`, hechas porque el navegador pide la credencial Basic solo tras el desafío
 * (WebKit la manda por adelantado solo dentro del ámbito que ya conoce). Se leen aparte de las demás cifras.
 */
export function repeticionesDeAutenticacion(entradas) {
  return entradas.filter(
    (e, i) => e.metodo === 'GET' && e.estado === NO_AUTORIZADO && entradas.slice(i + 1).some((d) => d.ruta === e.ruta),
  ).length;
}

/**
 * Peticiones, direcciones distintas, repetidas y bytes de un grupo de peticiones del registro; además, cuántas de las
 * peticiones son repeticiones de autenticación (también cuentan en las anteriores). `bytesServidos` es lo escrito de
 * verdad (depende de cuándo corta el navegador); `bytesDeLasRespuestas`, lo que pesan las respuestas tal como salen,
 * que no depende de los cortes: es la cifra que se compara entre repeticiones.
 */
export function cifras(entradas) {
  const direcciones = new Set(entradas.map((e) => e.ruta)).size;
  return {
    peticiones: entradas.length,
    direcciones,
    repetidas: entradas.length - direcciones,
    bytesServidos: suma(entradas, 'servidos'),
    bytesDeLasRespuestas: entradas.reduce((total, e) => total + tamanoDe(e), 0),
    bytesSinComprimir: suma(entradas, 'sinComprimir'),
    repeticionesDeAutenticacion: repeticionesDeAutenticacion(entradas),
  };
}

/**
 * Por tipo de contenido: respuestas, bytes sin comprimir, tamaño de las respuestas, bytes servidos, razón de compresión y
 * codificaciones. La razón sale del tamaño (lo que pesa la respuesta tal como sale), no de lo servido, que en una
 * respuesta cortada es solo una parte.
 */
export function compresionPorTipo(entradas) {
  const porTipo = {};
  for (const e of conCuerpo(entradas)) {
    const clase = tipoDe(e.tipo);
    porTipo[clase] ??= { respuestas: 0, sinComprimir: 0, tamano: 0, servidos: 0, codificaciones: {} };
    const grupo = porTipo[clase];
    grupo.respuestas += 1;
    grupo.sinComprimir += e.sinComprimir;
    grupo.tamano += tamanoDe(e);
    grupo.servidos += e.servidos ?? 0;
    const clave = e.codificacion ?? 'ninguna';
    grupo.codificaciones[clave] = (grupo.codificaciones[clave] ?? 0) + 1;
  }
  for (const grupo of Object.values(porTipo)) {
    grupo.razon = grupo.tamano ? grupo.sinComprimir / grupo.tamano : null;
  }
  return porTipo;
}

/** Una línea de las listas de compresión: dirección, tipo, bytes y lo que aceptaba el navegador. */
const linea = (e) => ({
  ruta: e.ruta,
  tipo: e.tipo,
  destino: e.destino,
  sinComprimir: e.sinComprimir,
  tamano: tamanoDe(e),
  servidos: e.servidos,
  aceptada: e.aceptada,
});

/** Lo que es texto y salió sin comprimir (candidato a mejora) y lo comprimido que gana poco, por dirección. */
export function revisionDeCompresion(entradas) {
  const unicas = new Map(conCuerpo(entradas).map((e) => [`${e.ruta}|${e.codificacion}`, e]));
  const lista = [...unicas.values()];
  return {
    textoSinComprimir: lista.filter((e) => !e.codificacion && COMPRIMIBLE.test(e.tipo ?? '')).map(linea),
    pocaGanancia: lista.filter((e) => e.codificacion && tamanoDe(e) > POCA_GANANCIA * e.sinComprimir).map(linea),
  };
}

/** Los mismos bytes bajo direcciones distintas (misma huella del contenido sin comprimir), con lo que sobra. */
export function mismoContenido(entradas) {
  const porHuella = new Map();
  for (const e of conCuerpo(entradas)) {
    const grupo = porHuella.get(e.huella) ?? new Map();
    grupo.set(e.ruta, e);
    porHuella.set(e.huella, grupo);
  }
  const grupos = [...porHuella.entries()]
    .filter(([, rutas]) => rutas.size > 1)
    .map(([huella, rutas]) => {
      const lista = [...rutas.values()];
      return {
        huella: huella.slice(0, CIFRAS_DE_HUELLA),
        rutas: lista.map((e) => e.ruta),
        bytes: lista[0].sinComprimir,
        sobranSinComprimir: suma(lista.slice(1), 'sinComprimir'),
        sobranServidos: suma(lista.slice(1), 'servidos'),
      };
    });
  return {
    grupos,
    bytesDuplicadosSinComprimir: suma(grupos, 'sobranSinComprimir'),
    bytesDuplicadosServidos: suma(grupos, 'sobranServidos'),
  };
}

/** Las direcciones pedidas más de una vez en la visita: dentro de cada vía y por más de una vía. */
export function repeticiones(entradas) {
  const veces = new Map();
  for (const e of entradas.filter((x) => x.metodo === 'GET')) {
    const porVia = veces.get(e.ruta) ?? {};
    porVia[viaDe(e.destino)] = (porVia[viaDe(e.destino)] ?? 0) + 1;
    veces.set(e.ruta, porVia);
  }
  const dentroDeUnaVia = {};
  const porVariasVias = [];
  for (const [ruta, porVia] of veces) {
    for (const [via, n] of Object.entries(porVia)) {
      if (n > 1) {
        dentroDeUnaVia[via] ??= [];
        dentroDeUnaVia[via].push({ ruta, veces: n });
      }
    }
    if (Object.keys(porVia).length > 1) {
      porVariasVias.push({ ruta, porVia });
    }
  }
  return { dentroDeUnaVia, porVariasVias };
}

/** Las cifras completas de una visita: todo, por vía, el JavaScript, compresión y duplicaciones. */
export function cifrasDelRegistro(registro, corte) {
  const get = registro.filter((e) => e.metodo === 'GET');
  const porVia = Object.fromEntries(
    Object.keys(VIAS).map((via) => [via, cifras(get.filter((e) => viaDe(e.destino) === via))]),
  );
  const js = get.filter(esJavaScriptDelServidor);
  return {
    todo: cifras(registro),
    get: cifras(get),
    porVia,
    javascript: cifras(js),
    javascriptAlCorte: cifras(js.filter((e) => e.llegada <= corte)),
    compresion: compresionPorTipo(get),
    revisionDeCompresion: revisionDeCompresion(get),
    mismoContenido: mismoContenido(get),
    repeticiones: repeticiones(get),
    protocolos: [...new Set(registro.map((e) => e.protocolo))],
    sinIdentidadEsperada: registro.filter((e) => !e.identidadEsperada).length,
    cortadas: registro.filter((e) => e.completa === false).map((e) => e.ruta),
  };
}
