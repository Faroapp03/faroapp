/** Formación del dispositivo: catálogo y aprendizaje de una misma publicación confiable. */
import * as publicacion from '../../../web/scripts/catalogo-cursos/referencia.js';
import { cargarCatalogo } from '../../catalogo-cursos/carga.ts';
import { esObjeto } from '../../comun/json.ts';
import { cargarCompanero, type PublicacionAprendizaje } from '../../seleccion-formacion/carga.ts';
import { AprendizajeNoValido } from '../../seleccion-formacion/contrato.ts';
import type { FuenteSeleccion } from './ruta-formacion.ts';

function referenciaAprendizaje(): PublicacionAprendizaje {
  const valor: unknown = Reflect.get(publicacion, 'APRENDIZAJE');
  if (
    !(
      esObjeto(valor) &&
      typeof valor.ruta === 'string' &&
      typeof valor.sha256 === 'string' &&
      typeof valor.bytes === 'number'
    )
  ) {
    throw new AprendizajeNoValido('Esta publicación no incorpora aprendizaje acreditado');
  }
  return { ruta: valor.ruta, sha256: valor.sha256, bytes: valor.bytes };
}
/** El motor recibe la raíz web de su composición; la persona nunca elige origen o artefactos. */
export function formacionAcreditada(
  baseWeb: URL,
  pedir: (peticion: Request) => Promise<Response> = fetch,
): FuenteSeleccion {
  let cargada: ReturnType<FuenteSeleccion> | null = null;
  return () => {
    if (cargada === null) {
      const intento = (async () => {
        const referencia = referenciaAprendizaje();
        const catalogo = await cargarCatalogo(publicacion.REFERENCIA, baseWeb, pedir);
        const companero = await cargarCompanero(
          referencia,
          { referencia: publicacion.REFERENCIA, catalogo },
          baseWeb,
          pedir,
        );
        return { catalogo, companero };
      })();
      cargada = intento;
      void intento.catch(() => {
        if (cargada === intento) {
          cargada = null;
        }
      });
    }
    return cargada;
  };
}
