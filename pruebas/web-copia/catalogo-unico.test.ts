// El CATALOGO único (servicio-publicado.ts): una entrada por ruta, con su huella SHA-256 y su clase. Es la inversa
// exacta de las listas que calcula la preparación, no admite una ruta en dos listas que se excluyen (la rama que
// filtraba lo comprobado de BAJO_DEMANDA no tiene caso) y ningún JS de la copia va sin huella.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CatalogoImposible,
  catalogoDeListas,
  type ListasDelCatalogo,
  listasDelCatalogo,
  valoresDelServicio,
} from '../../herramientas/web/servicio/servicio-publicado.ts';
import { servicioPublicado } from '../ayudas/web-construida.ts';

const CIFRAS_SHA256 = 64;
const H = 'a'.repeat(CIFRAS_SHA256);
const G = 'b'.repeat(CIFRAS_SHA256);
const CATALOGO = valoresDelServicio(servicioPublicado()).CATALOGO;

test('el CATALOGO publicado es el de sus propias listas, entrada a entrada y en su orden', () => {
  assert.deepEqual(catalogoDeListas(listasDelCatalogo(CATALOGO)), CATALOGO);
  assert.equal(new Set(CATALOGO.map(([ruta]) => ruta)).size, CATALOGO.length);
});

test('ningún JS de la copia va sin huella', () => {
  const js = CATALOGO.filter(([ruta]) => /\.m?js$/u.test(ruta));
  assert.ok(js.length > 0);
  assert.ok(js.every(([, huella]) => /^[0-9a-f]{64}$/u.test(huella)));
});

test('una página de una sección se precarga, y su huella es la de la sección', () => {
  const catalogo = catalogoDeListas({
    ARCHIVOS: ['biblioteca.html', 'tipografias/sora.woff2', 'inicio.html'],
    BAJO_DEMANDA: ['imagenes/fotografias/casa.webp'],
    PAGINAS_DE_SECCIONES: [
      ['biblioteca.html', G],
      ['activar-acceso.html', G],
    ],
    HUELLAS_DE_ARCHIVOS: [
      ['biblioteca.html', G],
      ['tipografias/sora.woff2', H],
      ['inicio.html', H],
      ['imagenes/fotografias/casa.webp', H],
    ],
    COMPROBADOS: [['motor/motor.js', H]],
  });
  assert.deepEqual(catalogo, [
    ['biblioteca.html', G, 'seccion'],
    ['tipografias/sora.woff2', H, 'adorno'],
    ['inicio.html', H, 'instalar'],
    ['imagenes/fotografias/casa.webp', H, 'demanda'],
    ['activar-acceso.html', G, 'seccion'],
    ['motor/motor.js', H, 'comprobado'],
  ]);
});

test('una ruta en dos listas que se excluyen, sin huella o con una huella que sobra, o una sección que adorna o que falta en ARCHIVOS no caben', () => {
  const vacias = { ARCHIVOS: [], BAJO_DEMANDA: [], PAGINAS_DE_SECCIONES: [], HUELLAS_DE_ARCHIVOS: [], COMPROBADOS: [] };
  const casos: ListasDelCatalogo[] = [
    {
      ...vacias,
      BAJO_DEMANDA: ['motor/motor.js'],
      HUELLAS_DE_ARCHIVOS: [['motor/motor.js', H]],
      COMPROBADOS: [['motor/motor.js', H]],
    },
    { ...vacias, ARCHIVOS: ['a.html'], BAJO_DEMANDA: ['a.html'], HUELLAS_DE_ARCHIVOS: [['a.html', H]] },
    { ...vacias, ARCHIVOS: ['a.js'] },
    { ...vacias, ARCHIVOS: ['imagenes/a.html'], PAGINAS_DE_SECCIONES: [['imagenes/a.html', H]] },
    {
      ...vacias,
      COMPROBADOS: [
        ['a.js', H],
        ['a.js', G],
      ],
    },
  ];
  for (const listas of casos) {
    assert.throws(() => catalogoDeListas(listas), CatalogoImposible, JSON.stringify(listas));
  }
  const motivos: [ListasDelCatalogo, RegExp][] = [
    [{ ...vacias, PAGINAS_DE_SECCIONES: [['biblioteca.html', H]] }, /entra en la copia y no está en ARCHIVOS/],
    [
      {
        ...vacias,
        ARCHIVOS: ['a.html'],
        HUELLAS_DE_ARCHIVOS: [
          ['a.html', H],
          ['b.html', H],
        ],
      },
      /sobra o repite: b\.html/,
    ],
    [
      {
        ...vacias,
        ARCHIVOS: ['a.html'],
        HUELLAS_DE_ARCHIVOS: [
          ['a.html', H],
          ['a.html', G],
        ],
      },
      /una ruta repetida/,
    ],
  ];
  for (const [listas, motivo] of motivos) {
    assert.throws(() => catalogoDeListas(listas), motivo);
  }
});
