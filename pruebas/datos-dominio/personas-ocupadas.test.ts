// Contratos de selección, fuentes y años de las cifras del censo y de la comarca.

import assert from 'node:assert/strict';
import test from 'node:test';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { ocupadosEnLaZona, personasOcupadas } from '../../src/dominio/personas-ocupadas.ts';
import { catalunaDePrueba, datosEstadisticos, ocupadosDePrueba } from '../fixtures/datos-estadisticas.ts';

const MINIMO_SIN_COMARCA = 201;

test('sin censo anual usa INE 2021 y un grupo amplio sustituye a sus grupos contenidos', () => {
  const cataluna = catalunaDePrueba();
  const datos = datosEstadisticos({ cataluna });
  assert.deepEqual(personasOcupadas(datos, cataluna, ['2111', '2211', '2121', '2112'], crearLengua(datos)), [
    {
      cno11: '221',
      grupo: 'Tercer grupo',
      amplio: false,
      organismo: 'INE',
      anio: '2021',
      personas: 3000,
      pctMujeres: null,
      pctMenores30: null,
      pct55: null,
      variacion: null,
    },
    {
      cno11: '21',
      grupo: 'Grupo amplio',
      amplio: true,
      organismo: 'INE',
      anio: '2021',
      personas: 5000,
      pctMujeres: 50,
      pctMenores30: 25,
      pct55: 10,
      variacion: null,
    },
  ]);
});

test('el censo anual usa el último año y conserva la edad histórica del mismo nivel', () => {
  const cataluna = catalunaDePrueba();
  const datos = datosEstadisticos({ cataluna, ocupados: ocupadosDePrueba() });
  assert.deepEqual(personasOcupadas(datos, cataluna, ['2111'], crearLengua(datos)), [
    {
      cno11: '211',
      grupo: 'Primer grupo',
      amplio: false,
      organismo: 'Idescat',
      anio: '2024',
      personas: 1101,
      pctMujeres: 41,
      pctMenores30: 20,
      pct55: 15,
      variacion: { desde: '2023', hasta: '2024', pct: 10.1, conjunto: 10 },
    },
  ]);
});

test('la variación exige mil personas en ambos años y dos años comparables', () => {
  const cataluna = catalunaDePrueba();
  const ocupados = ocupadosDePrueba();
  const datos = datosEstadisticos({ cataluna, ocupados });
  const lengua = crearLengua(datos);
  assert.equal(personasOcupadas(datos, cataluna, ['2211'], lengua)[0]?.variacion, null);
  ocupados.comparable_desde = '2024';
  assert.equal(personasOcupadas(datos, cataluna, ['2111'], lengua)[0]?.variacion, null);
});

test('el censo decenal de 2021 no completa dos años comparables con el primer año anual', () => {
  const cataluna = catalunaDePrueba();
  const ocupados = ocupadosDePrueba();
  ocupados.anios = ['2022', '2021'];
  ocupados.cataluna_cno3 = {
    total: { '2021': { ocupados: 5000, pct_mujeres: 50 }, '2022': { ocupados: 10000, pct_mujeres: 51 } },
    '211': { '2021': { ocupados: 1000, pct_mujeres: 40 }, '2022': { ocupados: 2000, pct_mujeres: 41 } },
  };
  const datos = datosEstadisticos({ cataluna, ocupados });
  const [grupo] = personasOcupadas(datos, cataluna, ['2111'], crearLengua(datos));
  assert.ok(grupo);
  assert.deepEqual(
    { anio: grupo.anio, personas: grupo.personas, variacion: grupo.variacion },
    { anio: '2022', personas: 2000, variacion: null },
  );
});

test('si falta el total comparable da la cifra anual sin variación', () => {
  const cataluna = catalunaDePrueba();
  const ocupados = ocupadosDePrueba();
  delete ocupados.cataluna_cno3.total;
  const datos = datosEstadisticos({ cataluna, ocupados });
  assert.equal(personasOcupadas(datos, cataluna, ['2111'], crearLengua(datos))[0]?.variacion, null);
});

