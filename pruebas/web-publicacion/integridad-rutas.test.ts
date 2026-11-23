import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { test } from 'node:test';
import { artefactosCatalogo, LECTOR_PUBLICADO } from '../../herramientas/web/catalogo-cursos.ts';
import { comprobarIntegridad, corregirIntegridad, huellaSri, textoDelMapa } from '../../herramientas/web/integridad.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { conGrafoDeFuentes } from '../ayudas/grafo-de-fuentes.ts';

const partesMotor = [
  'motor/src/seguridad/privacidad.js',
  'motor/src/seguridad/avisos.js',
  'motor/src/seguridad/limites.js',
  'motor/src/catalogo-cursos/calendarios.js',
  'motor/src/catalogo-cursos/forma.js',
  'motor/src/seleccion-formacion/carga.js',
];
test('las importaciones dinámicas usan destinos fijos incluidos en el inventario', () => {
  const casos = [
    [
      'scripts/recorrido/formacion/cliente.js',
      'CALENDARIOS',
      '../../../motor/src/catalogo-cursos/calendarios.js',
      'motor/src/catalogo-cursos/calendarios.js',
    ],
    [
      'scripts/recorrido/formacion/cliente.js',
      'FORMA',
      '../../../motor/src/catalogo-cursos/forma.js',
      'motor/src/catalogo-cursos/forma.js',
    ],
  ] as const;
  for (const [archivo, constante, relativa, destino] of casos) {
    const fuente = readFileSync(join('web', archivo), 'utf8');
    assert.ok(fuente.includes(`const ${constante} = new URL('${relativa}', import.meta.url).href;`));
    assert.ok(fuente.includes(`import(${constante})`));
    assert.equal(new URL(relativa, `https://ejemplo.invalid/${archivo}`).pathname, `/${destino}`);
    assert.ok(partesMotor.includes(destino));
  }
});

test('la integridad del lector generado cubre sus bytes en la página real y en las de cada extensión', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'integridad-lector-'));
  const web = join(raiz, 'web');
  const ruta = LECTOR_PUBLICADO.slice('web/'.length);
  const lector = [...artefactosCatalogo()].find(([url]) => url.pathname.endsWith(`/${LECTOR_PUBLICADO}`))?.[1];
  assert.ok(lector);
  const paginas = ['recorrido.html', ...EXTENSIONES.map(({ entrada }) => entrada)];
  try {
    // Cada página carga el lector: su mapa lista solo lo que la página puede cargar.
    for (const pagina of paginas) {
      mkdirSync(dirname(join(web, pagina)), { recursive: true });
      const src = posix.relative(posix.dirname(pagina), ruta);
      writeFileSync(join(web, pagina), `<html><head><script type="module" src="${src}"></script></head></html>`);
    }
    mkdirSync(dirname(join(web, ruta)), { recursive: true });
    writeFileSync(join(web, ruta), lector);
    const publicados = [...paginas, ruta];
    const motor = new Map(partesMotor.map((rutaMotor) => [rutaMotor, new TextEncoder().encode('export {};')]));
    const contexto = conGrafoDeFuentes({ web, paquete: raiz, motor });
    const csp = corregirIntegridad(publicados, contexto);
    const html = new Map(paginas.map((pagina) => [pagina, readFileSync(join(web, pagina), 'utf8')]));
    for (const [pagina, contenido] of html) {
      const mapa = textoDelMapa(contenido);
      assert.ok(mapa);
      const base = new URL(pagina, 'https://ejemplo.invalid/subcarpeta/');
      const hashes = JSON.parse(mapa).integrity as Record<string, string>;
      const entrada = Object.entries(hashes).find(([url]) => new URL(url, base).pathname === `/subcarpeta/${ruta}`);
      assert.equal(entrada?.[1], huellaSri(lector), pagina);
    }
    assert.deepEqual(comprobarIntegridad(publicados, html, csp, contexto), []);
    writeFileSync(join(web, ruta), `${lector}\n// alterado`);
    assert.ok(comprobarIntegridad(publicados, html, csp, contexto).length > 0);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
