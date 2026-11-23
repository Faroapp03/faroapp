import { caminoDeLaRuta, RUTAS_API } from '../../src/api/api.ts';
// El contrato público y el protocolo del navegador se generan desde las mismas fuentes locales.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { artefactosDeContrato, documentoOpenApi, OPERACIONES } from '../../herramientas/api/openapi.ts';
import { rutasDeSocios } from '../../herramientas/api/openapi-socios.ts';
import { ESQUEMA_CONSULTA_FORMACION } from '../../src/api/esquemas-formacion.ts';
import { HERRAMIENTAS, HERRAMIENTAS_DATOS_GLOBALES } from '../../src/api/mcp/definiciones.ts';
import { CONTRATO_SIN_CABECERA } from '../../src/api/metadatos-http.ts';
import { AMBITO_DE_LECTURA, RUTA_CONSULTAS, RUTA_TOKEN } from '../../src/api/socios/metadatos.ts';
import { validar } from '../../src/comun/esquema.ts';
import { camposDe } from '../../src/comun/json.ts';
import * as protocolo from '../../src/comun/protocolo-web.ts';
import * as protocoloPublicado from '../../web/scripts/protocolo-web.js';

const GENERADOR = fileURLToPath(new URL('../../herramientas/api/openapi.ts', import.meta.url));
const PLAZO_COMANDO_MS = 30_000;
const SALIDA_ERROR_DE_USO = 2;
const CONTRATO_VIGENTE = 8;

test('cada ejemplo REST corresponde a una ruta y conserva sus alias y exclusiones', () => {
  assert.equal(OPERACIONES.length, RUTAS_API.length);
  for (const [indice, operacion] of OPERACIONES.entries()) {
    const camino = new URL(operacion.ejemplo, 'https://ejemplo.invalid').pathname;
    const coincidencias = RUTAS_API.filter((ruta) => ruta.metodo === operacion.metodo && ruta.patron.test(camino));
    assert.equal(coincidencias.length, 1, `${operacion.metodo} ${camino}`);
    assert.equal(coincidencias[0], RUTAS_API[indice]);
    assert.equal(caminoDeLaRuta(`${camino}/`), camino);
    assert.equal(
      RUTAS_API.filter((ruta) => ruta.metodo === operacion.metodo && ruta.patron.test(caminoDeLaRuta(`${camino}/`)))
        .length,
      1,
    );
  }
  const sinRuta = ['//api/salud', '/api/ocupaciones/abc', '/api/entender', '/api/enlazar', '/api/estimar'];
  for (const camino of [...sinRuta, '/api/informe', '/api/clasificar']) {
    assert.equal(
      RUTAS_API.some((ruta) => ruta.patron.test(camino)),
      false,
      camino,
    );
  }
});

test('el generador tiene un único destino OpenAPI junto al protocolo del navegador', () => {
  const artefactos = artefactosDeContrato();
  assert.deepEqual(
    [...artefactos.keys()].map((archivo) => archivo.href),
    [
      new URL('../../web/openapi.json', import.meta.url).href,
      new URL('../../web/scripts/protocolo-web.js', import.meta.url).href,
    ],
  );
});

test('las dos publicaciones coinciden byte a byte con sus fuentes y el navegador comparte todos los valores', () => {
  for (const [archivo, contenido] of artefactosDeContrato()) {
    assert.equal(readFileSync(archivo, 'utf8'), contenido, fileURLToPath(archivo));
  }
  assert.deepEqual({ ...protocoloPublicado }, { ...protocolo });
});

test('el contrato REST exige la versión vigente; la versión implícita histórica sigue siendo incompatible', () => {
  assert.equal(protocolo.CONTRATO_API, CONTRATO_VIGENTE);
  assert.notEqual(protocolo.CONTRATO_API, CONTRATO_SIN_CABECERA);
  const parametros = camposDe(camposDe(documentoOpenApi().components).parameters);
  const contrato = camposDe(parametros.Contrato);
  assert.equal(contrato.required, true);
  assert.deepEqual(camposDe(contrato.schema).enum, [String(protocolo.CONTRATO_API)]);
  assert.equal(contrato.name, protocolo.CABECERA_CONTRATO);
});

