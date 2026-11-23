import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { limpiarDatosPersonales } from '../../src/seguridad/privacidad.ts';

let estado: 'bloqueada' | 'distinta' | 'correcta' = 'bloqueada';
registerHooks({
  resolve(spec, contexto, siguiente) {
    const prefijo = '/web/motor/src/seguridad/';
    const i = spec.indexOf(prefijo);
    if (i < 0) {
      return siguiente(spec, contexto);
    }
    if (estado === 'bloqueada') {
      throw new Error('Carga bloqueada por la prueba');
    }
    const archivo = spec.slice(i + prefijo.length);
    if (estado === 'distinta' && archivo === 'privacidad.js') {
      return { url: 'data:text/javascript,export const otra=1;', shortCircuit: true };
    }
    return siguiente(new URL(`../../src/seguridad/${archivo.replace(/\.js$/, '.ts')}`, import.meta.url).href, contexto);
  },
});
const { minimizarParaEnviar, RutaSinFiltro } = await import('../../web/scripts/recorrido/minimizar.js');

test('fallo o contrato de limpieza distinto impide salida; sin cuerpo sale igual, fuera de la lista nunca, y un intento posterior puede cargar', async () => {
  const cuerpo = { ocupacionPersona: 'administrativa', tareas: [{ texto: 'Escribo a ana@example.invalid.' }] };
  assert.equal(await minimizarParaEnviar('/informe', cuerpo), null);
  const clasificacion = await minimizarParaEnviar('/grupos?padre=', undefined);
  assert.ok(clasificacion, 'La clasificación oficial sin cuerpo sigue disponible con la limpieza bloqueada');
  assert.equal(clasificacion.cuerpo, undefined);
  await assert.rejects(minimizarParaEnviar('/grupos', { idioma: 'es' }), RutaSinFiltro);
  estado = 'distinta';
  assert.equal(await minimizarParaEnviar('/informe', cuerpo), null);
  estado = 'correcta';
  const salida = await minimizarParaEnviar('/informe', cuerpo);
  assert.ok(salida);
  assert.deepEqual(salida.cuerpo, {
    ocupacionPersona: 'administrativa',
    tareas: [{ texto: limpiarDatosPersonales('Escribo a ana@example.invalid.').texto }],
  });
  assert.deepEqual(cuerpo, {
    ocupacionPersona: 'administrativa',
    tareas: [{ texto: 'Escribo a ana@example.invalid.' }],
  });
});
