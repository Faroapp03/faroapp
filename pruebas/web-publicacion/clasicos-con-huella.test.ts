// Los guiones clásicos de la cabecera (tema e idioma iniciales) se publican con la huella de sus bytes en el nombre.
// Con un nombre fijo, el service worker de la versión anterior sirve de su copia los bytes viejos a la página nueva,
// que llega de la red con el integrity de los nuevos, y el navegador bloquea el guion (actualización desde entrega-12g
// en Chromium, 02/11/2026). Se comprueba en la web construida de las fuentes actuales (npm run web:preparar).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { test } from 'node:test';
import { SCRIPTS_CLASICOS } from '../../herramientas/web/csp.ts';
import { aperturas, etiquetasDe, sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';
import { huellaSri } from '../../herramientas/web/integridad.ts';
import { archivosPublicados, leer } from '../../herramientas/web/publicados.ts';
import { javascriptPublicado } from '../../herramientas/web/recursos-publicados.ts';
import { webConstruida } from '../ayudas/web-construida.ts';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Los guiones que carga una página, por su ruta desde la raíz de la web, con los atributos de su etiqueta. */
function guionesDe(pagina: string, html: string): { ruta: string; atributos: ReadonlyMap<string, string | null> }[] {
  return aperturas(etiquetasDe(sinComentariosHtml(html)), 'script').flatMap(({ atributos }) => {
    const src = atributos.get('src');
    if (!src) {
      return [];
    }
    const ruta = decodeURIComponent(new URL(src, new URL(pagina, 'https://faro.invalid/')).pathname.slice(1));
    return [{ ruta, atributos }];
  });
}

test('en la web construida, cada guion clásico se publica una vez con su huella y todas sus páginas lo citan así', () => {
  const web = webConstruida();
  const paginasFuente = archivosPublicados().filter((archivo) => archivo.endsWith('.html'));
  const paginasConstruidas = new Map(
    archivosPublicados(web)
      .filter((archivo) => archivo.endsWith('.html'))
      .map((pagina) => [pagina, guionesDe(pagina, leer(pagina, web))] as const),
  );
  for (const fuente of SCRIPTS_CLASICOS) {
    const carpeta = posix.dirname(fuente);
    const base = posix.basename(fuente, '.js');
    assert.equal(existsSync(join(web, fuente)), false, `${fuente} se publica con su nombre fijo`);
    const conHuella = new RegExp(`^${base}-([a-f0-9]{64})\\.js$`, 'u');
    const copias = readdirSync(join(web, carpeta)).filter((archivo) => conHuella.test(archivo));
    assert.equal(copias.length, 1, `${fuente}: debe haber una sola copia con su huella (${copias.join(', ')})`);
    const publicado = `${carpeta}/${copias[0]}`;
    const bytes = readFileSync(join(web, publicado));
    assert.equal(conHuella.exec(posix.basename(publicado))?.[1], sha256(bytes), `${publicado}: no es su huella`);
    assert.equal(
      bytes.toString('utf8'),
      javascriptPublicado(leer(fuente), 'script'),
      `${publicado} no corresponde a su fuente`,
    );
    const citan = paginasFuente.filter((pagina) => guionesDe(pagina, leer(pagina)).some(({ ruta }) => ruta === fuente));
    assert.ok(citan.length > 0, `Ninguna página fuente carga ${fuente}`);
    for (const [pagina, guiones] of paginasConstruidas) {
      assert.ok(!guiones.some(({ ruta }) => ruta === fuente), `${pagina} cita ${fuente} por su nombre fijo`);
    }
    for (const pagina of citan) {
      const etiquetas = (paginasConstruidas.get(pagina) ?? []).filter(({ ruta }) => ruta === publicado);
      assert.equal(etiquetas.length, 1, `${pagina} debe cargar ${publicado} una vez`);
      assert.equal(etiquetas[0]?.atributos.get('integrity'), huellaSri(bytes), `${pagina}: integrity de ${publicado}`);
      assert.equal(etiquetas[0]?.atributos.get('crossorigin'), 'anonymous', `${pagina}: crossorigin de ${publicado}`);
    }
  }
});
