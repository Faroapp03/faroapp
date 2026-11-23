// Fuentes, licencias y avisos por idioma y contenido efectivo del informe.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avisosDeOcupacion,
  avisosDeTraduccion,
  avisosInforme,
  citaOit,
  citasDelGrupo,
  fuentesInforme,
} from '../../src/dominio/fuentes-y-avisos.ts';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { prepararEstimacionesParaInforme, tareaInforme } from '../../src/dominio/tareas.ts';
import type { Entrada } from '../../src/dominio/tipos-entrada.ts';
import type { Contexto } from '../../src/dominio/tipos-informe.ts';
import { datosMinimos } from '../fixtures/datos-referencias-grupos.ts';

function datosDePrueba() {
  const datos = datosMinimos();
  datos.oit.fuente = { cita: 'Cita OIT', aviso_adaptacion: 'Aviso de adaptación' };
  datos.textos.aviso_traduccion = 'Aviso de traducción';
  datos.cambra.fuente = 'Cita Cambra';
  return datos;
}

const ENTRADA: Entrada = {
  isco08: '4226',
  fecha: '2026-10-07',
  tareas: [{ id: 'a', texto: 'Organizar citas', tiempo: 'algo' }],
};
const OCUPACION = { esco: null, isco08: '4226', secundario: null };
const SIN_FORMACION = { formacion: null, formacionTransversal: null };

function contextoVacio(): Contexto {
  return {
    ocupados: [],
    contratacion: [],
    periodo: null,
    variacionConjunto: null,
    genero: { mujeres: 0, hombres: 0, fuente: '' },
    pendiente: null,
    zona: [],
    perfil: [],
    salario: null,
    avisoCenso: null,
    provincias: null,
    frente: null,
    adicional: null,
  };
}

test('la cita OIT conserva texto, orden y ambos avisos de licencia en inglés', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const datos = datosDePrueba();
    const lengua = crearLengua(datos, idioma);
    const cita = 'Cita OIT Aviso de adaptación Aviso de traducción';
    assert.equal(citaOit(datos, lengua), cita);
    assert.deepEqual(lengua.sinTraducir(), [{ texto: cita, idioma: 'en' }]);
  }
});

test('las fuentes conservan su nivel, orden y lengua sin mutar las citas aportadas', () => {
  const datos = datosDePrueba();
  const lengua = crearLengua(datos);
  const citas = ['Cita del grupo'];
  const salida = fuentesInforme(datos, SIN_FORMACION, citas, lengua);
  const textos = lengua.textos.fuentes;
  assert.deepEqual(salida, [
    { texto: 'Cita OIT Aviso de adaptación Aviso de traducción', nivel: 'oficial' },
    { texto: textos.notasPorTarea, nivel: 'complementaria' },
    { texto: textos.esco, nivel: 'oficial' },
    { texto: textos.ine, nivel: 'oficial' },
    { texto: 'Cita del grupo', nivel: 'oficial' },
    { texto: `Cita Cambra ${textos.cifrasVerificadas}`, nivel: 'oficial' },
    { texto: textos.elaboracionFaro, nivel: 'faro' },
  ]);
  assert.deepEqual(citas, ['Cita del grupo']);
  assert.ok(lengua.sinTraducir().some(({ texto, idioma }) => texto === 'Cita Cambra' && idioma === 'ca'));
});

test('un contexto sin bloques no cita fuentes opcionales ni inventa la del Idescat', () => {
  const datos = datosDePrueba();
  const lengua = crearLengua(datos);
  const contexto = contextoVacio();
  assert.deepEqual(citasDelGrupo(datos, { contexto, usoDeclaradoIa: null }, lengua), []);
  contexto.ocupados.push({
    cno11: '42',
    grupo: 'Grupo',
    amplio: true,
    organismo: 'Idescat',
    anio: '2024',
    personas: 100,
    pctMujeres: null,
    pctMenores30: null,
    pct55: null,
    variacion: null,
  });
  assert.deepEqual(citasDelGrupo(datos, { contexto, usoDeclaradoIa: null }, lengua), []);
  datos.ocupados = {
    fuentes: { idescat: 'Cita anual' },
    anios: ['2024'],
    fecha_de_referencia: '2024-01-01',
    comparable_desde: '2022',
    min_personas: 1,
    cataluna_cno3: {},
    cataluna_cno2: {},
    territorios: {},
  };
  assert.deepEqual(citasDelGrupo(datos, { contexto, usoDeclaradoIa: null }, lengua), ['Cita anual']);
});

