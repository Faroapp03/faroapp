// Formas serializadas del paquete: campos completos, tuplas y traducciones parciales, con muestras autónomas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esObjeto, type Guarda } from '../../src/comun/json.ts';
import {
  esDatosCatalan,
  esDatosEsco,
  esDatosOit,
  esDatosTextos,
  esVectoresFormacion,
  esVectoresGuardados,
} from '../../src/dominio/esquemas-paquete.ts';

const VECTOR = { modelo: 'prueba', dimensiones: 2, ids: ['uno'], escalas: [1], datos: 'AAA=' };
const MUESTRAS: Record<string, unknown> = {
  'esco.json': {
    competencias: [['uri', 'titulo', 'tipo']],
    ocupaciones: {
      '4311.1': {
        uri: 'uri',
        titulo: 'Ocupación',
        isco08: '4311',
        alternativos: ['Alternativo'],
        descripcion: '',
        competencias: [[0, 'e']],
      },
    },
  },
  'oit.json': {
    fuente: { cita: 'OIT', aviso_adaptacion: '' },
    ocupaciones: { '4311': { titulo_en: 'Occupation', media: null, sd: null, gradiente: null } },
    tareas: { '4311-1': { isco08: '4311', indice: 1, texto_en: 'Task', nota: null, margen: null, metodo: null } },
  },
  'textos.json': {
    tareas: { '4311-1': { corto: 'Tarea', texto_es: 'Tarea de ejemplo' } },
    competencias_por_ocupacion: {},
    aviso_traduccion: '',
  },
  'catalan.json': {
    idioma: 'ca',
    marca: '',
    estado: '',
    aviso_traduccion: '',
    tareas: {},
    grupos: {},
    ocupaciones: {},
    grupos_cno11: {},
    fuente_grupos: { cita: '', licencia: '', consultado: '2026-10-13' },
  },
  'vectores-oit.json': VECTOR,
  'vectores-formacion.json': { ocupaciones: VECTOR, especialidades: VECTOR },
};

function muestraDe(archivo: string): unknown {
  assert.ok(Object.hasOwn(MUESTRAS, archivo));
  return structuredClone(MUESTRAS[archivo]);
}

function muestraComprobada<Forma>(archivo: string, esForma: Guarda<Forma>): Forma {
  const valor = muestraDe(archivo);
  assert.ok(esForma(valor));
  return valor;
}

/** Un tercer elemento de más en el margen de una tarea, que es un par [inferior, superior]. */
const TERCER_EXTREMO = 3;

/**
 * Una copia de una muestra del paquete con un campo cambiado, recibida como unknown para no ocultar el tipo de ningún
 * campo. Cada llamada trabaja con una copia propia, sin modificar otras muestras.
 *
 * @param archivo - El nombre del archivo dentro del paquete.
 * @param ruta - Las claves (o posiciones de lista, como texto) hasta el campo que se cambia.
 * @param valor - El valor nuevo del campo.
 * @returns La copia cambiada del archivo.
 */
function paqueteConCampo(archivo: string, ruta: string[], valor: unknown): unknown {
  assert.ok(ruta.length > 0);
  const copia = muestraDe(archivo);
  let objeto = copia;
  for (const clave of ruta.slice(0, -1)) {
    assert.ok(esObjeto(objeto) || Array.isArray(objeto));
    objeto = Array.isArray(objeto) ? objeto[Number(clave)] : objeto[clave];
  }
  assert.ok(esObjeto(objeto) || Array.isArray(objeto));
  const ultima = ruta.at(-1);
  assert.ok(ultima);
  if (Array.isArray(objeto)) {
    objeto[Number(ultima)] = valor;
  } else {
    objeto[ultima] = valor;
  }
  return copia;
}

