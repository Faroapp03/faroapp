// Antes de guardar, la persona lee qué cambia y qué notarán las personas usuarias; así un clic no corta el servicio
// sin querer. Solo describe la diferencia entre lo confirmado y lo marcado: no decide ni guarda nada.
import { texto } from '../scripts/textos.js';

/** @typedef {import('../scripts/secciones-contrato.js').PoliticaSecciones} PoliticaSecciones */
/** @typedef {import('../../src/administracion/controles.ts').PoliticaControles} PoliticaControles */

/** @param {string[]} lineas */
function pregunta(lineas) {
  return [texto('panel.confirmar.intro'), ...lineas.map((l) => `• ${l}`), texto('panel.confirmar.pregunta')].join('\n');
}

/** Sin cambios no hay nada que confirmar; con cambios, guarda solo si la persona acepta el resumen.
 * @param {string|null} resumen */
export function confirmarCambio(resumen) {
  return resumen === null || window.confirm(resumen);
}
/** Clave del nombre visible de cada sección con interruptor, la misma que usa su etiqueta en index.html; tres de
 * ellas no coinciden con el id de la política. */
const CLAVE_DE_SECCION = Object.freeze({
  'entender-ia': 'panel.seccion.ia',
  'que-es-faro': 'panel.seccion.faro',
  recorrido: 'panel.seccion.recorrido',
  cursos: 'panel.seccion.cursos',
  biblioteca: 'panel.seccion.biblioteca',
  'datos-globales': 'panel.seccion.globales',
  doctor: 'panel.seccion.doctor',
  encuesta: 'panel.seccion.encuesta',
});
/** Las secciones cuyo cierre tiene un efecto propio que la persona debe leer antes de confirmar. */
const EFECTO_DE_SECCION = Object.freeze({
  recorrido: 'panel.confirmar.recorrido',
  encuesta: 'panel.confirmar.encuesta',
});
/** @param {string} id */
export function nombreDeSeccion(id) {
  const clave = /** @type {Record<string,string>} */ (CLAVE_DE_SECCION)[id];
  return clave ? texto(clave) : id;
}
/** Cerrar Empezar tiene un efecto propio (nadie puede iniciar el recorrido), y ocultar la Encuesta, otro (las
 * invitaciones se conservan). @param {string} id @param {boolean} abierta */
function lineaDeSeccion(id, abierta) {
  const sentido = abierta ? 'abrir' : 'cerrar';
  const clave = /** @type {Record<string,string>} */ (EFECTO_DE_SECCION)[id];
  const efecto = clave ? ` ${texto(`${clave}.${sentido}`)}` : '';
  return texto(`panel.confirmar.seccion.${sentido}`, { nombre: nombreDeSeccion(id), efecto });
}
/** Resumen de las secciones que se abren o cierran, o `null` si no cambia ninguna.
 * @param {Readonly<Record<string,boolean>>} confirmadas @param {Readonly<Record<string,boolean>>} elegidas */
export function resumenCambioSecciones(confirmadas, elegidas) {
  const lineas = Object.entries(elegidas)
    .filter(([id, abierta]) => confirmadas[id] !== abierta)
    .map(([id, abierta]) => lineaDeSeccion(id, abierta));
  if (!lineas.length) {
    return null;
  }
  return pregunta([...lineas, texto('panel.confirmar.sin-conexion')]);
}

/** Resumen de las conexiones que se encienden o apagan, o `null` si no cambia ninguna o no hay controles confirmados.
 * @param {import('./cliente.js').EstadoClientePanel|null} estado @param {PoliticaControles} elegidos */
export function resumenCambioControles(estado, elegidos) {
  if (estado?.estado !== 'activa') {
    return null;
  }
  const confirmados = estado.controles;
  const lineas = [];
  if (confirmados.api !== elegidos.api) {
    lineas.push(texto(elegidos.api === 'habilitada' ? 'panel.confirmar.api.encender' : 'panel.confirmar.api.apagar'));
  }
  for (const id of /** @type {const} */ (['mcp', 'a2a'])) {
    if (confirmados[id] !== elegidos[id]) {
      lineas.push(texto(`panel.confirmar.${id}.${elegidos[id] ? 'encender' : 'apagar'}`));
    }
  }
  if (!lineas.length) {
    return null;
  }
  return pregunta([...lineas, texto('panel.confirmar.web-sigue')]);
}
