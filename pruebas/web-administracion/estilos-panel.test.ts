/**
 * La hoja de estructura del panel frente a la maqueta aprobada: la pastilla de la sesión se lee en la barra oscura, el
 * título de un apartado no queda bajo la barra fija al llegar por su enlace y una cifra que es una frase larga cabe en
 * una línea sin cambiar el tamaño de las cifras numéricas.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const HOJA = readFileSync(new URL('../../web/administracion/panel-estructura.css', import.meta.url), 'utf8');

/** Las declaraciones de cada regla cuyo selector es exactamente el pedido (comentarios fuera). */
function declaraciones(selector: string): Map<string, string> {
  const limpia = HOJA.replace(/\/\*[\s\S]*?\*\//gu, '');
  const resultado = new Map<string, string>();
  for (const [, selectores = '', cuerpo = ''] of limpia.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (!selectores.split(',').some((parte) => parte.trim() === selector)) {
      continue;
    }
    for (const linea of cuerpo.split(';')) {
      const [propiedad, ...valor] = linea.split(':');
      if (propiedad?.trim()) {
        resultado.set(propiedad.trim(), valor.join(':').trim());
      }
    }
  }
  return resultado;
}

test('la pastilla de la sesión toma la tinta clara de la barra, no la tinta general de su banda', () => {
  const pastilla = declaraciones('.panel-app .sesion-unica-banda-texto');
  assert.equal(pastilla.get('color'), 'var(--panel-barra-tinta)');
  assert.notEqual(pastilla.get('color'), 'var(--color-tinta)');
  assert.equal(declaraciones('.panel-cuerpo').get('--panel-barra-tinta'), '#e9edf1');
  assert.equal(declaraciones('.panel-app').get('color'), 'var(--panel-barra-tinta)');
});

test('al llegar a un apartado por su enlace, su comienzo y su título quedan por debajo de la barra fija', () => {
  for (const selector of ['.panel-administracion .panel-apartado', '.panel-administracion .panel-apartado-titulo']) {
    assert.equal(declaraciones(selector).get('scroll-margin-top'), 'calc(var(--panel-barra-alto) + 16px)', selector);
  }
  assert.equal(declaraciones('.panel-app').get('position'), 'sticky');
});

test('una cifra que es una frase larga se escribe más pequeña con la misma altura; la cifra numérica no cambia', () => {
  const cifra = declaraciones('.panel-kpi-cifra');
  assert.equal(cifra.get('font-size'), '28px');
  assert.equal(cifra.get('line-height'), '1.1');
  const frase = declaraciones('.panel-administracion .panel-kpi-cifra--texto');
  assert.equal(frase.get('font-size'), '20px');
  assert.equal(frase.get('line-height'), 'calc(28px * 1.1)');
});
