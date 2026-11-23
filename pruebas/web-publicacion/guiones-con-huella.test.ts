import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { comprobarCspHtml } from '../../herramientas/web/csp.ts';
import { seEmpaqueta } from '../../herramientas/web/empaquetado.ts';
import {
  CLASICOS_DE_LA_CABECERA,
  comprobarGuion,
  comprobarGuionesConHuella,
  esClasicoDeLaCabecera,
  guionesConHuellaEnLasFuentes,
  prepararGuion,
  prepararGuionesConHuella,
} from '../../herramientas/web/guiones-con-huella.ts';
import { modulosDeLaWeb } from '../../herramientas/web/integridad.ts';
import { WEB } from '../../herramientas/web/publicados.ts';

const [TEMA] = CLASICOS_DE_LA_CABECERA;
const DIGITOS_SHA256 = 64;
const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');
const publicado = (bytes: string) => `tema-inicial-${sha256(bytes)}.js`;
/** Las páginas cargan el tema por su ruta relativa, desde una subcarpeta o por su ruta absoluta. */
const PAGINAS: Readonly<Record<string, string>> = {
  'inicio.html':
    '<script src="scripts/tema-inicial.js"></script><script type="module" src="scripts/sitio.js"></script>',
  'demo/recorrido.html': '<script src="../scripts/tema-inicial.js"></script>',
  'administracion/index.html': '<script src="/scripts/tema-inicial.js"></script>',
  'sin-tema.html': '<script type="module" src="scripts/sitio.js"></script>',
};

