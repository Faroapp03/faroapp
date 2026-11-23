import type { Estimacion, Ocupacion } from '../../web/scripts/recorrido/estado.js';
import type { Clasificacion, GrupoClasificado } from '../../web/scripts/recorrido/traduccion-api.js';
import { leerFichaDeGrupo } from '../../web/scripts/recorrido/traduccion-api.js';

/** Respuestas pequeñas con la forma del contrato actual; ningún texto es de una persona real. */
export function ficha(isco08 = '8331') {
  return leerFichaDeGrupo({
    isco08,
    titulo: `Grupo ${isco08}`,
    tareas: [{ id: `${isco08}-1`, corto: 'Conducir', texto_es: 'Conducir autobuses', texto_en: 'Drive', nota: 0.165 }],
    ocupaciones: [{ esco: `${isco08}.1`, titulo: 'conductor' }],
  });
}

export function ocupacion(): Ocupacion {
  return {
    isco08: '8331',
    esco: null,
    isco08Secundario: null,
    origen: 'jerarquia',
    palabra: 'chofer',
    titulo: 'Grupo',
  };
}

/** La firma se conserva opaca: esta prueba no la presenta como firma válida del servidor. */
export function estimacion(): Estimacion {
  const limiteInferior = 0.4;
  const limiteSuperior = 0.6;
  return {
    valor: 0.5,
    margen: [limiteInferior, limiteSuperior],
    origen: 'faro',
    firma: 'firma-de-prueba',
    referencias: 'ocupacion',
  };
}

/** Un grupo clasificado con la forma que entrega el motor local a la máquina de la ocupación. */
export function grupoClasificado(isco08 = '8331'): GrupoClasificado {
  const { titulo, ocupaciones, sinTareasOit, referenciasSubgrupo, sinReferencias } = ficha(isco08);
  return { isco08, titulo, cita: '', ocupaciones, sinTareasOit, referenciasSubgrupo, sinReferencias };
}

/** Una clasificación completa: lo que no se indica, vacío. */
export function clasificacionCon(parte: Partial<Clasificacion>): Clasificacion {
  return { idioma: 'es', avisos: [], decision: '', grupos: [], pregunta: null, candidatas: [], ...parte };
}

export function clasificacion(decision = 'confirmar') {
  return clasificacionCon({ decision, grupos: [grupoClasificado()] });
}

export function pregunta(conOpciones = false) {
  const opciones = conOpciones ? [{ texto: 'Ambas cosas', isco08: ['7512', '5246', '5212'] }] : null;
  return clasificacionCon({
    decision: 'preguntar',
    grupos: [grupoClasificado('7512'), grupoClasificado('5246')],
    pregunta: { texto: '¿Qué haces?', opciones, idioma: 'ca' },
  });
}

/** Congela también descendientes: las transiciones no pueden escribir en el estado recibido. */
export function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) {
      congelar(hijo);
    }
  }
  return valor;
}
