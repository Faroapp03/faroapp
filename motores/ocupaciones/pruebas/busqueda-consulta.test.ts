// Resultados de referencia del buscador con títulos, contexto, diccionarios y grupos del paquete.
// Las expectativas fijas protegen el orden y los puntos de las consultas sin regenerarlos al limpiar comentarios.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { consultasDe } from '../src/busqueda/consulta.ts';
import { indiceDe } from '../src/busqueda/indice.ts';
import { buscarOcupaciones } from '../src/busqueda/ocupaciones.ts';
import { fraseSinGenero, palabrasDe } from '../src/busqueda/palabras.ts';
import testigos from './testigos-busqueda.json' with { type: 'json' };

// El banco capturado mide ESCO castellano; la reserva catalana tiene sus propias pruebas.
const { catalan: _catalan, ...datos } = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const indice = indiceDe(datos);
const expansiones = new Set(['guias', 'jefes', 'jefas']);

describe('Preparación de consultas', () => {
  it('expande las tres formas de plural corto sin cambiar la frase ni el número', () => {
    const casos = [
      ['guías turísticos', 'guia'],
      ['jefes de cocina', 'jefe'],
      ['jefas de cocina', 'jefe'],
    ] as const;
    for (const [texto, raiz] of casos) {
      const consultas = consultasDe(indice, texto);
      assert.ok(consultas.length);
      for (const consulta of consultas) {
        assert.ok(consulta.palabras.includes(raiz));
        assert.equal(consulta.frase, fraseSinGenero(texto));
      }
    }
    assert.notEqual(fraseSinGenero('guías turísticos'), fraseSinGenero('guía turístico'));
    assert.notEqual(fraseSinGenero('jefes de cocina'), fraseSinGenero('jefe de cocina'));
  });

  it('conserva exactamente candidatas, puntos y orden de las entradas ajenas', () => {
    for (const testigo of testigos.filter((caso) => !caso.expandida)) {
      assert.ok(palabrasDe(testigo.texto).every((palabra) => !expansiones.has(palabra)));
      const candidatas = buscarOcupaciones(datos, testigo.texto).map(({ esco, puntos }) => ({ esco, puntos }));
      assert.deepEqual(candidatas, testigo.candidatas, testigo.texto);
    }
  });

  it('conserva el resultado de referencia de plurales y nombres en las sondas existentes', () => {
    for (const testigo of testigos.filter((caso) => caso.expandida)) {
      const candidatas = buscarOcupaciones(datos, testigo.texto).map(({ esco, puntos }) => ({ esco, puntos }));
      assert.deepEqual(candidatas, testigo.candidatas, testigo.texto);
    }
  });

  it('no prepara una consulta sin palabras que el catálogo pueda cubrir', () => {
    assert.deepEqual(consultasDe(indice, 'de la y'), []);
    assert.deepEqual(consultasDe(indice, ''), []);
  });
});
