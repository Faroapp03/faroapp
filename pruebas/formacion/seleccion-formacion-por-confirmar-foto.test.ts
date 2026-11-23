/**
 * Foto del plan sobre el catálogo publicado del 18/11: cuántos cursos propone y cuántos lo hacen con un dato por
 * confirmar. Detecta que un cambio de código altera la selección; las reglas que valen con cualquier catálogo están en
 * seleccion-formacion-por-confirmar.test.ts.
 */
import assert from 'node:assert/strict';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { fotoDelPaquete } from '../ayudas/foto-del-paquete.ts';
import { CATALOGO_PUBLICADO, opcionesDelPlan, PREFERENCIAS } from '../fixtures/plan-del-catalogo-publicado.ts';

const foto = fotoDelPaquete({
  catalogo: '7bc6f1d393a90aca7dd3f46156c533e32a47a46c8f216041c3e0a5a97bc8a018',
  regenerar:
    'ejecuta esta prueba con el paquete nuevo, comprueba que cada diferencia la explica el cambio de datos y escribe aquí las cifras nuevas',
});

// La persona acepta los tres idiomas y el registro previo (PREFERENCIAS).
const OPCIONES_DEL_CATALOGO = 658;
const REGISTRO_SIN_CONSTAR = 191;
const REGISTRO_SIN_CONSTAR_PROPUESTAS = 164;
const HP_LIFE_SIN_MODALIDAD = 11;

function clave(oferta: OfertaCatalogo): string {
  return JSON.stringify([oferta.unidad.tipo, oferta.unidad.id]);
}

foto('el catálogo publicado propone 658 cursos', () => {
  assert.equal(opcionesDelPlan().length, OPCIONES_DEL_CATALOGO);
});

foto('191 cursos no dicen si piden registro y 164 de ellos se proponen, se acepte o no registrarse', () => {
  const sinConstar = CATALOGO_PUBLICADO.ofertas.filter((o) => o.hechos.requiere_registro_previo.motivo !== 'conocido');
  assert.equal(sinConstar.length, REGISTRO_SIN_CONSTAR);
  for (const aceptaRegistro of [true, false, null]) {
    const plan = new Set(
      opcionesDelPlan(CATALOGO_PUBLICADO, { ...PREFERENCIAS, aceptaRegistro }).map((o) => clave(o.oferta)),
    );
    assert.equal(sinConstar.filter((o) => plan.has(clave(o))).length, REGISTRO_SIN_CONSTAR_PROPUESTAS);
  }
});

foto('las 11 opciones de HP LIFE sin modalidad entran para quien pide en línea o presencial', () => {
  for (const modalidad of ['en-linea', 'presencial'] as const) {
    const propuestas = opcionesDelPlan(CATALOGO_PUBLICADO, { ...PREFERENCIAS, modalidad }).filter(
      (o) => o.oferta.hechos.modalidad.motivo !== 'conocido',
    );
    assert.equal(propuestas.length, HP_LIFE_SIN_MODALIDAD);
  }
});
