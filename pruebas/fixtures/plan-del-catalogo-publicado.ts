/** Las opciones que el plan saca del catálogo publicado del árbol, sin fichas ni caminos de aprendizaje. */
import { catalogoPublicado } from '../../herramientas/catalogo-cursos/foto-clasificacion.ts';
import type { EntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import type {
  CompaneroAprendizaje,
  OpcionPlan,
  PreferenciasSeleccion,
} from '../../src/seleccion-formacion/contrato.ts';
import { seleccionarFormacion } from '../../src/seleccion-formacion/seleccionar.ts';

// Una huella nula deja claro que el compañero no remite a ningún registro real.
const HUELLA_NULA = '0000000000000000000000000000000000000000000000000000000000000000';

export const CATALOGO_PUBLICADO = catalogoPublicado();

/** La persona acepta los tres idiomas, cualquier modalidad y el registro previo: solo descarta el idioma. */
export const PREFERENCIAS: PreferenciasSeleccion = {
  etapa: 'inicial',
  idiomas: ['ca', 'en', 'es'],
  modalidad: 'cualquiera',
  aceptaRegistro: true,
  requisitosConfirmados: [],
  excluidos: [],
};

function companeroSinFichas(entrega: EntregaCatalogo): CompaneroAprendizaje {
  const registro = { id: 'prueba-idioma', version: '1', sha256: HUELLA_NULA };
  return {
    schema_version: 1,
    catalogo: { sha256: '', bytes: 0, revision: entrega.revision },
    registro,
    registro_json: '',
    fichas: [],
    caminos: [],
  };
}

/** Las opciones del plan, en el primer milisegundo en que la entrega vale. */
export function opcionesDelPlan(
  entrega: EntregaCatalogo = CATALOGO_PUBLICADO,
  preferencias: PreferenciasSeleccion = PREFERENCIAS,
): OpcionPlan[] {
  const ahora = Date.parse(entrega.corte_proyeccion_utc) + 1;
  const { opciones } = seleccionarFormacion(entrega, companeroSinFichas(entrega), preferencias, ahora);
  return [...opciones.ia, ...opciones.digital];
}

/** La primera opción cuyo idioma sale del origen pedido; falla si el plan no propone ninguna. */
export function opcionConOrigen(origen: OpcionPlan['idioma']['origen']): OpcionPlan {
  const opcion = opcionesDelPlan().find((o) => o.idioma.origen === origen);
  if (!opcion) {
    throw new Error(`El plan no propone ningún curso con idioma de origen ${origen}`);
  }
  return opcion;
}
