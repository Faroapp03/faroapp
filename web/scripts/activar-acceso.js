import { retirarFragmento, tomarInvitacion } from './conectividad/fragmento.js';
import './sitio.js';
import { crearActivacion } from './conectividad/invitacion.js';
import { porId } from './dom.js';
import { conArticulo, fechaLargaConHora, partesLocales } from './fechas.js';
import { alCambiarIdioma } from './idioma.js';
import { idiomaActual, texto } from './textos.js';

/** @typedef {import('./conectividad/invitacion.js').EstadoActivacion} EstadoActivacion */
const encabezado = porId('activacion-encabezado');
const aviso = porId('activacion-estado');
const fecha = porId('activacion-fecha', HTMLTimeElement);
const generar = porId('activacion-generar', HTMLButtonElement);
const repetir = porId('activacion-repetir', HTMLButtonElement);
const bloque = porId('activacion-credenciales');
const cliente = porId('activacion-cliente', HTMLInputElement);
const secreto = porId('activacion-secreto', HTMLInputElement);
const copiar = porId('activacion-copiar', HTMLButtonElement);
/** @type {EstadoActivacion} */
let ultimo = { estado: 'consultando' };
let nombre = '';

/** «el 25 de noviembre de 2026 a las 10:00», con la hora del dispositivo y el artículo que pide el día.
 * @param {string} caducaEn */
function caducidad(caducaEn) {
  const idioma = idiomaActual() === 'ca' ? 'ca' : 'es';
  const partes = partesLocales(caducaEn);
  return conArticulo(fechaLargaConHora(partes, idioma), partes.dia, idioma, 'el');
}
/** @param {EstadoActivacion} estado */
function pintar(estado) {
  ultimo = estado;
  if (estado.estado === 'preparada') {
    nombre = estado.lectura.institucion.nombre;
  }
  if (estado.estado === 'retirada') {
    nombre = '';
  }
  encabezado.textContent = nombre ? texto('activacion.encabezado-nombre', { nombre }) : texto('activacion.encabezado');
  const clave = estado.estado === 'error' ? estado.motivo : estado.estado;
  aviso.textContent = texto(`activacion.estado.${clave}`);
  generar.hidden = !['preparada', 'generando'].includes(estado.estado);
  generar.disabled = estado.estado !== 'preparada';
  repetir.hidden = estado.estado !== 'error' || !estado.reintentar;
  fecha.hidden = estado.estado !== 'preparada';
  if (estado.estado === 'preparada') {
    fecha.dateTime = estado.lectura.caducaEn;
    fecha.textContent = texto('activacion.caduca', {
      fecha: caducidad(estado.lectura.caducaEn),
    });
  } else {
    fecha.removeAttribute('datetime');
    fecha.textContent = '';
  }
  bloque.hidden = estado.estado !== 'clave';
  copiar.disabled = estado.estado !== 'clave';
  cliente.value = estado.estado === 'clave' ? estado.clave.client_id : '';
  secreto.value = estado.estado === 'clave' ? estado.clave.client_secret : '';
}
let activacion = crearActivacion({ invitacion: tomarInvitacion(), alCambiar: pintar });
generar.addEventListener('click', () => {
  void activacion.activar();
});
repetir.addEventListener('click', () => {
  void activacion.consultar();
});
copiar.addEventListener('click', async () => {
  const vigente = ultimo;
  if (vigente.estado !== 'clave') {
    return;
  }
  if (!navigator.clipboard?.writeText) {
    secreto.focus();
    secreto.select();
    aviso.textContent = texto('activacion.copia-manual');
    return;
  }
  try {
    await navigator.clipboard.writeText(
      JSON.stringify({ client_id: vigente.clave.client_id, client_secret: vigente.clave.client_secret }),
    );
    if (ultimo === vigente) {
      aviso.textContent = texto('activacion.copiado');
    }
  } catch (error) {
    if (ultimo === vigente) {
      secreto.focus();
      secreto.select();
      aviso.textContent = texto('activacion.copia-manual');
    }
    if (!(error instanceof DOMException)) {
      throw error;
    }
  }
});
alCambiarIdioma(() => pintar(ultimo));
window.addEventListener('pagehide', () => activacion.retirar());
window.addEventListener('hashchange', () => {
  const invitacion = retirarFragmento();
  activacion.retirar();
  activacion = crearActivacion({ invitacion, alCambiar: pintar });
  void activacion.consultar();
});
void activacion.consultar();
