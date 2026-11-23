// Procedencia de los campos del informe y preparación de estimaciones para la API.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { marcaDelInforme } from '../../src/dominio/marca-del-informe.ts';
import { conIaDe, conIaDelPaquete } from '../../src/dominio/marca-ia.ts';
import type { OcupacionConfirmada } from '../../src/dominio/ocupacion-confirmada.ts';
import { prepararEstimacionesParaInforme, tareaInforme } from '../../src/dominio/tareas.ts';
import type { Entrada, TareaEntrada } from '../../src/dominio/tipos-entrada.ts';
import type { Informe, TareaInforme } from '../../src/dominio/tipos-informe.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';

const NOTA = 0.5;
const FUERA_DE_ESCALA = 1.1;
const OCUPACION: OcupacionConfirmada = { esco: null, isco08: '1111', secundario: '2222' };
const DATOS: Datos = {
  esco: { competencias: [], ocupaciones: {} },
  oit: {
    fuente: { cita: 'Fuente de prueba', aviso_adaptacion: 'Aviso de prueba' },
    ocupaciones: {},
    tareas: {
      principal: { isco08: '1111', indice: 1, texto_en: 'First', nota: NOTA, margen: [0, 1], metodo: 'predicted' },
      secundaria: { isco08: '2222', indice: 1, texto_en: 'Second', nota: NOTA, margen: null, metodo: 'predicted' },
      ajena: { isco08: '3333', indice: 1, texto_en: 'Third', nota: NOTA, margen: null, metodo: 'predicted' },
    },
  },
  textos: {
    aviso_traduccion: 'Traducción de prueba',
    competencias_por_ocupacion: {},
    tareas: {
      principal: {
        corto: 'Primera',
        texto_es: 'Primera tarea',
        ia_podria: 'Ordenar',
        lo_tuyo: 'Decidir',
        estado: 'redactado con IA',
      },
      secundaria: {
        corto: 'Segunda',
        texto_es: 'Segunda tarea',
        ia_podria: 'Revisar',
        lo_tuyo: 'Escuchar',
        estado: 'redacción manual',
      },
      ajena: { corto: 'Tercera', texto_es: 'Tercera tarea', ia_podria: 'Preparar' },
    },
  },
  clasificaciones: {
    cno11: {},
    isco08_a_cno11: {},
    isco08_es: { '1111': 'Principal', '2222': 'Secundario', '3333': 'Otro' },
  },
  cambra: {
    fuente: 'Fuente de prueba',
    genero: { mujeres_exposicion_media_o_alta: 0, hombres_exposicion_media_o_alta: 0, pagina_impresa: 1 },
  },
  catalan: {
    idioma: 'ca',
    marca: 'Marca de prueba',
    estado: 'traducido con IA',
    aviso_traduccion: 'Avís de prova',
    grupos: {},
    grupos_cno11: {},
    ocupaciones: {},
    tareas: { principal: { ia_podria: 'Ordenar en català' } },
    fuente_grupos: { cita: '', licencia: '', consultado: '2026-10-13' },
  },
};
const TAREA: TareaEntrada = { id: 't', texto: 'Trabajo confirmado', tiempo: 'algo' };
const BASE_INFORME: Omit<Informe, 'marcaIa'> = {
  version: 2,
  fecha: '2026-10-13',
  ocupacion: {
    esco: null,
    titulo: 'Principal',
    isco08: '1111',
    tituloIsco: 'Principal',
    media: null,
    gradiente: null,
    nivel: 'Sin nota',
    posicion: null,
  },
  tareas: [],
  semana: { alta: 0, media: 0, baja: 0, sinDatos: 0, pesoTotal: 0 },
  hallazgos: [],
  contexto: {
    ocupados: [],
    contratacion: [],
    periodo: null,
    variacionConjunto: null,
    genero: { mujeres: 0, hombres: 0, fuente: 'Fuente' },
    pendiente: null,
    zona: [],
    perfil: [],
    salario: null,
    avisoCenso: null,
    provincias: null,
    frente: null,
    adicional: null,
  },
  caminos: [],
  aprendizaje: {
    version: 3,
    idioma: 'es',
    fecha: '2026-10-13',
    fechaCursos: null,
    objetivos: [],
    opciones: [],
    fuentes: [],
  },
  plan: [],
  formacion: null,
  formacionTransversal: null,
  usoDeclaradoIa: null,
  fuentes: [],
  limites: [],
  avisos: [],
};

