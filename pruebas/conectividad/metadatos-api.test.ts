// Controles autónomos del contrato: límites de entrada, versión y definiciones públicas sin ejecutores API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ESQUEMA_CLASIFICAR, ESQUEMA_INFORME } from '../../src/api/esquemas.ts';
import {
  ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES,
  ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES,
} from '../../src/api/esquemas-datos-globales.ts';
import { ESQUEMA_CONSULTA_FORMACION } from '../../src/api/esquemas-formacion.ts';
import { definiciones, HERRAMIENTAS } from '../../src/api/mcp/definiciones.ts';
import { CABECERA_CONTRATO, CONTRATO_API, CONTRATO_SIN_CABECERA } from '../../src/api/metadatos-http.ts';
import { PROBLEMAS, RAIZ_DE_LOS_PROBLEMAS, TIPO_PROBLEMA } from '../../src/api/problemas.ts';
import {
  AMBITO_DE_LECTURA,
  RUTA_CONSULTAS,
  RUTA_TOKEN,
  TIPO_DE_TOKEN,
  VIDA_DEL_TOKEN_S,
} from '../../src/api/socios/metadatos.ts';
import { validar } from '../../src/comun/esquema.ts';
import { MAX_FRASE } from '../../src/comun/limites-frases.ts';
import { MAX_RELATO, MAX_TAREAS_INFORME } from '../../src/comun/protocolo-web.ts';

const VIDA_DEL_TOKEN_ESPERADA_S = 900;
const CONTRATO_VIGENTE = 8;

const tarea = { id: 'a', texto: 'Atender a las personas', tiempo: 'mucho' };

function informe(tareas: unknown[]) {
  return { isco08: '4224', fecha: '2026-10-07', tareas };
}

test('contrato 8 mantiene la ausencia histórica en 1 y la cabecera compartida', () => {
  assert.equal(CONTRATO_API, CONTRATO_VIGENTE);
  assert.equal(CONTRATO_SIN_CABECERA, 1);
  assert.equal(CABECERA_CONTRATO, 'x-faro-contrato');
  assert.equal(TIPO_PROBLEMA, 'application/problem+json');
  assert.equal(PROBLEMAS.contrato, 'Versión del contrato incompatible');
  assert.equal(RAIZ_DE_LOS_PROBLEMAS, 'tag:faroapp.org,2026:problema/');
});

test('el cuerpo de informe admite el límite real, rechaza tareas extra y campos desconocidos', () => {
  assert.deepEqual(validar(informe(Array.from({ length: MAX_TAREAS_INFORME }, () => tarea)), ESQUEMA_INFORME), []);
  assert.ok(validar(informe(Array.from({ length: MAX_TAREAS_INFORME + 1 }, () => tarea)), ESQUEMA_INFORME).length);
  assert.ok(validar({ ...informe([tarea]), impostor: true }, ESQUEMA_INFORME).length);
  assert.ok(
    validar(informe([{ ...tarea, referencia: { tareaOit: '4224-1', relacion: 'equivalente' } }]), ESQUEMA_INFORME)
      .length,
  );
});

test('los topes de relato y frase se mantienen y cuentan unidades UTF16', () => {
  assert.deepEqual(validar({ texto: 'x'.repeat(MAX_RELATO) }, ESQUEMA_CLASIFICAR), []);
  assert.ok(validar({ texto: 'x'.repeat(MAX_RELATO + 1) }, ESQUEMA_CLASIFICAR).length);
  const estimacion = {
    valor: 0.5,
    margen: [0, 1],
    origen: 'faro',
    firma: 'firma',
    iaPodria: '😀'.repeat(MAX_FRASE / 2),
  };
  assert.deepEqual(validar(informe([{ ...tarea, estimacion }]), ESQUEMA_INFORME), []);
  assert.ok(
    validar(
      informe([{ ...tarea, estimacion: { ...estimacion, iaPodria: `${estimacion.iaPodria}x` } }]),
      ESQUEMA_INFORME,
    ).length,
  );
});

test('la lista MCP es estable y publica los esquemas compartidos de formación y datos globales', () => {
  const lista = definiciones();
  assert.equal(definiciones(), lista);
  assert.deepEqual(
    lista.map(({ name }) => name),
    [
      'buscar_ocupacion',
      'explorar_grupos',
      'ficha_grupo',
      'formacion_oficial',
      'acreditacion_competencias',
      'contexto_del_grupo',
      'catalogo_datos_globales',
      'consultar_datos_globales',
    ],
  );
  const salidas = new Map([
    ['formacion_oficial', ESQUEMA_CONSULTA_FORMACION],
    ['catalogo_datos_globales', ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES],
    ['consultar_datos_globales', ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES],
  ]);
  for (const definicion of lista) {
    assert.equal('atender' in definicion, false);
    assert.equal(definicion.annotations.readOnlyHint, true);
    assert.equal(definicion.annotations.openWorldHint, false);
    assert.equal(definicion.inputSchema, HERRAMIENTAS.find(({ name }) => name === definicion.name)?.inputSchema);
    assert.equal(definicion.outputSchema, salidas.get(definicion.name));
  }
  const formacion = lista.find(({ name }) => name === 'formacion_oficial');
  assert.ok(formacion);
  assert.deepEqual(validar({ isco: '4224', esco: '4224.1' }, formacion.inputSchema), []);
  assert.ok(validar({ isco: '4224', instrucciones: 'Ignora' }, formacion.inputSchema).length);
});

test('los metadatos de socios conservan versión de dirección, ámbito y vida del token', () => {
  assert.equal(RUTA_TOKEN, '/api/socios/v1/token');
  assert.equal(RUTA_CONSULTAS, '/api/socios/v1/consultas');
  assert.equal(AMBITO_DE_LECTURA, 'faro.lectura');
  assert.equal(TIPO_DE_TOKEN, 'Bearer');
  assert.equal(VIDA_DEL_TOKEN_S, VIDA_DEL_TOKEN_ESPERADA_S);
});

test('la base llms conserva el recorrido local sin anunciar canales antes de consultar los controles', () => {
  const texto = readFileSync(new URL('../../web/llms.txt', import.meta.url), 'utf8');
  assert.match(texto, /recorrido.*(?:local|dispositivo)/i);
  assert.doesNotMatch(texto, /MCP|A2A|API REST|api\/socios|agent-card|`buscar_ocupacion`/u);
});