function conWeb(prueba: (web: string) => void): void {
  const web = mkdtempSync(join(tmpdir(), 'faro-guiones-con-huella-'));
  try {
    for (const [ruta, contenido] of Object.entries({ ...PAGINAS, 'scripts/tema-inicial.js': 'tema();' })) {
      mkdirSync(dirname(join(web, ruta)), { recursive: true });
      writeFileSync(join(web, ruta), contenido);
    }
    prueba(web);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
}

const leer = (web: string, ruta: string) => readFileSync(join(web, ruta), 'utf8');

test('el tema inicial se publica con su huella y todas las páginas que lo cargan lo citan así', () => {
  assert.ok(TEMA);
  conWeb((web) => {
    assert.ok(comprobarGuion(web, TEMA).some((problema) => problema.includes('se publica con su nombre fijo')));
    prepararGuion(web, TEMA);
    const nombre = publicado('tema();');
    assert.equal(existsSync(join(web, 'scripts/tema-inicial.js')), false);
    assert.equal(leer(web, `scripts/${nombre}`), 'tema();');
    assert.ok(leer(web, 'inicio.html').startsWith(`<script src="scripts/${nombre}"></script>`));
    assert.equal(leer(web, 'demo/recorrido.html'), `<script src="../scripts/${nombre}"></script>`);
    assert.equal(leer(web, 'administracion/index.html'), `<script src="/scripts/${nombre}"></script>`);
    assert.equal(leer(web, 'sin-tema.html'), PAGINAS['sin-tema.html']);
    assert.deepEqual(comprobarGuion(web, TEMA), []);
    for (const pagina of ['inicio.html', 'demo/recorrido.html', 'administracion/index.html']) {
      assert.deepEqual(comprobarCspHtml(pagina, leer(web, pagina), web), [], pagina);
    }
    // Volver a preparar la web ya preparada no cambia nada.
    prepararGuion(web, TEMA);
    assert.equal(leer(web, 'demo/recorrido.html'), `<script src="../scripts/${nombre}"></script>`);
    assert.deepEqual(comprobarGuion(web, TEMA), []);
    // Unos bytes que no son los de su nombre no se admiten.
    writeFileSync(join(web, 'scripts', nombre), 'alterado();');
    assert.ok(comprobarGuion(web, TEMA).some((problema) => problema.includes('no corresponde a su fuente')));
    assert.ok(comprobarCspHtml('inicio.html', leer(web, 'inicio.html'), web).length > 0);
  });
});

test('otros bytes en la fuente cambian el nombre publicado y la referencia de todas las páginas', () => {
  assert.ok(TEMA);
  conWeb((web) => {
    prepararGuion(web, TEMA);
    const antes = publicado('tema();');
    writeFileSync(join(web, 'scripts/tema-inicial.js'), 'tema(2);');
    prepararGuion(web, TEMA);
    const despues = publicado('tema(2);');
    assert.notEqual(despues, antes);
    assert.equal(existsSync(join(web, 'scripts', antes)), false, 'la copia anterior se retira');
    for (const pagina of ['inicio.html', 'demo/recorrido.html', 'administracion/index.html']) {
      assert.ok(leer(web, pagina).includes(`scripts/${despues}"`), pagina);
      assert.ok(!leer(web, pagina).includes(antes), pagina);
    }
    assert.deepEqual(comprobarGuion(web, TEMA), []);
  });
});

test('la comprobación rechaza una página que cita otra copia o la carga dos veces', () => {
  assert.ok(TEMA);
  conWeb((web) => {
    prepararGuion(web, TEMA);
    const vieja = `tema-inicial-${'a'.repeat(DIGITOS_SHA256)}.js`;
    writeFileSync(join(web, 'demo/recorrido.html'), `<script src="../scripts/${vieja}"></script>`);
    assert.ok(comprobarGuion(web, TEMA).some((problema) => problema.startsWith('demo/recorrido.html: carga')));
    const nombre = publicado('tema();');
    writeFileSync(join(web, 'demo/recorrido.html'), `<script src="../scripts/${nombre}"></script>`.repeat(2));
    assert.ok(comprobarGuion(web, TEMA).some((problema) => problema.includes('una sola vez')));
    assert.throws(() => prepararGuion(web, TEMA), /demo\/recorrido\.html: debe cargar scripts\/tema-inicial\.js/);
  });
});

test('sin nada del guion en la web no se prepara ni se comprueba nada', () => {
  const web = mkdtempSync(join(tmpdir(), 'faro-guiones-sin-nada-'));
  try {
    writeFileSync(join(web, 'otra.html'), '<script type="module" src="scripts/sitio.js"></script>');
    prepararGuionesConHuella(web);
    assert.deepEqual(comprobarGuionesConHuella(web), []);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('en las fuentes no puede haber copias con huella ni páginas que las citen; las de web/ no las llevan', () => {
  assert.deepEqual(guionesConHuellaEnLasFuentes(WEB), []);
  conWeb((web) => {
    assert.deepEqual(guionesConHuellaEnLasFuentes(web), []);
    prepararGuion(web, TEMA ?? assert.fail());
    assert.deepEqual(
      guionesConHuellaEnLasFuentes(web).map((problema) => problema.split(':')[0]),
      [`scripts/${publicado('tema();')}`, 'administracion/index.html', 'demo/recorrido.html', 'inicio.html'],
    );
  });
});

test('las copias con huella siguen siendo guiones clásicos: sin empaquetar, fuera del mapa y con CORS', () => {
  for (const { fuente, prefijo } of CLASICOS_DE_LA_CABECERA) {
    const copia = `scripts/${prefijo}-${'b'.repeat(DIGITOS_SHA256)}.js`;
    for (const ruta of [fuente, copia]) {
      assert.equal(seEmpaqueta(ruta), false, ruta);
      assert.equal(esClasicoDeLaCabecera(ruta), true, ruta);
    }
    assert.deepEqual(modulosDeLaWeb([fuente, copia, 'scripts/sitio.js']), ['scripts/sitio.js']);
    assert.equal(esClasicoDeLaCabecera(`otra/${prefijo}-${'b'.repeat(DIGITOS_SHA256)}.js`), false);
  }
  assert.equal(esClasicoDeLaCabecera(`scripts/barrera-${'b'.repeat(DIGITOS_SHA256)}.js`), false);
});

test('el inicio animado se publica como clásico con huella solo en Inicio', () => {
  const guion = CLASICOS_DE_LA_CABECERA.find(({ fuente }) => fuente === 'scripts/inicio-animacion-inicial.js');
  assert.ok(guion);
  assert.deepEqual([...(guion.paginas ?? [])], ['inicio.html']);
  const web = mkdtempSync(join(tmpdir(), 'faro-inicio-huella-'));
  try {
    mkdirSync(join(web, 'scripts'));
    writeFileSync(join(web, guion.fuente), 'inicio();');
    writeFileSync(join(web, 'inicio.html'), '<script src="scripts/inicio-animacion-inicial.js"></script>');
    prepararGuion(web, guion);
    assert.match(readFileSync(join(web, 'inicio.html'), 'utf8'), /scripts\/inicio-animacion-inicial-[a-f0-9]{64}\.js/);
    assert.deepEqual(comprobarGuion(web, guion), []);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});
