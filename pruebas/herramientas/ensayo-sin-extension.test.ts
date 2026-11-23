// El ensayo de la retirada de una extensión actúa solo sobre su copia, retira exactamente la carpeta y la línea que
// salen del registro, detecta lo servido que la nombra, elige la extensión y exige el banco cuando se pide. Se
// comprueba sobre raíces sintéticas y con una extensión sintética, sin construir ni verificar.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import {
  destinoDelEnsayo,
  elegirExtension,
  ensayoCorrecto,
  fugasDeLaExtension,
  PASOS_DE_COMPROBACION,
  pasosDeConstruccion,
  prepararCopia,
  retirable,
  retirarExtension,
} from '../../scripts/ensayo-sin-extension.ts';

/** Cifras hexadecimales de una revisión de Git. */
const REVISION_HEX = 40;
const EJEMPLO = { id: 'ejemplo', entrada: 'ejemplo/recorrido.html' };
const OTRA = { id: 'otra', entrada: 'otra/recorrido.html' };
const LINEA = "export { EJEMPLO } from '../../web/ejemplo/servidor/extension.ts';";
const LINEA_OTRA = "export { OTRA } from '../../web/otra/servidor/extension.ts';";
const REGISTRO = 'src/plataforma/extensiones-instaladas.ts';

function escribir(raiz: string, ruta: string, contenido: string): void {
  mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
  writeFileSync(join(raiz, ruta), contenido);
}

/** Cada archivo de una carpeta con la huella de su contenido. */
function huellas(carpeta: string): Map<string, string> {
  const lista = readdirSync(carpeta, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  return new Map(
    lista.map((e) => {
      const ruta = join(e.parentPath, e.name);
      return [relative(carpeta, ruta), createHash('sha256').update(readFileSync(ruta)).digest('hex')];
    }),
  );
}

function conTemporal(prueba: (temporal: string) => void): void {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'ensayo-sin-extension-'));
  try {
    prueba(temporal);
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}

function raizSintetica(temporal: string): string {
  const raiz = join(temporal, 'instalación de origen');
  escribir(raiz, REGISTRO, `/** Registro. */\n${LINEA}\n${LINEA_OTRA}\nexport {};\n`);
  escribir(raiz, 'web/ejemplo/recorrido.html', '<!doctype html>');
  escribir(raiz, 'web/ejemplo/servidor/extension.ts', 'export {};\n');
  escribir(raiz, 'web/otra/servidor/extension.ts', 'export {};\n');
  escribir(raiz, 'web/ejemplos/index.html', '<!doctype html>');
  escribir(raiz, 'web/index.html', '<!doctype html>');
  escribir(raiz, 'package.json', '{}\n');
  escribir(raiz, 'dist/artefacto.json', '{}\n');
  return raiz;
}

test('los pasos del ensayo van en su orden: los comunes antes de preparar la web y la numeración seguida', () => {
  const revision = 'a'.repeat(REVISION_HEX);
  const construccion = pasosDeConstruccion('/copia', revision);
  assert.deepEqual(construccion, [
    ['1-comunes', ['npm', 'run', 'comunes:generar']],
    ['2-web-preparar', ['npm', 'run', 'web:preparar']],
    [
      '3-construir',
      ['npm', 'run', 'construir', '--', '--revision-codigo', revision, '--destino', join('/copia', 'dist')],
    ],
  ]);
  assert.deepEqual(Object.values(PASOS_DE_COMPROBACION), [
    '4-verificar',
    '5-fugas',
    '6-navegadores',
    '7-sello',
    '8-banco',
  ]);
  const numeros = [...construccion.map(([nombre]) => nombre), ...Object.values(PASOS_DE_COMPROBACION)].map((nombre) =>
    Number(nombre.split('-')[0]),
  );
  assert.deepEqual(
    numeros,
    numeros.map((_, indice) => indice + 1),
  );
});

test('retira exactamente la carpeta y la línea del registro de la extensión, y solo en la copia', () => {
  conTemporal((temporal) => {
    const raiz = raizSintetica(temporal);
    const antes = huellas(raiz);
    const copia = prepararCopia(raiz, join(temporal, 'ensayo'));
    const extension = retirable(EJEMPLO);
    assert.deepEqual(retirarExtension(copia, raiz, extension), {
      carpeta: 'web/ejemplo',
      registro: REGISTRO,
      linea: LINEA,
    });
    assert.deepEqual(huellas(raiz), antes);
    const esperadas = [...antes].filter(([ruta]) => !ruta.startsWith('web/ejemplo/') && !ruta.startsWith('dist/'));
    const despues = huellas(copia);
    assert.deepEqual([...despues.keys()].sort(), esperadas.map(([ruta]) => ruta).sort());
    for (const [ruta, huella] of esperadas.filter(([ruta]) => ruta !== REGISTRO)) {
      assert.equal(despues.get(ruta), huella, ruta);
    }
    assert.equal(readFileSync(join(copia, REGISTRO), 'utf8'), `/** Registro. */\n${LINEA_OTRA}\nexport {};\n`);
    assert.throws(() => retirarExtension(copia, raiz, extension), /no tiene la carpeta web\/ejemplo/);
    escribir(copia, 'web/ejemplo/servidor/extension.ts', 'export {};\n');
    assert.throws(() => retirarExtension(copia, raiz, extension), /exactamente una línea que exporte web\/ejemplo/);
    escribir(copia, REGISTRO, `${LINEA}\n${LINEA}\n`);
    assert.throws(() => retirarExtension(copia, raiz, extension), /exactamente una línea/);
  });
});

