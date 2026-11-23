/** Identidad semántica de la unidad revisada; los calendarios y el reloj no deciden su materia o dificultad. */
import { sha256Hex } from '../comun/huella.ts';
import { jsonCanonico } from '../comun/jcs.ts';
import type { HechoCatalogo, OfertaCatalogo } from './contrato.ts';

const CAMPOS_EDITORIALES = [
  'modalidad',
  'sincronia',
  'horas_publicadas',
  'requisitos_publicados',
  'nivel_entrada',
  'nivel_salida',
] as const;
const FIRMAS = new WeakMap<OfertaCatalogo, string>();

/** La fecha conserva su función de procedencia, separada del valor y ámbito del hecho. */
export function hechoEditorial(hecho: HechoCatalogo): unknown {
  return [hecho.valor, hecho.motivo, hecho.unidad, hecho.moneda, hecho.alcance];
}

/** Una edición nueva no reutiliza la revisión de otra unidad del mismo programa. */
export function identidadEditorial(oferta: OfertaCatalogo): string {
  return JSON.stringify([oferta.unidad.tipo, oferta.unidad.id]);
}

/** Solo los valores que participan en la firma deben ser inmutables para reutilizarla. */
function valorInmutable(valor: unknown): boolean {
  return (
    valor === null ||
    typeof valor !== 'object' ||
    (Object.isFrozen(valor) && Object.values(valor).every(valorInmutable))
  );
}

/** JCS y SHA comunes del navegador; no firma el DTO Python ni reemplaza su revisión externa. */
export function firmaEditorial(oferta: OfertaCatalogo): string {
  const guardada = FIRMAS.get(oferta);
  if (guardada) {
    return guardada;
  }
  const firma = sha256Hex(
    new TextEncoder().encode(
      jsonCanonico([
        oferta.unidad,
        oferta.proveedor_id,
        oferta.titulo_programa,
        oferta.tipo_unidad,
        oferta.url,
        CAMPOS_EDITORIALES.map((campo) => [campo, hechoEditorial(oferta.hechos[campo])]),
      ]),
    ),
  );
  if (
    Object.isFrozen(oferta) &&
    Object.isFrozen(oferta.hechos) &&
    valorInmutable(oferta.unidad) &&
    CAMPOS_EDITORIALES.every(
      (campo) => Object.isFrozen(oferta.hechos[campo]) && valorInmutable(oferta.hechos[campo].valor),
    )
  ) {
    FIRMAS.set(oferta, firma);
  }
  return firma;
}
