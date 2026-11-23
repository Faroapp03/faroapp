// Ninguna nota de trabajo dentro del producto: las tareas abiertas y los avisos para el equipo van a Desarrollo.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { archivosDelProducto, type NotaDeTrabajo, notasDelTexto, notasDeTrabajo } from '../ayudas/notas-de-trabajo.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const lineas = (archivo: string, texto: string) => notasDelTexto(archivo, texto).map((nota) => nota.texto);
const REGLA = 'Las notas de trabajo van a Desarrollo; el producto solo explica su organización y su funcionamiento';

function informe(notas: readonly NotaDeTrabajo[]): string {
  return `${REGLA}:\n${notas.map(({ archivo, linea, texto }) => `  ${archivo}:${linea}: ${texto}`).join('\n')}`;
}

test('el producto no contiene notas de trabajo en código, documentos ni configuración', () => {
  const notas = notasDeTrabajo(RAIZ);
  assert.deepEqual(notas, [], informe(notas));
});

test('la guardia lee el producto propio y deja fuera dependencias, generados y textos ajenos', () => {
  const archivos = archivosDelProducto(RAIZ);
  for (const esperado of ['README.md', 'package.json', 'src/api/api.ts', 'pruebas/README.md', 'pyproject.toml']) {
    assert.ok(archivos.includes(esperado), esperado);
  }
  assert.ok(archivos.some((archivo) => archivo.startsWith('plataforma_datos/') && archivo.endsWith('.py')));
  for (const ajeno of ['node_modules/', '.venv/', 'datos/', 'web/terceros/', 'web/motor/', 'pruebas/fixtures/']) {
    assert.ok(!archivos.some((archivo) => archivo.startsWith(ajeno)), ajeno);
  }
});

test('en las pruebas de JS y TS solo cuentan los comentarios con forma de nota', () => {
  const codigo = [
    '// Pendiente: revisar las paráfrasis',
    "const TODO = 'todo';",
    "const aviso = 'FIXME: dentro de una cadena';",
    'const patron = /\\/\\/ HACK/u;',
    ['const plantilla = `$', '{aviso} // XXX: dentro de una plantilla`;'].join(''),
    '/** Devuelve las etapas o TODO, en su orden. */',
    '/*',
    ' * FIXME revisar el plazo',
    ' */',
    'const resto = 1; // HACK(equipo): atajo',
  ].join('\n');
  assert.deepEqual(lineas('pruebas/modulo.test.ts', codigo), [
    '// Pendiente: revisar las paráfrasis',
    '* FIXME revisar el plazo',
    '// HACK(equipo): atajo',
  ]);
});

test('en Python cuentan los comentarios y los docstrings, no las cadenas', () => {
  const codigo = [
    '"""Módulo de ejemplo.',
    '',
    'TODO: documentar la salida.',
    '"""',
    "ETAPA = 'XXX: no es una nota'",
    '# FIXME: cambiar el plazo',
    'valor = 1  # Pendiente: medir',
    'texto = "# HACK: dentro de una cadena"',
  ].join('\n');
  assert.deepEqual(lineas('modulo.py', codigo), [
    'TODO: documentar la salida.',
    '# FIXME: cambiar el plazo',
    '# Pendiente: medir',
  ]);
});

test('en los documentos y la configuración cuenta todo el texto', () => {
  const documento = ['# Guía', '', 'TODO: completar.', 'Elige una etapa o TODO el recorrido.', '<!-- HACK: oculto -->'];
  assert.deepEqual(lineas('guia.md', documento.join('\n')), ['TODO: completar.', '<!-- HACK: oculto -->']);
  assert.deepEqual(notasDelTexto('ajustes.toml', '# PENDIENTE: fijar la versión\nversion = 1').length, 1);
});

test('un árbol con una nota en el producto falla y otra en una dependencia no cuenta', (t) => {
  const raiz = mkdtempSync(join(tmpdir(), 'Notas de trabajo Año 2026 '));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  mkdirSync(join(raiz, 'src'));
  mkdirSync(join(raiz, 'node_modules'));
  writeFileSync(join(raiz, 'src', 'modulo.ts'), 'export const UNO = 1;\n// Pendiente: revisar\n');
  writeFileSync(join(raiz, 'node_modules', 'ajeno.js'), '// TODO: de terceros\n');
  assert.deepEqual(notasDeTrabajo(raiz), [{ archivo: 'src/modulo.ts', linea: 2, texto: '// Pendiente: revisar' }]);
});

