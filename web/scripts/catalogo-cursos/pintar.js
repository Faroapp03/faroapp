/** Fichas de hechos acreditados: hechos publicados y orientación de Faro, identificados por separado. */
import { esCalendario, rangosEncontrados } from '../../recursos/catalogo-cursos/lector.js';
import { cifraHasta, importe as importeEscrito } from '../cifras.js';
import { idiomaActual, texto } from '../textos.js';
import { describirIdiomas } from './descripcion-idioma.js';
import { conMayuscula, diaDeCurso, fechaDeCurso, periodoDeCurso } from './fechas-de-curso.js';
import { iconoTema } from './iconos.js';

/** @import { FichaListado, HechoFicha } from '../../recursos/catalogo-cursos/lector.js' */
/** Las horas publicadas, con todos sus decimales (hasta 20) y sin ceros sobrantes. */
const MAX_DECIMALES = 20;
const NUMERO_BARRAS = 3;
const SESIONES_EN_FICHA = 2;
/** @param {string} etiqueta @param {string} clase @param {string} [contenido] */
function elemento(etiqueta, clase, contenido = '') {
  const nodo = document.createElement(etiqueta);
  nodo.className = clase;
  nodo.textContent = contenido;
  return nodo;
}
/** @param {HTMLElement} nodo @param {string} titulo @param {string} consulta */
function resaltar(nodo, titulo, consulta) {
  let anterior = 0;
  for (const [desde, hasta] of rangosEncontrados(titulo, consulta)) {
    nodo.append(
      document.createTextNode(titulo.slice(anterior, desde)),
      elemento('mark', '', titulo.slice(desde, hasta)),
    );
    anterior = hasta;
  }
  nodo.append(document.createTextNode(titulo.slice(anterior)));
}
/** @param {HechoFicha} hecho */
function conocido(hecho) {
  return hecho.motivo === 'conocido' && hecho.valor !== null;
}
/** @param {string} clave @param {string | null} valor @param {string} [nota] */
function dato(clave, valor, nota) {
  const bloque = document.createElement('div');
  const etiqueta = valor ?? texto(clave === 'nivel' ? 'catalogo.nivel.no-indicado' : 'catalogo.desconocido');
  const contenido = elemento('dd', valor === null ? 'cursos-no-indicado' : '', etiqueta);
  if (clave === 'nivel') {
    const nivel = elemento('span', 'lecturas-nivel');
    const barras = elemento('span', 'lecturas-barras');
    barras.setAttribute('aria-hidden', 'true');
    barras.append(...Array.from({ length: NUMERO_BARRAS }, () => elemento('span', 'lecturas-barra')));
    nivel.append(barras, document.createTextNode(etiqueta));
    contenido.replaceChildren(nivel);
  }
  if (nota) {
    contenido.append(elemento('small', '', nota));
  }
  bloque.append(elemento('dt', '', texto(`catalogo.dato.${clave}`)), contenido);
  return bloque;
}
/** @typedef {{readonly inicio:string|null, readonly fin:string|null}} Periodo */
/** Una sesión, tras la etiqueta de su calendario: su periodo o su fecha sola. @param {Periodo} sesion */
function sesionPublicada(sesion) {
  const idioma = idiomaActual();
  if (sesion.inicio && sesion.fin) {
    return periodoDeCurso(sesion.inicio, sesion.fin, idioma);
  }
  const fecha = sesion.inicio ?? sesion.fin;
  return fecha ? fechaDeCurso(fecha, idioma) : texto('catalogo.desconocido');
}
/**
 * Un periodo publicado que no es una lista de sesiones. Con sus dos extremos, «Formación: del 5 de enero al 24 de
 * octubre de 2026»; con uno solo, una etiqueta que dice qué fecha es: «Empieza: 5 de enero de 2026».
 * @param {string} etiqueta formacion, aula o matricula @param {Periodo} periodo
 */
