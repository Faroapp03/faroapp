// La web local: se construye por el camino de la oficial en su carpeta, sin escribir web/, y `servir` la sirve con sus
// mapas y su SRI solo si salió de las fuentes actuales.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { problemaDeLaPolitica } from '../../herramientas/servidor/servidor-local.ts';
import { construirWebLocal, huellaDeLasFuentes, webLocalVigente } from '../../herramientas/web/construir.ts';
import { sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';
import { huellaCsp, huellasDeLosMapas, textoDelMapa } from '../../herramientas/web/integridad.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { PAGINA_NO_EXISTE } from '../../src/plataforma/pagina-no-existe.ts';
import { cuantasPaginasPublicas, paginasDeLaRaiz } from '../ayudas/paginas-de-la-web.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ANFITRION = '127.0.0.1';
const ESPERA_MS = 20_000;
const PAUSA_MS = 50;
const CORRECTO = 200;
const AUSENTE = 404;
/** Las páginas de la raíz de web/: todas llevan mapa de módulos. */
const PAGINAS_DE_LA_RAIZ = paginasDeLaRaiz(join(RAIZ, 'web')).length;
const FECHA_ANTIGUA = new Date('2001-01-01T00:00:00Z');
const MAPA = /<script type="importmap">/;
const GUION_EN_LINEA = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
/**
 * Las páginas públicas servidas: las de la raíz y las que trae en su carpeta de web/ cada extensión instalada. El
 * panel privado de administración no se sirve aquí.
 */
const PAGINAS_SERVIDAS = cuantasPaginasPublicas(pathToFileURL(join(RAIZ, 'web/')));
const SRI = / integrity="sha384-[A-Za-z0-9+/=]+"/;

function carpeta(t: TestContext, prefijo: string): string {
  const ruta = mkdtempSync(join(tmpdir(), prefijo));
  t.after(() => rmSync(ruta, { recursive: true, force: true }));
  return ruta;
}

async function puertoLibre(): Promise<number> {
  const reserva = createServer();
  reserva.listen(0, ANFITRION);
  await once(reserva, 'listening');
  const direccion = reserva.address();
  assert.ok(direccion && typeof direccion !== 'string');
  const cerrado = once(reserva, 'close');
  reserva.close();
  await cerrado;
  return direccion.port;
}

test('la huella de las fuentes sigue los bytes y las rutas, no las fechas', (t) => {
  const raiz = carpeta(t, 'faro-huella-');
  mkdirSync(join(raiz, 'web'));
  writeFileSync(join(raiz, 'web', 'p.html'), '<p>uno</p>');
  const inicial = huellaDeLasFuentes(raiz);
  utimesSync(join(raiz, 'web', 'p.html'), FECHA_ANTIGUA, FECHA_ANTIGUA);
  writeFileSync(join(raiz, 'web', '.DS_Store'), 'ruido');
  assert.equal(huellaDeLasFuentes(raiz), inicial);
  writeFileSync(join(raiz, 'web', 'p.html'), '<p>dos</p>');
  assert.notEqual(huellaDeLasFuentes(raiz), inicial);
  writeFileSync(join(raiz, 'web', 'p.html'), '<p>uno</p>');
  assert.equal(huellaDeLasFuentes(raiz), inicial);
  writeFileSync(join(raiz, 'package-lock.json'), '{}');
  assert.notEqual(huellaDeLasFuentes(raiz), inicial);
});

test('las entradas que lee la construcción fuera de web/ y src/ también desactualizan la web local', (t) => {
  const raiz = carpeta(t, 'faro-huella-entradas-');
  const registro = 'plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json';
  for (const archivo of ['tsconfig.navegador.json', 'herramientas/comun/opciones.ts', registro, 'package.json']) {
    mkdirSync(join(raiz, archivo, '..'), { recursive: true });
    writeFileSync(join(raiz, archivo), 'uno');
  }
  for (const archivo of ['tsconfig.navegador.json', 'herramientas/comun/opciones.ts', registro, 'package.json']) {
    const antes = huellaDeLasFuentes(raiz);
    writeFileSync(join(raiz, archivo), 'dos');
    assert.notEqual(huellaDeLasFuentes(raiz), antes, archivo);
  }
});

test('la web local solo vale si salió de las mismas fuentes', (t) => {
  const destino = carpeta(t, 'faro-web-local-');
  assert.equal(webLocalVigente(destino, 'a'), undefined);
  mkdirSync(join(destino, 'web'));
  const descriptor = { huellaDeFuentes: 'a', huellaMapaModulos: "'sha256-x='", version: '0123456789abcdef' };
  writeFileSync(join(destino, 'construccion.json'), JSON.stringify(descriptor));
  assert.deepEqual(webLocalVigente(destino, 'a'), { ...descriptor, web: join(destino, 'web') });
  assert.equal(webLocalVigente(destino, 'b'), undefined);
  writeFileSync(join(destino, 'construccion.json'), '{');
  assert.equal(webLocalVigente(destino, 'a'), undefined);
});

test('la CSP del servidor tiene que admitir el mapa real de cada página', () => {
  const a = sha256EnLaCsp('a');
  const b = sha256EnLaCsp('b');
  const c = sha256EnLaCsp('c');
  assert.equal(problemaDeLaPolitica([a, b], `${b} ${a}`), undefined);
  assert.equal(problemaDeLaPolitica([a, a], a), undefined);
  assert.match(problemaDeLaPolitica([a, a], `${a} ${c}`) ?? '', /no admite exactamente/);
  assert.match(problemaDeLaPolitica([], a) ?? '', /no admite exactamente/);
  assert.match(problemaDeLaPolitica([a], b) ?? '', /no admite exactamente/);
  assert.match(problemaDeLaPolitica([a, b], a) ?? '', /no admite exactamente/);
  assert.match(problemaDeLaPolitica([a], `${a} 'unsafe-inline'`) ?? '', /no es una lista de huellas sha256/);
  assert.match(problemaDeLaPolitica([], '') ?? '', /no es una lista de huellas sha256/);
});

/** Lo que admite la directiva script-src de una CSP, sin «'self'». */
function admitidosPorLaCsp(csp: string | null): Set<string> {
  const directiva = (csp ?? '').split('; ').find((linea) => linea.startsWith('script-src '));
  return new Set((directiva ?? '').split(' ').filter((parte) => parte.startsWith("'sha256-")));
}

/** Sirve la web construida como `servir` (con las huellas de su construcción) y devuelve la URL y cómo cerrar. */
async function servirLaConstruida(
  web: string,
  huellaMapaModulos: string,
): Promise<{ url: string; cerrar: () => Promise<void> }> {
  const servidor = crearServidor({
    api: async () => new Response(null, { status: AUSENTE }),
    web,
    puerto: 0,
    anfitrion: ANFITRION,
    huellaMapaModulos,
  });
  servidor.listen(0, ANFITRION);
  await once(servidor, 'listening');
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion !== 'string');
  return {
    url: `http://${ANFITRION}:${direccion.port}`,
    cerrar: async () => {
      const cerrado = once(servidor, 'close');
      servidor.close();
      servidor.closeAllConnections();
      await cerrado;
    },
  };
}