test('la consulta de socios y la definición MCP publican el mismo esquema de formación', () => {
  const herramienta = HERRAMIENTAS.find(({ name }) => name === 'formacion_oficial');
  assert.ok(herramienta);
  assert.equal(herramienta.outputSchema, ESQUEMA_CONSULTA_FORMACION);
  const ruta = camposDe(rutasDeSocios()[`${RUTA_CONSULTAS}/formacion_oficial`]);
  const respuesta = camposDe(camposDe(camposDe(ruta.get).responses)['200']);
  const json = camposDe(camposDe(respuesta.content)['application/json']);
  assert.equal(json.schema, ESQUEMA_CONSULTA_FORMACION);
});

test('la comprobación funciona desde otro directorio y una opción desconocida falla antes de escribir', () => {
  for (const [argumentos, esperado] of [
    [['--comprobar'], 0],
    [['--opcion-inexistente'], SALIDA_ERROR_DE_USO],
  ] as const) {
    const resultado = spawnSync(process.execPath, [GENERADOR, ...argumentos], {
      cwd: tmpdir(),
      encoding: 'utf8',
      timeout: PLAZO_COMANDO_MS,
    });
    assert.ifError(resultado.error);
    assert.equal(resultado.status, esperado, resultado.stderr || resultado.stdout);
  }
});

test('salud publica disponibilidad, versión e interruptores sin campos de proveedor', () => {
  const salud = OPERACIONES.find(({ ruta }) => ruta === '/api/salud');
  assert.ok(salud);
  for (const campo of ['cerebro', 'ia', 'estimador', 'turnstile', 'proveedor_ia']) {
    assert.equal(Object.hasOwn(salud.respuesta.properties ?? {}, campo), false);
  }
  assert.deepEqual(
    validar(
      {
        estado: 'ok',
        version: '1.0.0',
        interruptores: { formacionAbierta: 'publica', citilabPago: false, sinConexion: true },
      },
      salud.respuesta,
    ),
    [],
  );
  assert.ok(validar({ estado: 'ok', version: '1.0.0' }, salud.respuesta).length);
});

test('OpenAPI anuncia consultas factuales y no ofrece rutas ni ámbitos generativos', () => {
  const documento = documentoOpenApi();
  const paths = camposDe(documento.paths);
  for (const ruta of ['/api/entender', '/api/enlazar', '/api/estimar', '/api/informe', '/api/clasificar']) {
    assert.equal(Object.hasOwn(paths, ruta), false, ruta);
  }
  assert.ok(Object.keys(paths).every((ruta) => !ruta.startsWith('/api/socios/v1/operaciones/')));
  const oauth = camposDe(camposDe(paths[RUTA_TOKEN]).post);
  const formulario = camposDe(camposDe(camposDe(oauth.requestBody).content)['application/x-www-form-urlencoded']);
  const propiedades = camposDe(camposDe(formulario.schema).properties);
  assert.deepEqual(camposDe(propiedades.scope).enum, [AMBITO_DE_LECTURA]);
  assert.equal(camposDe(propiedades.resource).format, 'uri');
  const seguridad = camposDe(camposDe(documento.components).securitySchemes);
  const flujo = camposDe(camposDe(camposDe(seguridad.socios).flows).clientCredentials);
  assert.deepEqual(Object.keys(camposDe(flujo.scopes)), [AMBITO_DE_LECTURA]);
});

test('las dos consultas globales publican entradas y salidas completas comunes, con el ámbito de lectura', () => {
  const paths = camposDe(documentoOpenApi().paths);
  for (const { name, inputSchema, outputSchema } of HERRAMIENTAS_DATOS_GLOBALES) {
    const publicada = camposDe(camposDe(paths[`${RUTA_CONSULTAS}/${name}`]).get);
    assert.deepEqual(publicada.security, [{ socios: [AMBITO_DE_LECTURA] }]);
    const respuesta = camposDe(camposDe(camposDe(publicada.responses)['200']).content);
    assert.equal(camposDe(respuesta['application/json']).schema, outputSchema);
    const parametros = publicada.parameters;
    assert.ok(Array.isArray(parametros));
    assert.deepEqual(
      parametros.map((parametro) => camposDe(parametro).name),
      Object.keys(inputSchema.properties ?? {}),
    );
    for (const parametro of parametros) {
      const campo = camposDe(parametro);
      assert.equal(campo.schema, inputSchema.properties?.[String(campo.name)]);
      assert.equal(campo.required, inputSchema.required?.includes(String(campo.name)) ?? false);
    }
  }
});
