import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HERRAMIENTAS } from '../../src/api/mcp/definiciones.ts';
import { LICENCIAS } from '../../src/api/mcp/procedencia.ts';
import { CODIGO, ErrorMcp } from '../../src/api/mcp/protocolo.ts';
import { leerRecurso, listaDeRecursos } from '../../src/api/mcp/recursos.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { VERSION_FARO } from '../../src/comun/version.ts';

test('los recursos conservan orden, descripción sin contenido y datos de fuentes', () => {
  const lista = listaDeRecursos();
  assert.deepEqual(
    lista.map(({ uri }) => uri),
    ['faro://acerca', 'faro://fuentes'],
  );
  for (const recurso of lista) {
    assert.ok(!Object.hasOwn(recurso, 'texto'));
    const contenido = leerRecurso({ uri: recurso.uri }).contents[0];
    assert.ok(contenido);
    assert.equal(contenido.uri, recurso.uri);
    assert.equal(contenido.mimeType, recurso.mimeType);
  }
  const fuentes = leerRecurso({ uri: 'faro://fuentes' }).contents[0];
  assert.ok(fuentes);
  assert.deepEqual(JSON.parse(fuentes.text), { faro: VERSION_FARO, licencias: LICENCIAS });
  const primero = lista[0];
  assert.ok(primero);
  primero.title = 'Cambio del consumidor';
  assert.notEqual(listaDeRecursos()[0]?.title, primero.title);
});

test('un recurso desconocido informa el código de parámetros y no refleja la URI solicitada', () => {
  for (const uri of ['faro://canario@example.invalid', undefined, 0]) {
    assert.throws(
      () => leerRecurso({ uri }),
      (error: unknown) => {
        assert.ok(error instanceof ErrorMcp);
        assert.equal(error.codigo, CODIGO.parametros);
        assert.equal(error.estado, ESTADO_HTTP.correcto);
        assert.equal(error.datos, undefined);
        assert.equal(error.message, 'Recurso no encontrado');
        return true;
      },
    );
  }
});

test('el recurso acerca anuncia solo las ocho consultas actuales y el recorrido local', () => {
  const recurso = leerRecurso({ uri: 'faro://acerca' }).contents[0];
  assert.ok(recurso);
  const nombres = [...recurso.text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(([, nombre]) => nombre);
  assert.deepEqual(
    nombres,
    HERRAMIENTAS.map(({ name }) => name),
  );
  assert.match(recurso.text, /recorrido.*dispositivo/i);
  assert.doesNotMatch(recurso.text, /operaciones adicionales|proveedor configurado|presupuesto/i);
});
