/** Una sola persistencia privada y un ciclo de vida para panel, instituciones, cuotas y revocaciones. */
import { join } from 'node:path';
import type { ConfiguracionProgramada } from '../../administracion/configuracion-programada.ts';
import type { ConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import { LIMITES_CONECTIVIDAD } from '../../administracion/instituciones.ts';
import type { OpcionesMontajeAdministrativo } from '../administracion.ts';
import { prepararPersistenciaAdministrativaNode } from '../node/administracion-almacen.ts';
import { RUTAS } from '../node/rutas.ts';

export interface OpcionesPreparacionSociosNode {
  readonly archivo?: string;
  readonly administracion: {
    readonly configuracionVigilante?: ConfiguracionVigilante;
    readonly errorConfiguracionVigilante?: boolean;
    readonly configuracionProgramada?: () => ConfiguracionProgramada | undefined;
  } & Pick<
    OpcionesMontajeAdministrativo,
    'configuracion' | 'guardiaAdministrativa' | 'inicial' | 'leerEstadoDatos' | 'actualizacion' | 'activacionHabilitada'
  >;
}
export function prepararSociosNode(opciones: OpcionesPreparacionSociosNode) {
  return prepararPersistenciaAdministrativaNode(
    {
      archivo: opciones.archivo ?? join(RUTAS.registro, 'acceso-publico', 'clientes.sqlite'),
      maxClientes: LIMITES_CONECTIVIDAD.instituciones,
    },
    opciones.administracion,
  );
}
