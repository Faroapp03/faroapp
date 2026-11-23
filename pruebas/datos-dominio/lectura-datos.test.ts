// Lectura Node autónoma: huellas, partes opcionales, orden de errores y carpeta portátil sin depender del cwd.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';

const ESCO = {
  competencias: [['uri:competencia', 'Competencia', 'skill']],
  ocupaciones: {
    propia: {
      uri: 'uri:propia',
      titulo: 'Propia',
      isco08: '4226',
      competencias: [[0, 'e']],
    },
  },
};
const OBLIGATORIAS = {
  'esco.json': ESCO,
  'oit.json': {
    fuente: { cita: 'OIT', aviso_adaptacion: 'Adaptación' },
    ocupaciones: {},
    tareas: {},
  },
  'clasificaciones.json': { cno11: {}, isco08_es: {}, isco08_a_cno11: {} },
  'exposicion-cambra.json': {
    fuente: 'Cambra',
    genero: {
      mujeres_exposicion_media_o_alta: 0,
      hombres_exposicion_media_o_alta: 0,
      pagina_impresa: 1,
    },
  },
  'textos.json': {
    tareas: {},
    competencias_por_ocupacion: {},
    aviso_traduccion: 'Aviso',
  },
};
const VECTORES: NonNullable<Datos['vectores']> = {
  modelo: 'mínimo',
  dimensiones: 1,
  ids: [],
  escalas: [],
  datos: '',
};
const COMO_ARREGLARLO = 'vuelve a exportar el paquete (npm run datos:exportar)';
const BYTE_UTF8_INVALIDO = 0xff;
type Manifiesto = Record<string, { sha256: string }>;

/** Fixture completo de las partes obligatorias, aislado y con sus huellas exactas. */
function conPaquete(comprobar: (carpeta: string, manifiesto: Manifiesto) => void): void {
  const carpeta = mkdtempSync(join(tmpdir(), 'lectura-datos-'));
  const manifiesto: Manifiesto = {};
  for (const [nombre, parte] of Object.entries(OBLIGATORIAS)) {
    const texto = JSON.stringify(parte);
    writeFileSync(join(carpeta, nombre), texto);
    manifiesto[nombre] = {
      sha256: createHash('sha256').update(texto).digest('hex'),
    };
  }
  guardarManifiesto(carpeta, manifiesto);
  try {
    comprobar(carpeta, manifiesto);
  } finally {
    rmSync(carpeta, { recursive: true });
  }
}

/** Escribe el manifiesto del fixture después de una modificación deliberada. */
function guardarManifiesto(carpeta: string, manifiesto: Manifiesto): void {
  writeFileSync(join(carpeta, 'manifiesto.json'), JSON.stringify(manifiesto));
}

/** Exige el mismo tipo y diagnóstico del lector, sin depender de rutas de la máquina. */
function errorDe(mensaje: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.constructor, Error);
    assert.equal(error.message, mensaje);
    return true;
  };
}

test('lee las cinco partes obligatorias en orden y conserva ESCO sin compactación', () => {
  conPaquete((carpeta) => {
    const antes = readFileSync(join(carpeta, 'esco.json'));
    const datos = cargarDatos(carpeta);
    assert.deepEqual(Object.keys(datos), ['esco', 'oit', 'clasificaciones', 'cambra', 'textos']);
    assert.deepEqual(datos.esco, ESCO);
    assert.ok(Array.isArray(datos.esco.ocupaciones.propia?.competencias));
    assert.equal(datos.vectores, undefined);
    assert.deepEqual(readFileSync(join(carpeta, 'esco.json')), antes);
  });
});

test('lee una parte opcional existente y rechaza que carezca de huella', () => {
  conPaquete((carpeta, manifiesto) => {
    const texto = JSON.stringify(VECTORES);
    writeFileSync(join(carpeta, 'vectores-oit.json'), texto);
    assert.throws(
      () => cargarDatos(carpeta),
      errorDe(`El manifiesto del paquete no trae la huella de vectores-oit.json: ${COMO_ARREGLARLO}`),
    );
    manifiesto['vectores-oit.json'] = {
      sha256: createHash('sha256').update(texto).digest('hex'),
    };
    guardarManifiesto(carpeta, manifiesto);
    assert.deepEqual(cargarDatos(carpeta).vectores, VECTORES);
  });
});

test('omite un opcional ausente aunque el manifiesto lo nombre', () => {
  conPaquete((carpeta, manifiesto) => {
    manifiesto['vectores-oit.json'] = {
      sha256: createHash('sha256').update(JSON.stringify(VECTORES)).digest('hex'),
    };
    guardarManifiesto(carpeta, manifiesto);
    assert.equal(Object.hasOwn(cargarDatos(carpeta), 'vectores'), false);
  });
});

