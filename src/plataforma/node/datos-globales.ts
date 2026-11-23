// Instantánea global desde la web que sirve Node: portátil, opcional y ajeno al paquete ocupacional.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatosGlobales } from '../../datos-globales/datos.ts';
import { datosGlobalesDelTexto, RUTA_DATOS_GLOBALES } from '../datos-globales.ts';

/** Lee una vez desde la carpeta web resuelta. Solo ENOENT deja el recurso estático ausente; otros errores de archivo se propagan. */
export function cargarDatosGlobalesDeLaWeb(web: string): DatosGlobales | null {
  let texto: string;
  try {
    texto = readFileSync(join(web, RUTA_DATOS_GLOBALES), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  return datosGlobalesDelTexto(texto);
}