test('las guardas comprueban todas las formas, admiten extras y no modifican las muestras', () => {
  const contratos: [string, Guarda<unknown>, string[]][] = [
    ['esco.json', esDatosEsco, ['competencias', 'ocupaciones']],
    ['oit.json', esDatosOit, ['fuente', 'ocupaciones', 'tareas']],
    ['textos.json', esDatosTextos, ['tareas', 'competencias_por_ocupacion', 'aviso_traduccion']],
    [
      'catalan.json',
      esDatosCatalan,
      [
        'idioma',
        'marca',
        'estado',
        'aviso_traduccion',
        'tareas',
        'grupos',
        'ocupaciones',
        'grupos_cno11',
        'fuente_grupos',
      ],
    ],
    ['vectores-oit.json', esVectoresGuardados, ['modelo', 'dimensiones', 'ids', 'escalas', 'datos']],
    ['vectores-formacion.json', esVectoresFormacion, ['especialidades', 'ocupaciones']],
  ];
  for (const [archivo, esForma, requeridos] of contratos) {
    const ruta = archivo;
    const leido = muestraDe(ruta);
    const antes = JSON.stringify(leido);
    assert.ok(esForma(leido), archivo);
    assert.equal(JSON.stringify(leido), antes, `${archivo}: no cambia los datos recibidos`);
    assert.deepEqual(muestraComprobada(ruta, esForma), leido, archivo);
    assert.ok(esObjeto(leido));
    const conExtra = { ...leido, extra: ['se conserva'] };
    assert.ok(esForma(conExtra), `${archivo}: campos extra`);
    assert.equal(conExtra.extra[0], 'se conserva');
    for (const campo of requeridos) {
      const incompleto: Record<string, unknown> = { ...leido };
      delete incompleto[campo];
      assert.equal(esForma(incompleto), false, `${archivo}: falta ${campo}`);
    }
    assert.equal(esForma(null), false, archivo);
    assert.equal(esForma([]), false, archivo);
  }
});

test('ESCO comprueba cada tupla y las relaciones de todas las ocupaciones', () => {
  const esco = muestraComprobada('esco.json', esDatosEsco);
  const ids = Object.keys(esco.ocupaciones);
  const ultima = ids.at(-1) ?? '';
  assert.ok(ultima);
  for (const competencia of [[], ['uri', 'título'], ['uri', 'título', 1], ['uri', 'título', 'tipo', 'extra']]) {
    assert.equal(esDatosEsco({ ...esco, competencias: [...esco.competencias, competencia] }), false);
  }
  for (const relacion of [[1], [1, 'e', 'extra'], ['1', 'e'], [1, 'otra'], null]) {
    assert.equal(esDatosEsco(paqueteConCampo('esco.json', ['ocupaciones', ultima, 'competencias'], [relacion])), false);
  }
  for (const campo of ['uri', 'titulo', 'isco08', 'descripcion']) {
    assert.equal(esDatosEsco(paqueteConCampo('esco.json', ['ocupaciones', ultima, campo], 1)), false, campo);
  }
  assert.equal(esDatosEsco(paqueteConCampo('esco.json', ['ocupaciones', ultima, 'alternativos'], ['uno', 2])), false);
});