test('rechaza bytes alterados antes de intentar analizar su JSON o leer partes posteriores', () => {
  conPaquete((carpeta) => {
    writeFileSync(join(carpeta, 'esco.json'), '{');
    rmSync(join(carpeta, 'textos.json'));
    assert.throws(
      () => cargarDatos(carpeta),
      errorDe(`esco.json no coincide con su huella en manifiesto.json: ${COMO_ARREGLARLO}`),
    );
  });
});

test('una huella mal formada o ausente conserva el diagnóstico específico del manifiesto', () => {
  conPaquete((carpeta, manifiesto) => {
    manifiesto['esco.json'] = { sha256: 'no-es-una-huella' };
    guardarManifiesto(carpeta, manifiesto);
    assert.throws(
      () => cargarDatos(carpeta),
      errorDe(`El manifiesto del paquete no trae la huella de esco.json: ${COMO_ARREGLARLO}`),
    );
    delete manifiesto['esco.json'];
    guardarManifiesto(carpeta, manifiesto);
    assert.throws(
      () => cargarDatos(carpeta),
      errorDe(`El manifiesto del paquete no trae la huella de esco.json: ${COMO_ARREGLARLO}`),
    );
  });
});

test('un obligatorio ausente conserva el error de lectura del sistema', () => {
  conPaquete((carpeta) => {
    rmSync(join(carpeta, 'esco.json'));
    assert.throws(() => cargarDatos(carpeta), { code: 'ENOENT' });
  });
});

test('un JSON inválido con huella correcta conserva SyntaxError', () => {
  conPaquete((carpeta, manifiesto) => {
    const texto = '{';
    writeFileSync(join(carpeta, 'esco.json'), texto);
    manifiesto['esco.json'] = {
      sha256: createHash('sha256').update(texto).digest('hex'),
    };
    guardarManifiesto(carpeta, manifiesto);
    assert.throws(() => cargarDatos(carpeta), SyntaxError);
  });
});

test('conserva SyntaxError para un manifiesto con BOM', () => {
  conPaquete((carpeta, manifiesto) => {
    writeFileSync(join(carpeta, 'manifiesto.json'), `\uFEFF${JSON.stringify(manifiesto)}`);
    assert.throws(() => cargarDatos(carpeta), SyntaxError);
  });
});

test('rechaza UTF-8 malformado del manifiesto antes de cargar datos', () => {
  conPaquete((carpeta, manifiesto) => {
    const prefijo = JSON.stringify(manifiesto).slice(0, -1);
    writeFileSync(
      join(carpeta, 'manifiesto.json'),
      Buffer.concat([Buffer.from(`${prefijo},"nota":"`), Buffer.from([BYTE_UTF8_INVALIDO]), Buffer.from('"}')]),
    );
    assert.throws(() => cargarDatos(carpeta), {
      name: 'TypeError',
      code: 'ERR_ENCODING_INVALID_ENCODED_DATA',
    });
  });
});

test('rechaza UTF-8 malformado de un archivo aunque su huella sea correcta', () => {
  conPaquete((carpeta, manifiesto) => {
    const contenido = Buffer.concat([Buffer.from('{"dato":"'), Buffer.from([BYTE_UTF8_INVALIDO]), Buffer.from('"}')]);
    writeFileSync(join(carpeta, 'esco.json'), contenido);
    manifiesto['esco.json'] = {
      sha256: createHash('sha256').update(contenido).digest('hex'),
    };
    guardarManifiesto(carpeta, manifiesto);
    assert.throws(() => cargarDatos(carpeta), {
      name: 'TypeError',
      code: 'ERR_ENCODING_INVALID_ENCODED_DATA',
    });
  });
});

test('lee desde una carpeta con espacios, Unicode y signos de URL con un cwd ajeno', (contexto) => {
  conPaquete((carpeta) => {
    const portatil = join(carpeta, 'Año 2026 # %', 'datos oficiales');
    const ajeno = join(carpeta, 'cwd ajeno');
    mkdirSync(portatil, { recursive: true });
    mkdirSync(ajeno);
    for (const nombre of [...Object.keys(OBLIGATORIAS), 'manifiesto.json']) {
      writeFileSync(join(portatil, nombre), readFileSync(join(carpeta, nombre)));
    }
    const modulo = new URL('../../src/plataforma/node/datos.ts', import.meta.url).href;
    const programa =
      'const {cargarDatos}=await import(process.argv[1]); console.log(JSON.stringify(cargarDatos(process.argv[2])));';
    const ejecutado = spawnSync(process.execPath, ['--input-type=module', '--eval', programa, modulo, portatil], {
      cwd: ajeno,
      encoding: 'utf8',
    });
    contexto.diagnostic(`PID propio portátil: ${ejecutado.pid}`);
    assert.equal(ejecutado.error, undefined);
    assert.equal(ejecutado.status, 0, ejecutado.stderr);
    assert.deepEqual(JSON.parse(ejecutado.stdout), cargarDatos(carpeta));
    assert.equal(ejecutado.signal, null);
  });
});
