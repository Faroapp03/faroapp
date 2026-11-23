/** Perfil público aprobado: generado por Python, sin HOME, versión del equipo ni algoritmo GREASE duplicado. */
import documento from '../../config/identidad-web.json' with { type: 'json' };

export const IDENTIDAD_WEB = Object.freeze({ ...documento.identidad });
const CAMPOS_IDENTIDAD = new Set(Object.keys(IDENTIDAD_WEB).map((nombre) => nombre.toLowerCase()));

/** Solo reemplaza identidad; conserva autenticación y negociación propias de API, sin añadir idioma ni navegación. */
export function cabecerasIdentidadWeb(adicionales: Readonly<Record<string, string>> = {}): Record<string, string> {
  const conservadas = Object.entries(adicionales).filter(([nombre]) => !CAMPOS_IDENTIDAD.has(nombre.toLowerCase()));
  return { ...Object.fromEntries(conservadas), ...IDENTIDAD_WEB };
}
