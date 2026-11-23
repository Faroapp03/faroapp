// La construcción compara el registro de extensiones de la raíz que construye con las carpetas de su web.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { conConstruccionCloudflare, type WebConstruida } from '../../herramientas/cloudflare/comprobar-construccion.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';

const HUELLA_MAPA = `'sha256-${createHash('sha256').update('{}').digest('base64')}'`;

function escribir(carpeta: string, ruta: string, contenido: string): void {
  mkdirSync(dirname(join(carpeta, ruta)), { recursive: true });
  writeFileSync(join(carpeta, ruta), contenido);
}

/**
 * Una raíz con las plantillas reales, el registro indicado y las carpetas de extensión indicadas en su web, junto a
 * una web construida con los artefactos mínimos que exige la construcción.
 */
function raizConRegistro(instaladas: string, carpetas: readonly string[], paginas: readonly string[] = []) {
  const padre = mkdtempSync(join(realpathSync(tmpdir()), 'cloudflare-registro-'));
  const raiz = join(padre, 'raíz con registro');
  for (const nombre of ['wrangler.example.jsonc', 'wrangler.cursos.example.jsonc']) {
    mkdirSync(join(raiz, 'config/cloudflare'), { recursive: true });
    copyFileSync(join(RUTAS.raiz, 'config/cloudflare', nombre), join(raiz, 'config/cloudflare', nombre));
  }
  mkdirSync(join(raiz, 'src/plataforma'), { recursive: true });
  copyFileSync(join(RUTAS.raiz, 'src/plataforma/extensiones.ts'), join(raiz, 'src/plataforma/extensiones.ts'));
  escribir(raiz, 'src/plataforma/extensiones-instaladas.ts', instaladas);
  escribir(raiz, 'web/index.html', '<!doctype html><title>Web</title>');
  for (const carpeta of carpetas) {
    escribir(raiz, `web/${carpeta}/servidor/extension.ts`, 'export {};\n');
  }
  for (const pagina of paginas) {
    escribir(raiz, `web/${pagina}`, '<!doctype html><title>Página</title>');
  }
  const web = join(padre, 'web construida');
  escribir(web, '.assetsignore', '.assetsignore\n');
  escribir(web, 'firmas/manifiesto.json', '{}');
  escribir(web, 'motor/entrada.js', 'export {};\n');
  escribir(web, 'paquete/1/manifiesto.json', '{}');
  const contexto: WebConstruida = { web, paquete: RUTAS.paquete, motor: new Map(), huellaMapaModulos: HUELLA_MAPA };
  return { padre, raiz, contexto };
}

async function rechazaConUnProblema(
  instaladas: string,
  carpetas: readonly string[],
  esperado: RegExp,
  paginas: readonly string[] = [],
) {
  const { padre, raiz, contexto } = raizConRegistro(instaladas, carpetas, paginas);
  const descriptorRaiz = Object.getOwnPropertyDescriptor(RUTAS, 'raiz');
  const descriptorWeb = Object.getOwnPropertyDescriptor(RUTAS, 'web');
  assert.ok(descriptorRaiz && descriptorWeb);
  try {
    Object.defineProperty(RUTAS, 'raiz', { ...descriptorRaiz, value: `${raiz}/` });
    Object.defineProperty(RUTAS, 'web', { ...descriptorWeb, value: `${join(raiz, 'web')}/` });
    await assert.rejects(
      conConstruccionCloudflare(async () => assert.fail('El registro no coincide: no debe construir'), contexto),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const problemas = error.message.split('\n');
        assert.equal(problemas.length, 1, error.message);
        assert.match(problemas[0] ?? '', esperado);
        return true;
      },
    );
  } finally {
    Object.defineProperty(RUTAS, 'raiz', descriptorRaiz);
    Object.defineProperty(RUTAS, 'web', descriptorWeb);
    rmSync(padre, { recursive: true, force: true });
  }
}

test('una carpeta de extensión sin línea en el registro de su raíz detiene la construcción', async () => {
  await rechazaConUnProblema(
    'export {};\n',
    ['ext'],
    /^La carpeta web\/ext\/ tiene servidor\/extension\.ts pero no figura en src\/plataforma\/extensiones-instaladas\.ts/,
  );
});

test('una línea del registro sin su carpeta en la web de su raíz detiene la construcción', async () => {
  await rechazaConUnProblema(
    "export const AUSENTE = { id: 'ausente', entrada: 'ausente/recorrido.html' };\n",
    [],
    /^La extensión «ausente» está registrada con la entrada ausente\/recorrido\.html, pero web\/ausente\//,
  );
});

test('una carpeta con páginas que no es del real ni una extensión registrada detiene la construcción', async () => {
  await rechazaConUnProblema(
    'export {};\n',
    [],
    /^La carpeta web\/retirada\/ tiene páginas \(1\) pero no es una carpeta del real ni de una extensión registrada/,
    ['administracion/index.html', 'retirada/recorrido.html'],
  );
});
