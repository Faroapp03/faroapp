/** En el plan, un dato que no consta no descarta un curso: se propone y se dice qué falta por confirmar. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { CATALOGO_PUBLICADO, opcionesDelPlan, PREFERENCIAS } from '../fixtures/plan-del-catalogo-publicado.ts';

// Valen para cualquier catálogo que cumpla su contrato; las cifras del catálogo de una fecha, en la foto
// seleccion-formacion-por-confirmar-foto.test.ts.

function clave(oferta: OfertaCatalogo): string {
  return JSON.stringify([oferta.unidad.tipo, oferta.unidad.id]);
}
function registroSinConstar(oferta: OfertaCatalogo): boolean {
  return oferta.hechos.requiere_registro_previo.motivo !== 'conocido';
}
function registroExigido(oferta: OfertaCatalogo): boolean {
  const registro = oferta.hechos.requiere_registro_previo;
  return registro.motivo === 'conocido' && registro.valor === true;
}
function propuestas(aceptaRegistro: boolean | null) {
  return new Map(
    opcionesDelPlan(CATALOGO_PUBLICADO, { ...PREFERENCIAS, aceptaRegistro }).map((o) => [clave(o.oferta), o]),
  );
}
/** La entrega publicada con una sola oferta, con los hechos que se indiquen. */
function entregaCon(oferta: OfertaCatalogo, hechos: Partial<OfertaCatalogo['hechos']>) {
  return { ...CATALOGO_PUBLICADO, ofertas: [{ ...oferta, hechos: { ...oferta.hechos, ...hechos } }] };
}
/** Cierto si ninguna opción completa va detrás de una con datos por confirmar. */
function completasPrimero(pendientes: readonly boolean[]): boolean {
  const primera = pendientes.indexOf(true);
  return primera === -1 || pendientes.slice(primera).every(Boolean);
}

test('si no consta si piden registro, el curso se propone tanto si la persona acepta registrarse como si no', () => {
  const sinConstar = CATALOGO_PUBLICADO.ofertas.filter(registroSinConstar);
  const conAceptacion = (aceptaRegistro: boolean | null) => {
    const plan = propuestas(aceptaRegistro);
    return sinConstar.flatMap((o) => plan.get(clave(o)) ?? []);
  };
  const aceptando = conAceptacion(true).map((o) => clave(o.oferta));
  for (const aceptaRegistro of [true, false, null]) {
    const propuestasSinConstar = conAceptacion(aceptaRegistro);
    assert.deepEqual(
      propuestasSinConstar.map((o) => clave(o.oferta)),
      aceptando,
      String(aceptaRegistro),
    );
    for (const opcion of propuestasSinConstar) {
      assert.equal(opcion.porConfirmar[0], 'registro_previo');
    }
  }
});

test('un curso que consta que pide registro solo se descarta si la persona no quiere crear una cuenta', () => {
  const exigido = opcionesDelPlan().find((o) => registroExigido(o.oferta) && o.porConfirmar.length === 0)?.oferta;
  assert.ok(exigido);
  const entrega = { ...CATALOGO_PUBLICADO, ofertas: [exigido] };
  assert.deepEqual(opcionesDelPlan(entrega, { ...PREFERENCIAS, aceptaRegistro: false }), []);
  // «Prefiero revisarlo antes» no es una negativa: el curso se propone y la ficha dice que pide registrarse.
  for (const aceptaRegistro of [true, null]) {
    const [opcion] = opcionesDelPlan(entrega, { ...PREFERENCIAS, aceptaRegistro });
    assert.equal(opcion?.oferta, exigido);
    assert.deepEqual(opcion?.porConfirmar, []);
  }
});

test('un coste no acreditado sigue descartando, aunque tampoco conste el registro', () => {
  const base = opcionesDelPlan().find((o) => registroSinConstar(o.oferta))?.oferta;
  assert.ok(base);
  for (const coste of [
    { ...base.hechos.coste_formacion_tipo, motivo: 'no_consta_en_evidencia' as const, valor: null },
    { ...base.hechos.coste_formacion_tipo, motivo: 'conocido' as const, valor: 'pago' },
  ]) {
    const entrega = entregaCon(base, { coste_formacion_tipo: coste });
    for (const aceptaRegistro of [true, false]) {
      assert.deepEqual(opcionesDelPlan(entrega, { ...PREFERENCIAS, aceptaRegistro }), []);
    }
  }
});

test('entre dos cursos del mismo bloque, va antes aquel del que consta todo, sin alterar el orden de la entrega', () => {
  const completo = opcionesDelPlan().find((o) => o.bloque === 'ia' && o.porConfirmar.length === 0)?.oferta;
  const pendiente = opcionesDelPlan().find((o) => o.bloque === 'ia' && o.porConfirmar.length > 0)?.oferta;
  assert.ok(completo && pendiente);
  const entrega = { ...CATALOGO_PUBLICADO, ofertas: [pendiente, completo] };
  assert.deepEqual(
    opcionesDelPlan(entrega).map((o) => o.oferta),
    [completo, pendiente],
  );
  for (const bloque of ['ia', 'digital'] as const) {
    const enElBloque = opcionesDelPlan().filter((o) => o.bloque === bloque);
    assert.ok(completasPrimero(enElBloque.map((o) => o.porConfirmar.length > 0)), bloque);
  }
});