test('rechaza un destino dentro de la instalación o que la contenga, y no retira en el origen', () => {
  conTemporal((temporal) => {
    const raiz = raizSintetica(temporal);
    const antes = huellas(raiz);
    assert.throws(() => prepararCopia(raiz, join(raiz, 'ensayo')), /no puede estar dentro de la instalación/);
    assert.throws(() => prepararCopia(raiz, raiz), /no puede estar dentro de la instalación/);
    assert.throws(() => destinoDelEnsayo(raiz, temporal), /no puede estar dentro de la instalación/);
    assert.throws(() => retirarExtension(raiz, raiz, retirable(EJEMPLO)), /solo se ensaya en una copia aparte/);
    escribir(temporal, 'ocupado/archivo.txt', 'x');
    assert.throws(() => destinoDelEnsayo(raiz, join(temporal, 'ocupado')), /no es una carpeta vacía/);
    assert.deepEqual(huellas(raiz), antes);
  });
});

test('lo servido que nombra la extensión es una fuga, salvo el aviso heredado del panel', () => {
  conTemporal((temporal) => {
    const dist = join(temporal, 'dist');
    escribir(dist, 'web/index.html', '<script type="importmap">{"./ejemplo/recorrido.js": "sha384-x"}</script>');
    escribir(dist, 'web/idiomas/es/recorrido.js', "export const T = { 'comun.menu.recorrido.ejemplo': 'Ej.' };");
    escribir(dist, 'web/ejemplo/panel/index.html', '<!doctype html>');
    escribir(dist, 'web/administracion/vista-recorrido.js', "c.texto('panel.recorrido.ejemplo-retirada')");
    escribir(dist, 'web/idiomas/es/panel-recorrido.js', "'panel.recorrido.ejemplo-retirada': 'Aviso'");
    escribir(dist, 'web/ejemplos/index.html', 'export const ejemplos = 1;');
    escribir(dist, 'web/imagen.png', '/ejemplo/');
    const extension = retirable(EJEMPLO);
    const fugas = fugasDeLaExtension(dist, extension);
    assert.deepEqual(
      fugas.map((fuga) => fuga.slice(0, fuga.indexOf(':'))),
      ['web/ejemplo/panel/index.html', 'web/idiomas/es/recorrido.js', 'web/index.html'],
      fugas.join('\n'),
    );
    escribir(dist, 'web/administracion/js/pagina-1a2b.js', 'e.texto("panel.recorrido.ejemplo-retirada")');
    escribir(dist, 'web/idiomas/ca.js', '{"panel.recorrido.ejemplo-retirada":"Avís"}');
    assert.deepEqual(fugasDeLaExtension(dist, extension), fugas, 'el aviso heredado empaquetado no es una fuga');
    escribir(dist, 'web/scripts/fuga.js', "c.texto('panel.recorrido.ejemplo-retirada')");
    escribir(
      dist,
      'web/idiomas/es.js',
      '{"panel.recorrido.ejemplo-retirada":"A","panel.recorrido.ejemplo":"B","otra.ejemplo-retirada":"C"}',
    );
    const nuevas = fugasDeLaExtension(dist, extension).filter((fuga) => !fugas.includes(fuga));
    assert.deepEqual(
      nuevas.map((fuga) => fuga.slice(0, fuga.indexOf(':'))),
      ['web/idiomas/es.js', 'web/idiomas/es.js', 'web/scripts/fuga.js'],
      'fuera del panel y de los idiomas, o junto a la clave heredada, sí es una fuga',
    );
    assert.deepEqual(fugasDeLaExtension(dist, retirable(OTRA)), []);
  });
});

test('elige la extensión pedida o la única instalada, y sin ninguna termina con error', () => {
  assert.deepEqual(elegirExtension([EJEMPLO, OTRA], 'otra'), { extension: { id: 'otra', carpeta: 'web/otra' } });
  assert.deepEqual(elegirExtension([EJEMPLO]), {
    extension: { id: 'ejemplo', carpeta: 'web/ejemplo' },
    aviso: 'Se ensaya la retirada de la única extensión instalada, «ejemplo».',
  });
  assert.throws(() => elegirExtension([]), /No hay ninguna extensión instalada/);
  assert.throws(() => elegirExtension([], 'ejemplo'), /No hay ninguna extensión instalada/);
  assert.throws(() => elegirExtension([EJEMPLO, OTRA]), /varias extensiones instaladas \(ejemplo, otra\)/);
  assert.throws(() => elegirExtension([EJEMPLO], 'otra'), /«otra» no está instalada; las instaladas son: ejemplo/);
  assert.throws(() => retirable({ id: 'suelta', entrada: 'suelta.html' }), /no tiene su entrada/);
});

test('con el banco pedido, el ensayo solo pasa si la medición existe y coincide con la referencia', () => {
  const base = { construida: true, pasos: [{ salida: 0 }], fugas: [], bancoPedido: true } as const;
  assert.equal(ensayoCorrecto({ ...base, banco: { coincide: true } }), true);
  assert.equal(ensayoCorrecto(base), false, 'sin medicion.json');
  assert.equal(ensayoCorrecto({ ...base, banco: undefined }), false, 'sin medicion.json');
  assert.equal(ensayoCorrecto({ ...base, banco: { coincide: false } }), false, 'medición distinta');
  assert.equal(ensayoCorrecto({ ...base, bancoPedido: false }), true, 'banco no pedido');
  assert.equal(ensayoCorrecto({ ...base, bancoPedido: false, construida: false }), false);
  assert.equal(ensayoCorrecto({ ...base, bancoPedido: false, pasos: [{ salida: 0 }, { salida: 1 }] }), false);
  assert.equal(ensayoCorrecto({ ...base, bancoPedido: false, pasos: [{ salida: null }] }), false);
  assert.equal(ensayoCorrecto({ ...base, bancoPedido: false, fugas: ['web/index.html: …'] }), false);
});