test('el mínimo anual selecciona el grupo amplio y su edad sin recuperar cifras de un año anterior', () => {
  const cataluna = catalunaDePrueba();
  const ocupados = ocupadosDePrueba();
  ocupados.cataluna_cno3['211'] = {
    '2023': { ocupados: 2000, pct_mujeres: 45 },
    '2024': { ocupados: 99, pct_mujeres: 46 },
  };
  const datos = datosEstadisticos({ cataluna, ocupados });
  const [grupo] = personasOcupadas(datos, cataluna, ['2111'], crearLengua(datos));
  assert.ok(grupo);
  assert.deepEqual(
    {
      cno11: grupo.cno11,
      amplio: grupo.amplio,
      personas: grupo.personas,
      pctMenores30: grupo.pctMenores30,
      pct55: grupo.pct55,
    },
    { cno11: '21', amplio: true, personas: 5100, pctMenores30: 25, pct55: 10 },
  );
});

test('un paquete anual presente sin grupos publicados no recupera el censo histórico', () => {
  const cataluna = catalunaDePrueba();
  const ocupados = ocupadosDePrueba();
  ocupados.cataluna_cno3 = {};
  ocupados.cataluna_cno2 = {};
  const datos = datosEstadisticos({ cataluna, ocupados });
  assert.deepEqual(personasOcupadas(datos, cataluna, ['2111'], crearLengua(datos)), []);
});

test('la comarca deduplica grupos y distingue el nivel amplio de un grupo con un único hijo', () => {
  const cataluna = catalunaDePrueba();
  const datos = datosEstadisticos({ cataluna, ocupados: ocupadosDePrueba() });
  const lengua = crearLengua(datos);
  const grupos = personasOcupadas(datos, cataluna, ['2111', '2211'], lengua);
  assert.deepEqual(ocupadosEnLaZona(datos, [...grupos, ...grupos], lengua), [
    { comarca: 'Baix Llobregat', cno11: '21', grupo: 'Grupo amplio', amplio: true, personas: 200, anio: '2024' },
    { comarca: 'Baix Llobregat', cno11: '22', grupo: 'Grupo único', amplio: false, personas: 100, anio: '2024' },
  ]);
});

test('la comarca omite grupos históricos, años sin cifras y cifras por debajo del mínimo', () => {
  const cataluna = catalunaDePrueba();
  const datos = datosEstadisticos({ cataluna });
  const lengua = crearLengua(datos);
  const historicos = personasOcupadas(datos, cataluna, ['2111'], lengua);
  datos.ocupados = ocupadosDePrueba();
  assert.deepEqual(ocupadosEnLaZona(datos, historicos, lengua), []);
  const anuales = personasOcupadas(datos, cataluna, ['2111'], lengua);
  datos.ocupados.min_personas = MINIMO_SIN_COMARCA;
  assert.deepEqual(ocupadosEnLaZona(datos, anuales, lengua), []);
  assert.deepEqual(
    ocupadosEnLaZona(
      datos,
      anuales.map((grupo) => ({ ...grupo, anio: '2022' })),
      lengua,
    ),
    [],
  );
});

test('las lecturas conservan los años, cifras y grupos recibidos', () => {
  const cataluna = catalunaDePrueba();
  const datos = datosEstadisticos({ cataluna, ocupados: ocupadosDePrueba() });
  const antes = structuredClone(datos);
  const lengua = crearLengua(datos);
  const grupos = personasOcupadas(datos, cataluna, ['2211', '2111'], lengua);
  const gruposAntes = structuredClone(grupos);
  ocupadosEnLaZona(datos, grupos, lengua);
  assert.deepEqual(datos, antes);
  assert.deepEqual(grupos, gruposAntes);
});