test('OIT conserva nulos reales y comprueba fuente, ocupaciones, tareas y tuplas exactas', () => {
  const oit = muestraComprobada('oit.json', esDatosOit);
  const tarea = Object.keys(oit.tareas).at(-1) ?? '';
  const ocupacion = Object.keys(oit.ocupaciones).at(-1) ?? '';
  for (const campo of ['cita', 'aviso_adaptacion']) {
    assert.equal(esDatosOit(paqueteConCampo('oit.json', ['fuente', campo], 1)), false, campo);
  }
  for (const campo of ['media', 'sd', 'gradiente']) {
    assert.ok(esDatosOit(paqueteConCampo('oit.json', ['ocupaciones', ocupacion, campo], null)), campo);
    const invalido = campo === 'gradiente' ? 1 : '1';
    assert.equal(esDatosOit(paqueteConCampo('oit.json', ['ocupaciones', ocupacion, campo], invalido)), false, campo);
  }
  assert.equal(esDatosOit(paqueteConCampo('oit.json', ['ocupaciones', ocupacion, 'titulo_en'], 1)), false);
  for (const campo of ['nota', 'margen', 'metodo']) {
    assert.ok(esDatosOit(paqueteConCampo('oit.json', ['tareas', tarea, campo], null)), campo);
  }
  for (const [campo, valor] of [
    ['isco08', 1],
    ['indice', '1'],
    ['texto_en', null],
    ['nota', '1'],
    ['metodo', 1],
  ]) {
    assert.equal(
      esDatosOit(paqueteConCampo('oit.json', ['tareas', tarea, String(campo)], valor)),
      false,
      String(campo),
    );
  }
  for (const margen of [[], [1], [1, 2, TERCER_EXTREMO], ['1', 2]]) {
    assert.equal(esDatosOit(paqueteConCampo('oit.json', ['tareas', tarea, 'margen'], margen)), false);
  }
  assert.ok(esDatosOit(paqueteConCampo('oit.json', ['tareas', tarea, 'nota'], -1)));
});

test('textos y catalán comprueban sus campos anidados y conservan traducciones parciales', () => {
  const textos = muestraComprobada('textos.json', esDatosTextos);
  const tarea = Object.keys(textos.tareas).at(-1) ?? '';
  for (const campo of ['corto', 'texto_es', 'ia_podria', 'lo_tuyo', 'estado']) {
    assert.equal(esDatosTextos(paqueteConCampo('textos.json', ['tareas', tarea, campo], 1)), false, campo);
  }
  assert.equal(esDatosTextos({ ...textos, competencias_por_ocupacion: { grupo: { tarea: ['una', 1] } } }), false);
  const catalan = muestraComprobada('catalan.json', esDatosCatalan);
  assert.ok(esDatosCatalan({ ...catalan, tareas: { tarea: {} } }));
  assert.equal(esDatosCatalan({ ...catalan, idioma: 'es' }), false);
  for (const campo of ['marca', 'estado', 'aviso_traduccion']) {
    assert.equal(esDatosCatalan(paqueteConCampo('catalan.json', [campo], 1)), false, campo);
  }
  for (const campo of ['corto', 'texto', 'ia_podria', 'lo_tuyo']) {
    assert.equal(esDatosCatalan({ ...catalan, tareas: { tarea: { [campo]: 1 } } }), false, campo);
  }
  for (const campo of ['grupos', 'ocupaciones', 'grupos_cno11']) {
    assert.equal(esDatosCatalan({ ...catalan, [campo]: { uno: 'uno', dos: 2 } }), false, campo);
  }
  for (const campo of ['cita', 'licencia', 'consultado']) {
    assert.equal(esDatosCatalan(paqueteConCampo('catalan.json', ['fuente_grupos', campo], 1)), false, campo);
  }
});

test('vectores comprueban también índices y escalas posteriores sin cambiar sus políticas numéricas', () => {
  const vector = muestraComprobada('vectores-oit.json', esVectoresGuardados);
  assert.equal(esVectoresGuardados({ ...vector, ids: ['primero', 2] }), false);
  assert.equal(esVectoresGuardados({ ...vector, escalas: [1, '2'] }), false);
  for (const campo of ['modelo', 'datos']) {
    assert.equal(esVectoresGuardados({ ...vector, [campo]: 1 }), false, campo);
  }
  assert.equal(esVectoresGuardados({ ...vector, dimensiones: '1' }), false);
  assert.ok(esVectoresGuardados({ ...vector, dimensiones: -1, escalas: [NaN, Infinity] }));
  assert.equal(esVectoresFormacion({ especialidades: vector, ocupaciones: { ...vector, ids: [null] } }), false);
});
