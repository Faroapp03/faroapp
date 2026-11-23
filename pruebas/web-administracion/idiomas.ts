/** Los dobles de DOM omiten el arranque de la página, pero usan sus diccionarios completos reales. */
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { fijarIdioma, type Idioma, registrarDiccionario } from '../../web/scripts/textos.js';

registrarDiccionario('es', es);
registrarDiccionario('ca', ca);
export function activarIdiomaPanel(idioma: Idioma = 'es') {
  fijarIdioma(idioma);
}
activarIdiomaPanel();