function entrada(tareas: TareaEntrada[]): Entrada {
  return { isco08: OCUPACION.isco08, isco08Secundario: OCUPACION.secundario ?? undefined, fecha: '2026-10-13', tareas };
}

function oficial(tareaOit: string, id = tareaOit): TareaEntrada {
  return { ...TAREA, id, referencia: { tareaOit, relacion: 'propia' } };
}

function estimada(id: string, cambios: Partial<NonNullable<TareaEntrada['estimacion']>> = {}): TareaEntrada {
  return {
    ...TAREA,
    id,
    estimacion: { valor: NOTA, margen: [0, 1], origen: 'faro', iaPodria: 'Ayudar', loTuyo: 'Elegir', ...cambios },
  };
}

function salida(tarea: TareaEntrada, idioma: 'es' | 'ca' = 'es', traducidas = new Map<string, string>()): TareaInforme {
  return tareaInforme(
    { datos: DATOS, ocupacion: OCUPACION, lengua: crearLengua(DATOS, idioma, traducidas), sinReferencias: false },
    tarea,
  );
}

function informe(tareas: TareaInforme[], cambios: Partial<Omit<Informe, 'marcaIa'>> = {}): Omit<Informe, 'marcaIa'> {
  return { ...structuredClone(BASE_INFORME), tareas, ...cambios };
}

test('la estimación real conserva notas, textos y procedencia sin inventar autor; el ejemplo no se atribuye a la IA', () => {
  const tarea = salida(estimada('estimada'));
  const antes = structuredClone(tarea);
  const marca = marcaDelInforme(informe([tarea]), DATOS);
  assert.deepEqual(marca.conIa, [
    conIaDe('/tareas/0/valor', 'estimado'),
    conIaDe('/tareas/0/iaPodria', 'redactado'),
    conIaDe('/tareas/0/loTuyo', 'redactado'),
  ]);
  assert.deepEqual(tarea, antes);
  assert.equal(tarea.valor, NOTA);
  assert.deepEqual(tarea.margen, [0, 1]);
  assert.deepEqual(marcaDelInforme(informe([salida(estimada('ejemplo', { origen: 'ejemplo' }))]), DATOS).conIa, []);
});

test('las traducciones aportadas de estimación se marcan después de su redacción y por índice del informe', () => {
  const traducciones = new Map([['Ayudar', 'Ajudar']]);
  const original = estimada('estimada', { loTuyo: undefined });
  const tareas = [salida(TAREA, 'ca'), salida(original, 'ca', traducciones)];
  const marca = marcaDelInforme(informe(tareas, { idioma: 'ca' }), DATOS, {
    frasesTraducidas: traducciones,
    tareasOriginales: new Map([[original.id, original]]),
  });
  assert.deepEqual(marca.conIa, [
    conIaDe('/tareas/1/valor', 'estimado'),
    conIaDe('/tareas/1/iaPodria', 'redactado'),
    conIaDe('/tareas/1/iaPodria', 'traducido'),
  ]);
});

test('la nota oficial tiene su fuente y distingue redacción y traducción de paquete o de autor desconocido', () => {
  const traducciones = new Map([['Decidir', 'Decidir en català']]);
  const tarea = salida(oficial('principal'), 'ca', traducciones);
  const marca = marcaDelInforme(informe([tarea], { idioma: 'ca' }), DATOS, { frasesTraducidas: traducciones });
  assert.deepEqual(marca.conIa, [
    conIaDelPaquete('/tareas/0/iaPodria', 'redactado'),
    conIaDelPaquete('/tareas/0/iaPodria', 'traducido'),
    conIaDelPaquete('/tareas/0/loTuyo', 'redactado'),
    conIaDe('/tareas/0/loTuyo', 'traducido'),
  ]);
  assert.ok(marca.sinIa.some(({ campo, origen }) => campo === '/tareas/0/valor' && origen === 'datos-oficiales'));
  assert.ok(marca.sinIa.some(({ campo, origen }) => campo === '/tareas/0/margen' && origen === 'datos-oficiales'));
});

