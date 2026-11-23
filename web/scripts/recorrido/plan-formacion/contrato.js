/** Elección de formación. Las ofertas conservan los hechos del catálogo público;
 * el objetivo y la agenda son una propuesta personal, no una acreditación de aprendizaje. */
/** @import { OfertaCatalogo } from '../../../../src/catalogo-cursos/contrato.ts' */
/** @import { FichaAprendizaje, RequisitoRevisado } from '../../../../src/seleccion-formacion/contrato.ts' */
/** @import { IdiomaConOrigen } from '../../../../src/catalogo-cursos/proyeccion-listado.ts' */
/** @typedef {'es'|'ca'} IdiomaPlan */
/** @typedef {'ia'|'digital'} BloquePlan */
/** @typedef {'registro_previo'|'idioma'|'modalidad'} DatoPorConfirmar */
/** @typedef {{es:string,ca:string}} TextoPlan */
/** @typedef {{nivel:'inicial'|'intermedio'|'avanzado',nivelDigital:'inicial'|'intermedio'|'avanzado',idiomas:string[],modalidad:'cualquiera'|'en-linea'|'presencial',aceptaRegistro:boolean|null,inicio:string}} PreferenciasPlan */
/** La opción se guarda tal como la entrega el motor, con sus requisitos revisados; el documento del plan no los pinta.
 * @typedef {{oferta:OfertaCatalogo,aprendizaje:FichaAprendizaje|null,requisitos:readonly RequisitoRevisado[],bloque:BloquePlan,proveedor:string,motivo:TextoPlan,idioma:IdiomaConOrigen,porConfirmar:readonly DatoPorConfirmar[]}} OpcionPlan */
/** @typedef {{ruta:string,sha256:string,revision:string}} FuentePlan */
/** @typedef {{fuente:FuentePlan,ia:OpcionPlan[],digital:OpcionPlan[]}} OpcionesPlan */
/** @typedef {{codigo:string,nombre:string,nivel:1|2|3,relacion:'ocupacion'|'grupo',enlaceBoe:string,ocupacion:string,idioma:IdiomaPlan,tramite:string,fuente:string,comprobado:string,ofertaActualizada:string}} AcreditacionPlan */
/** @typedef {{dias:number[],minutosPorDia:number}} DisponibilidadPlan */
/** `elecciones` lleva de cero a dos cursos, como mucho uno por bloque y en orden: primero IA y después digital. */
/** @typedef {{version:1,fuente:FuentePlan,idioma:IdiomaPlan,perfil:string|null,preferencias:PreferenciasPlan,disponibilidad:DisponibilidadPlan,objetivo:string,elecciones:OpcionPlan[],acreditacion?:AcreditacionPlan|null,requisitosConfirmados:string[],confirmadoEl:string}} PlanElegido */

const MINUTOS_MINIMOS = 15;
const MINUTOS_MAXIMOS = 720;
const ULTIMO_DIA = 7;

/** @param {unknown} valor @returns {valor is DisponibilidadPlan} */
export function disponibilidadValida(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return false;
  }
  const dato = /** @type {Partial<DisponibilidadPlan>} */ (valor);
  return (
    Array.isArray(dato.dias) &&
    dato.dias.length > 0 &&
    dato.dias.length <= ULTIMO_DIA &&
    Array.from(dato.dias).every((dia) => Number.isInteger(dia) && dia >= 1 && dia <= ULTIMO_DIA) &&
    new Set(dato.dias).size === dato.dias.length &&
    typeof dato.minutosPorDia === 'number' &&
    Number.isInteger(dato.minutosPorDia) &&
    dato.minutosPorDia >= MINUTOS_MINIMOS &&
    dato.minutosPorDia <= MINUTOS_MAXIMOS &&
    dato.minutosPorDia % MINUTOS_MINIMOS === 0
  );
}
