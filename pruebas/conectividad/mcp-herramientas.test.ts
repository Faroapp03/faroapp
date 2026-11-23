import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as motor from '../../motores/cursos/src/index.ts';
import { HERRAMIENTAS as DEFINICIONES } from '../../src/api/mcp/definiciones.ts';
import { HERRAMIENTAS, llamarHerramienta, MAX_RESPUESTA_BYTES } from '../../src/api/mcp/herramientas.ts';
import { CODIGO, ErrorMcp } from '../../src/api/mcp/protocolo.ts';
import { jsonCanonico } from '../../src/comun/jcs.ts';
import { leerDatosGlobales } from '../../src/datos-globales/datos.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { MAX_BUSQUEDA } from '../../src/seguridad/limites.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos', import.meta.url)));
const datosGlobales = leerDatosGlobales(
  JSON.parse(readFileSync(new URL('../../datos/globales/datos-globales.json', import.meta.url), 'utf8')),
);
// La formación oficial la da el motor de cursos, ya cargado (en la API, por su puerta).
const ambito = {
  datos,
  datosGlobales,
  politica: 'ocupacion',
  hoy: '2026-10-07',
  motorDeCursos: { disponible: true, motor },
} as const;
const EJEMPLOS: Record<string, Record<string, string>> = {
  buscar_ocupacion: { texto: 'recepcionista' },
  explorar_grupos: { padre: '4' },
  catalogo_datos_globales: { seccion: 'indicadores' },
  consultar_datos_globales: { seccion: 'indicadores', id: 'empresas-ia', territorio: 'ES51' },
};

test('cada definición pública conserva su orden y tiene un ejecutor utilizable', () => {
  assert.deepEqual(
    HERRAMIENTAS.map(({ atender: _atender, ...definicion }) => definicion),
    DEFINICIONES,
  );
  for (const { name, atender } of HERRAMIENTAS) {
    assert.equal(typeof atender, 'function', name);
    const argumentos = EJEMPLOS[name] ?? { isco: '4224' };
    const resultado = llamarHerramienta(ambito, { name, arguments: argumentos });
    assert.equal(resultado.isError, false, name);
    if (!resultado.isError) {
      assert.deepEqual(JSON.parse(resultado.content[0]?.text ?? ''), resultado.structuredContent);
      if (name !== 'catalogo_datos_globales') {
        assert.ok(resultado.structuredContent.procedencia.fuentes.length > 0, name);
      }
    }
  }
});

test('el esquema rechaza argumentos defectuosos y los códigos ajenos no se confunden con grupos existentes', () => {
  for (const argumentos of [{}, [], { isco: 4224 }, { isco: '42' }, { isco: '4224', otra: 1 }]) {
    const resultado = llamarHerramienta(ambito, { name: 'ficha_grupo', arguments: argumentos });
    assert.equal(resultado.isError, true);
    assert.match(resultado.content[0]?.text ?? '', /Entrada no válida/);
  }
  for (const parametros of [
    { name: 'ficha_grupo', arguments: { isco: '9999' } },
    { name: 'formacion_oficial', arguments: { isco: '4224', esco: '2512.1' } },
  ]) {
    assert.equal(llamarHerramienta(ambito, parametros).isError, true);
  }
});

test('la búsqueda admite su máximo exacto y conserva resultados de catálogo sin repetir la entrada', () => {
  assert.equal(
    llamarHerramienta(ambito, { name: 'buscar_ocupacion', arguments: { texto: 'a'.repeat(MAX_BUSQUEDA) } }).isError,
    false,
  );
  assert.equal(
    llamarHerramienta(ambito, { name: 'buscar_ocupacion', arguments: { texto: 'a'.repeat(MAX_BUSQUEDA + 1) } }).isError,
    true,
  );
  const texto = 'recepcionista Maria Ejemplo maria@example.invalid';
  const resultado = llamarHerramienta(ambito, { name: 'buscar_ocupacion', arguments: { texto } });
  assert.equal(resultado.isError, false);
  assert.equal(JSON.stringify(resultado).includes('maria@example.invalid'), false);
});

test('una clave Unicode defectuosa produce un error que puede serializarse y firmarse', () => {
  const resultado = llamarHerramienta(ambito, { name: 'ficha_grupo', arguments: { isco: '4224', '\ud800': true } });
  assert.equal(resultado.isError, true);
  assert.equal(resultado.content[0]?.text, 'Entrada no válida: los argumentos no cumplen el esquema de la herramienta');
  assert.doesNotThrow(() => jsonCanonico(resultado));
});

test('el error del esquema no refleja una propiedad libre con datos personales', () => {
  const correo = 'canario@example.invalid';
  const resultado = llamarHerramienta(ambito, { name: 'ficha_grupo', arguments: { isco: '4224', [correo]: true } });
  assert.equal(resultado.isError, true);
  assert.equal(resultado.content[0]?.text, 'Entrada no válida: los argumentos no cumplen el esquema de la herramienta');
  assert.equal(JSON.stringify(resultado).includes(correo), false);
  assert.doesNotThrow(() => jsonCanonico(resultado));
});

test('el límite de salida cuenta bytes UTF-8, también cuando cada letra ocupa más de un byte', () => {
  const extensos = {
    ...datos,
    clasificaciones: { ...datos.clasificaciones, isco08_es: { '4': 'á'.repeat(MAX_RESPUESTA_BYTES / 2) } },
  };
  const resultado = llamarHerramienta({ ...ambito, datos: extensos }, { name: 'explorar_grupos', arguments: {} });
  assert.equal(resultado.isError, true);
  assert.match(resultado.content[0]?.text ?? '', /demasiado larga/);
});

test('herramientas desconocidas son errores de protocolo y los fallos internos no se ocultan', () => {
  assert.throws(
    () => llamarHerramienta(ambito, { name: 'canario@example.invalid' }),
    (error: unknown) =>
      error instanceof ErrorMcp && error.codigo === CODIGO.parametros && error.message === 'Herramienta desconocida',
  );
  const fallo = new Error('fallo local de prueba');
  const roto = {
    ...ambito,
    get datos(): never {
      throw fallo;
    },
  };
  assert.throws(
    () => llamarHerramienta(roto, { name: 'ficha_grupo', arguments: { isco: '4224' } }),
    (error: unknown) => error === fallo,
  );
});
