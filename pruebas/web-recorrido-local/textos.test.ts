// Los textos del motor local pertenecen al recorrido actual: claves, traducciones y recursos sin página alternativa.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { listaDelServicio } from '../../herramientas/web/copia-sin-conexion.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { TEXTOS_RECORRIDO as CA } from '../../web/idiomas/ca/recorrido.js';
import ca from '../../web/idiomas/ca.js';
import { TEXTOS_RECORRIDO as ES } from '../../web/idiomas/es/recorrido.js';
import es from '../../web/idiomas/es.js';
import { modulosDelMapa, webConstruida } from '../ayudas/web-construida.ts';

const WEB = new URL('../../web/', import.meta.url);
const leer = (ruta: string): string => readFileSync(new URL(ruta, WEB), 'utf8');
const PREFIJO = 'recorrido.local.';
const MODULOS = ['ocupacion-local.js', 'paso-ocupacion.js', 'preparacion.js', 'flujo-local.js'];
const FASES = ['motor', 'datos', 'ia', 'reintento', 'listo'];
const MIN_LETRAS_TRADUCIBLES = 12;
/** La preparación de cada extensión instalada, en su carpeta de web/ (con la demostración, la suya). */
const PREPARACIONES_DE_EXTENSIONES = EXTENSIONES.map(
  ({ entrada }) => `${entrada.split('/')[0] ?? ''}/scripts/recorrido/preparacion.js`,
);

test('las claves locales están en ambos diccionarios, con texto y las mismas marcas', () => {
  const claves = Object.keys(ES).filter((clave) => clave.startsWith(PREFIJO));
  assert.ok(claves.length > 0);
  assert.deepEqual(
    claves.sort(),
    Object.keys(CA)
      .filter((clave) => clave.startsWith(PREFIJO))
      .sort(),
  );
  for (const clave of claves) {
    const texto = ES[clave] ?? '';
    assert.ok(texto.trim(), clave);
    assert.ok(CA[clave]?.trim(), clave);
    assert.equal(es[clave], texto, clave);
    assert.equal(ca[clave], CA[clave], clave);
    if (texto.length > MIN_LETRAS_TRADUCIBLES && !clave.endsWith('.megas')) {
      assert.notEqual(CA[clave], texto, `${clave}: sin traducir`);
    }
    const marcas = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(marcas(CA[clave] ?? ''), marcas(texto), clave);
  }
});

test('las claves estáticas y las fases dinámicas del recorrido existen sin textos de la página retirada', () => {
  const codigo = [
    ...MODULOS.map((modulo) => leer(`scripts/recorrido/${modulo}`)),
    ...PREPARACIONES_DE_EXTENSIONES.map(leer),
  ].join('\n');
  const usadas = new Set([...codigo.matchAll(/['"](recorrido\.local\.[\w.-]+)['"]/g)].map((m) => m[1] ?? ''));
  for (const fase of FASES) {
    usadas.add(`${PREFIJO}preparando.fase.${fase}`);
  }
  const delDiccionario = Object.keys(ES)
    .filter((clave) => clave.startsWith(PREFIJO))
    .sort();
  if (EXTENSIONES.length > 0) {
    assert.deepEqual([...usadas].sort(), delDiccionario);
  } else {
    // Sin extensiones, el diccionario común conserva las claves que solo usan ellas: basta con que estén todas las
    // que usa el recorrido real.
    assert.deepEqual(
      [...usadas].sort(),
      delDiccionario.filter((clave) => usadas.has(clave)),
    );
  }
  for (const clave of usadas) {
    assert.ok(Object.hasOwn(ES, clave) && Object.hasOwn(CA, clave), clave);
  }
  assert.ok(Object.keys(es).every((clave) => !clave.startsWith('recorrido-v2.')));
  assert.ok(Object.keys(ca).every((clave) => !clave.startsWith('recorrido-v2.')));
});

test('la copia sin conexión usa los módulos del recorrido y no precarga los recursos retirados', () => {
  const web = webConstruida();
  const archivos = (['ARCHIVOS', 'BAJO_DEMANDA', 'PAGINAS_DE_SECCIONES', 'HUELLAS_DE_ARCHIVOS', 'COMPROBADOS'] as const)
    .flatMap((lista) => listaDelServicio(lista, web))
    .join('\n');
  for (const recurso of [
    'recorrido-v2.html',
    'scripts/recorrido-v2.js',
    'estilos/recorrido-v2.css',
    'scripts/recorrido-v2/segunda-opinion.js',
    'idiomas/es/recorrido-v2.js',
    'idiomas/ca/recorrido-v2.js',
  ]) {
    assert.equal(existsSync(new URL(recurso, WEB)), false, recurso);
    assert.ok(!archivos.includes(recurso), recurso);
  }
  for (const modulo of ['motor.js', 'contrato-preguntas.js', 'flujo-local.js']) {
    assert.ok(existsSync(new URL(`scripts/recorrido/${modulo}`, WEB)), modulo);
  }
  const cargados = modulosDelMapa('recorrido.html');
  assert.ok(cargados.length > 0, 'recorrido.html construido lleva su mapa de módulos');
  for (const ruta of cargados) {
    assert.ok(archivos.includes(ruta), `${ruta} está en la copia sin conexión`);
  }
});