test('las notas de revisión en prosa cuentan, también dentro de JSON; el vocabulario de dominio no', () => {
  const pendiente = ['Pendiente', 'de revisión humana.'].join(' ');
  const json = [
    '{',
    `  "fuente": "Lista propia. ${pendiente}",`,
    `  "nombres": [{ "nombre": "plomero", "fuente": "DLE, plomero (${['de', 'memoria'].join(' ')}, por ${'verificar'})" }],`,
    '  "estado": "pendiente de confirmación",',
    '  "nota": "Las fichas sin revisar se muestran aparte."',
    '}',
  ].join('\n');
  assert.equal(lineas('datos.json', json).length, 2);
  const codigo = [
    `// sin mirar el banco; está ${'pendiente'} de revisar la clase CNAE`,
    `// La revisión humana ${'pendiente'} queda fuera`,
    '// Los almacenes de memoria se vacían al cerrar la página.',
    "const estado = 'pendiente de confirmación';",
  ].join('\n');
  assert.equal(lineas('modulo.ts', codigo).length, 2);
});

test('en JS y TS del producto cuentan también las notas dentro de cadenas y plantillas, no los estados de interfaz', () => {
  const codigo = [
    "const fuente = 'Paráfrasis llanas de los títulos oficiales (revisión humana pendiente).';",
    ['const aviso = `Hola, $', '{nombre}. TODO: completar el saludo`;'].join(''),
    "const cita = 'Plomero (de memoria, por verificar)';",
    "const invitada = 'Pendiente de activación';",
    "const confirmar = 'Pendiente de confirmar';",
    "const estado = 'pendiente de confirmación';",
    "const fichas = 'Las fichas sin revisar se muestran aparte.';",
    "const constante = 'TODO';",
  ].join('\n');
  assert.deepEqual(lineas('src/textos.ts', codigo), [
    'Paráfrasis llanas de los títulos oficiales (revisión humana pendiente).',
    '. TODO: completar el saludo',
    'Plomero (de memoria, por verificar)',
    'TODO',
  ]);
  assert.deepEqual(lineas('pruebas/textos.test.ts', codigo), []);
  assert.deepEqual(lineas('motores/cursos/pruebas/textos.test.ts', codigo), []);
});

test('una fecha con hora de trabajo cuenta en comentarios y docstrings, no en datos, documentos ni cadenas', () => {
  const codigo = [
    '/** Nombres anteriores (hasta las 02:58 del 19/10), aceptados por compatibilidad. */',
    '// Medido el 19/10 hacia las 03:10 con el banco completo.',
    '// Ajustado el 18/10/2026 a las 09:00.',
    '// La copia de datos se publica a las 06:00 cada día.',
    "const consulta = 'hasta las 02:58 del 19/10';",
  ].join('\n');
  assert.deepEqual(lineas('src/modulo.ts', codigo), [
    '/** Nombres anteriores (hasta las 02:58 del 19/10), aceptados por compatibilidad. */',
    '// Medido el 19/10 hacia las 03:10 con el banco completo.',
    '// Ajustado el 18/10/2026 a las 09:00.',
  ]);
  const python = [
    '"""Instala dos actividades admitidas, capturadas el 23/10 a las 21:00."""',
    '# Revisado el 18/10/2026 a las 09:00.',
  ].join('\n');
  assert.deepEqual(lineas('plataforma_datos/modulo.py', python), ['# Revisado el 18/10/2026 a las 09:00.']);
  assert.deepEqual(lineas('datos/procedencia.json', '{ "consultado": "el 18/10/2026 a las 09:00" }'), []);
  assert.deepEqual(lineas('docs/fuentes.md', 'Consultado el 18/10/2026 a las 09:00, hasta las 10:00 del 18/10.'), []);
});
