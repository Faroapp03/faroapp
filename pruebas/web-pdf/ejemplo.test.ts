import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { colocarInforme, informeDelEjemplo } from '../../herramientas/web/informe-ejemplo.ts';
import { comprobarPagina } from '../../herramientas/web/paginas.ts';

test('el ejemplo público corresponde al caso ficticio construido con los datos actuales', () => {
  const pagina = readFileSync(new URL('../../web/informe-ejemplo.html', import.meta.url), 'utf8');
  const versiones = { es: informeDelEjemplo('es'), ca: informeDelEjemplo('ca') };
  for (const idioma of ['es', 'ca'] as const) {
    const informe = versiones[idioma];
    const ficticio = idioma === 'es' ? 'Ejemplo ficticio' : 'Exemple fictici';
    assert.doesNotMatch(informe, /id="descargar"/u);
    assert.match(informe, /class="informe-breve"/u);
    assert.match(informe, new RegExp(`lang="${idioma}"`));
    assert.equal((informe.match(/<h1\b/gu) ?? []).length, 1);
    assert.ok(informe.includes(`<h2>${idioma === 'es' ? 'Tu mercado laboral' : 'El teu mercat laboral'}</h2>`));
    assert.match(informe, /<h3 class="ib-seccion"/u);
    assert.equal((informe.match(/class="hoja ib"/gu) ?? []).length, 2);
    assert.equal(informe.split(`<b>${ficticio}</b>`).length - 1, 2);
    assert.ok(informe.includes(`data-titulo-pdf="${ficticio}`));
    assert.match(informe, /data-marca-ia="/u);
    assert.match(informe, /id="imprimir"/u);
    // La presentación actual usa las piezas del informe breve, no la antigua franja interactiva.
    for (const clase of ['franja', 'grupos', 'semana', 'segmento', 'tarjetas', 'tarjeta']) {
      assert.doesNotMatch(informe, new RegExp(`class="(?:[^"]*\\s)?${clase}(?:\\s[^"]*)?"`, 'u'));
    }
    assert.doesNotMatch(informe, /id="tooltip"/u);
    assert.match(informe, /data-ancho="/u);
    assert.match(informe, /id="borrar"/u);
  }
  assert.equal(colocarInforme(pagina, versiones.es, versiones.ca), pagina);
  assert.deepEqual(comprobarPagina('informe-ejemplo.html', pagina.replace(/<!--[\s\S]*?-->/gu, '')), []);
});

test('regenerar el ejemplo conserva las cabeceras, navegación y recursos exteriores al informe', () => {
  const prefijo = '<!doctype html><head>integridad</head><body><nav>navegación</nav>';
  const sufijo = '<footer>atribución</footer><script src="informe-ejemplo.js"></script></body>';
  const anterior = '<main id="contenido" class="esencial"><p>Anterior</p></main>';
  const nuevo = '<main id="contenido"><p>Nuevo</p></main>';
  const catalan = '<main id="contenido"><p>Nou</p></main>';
  const pagina = colocarInforme(prefijo + anterior + sufijo, nuevo, catalan);
  assert.ok(pagina.startsWith(prefijo + nuevo));
  assert.ok(pagina.endsWith(sufijo));
  assert.ok(pagina.includes(`<template id="informe-ejemplo-ca">${catalan}</template>`));
  assert.equal(colocarInforme(pagina, nuevo, catalan), pagina);
});

for (const pagina of ['<article>Sin informe</article>', '<main id="contenido"><p>Incompleto</p>']) {
  test(`no publica sobre una envoltura defectuosa: ${pagina}`, () => {
    assert.throws(
      () => colocarInforme(pagina, '<main id="contenido"></main>', '<main id="contenido"></main>'),
      /main completo/u,
    );
  });
}
