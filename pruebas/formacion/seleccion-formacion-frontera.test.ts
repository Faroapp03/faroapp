// Frontera entre la formación local acreditada y las consultas factuales conservadas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as motor from '../../motores/cursos/src/index.ts';
import { crearApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import {
  type MensajeAlTrabajador,
  type MensajeDelTrabajador,
  OPERACIONES_DE_CURSOS,
} from '../../src/plataforma/operaciones-de-cursos.ts';
import { iniciarTrabajadorDeCursos } from '../../src/plataforma/trabajador-de-cursos.ts';

const LONGITUD_HUELLA = 64;

test('la API factual no expone una hoja de ruta personal', async () => {
  const api = await crearApi({
    datos: cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url))),
    origenesPermitidos: [],
  });
  const respuesta = await api(
    new Request('https://frontera.test/api/hoja-de-ruta', {
      method: 'POST',
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API), 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado);
  assert.deepEqual(Object.keys(OPERACIONES_DE_CURSOS), [
    'catalogoDeCursos',
    'formacionDelInforme',
    'formacionDeLaOcupacion',
  ]);
  for (const nombre of ['catalogoDeCursos', 'formacionDelInforme', 'formacionDeLaOcupacion']) {
    assert.equal(typeof Reflect.get(motor, nombre), 'function');
  }
  for (const nombre of [
    'pasoDeLaHojaPersonal',
    'prepararHojaPersonal',
    'hojaDeRutaDelInforme',
    'recursosDeFormacionDesdeContenedor',
  ]) {
    assert.equal(Object.hasOwn(motor, nombre), false);
  }
});

test('el trabajador conserva los datos compartidos y rechaza referencias u orígenes sin invocar una consulta', async () => {
  const enviados: MensajeDelTrabajador[] = [];
  let llamadas = 0;
  const atender = iniciarTrabajadorDeCursos({
    importar: async () => ({
      ...motor,
      catalogoDeCursos: (datos: unknown) => {
        llamadas += 1;
        return datos;
      },
    }),
    enviar: (mensaje) => enviados.push(mensaje),
  });
  const datos = { marca: 'sintético' };
  await atender({ tipo: 'guardar', clave: 'd1', valor: datos });
  const base = { tipo: 'operacion', nombre: 'catalogoDeCursos', datos: 'd1', argumentos: [] } as const;
  await atender({ ...base, id: 1 });
  assert.deepEqual(enviados.at(-1), { tipo: 'hecho', id: 1, valor: datos });
  assert.equal(llamadas, 1);
  const incompatibles = [
    { ...base, id: 2, datos: 'no-guardados' },
    { ...base, id: 3, argumentos: [{ guardadoDeCursos: 'otro' }] },
    {
      ...base,
      id: 4,
      argumentos: [
        { origenDeCursos: { paquete: 'file:///ajeno/', archivo: 'extra.json', sha256: '0'.repeat(LONGITUD_HUELLA) } },
      ],
    },
    { ...base, id: 5, guardarEn: 'recurso' },
  ];
  for (const mensaje of incompatibles) {
    await atender(mensaje as MensajeAlTrabajador);
    assert.equal(enviados.at(-1)?.tipo, 'fallo');
    assert.equal(llamadas, 1, 'La consulta no recibe referencias ni datos que no existen');
  }
});
