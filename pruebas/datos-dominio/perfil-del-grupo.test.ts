// Selección del perfil agregado y comparación salarial por escalones de estudios.

import assert from 'node:assert/strict';
import test from 'node:test';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { perfilesDelGrupo, salarioPorEstudios, salariosDelGranGrupo } from '../../src/dominio/perfil-del-grupo.ts';
import type { DatosSalarios, PerfilDelGrupo } from '../../src/dominio/tipos-contexto.ts';
import { censoDePrueba, datosEstadisticos } from '../fixtures/datos-estadisticas.ts';

const MINIMO_SIN_PERFIL = 2001;
const ESTUDIOS_OBLIGATORIOS = 'Primera etapa de Educación Secundaria y similar';
const ESTUDIOS_SECUNDARIOS = 'Educación secundaria segunda etapa';
const ESTUDIOS_FP_SUPERIOR = 'Enseñanzas de Formación Profesional de Grado Superior y similares';
const ESTUDIOS_GRADO = 'Grado (240 ETCS), Diplomatura, Ingeniería Técnica y similares';

function salariosDePrueba(estudios: Record<string, number>): DatosSalarios {
  return {
    fuentes: { salarios: 'Encuesta de prueba' },
    anio: 2022,
    grandes_grupos: { '2': { estudios, total: 30000 } },
  };
}

function perfilConEstudios(estudios: PerfilDelGrupo['estudios']): PerfilDelGrupo {
  return {
    cno11: '211',
    grupo: 'Primer grupo',
    amplio: false,
    estudios,
    situacion: { indefinido: 60, temporal: 20, cuentaPropia: 20 },
  };
}

test('el perfil usa el umbral inclusivo y publica únicamente estudios y situación del grupo', () => {
  const datos = datosEstadisticos({ censo: censoDePrueba() });
  assert.deepEqual(perfilesDelGrupo(datos, ['2111', '2112'], crearLengua(datos)), [
    {
      cno11: '211',
      grupo: 'Primer grupo',
      amplio: false,
      estudios: { obligatoria: 30, bachillerato: 20, fpGradoMedio: 10, fpGradoSuperior: 20, universitarios: 15 },
      situacion: { indefinido: 60, temporal: 20, cuentaPropia: 15 },
    },
  ]);
});

test('el perfil amplio sustituye al detalle insuficiente y a sus grupos contenidos', () => {
  const datos = datosEstadisticos({ censo: censoDePrueba() });
  const perfiles = perfilesDelGrupo(datos, ['2111', '2121', '2112'], crearLengua(datos));
  assert.deepEqual(
    perfiles.map(({ cno11, amplio }) => ({ cno11, amplio })),
    [{ cno11: '21', amplio: true }],
  );
});

test('sin censo o sin perfiles suficientes no publica un perfil', () => {
  const datos = datosEstadisticos();
  const lengua = crearLengua(datos);
  assert.deepEqual(perfilesDelGrupo(datos, ['2111'], lengua), []);
  datos.censo = censoDePrueba();
  datos.censo.min_personas_perfil = MINIMO_SIN_PERFIL;
  assert.deepEqual(perfilesDelGrupo(datos, ['2111'], lengua), []);
});

test('un empate de peso salarial elige el escalón más bajo y compara con el siguiente', () => {
  const datos = datosEstadisticos({
    censo: censoDePrueba(),
    salarios: salariosDePrueba({
      [ESTUDIOS_OBLIGATORIOS]: 20000.15,
      [ESTUDIOS_SECUNDARIOS]: 23000.25,
      [ESTUDIOS_FP_SUPERIOR]: 26000,
      [ESTUDIOS_GRADO]: 30000,
    }),
  });
  const lengua = crearLengua(datos);
  const perfiles = perfilesDelGrupo(datos, ['2111'], lengua);
  assert.deepEqual(salarioPorEstudios(datos, perfiles, lengua), {
    anio: 2022,
    granGrupo: '2',
    titulo: 'Gran grupo',
    escalones: [
      { escalon: 'obligatoria', euros: 20000.15 },
      { escalon: 'secundaria', euros: 23000.25 },
    ],
  });
});

