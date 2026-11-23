// Los umbrales se aplican a cada medida y la antigüedad mantiene los tramos publicados en su orden.

import assert from 'node:assert/strict';
import test from 'node:test';
import { informacionAdicional } from '../../src/dominio/informacion-adicional.ts';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { datosParaContexto, grupoParaComparar } from '../fixtures/datos-contexto.ts';

const BASE_INSUFICIENTE = 99;
const BASE_MINIMA = 100;
const DOS_TRAMOS = 2;

test('el umbral inclusivo publica demandantes y contratos con sus medidas cero o nulas', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const adicional = informacionAdicional(datos, grupo.contratacion, grupo.perfil, crearLengua(datos));
  assert.deepEqual(adicional?.demandantes, { enLos12Meses: 100, mediaMensual: 0, contratadasPorDemandante: 0 });
  assert.deepEqual(adicional?.contratos, {
    contratos: 100,
    personas: 100,
    porPersona: 1,
    porPersonaConjunto: 1,
    pctParcial: null,
    pctParcialConjunto: null,
    diasTemporales: null,
    diasTemporalesConjunto: null,
  });
});

test('contratos y demandantes aplican su mínimo propio de forma independiente', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const lengua = crearLengua(datos);
  const indicadores = datos.observatori?.cataluna.cno4['2111'];
  assert.ok(indicadores);
  indicadores.contratos = BASE_INSUFICIENTE;
  const soloDemandantes = informacionAdicional(datos, grupo.contratacion, grupo.perfil, lengua);
  assert.ok(soloDemandantes?.demandantes);
  assert.equal(soloDemandantes.contratos, null);
  indicadores.contratos = BASE_MINIMA;
  indicadores.demandantes_no_ocupados_12m = BASE_INSUFICIENTE;
  const soloContratos = informacionAdicional(datos, grupo.contratacion, grupo.perfil, lengua);
  assert.ok(soloContratos?.contratos);
  assert.equal(soloContratos.demandantes, null);
});

test('sin media mensual o recuento de demandantes no presenta demandantes y mantiene contratos', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const lengua = crearLengua(datos);
  const indicadores = datos.observatori?.cataluna.cno4['2111'];
  assert.ok(indicadores);
  indicadores.demandantes_no_ocupados_media = null;
  assert.equal(informacionAdicional(datos, grupo.contratacion, grupo.perfil, lengua)?.demandantes, null);
  indicadores.demandantes_no_ocupados_media = 0;
  indicadores.demandantes_no_ocupados_12m = null;
  const adicional = informacionAdicional(datos, grupo.contratacion, grupo.perfil, lengua);
  assert.equal(adicional?.demandantes, null);
  assert.ok(adicional?.contratos);
});

test('la antigüedad conserva los céntimos, cero euros y el orden temporal aunque las claves lleguen desordenadas', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const salarios = datos.salarios?.grandes_grupos['2'];
  assert.ok(salarios);
  salarios.antiguedad = { 'De 4 a 10 años': 25000.15, 'Menos de 1 año': 0 };
  const adicional = informacionAdicional(datos, grupo.contratacion, grupo.perfil, crearLengua(datos));
  assert.deepEqual(adicional?.antiguedad, {
    anio: 2022,
    granGrupo: '2',
    titulo: 'Gran grupo',
    tramos: [
      { tramo: 'menosDe1', euros: 0 },
      { tramo: 'de4a10', euros: 25000.15 },
    ],
  });
});

test('la antigüedad necesita dos tramos publicados y no escoge otros conceptos de la tabla', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const lengua = crearLengua(datos);
  const salarios = datos.salarios?.grandes_grupos['2'];
  assert.ok(salarios);
  assert.equal(informacionAdicional(datos, [], grupo.perfil, lengua)?.antiguedad?.tramos.length, DOS_TRAMOS);
  salarios.antiguedad = { 'Menos de 1 año': 0, Total: 30000 };
  assert.equal(informacionAdicional(datos, [], grupo.perfil, lengua), null);
  delete salarios.antiguedad;
  assert.equal(informacionAdicional(datos, [], grupo.perfil, lengua), null);
});

test('varios perfiles omiten salario y varios contratos omiten Observatori de forma independiente', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const lengua = crearLengua(datos);
  const sinSalario = informacionAdicional(datos, grupo.contratacion, [...grupo.perfil, ...grupo.perfil], lengua);
  assert.ok(sinSalario?.contratos);
  assert.equal(sinSalario.antiguedad, null);
  const soloSalario = informacionAdicional(datos, [...grupo.contratacion, ...grupo.contratacion], grupo.perfil, lengua);
  assert.ok(soloSalario?.antiguedad);
  assert.deepEqual(
    {
      cno11: soloSalario.cno11,
      grupo: soloSalario.grupo,
      periodo: soloSalario.periodo,
      demandantes: soloSalario.demandantes,
      contratos: soloSalario.contratos,
    },
    { cno11: null, grupo: null, periodo: null, demandantes: null, contratos: null },
  );
  assert.equal(
    informacionAdicional(
      datos,
      [...grupo.contratacion, ...grupo.contratacion],
      [...grupo.perfil, ...grupo.perfil],
      lengua,
    ),
    null,
  );
});

test('sin indicadores ni salario el resultado es null y con solo salario los campos de Observatori son nulos', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const lengua = crearLengua(datos);
  delete datos.observatori;
  const soloSalario = informacionAdicional(datos, grupo.contratacion, grupo.perfil, lengua);
  assert.ok(soloSalario?.antiguedad);
  assert.equal(soloSalario.periodo, null);
  delete datos.salarios;
  assert.equal(informacionAdicional(datos, grupo.contratacion, grupo.perfil, lengua), null);
});

test('la lectura mantiene las tablas y las listas y usa el periodo de contratos en el idioma pedido', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const antes = structuredClone({ datos, grupo });
  const lengua = crearLengua(datos, 'ca');
  const adicional = informacionAdicional(datos, grupo.contratacion, grupo.perfil, lengua);
  assert.equal(adicional?.periodo, 'Període català');
  assert.deepEqual(lengua.sinTraducir(), [{ texto: 'Gran grupo', idioma: 'es' }]);
  assert.deepEqual({ datos, grupo }, antes);
});
