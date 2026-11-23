// Control del portal oficial; no imprime ni conserva usuario, clave, cookie o cuerpos de peticiones.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { TEXTOS_ACCESO } from '../../src/plataforma/cloudflare/textos-acceso.ts';

const HTTP_OK = 200;
const HTTP_PROHIBIDO = 403;
const MAX_TABULACIONES = 12;
const VIDA_MAXIMA_SEGUNDOS = 3600;
const MS_POR_SEGUNDO = 1000;
const MARGEN_RELOJ_SEGUNDOS = 5;

async function focoVisible(pagina, destino, tecla) {
  for (let intento = 0; intento < MAX_TABULACIONES; intento++) {
    await pagina.keyboard.press(tecla);
    if (await destino.evaluate((elemento) => elemento === document.activeElement)) {
      return destino.evaluate((elemento) => elemento.matches(':focus-visible'));
    }
  }
  return false;
}

async function registrarFoco(pagina, ingresar, { prefijo, idioma, tema, resultadosFoco }) {
  const tab = await focoVisible(pagina, ingresar, 'Tab');
  const opcionTab = !tab && prefijo === 'webkit' ? await focoVisible(pagina, ingresar, 'Alt+Tab') : null;
  resultadosFoco.push({ idioma, tema, tab, opcionTab });
  assert.ok(tab || opcionTab, 'El enlace presenta foco visible al navegar con teclado');
}

const IDIOMAS_PUBLICOS = ['ca', 'es'];