test('el plan del catálogo publicado no propone dos veces el mismo curso', () => {
  const opciones = opcionesDelPlan();
  assert.equal(new Set(opciones.map((o) => clave(o.oferta))).size, opciones.length);
});

// La modalidad que no consta no descarta: solo la contradice una modalidad publicada distinta de la que pide la persona.
const EN_LINEA = { ...PREFERENCIAS, modalidad: 'en-linea' } as const;
const PRESENCIAL = { ...PREFERENCIAS, modalidad: 'presencial' } as const;

function sinModalidad(oferta: OfertaCatalogo): boolean {
  return oferta.hechos.modalidad.motivo !== 'conocido';
}
/** Una oferta del plan de la que consta la modalidad (la clasificación de la materia depende de ella). */
function ofertaEnLinea(): OfertaCatalogo {
  const opcion = opcionesDelPlan(CATALOGO_PUBLICADO, EN_LINEA).find(
    (o) => o.bloque === 'ia' && o.oferta.hechos.modalidad.valor === 'en-linea' && o.porConfirmar.length === 0,
  );
  assert.ok(opcion);
  return opcion.oferta;
}
/** Una oferta de HP LIFE, que no publica su modalidad, de IA o digital y con el resto de datos al día. */
function ofertaSinModalidad(): OfertaCatalogo {
  const opcion = opcionesDelPlan().find((o) => o.bloque === 'ia' && sinModalidad(o.oferta));
  assert.ok(opcion);
  return opcion.oferta;
}
function conModalidad(oferta: OfertaCatalogo, modalidad: Partial<OfertaCatalogo['hechos']['modalidad']>) {
  return entregaCon(oferta, { modalidad: { ...oferta.hechos.modalidad, ...modalidad } });
}

test('si la modalidad no consta, el curso se propone a quien pide en línea o presencial y la ficha lo dice', () => {
  const oferta = ofertaSinModalidad();
  for (const preferencias of [EN_LINEA, PRESENCIAL]) {
    const [opcion] = opcionesDelPlan({ ...CATALOGO_PUBLICADO, ofertas: [oferta] }, preferencias);
    assert.equal(opcion?.oferta.unidad.id, oferta.unidad.id);
    assert.deepEqual(opcion?.porConfirmar, ['modalidad']);
  }
});

test('quien no pide una modalidad no tiene nada que confirmar de ella', () => {
  const [opcion] = opcionesDelPlan({ ...CATALOGO_PUBLICADO, ofertas: [ofertaSinModalidad()] }, PREFERENCIAS);
  assert.deepEqual(opcion?.porConfirmar, []);
});

test('una modalidad publicada que contradice la que pide la persona sigue descartando el curso', () => {
  const oferta = ofertaEnLinea();
  assert.deepEqual(opcionesDelPlan(conModalidad(oferta, { valor: 'presencial' }), EN_LINEA), []);
  assert.deepEqual(opcionesDelPlan(conModalidad(oferta, { valor: 'mixta' }), EN_LINEA), []);
  assert.deepEqual(opcionesDelPlan(conModalidad(oferta, { valor: 'en-linea' }), PRESENCIAL), []);
});

test('una modalidad publicada que coincide con la que pide la persona se propone sin aviso', () => {
  const [opcion] = opcionesDelPlan(conModalidad(ofertaEnLinea(), { valor: 'en-linea' }), EN_LINEA);
  assert.deepEqual(opcion?.porConfirmar, []);
});

test('entre dos cursos, el de modalidad por confirmar va detrás del que la publica', () => {
  const completo = ofertaEnLinea();
  const pendiente = ofertaSinModalidad();
  const entrega = { ...CATALOGO_PUBLICADO, ofertas: [pendiente, completo] };
  assert.deepEqual(
    opcionesDelPlan(entrega, EN_LINEA).map((o) => o.oferta.unidad.id),
    [completo.unidad.id, pendiente.unidad.id],
  );
});

test('un coste no acreditado descarta el curso aunque tampoco conste la modalidad', () => {
  const oferta = ofertaSinModalidad();
  const coste = { ...oferta.hechos.coste_formacion_tipo, motivo: 'conocido' as const, valor: 'pago' };
  assert.deepEqual(opcionesDelPlan(entregaCon(oferta, { coste_formacion_tipo: coste }), EN_LINEA), []);
});

test('del catálogo publicado, las opciones sin modalidad son las mismas para quien pide en línea o presencial', () => {
  const [enLinea, presencial] = [EN_LINEA, PRESENCIAL].map((preferencias) =>
    opcionesDelPlan(CATALOGO_PUBLICADO, preferencias).filter((o) => sinModalidad(o.oferta)),
  );
  assert.deepEqual(
    presencial?.map((o) => clave(o.oferta)),
    enLinea?.map((o) => clave(o.oferta)),
  );
  for (const propuestas of [enLinea, presencial]) {
    assert.ok(propuestas?.every((o) => o.porConfirmar.includes('modalidad')));
  }
});
