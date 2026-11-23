// Web Worker de módulo anidado en el motor local. El service worker sirve su código comprobado; recibe los datos
// una vez desde la puerta y atiende consultas factuales sin descargar recursos señalados por los argumentos.

import type { MensajeAlTrabajador, MensajeDelTrabajador } from '../operaciones-de-cursos.ts';
import { iniciarTrabajadorDeCursos } from '../trabajador-de-cursos.ts';

/** Lo que este Worker usa de su ámbito, con tipos propios: la comprobación general no lleva los del DOM. */
const ambito = globalThis as unknown as {
  postMessage(mensaje: MensajeDelTrabajador): void;
  addEventListener(tipo: 'message', escuchar: (evento: { readonly data: MensajeAlTrabajador }) => void): void;
};

const atender = iniciarTrabajadorDeCursos({
  importar: () => import('../../../motores/cursos/src/index.ts'),
  enviar: (mensaje) => ambito.postMessage(mensaje),
});
// Uno detrás de otro: los datos están guardados antes de atender su consulta.
let cola = Promise.resolve();
ambito.addEventListener('message', (evento) => {
  cola = cola.then(() => atender(evento.data));
});
