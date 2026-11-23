/** Ruta exclusiva del Worker local. El perfil de formación no sale del dispositivo. */
import type { PeticionLocal } from '../../api/cuerpo-local.ts';
import { respuestaDeError, TIPO_PROBLEMA } from '../../api/errores.ts';
import { CatalogoNoValido, type EntregaCatalogo } from '../../catalogo-cursos/contrato.ts';
import { esObjeto } from '../../comun/json.ts';
import { RelojAtrasado } from '../../comun/reloj-atrasado.ts';
import {
  AprendizajeNoValido,
  type CompaneroAprendizaje,
  ETAPAS,
  type PreferenciasSeleccion,
} from '../../seleccion-formacion/contrato.ts';
import { seleccionarFormacion } from '../../seleccion-formacion/seleccionar.ts';
export type FuenteSeleccion = () => Promise<{
  readonly catalogo: EntregaCatalogo;
  readonly companero: CompaneroAprendizaje;
}>;
export const RUTA_FORMACION = '/local/formacion/seleccionar';
const BIEN = 200;
const MAL = 400;
const NO_EXISTE = 404;
const NO_DISPONIBLE = 503;
const MAX_IDS = 100;
const MAX_ID = 200;
const CAMPOS = ['etapa', 'idiomas', 'modalidad', 'aceptaRegistro', 'requisitosConfirmados', 'excluidos'];
const MAX_CUERPO = 32_768;
class PeticionFormacionInvalida extends Error {}
function lista(valor: unknown): valor is string[] {
  return (
    Array.isArray(valor) &&
    valor.length <= MAX_IDS &&
    valor.every((x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID) &&
    new Set(valor).size === valor.length
  );
}
function preferencias(body: string | null): PreferenciasSeleccion {
  if (body === null || body.length > MAX_CUERPO) {
    throw new PeticionFormacionInvalida();
  }
  let c: unknown;
  try {
    c = JSON.parse(body);
  } catch {
    throw new PeticionFormacionInvalida();
  }
  if (
    !(
      esObjeto(c) &&
      Object.keys(c).length === CAMPOS.length &&
      CAMPOS.every((campo) => Object.hasOwn(c, campo)) &&
      ETAPAS.some((e) => e === c.etapa) &&
      lista(c.idiomas) &&
      c.idiomas.length > 0 &&
      typeof c.modalidad === 'string' &&
      ['cualquiera', 'presencial', 'en-linea'].includes(c.modalidad) &&
      (c.aceptaRegistro === null || typeof c.aceptaRegistro === 'boolean') &&
      lista(c.requisitosConfirmados) &&
      lista(c.excluidos)
    )
  ) {
    throw new PeticionFormacionInvalida();
  }
  return c as unknown as PreferenciasSeleccion;
}
function json(status: number, dato: unknown, tipo = 'application/json'): Response {
  return new Response(JSON.stringify(dato), {
    status,
    headers: {
      'content-type': `${tipo}; charset=utf-8`,
      'cache-control': 'no-store',
    },
  });
}
export async function responderFormacionLocal(
  peticion: PeticionLocal,
  fuente: FuenteSeleccion,
  ahora = Date.now(),
): Promise<Response> {
  if (peticion.method !== 'POST' || new URL(peticion.url).pathname !== RUTA_FORMACION) {
    return json(NO_EXISTE, { error: 'Operación desconocida' });
  }
  try {
    const p = preferencias(peticion.body);
    const { catalogo, companero } = await fuente();
    return json(BIEN, seleccionarFormacion(catalogo, companero, p, ahora));
  } catch (error) {
    if (error instanceof PeticionFormacionInvalida) {
      return json(MAL, { error: 'Preferencias de formación no válidas' });
    }
    if (error instanceof RelojAtrasado) {
      const { estado, cuerpo } = respuestaDeError(error);
      return json(estado, cuerpo, TIPO_PROBLEMA);
    }
    if (error instanceof CatalogoNoValido || error instanceof AprendizajeNoValido) {
      return json(NO_DISPONIBLE, { error: 'La formación acreditada no está disponible' });
    }
    throw error;
  }
}