/** Arranca el proceso de `servir` con la web local en `destino` (o la de FARO_WEB_DE_PRUEBA) y espera a que escuche. */
async function arrancarServir(t: TestContext, destino: string, webDePrueba?: string) {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [join(RAIZ, 'herramientas/servidor/servidor-local.ts')], {
    cwd: RAIZ,
    env: {
      PATH: process.env.PATH ?? '',
      TMPDIR: tmpdir(),
      FARO_PUERTO: String(puerto),
      FARO_WEB_LOCAL_DE_PRUEBA: destino,
      ...(webDePrueba === undefined ? {} : { FARO_WEB_DE_PRUEBA: webDePrueba }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => hijo.kill());
  let texto = '';
  hijo.stdout.setEncoding('utf8').on('data', (trozo: string) => {
    texto += trozo;
  });
  hijo.stderr.setEncoding('utf8').on('data', (trozo: string) => {
    texto += trozo;
  });
  const limite = Date.now() + ESPERA_MS;
  while (!texto.includes('Faro en http://')) {
    assert.ok(hijo.exitCode === null && Date.now() < limite, texto);
    await new Promise((resolver) => setTimeout(resolver, PAUSA_MS));
  }
  return { hijo, puerto, salida: texto };
}

test('construir --local inyecta mapas y SRI sin escribir web/, y el servidor sirve esa página', async (t) => {
  const antes = huellaDeLasFuentes();
  const destino = join(carpeta(t, 'faro-construir-local-'), '.web-local');
  const local = await construirWebLocal(destino);
  assert.equal(huellaDeLasFuentes(), antes, 'la construcción local no escribe en las fuentes');
  assert.deepEqual(webLocalVigente(destino, antes), local);
  const paginas = paginasDeLaRaiz(local.web);
  assert.equal(paginas.length, PAGINAS_DE_LA_RAIZ);
  for (const pagina of paginas) {
    const construida = readFileSync(join(local.web, pagina), 'utf8');
    assert.match(construida, MAPA, pagina);
    assert.match(construida, SRI, pagina);
    assert.doesNotMatch(readFileSync(join(RAIZ, 'web', pagina), 'utf8'), MAPA, `${pagina} en la fuente`);
  }
  const { hijo, puerto, salida } = await arrancarServir(t, destino);
  const respuesta = await fetch(`http://${ANFITRION}:${puerto}/inicio.html`, {
    headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'] },
  });
  assert.equal(respuesta.status, CORRECTO);
  const inicio = await respuesta.text();
  assert.equal(inicio, readFileSync(join(local.web, 'inicio.html'), 'utf8'));
  // El proceso sirve la web local vigente sin reconstruirla, con la CSP de los mapas de su construcción.
  assert.doesNotMatch(salida, /Construyendo/);
  const mapaDeInicio = textoDelMapa(inicio);
  assert.ok(mapaDeInicio !== null);
  assert.ok(admitidosPorLaCsp(respuesta.headers.get('content-security-policy')).has(sha256EnLaCsp(mapaDeInicio)));
  const cerrado = once(hijo, 'close');
  hijo.kill();
  await cerrado;
  // Las huellas que pasan los servidores de las pruebas de navegador (huellasDeLosMapas) son las de la construcción.
  const deLasPaginas = huellasDeLosMapas(local.web);
  assert.deepEqual(deLasPaginas, [...admitidosPorLaCsp(`script-src 'self' ${local.huellaMapaModulos}`)].sort());
  const servidas = readdirSync(local.web, { recursive: true, encoding: 'utf8' })
    .filter((ruta) => ruta.endsWith('.html') && !ruta.startsWith('administracion/'))
    .sort();
  assert.equal(servidas.length, PAGINAS_SERVIDAS);
  const servida = await servirLaConstruida(local.web, local.huellaMapaModulos);
  try {
    await comprobarLaCspServida(servida.url, servidas);
  } finally {
    await servida.cerrar();
  }
  const dePrueba = await arrancarServir(t, destino, local.web);
  await comprobarLaCspServida(`http://${ANFITRION}:${dePrueba.puerto}`, servidas);
});

/** La huella CSP de un texto, calculada aquí y no con la función que se prueba. */
function sha256EnLaCsp(texto: string): string {
  return `'sha256-${createHash('sha256').update(texto, 'utf8').digest('base64')}'`;
}

test('la huella CSP de un texto conocido es la de su vector fijo', () => {
  const vector = "'sha256-LCa0a2j/xo/5m0U8HTBBNBNCLXBkg7+g+YpeiGJm564='";
  assert.equal(sha256EnLaCsp('foo'), vector);
  assert.equal(huellaCsp('foo'), vector);
});

/** Los guiones en línea de una página servida (sus mapas de módulos), por la huella con que los admite la CSP. */
function huellasEnLinea(html: string): string[] {
  return [...sinComentariosHtml(html).matchAll(GUION_EN_LINEA)].map(([, texto]) => sha256EnLaCsp(texto ?? ''));
}

/**
 * La CSP de las páginas servidas sale de la propia web: admite cada guion en línea de cada página y no admite nada más
 * que los guiones en línea de las páginas servidas. Cada página se pide como la carga un navegador; la de una dirección
 * que no existe llega con su 404 también cuando se pide por su nombre.
 */
async function comprobarLaCspServida(url: string, paginas: readonly string[]): Promise<void> {
  const enLasPaginas = new Set<string>();
  const admitidas = new Set<string>();
  for (const pagina of paginas) {
    const respuesta = await fetch(`${url}/${pagina}`, {
      headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'], Accept: 'text/html' },
    });
    assert.equal(respuesta.status, `/${pagina}` === PAGINA_NO_EXISTE ? AUSENTE : CORRECTO, pagina);
    const admitidos = admitidosPorLaCsp(respuesta.headers.get('content-security-policy'));
    for (const huella of huellasEnLinea(await respuesta.text())) {
      assert.ok(admitidos.has(huella), `${pagina}: la CSP no admite uno de sus guiones en línea`);
      enLasPaginas.add(huella);
    }
    for (const huella of admitidos) {
      admitidas.add(huella);
    }
  }
  assert.deepEqual([...admitidas].sort(), [...enLasPaginas].sort(), 'la CSP solo admite los guiones de las páginas');
}

/** Un esbuild que siempre falla, para el proceso hijo: la construcción se detiene al empaquetar. */
const ESBUILD_QUE_FALLA = `data:text/javascript,${encodeURIComponent(
  [
    "import { register } from 'node:module';",
    'register(',
    `  'data:text/javascript,' + encodeURIComponent(${JSON.stringify(
      [
        'export async function resolve(especificador, contexto, siguiente) {',
        '  const resuelto = await siguiente(especificador, contexto);',
        "  if (especificador !== 'esbuild') {",
        '    return resuelto;',
        '  }',
        "  const falla = 'export * from ' + JSON.stringify(resuelto.url) +",
        '    \'; export async function build() { throw new Error("ESBUILD_FALLA"); }\';',
        "  return { url: 'data:text/javascript,' + encodeURIComponent(falla), shortCircuit: true };",
        '}',
      ].join('\n'),
    )}),`,
    ');',
  ].join('\n'),
)}`;

test('si esbuild falla, la web local anterior se conserva entera y no quedan etapas', (t) => {
  const raiz = carpeta(t, 'web-local-esbuild-');
  const destino = join(raiz, 'web local');
  mkdirSync(join(destino, 'web'), { recursive: true });
  writeFileSync(join(destino, 'web', 'inicio.html'), '<p>Anterior</p>');
  writeFileSync(join(destino, 'construccion.json'), '{"huellaDeFuentes":"anterior"}\n');
  const antes = readdirSync(destino, { recursive: true }).sort();
  const programa = [
    `import { construirWebLocal } from ${JSON.stringify(join(RAIZ, 'herramientas/web/construir.ts'))};`,
    `await construirWebLocal(${JSON.stringify(destino)});`,
  ].join('\n');
  const resultado = spawnSync(
    process.execPath,
    ['--import', ESBUILD_QUE_FALLA, '--input-type=module', '-e', programa],
    {
      cwd: RAIZ,
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: raiz },
    },
  );
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /ESBUILD_FALLA/);
  assert.deepEqual(readdirSync(destino, { recursive: true }).sort(), antes);
  assert.equal(readFileSync(join(destino, 'web', 'inicio.html'), 'utf8'), '<p>Anterior</p>');
  assert.equal(readFileSync(join(destino, 'construccion.json'), 'utf8'), '{"huellaDeFuentes":"anterior"}\n');
  assert.deepEqual(readdirSync(raiz).sort(), ['web local']);
});

test('si no se puede preparar la etapa junto al destino, no queda ninguna carpeta temporal', (t) => {
  const raiz = carpeta(t, 'web-local-sin-padre-');
  const destino = join(raiz, 'no existe', 'web local');
  const programa = [
    `import { construirWebLocal } from ${JSON.stringify(join(RAIZ, 'herramientas/web/construir.ts'))};`,
    `await construirWebLocal(${JSON.stringify(destino)});`,
  ].join('\n');
  const resultado = spawnSync(process.execPath, ['--input-type=module', '-e', programa], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: raiz },
  });
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /ENOENT/);
  assert.deepEqual(readdirSync(raiz), []);
});
