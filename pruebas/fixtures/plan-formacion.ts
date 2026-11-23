/** Plan sintético para ejercicios de presentación; no representa una oferta publicada. */
import assert from 'node:assert/strict';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { idiomaConOrigen } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import type { FichaAprendizaje, OpcionPlan } from '../../src/seleccion-formacion/contrato.ts';
import { datosPorConfirmar } from '../../src/seleccion-formacion/por-confirmar.ts';
import type { HojaConfirmada } from '../../web/scripts/recorrido/estado.js';
import { casoDeFormacion } from './seleccion-formacion.ts';

const LONGITUD_SHA256 = 64;
/** Lo que dura el curso del plan: horas enteras, como las que publica un proveedor (el catálogo base trae 1e-7 h). */
const HORAS_DEL_CURSO = 2;
const RAZON = { es: 'Materia de prueba', ca: 'Matèria de prova' };

/** Una elección como la entrega el motor, con el idioma que decide la pieza común de Cursos y lo que no consta. */
function eleccion(bloque: OpcionPlan['bloque'], oferta: OfertaCatalogo, aprendizaje: FichaAprendizaje | null) {
  const idioma = idiomaConOrigen(oferta);
  return {
    bloque,
    oferta,
    aprendizaje,
    requisitos: [],
    proveedor: 'Proveedor de prueba',
    motivo: RAZON,
    idioma,
    porConfirmar: datosPorConfirmar(oferta, idioma, 'cualquiera'),
  };
}

export function planDePrueba(idioma: 'es' | 'ca' = 'es'): HojaConfirmada['plan'] {
  const caso = casoDeFormacion();
  const recurso = caso.seleccion.camino?.recursos[0];
  assert.ok(recurso);
  const oferta = {
    ...recurso.oferta,
    hechos: {
      ...recurso.oferta.hechos,
      horas_publicadas: { ...recurso.oferta.hechos.horas_publicadas, valor: HORAS_DEL_CURSO },
    },
  };
  return {
    version: 1,
    elecciones: [
      eleccion('ia', oferta, recurso.ficha),
      eleccion('digital', { ...oferta, unidad: { ...oferta.unidad, id: 'curso-digital-prueba' } }, null),
    ],
    confirmadoEl: caso.seleccion.calculado_el,
    fuente: { ruta: 'fixture.json', sha256: 'a'.repeat(LONGITUD_SHA256), revision: 'revision-prueba' },
    requisitosConfirmados: [],
    disponibilidad: { dias: [1], minutosPorDia: 30 },
    preferencias: {
      inicio: '2026-10-23',
      nivel: 'inicial',
      nivelDigital: 'inicial',
      idiomas: [...caso.preferencias.idiomas],
      modalidad: caso.preferencias.modalidad,
      aceptaRegistro: true,
    },
    objetivo: 'Objetivo sintético',
    idioma,
    perfil: null,
  };
}
