// Un resultado pasado desde otro dispositivo trae la fecha del día en que se hizo, que puede ser anterior a los datos
// con el reloj bien puesto: con el motor real (la API local sobre el paquete real, no el doble) se abre sin error.
import './carga-recibido.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diaUtc, MS_POR_DIA } from '../../src/comun/tiempo.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { informeAdmitido } from '../../web/scripts/confianza/informe.js';
import { codificar } from '../../web/scripts/otro-dispositivo/formato.js';
import { ErrorFaro } from '../../web/scripts/recorrido/api/errores.js';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';
import { navegador } from '../web-controles/ayudas.js';
import { fijarMotor } from './motor-doble.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
/** Un resultado hecho dos semanas antes de la copia más reciente de los datos, con el reloj bien puesto. */
const DIAS_ANTES = 14;
const CORRECTO = 200;
const FECHA_ANTIGUA = diaUtc(Date.parse(`${FECHA_DEL_INFORME}T00:00:00Z`) - DIAS_ANTES * MS_POR_DIA);
const RESULTADO = {
  idioma: 'es' as const,
  isco08: '7512',
  fecha: FECHA_ANTIGUA,
  tareas: [{ tareaOit: '7512-1', tiempo: 'algo' as const }],
  sinViajar: 0,
};

/** El motor del dispositivo de verdad: la API local atiende cada petición del receptor. */
function fijarMotorReal(estados: number[]): void {
  const api = crearApiLocal({ datos: DATOS, motorDeCursos });
  fijarMotor(async (ruta, opciones) => {
    const respuesta = await (await api)(
      new Request(`https://dispositivo.test${ruta}`, {
        method: opciones.method ?? 'GET',
        headers: opciones.headers ?? {},
        ...(opciones.body === undefined ? {} : { body: opciones.body }),
      }),
    );
    estados.push(respuesta.status);
    return respuesta;
  });
}

test('un código con fecha anterior a los datos se abre con 200 y su informe pasa el filtro de confianza que lo pinta', async (t) => {
  navegador(t, { navigator: {} });
  const estados: number[] = [];
  fijarMotorReal(estados);
  const { informeDelCodigo } = await import('../../web/scripts/otro-dispositivo/recibir.js');
  const { html, resultado } = await informeDelCodigo(codificar(RESULTADO));
  assert.deepEqual(estados, [CORRECTO, CORRECTO]);
  assert.equal(resultado.fecha, FECHA_ANTIGUA);
  assert.match(html, /<section class="hoja /u);
  assert.doesNotThrow(() => informeAdmitido(html));
});

test('con relojDelDispositivo, el motor real contrasta la fecha: dos días por detrás da el error del reloj y un día por detrás se abre', async (t) => {
  navegador(t, { navigator: {} });
  fijarMotorReal([]);
  const { informeDelCodigo } = await import('../../web/scripts/otro-dispositivo/recibir.js');
  const dosDiasAntes = diaUtc(Date.parse(`${FECHA_DEL_INFORME}T00:00:00Z`) - 2 * MS_POR_DIA);
  const unDiaAntes = diaUtc(Date.parse(`${FECHA_DEL_INFORME}T00:00:00Z`) - MS_POR_DIA);
  await assert.rejects(
    informeDelCodigo(codificar({ ...RESULTADO, fecha: dosDiasAntes }), { relojDelDispositivo: true }),
    (error) =>
      error instanceof ErrorFaro && JSON.stringify(error.explicacion).includes('recorrido.error.reloj-atrasado'),
  );
  const { html } = await informeDelCodigo(codificar({ ...RESULTADO, fecha: unDiaAntes }), {
    relojDelDispositivo: true,
  });
  assert.match(html, /<section class="hoja /u);
});