test('los textos manuales solo marcan su traducción y la falta de autor conserva la procedencia', () => {
  assert.deepEqual(marcaDelInforme(informe([salida(oficial('secundaria'))]), DATOS).conIa, []);
  const traducciones = new Map([['Escuchar', 'Escoltar']]);
  const tarea = salida(oficial('secundaria'), 'ca', traducciones);
  assert.deepEqual(
    marcaDelInforme(informe([tarea], { idioma: 'ca' }), DATOS, { frasesTraducidas: traducciones }).conIa,
    [conIaDe('/tareas/0/loTuyo', 'traducido')],
  );
  assert.equal(marcaDelInforme(informe([salida(estimada('sin-autor'))]), DATOS).conIa[0]?.modelo, null);
});

test('una estimación descartada no aporta textos para traducir ni campos atribuibles a IA', () => {
  const original = entrada([
    estimada('descartada', { valor: FUERA_DE_ESCALA, margen: [FUERA_DE_ESCALA, FUERA_DE_ESCALA] }),
  ]);
  const antes = structuredClone(original);
  const preparada = prepararEstimacionesParaInforme(original);
  const tarea = preparada.entrada.tareas[0];
  assert.ok(tarea);
  const lengua = crearLengua(DATOS, 'ca');
  const resultado = tareaInforme(
    {
      datos: DATOS,
      ocupacion: OCUPACION,
      lengua,
      sinReferencias: false,
      tareasSinEstimacion: preparada.tareasSinEstimacion,
    },
    tarea,
  );
  assert.equal(resultado.motivoSinNota, 'estimacion-no-disponible');
  assert.deepEqual(
    [resultado.valor, resultado.margen, resultado.franja, resultado.iaPodria, resultado.loTuyo],
    [null, null, null, null, null],
  );
  const marca = marcaDelInforme(informe([resultado], { idioma: 'ca' }), DATOS, {
    frasesTraducidas: new Map([['Ayudar', 'Ajudar']]),
    tareasOriginales: new Map(preparada.entrada.tareas.map((original) => [original.id, original])),
  });
  assert.deepEqual(marca.conIa, []);
  assert.ok(marca.sinIa.some(({ campo, origen }) => campo === '/tareas/*' && origen === 'reglas-de-faro'));
  assert.deepEqual(original, antes);
});

test('los apartados presentes, la confirmación y sus palabras conservan su procedencia', () => {
  const ocupacion = {
    ...BASE_INFORME.ocupacion,
    confirmada: { texto: 'Confirmado', palabra: 'Mi palabra', secundario: null, propuestoPorIa: true as const },
  };
  const completo = informe([], {
    ocupacion,
    sinIa: { tareasPropias: 1 },
    formacionAbierta: { publica: [], noPublica: [], fuente: 'Fuente de prueba', criterio: 'Criterio de prueba' },
  });
  const antes = structuredClone(completo);
  const marca = marcaDelInforme(completo, DATOS);
  assert.deepEqual(marca.conIa, [conIaDe('/ocupacion/isco08', 'propuesto')]);
  for (const apartado of Object.keys(completo).filter((campo) => campo !== 'tareas')) {
    assert.ok(
      marca.sinIa.some(({ campo }) => campo === `/${apartado}`),
      apartado,
    );
  }
  assert.ok(marca.sinIa.some(({ campo, origen }) => campo === '/formacionAbierta' && origen === 'reglas-de-faro'));
  assert.ok(marca.sinIa.some(({ campo, origen }) => campo === '/aprendizaje/objetivos' && origen === 'reglas-de-faro'));
  assert.ok(marca.sinIa.some(({ campo, origen }) => campo === '/ocupacion/confirmada/palabra' && origen === 'persona'));
  assert.deepEqual(completo, antes);
});

test('un informe guardado sin idioma ni autor respeta el castellano y no necesita su marca previa', () => {
  const guardado = JSON.parse(JSON.stringify(informe([salida(oficial('principal'))])));
  assert.deepEqual(marcaDelInforme(guardado, DATOS).conIa, [
    conIaDelPaquete('/tareas/0/iaPodria', 'redactado'),
    conIaDelPaquete('/tareas/0/loTuyo', 'redactado'),
  ]);
});

