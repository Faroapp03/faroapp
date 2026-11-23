/** Propuesta acreditada: aporta contenido justificable y muestra los huecos sin completarlos por apariencia. */
import { crear } from '../dom.js';
import { escribir } from '../idioma.js';
import { conVersiones, traducible } from '../textos.js';
import { condicionesDeOpcion } from './formacion/condiciones.js';
import { detalleDeFicha } from './formacion/ficha-curso.js';
import { paginarCursos } from './formacion/lista-paginada.js';
import { lineasDeLaFicha, resumenDeOferta, tituloDelCurso } from './plan-formacion/ficha-oferta.js';
import { nivelDeOpcion } from './plan-formacion/metadatos.js';
import { bloqueMientrasTanto } from './plan-formacion/mientras-tanto.js';

let siguientePropuesta = 0;

/** @import { SeleccionFormacion } from '../../../src/seleccion-formacion/contrato.ts' */
/** @param {string} clave */
const t = (clave) => traducible(`formacion.${clave}`);
/** @template {keyof HTMLElementTagNameMap} E @param {E} etiqueta @param {string} clave @param {string} [clase] */
function con(etiqueta, clave, clase = '') {
  const elemento = crear(etiqueta);
  elemento.className = clase;
  return escribir(elemento, t(clave));
}
/** Los datos de la oferta en los dos idiomas: la fila sigue al idioma de la página si la persona lo cambia.
 * @param {(idioma:'es'|'ca')=>string} texto */
const enLosDosIdiomas = (texto) => conVersiones({ es: texto('es'), ca: texto('ca') });
/** @param {import('../../../src/seleccion-formacion/contrato.ts').OpcionPlan} opcion */
function detallesDelCurso(opcion) {
  const objetivos = detalleDeFicha(opcion.aprendizaje);
  const catalan = lineasDeLaFicha(opcion, 'ca');
  return crear(
    'details',
    { className: 'rc-ficha-curso' },
    escribir(crear('summary'), t('dos.detalles')),
    ...lineasDeLaFicha(opcion, 'es').map((linea, indice) =>
      escribir(crear('p'), conVersiones({ es: linea, ca: catalan[indice] ?? linea })),
    ),
    ...condicionesDeOpcion(opcion),
    ...(objetivos ? [objetivos] : []),
  );
}
/** Fila compacta: título, quién lo imparte, horas, modalidad e idioma; el resto, en «Ver detalles».
 * @param {import('../../../src/seleccion-formacion/contrato.ts').OpcionPlan} opcion
 * @param {{bloque:'ia'|'digital',numero:number}} contexto @param {number} indice @param {(programa:string)=>void} alExcluir */
function filaCurso(opcion, { bloque, numero }, indice, alExcluir) {
  const id = `curso-${numero}-${bloque}-${indice}`;
  const elegir = crear('input', {
    type: 'radio',
    name: `curso-${numero}-${bloque}`,
    id,
    value: opcion.oferta.unidad.id,
  });
  const titulo = crear('label', { htmlFor: id }, tituloDelCurso(opcion));
  const resumen = escribir(
    crear('p', { className: 'rc-curso-resumen' }),
    enLosDosIdiomas((idioma) => resumenDeOferta(opcion, idioma)),
  );
  const enlace = escribir(
    crear('a', { href: opcion.oferta.url, target: '_blank', rel: 'noopener noreferrer' }),
    t('calendario.ficha'),
  );
  const motivo = escribir(crear('p'), conVersiones(opcion.motivo));
  const nivel = escribir(
    crear('p', { className: 'rc-curso-nivel' }),
    enLosDosIdiomas((idioma) => `${idioma === 'es' ? 'Nivel' : 'Nivell'}: ${nivelDeOpcion(opcion, idioma)}`),
  );
  const excluir = con('button', 'quitar-programa', 'rc-boton-secundario');
  excluir.type = 'button';
  excluir.addEventListener('click', () => alExcluir(opcion.oferta.unidad.programa_id));
  return crear(
    'li',
    { className: 'rc-hoja-curso rc-formacion-curso' },
    elegir,
    titulo,
    resumen,
    nivel,
    motivo,
    enlace,
    detallesDelCurso(opcion),
    excluir,
  );
}
/** Sin marcar nada por defecto; elegir «ninguno» deshace una elección de este grupo.
 * @param {'ia'|'digital'} bloque @param {number} numero */
