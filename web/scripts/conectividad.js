import './sitio.js';
import { crearConsultaConectividad } from './conectividad/estado.js';
import { porId } from './dom.js';
import { aLaHora, partesLocales } from './fechas.js';
import { alCambiarIdioma } from './idioma.js';
import { idiomaActual, texto } from './textos.js';

/** @typedef {import('./conectividad/estado.js').EstadoConsulta} EstadoConsulta */
const estado = porId('conectividad-estado');
const fecha = porId('conectividad-fecha', HTMLTimeElement);
const repetir = porId('conectividad-repetir', HTMLButtonElement);
const servicios = ['mcp', 'api', 'a2a'];
/** @type {EstadoConsulta} */
let ultimo = { estado: 'consultando' };

/** @param {EstadoConsulta} consulta */
function pintarServicios(consulta) {
  for (const servicio of servicios) {
    const fila = porId(`conectividad-${servicio}`);
    const luz = fila.querySelector('.conectividad-luz');
    const rotulo = fila.querySelector('.conectividad-valor');
    if (!(luz instanceof HTMLElement) || !(rotulo instanceof HTMLElement)) {
      throw new Error('Fila de conectividad incompleta');
    }
    luz.hidden = consulta.estado !== 'confirmado';
    if (consulta.estado === 'confirmado') {
      const activo = consulta.lectura.servicios[/** @type {'mcp'|'api'|'a2a'} */ (servicio)];
      luz.classList.toggle('conectividad-activa', activo);
      luz.classList.toggle('conectividad-inactiva', !activo);
      rotulo.textContent = texto(activo ? 'conectividad.activo' : 'conectividad.inactivo');
    } else {
      luz.classList.remove('conectividad-activa', 'conectividad-inactiva');
      rotulo.textContent = texto('conectividad.sin-comprobar');
    }
  }
}
/** @param {EstadoConsulta} consulta */
function pintar(consulta) {
  ultimo = consulta;
  repetir.disabled = consulta.estado === 'consultando';
  estado.textContent = texto(`conectividad.estado.${consulta.estado}`);
  fecha.hidden = consulta.estado !== 'confirmado';
  pintarServicios(consulta);
  if (consulta.estado === 'confirmado') {
    const cuando = new Date(consulta.lectura.comprobadoEn);
    fecha.dateTime = consulta.lectura.comprobadoEn;
    fecha.textContent = texto('conectividad.comprobado', {
      hora: aLaHora(partesLocales(cuando), idiomaActual() === 'ca' ? 'ca' : 'es'),
    });
  } else {
    fecha.removeAttribute('datetime');
    fecha.textContent = '';
  }
}
let consulta = crearConsultaConectividad({ alCambiar: pintar });
repetir.addEventListener('click', () => {
  void consulta.comprobar();
});
alCambiarIdioma(() => pintar(ultimo));
window.addEventListener('pagehide', () => {
  consulta.retirar();
  pintar({ estado: 'consultando' });
});
window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) {
    consulta = crearConsultaConectividad({ alCambiar: pintar });
    void consulta.comprobar();
  }
});
void consulta.comprobar();