test('los avisos distinguen origen de las notas y mantienen su orden y el motivo de ausencia', () => {
  const datos = datosDePrueba();
  const lengua = crearLengua(datos);
  const tarea = ENTRADA.tareas[0];
  assert.ok(tarea);
  const salida = tareaInforme({ datos, ocupacion: OCUPACION, lengua, sinReferencias: false }, tarea);
  const entrada: Entrada = {
    ...ENTRADA,
    tareas: [
      { ...tarea, estimacion: { valor: 0.5, margen: [0, 1], origen: 'ejemplo' } },
      { ...tarea, id: 'b', estimacion: { valor: 0.5, margen: [0, 1], origen: 'faro-sin-validar' } },
    ],
  };
  const texto = lengua.textos.avisos;
  assert.deepEqual(
    avisosInforme(entrada, datos, [{ ...salida, incierta: true }], {
      formacion: null,
      textos: lengua.textos,
      sinReferencias: false,
    }),
    [texto.ejemplo, texto.sinValidar, texto.sinCataluna, texto.sinFormacion, texto.inciertas, texto.insuficientes],
  );
  assert.deepEqual(
    avisosInforme(ENTRADA, datos, [salida], {
      formacion: null,
      textos: lengua.textos,
      sinReferencias: true,
    }),
    [texto.sinCataluna, texto.sinFormacion, texto.sinReferencias],
  );
});

test('una estimación descartada no genera avisos sobre una nota de ejemplo o provisional inexistente', () => {
  const datos = datosDePrueba();
  const tarea = ENTRADA.tareas[0];
  assert.ok(tarea);
  for (const origen of ['ejemplo', 'faro-sin-validar'] as const) {
    const fueraDeEscala = 1.1;
    const entrada: Entrada = {
      ...ENTRADA,
      tareas: [{ ...tarea, estimacion: { valor: fueraDeEscala, margen: [fueraDeEscala, fueraDeEscala], origen } }],
    };
    const preparada = prepararEstimacionesParaInforme(entrada);
    const lengua = crearLengua(datos);
    const tareas = preparada.entrada.tareas.map((t) =>
      tareaInforme(
        {
          datos,
          ocupacion: OCUPACION,
          lengua,
          sinReferencias: false,
          tareasSinEstimacion: preparada.tareasSinEstimacion,
        },
        t,
      ),
    );
    const avisos = avisosInforme(preparada.entrada, datos, tareas, {
      formacion: null,
      textos: lengua.textos,
      sinReferencias: false,
    });
    assert.ok(avisos.includes(lengua.textos.avisos.insuficientes));
    assert.ok(!avisos.includes(lengua.textos.avisos.ejemplo));
    assert.ok(!avisos.includes(lengua.textos.avisos.sinValidar));
  }
});

test('la ocupación ESCO omite avisos de grupo y el grupo explica competencias sin relación individual', () => {
  const datos = datosDePrueba();
  const lengua = crearLengua(datos);
  const tarea = ENTRADA.tareas[0];
  assert.ok(tarea);
  const sinNota = tareaInforme({ datos, ocupacion: OCUPACION, lengua, sinReferencias: false }, tarea);
  assert.deepEqual(avisosDeOcupacion({ ...OCUPACION, esco: 'oficio' }, [sinNota], lengua), []);
  assert.deepEqual(avisosDeOcupacion(OCUPACION, [sinNota], lengua), [lengua.textos.avisos.grupoSinEsco]);
  sinNota.competencias.push({ uri: 'competencia', titulo: 'Competencia', relacion: 'sin-ocupacion' });
  assert.deepEqual(avisosDeOcupacion(OCUPACION, [sinNota], lengua), [
    lengua.textos.avisos.grupoSinEsco,
    lengua.textos.avisos.competenciasSinOcupacion,
  ]);
});

test('los avisos de traducción solo describen lo realmente usado por la lengua catalana', () => {
  const datos = datosDePrueba();
  const castellano = crearLengua(datos);
  castellano.original('English', 'en');
  assert.deepEqual(avisosDeTraduccion(castellano), []);
  const catalan = crearLengua(datos, 'ca');
  assert.deepEqual(avisosDeTraduccion(catalan), []);
  catalan.original('Español', 'es');
  assert.ok(catalan.textos.traduccion);
  assert.deepEqual(avisosDeTraduccion(catalan), [catalan.textos.traduccion.sinTraducir]);
  catalan.usar({ texto: 'Traducció de Faro', idioma: 'ca' });
  assert.deepEqual(avisosDeTraduccion(catalan), [
    catalan.textos.traduccion.deFaro,
    catalan.textos.traduccion.sinTraducir,
  ]);
});
