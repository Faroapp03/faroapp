import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { grafoDeModulos } from '../ayudas/grafo-de-modulos.ts';

const WEB = resolve('web');
test('el recorrido real no importa módulos de ninguna extensión instalada', () => {
  const archivos = grafoDeModulos(WEB, 'scripts/recorrido.js');
  const carpetas = EXTENSIONES.map(({ entrada }) => `${resolve(WEB, entrada.split('/')[0] ?? '')}/`);
  assert.ok([...archivos].every((ruta) => !carpetas.some((carpeta) => ruta.startsWith(carpeta))));
});
