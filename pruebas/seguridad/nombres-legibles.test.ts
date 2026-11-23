// Nombres oficiales legibles: siglas, marcas, alfabetos y separadores conservados.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nombreLegible } from '../../src/dominio/nombres-legibles.ts';

test('los casos de formación del origen conservan siglas, marcas y códigos', () => {
  const casos: readonly [string, string][] = [
    ['ADMINISTRACIÓN DE SISTEMAS TIC CON IA', 'Administración de sistemas TIC con IA'],
    ['ADR_TRANSPORTE MATERIAS Y OBJETOS (CLASE 1)', 'ADR_transporte materias y objetos (clase 1)'],
    ['ÁREA DE IA', 'Área de IA'],
    ['CHATGPT E INTELIGENCIA ARTIFICIAL', 'ChatGPT e inteligencia artificial'],
    ['MICROSOFT 365 COPILOT', 'Microsoft 365 Copilot'],
    [
      'ADMINISTRACIÓN Y AMPLIACIÓN DE MICROSOFT 365 COPILOT - MS-4017',
      'Administración y ampliación de Microsoft 365 Copilot - MS-4017',
    ],
  ];
  for (const [nombre, esperado] of casos) {
    assert.equal(nombreLegible(nombre), esperado, nombre);
  }
});

test('todas las siglas conocidas conservan su caja en medio del nombre, también desde minúsculas', () => {
  const siglas = [
    'TIC',
    'IA',
    'CNC',
    'SAP',
    'PRL',
    'BIM',
    'CAD',
    'SEO',
    'GPS',
    'ADR',
    'UE',
    'PYME',
    'PYMES',
    'ERP',
    'CRM',
    'IOT',
    'MS',
  ];
  for (const sigla of siglas) {
    assert.equal(nombreLegible(`CURSO DE ${sigla}`), `Curso de ${sigla}`);
    assert.equal(nombreLegible(`curso de ${sigla.toLowerCase()}`), `Curso de ${sigla}`);
  }
});

test('las siglas y marcas solo se reconocen como palabras completas separadas de letras y cifras', () => {
  const casos: readonly [string, string][] = [
    ['CURSO DE IA2, TIC3, XIA, IAX, CHATGPT4 Y COPILOTX', 'Curso de ia2, tic3, xia, iax, chatgpt4 y copilotx'],
    ['CURSO IA_TIC/ADR-CRM (CHATGPT), MICROSOFT+COPILOT', 'Curso IA_TIC/ADR-CRM (ChatGPT), Microsoft+Copilot'],
    ['ÁREA TÉCNICA ÉIA IAÉ 2IA IA2', 'Área técnica éia iaé 2ia ia2'],
    ['CURSO DE NASA, XML, YAML Y UNAMARCA', 'Curso de nasa, xml, yaml y unamarca'],
    ['OFFICE: WORD, EXCEL, ACCESS Y POWER BI', 'Office: Word, Excel, Access y Power BI'],
  ];
  for (const [nombre, esperado] of casos) {
    assert.equal(nombreLegible(nombre), esperado, nombre);
  }
});

test('conserva espacios y puntuación, y solo capitaliza el primer carácter', () => {
  const casos: readonly [string, string][] = [
    ['', ''],
    ['   ', '   '],
    ['  CURSO DE IA  ', '  curso de IA  '],
    ['«ÁREA DE IA»', '«área de IA»'],
    ['\nCURSO\tDE\nTIC', '\ncurso\tde\nTIC'],
    ['CURSO: IA... / TIC _ ADR + CRM', 'Curso: IA... / TIC _ ADR + CRM'],
    ['123 ÁREA DE IA', '123 área de IA'],
    ['🧭 ÁREA DE IA', '🧭 área de IA'],
  ];
  for (const [nombre, esperado] of casos) {
    assert.equal(nombreLegible(nombre), esperado, nombre);
  }
});

test('admite cualquier caja y conserva alfabetos Unicode sin normalizar sus caracteres', () => {
  const casos: readonly [string, string][] = [
    ['aDmInIsTrAcIóN CON chatgpt Y copilot', 'Administración con ChatGPT y Copilot'],
    ['АРЕА DE IA', 'Ареа de IA'],
    ['中文 DE IA', '中文 de IA'],
    ['A\u0301REA DE IA', 'A\u0301rea de IA'],
    ['ÅREA DE TIC', 'Årea de TIC'],
  ];
  for (const [nombre, esperado] of casos) {
    assert.equal(nombreLegible(nombre), esperado, nombre);
    assert.equal(nombreLegible(esperado), esperado, `segunda aplicación de ${nombre}`);
  }
});
