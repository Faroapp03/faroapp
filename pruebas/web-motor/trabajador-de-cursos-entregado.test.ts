/**
 * El Worker del motor local (web/scripts/motor-local/worker.js) entrega a crearMotorLocal el trabajador de cursos, y lo
 * crea con la dirección publicada de trabajador-de-cursos.js por la política de guiones (urlDeGuion). Sin él, el motor
 * calcularía Cursos en su propio hilo (src/plataforma/navegador/motor.ts). Se comprueba sobre el árbol sintáctico del
 * archivo, no sobre su texto, y sin depender de ningún navegador: Firefox no deja verlo desde fuera (cursos.ts).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'acorn';

const WORKER = new URL('../../web/scripts/motor-local/worker.js', import.meta.url);
/** La dirección publicada del trabajador de cursos, desde la raíz de la web (scripts/confianza.js, GUIONES_PROPIOS). */
const PUBLICADO = 'motor/src/plataforma/navegador/trabajador-de-cursos.js';
const RAIZ_DE_LA_WEB = new URL('../../web/', import.meta.url);

interface Nodo {
  readonly type: string;
  readonly [campo: string]: unknown;
}

function esNodo(valor: unknown): valor is Nodo {
  return typeof valor === 'object' && valor !== null && typeof (valor as { type?: unknown }).type === 'string';
}

/** Todos los nodos del árbol, en orden. */
function* nodos(raiz: unknown): Generator<Nodo> {
  if (Array.isArray(raiz)) {
    for (const hijo of raiz) {
      yield* nodos(hijo);
    }
    return;
  }
  if (!esNodo(raiz)) {
    return;
  }
  yield raiz;
  for (const [campo, valor] of Object.entries(raiz)) {
    if (campo !== 'type') {
      yield* nodos(valor);
    }
  }
}

const esIdentificador = (nodo: unknown, nombre: string) =>
  esNodo(nodo) && nodo.type === 'Identifier' && nodo.name === nombre;

/** El valor con que se declara `nombre` (const nombre = …), si hay exactamente una declaración. */
function declaracion(arbol: Nodo, nombre: string): Nodo {
  const halladas = [...nodos(arbol)].filter((n) => n.type === 'VariableDeclarator' && esIdentificador(n.id, nombre));
  assert.equal(halladas.length, 1, `Una sola declaración de ${nombre}`);
  const valor = halladas[0]?.init;
  assert(esNodo(valor), `${nombre} se declara con un valor`);
  return valor;
}

/** La dirección de TRABAJADOR_DE_CURSOS: new URL('<literal>', import.meta.url), desde la raíz de la web. */
function direccionDelTrabajador(arbol: Nodo): string {
  const valor = declaracion(arbol, 'TRABAJADOR_DE_CURSOS');
  assert(valor.type === 'NewExpression' && esIdentificador(valor.callee, 'URL'), 'TRABAJADOR_DE_CURSOS es una URL');
  const [ruta, base] = valor.arguments as Nodo[];
  assert(ruta?.type === 'Literal' && typeof ruta.value === 'string', 'La ruta es un literal');
  assert(base?.type === 'MemberExpression' && esNodo(base.object) && base.object.type === 'MetaProperty');
  assert(esIdentificador(base.property, 'url'), 'Relativa a import.meta.url');
  return new URL(ruta.value, WORKER).href.slice(RAIZ_DE_LA_WEB.href.length);
}

/** Que `valor` es () => new Worker(urlDeGuion(TRABAJADOR_DE_CURSOS), { type: 'module' }). */
function exigirCreacionDelTrabajador(valor: Nodo): void {
  assert(valor.type === 'ArrowFunctionExpression' && (valor.params as unknown[]).length === 0, 'Una función sin datos');
  const cuerpo = valor.body;
  assert(esNodo(cuerpo) && cuerpo.type === 'NewExpression' && esIdentificador(cuerpo.callee, 'Worker'), 'new Worker');
  const [direccion, opciones] = cuerpo.arguments as Nodo[];
  assert(direccion?.type === 'CallExpression' && esIdentificador(direccion.callee, 'urlDeGuion'), 'Por urlDeGuion');
  const [guion] = direccion.arguments as Nodo[];
  assert(esIdentificador(guion, 'TRABAJADOR_DE_CURSOS'), 'Con la dirección TRABAJADOR_DE_CURSOS');
  const tipo = (opciones?.properties as Nodo[] | undefined)?.find((p) => esIdentificador(p.key, 'type'));
  assert(esNodo(tipo?.value) && tipo.value.value === 'module', 'Un Worker de módulo');
}

/**
 * Lo que entrega worker.js a crearMotorLocal: la única llamada lleva, en sus opciones, la propiedad
 * trabajadorDeCursos sin condición, con el creador del trabajador publicado.
 */
function comprobarEntrega(codigo: string): void {
  const arbol = parse(codigo, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Nodo;
  assert.equal(direccionDelTrabajador(arbol), PUBLICADO, 'La dirección publicada del trabajador de cursos');
  const llamadas = [...nodos(arbol)].filter(
    (n) => n.type === 'CallExpression' && esIdentificador(n.callee, 'crearMotorLocal'),
  );
  assert.equal(llamadas.length, 1, 'Una sola llamada a crearMotorLocal');
  const [llamada] = llamadas;
  assert(llamada);
  const opciones = (llamada.arguments as Nodo[])[1];
  assert(opciones?.type === 'ObjectExpression', 'crearMotorLocal recibe sus opciones como objeto');
  const propiedad = (opciones.properties as Nodo[]).find(
    (p) => p.type === 'Property' && esIdentificador(p.key, 'trabajadorDeCursos'),
  );
  assert(propiedad, 'crearMotorLocal recibe trabajadorDeCursos sin condición');
  assert(esNodo(propiedad.value) && propiedad.value.type === 'Identifier', 'trabajadorDeCursos nombra su creador');
  exigirCreacionDelTrabajador(declaracion(arbol, String(propiedad.value.name)));
  const importacion = [...nodos(arbol)].find(
    (n) =>
      n.type === 'ImportDeclaration' && (n.specifiers as Nodo[]).some((s) => esIdentificador(s.imported, 'urlDeGuion')),
  );
  assert.equal((importacion?.source as Nodo | undefined)?.value, '../confianza.js', 'urlDeGuion es el de confianza.js');
}

test('worker.js entrega a crearMotorLocal el trabajador de cursos publicado', () => {
  comprobarEntrega(readFileSync(WORKER, 'utf8'));
});

test('la dirección del trabajador de cursos es un guion propio admitido por confianza.js', () => {
  const confianza = readFileSync(new URL('scripts/confianza.js', RAIZ_DE_LA_WEB), 'utf8');
  const arbol = parse(confianza, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Nodo;
  const guiones = declaracion(arbol, 'GUIONES_PROPIOS');
  const literales = [...nodos(guiones)].filter((n) => n.type === 'Literal').map((n) => n.value);
  assert(literales.includes(PUBLICADO), 'GUIONES_PROPIOS admite el trabajador de cursos');
});