test('bachillerato y FP media suman su peso para elegir secundaria', () => {
  const datos = datosEstadisticos({
    salarios: salariosDePrueba({
      [ESTUDIOS_SECUNDARIOS]: 23000,
      [ESTUDIOS_FP_SUPERIOR]: 26000,
    }),
  });
  const perfil = perfilConEstudios({
    obligatoria: 25,
    bachillerato: 20,
    fpGradoMedio: 20,
    fpGradoSuperior: 20,
    universitarios: 15,
  });
  assert.deepEqual(salarioPorEstudios(datos, [perfil], crearLengua(datos))?.escalones, [
    { escalon: 'secundaria', euros: 23000 },
    { escalon: 'fpSuperior', euros: 26000 },
  ]);
});

test('cuando falta el siguiente escalón compara con el anterior y conserva el orden académico', () => {
  const datos = datosEstadisticos({
    salarios: salariosDePrueba({
      [ESTUDIOS_SECUNDARIOS]: 0,
      [ESTUDIOS_FP_SUPERIOR]: 26000,
    }),
  });
  const perfil = perfilConEstudios({
    obligatoria: 10,
    bachillerato: 10,
    fpGradoMedio: 10,
    fpGradoSuperior: 60,
    universitarios: 10,
  });
  assert.deepEqual(salarioPorEstudios(datos, [perfil], crearLengua(datos))?.escalones, [
    { escalon: 'secundaria', euros: 0 },
    { escalon: 'fpSuperior', euros: 26000 },
  ]);
});

test('sin salario del escalón mayoritario o sin vecino inmediato no escoge otros escalones', () => {
  const perfil = perfilConEstudios({
    obligatoria: 10,
    bachillerato: 5,
    fpGradoMedio: 5,
    fpGradoSuperior: 70,
    universitarios: 10,
  });
  const datos = datosEstadisticos({ salarios: salariosDePrueba({ [ESTUDIOS_OBLIGATORIOS]: 20000 }) });
  const lengua = crearLengua(datos);
  assert.equal(salarioPorEstudios(datos, [perfil], lengua), null);
  datos.salarios = salariosDePrueba({ [ESTUDIOS_OBLIGATORIOS]: 20000, [ESTUDIOS_FP_SUPERIOR]: 26000 });
  assert.equal(salarioPorEstudios(datos, [perfil], lengua), null);
});

test('el salario exige un perfil y conserva ausencia de datos del gran grupo', () => {
  const datos = datosEstadisticos({ censo: censoDePrueba() });
  const lengua = crearLengua(datos);
  const perfiles = perfilesDelGrupo(datos, ['2111'], lengua);
  assert.equal(salariosDelGranGrupo(datos, perfiles), null);
  datos.salarios = { fuentes: { salarios: 'Encuesta' }, anio: 2022, grandes_grupos: {} };
  assert.equal(salariosDelGranGrupo(datos, []), null);
  assert.equal(salariosDelGranGrupo(datos, [...perfiles, ...perfiles]), null);
  assert.equal(salariosDelGranGrupo(datos, perfiles)?.salarios, undefined);
  assert.equal(salarioPorEstudios(datos, perfiles, lengua), null);
});

test('las lecturas salariales conservan la identidad de las tablas y no cambian el perfil', () => {
  const datos = datosEstadisticos({
    censo: censoDePrueba(),
    salarios: salariosDePrueba({
      [ESTUDIOS_OBLIGATORIOS]: 20000,
      [ESTUDIOS_SECUNDARIOS]: 23000,
    }),
  });
  const antes = structuredClone(datos);
  const lengua = crearLengua(datos);
  const perfiles = perfilesDelGrupo(datos, ['2111'], lengua);
  const perfilesAntes = structuredClone(perfiles);
  assert.equal(salariosDelGranGrupo(datos, perfiles)?.salarios, datos.salarios?.grandes_grupos['2']);
  salarioPorEstudios(datos, perfiles, lengua);
  assert.deepEqual(datos, antes);
  assert.deepEqual(perfiles, perfilesAntes);
});
