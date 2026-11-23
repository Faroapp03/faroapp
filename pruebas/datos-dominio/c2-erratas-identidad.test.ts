import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalanConErratas, ERRATAS_ESCO } from '../../src/dominio/erratas-esco.ts';
import type { DatosCatalan, DatosEsco } from '../../src/dominio/tipos-paquete.ts';
import { prepararParte } from '../../src/plataforma/archivos-del-paquete.ts';

function catalan(codigo: string): DatosCatalan {
  return {
    idioma: 'ca',
    marca: '',
    estado: '',
    aviso_traduccion: '',
    tareas: {},
    grupos: {},
    ocupaciones: { [codigo]: 'Títol original' },
    grupos_cno11: {},
    fuente_grupos: { cita: '', licencia: '', consultado: '' },
  };
}
function esco(codigo: string, uri: string): DatosEsco {
  return { competencias: [], ocupaciones: { [codigo]: { uri, titulo: 'Original', isco08: '0000', competencias: [] } } };
}

test('la errata catalana exige URI coincidente y no muta ninguna entrada', () => {
  const errata = ERRATAS_ESCO[0];
  assert.ok(errata);
  const original = catalan(errata.esco);
  const identidad = esco(errata.esco, errata.uri);
  const antes = structuredClone({ original, identidad });
  const corregido = catalanConErratas(original, identidad);
  assert.equal(corregido.ocupaciones[errata.esco], errata.tituloCa);
  assert.notEqual(corregido, original);
  assert.deepEqual({ original, identidad }, antes);
  assert.equal(catalanConErratas(original, esco(errata.esco, 'otra-uri')), original);
  assert.equal(catalanConErratas(original, { competencias: [], ocupaciones: {} }), original);
  assert.equal(catalanConErratas(original), original);
  assert.deepEqual(prepararParte('catalan', original, identidad), corregido);
  assert.equal(prepararParte('catalan', original, esco(errata.esco, 'otra-uri')), original);
});

test('el paquete vigente conserva byte a byte los títulos catalanes anteriores', () => {
  const datos = new URL('../../datos/', import.meta.url);
  const catalanOriginal = JSON.parse(readFileSync(new URL('catalan.json', datos), 'utf8')) as DatosCatalan;
  const escoOriginal = JSON.parse(readFileSync(new URL('esco.json', datos), 'utf8')) as DatosEsco;
  const anterior = structuredClone(catalanOriginal);
  for (const errata of ERRATAS_ESCO) {
    if (anterior.ocupaciones[errata.esco] !== undefined) {
      anterior.ocupaciones[errata.esco] = errata.tituloCa;
    }
  }
  assert.equal(JSON.stringify(catalanConErratas(catalanOriginal, escoOriginal)), JSON.stringify(anterior));
});