test('una estimación sin traducción no hereda la traducción de otra aunque sus textos finales coincidan', () => {
  const sin = estimada('sin', { iaPodria: 'Controlar', loTuyo: undefined });
  const con = estimada('con', { iaPodria: 'Comprobar', loTuyo: undefined });
  const frasesTraducidas = new Map([['Comprobar', 'Controlar']]);
  const tareas = [sin, con].map((tarea) => salida(tarea, 'ca', frasesTraducidas));
  const marca = marcaDelInforme(informe(tareas, { idioma: 'ca' }), DATOS, {
    frasesTraducidas,
    tareasOriginales: new Map([
      [sin.id, sin],
      [con.id, con],
    ]),
  });
  assert.deepEqual(
    marca.conIa.filter(({ accion }) => accion === 'traducido'),
    [conIaDe('/tareas/1/iaPodria', 'traducido')],
  );
  assert.deepEqual(
    tareas.map(({ iaPodria }) => iaPodria),
    ['Controlar', 'Controlar'],
  );
});

test('la atribución usa ID y campo originales aunque el orden del informe cambie', () => {
  const con = estimada('con', { iaPodria: 'Comprobar', loTuyo: 'Controlar' });
  const sin = estimada('sin', { iaPodria: 'Controlar', loTuyo: undefined });
  const frasesTraducidas = new Map([['Comprobar', 'Controlar']]);
  const tareas = [sin, con].map((tarea) => salida(tarea, 'ca', frasesTraducidas));
  const marca = marcaDelInforme(informe(tareas, { idioma: 'ca' }), DATOS, {
    frasesTraducidas,
    tareasOriginales: new Map([
      [con.id, con],
      [sin.id, sin],
    ]),
  });
  assert.deepEqual(
    marca.conIa.filter(({ accion }) => accion === 'traducido'),
    [conIaDe('/tareas/1/iaPodria', 'traducido')],
  );
});

test('un mapa identitario solo atribuye traducción en el idioma en que realmente se utiliza', () => {
  const original = estimada('t', { iaPodria: 'Controlar', loTuyo: undefined });
  const frasesTraducidas = new Map([['Controlar', 'Controlar']]);
  const contexto = { frasesTraducidas, tareasOriginales: new Map([[original.id, original]]) };
  const castellano = marcaDelInforme(informe([salida(original, 'es', frasesTraducidas)]), DATOS, contexto);
  assert.deepEqual(
    castellano.conIa.filter(({ accion }) => accion === 'traducido'),
    [],
  );
  const catalan = marcaDelInforme(
    informe([salida(original, 'ca', frasesTraducidas)], { idioma: 'ca' }),
    DATOS,
    contexto,
  );
  assert.deepEqual(
    catalan.conIa.filter(({ accion }) => accion === 'traducido'),
    [conIaDe('/tareas/0/iaPodria', 'traducido')],
  );
});

test('las frases oficiales atribuyen cada traducción a su referencia y campo sin colisiones', () => {
  const frasesTraducidas = new Map([['Decidir', 'Escuchar']]);
  const tareas = [
    salida(oficial('principal'), 'ca', frasesTraducidas),
    salida(oficial('secundaria'), 'ca', frasesTraducidas),
  ];
  const marca = marcaDelInforme(informe(tareas, { idioma: 'ca' }), DATOS, { frasesTraducidas });
  assert.deepEqual(
    marca.conIa.filter(({ accion, modo }) => accion === 'traducido' && modo === null),
    [conIaDe('/tareas/0/loTuyo', 'traducido')],
  );
});

test('sin original o con campo ausente no se inventa una traducción por coincidencia del texto final', () => {
  const original = estimada('t', { iaPodria: 'Controlar', loTuyo: undefined });
  const tarea = salida(original, 'ca');
  const frasesTraducidas = new Map([['Comprobar', 'Controlar']]);
  const sinOriginal = marcaDelInforme(informe([tarea], { idioma: 'ca' }), DATOS, { frasesTraducidas });
  assert.deepEqual(
    sinOriginal.conIa.filter(({ accion }) => accion === 'traducido'),
    [],
  );
  const sinCampo = estimada('t', { iaPodria: undefined, loTuyo: undefined });
  const marca = marcaDelInforme(informe([tarea], { idioma: 'ca' }), DATOS, {
    frasesTraducidas,
    tareasOriginales: new Map([[sinCampo.id, sinCampo]]),
  });
  assert.deepEqual(
    marca.conIa.filter(({ accion }) => accion === 'traducido'),
    [],
  );
});
