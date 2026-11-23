/**
 * Navegadores aislados: el fragmento sintético permanece en el navegador y no llega al servidor al entrar en el
 * recorrido real. Las variantes salen del registro: el real activo siempre y, por cada extensión instalada, el real
 * inactivo tras la contraseña. Las entradas de cada extensión se prueban en su propia carpeta de pruebas.
 */
import { test } from 'node:test';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { probarFragmentoEnNavegadores } from './fragmento-acceso.mjs';

const REAL = { variante: 'real', ruta: '/recorrido.html' };

test('el fragmento QR sobrevive al acceso del recorrido real en los tres navegadores', async (t) => {
  await probarFragmentoEnNavegadores(
    [{ ...REAL, modo: 'real' }, ...EXTENSIONES.map(({ id }) => ({ ...REAL, modo: id }))],
    t,
  );
});