function filaNinguno(bloque, numero) {
  const id = `curso-${numero}-${bloque}-ninguno`;
  return crear(
    'p',
    { className: 'rc-hoja-ninguno' },
    crear('input', { type: 'radio', name: `curso-${numero}-${bloque}`, id, value: '' }),
    escribir(crear('label', { htmlFor: id }), t('dos.ninguno')),
  );
}
/** @param {SeleccionFormacion} seleccion @param {'ia'|'digital'} bloque @param {number} numero @param {(programa:string) => void} alExcluir */
function grupo(seleccion, bloque, numero, alExcluir) {
  const opciones = seleccion.opciones[bloque];
  const campo = crear('fieldset', { className: 'rc-hoja-grupo' }, con('legend', `dos.${bloque}`));
  if (opciones.length === 0) {
    campo.append(con('p', 'dos.sin-oferta'));
    return campo;
  }
  const lista = crear('ul', { className: 'rc-hoja-cursos' });
  /** @type {HTMLElement[]} */
  const filas = [];
  opciones.forEach((opcion, indice) => {
    const fila = filaCurso(opcion, { bloque, numero }, indice, alExcluir);
    filas.push(fila);
    lista.append(fila);
  });
  campo.append(lista);
  const paginas = paginarCursos(filas);
  if (paginas) {
    campo.append(paginas);
  }
  campo.append(filaNinguno(bloque, numero));
  return campo;
}
/** @param {()=>{ia:string|null,digital:string|null}} elegidas
 * @param {((ia:string,digital:string)=>HTMLElement)|undefined} avisoHorarios */
function avisosDeHorario(elegidas, avisoHorarios) {
  const zonaHorarios = crear('div', { className: 'rc-hoja-horarios' });
  let horarioAnterior = /** @type {HTMLElement | null} */ (null);
  const actualizarHorarios = () => {
    horarioAnterior?.remove();
    horarioAnterior = null;
    const { ia, digital } = elegidas();
    if (ia && digital && ia !== digital && avisoHorarios) {
      horarioAnterior = avisoHorarios(ia, digital);
      zonaHorarios.append(horarioAnterior);
    }
  };
  return { zonaHorarios, actualizarHorarios };
}
/** Recursos abiertos cuando ningún grupo tiene ofertas que encajen. */
function mientrasTantoEnPantalla() {
  return bloqueMientrasTanto((elemento, clave) => escribir(elemento, traducible(clave)), {
    conAcreditacion: false,
    clase: 'rc-hoja-mientras',
  });
}
/** Elecciones explícitas, basadas en las ofertas revisadas; ninguna se marca por defecto. Se puede guardar con dos
 * cursos, con uno o con ninguno: un grupo sin ofertas no bloquea la hoja.
 * @param {SeleccionFormacion} seleccion
 * @param {{ alConfirmar: (ia:string|null, digital:string|null) => void, alRevisar: () => void, alExcluir: (programa:string) => void, avisoHorarios?: (ia:string, digital:string) => HTMLElement }} acciones */
export function crearPropuesta(seleccion, acciones) {
  const propuesta = crear(
    'section',
    { className: 'rc-hoja' },
    con('h3', 'dos.titulo', 'rc-hoja-titulo'),
    con('p', 'dos.ayuda'),
  );
  const numero = ++siguientePropuesta;
  // Dice qué se guardará antes de pulsar; el botón lo anuncia como su descripción.
  const queSeGuarda = crear('p', { role: 'status', id: `hoja-${numero}-que-se-guarda` });
  const confirmar = con('button', 'confirmar', 'rc-boton-principal');
  confirmar.type = 'button';
  confirmar.setAttribute('aria-describedby', queSeGuarda.id);
  const elegidas = () => {
    const entradas = [...propuesta.querySelectorAll('input')].filter((x) => x.checked);
    const ia = entradas.find((x) => x.name === `curso-${numero}-ia`)?.value || null;
    const digital = entradas.find((x) => x.name === `curso-${numero}-digital`)?.value || null;
    return { ia, digital };
  };
  const contarElegidas = () => {
    const { ia, digital } = elegidas();
    escribir(queSeGuarda, t(`dos.guardara.${[ia, digital].filter(Boolean).length}`));
  };
  confirmar.addEventListener('click', () => {
    const { ia, digital } = elegidas();
    acciones.alConfirmar(ia, digital);
  });
  const revisar = con('button', 'revisar', 'rc-boton-secundario');
  revisar.type = 'button';
  revisar.addEventListener('click', acciones.alRevisar);
  const { zonaHorarios, actualizarHorarios } = avisosDeHorario(elegidas, acciones.avisoHorarios);
  const sinOfertas = seleccion.opciones.ia.length === 0 && seleccion.opciones.digital.length === 0;
  propuesta.append(
    grupo(seleccion, 'ia', numero, acciones.alExcluir),
    grupo(seleccion, 'digital', numero, acciones.alExcluir),
    ...(sinOfertas ? [mientrasTantoEnPantalla()] : [con('p', 'dos.condiciones')]),
    zonaHorarios,
    crear('div', { className: 'rc-hoja-pie' }, queSeGuarda, confirmar, revisar),
  );
  contarElegidas();
  for (const entrada of propuesta.querySelectorAll('input')) {
    entrada.addEventListener('change', () => {
      actualizarHorarios();
      contarElegidas();
    });
  }
  return propuesta;
}
/** @param {HTMLElement} propuesta */
export function cerrarPropuesta(propuesta) {
  for (const boton of propuesta.querySelectorAll('button')) {
    boton.disabled = true;
  }
  for (const entrada of propuesta.querySelectorAll('input')) {
    entrada.disabled = true;
  }
  propuesta.classList.add('rc-hoja-cerrada');
}