async function aspectoPortada(pagina, salida, prefijo, resultadosFoco) {
  await pagina.evaluate(() => {
    localStorage.setItem('faro-idioma', 'es');
    localStorage.setItem('faro-tema', 'claro');
  });
  await pagina.reload();
  const ingresar = pagina.locator('.acceso a');
  assert.equal(await pagina.locator('#tema-entrada').count(), 0);
  for (const idioma of IDIOMAS_PUBLICOS) {
    assert.equal(await pagina.locator('html').getAttribute('lang'), idioma);
    assert.equal(await pagina.locator('body').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(0, 0, 0)');
    assert.equal(await pagina.locator('#titulo').evaluate((e) => getComputedStyle(e).color), 'rgb(255, 255, 255)');
    await pagina.screenshot({ path: join(salida, `${prefijo}-portada-${idioma}-oscuro.png`), fullPage: true });
    const normal = await ingresar.evaluate((e) => getComputedStyle(e).backgroundColor);
    await ingresar.hover();
    await pagina.waitForFunction(
      (color) => getComputedStyle(document.querySelector('.acceso a')).backgroundColor !== color,
      normal,
    );
    if (idioma === 'es') {
      await pagina.screenshot({ path: join(salida, `${prefijo}-ingresar-hover.png`), fullPage: true });
    }
    await registrarFoco(pagina, ingresar, { prefijo, idioma, tema: 'oscuro', resultadosFoco });
    if (idioma === 'es') {
      await pagina.screenshot({ path: join(salida, `${prefijo}-ingresar-foco.png`), fullPage: true });
    }
    await pagina.locator('#idioma-entrada').click();
  }
}

async function aspectoAcceso(pagina, salida, prefijo) {
  assert.equal(await pagina.locator('#tema-entrada').count(), 0);
  assert.equal(await pagina.locator('html').evaluate((e) => getComputedStyle(e).colorScheme), 'dark');
  for (const idioma of IDIOMAS_PUBLICOS) {
    assert.equal(await pagina.locator('html').getAttribute('lang'), idioma);
    assert.equal(await pagina.locator('#titulo').innerText(), TEXTOS_ACCESO[idioma].titulo);
    await pagina.screenshot({ path: join(salida, `${prefijo}-acceso-${idioma}-oscuro.png`), fullPage: true });
    await pagina.locator('#idioma-entrada').click();
  }
}

export async function entrarPortal(pagina, credenciales) {
  if (await pagina.locator('#volver-usuario').isVisible()) {
    await pagina.locator('#volver-usuario').click();
  }
  await pagina.locator('#campo-usuario').fill(credenciales.usuario);
  await pagina.locator('#continuar').click();
  await pagina.locator('#campo-clave').fill(credenciales.clave);
  const [respuesta] = await Promise.all([
    pagina.waitForResponse((r) => new URL(r.url()).pathname === '/acceso-web/entrar'),
    pagina.locator('#entrar').click(),
  ]);
  assert.equal(respuesta.status(), HTTP_OK);
  assert.match((await respuesta.allHeaders())['set-cookie'] ?? '', /Max-Age=3600/i);
  await pagina.locator('#formulario-acceso').waitFor({ state: 'detached' });
}

/** La salida espera a que terminen las lecturas que inicia la aplicación al identificarse. */
async function entrarYEsperarInicio(pagina, credenciales) {
  const pendientes = ['/secciones-v3.json', '/modo-recorrido.json', '/acceso-web/estado'].map(async (ruta) => {
    const respuesta = await pagina.waitForResponse((r) => new URL(r.url()).pathname === ruta);
    assert.equal(respuesta.status(), HTTP_OK, ruta);
    assert.equal(await respuesta.finished(), null, ruta);
  });
  await Promise.all([...pendientes, entrarPortal(pagina, credenciales)]);
}

async function comprobarSesionYCierre(pagina, contexto, origen) {
  const cookies = await contexto.cookies(origen.origin);
  const protegidas = cookies.filter((cookie) => cookie.name === '__Host-faro-portal');
  assert.equal(protegidas.length, 1, 'Una única cookie de sesión con prefijo __Host-');
  const cookie = protegidas[0];
  assert.ok(cookie.httpOnly && cookie.secure && cookie.sameSite === 'Strict' && cookie.path === '/');
  const vida = cookie.expires - Date.now() / MS_POR_SEGUNDO;
  assert.ok(vida > 0 && vida <= VIDA_MAXIMA_SEGUNDOS + MARGEN_RELOJ_SEGUNDOS);
  const salidaEstado = await pagina.evaluate(
    async () => (await fetch('/acceso-web/salir', { method: 'POST', credentials: 'same-origin' })).status,
  );
  assert.equal(salidaEstado, HTTP_OK);
  assert.equal((await contexto.cookies(origen.origin)).filter((c) => c.name === '__Host-faro-portal').length, 0);
  // Sin sesión, la navegación termina en la pantalla de acceso con la página pedida para volver.
  assert.equal((await pagina.goto(new URL('/inicio.html', origen).href))?.status(), HTTP_OK);
  const pantalla = new URL(pagina.url());
  assert.equal(pantalla.pathname, '/acceso-web');
  assert.equal(pantalla.searchParams.get('volver'), '/inicio.html');
}

export async function probarPortal({ contexto, origen, credenciales, salida, nombre, teclado = [] }) {
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (error) => errores.push(error.name));
  try {
    const portada = await pagina.goto(new URL('/', origen).href);
    assert.equal(portada?.status(), HTTP_OK);
    assert.equal(portada?.headers()['www-authenticate'], undefined);
    await aspectoPortada(pagina, salida, nombre, teclado);
    const entrada = pagina.locator('.acceso a');
    const [respuesta] = await Promise.all([pagina.waitForNavigation(), entrada.click()]);
    assert.equal(respuesta?.status(), HTTP_OK);
    assert.equal(respuesta?.headers()['www-authenticate'], undefined);
    await pagina.locator('#formulario-acceso').waitFor({ state: 'visible' });
    await aspectoAcceso(pagina, salida, nombre);
    await pagina.locator('#campo-usuario').fill(credenciales.usuario);
    await pagina.locator('#continuar').click();
    await pagina.locator('#campo-clave').fill('clave-sintetica-incorrecta');
    const [rechazo] = await Promise.all([
      pagina.waitForResponse((r) => new URL(r.url()).pathname === '/acceso-web/entrar'),
      pagina.locator('#entrar').click(),
    ]);
    assert.equal(rechazo.status(), HTTP_PROHIBIDO);
    await pagina.locator('#error-acceso').waitFor({ state: 'visible' });
    assert.ok(!(await pagina.locator('#error-acceso').innerText()).includes(credenciales.usuario));
    assert.equal(await pagina.locator('#campo-clave').getAttribute('type'), 'password');
    await entrarYEsperarInicio(pagina, credenciales);
    await pagina.locator('button.tema-boton').first().waitFor({ state: 'attached' });
    assert.equal(await pagina.locator('html').getAttribute('data-tema'), 'claro');
    assert.equal(await pagina.locator('html').getAttribute('data-idioma'), 'ca');
    await comprobarSesionYCierre(pagina, contexto, origen);
    assert.deepEqual(errores, []);
    return {
      portada: true,
      teclado,
      idiomas: IDIOMAS_PUBLICOS,
      temas: ['oscuro'],
      errorGenerico: true,
      cookieSegura: true,
      cierre: true,
    };
  } finally {
    await pagina.close();
  }
}
