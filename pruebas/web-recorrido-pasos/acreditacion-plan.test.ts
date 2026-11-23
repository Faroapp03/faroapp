import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerAcreditaciones } from '../../web/scripts/recorrido/plan-formacion/acreditacion-datos.js';

const identidad = { esco: '8331.1', isco08: '8331', idioma: 'es' as const };
const informe = {
  ocupacion: { esco: '8331.1', isco08: '8331' },
  acreditacion: {
    fuente: 'Agència FP.CAT',
    comprobado: '2026-10-20',
    ofertaActualizada: '2026-10-01',
    enlaces: [{ url: 'https://tramits.gencat.cat/ca/tramits/tramits-temes/21900_Acreditat' }],
    certificados: [
      {
        codigo: 'ABCD1234',
        nombre: 'Transporte',
        nivel: 2,
        relacion: 'ocupacion',
        enlaceBoe: 'https://www.boe.es/ejemplo',
      },
    ],
    sepe: { certificados: [{ codigo: 'EFGH1234' }] },
  },
};
test('solo devuelve certificados comprobados del informe y de la ocupación actual', () => {
  const opciones = leerAcreditaciones(informe, identidad);
  assert.equal(opciones.length, 1);
  assert.equal(opciones[0]?.codigo, 'ABCD1234');
  assert.deepEqual(leerAcreditaciones(informe, { ...identidad, esco: '9999.1' }), []);
  assert.deepEqual(leerAcreditaciones(informe, { ...identidad, isco08: '9999' }), []);
  assert.deepEqual(leerAcreditaciones({ ...informe, acreditacion: null }, identidad), []);
  const alterado = structuredClone(informe);
  const certificado = alterado.acreditacion.certificados[0];
  assert.ok(certificado);
  certificado.enlaceBoe = 'https://www.boe.es.ejemplo.invalid/';
  assert.deepEqual(leerAcreditaciones(alterado, identidad), []);
});

test('la elección permite omitir, confirma una opción y cancela respuestas tardías', async () => {
  await import('./dom.ts');
  const { crearEleccionAcreditacion } = await import('../../web/scripts/recorrido/plan-formacion/acreditacion.js');
  const opcion = leerAcreditaciones(informe, identidad)[0];
  assert.ok(opcion);
  const cancelador = new AbortController();
  const eleccion = crearEleccionAcreditacion([opcion], 'es', cancelador.signal);
  const botones = eleccion.nodo.querySelectorAll('button');
  assert.equal(botones.length, 2);
  assert.match(eleccion.nodo.textContent ?? '', /Transporte.*ABCD1234.*ocupación/u);
  assert.equal(eleccion.nodo.querySelector('a')?.href, opcion.tramite);
  botones[0]?.dispatchEvent(new Event('click'));
  assert.deepEqual(await eleccion.respuesta, opcion);
  const tardia = crearEleccionAcreditacion([opcion], 'es', cancelador.signal);
  cancelador.abort();
  assert.equal(await tardia.respuesta, null);
  tardia.nodo.querySelector('button')?.dispatchEvent(new Event('click'));
});

test('la espera del informe se interrumpe al cancelar y no entrega datos de un recorrido anterior', async () => {
  await import('./dom.ts');
  const { estado, reiniciarEstado } = await import('../../web/scripts/recorrido/estado.js');
  const { fijarIdioma } = await import('../../web/scripts/textos.js');
  const { registrarAcreditacion, obtenerAcreditaciones, olvidarAcreditacion } = await import(
    '../../web/scripts/recorrido/plan-formacion/registro-acreditacion.js'
  );
  reiniciarEstado();
  fijarIdioma('es');
  estado.ocupacion = { ...identidad, isco08Secundario: null, origen: null, palabra: 'trabajo', titulo: 'Trabajo' };
  registrarAcreditacion(informe, estado.ocupacion, 'es');
  const abortador = new AbortController();
  const espera = obtenerAcreditaciones(new Promise<boolean>(() => {}), abortador.signal);
  abortador.abort();
  assert.deepEqual(await espera, []);
  const vieja = estado.ocupacion;
  estado.ocupacion = { ...vieja, isco08: '9999' };
  assert.deepEqual(await obtenerAcreditaciones(null, new AbortController().signal), []);
  olvidarAcreditacion();
});
