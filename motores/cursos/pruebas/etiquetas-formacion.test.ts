// Etiquetas de las fichas factuales: nombres, variantes y falsos positivos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { etiquetasDe } from '../src/etiquetas-formacion.ts';

test('etiquetas por nombre, en castellano y en catalán', () => {
  const casos: [string, string[]][] = [
    ['C.13. TALLERES DE REPARACIÓN DE VEHÍCULOS. FORMACIÓN DE RECICLAJE', ['prevencion']],
    ['PRL per a treballs d’electricitat', ['prevencion']],
    ['ADR. TRANSPORTE DE MERCANCÍAS PELIGROSAS (BÁSICO)', ['habilitacion', 'iniciacion']],
    ['EUSKERA BÁSICO PARA TRABAJAR EN HOSTELERÍA', ['otro-territorio', 'iniciacion']],
    ['ESCANCIADOR DE SIDRA', ['otro-territorio']],
    ['OPERACIONES AUXILIARES DE RESTAURACIÓN PARA PERSONAS CON DISCAPACIDAD', ['iniciacion', 'colectivo']],
    ['ChatGPT i Intel·ligència Artificial', ['ia']],
    ['Anglès B.1.D.', ['idioma']],
    ['PLANES DE CONTINGENCIA EN ALOJAMIENTOS Y HOSTELERÍA EN TORNO AL COVID-19', ['desfasada']],
  ];
  for (const [nombre, esperadas] of casos) {
    assert.deepEqual([...etiquetasDe(nombre)].sort(), [...esperadas].sort(), nombre);
  }
});

test('lo que se parece a una etiqueta y no lo es', () => {
  // La errata del catálogo «INDUSTR IA» no es IA; «degenerativos» no es IA generativa.
  assert.equal(etiquetasDe('SISTEMA DE GESTIÓN MEDIOAMBIENTAL EN LA INDUSTR IA').has('ia'), false);
  assert.equal(etiquetasDe('CUIDADOS DE LA PERSONA MAYOR CON TRASTORNOS DEGENERATIVOS').has('ia'), false);
  // Atender a clientes con discapacidad es un curso para quien trabaja, no para un colectivo.
  assert.equal(etiquetasDe('ATENCIÓN A LA CLIENTELA CON DISCAPACIDAD').has('colectivo'), false);
  // El reciclaje de materias primas no es la renovación de un curso obligatorio.
  assert.equal(etiquetasDe('APROVECHAMIENTO Y RECICLAJE DE MATERIAS PRIMAS').has('prevencion'), false);
});

test('colectivo, prevención y territorio por lo que enseña el curso, no por una palabra', () => {
  const casos: [string, string[]][] = [
    ['Atención a personas con discapacidad intelectual', []],
    ['Habilidades sociales para personas con discapacidad intelectual', ['colectivo']],
    ['Excel (accesible)', ['digital']],
    ['Gestión de residuos y reciclaje', []],
    ['Carretilla elevadora. Reciclaje', ['habilitacion', 'prevencion']],
    ['Cocina gallega', []],
    ['Gallego básico', ['otro-territorio', 'iniciacion']],
  ];
  for (const [nombre, esperadas] of casos) {
    assert.deepEqual([...etiquetasDe(nombre)].sort(), [...esperadas].sort(), nombre);
  }
});
