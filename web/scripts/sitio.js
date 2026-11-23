// Lo que comparten todas las páginas: idioma, menú, tema, instalación como aplicación y sesión de la fase privada.
// El idioma va primero y se espera: escribe los textos de la página con su diccionario ya cargado, y los demás rotulan
// sus botones en él. Cada módulo de página (el recorrido, el ejemplo de la IA, el buscador…) empieza importando este
// archivo: un módulo no se ejecuta hasta que terminan los que importa, también su `await`, así que ninguno escribe un
// texto antes de que su diccionario esté listo. Si el diccionario
// del idioma elegido no llega, la página sigue en castellano, lo dice y el resto arranca igual.

import { comprobarAcceso } from './acceso.js';
import { prepararContacto } from './contacto.js';
import { iniciarIdioma } from './idioma.js';
import { iniciarInstalacion } from './instalacion.js';
import { iniciarInvitacion } from './invitacion.js';
import { iniciarMenu } from './menu.js';
import { iniciarModoRecorrido } from './menu-recorrido.js';
import { iniciarSalirPortal } from './salir-portal.js';
import { iniciarSecciones } from './secciones.js';
import { avisarDeIdiomaNoCargado, iniciarSelectorIdioma } from './selector-idioma.js';
import { iniciarTema } from './tema.js';

const idiomaElegido = document.documentElement.dataset.idioma;
const conElIdiomaElegido = await iniciarIdioma();
await iniciarSecciones();
// Lo que rotula la página en el idioma ya cargado.
iniciarSelectorIdioma();
iniciarMenu();
iniciarTema();
iniciarInstalacion();
iniciarModoRecorrido();
void iniciarSalirPortal();
prepararContacto();
iniciarInvitacion();
// Lo que arranca sin esperar. La sesión de Access (acceso.js) no decide nada de la página, y si ha caducado la vuelve a
// pedir por la red; sin red o sin respuesta, no hace nada. El borrado desde otra pestaña se comunica por el
// mecanismo compartido de avisos.
void comprobarAcceso();
if (!conElIdiomaElegido && idiomaElegido) {
  avisarDeIdiomaNoCargado(idiomaElegido);
}
