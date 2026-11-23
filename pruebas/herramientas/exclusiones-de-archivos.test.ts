// El subconjunto de exclusiones admitido: rutas, anclajes, comodines y errores explícitos.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exclusionesDeArchivos, PatronDeExclusionNoAdmitido } from '../../src/comun/exclusiones-de-archivos.ts';

interface CasoExclusiones {
  patron: string;
  excluidas: string[];
  publicadas: string[];
}

const CASOS: CasoExclusiones[] = [
  {
    patron: '*.md',
    excluidas: ['README.md', 'carpeta/README.md', 'README.md/archivo.js'],
    publicadas: ['README.md.js', 'carpeta/archivo.js'],
  },
  {
    patron: '/solo.js',
    excluidas: ['solo.js', 'solo.js/archivo'],
    publicadas: ['carpeta/solo.js', 'otro.js'],
  },
  {
    patron: 'pruebas/',
    excluidas: ['pruebas/uno.js', 'carpeta/pruebas/uno.js'],
    publicadas: ['pruebas-falso/uno.js', 'pruebas.js'],
  },
  {
    patron: 'terceros/noble/**/*.d.ts',
    excluidas: ['terceros/noble/tipo.d.ts', 'terceros/noble/hash/tipo.d.ts', 'terceros/noble/uno/dos/tipo.d.ts'],
    publicadas: ['terceros/noble/tipo.ts', 'terceros/otro/tipo.d.ts', 'otra/terceros/noble/tipo.d.ts'],
  },
  {
    patron: 'carpeta/**',
    excluidas: ['carpeta/uno.js', 'carpeta/uno/dos.js'],
    publicadas: ['otra/carpeta/uno.js', 'carpetas/uno.js'],
  },
  {
    patron: 'pregunta?.js',
    excluidas: ['pregunta1.js', 'otra/pregunta2.js'],
    publicadas: ['pregunta.js', 'pregunta12.js', 'pregunta/.js'],
  },
  {
    patron: 'archivo+(1).json',
    excluidas: ['archivo+(1).json', 'carpeta/archivo+(1).json'],
    publicadas: ['archivo1.json', 'archivo+(1)Xjson'],
  },
];

for (const { patron, excluidas, publicadas } of CASOS) {
  test(`«${patron}» conserva anclaje y alcance de sus comodines`, () => {
    const patrones = exclusionesDeArchivos(patron);
    for (const ruta of excluidas) {
      assert.equal(
        patrones.some((expresion) => expresion.test(ruta)),
        true,
        ruta,
      );
    }
    for (const ruta of publicadas) {
      assert.equal(
        patrones.some((expresion) => expresion.test(ruta)),
        false,
        ruta,
      );
    }
  });
}

test('se omiten comentarios y líneas vacías, y se conservan orden y saltos CRLF', () => {
  const patrones = exclusionesDeArchivos(' # comentario\r\n\r\n *.md \r\n/solo.js\r\n');
  assert.deepEqual(
    patrones.map(String),
    [...exclusionesDeArchivos('*.md'), ...exclusionesDeArchivos('/solo.js')].map(String),
  );
  assert.deepEqual(exclusionesDeArchivos(' \r\n# comentario'), []);
});

test('la sintaxis fuera del subconjunto admitido falla antes de decidir qué publicar', () => {
  for (const patron of ['!secreto.js', '[abc].js', 'ruta\\nombre', 'ruta\0nombre', 'ruta\u0001nombre']) {
    assert.throws(() => exclusionesDeArchivos(patron), PatronDeExclusionNoAdmitido);
  }
});

test('un doble asterisco fuera de un tramo completo se rechaza en vez de cruzar carpetas', () => {
  for (const patron of ['a**b', 'a/**b', 'a**/b', '***', 'a/***/b']) {
    assert.throws(() => exclusionesDeArchivos(patron), PatronDeExclusionNoAdmitido);
  }
});
