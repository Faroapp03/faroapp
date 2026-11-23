/** Captura la disponibilidad declarada; una ausencia nunca se rellena con una agenda supuesta. */
import { crear } from '../../dom.js';
import { escribir } from '../../idioma.js';
import { texto, traducible } from '../../textos.js';
import { inicioNoAnterior } from '../plan-formacion/disponibilidad-agenda.js';
import { crearCalendario } from './calendario-selector.js';

const DIAS_SEMANA = 7;
const DIAS = Array.from({ length: DIAS_SEMANA }, (_, i) => i + 1);
const MINIMO = 15;
const MAXIMO = 720;
const FECHA = /^\d{4}-\d{2}-\d{2}$/u;
const FECHA_LARGO = 10;
const t = (/** @type {string} */ clave) => traducible(`formacion.agenda.${clave}`);
/** @param {number} numero @param {{dias:number[],minutosPorDia:number,inicio:string}|null} anterior */
export function camposAgenda(numero, anterior) {
  const dias = DIAS.map((valor) => {
    const id = `dia-${numero}-${valor}`;
    const input = crear('input', { type: 'checkbox', id, checked: anterior?.dias.includes(valor) ?? false });
    const label = crear('label', { htmlFor: id, textContent: texto(`formacion.agenda.dia.${valor}`) });
    return { valor, input, fila: crear('li', { className: 'rc-hoja-opcion' }, input, label) };
  });
  const minutos = crear('input', {
    id: `minutos-${numero}`,
    type: 'number',
    min: String(MINIMO),
    max: String(MAXIMO),
    step: String(MINIMO),
    value: anterior ? String(anterior.minutosPorDia) : '',
  });
  const inicio = crear('input', { id: `inicio-${numero}`, type: 'date', value: anterior?.inicio ?? '' });
  return { dias, minutos, inicio };
}
/** @param {ReturnType<typeof camposAgenda>} campos */
export function vistaAgenda({ dias, minutos, inicio }) {
  const campo = (/** @type {HTMLInputElement} */ input, /** @type {string} */ clave) =>
    crear('div', { className: 'rc-hoja-grupo' }, escribir(crear('label', { htmlFor: input.id }), t(clave)), input);
  const fecha = campo(inicio, 'inicio');
  const desplegable = crear('details', { className: 'rc-calendario-desplegable' });
  const titulo = escribir(crear('summary'), t('inicio'));
  desplegable.append(titulo);
  let creado = false;
  desplegable.addEventListener('toggle', () => {
    if (!desplegable.open || creado) {
      return;
    }
    const vida = new AbortController();
    const calendario = crearCalendario(inicio, { signal: vida.signal, vigente: () => !inicio.disabled });
    desplegable.append(calendario.elemento);
    creado = true;
  });
  fecha.append(desplegable);
  return [
    crear(
      'fieldset',
      { className: 'rc-hoja-grupo' },
      escribir(crear('legend'), t('dias')),
      crear('ul', { className: 'rc-hoja-opciones' }, ...dias.map((d) => d.fila)),
    ),
    campo(minutos, 'minutos'),
    fecha,
  ];
}
/** @param {ReturnType<typeof camposAgenda>} campos */
export function leerAgenda({ dias, minutos, inicio }) {
  const elegidos = dias.filter((d) => d.input.checked).map((d) => d.valor);
  const cantidad = Number(minutos.value);
  const fecha = inicio.value;
  const fechaUtc = FECHA.test(fecha) ? Date.parse(`${fecha}T00:00:00Z`) : NaN;
  if (
    !elegidos.length ||
    !Number.isInteger(cantidad) ||
    cantidad < MINIMO ||
    cantidad > MAXIMO ||
    cantidad % MINIMO !== 0 ||
    !Number.isFinite(fechaUtc) ||
    new Date(fechaUtc).toISOString().slice(0, FECHA_LARGO) !== fecha
  ) {
    return null;
  }
  return { dias: elegidos, minutosPorDia: cantidad, inicio: fecha };
}

/** Comprueba la fecha civil en la misma zona que el cronograma.
 * @param {{inicio:string}} agenda @param {string} confirmadoEl */
export function inicioDeAgendaVigente(agenda, confirmadoEl) {
  return inicioNoAnterior(agenda.inicio, confirmadoEl);
}
