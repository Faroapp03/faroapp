// La declaración de accesibilidad solo puede nombrar una herramienta de evaluación que el proyecto usa de verdad: la
// que figura entre las dependencias de package.json. Se revisan la página y los textos de la declaración en los dos
// idiomas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';

const RAIZ = new URL('../../', import.meta.url);
const paquete = JSON.parse(readFileSync(new URL('package.json', RAIZ), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const DEPENDENCIAS = new Set(Object.keys({ ...paquete.dependencies, ...paquete.devDependencies }));

/** Herramientas de evaluación de accesibilidad conocidas: cómo se nombran y con qué paquetes se instalan. */
const HERRAMIENTAS: readonly { nombre: RegExp; paquetes: readonly string[] }[] = [
  { nombre: /\baxe(-core)?\b/i, paquetes: ['axe-core', '@axe-core/playwright', '@axe-core/cli'] },
  { nombre: /\bpa11y\b/i, paquetes: ['pa11y', 'pa11y-ci'] },
  { nombre: /\blighthouse\b/i, paquetes: ['lighthouse', '@lhci/cli'] },
  { nombre: /\bhtml_?codesniffer\b/i, paquetes: ['html_codesniffer'] },
  { nombre: /\bwave\b/i, paquetes: [] },
  { nombre: /\baccessibility insights\b/i, paquetes: [] },
  { nombre: /\bsiteimprove\b/i, paquetes: [] },
  { nombre: /\btenon\b/i, paquetes: [] },
  { nombre: /\barc toolkit\b/i, paquetes: [] },
  { nombre: /\bequal access\b|\baccessibility-checker\b/i, paquetes: ['accessibility-checker'] },
  { nombre: /\bqualweb\b/i, paquetes: ['@qualweb/core'] },
  { nombre: /\btaw\b/i, paquetes: [] },
  { nombre: /\basqatasun\b/i, paquetes: [] },
];

/** Las herramientas que nombra un texto sin tenerlas el proyecto entre sus dependencias. */
function sinRespaldo(texto: string): string[] {
  return HERRAMIENTAS.filter(
    ({ nombre, paquetes }) => nombre.test(texto) && !paquetes.some((paqueteNpm) => DEPENDENCIAS.has(paqueteNpm)),
  ).map(({ nombre }) => nombre.source);
}

/** Los textos de la declaración: la página sin comentarios y cada clave «accesibilidad.*» de los dos idiomas. */
function textosDeLaDeclaracion(): [string, string][] {
  const pagina = sinComentariosHtml(readFileSync(new URL('web/accesibilidad.html', RAIZ), 'utf8'));
  const claves = Object.entries({ es, ca }).flatMap(([idioma, diccionario]) =>
    Object.entries(diccionario as Record<string, string>)
      .filter(([clave]) => clave.startsWith('accesibilidad.'))
      .map(([clave, texto]): [string, string] => [`${idioma}:${clave}`, texto]),
  );
  return [['web/accesibilidad.html', pagina], ...claves];
}

test('la declaración de accesibilidad no nombra herramientas de evaluación que el proyecto no tiene', () => {
  const problemas = textosDeLaDeclaracion().flatMap(([origen, texto]) =>
    sinRespaldo(texto).map((herramienta) => `${origen}: ${herramienta}`),
  );
  assert.deepEqual(problemas, []);
});

test('la guardia reconoce una herramienta sin dependencia y acepta las que sí están instaladas', () => {
  assert.deepEqual(sinRespaldo('pruebas automáticas con axe-core en cada página'), [HERRAMIENTAS[0]?.nombre.source]);
  assert.deepEqual(sinRespaldo('comprobaciones automáticas de la estructura de cada página'), []);
  assert.deepEqual(sinRespaldo('Lighthouse y WAVE'), [HERRAMIENTAS[2]?.nombre.source, HERRAMIENTAS[4]?.nombre.source]);
});
