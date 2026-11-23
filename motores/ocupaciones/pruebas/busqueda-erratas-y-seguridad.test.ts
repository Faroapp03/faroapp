// Regresiones ante etiquetas oficiales defectuosas:
// - la errata de ESCO que llama «enfermero/enfermera» al flebotomista (grupo 5329): «infermera» acababa allí;
// - el subgrupo 59 de la CNO-11 («protección y seguridad»), que Idescat y el Censo no publican a 3 cifras: la
//   policía no tenía frecuencia y «policía» proponía antes al inspector que al agente;
// - «mosso d'esquadra» se leía como «mozo».

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { catalanConErratas, ERRATAS_ESCO, escoConErratas } from '../../../src/dominio/erratas-esco.ts';
import { prepararParte } from '../../../src/plataforma/archivos-del-paquete.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { buscarConContexto } from '../src/busqueda/analisis.ts';
import { frecuenciaDeLosGrupos } from '../src/busqueda/frecuencia.ts';
import { marcasDelTexto } from '../src/busqueda/marcas.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const primeraEn = (texto: string, idioma: 'es' | 'ca' = 'es') =>
  buscarConContexto(datos, texto, { idioma, limite: 8 }).candidatas[0];

describe('Fe de erratas de ESCO', () => {
  it('el flebotomista deja de llamarse «enfermero» en castellano y en catalán', () => {
    const ocupacion = datos.esco.ocupaciones['5329.2'];
    assert.ok(ocupacion);
    assert.equal(ocupacion.titulo, 'flebotomista/flebotomista');
    assert.ok(!(ocupacion.alternativos ?? []).some((a) => /^enfermer[oa]$/i.test(a.trim())));
    assert.equal(datos.catalan?.ocupaciones['5329.2'], 'flebotomista/flebotomista');
  });

  it('«enfermera» e «infermera» llevan a las enfermeras (2221), no al grupo 5329', () => {
    assert.equal(primeraEn('enfermera')?.isco08, '2221');
    assert.equal(primeraEn('infermera', 'ca')?.isco08, '2221');
    assert.equal(primeraEn('Sóc infermera', 'ca')?.isco08, '2221');
  });

  it('solo se aplica si la URI coincide y no cambia el objeto recibido', () => {
    const [errata] = ERRATAS_ESCO;
    assert.ok(errata);
    const original = { ...datos.esco.ocupaciones[errata.esco], titulo: 'x', uri: 'otra' };
    const esco = { competencias: [], ocupaciones: { [errata.esco]: original } };
    assert.equal(escoConErratas(esco as never), esco);
    const catalan = { ocupaciones: {} };
    assert.equal(catalanConErratas(catalan as never), catalan);
  });

  it('el Worker y el navegador ven la misma errata que Node', () => {
    const leidos = {
      ...datos.esco,
      ocupaciones: {
        '5329.2': { ...datos.esco.ocupaciones['5329.2'], titulo: 'enfermero/enfermera', competencias: [] },
      },
    };
    const preparada = prepararParte('esco', leidos as never);
    assert.equal(preparada.ocupaciones['5329.2']?.titulo, 'flebotomista/flebotomista');
  });
});

describe('Protección y seguridad (subgrupo 59 de la CNO-11)', () => {
  it('los grupos de policía, bomberos y vigilancia tienen frecuencia en Cataluña', () => {
    const frecuencia = frecuenciaDeLosGrupos(datos);
    for (const grupo of ['5411', '5412', '5414']) {
      assert.ok((frecuencia.get(grupo) ?? 0) > 0, grupo);
    }
  });

  it('«policía» propone antes al agente (5412) que al inspector (3355)', () => {
    assert.equal(primeraEn('policia')?.isco08, '5412');
  });

  it("«mosso d'esquadra» es policía; «mosso de magatzem» sigue siendo mozo de almacén", () => {
    assert.deepEqual(
      marcasDelTexto("Sóc mosso d'esquadra").map((m) => m.nombre),
      ["Mossos d'Esquadra"],
    );
    assert.deepEqual(
      marcasDelTexto('Soy mossa d’esquadra').map((m) => m.nombre),
      ["Mossos d'Esquadra"],
    );
    assert.equal(primeraEn("Sóc mosso d'esquadra", 'ca')?.isco08, '5412');
    assert.equal(primeraEn('mosso de magatzem', 'ca')?.isco08, '9333');
  });
});
