// Hechos con comprobación fechada: su antigüedad no les resta valor ni decide la existencia del curso.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consultarCatalogo, proximaRevision } from '../../src/catalogo-cursos/consulta.ts';
import { type CampoHecho, CatalogoNoValido, type EntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { leerCatalogo, ofertasVigentes } from '../../src/catalogo-cursos/lectura.ts';
import { sha256Hex } from '../../src/comun/huella.ts';
import { seleccionarFormacion } from '../../src/seleccion-formacion/seleccionar.ts';
import { AHORA_FORMACION, CIERRA_EL_FORMACION, casoDeFormacion } from '../fixtures/seleccion-formacion.ts';

const FILTROS = { texto: '', idioma: '', modalidad: '' };
const INICIO = '2026-10-22T09:00:00Z';
const SEMANAS_DESPUES = Date.parse('2026-11-19T11:00:00Z');
const CIERRE_MS = Date.parse(CIERRA_EL_FORMACION);
const MAX_TIMER = 2_147_483_647;
const ESPERA_FINAL_MS = 1_000;
const SHA_CIFRAS = 64;
function candidata(campo: CampoHecho = 'requiere_registro_previo') {
  const caso = casoDeFormacion();
  const oferta = caso.catalogo.ofertas[0];
  assert.ok(oferta);
  return {
    ...caso.catalogo,
    ofertas: [
      {
        ...oferta,
        hechos: {
          ...oferta.hechos,
          [campo]: { ...oferta.hechos[campo], vigencia: { comprobado_el: INICIO } },
        },
        referencias: [...oferta.referencias, { ...oferta.referencias[0], fecha_referencia: INICIO }],
      },
    ],
  };
}
function leer(dato: EntregaCatalogo | ReturnType<typeof candidata>): EntregaCatalogo {
  const bytes = new TextEncoder().encode(JSON.stringify(dato));
  return leerCatalogo(bytes, { sha256: sha256Hex(bytes), bytes: bytes.length, revision: dato.revision });
}
function renovar(dato: EntregaCatalogo): EntregaCatalogo {
  const anterior = dato.ofertas[0];
  assert.ok(anterior);
  const comprobado = new Date(SEMANAS_DESPUES).toISOString();
  return leer({
    ...dato,
    corte_proyeccion_utc: comprobado,
    ofertas: [
      {
        ...anterior,
        hechos: {
          ...anterior.hechos,
          requiere_registro_previo: {
            ...anterior.hechos.requiere_registro_previo,
            valor: false,
            vigencia: { comprobado_el: comprobado },
          },
        },
        referencias: [
          ...anterior.referencias,
          {
            ...anterior.referencias[0],
            url: 'https://formacion.example/condiciones-nuevas',
            sha256: 'd'.repeat(SHA_CIFRAS),
            fecha_referencia: comprobado,
          },
        ],
      },
    ],
  });
}

test('una condición fechada conserva su comprobación, sin acortar ni renovar la oferta', () => {
  const dato = leer(candidata());
  const original = casoDeFormacion().catalogo.ofertas[0];
  assert.ok(original);
  const [oferta] = ofertasVigentes(dato, AHORA_FORMACION);
  assert.ok(oferta);
  assert.equal(oferta.comprobado_el, original.comprobado_el);
  assert.equal(oferta.cierra_el, original.cierra_el);
  assert.equal(oferta.hechos.requiere_registro_previo.valor, true);
  assert.deepEqual(oferta.hechos.requiere_registro_previo.vigencia, { comprobado_el: INICIO });
});

test('semanas después la condición conserva su valor: la ficha, los recuentos y la evidencia permanecen', () => {
  const dato = leer(candidata());
  const bytes = JSON.stringify(dato);
  const despues = consultarCatalogo(dato, FILTROS, SEMANAS_DESPUES);
  assert.equal(despues.total, 1);
  assert.equal(despues.cuentas.get('idioma')?.get('es'), 1);
  const registro = despues.ofertas[0]?.hechos.requiere_registro_previo;
  assert.equal(registro?.valor, true);
  assert.equal(registro?.motivo, 'conocido');
  assert.deepEqual(registro?.vigencia, { comprobado_el: INICIO });
  assert.equal(despues.ofertas[0], dato.ofertas[0]);
  assert.equal(JSON.stringify(dato), bytes);
});

test('el selector sigue acreditando registro, gratuidad e idioma antiguos y solo el límite publicado retira', () => {
  const dato = leer(candidata());
  const { companero, preferencias } = casoDeFormacion();
  assert.equal(seleccionarFormacion(dato, companero, preferencias, AHORA_FORMACION).estado, 'parcial');
  const despues = seleccionarFormacion(dato, companero, preferencias, SEMANAS_DESPUES);
  assert.equal(despues.estado, 'parcial');
  assert.deepEqual(despues.descartes, []);
  assert.equal(despues.camino?.recursos[0]?.oferta.hechos.requiere_registro_previo.valor, true);
  const cerrada = seleccionarFormacion(dato, companero, preferencias, CIERRE_MS);
  assert.equal(cerrada.estado, 'sin_oferta');
  assert.equal(cerrada.descartes[0]?.motivo, 'sin_oferta_vigente');
  const renovada = renovar(dato);
  const nueva = seleccionarFormacion(renovada, companero, preferencias, SEMANAS_DESPUES);
  assert.equal(nueva.camino?.recursos[0]?.oferta.hechos.requiere_registro_previo.valor, false);
  assert.equal(renovada.ofertas[0]?.comprobado_el, dato.ofertas[0]?.comprobado_el);
});

test('el reloj programa solo el límite publicado de la oferta, nunca la comprobación de un hecho', () => {
  const dato = leer(candidata());
  assert.equal(proximaRevision(dato, AHORA_FORMACION), MAX_TIMER);
  assert.equal(proximaRevision(dato, CIERRE_MS - ESPERA_FINAL_MS), ESPERA_FINAL_MS);
  assert.equal(proximaRevision(dato, CIERRE_MS), null);
  assert.equal(ofertasVigentes(dato, CIERRE_MS).length, 0);
  const sinLimite = candidata();
  const oferta = sinLimite.ofertas[0];
  assert.ok(oferta);
  sinLimite.ofertas[0] = { ...oferta, cierra_el: null };
  assert.equal(proximaRevision(leer(sinLimite), AHORA_FORMACION), null);
});

test('una gratuidad comprobada hace semanas se mantiene en el filtro de formación gratuita', () => {
  const dato = leer(candidata('coste_formacion_tipo'));
  assert.equal(consultarCatalogo(dato, FILTROS, AHORA_FORMACION).total, 1);
  assert.equal(consultarCatalogo(dato, FILTROS, SEMANAS_DESPUES).total, 1);
  assert.equal(consultarCatalogo(dato, FILTROS, CIERRE_MS).total, 0);
});

test('rechaza comprobaciones futuras, sin referencia, con caducidad propia o adheridas a un desconocido', () => {
  for (const temporal of [
    { comprobado_el: '2026-10-22T11:00:30Z' },
    { comprobado_el: '2026-10-22T08:00:00Z' },
    { comprobado_el: INICIO, vence_el: '2026-10-22T11:00:30Z' },
    { comprobado_el: INICIO, limite_publicado_el: null },
    {},
  ]) {
    const dato = candidata();
    const oferta = dato.ofertas[0];
    assert.ok(oferta);
    oferta.hechos.requiere_registro_previo = {
      ...oferta.hechos.requiere_registro_previo,
      vigencia: temporal as { comprobado_el: string },
    };
    assert.throws(() => leer(dato), CatalogoNoValido);
  }
  const dato = candidata();
  const oferta = dato.ofertas[0];
  assert.ok(oferta);
  oferta.hechos.requiere_registro_previo = {
    ...oferta.hechos.requiere_registro_previo,
    valor: null,
    motivo: 'no_consta_en_evidencia',
  };
  assert.throws(() => leer(dato), CatalogoNoValido);
});
