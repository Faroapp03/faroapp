import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RUTA_A2A, tarjetaDeAgente, VERSION_A2A } from '../../src/api/a2a/tarjeta.ts';
import { HERRAMIENTAS } from '../../src/api/mcp/definiciones.ts';
import { validar } from '../../src/comun/esquema.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { VERSION_FARO } from '../../src/comun/version.ts';

test('la tarjeta publica sus enlaces bajo el origen de quien despliega la aplicación', () => {
  for (const origen of ['https://entidad.example', 'http://127.0.0.1:8787']) {
    const tarjeta = tarjetaDeAgente(origen);
    assert.deepEqual(tarjetaDeAgente(origen), tarjeta);
    assert.equal(tarjeta.skills.length, HERRAMIENTAS.length);
    assert.match(tarjeta.description, /retira los datos personales que reconoce su filtro/);
    assert.deepEqual(tarjeta.supportedInterfaces, [
      { url: `${origen}${RUTA_A2A}`, protocolBinding: 'JSONRPC', protocolVersion: VERSION_A2A },
    ]);
    assert.equal(tarjeta.documentationUrl, `${origen}/llms.txt`);
    assert.equal(tarjeta.version, VERSION_FARO);
    assert.deepEqual(tarjeta.capabilities, { streaming: false, pushNotifications: false, extendedAgentCard: false });
  }
});

test('las habilidades corresponden a las herramientas y solo la búsqueda admite texto libre', () => {
  const tarjeta = tarjetaDeAgente('https://entidad.example');
  assert.deepEqual(
    tarjeta.skills.map(({ id, name }) => ({ id, name })),
    HERRAMIENTAS.map(({ name, title }) => ({ id: name, name: title })),
  );
  for (const habilidad of tarjeta.skills) {
    assert.ok(habilidad.tags.includes('solo lectura'));
    if (habilidad.id === 'buscar_ocupacion') {
      assert.deepEqual(habilidad.inputModes, ['text/plain', 'application/json']);
    } else {
      assert.ok(!Object.hasOwn(habilidad, 'inputModes'));
      const ejemplo = habilidad.examples[0];
      assert.ok(ejemplo);
      assert.equal(JSON.parse(ejemplo).skill, habilidad.id);
    }
  }
});

test('mutar una tarjeta recibida no altera las listas de las siguientes respuestas', () => {
  const tarjeta = tarjetaDeAgente('https://entidad.example');
  const habilidad = tarjeta.skills[0];
  assert.ok(habilidad);
  habilidad.tags.push('Cambio del consumidor');
  habilidad.examples.length = 0;
  const otra = tarjetaDeAgente('https://entidad.example').skills[0];
  assert.ok(otra);
  assert.ok(!otra.tags.includes('Cambio del consumidor'));
  assert.ok(otra.examples.length > 0);
});

test('la tarjeta no ofrece inferencia ni ámbitos generativos', () => {
  const tarjeta = tarjetaDeAgente('https://entidad.example');
  assert.deepEqual(
    tarjeta.skills.map(({ id }) => id),
    HERRAMIENTAS.map(({ name }) => name),
  );
  assert.equal(Object.hasOwn(tarjeta, 'securitySchemes'), false);
  assert.ok(tarjeta.skills.every((habilidad) => !Object.hasOwn(habilidad, 'securityRequirements')));
});

test('las ocho lecturas publican ejemplos válidos y no atribuyen carácter oficial a los cálculos globales', () => {
  const tarjeta = tarjetaDeAgente('https://entidad.example');
  for (const habilidad of tarjeta.skills) {
    if (habilidad.id === 'buscar_ocupacion') {
      continue;
    }
    const definicion = HERRAMIENTAS.find(({ name }) => name === habilidad.id);
    const escrito = habilidad.examples[0];
    assert.ok(definicion && escrito);
    const ejemplo: unknown = JSON.parse(escrito);
    assert.ok(esObjeto(ejemplo));
    assert.deepEqual(validar(ejemplo.arguments, definicion.inputSchema), []);
    if (habilidad.id.endsWith('datos_globales')) {
      assert.equal(habilidad.tags.includes('datos oficiales'), false);
      assert.ok(habilidad.tags.includes('sin llamadas a modelos'));
    }
  }
});
