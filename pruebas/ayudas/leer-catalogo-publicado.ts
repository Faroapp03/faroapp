/**
 * Lee el catálogo de Cursos publicado en una carpeta `web/` como lo lee la página: la referencia importada del
 * módulo publicado, la carga acotada con su huella y las ofertas vigentes con el reloj dado.
 *
 * Uso: node --import ./pruebas/ayudas/sin-red.ts pruebas/ayudas/leer-catalogo-publicado.ts <web> <ahora en ms>
 * Escribe en la salida un JSON con la revisión y, por oferta vigente, su URL, su título y su última comprobación.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cargarCatalogo, type PublicacionCatalogo } from '../../src/catalogo-cursos/carga.ts';
import { ofertasVigentes } from '../../src/catalogo-cursos/lectura.ts';

const [web, ahora] = process.argv.slice(2);
if (!web || !ahora) {
  throw new Error('Uso: leer-catalogo-publicado.ts <web> <ahora en ms>');
}
const modulo: { REFERENCIA: PublicacionCatalogo } = await import(
  pathToFileURL(join(web, 'scripts/catalogo-cursos/referencia.js')).href
);
// El servidor entrega el archivo publicado tal cual, con el tipo que exige la carga.
const pedir = async (peticion: Request): Promise<Response> =>
  new Response(await readFile(fileURLToPath(peticion.url)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const catalogo = await cargarCatalogo(modulo.REFERENCIA, pathToFileURL(`${web}/`), pedir);
const ofertas = ofertasVigentes(catalogo, Number(ahora)).map((oferta) => ({
  url: oferta.url,
  titulo: oferta.titulo_programa,
  comprobadoEl: oferta.comprobado_el,
}));
process.stdout.write(JSON.stringify({ revision: modulo.REFERENCIA.revision, ofertas }));
