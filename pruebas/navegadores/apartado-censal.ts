/** Comprueba que el contexto censal sigue visible en pantalla y queda fuera de la impresión acordada. */
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { estabilizar } from './observacion.ts';

export async function apartadoCensalDelEjemplo(
  pagina: Page,
  origen: string,
  idioma: 'es' | 'ca',
  contarPaginas: (ejemplo: Page) => Promise<number | null>,
) {
  const ejemplo = await pagina.context().newPage();
  try {
    assert.equal((await ejemplo.goto(`${origen}/informe-ejemplo.html`))?.status(), ESTADO_HTTP.correcto);
    await ejemplo.waitForFunction(
      (elegido) =>
        document.querySelector('main')?.lang === elegido &&
        document.querySelector<HTMLElement>('main [data-ancho]')?.style.getPropertyValue('--ancho') !== '',
      idioma,
    );
    await ejemplo.emulateMedia({ media: 'screen' });
    const apartado = ejemplo.locator('main .ib-contexto-censal');
    await apartado.locator('details').evaluate((detalle) => {
      (detalle as HTMLDetailsElement).open = true;
    });
    await estabilizar(ejemplo);
    assert(await apartado.isVisible(), 'El contexto censal está visible en pantalla');
    const texto = await apartado.innerText();
    assert(texto.trim().length > 0, 'El contexto censal conserva su contenido');
    await ejemplo.emulateMedia({ media: 'print' });
    await estabilizar(ejemplo);
    assert.equal(await apartado.isVisible(), false, 'La plantilla excluye el contexto censal del papel');
    const paginas = await contarPaginas(ejemplo);
    if (paginas !== null) {
      assert.equal(paginas, 2, 'El PDF de ejemplo ocupa dos páginas');
    }
    return { texto, ocultoEnPapel: true, paginas };
  } finally {
    await ejemplo.close();
  }
}
