import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  PAGINA_ACCESO_WEB,
  PLAZO_ENTRADA_MS,
  paginaAcceso,
} from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { FOTOGRAFIA_PORTADA, rutaDeActivo } from '../../src/plataforma/cloudflare/activos-publicos.ts';
import { TEXTOS_ACCESO } from '../../src/plataforma/cloudflare/textos-acceso.ts';

const CORRECTO = 200;
const PROHIBIDO = 403;
const QUINCE_SEGUNDOS_MS = 15_000;
const CIFRAS_DE_LA_HUELLA_EN_EL_NOMBRE = 16;
test('la página de acceso se sirve con 200, CSP íntegra y sin desafío, y HEAD no lleva cuerpo', async () => {
  const respuesta = paginaAcceso(
    new Request('https://ejemplo.invalid/recorrido.html', { headers: { accept: 'text/html' } }),
  );
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(respuesta.headers.has('www-authenticate'), false);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const csp = respuesta.headers.get('content-security-policy') ?? '';
  for (const etiqueta of ['style', 'script']) {
    const texto = new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`).exec(PAGINA_ACCESO_WEB)?.[1];
    assert.ok(texto);
    assert.ok(csp.includes(`sha256-${createHash('sha256').update(texto).digest('base64')}`));
  }
  const head = paginaAcceso(
    new Request('https://ejemplo.invalid/acceso-web', { method: 'HEAD', headers: { accept: 'text/html' } }),
  );
  assert.equal(head.status, CORRECTO);
  assert.equal(await head.text(), '');
});

test('portada y acceso comparten la fotografía aprobada por su huella, sin incrustarla', async () => {
  const { PORTADA_PUBLICA } = await import('../../src/plataforma/cloudflare/portada-publica.ts');
  const ruta = rutaDeActivo(FOTOGRAFIA_PORTADA);
  const imagenPortada = /<div class="imagen"><img src="([^"]+)"/.exec(PORTADA_PUBLICA)?.[1];
  const imagenAcceso = /<img class="fondo" src="([^"]+)"/.exec(PAGINA_ACCESO_WEB)?.[1];
  assert.equal(imagenPortada, ruta);
  assert.equal(imagenAcceso, ruta);
  for (const html of [PORTADA_PUBLICA, PAGINA_ACCESO_WEB]) {
    assert.equal(html.includes('data:image/webp'), false);
  }
  const bytes = readFileSync(new URL(`../../web/${FOTOGRAFIA_PORTADA.archivo}`, import.meta.url));
  const huella = createHash('sha256').update(bytes).digest('hex');
  assert.equal(huella, 'e49d4a55f350ce610ca09851466f0ddeb9b1b9e862057d2fa35e8728c777d6b3');
  assert.equal(FOTOGRAFIA_PORTADA.sha256, huella);
  assert.equal(ruta, `/publico/faro-penmon-${huella.slice(0, CIFRAS_DE_LA_HUELLA_EN_EL_NOMBRE)}.webp`);
});

test('la página de acceso incluye el mismo icono autocontenido que la portada con CSP data', async () => {
  const { PORTADA_PUBLICA } = await import('../../src/plataforma/cloudflare/portada-publica.ts');
  const icono = /<link rel="icon" href="(data:image\/svg\+xml,[^"]+)">/.exec(PORTADA_PUBLICA)?.[1];
  assert.ok(icono);
  assert.ok(PAGINA_ACCESO_WEB.includes(`<link rel="icon" href="${icono}">`));
  const csp = paginaAcceso(
    new Request('https://ejemplo.invalid/acceso-web', { headers: { accept: 'text/html' } }),
  ).headers.get('content-security-policy');
  assert.ok(csp?.includes("img-src data: 'self';"));
});

test('la navegación por un service worker conserva el formulario aunque el destino de red sea empty', async () => {
  const respuesta = paginaAcceso(
    new Request('https://ejemplo.invalid/inicio.html', {
      headers: { 'sec-fetch-dest': 'empty', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    }),
  );
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(respuesta.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await respuesta.text(), PAGINA_ACCESO_WEB);
});

test('los recursos sin aceptación de HTML reciben un 403 vacío', async () => {
  for (const destino of ['empty', 'script', 'image', 'style']) {
    const respuesta = paginaAcceso(
      new Request('https://ejemplo.invalid/recurso', {
        headers: { 'sec-fetch-dest': destino, accept: '*/*' },
      }),
    );
    assert.equal(respuesta.status, PROHIBIDO);
    assert.equal(await respuesta.text(), '');
    assert.equal(respuesta.headers.has('content-type'), false);
  }
});

test('el acceso usa el logotipo de la portada, con su tipografía, y vuelve a la portada al pulsarlo', async () => {
  const { PORTADA_PUBLICA } = await import('../../src/plataforma/cloudflare/portada-publica.ts');
  const logotipo =
    /<span class="entrada-logo" aria-label="Faro">(<span class="entrada-f">F<svg[\s\S]*?<\/svg><\/span>ARO)<\/span>/.exec(
      PORTADA_PUBLICA,
    )?.[1];
  const reglas = /\.entrada-logo\{[^}]*\}\.entrada-f\{[^}]*\}\.entrada-f svg\{[^}]*\}/.exec(PORTADA_PUBLICA)?.[0];
  const sora = /@font-face\{font-family:Sora;[^}]*\}/.exec(PORTADA_PUBLICA)?.[0];
  assert.ok(logotipo && reglas && sora);
  assert.ok(
    PAGINA_ACCESO_WEB.includes(
      `<a class="entrada-logo" id="volver-portada" href="/" aria-label="Faro, torna a la portada">${logotipo}</a>`,
    ),
  );
  const estilo = /<style>([\s\S]*?)<\/style>/.exec(PAGINA_ACCESO_WEB)?.[1] ?? '';
  assert.ok(estilo.includes(reglas));
  assert.ok(estilo.includes(sora));
  assert.ok(!PAGINA_ACCESO_WEB.includes('<span class="marca">FARO</span>'));
  const csp = paginaAcceso(
    new Request('https://ejemplo.invalid/acceso-web', { headers: { accept: 'text/html' } }),
  ).headers.get('content-security-policy');
  assert.ok(csp?.includes('font-src data:'));
});

/** El guion de la pantalla, tal como se sirve. */
function guion(): string {
  return /<script>([\s\S]*?)<\/script>/.exec(PAGINA_ACCESO_WEB)?.[1] ?? '';
}

test('el aviso de carga fallida llega tras el guion, que lo oculta antes de que se pinte, y no viaja en él', () => {
  const finDelGuion = PAGINA_ACCESO_WEB.indexOf('</script>');
  const aviso = PAGINA_ACCESO_WEB.indexOf('<div id="aviso-carga" class="aviso-carga">');
  assert.ok(finDelGuion > 0 && aviso > finDelGuion);
  assert.equal(PAGINA_ACCESO_WEB.slice(aviso, PAGINA_ACCESO_WEB.indexOf('</div>', aviso)).includes('hidden'), false);
  for (const idioma of ['ca', 'es'] as const) {
    assert.equal(guion().includes(TEXTOS_ACCESO[idioma]['carga-fallida']), false, idioma);
  }
});

test('el envío tiene región de estado previa, vacía y educada, y un plazo propio de quince segundos', () => {
  assert.ok(
    PAGINA_ACCESO_WEB.includes('<p id="progreso-acceso" class="progreso" role="status" aria-live="polite"></p>'),
  );
  assert.equal(PLAZO_ENTRADA_MS, QUINCE_SEGUNDOS_MS);
  assert.ok(guion().includes(`,${PLAZO_ENTRADA_MS})`));
  assert.ok(guion().includes('clearTimeout('));
  assert.ok(guion().includes("setAttribute('aria-busy','true')"));
});
