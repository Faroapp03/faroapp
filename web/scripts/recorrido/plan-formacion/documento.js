/** Hoja de ruta del plan: con cursos, dos hojas (calendario orientativo y datos de cada curso); sin cursos, una hoja con
 * recursos abiertos para seguir aprendiendo mientras tanto. */
import { TEXTOS_FORMACION as CA } from '../../../idiomas/ca/formacion.js';
import { TEXTOS_FORMACION as ES } from '../../../idiomas/es/formacion.js';
import { crear } from '../../dom.js';
import { bloqueDeAcreditacion } from './acreditacion-documento.js';
import { crearAgenda } from './agenda.js';
import { botonDelCalendario } from './calendario-ics.js';
import { contactoDeOpcion } from './contactos-proveedores.js';
import {
  avisosPorConfirmar,
  etiquetaDeIdioma,
  lineasDeLaFicha,
  nombreDeIdioma,
  textoDeComprobacion,
  textoDelLimite,
  tituloDelCurso,
} from './ficha-oferta.js';
import { nivelDeOpcion } from './metadatos.js';
import { bloqueMientrasTanto } from './mientras-tanto.js';
import { fechaDelPlan, fechaEnBarcelona, textoDocumento } from './textos-documento.js';
import { vistaAgendaInicial, vistaCronograma } from './vista-cronograma.js';

/** @import { PlanElegido, OpcionPlan, IdiomaPlan } from './contrato.js' */
/** @template {keyof HTMLElementTagNameMap} E @param {E} etiqueta @param {string} texto @param {string} [clase] */
function con(etiqueta, texto, clase = '') {
  const elemento = crear(etiqueta);
  elemento.className = clase;
  elemento.textContent = texto;
  return elemento;
}
/** Lo que la persona respondió al preparar la hoja, en una sola línea para no alargar el documento impreso.
 * @param {PlanElegido} plan */
