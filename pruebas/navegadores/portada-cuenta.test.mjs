import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { CSP_PORTADA, CSP_SCRIPT_CABECERA, PORTADA_PUBLICA } from '../../src/plataforma/cloudflare/portada-publica.ts';
import { cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const UN_SEGUNDO_MS = 1000;
const MILISEGUNDOS_TRAS_APERTURA = 5000;

test('la portada conserva los hashes CSP de su estilo y su guion', () => {
  for (const [etiqueta, esperado] of [
    ['style', CSP_PORTADA],
    ['script', CSP_SCRIPT_CABECERA],
  ]) {
    const coincidencia = PORTADA_PUBLICA.match(new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`));
    assert.ok(coincidencia, `Falta ${etiqueta}`);
    assert.equal(`sha256-${createHash('sha256').update(coincidencia[1]).digest('base64')}`, esperado);
  }
});

/** En el primer segundo solo el último dígito recibe la clase de animación. */
async function comprobarPrimerCambio(pagina) {
  const digitos = pagina.locator('#cuenta .digito');
  assert.deepEqual(await digitos.allTextContents(), [...'00000002']);
  assert.equal(await pagina.locator('.digito.cambia').count(), 0);
  await pagina.clock.runFor(UN_SEGUNDO_MS);
  assert.deepEqual(await digitos.allTextContents(), [...'00000001']);
  assert.deepEqual(await pagina.locator('#cuenta-segundos .digito.cambia').allTextContents(), ['1']);
  assert.equal(await pagina.locator('.digito.cambia').count(), 1);
}

test('la cuenta llega a cero en Madrid, cambia de idioma y mantiene el acceso privado', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const pagina = await navegador.newPage({ locale: 'es-ES', reducedMotion: 'reduce' });
    await pagina.clock.install({ time: new Date('2026-11-30T22:59:00Z') });
    await pagina.clock.pauseAt(new Date('2026-11-30T22:59:58Z'));
    await pagina.route('https://ejemplo.invalid/**', (ruta) =>
      ruta.fulfill({ contentType: 'text/html', body: PORTADA_PUBLICA }),
    );
    await pagina.goto('https://ejemplo.invalid/');
    const cuenta = pagina.locator('#cuenta');
    const estado = pagina.locator('#cuenta-estado');
    const enlace = pagina.locator('.acceso a');
    assert.equal(await estado.textContent(), 'La demo privada comença d’aquí a');
    assert.equal(await cuenta.isVisible(), true);
    assert.equal(await pagina.locator('.cuenta-estado.abierta').count(), 0);
    assert.equal(await pagina.locator('#cuenta-fecha').isVisible(), true);
    assert.equal(await enlace.getAttribute('href'), '/acceso-web');
    assert.equal(await enlace.isVisible(), true);
    await comprobarPrimerCambio(pagina);
    await pagina.clock.runFor(UN_SEGUNDO_MS);
    assert.equal(await cuenta.isHidden(), true);
    assert.equal(await pagina.locator('#cuenta-fecha').isHidden(), true);
    assert.equal(await pagina.locator('.cuenta-estado.abierta').getAttribute('id'), 'cuenta-estado');
    assert.equal(await estado.textContent(), 'La demo privada ha començat');
    assert.equal(await enlace.isVisible(), true);
    await pagina.clock.runFor(MILISEGUNDOS_TRAS_APERTURA);
    assert.equal(await pagina.locator('#cuenta-segundos').textContent(), '00');
    await pagina.locator('#idioma-entrada').click();
    assert.equal(await estado.textContent(), 'La demo privada ha comenzado');
    assert.equal(await enlace.locator('.etiqueta').textContent(), 'Entrar');
    assert.equal(await enlace.getAttribute('href'), '/acceso-web?idioma=es');
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});