function periodoPublicado(etiqueta, periodo) {
  if (periodo.inicio && periodo.fin) {
    return `${texto(`catalogo.fechas.${etiqueta}`)}: ${sesionPublicada(periodo)}`;
  }
  if (periodo.inicio) {
    return texto(`catalogo.fechas.${etiqueta}.inicio`, { fecha: fechaDeCurso(periodo.inicio, idiomaActual()) });
  }
  if (periodo.fin) {
    return texto(`catalogo.fechas.${etiqueta}.fin`, { fecha: fechaDeCurso(periodo.fin, idiomaActual()) });
  }
  return `${texto(`catalogo.fechas.${etiqueta}`)}: ${texto('catalogo.desconocido')}`;
}
/** @param {FichaListado} oferta */
function fechasDeOferta(oferta) {
  const partes = [];
  for (const { hecho, etiqueta } of [
    { hecho: oferta.hechos.calendario_formacion, etiqueta: 'formacion' },
    { hecho: oferta.hechos.calendario_aula, etiqueta: 'aula' },
    ...(oferta.preinscripcion ? [] : [{ hecho: oferta.hechos.calendario_matricula, etiqueta: 'matricula' }]),
  ]) {
    if (!conocido(hecho) || !esCalendario(hecho.valor)) {
      continue;
    }
    const calendario = hecho.valor;
    if (calendario.tipo === 'sesiones') {
      partes.push(`${texto(`catalogo.fechas.${etiqueta}`)}: ${sesionesPublicadas(calendario.sesiones)}`);
    } else {
      partes.push(periodoPublicado(etiqueta, calendario));
    }
  }
  return partes.length ? partes.join(' · ') : null;
}
/** @param {readonly Periodo[]} sesiones */
function sesionesPublicadas(sesiones) {
  const partes = sesiones.slice(0, SESIONES_EN_FICHA).map(sesionPublicada);
  if (sesiones.length > SESIONES_EN_FICHA) {
    partes.push(texto('catalogo.fechas.mas-sesiones', { n: sesiones.length - SESIONES_EN_FICHA }));
  }
  return partes.join('; ');
}
/** @param {FichaListado} oferta */
function fechasYDestinatarios(oferta) {
  const fechas = fechasDeOferta(oferta);
  if (!oferta.preinscripcion) {
    return [dato('fechas', fechas)];
  }
  const { inicio, fin, centro, colectivos, sector } = oferta.preinscripcion;
  const filas = fechas ? [dato('fechas', fechas)] : [];
  filas.push(
    dato(
      'preinscripcion',
      conMayuscula(periodoDeCurso(inicio, fin, idiomaActual())),
      texto('catalogo.solicitar', { centro }),
    ),
    dato('destinatarios', colectivos.map((c) => texto(`catalogo.colectivo.${c}`)).join(' · ')),
  );
  if (sector.toUpperCase() !== 'INTERSECTORIAL') {
    filas.push(dato('sector', sector));
  }
  return filas;
}
/** @param {FichaListado['nivel']} nivel */
function datoNivel(nivel) {
  const etiqueta = nivel.valor ? texto(`catalogo.nivel.${nivel.valor}`) : null;
  const motivo = nivel.motivo[idiomaActual()];
  if (!etiqueta) {
    return dato('nivel', null, motivo);
  }
  const origen = texto(`catalogo.nivel.origen.${nivel.origen}`);
  const literal =
    nivel.origen === 'fuente' && nivel.literal && nivel.literal !== etiqueta ? ` («${nivel.literal}»)` : '';
  return dato('nivel', etiqueta, motivo.startsWith(origen) ? motivo : `${origen}${literal}. ${motivo}`);
}
/** @param {FichaListado} oferta */
function vistazo(oferta) {
  const { hechos } = oferta;
  const horas = hechos.horas_publicadas;
  const duracion =
    conocido(horas) && typeof horas.valor === 'number'
      ? texto(horas.valor === 1 ? 'catalogo.hora' : 'catalogo.horas', {
          n: cifraHasta(horas.valor, MAX_DECIMALES),
        })
      : null;
  const modalidad = conocido(hechos.modalidad) ? texto(`catalogo.modalidad.${hechos.modalidad.valor}`) : null;
  const directo =
    hechos.modalidad.valor === 'en-linea' && hechos.sincronia.valor === 'sincrona' && conocido(hechos.sincronia)
      ? texto('catalogo.directo')
      : undefined;
  const idioma = describirIdiomas(oferta.idiomas, oferta.origenIdioma, idiomaActual());
  const lista = elemento('dl', 'lecturas-vistazo cursos-vistazo');
  lista.append(
    datoNivel(oferta.nivel),
    dato('duracion', duracion),
    dato('modalidad', modalidad, directo),
    ...fechasYDestinatarios(oferta),
    dato('idioma', idioma.valor, idioma.nota),
    dato(
      'abre',
      texto('catalogo.ficha'),
      texto('catalogo.comprobado', { fecha: diaDeCurso(oferta.comprobado_el, idiomaActual()) }),
    ),
  );
  return lista;
}
/** @param {FichaListado} oferta */
function etiquetas(oferta) {
  const lista = elemento('ul', 'cursos-etiquetas');
  lista.append(elemento('li', 'cursos-etiqueta cursos-etiqueta--gratis', texto('catalogo.gratuito')));
  const certificado = oferta.hechos.certificado_gratuito;
  if (conocido(certificado) && certificado.valor === true) {
    const clave =
      certificado.alcance === 'declaracion_general' ? 'catalogo.certificado-general' : 'catalogo.certificado';
    lista.append(elemento('li', 'cursos-etiqueta', texto(clave)));
  }
  const precio = oferta.hechos.coste_certificado;
  if (conocido(precio) && typeof precio.valor === 'number' && precio.valor > 0 && precio.moneda) {
    const importe = importeEscrito(precio.valor, precio.moneda);
    lista.append(elemento('li', 'cursos-etiqueta', texto('catalogo.certificado-pago', { importe })));
  }
  return lista;
}
/** @param {FichaListado} oferta @param {string} proveedor @param {string} consulta */
function tarjeta(oferta, proveedor, consulta) {
  const temas = oferta.temas;
  const tema = temas[0] ?? 'no-indicado';
  const articulo = elemento('li', 'lecturas-ficha cursos-ficha');
  const tipo = elemento('div', 'lecturas-ficha-tipo');
  tipo.append(
    iconoTema(tema),
    elemento('span', 'lecturas-ficha-rotulo', temas.map((materia) => texto(`catalogo.icono.${materia}`)).join(' · ')),
  );
  const cuerpo = elemento('div', 'lecturas-ficha-cuerpo');
  const titulo = elemento('h3', 'lecturas-ficha-titulo');
  const enlace = document.createElement('a');
  enlace.href = oferta.url;
  enlace.target = '_blank';
  enlace.rel = 'noopener noreferrer';
  resaltar(enlace, oferta.titulo_programa, consulta);
  enlace.append(elemento('span', 'solo-lectores', ` · ${texto('catalogo.nueva-pestana')}`));
  titulo.append(enlace);
  cuerpo.append(elemento('p', 'lecturas-ficha-fuente', proveedor), titulo);
  // Una incidencia del enlace no retira el curso ni su enlace: solo se avisa junto a él.
  if (oferta.incidencia_enlace_el !== null) {
    cuerpo.append(elemento('p', 'lecturas-aviso', texto('catalogo.aviso-enlace')));
  }
  cuerpo.append(etiquetas(oferta), vistazo(oferta));
  articulo.append(tipo, cuerpo);
  return articulo;
}
/** @type {WeakMap<HTMLElement,{ofertas: readonly FichaListado[], consulta:string, idioma:string}>} */
const pintadas = new WeakMap();
/** Al ampliar la lista se conservan las fichas existentes, su foco y su posición.
 * @param {HTMLElement} lista @param {readonly FichaListado[]} ofertas @param {string} [consulta] */
export function pintarOfertas(lista, ofertas, consulta = '') {
  const idioma = idiomaActual();
  const anterior = pintadas.get(lista);
  const conservar =
    anterior &&
    anterior.consulta === consulta &&
    anterior.idioma === idioma &&
    lista.children.length === anterior.ofertas.length &&
    anterior.ofertas.every((o, i) => o === ofertas[i]);
  if (conservar) {
    lista.append(...ofertas.slice(anterior.ofertas.length).map((o) => tarjeta(o, o.proveedor, consulta)));
  } else {
    lista.replaceChildren(...ofertas.map((o) => tarjeta(o, o.proveedor, consulta)));
  }
  pintadas.set(lista, { ofertas, consulta, idioma });
}
