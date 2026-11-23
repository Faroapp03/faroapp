/** Formación acreditada en el recorrido: preferencias explícitas y selector del dispositivo, sin API remota. */
import { crear } from '../dom.js';
import { escribir } from '../idioma.js';
import { idiomaActual, traducible } from '../textos.js';
import { decirFaro, decirPersona, llevarALaVista, ofrecerSugerencias } from './conversacion.js';
import { estado } from './estado.js';
import { camposAgenda, inicioDeAgendaVigente, leerAgenda, vistaAgenda } from './formacion/agenda.js';
import { seleccionarEnElDispositivo } from './formacion/cliente.js';
import { textoDeRequisito } from './formacion/condiciones.js';
import { confirmarSeleccion } from './formacion/confirmar-plan.js';
import { formarPlan } from './formacion/crear-plan.js';
import { contarFalloDeFormacion } from './formacion/fallo.js';
import { esEtapa, esModalidad, valorDelRegistro } from './formacion/preferencias-plan.js';
import { rotuloDeIdioma } from './plan-formacion/ficha-oferta.js';
import { avisoParaEleccion } from './plan-formacion/vista-horarios.js';
import { cerrarPropuesta, crearPropuesta } from './propuesta-hoja.js';

/** @import { Parte } from '../textos.js' */
/** @import { Etapa, PreferenciasSeleccion, SeleccionFormacion } from '../../../src/seleccion-formacion/contrato.ts' */
const ETAPAS = ['inicial', 'intermedio', 'avanzado'];
/** @param {string} clave */
const t = (clave) => traducible(`formacion.${clave}`);
/** @type {AbortController} */
let vida = new AbortController();
/** @type {HTMLFormElement | null} */
let formulario = null;
/** @type {HTMLElement | null} */
let propuesta = null;
/** @type {SeleccionFormacion | null} */
let seleccion = null;
/** @type {PreferenciasSeleccion} */
let preferencias = iniciales();
let tarea = '';
/** @type {{dias: number[], minutosPorDia: number, inicio: string} | null} */
let disponibilidad = null;
/** @type {Etapa | null} */
let nivelDigital = null;
let numeroFormulario = 0;
let esperando = false;
/** @type {(cursos: number | null) => void} */
let alAcabar = () => {};
/** @type {(signal:AbortSignal)=>Promise<import('./plan-formacion/contrato.js').AcreditacionPlan[]>} */
let obtenerAcreditaciones = async () => [];
/** @returns {PreferenciasSeleccion} */
function iniciales() {
  return {
    etapa: 'inicial',
    idiomas: [idiomaActual()],
    modalidad: 'cualquiera',
    aceptaRegistro: null,
    requisitosConfirmados: [],
    excluidos: [],
  };
}
/** @param {string} clave @param {readonly { valor: string, clave: string }[]} opciones @param {string} valor */
function campo(clave, opciones, valor) {
  const id = `formacion-${numeroFormulario}-${clave}`;
  const select = crear('select', { id });
  select.append(...opciones.map((o) => escribir(crear('option', { value: o.valor }), t(o.clave))));
  select.value = valor;
  const grupo = crear(
    'div',
    { className: 'rc-hoja-grupo' },
    escribir(crear('label', { htmlFor: id }), t(clave)),
    select,
  );
  return { grupo, select };
}
/** @param {string} id @param {Parte} texto @param {boolean} marcada */
function casilla(id, texto, marcada) {
  const input = crear('input', { type: 'checkbox', id, checked: marcada });
  const label = escribir(crear('label', { htmlFor: id }), texto);
  return { input, fila: crear('li', { className: 'rc-hoja-opcion' }, input, label) };
}
/** @param {string} clave */
const parrafo = (clave) => escribir(crear('p'), t(clave));
function elegirRegistro() {
  return campo(
    'registro',
    [
      { valor: '', clave: 'registro.duda' },
      { valor: 'si', clave: 'registro.si' },
      { valor: 'no', clave: 'registro.no' },
    ],
    valorDelRegistro(preferencias),
  );
}
function elegirIdiomas() {
  const idiomas = ['es', 'ca', 'en'].map((valor) => ({
    valor,
    ...casilla(
      `idioma-${numeroFormulario}-${valor}`,
      rotuloDeIdioma(valor, idiomaActual()),
      preferencias.idiomas.includes(valor),
    ),
  }));
  return idiomas;
}
/** El motor solo deja pendientes las condiciones revisadas y lo que no tiene revisión vigente: lo informativo no llega. */
function elegirRequisitos() {
  const requisitos = (seleccion?.requisitosPendientes ?? []).map((r, indice) => ({
    id: r.id,
    ...casilla(
      `requisito-${numeroFormulario}-${indice}`,
      textoDeRequisito(r),
      preferencias.requisitosConfirmados.includes(r.id),
    ),
  }));
  return requisitos;
}
function elegirTarea() {
  const tareas = crear('select', { id: `tarea-${numeroFormulario}` });
  tareas.append(
    escribir(crear('option', { value: '' }), t('tarea.generica')),
    ...estado.tareas
      .filter((x) => x.tiempo !== null)
      .map((x) => crear('option', { value: String(x.id), textContent: x.texto })),
  );
  tareas.value = tarea;
  const elegirTarea = crear(
    'div',
    { className: 'rc-hoja-grupo' },
    escribir(crear('label', { htmlFor: tareas.id }), t('tarea')),
    tareas,
  );
  return { grupo: elegirTarea, select: tareas };
}
/** @param {ReturnType<typeof recogerCampos>} campos */
function crearFormulario(campos) {
  const { etapa, digital, objetivo, tareas, idiomas, modalidad, registro, requisitos, agenda } = campos;
  const enviar = escribir(crear('button', { type: 'submit', className: 'rc-boton-principal' }), t('preparar'));
  const aviso = crear('p', { role: 'status' });
  const form = crear(
    'form',
    { className: 'rc-hoja-pregunta' },
    etapa.grupo,
    objetivo,
    digital.grupo,
    tareas.grupo,
    crear(
      'fieldset',
      { className: 'rc-hoja-grupo' },
      escribir(crear('legend'), t('idiomas')),
      crear('ul', { className: 'rc-hoja-opciones' }, ...idiomas.map((i) => i.fila)),
    ),
    modalidad.grupo,
    registro.grupo,
    parrafo('registro.aviso'),
    ...vistaAgenda(agenda),
  );
  if (requisitos.length > 0) {
    form.append(
      crear(
        'fieldset',
        { className: 'rc-hoja-grupo' },
        escribir(crear('legend'), t('requisitos')),
        parrafo('requisitos.ayuda'),
        crear('ul', { className: 'rc-hoja-opciones' }, ...requisitos.map((r) => r.fila)),
      ),
    );
  }
  form.append(aviso, enviar);
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    enviarPreferencias(campos, aviso, enviar);
  });
  return form;
}
function recogerCampos() {
  const etapa = campo(
    'etapa',
    [{ valor: '', clave: 'agenda.elige-nivel' }, ...ETAPAS.map((valor) => ({ valor, clave: valor }))],
    disponibilidad ? preferencias.etapa : '',
  );
  const digital = campo(
    'agenda.nivel-digital',
    [{ valor: '', clave: 'agenda.elige-nivel' }, ...ETAPAS.map((valor) => ({ valor, clave: valor }))],
    nivelDigital ?? '',
  );
  const objetivo = parrafo(disponibilidad ? `objetivo.${preferencias.etapa}` : 'agenda.nivel-ayuda');
  etapa.select.addEventListener('change', () =>
    escribir(objetivo, t(etapa.select.value ? `objetivo.${etapa.select.value}` : 'agenda.nivel-ayuda')),
  );
  const modalidad = campo(
    'modalidad',
    ['cualquiera', 'en-linea', 'presencial'].map((valor) => ({ valor, clave: valor })),
    preferencias.modalidad,
  );
  return {
    etapa,
    digital,
    objetivo,
    modalidad,
    registro: elegirRegistro(),
    idiomas: elegirIdiomas(),
    requisitos: elegirRequisitos(),
    tareas: elegirTarea(),
    agenda: camposAgenda(numeroFormulario, disponibilidad),
  };
}
/** @param {ReturnType<typeof recogerCampos>} campos @param {HTMLElement} aviso @param {HTMLButtonElement} enviar */
function enviarPreferencias(campos, aviso, enviar) {
  const { idiomas, etapa, digital, modalidad, registro, requisitos, tareas, agenda } = campos;
  if (esperando) {
    return;
  }
  const lenguas = idiomas.filter((i) => i.input.checked).map((i) => i.valor);
  if (lenguas.length === 0) {
    escribir(aviso, t('idioma.falta'));
    idiomas[0]?.input.focus();
    return;
  }
  if (
    !esEtapa(etapa.select.value) ||
    !esEtapa(digital.select.value) ||
    !esModalidad(modalidad.select.value) ||
    !['', 'si', 'no'].includes(registro.select.value)
  ) {
    escribir(aviso, t('agenda.falta-preferencias'));
    return;
  }
  nivelDigital = digital.select.value;
  const agendaNueva = leerAgenda(agenda);
  if (!agendaNueva) {
    escribir(aviso, t('agenda.falta'));
    return;
  }
  if (!inicioDeAgendaVigente(agendaNueva, new Date().toISOString())) {
    escribir(aviso, t('agenda.fecha-pasada'));
    return;
  }
  disponibilidad = agendaNueva;
  preferencias = {
    etapa: etapa.select.value,
    idiomas: lenguas,
    modalidad: modalidad.select.value,
    aceptaRegistro: registro.select.value === '' ? null : registro.select.value === 'si',
    requisitosConfirmados: requisitos.filter((r) => r.input.checked).map((r) => r.id),
    excluidos: preferencias.excluidos,
  };
  tarea = tareas.select.value;
  void pedir(enviar, aviso);
}
function preferenciasEnPantalla() {
  numeroFormulario++;
  return crearFormulario(recogerCampos());
}
function revisar() {
  if (propuesta) {
    cerrarPropuesta(propuesta);
  }
  propuesta = null;
  formulario?.remove();
  formulario = preferenciasEnPantalla();
  const mensaje = decirFaro(formulario);
  llevarALaVista(mensaje, 'start');
}
/** @param {SeleccionFormacion} respuesta */
function mostrar(respuesta) {
  seleccion = respuesta;
  formulario?.remove();
  formulario = null;
  if (propuesta) {
    cerrarPropuesta(propuesta);
  }
  propuesta = crearPropuesta(respuesta, {
    alConfirmar: (ia, digital) => void confirmar(ia, digital),
    avisoHorarios: avisoParaEleccion(respuesta, (ia, digital) => planDe(respuesta, ia, digital)),
    alRevisar: revisar,
    alExcluir: (programa) => {
      preferencias = { ...preferencias, excluidos: [...new Set([...preferencias.excluidos, programa])] };
      void pedir();
    },
  });
  const mensaje = decirFaro(propuesta);
  llevarALaVista(mensaje, 'start');
  ofrecerSugerencias([{ texto: t('solo-informe'), accion: () => alAcabar(null) }]);
}
/** @param {unknown} error @param {HTMLElement | null} aviso */
function informarFalloDePreparacion(error, aviso) {
  console.warn('Faro: no se ha podido preparar la formación local.', error);
  contarFalloDeFormacion(error, aviso);
  ofrecerSugerencias([
    { texto: t('revisar'), accion: revisar },
    { texto: t('solo-informe'), accion: () => alAcabar(null) },
  ]);
}
/** @param {HTMLButtonElement | null} [boton] @param {HTMLElement | null} [aviso] */
async function pedir(boton = null, aviso = null) {
  if (esperando) {
    return;
  }
  esperando = true;
  const signal = vida.signal;
  if (boton) {
    boton.disabled = true;
  }
  if (propuesta) {
    cerrarPropuesta(propuesta);
  }
  if (aviso) {
    escribir(aviso, t('preparando'));
  }
  try {
    const respuesta = await seleccionarEnElDispositivo(preferencias, signal);
    if (!signal.aborted) {
      mostrar(respuesta);
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    informarFalloDePreparacion(error, aviso);
  } finally {
    if (signal === vida.signal) {
      esperando = false;
    }
    if (boton) {
      boton.disabled = false;
    }
  }
}
/** @param {SeleccionFormacion} actual @param {import('../../../src/seleccion-formacion/contrato.ts').OpcionPlan|null} ia @param {import('../../../src/seleccion-formacion/contrato.ts').OpcionPlan|null} digital */
function planDe(actual, ia, digital) {
  return formarPlan({ actual, ia, digital, preferencias, nivelDigital, disponibilidad, tarea });
}
/** Guarda las ofertas confirmadas (cero, una o dos) con sus preferencias y objetivo.
 * @param {SeleccionFormacion} actual
 * @param {import('../../../src/seleccion-formacion/contrato.ts').OpcionPlan|null} ia
 * @param {import('../../../src/seleccion-formacion/contrato.ts').OpcionPlan|null} digital
 * @param {import('./plan-formacion/contrato.js').AcreditacionPlan | null} acreditacion */
function guardarPlan(actual, ia, digital, acreditacion) {
  const plan = planDe(actual, ia, digital);
  plan.acreditacion = acreditacion;
  estado.hojaDeRuta = {
    seleccion: actual,
    plan,
    preferencias,
    objetivo: plan.objetivo,
    idioma: idiomaActual(),
    fecha: actual.calculado_el,
  };
  if (propuesta) {
    cerrarPropuesta(propuesta);
  }
  decirPersona(t('confirmar'));
  decirFaro(t('confirmada'));
  alAcabar(plan.elecciones.length);
}
/** La confirmación vuelve a comprobar el reloj; no conserva una oferta que alcanzó su límite publicado mientras la persona leía. */
/** @param {string|null} idIA @param {string|null} idDigital */
async function confirmar(idIA, idDigital) {
  if (!seleccion || !disponibilidad || esperando) {
    return;
  }
  esperando = true;
  const signal = vida.signal;
  try {
    const vista = propuesta;
    const ocupacion = estado.ocupacion;
    const idioma = idiomaActual();
    const resultado = await confirmarSeleccion({
      inicial: seleccion,
      preferencias,
      disponibilidad,
      ia: idIA,
      digital: idDigital,
      idioma,
      signal,
      vigente: () =>
        !signal.aborted && propuesta === vista && estado.ocupacion === ocupacion && idiomaActual() === idioma,
      obtener: obtenerAcreditaciones,
      cerrar: () => {
        if (vista) {
          cerrarPropuesta(vista);
        }
      },
      fechaPasada: () => {
        decirFaro(t('agenda.fecha-pasada'), { tipo: 'error' });
        revisar();
      },
      actualizada: (actual) => {
        decirFaro(t('actualizada'));
        mostrar(actual);
      },
    });
    if (resultado) {
      guardarPlan(resultado.final, resultado.elecciones.ia, resultado.elecciones.digital, resultado.acreditacion);
    }
  } catch (error) {
    if (!signal.aborted) {
      console.warn('Faro: no se ha podido confirmar la formación local.', error);
      contarFalloDeFormacion(error, null);
    }
  } finally {
    if (signal === vida.signal) {
      esperando = false;
    }
  }
}
/** @param {{ dicho: Parte, alAcabar: (cursos: number | null) => void, obtenerAcreditaciones?: (signal:AbortSignal)=>Promise<import('./plan-formacion/contrato.js').AcreditacionPlan[]> }} opciones */
export function empezarHojaDeRuta({ dicho, alAcabar: terminar, obtenerAcreditaciones: obtener = async () => [] }) {
  olvidarHojaDeRuta();
  alAcabar = terminar;
  obtenerAcreditaciones = obtener;
  decirPersona(dicho);
  decirFaro(t('introduccion'));
  revisar();
}
export function olvidarHojaDeRuta() {
  vida.abort();
  vida = new AbortController();
  esperando = false;
  formulario?.remove();
  formulario = null;
  if (propuesta) {
    cerrarPropuesta(propuesta);
  }
  propuesta = null;
  seleccion = null;
  preferencias = iniciales();
  tarea = '';
  disponibilidad = null;
  nivelDigital = null;
  estado.hojaDeRuta = null;
}
