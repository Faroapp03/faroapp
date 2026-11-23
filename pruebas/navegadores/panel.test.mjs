/** Los gestos nativos del panel, su sesión única y el cierre de Biblioteca en Chromium, Firefox y WebKit (panel.ts). */
import { test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright-core';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { crearFixtureDelPanel } from './fixture-panel.ts';
import { probarPanel } from './panel.ts';
import { cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

for (const [nombre, motor] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  test(`${nombre}: el panel atiende cada gesto una vez, sustituye la sesión y cierra y reabre Biblioteca`, async (t) => {
    const recursos = recursosDelCaso(t);
    const fixture = await recursos.abrir('el servidor del panel', crearFixtureDelPanel, (abierto) => abierto.cerrar());
    const navegador = await lanzarConPlazo(motor, { headless: true }, t.name, { recursos });
    try {
      const contexto = await navegador.newContext({
        userAgent: IDENTIDAD_WEB['User-Agent'],
        viewport: { width: 1280, height: 900 },
        locale: 'es',
        timezoneId: 'Europe/Madrid',
        reducedMotion: 'reduce',
        colorScheme: 'light',
        serviceWorkers: 'block',
        extraHTTPHeaders: { ...IDENTIDAD_WEB, 'cf-access-jwt-assertion': fixture.jwt },
      });
      await probarPanel(contexto, fixture);
      await contexto.close();
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
      await cerrarSinSustituir(() => recursos.cerrar(fixture), 'el servidor del panel no se cerró');
    }
    if (fixture.errores.length) {
      throw new Error(`Errores del servidor del panel: ${fixture.errores.join('; ')}`);
    }
  });
}
