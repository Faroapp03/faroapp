// Composición síncrona de informe y motor de cursos para las pruebas. La API usa la puerta de formación.

import { formacionDelInforme } from '../../motores/cursos/src/index.ts';
import { construirInforme, type OpcionesInforme, peticionDeFormacion } from '../../src/dominio/informe.ts';
import type { Entrada } from '../../src/dominio/tipos-entrada.ts';
import type { Informe } from '../../src/dominio/tipos-informe.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';

/**
 * El informe completo, con la formación que calcula el motor de cursos para él. Si las opciones ya traen `formacion`
 * (también null, para un informe sin motor), se usa esa.
 *
 * @param entrada - Lo que confirma la persona: su ocupación, sus tareas y la fecha.
 * @param datos - El paquete de datos.
 * @param opciones - Las de construirInforme.
 * @returns El informe, con su marca legible por máquina.
 * @throws {EntradaInvalida} Si la entrada no encaja con los datos.
 */
export function construirInformeConFormacion(entrada: Entrada, datos: Datos, opciones: OpcionesInforme = {}): Informe {
  if (opciones.formacion !== undefined) {
    return construirInforme(entrada, datos, opciones);
  }
  const formacion = formacionDelInforme(datos, peticionDeFormacion(entrada, datos, opciones));
  return construirInforme(entrada, datos, { ...opciones, formacion });
}