function datosDePreferencias(plan) {
  const p = plan.preferencias;
  const t = (/** @type {Parameters<typeof textoDocumento>[1]} */ clave) => textoDocumento(plan.idioma, clave);
  return [
    [t('nivel'), t(p.nivel)],
    [t('nivelDigital'), t(p.nivelDigital)],
    [t('idiomas'), p.idiomas.map((codigo) => nombreDeIdioma(codigo, plan.idioma)).join(', ')],
    [t('modalidad'), t(p.modalidad)],
    [t('inicio'), fechaDelPlan(p.inicio, plan.idioma)],
  ];
}
/** @param {PlanElegido} plan */
function loQueNosDijiste(plan) {
  const d = plan.idioma === 'ca' ? CA : ES;
  const datos = datosDePreferencias(plan)
    .map(([rotulo, valor]) => `${rotulo}: ${valor}`)
    .join(' · ');
  return crear(
    'p',
    { className: 'pe-dijiste' },
    con('strong', `${d['formacion.dijiste.titulo']}: `),
    document.createTextNode(datos),
  );
}
/** @param {PlanElegido} plan @param {number} numero @param {number} total @param {HTMLElement} cuerpo */
function hoja(plan, numero, total, cuerpo) {
  const t = (/** @type {Parameters<typeof textoDocumento>[1]} */ clave) => textoDocumento(plan.idioma, clave);
  const pagina = crear(
    'section',
    { className: 'hd-hoja' },
    crear(
      'div',
      { className: 'hd-banda' },
      con('span', 'FARO'),
      con('span', `${t('hoja')} ${numero} ${t('de')} ${total}`),
    ),
    cuerpo,
    crear('footer', { className: 'hd-pie' }, con('span', `${numero} / ${total}`)),
  );
  pagina.dataset.hoja = String(numero);
  pagina.setAttribute('aria-labelledby', numero === 1 ? 'hd-titulo' : 'hd-titulo-2');
  return pagina;
}
const ENTRADILLAS = {
  es: [
    'Recursos para seguir aprendiendo mientras tanto.',
    'Un curso, un plan adaptado a tu tiempo.',
    'Dos cursos, un plan adaptado a tu tiempo.',
  ],
  ca: [
    'Recursos per continuar aprenent mentrestant.',
    'Un curs, un pla adaptat al teu temps.',
    'Dos cursos, un pla adaptat al teu temps.',
  ],
};
/** @param {PlanElegido} plan @param {number} numero */
function cabecera(plan, numero) {
  const ca = plan.idioma === 'ca';
  const titulos =
    numero === 1
      ? ['Tu plan de formación', 'El teu pla de formació']
      : ['Tu agenda de estudio', 'La teva agenda d’estudi'];
  const titulo = con('h2', titulos[ca ? 1 : 0] ?? '');
  titulo.id = numero === 1 ? 'hd-titulo' : 'hd-titulo-2';
  return crear(
    'header',
    { className: 'pe-cabecera' },
    con('p', `FARO / ${ca ? 'PLA PERSONAL' : 'PLAN PERSONAL'}`, 'pe-antetitulo'),
    titulo,
    con(
      'p',
      (numero === 1
        ? [
            ENTRADILLAS.es[plan.elecciones.length] ?? ENTRADILLAS.es[2],
            ENTRADILLAS.ca[plan.elecciones.length] ?? ENTRADILLAS.ca[2],
          ]
        : [
            'Tus primeras sesiones y los datos de cada curso.',
            'Les teves primeres sessions i les dades de cada curs.',
          ])[ca ? 1 : 0] ?? '',
      'pe-entradilla',
    ),
  );
}
/** @param {string} url @param {string} etiqueta */
function enlace(url, etiqueta) {
  const destino = new URL(url);
  if (!['http:', 'https:'].includes(destino.protocol)) {
    throw new TypeError('Enlace público no válido');
  }
  return crear('a', {
    href: destino.href,
    target: '_blank',
    rel: 'noopener noreferrer',
    className: 'pe-enlace',
    textContent: etiqueta,
  });
}
/** @param {ReturnType<typeof contactoDeOpcion>} contacto @param {OpcionPlan} opcion @param {IdiomaPlan} idioma */
function datosContacto(contacto, opcion, idioma) {
  const ca = idioma === 'ca';
  if (!contacto) {
    return [
      enlace(
        opcion.oferta.url,
        ca ? 'Consulta el contacte a la fitxa del curs' : 'Consulta el contacto en la ficha del curso',
      ),
    ];
  }
  const nodos = [];
  const datos = [contacto.telefono, contacto.correo].filter(Boolean).join(' · ');
  if (datos) {
    nodos.push(con('p', datos));
  }
  nodos.push(enlace(contacto.url, ca ? 'Ajuda del proveïdor' : 'Ayuda del proveedor'));
  if (contacto.fuente !== contacto.url) {
    nodos.push(enlace(contacto.fuente, ca ? 'Font del contacte' : 'Fuente del contacto'));
  }
  nodos.push(con('p', `${ca ? 'Comprovat' : 'Comprobado'}: ${fechaDelPlan(contacto.comprobadoEl, idioma)}`, 'pe-nota'));
  return nodos;
}
/** @param {OpcionPlan} opcion @param {IdiomaPlan} idioma @param {number} indice */
function fichaCompacta(opcion, idioma, indice) {
  const ca = idioma === 'ca';
  const contacto = contactoDeOpcion(opcion);
  const etiqueta = etiquetaDeIdioma(opcion, idioma);
  const limite = textoDelLimite(opcion, idioma);
  const nodos = [
    crear('h4', {}, `${indice + 1} · `, tituloDelCurso(opcion)),
    ...(etiqueta ? [con('p', etiqueta, 'pe-idioma-curso')] : []),
    con('p', `${ca ? 'Nivell' : 'Nivel'}: ${nivelDeOpcion(opcion, idioma)}`, 'pe-nivel-curso'),
    con('p', opcion.motivo[idioma], 'pe-motivo'),
    ...lineasDeLaFicha(opcion, idioma).map((linea) => con('p', linea, 'pe-nota')),
    ...avisosPorConfirmar(opcion, idioma).map((aviso) => con('p', aviso, 'pe-nota')),
    ...(limite ? [con('p', limite, 'pe-nota')] : []),
    con('p', textoDeComprobacion(opcion, idioma), 'pe-nota'),
    enlace(opcion.oferta.url, ca ? 'Fitxa oficial del curs' : 'Ficha oficial del curso'),
    ...(opcion.oferta.incidencia_enlace_el
      ? [
          con(
            'p',
            `${(ca ? CA : ES)['formacion.doc.aviso-enlace']} (${fechaEnBarcelona(opcion.oferta.incidencia_enlace_el, idioma)})`,
            'pe-nota',
          ),
        ]
      : []),
    ...datosContacto(contacto, opcion, idioma),
  ];
  return crear('article', { className: 'pe-ficha-compacta' }, ...nodos);
}
/** @param {PlanElegido} plan @param {ReturnType<typeof crearAgenda>['cronograma']} cronograma */
function segundaHoja(plan, cronograma) {
  const ca = plan.idioma === 'ca';
  return crear(
    'div',
    { className: 'hd-cuerpo' },
    cabecera(plan, 2),
    vistaAgendaInicial(plan, cronograma),
    botonDelCalendario(plan, cronograma),
    crear(
      'section',
      { className: 'pe-contactos' },
      con('h3', ca ? 'Cursos i contacte' : 'Cursos y contacto'),
      crear(
        'div',
        { className: 'pe-fichas-compactas' },
        ...plan.elecciones.map((opcion, indice) => fichaCompacta(opcion, plan.idioma, indice)),
      ),
    ),
    con('p', textoDocumento(plan.idioma, 'alcance'), 'pe-aviso'),
  );
}
/** @param {PlanElegido} plan */
function mientrasTanto(plan) {
  const d = plan.idioma === 'ca' ? CA : ES;
  return bloqueMientrasTanto(
    (elemento, clave) => {
      elemento.textContent = d[/** @type {keyof typeof d} */ (clave)];
      return elemento;
    },
    { conAcreditacion: Boolean(plan.acreditacion), clase: 'pe-mientras-tanto' },
  );
}
/** @param {PlanElegido} plan */
export function crearDocumentoDelPlan(plan) {
  const cursos = plan.elecciones.length > 0 ? crearAgenda(plan).cronograma : null;
  const primera = crear(
    'div',
    { className: 'hd-cuerpo' },
    cabecera(plan, 1),
    crear(
      'section',
      { className: 'pe-seccion' },
      con('h3', textoDocumento(plan.idioma, 'objetivo')),
      con('p', plan.objetivo, 'pe-objetivo'),
      loQueNosDijiste(plan),
    ),
  );
  primera.append(cursos ? vistaCronograma(plan, cursos) : mientrasTanto(plan), ...bloqueDeAcreditacion(plan));
  const total = cursos ? 2 : 1;
  const hojas = [hoja(plan, 1, total, primera)];
  if (cursos) {
    hojas.push(hoja(plan, 2, total, segundaHoja(plan, cursos)));
  }
  const documento = crear(
    'div',
    { className: 'hd', lang: plan.idioma },
    crear('div', { className: 'hd-documento' }, ...hojas),
  );
  documento.dataset.planElegido = '';
  return documento;
}
