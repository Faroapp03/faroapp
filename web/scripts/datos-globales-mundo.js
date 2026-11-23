// «Datos globales · El mundo» (datos-globales-mundo.html), la tercera de las tres páginas del dossier: el globo con una
// luz en cada país con datos, el selector «Elige o busca tu país» y la ficha del país elegido (scripts/globo/). Con los
// datos ya comprobados (datos-globales/pagina.js) abre el globo en su sección; si el globo no se puede dibujar, la
// lista y la ficha siguen (globo/globo.js). Empieza importando sitio.js: no escribe nada antes de tener su diccionario.

import './sitio.js';
import './compatibilidad.js';
import { cargarLaPagina } from './datos-globales/pagina.js';
import { porId } from './dom.js';
import { abrirGlobo } from './globo/globo.js';

const contenedor = porId('datos-globales-globo');

// Sin await: la página ya está entera y el globo se abre al llegar los datos (datos-globales/pagina.js).
void cargarLaPagina(async (datos) => {
  contenedor.hidden = false;
  await abrirGlobo(contenedor, datos, { nivel: 2 });
});
