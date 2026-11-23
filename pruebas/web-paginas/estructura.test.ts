// La estructura y la accesibilidad básica de una página (herramientas/web/paginas.ts, comprobarPagina) sobre HTML
// sintético: una página correcta no da avisos y cada fallo, uno a uno, da el suyo.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarPagina } from '../../herramientas/web/paginas.ts';

/** Una página que cumple todo; cada caso le cambia una sola cosa. */
const CORRECTA = [
  '<!doctype html><html lang="es"><head><title>Faro</title></head>',
  '<body><a class="salto" href="#contenido">Saltar al contenido</a>',
  '<main id="contenido"><h1>Faro</h1>',
  '<label for="nombre">Nombre</label><input id="nombre" type="text">',
  '<label>Correo <input type="email"></label>',
  '<input type="hidden" name="x"><img src="a.png" alt="">',
  '<p id="ayuda" aria-describedby="nombre">Ayuda</p>',
  '</main></body></html>',
].join('\n');

/**
 * Los problemas de la página correcta con un cambio.
 *
 * @param antes - El texto que se sustituye (tiene que estar en la página).
 * @param despues - Lo que lo sustituye.
 * @returns Los problemas que da comprobarPagina.
 */
function conCambio(antes: string, despues: string): string[] {
  assert.ok(CORRECTA.includes(antes), antes);
  return comprobarPagina('p.html', CORRECTA.replace(antes, despues));
}

test('la página correcta no da ningún aviso', () => {
  assert.deepEqual(comprobarPagina('p.html', CORRECTA), []);
  assert.deepEqual(conCambio('<html lang="es">', '<html lang="es" data-tema="oscuro">'), []);
});

test('cada fallo da su aviso', () => {
  const casos: [antes: string, despues: string, aviso: string][] = [
    ['<html lang="es">', '<html lang="en">', 'falta <html lang="es">'],
    ['<h1>Faro</h1>', '<h1>Faro</h1><h1>Otra</h1>', 'tiene 2 h1'],
    ['<h1>Faro</h1>', '<h2>Faro</h2>', 'tiene 0 h1'],
    ['</main>', '</main><main></main>', 'tiene 2 <main>'],
    ['<a class="salto" href="#contenido">Saltar al contenido</a>', '', 'no es lo primero de <body>'],
    ['href="#contenido"', 'href="#otro"', 'apunta a #otro, que no existe'],
    ['<main id="contenido">', '<main id="contenido" hidden>', 'apunta a un elemento oculto'],
    ['<title>Faro</title>', '<title> </title>', 'el <title> está vacío'],
    ['<title>Faro</title>', '<title>Faro</title><title>Otra</title>', 'tiene 2 <title>'],
    ['id="ayuda"', 'id="nombre"', 'el id «nombre» está repetido'],
    ['aria-describedby="nombre"', 'aria-describedby="nadie"', 'aria-describedby="nadie" en <p>'],
    ['<label for="nombre">Nombre</label>', '', 'campo sin etiqueta'],
    ['alt=""', '', 'imagen sin alt'],
    ['</head>', '<meta name="apple-mobile-web-app-capable" content="yes"></head>', 'apple-mobile-web-app-capable'],
  ];
  for (const [antes, despues, aviso] of casos) {
    const problemas = conCambio(antes, despues);
    assert.ok(
      problemas.some((problema) => problema.includes(aviso)),
      `${antes} → ${despues}: ${problemas.join('; ')}`,
    );
  }
});

test('un id con puntuación se compara literalmente, sin aceptar otro destino', () => {
  const html = CORRECTA.replace('href="#contenido"', 'href="#contenido.1"').replace(
    'id="contenido"',
    'id="contenidoX1"',
  );
  assert.ok(comprobarPagina('p.html', html).some((problema) => problema.includes('que no existe')));
});

test('un id válido con corchetes no se interpreta como expresión regular', () => {
  const html = CORRECTA.replaceAll('contenido', 'contenido[1]');
  assert.deepEqual(comprobarPagina('p.html', html), []);
});

test('una versión inerte no duplica el main, el h1 ni los ids de la página activa', () => {
  const alternativa = '<template id="alternativa"><main id="contenido"><h1>Alternativa</h1></main></template>';
  assert.deepEqual(comprobarPagina('p.html', CORRECTA.replace('</body>', `${alternativa}</body>`)), []);
});

test('un id dentro de una plantilla no satisface una referencia de la página activa', () => {
  const html = CORRECTA.replace('aria-describedby="nombre"', 'aria-describedby="solo-plantilla"').replace(
    '</body>',
    '<template><p id="solo-plantilla">Ayuda inerte</p></template></body>',
  );
  assert.ok(comprobarPagina('p.html', html).some((aviso) => aviso.includes('aria-describedby="solo-plantilla"')));
});

test('las plantillas conservan controles de ids, nombres accesibles e imágenes', () => {
  const contenido = '<p id="repetido"></p><p id="repetido"></p><input><img src="a.png">';
  const html = CORRECTA.replace('</body>', `<template>${contenido}</template></body>`);
  const problemas = comprobarPagina('p.html', html);
  for (const aviso of ['id «repetido» está repetido', 'campo sin etiqueta', 'imagen sin alt']) {
    assert.ok(
      problemas.some((problema) => problema.includes(aviso)),
      problemas.join('; '),
    );
  }
});

test('las plantillas anidadas tienen ámbitos de ids distintos y se comprueban por separado', () => {
  const contenido = '<p id="contenido">Uno</p><template><p id="contenido">Dos</p><img src="a.png"></template>';
  const problemas = comprobarPagina('p.html', CORRECTA.replace('</body>', `<template>${contenido}</template></body>`));
  assert.equal(problemas.filter((aviso) => aviso.includes('imagen sin alt')).length, 1);
  assert.ok(problemas.every((aviso) => !aviso.includes('está repetido')));
});
