// El contexto con que el motor del dispositivo atiende la clasificación y el informe (plataforma/navegador/api-local.ts),
// para probar sus manejadores con un interruptor que esa API no deja cambiar, como el camino a mano apagado.

import { OFERTA_POR_DEFECTO } from '../../compartido/contratos/oferta-de-formacion.ts';
import type { ContextoApi } from '../../src/api/contexto-api.ts';
import { CAMINO_A_MANO_POR_DEFECTO } from '../../src/dominio/camino-a-mano.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { motorDeCursos, puertaConSusDatos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearFirmador } from '../../src/seguridad/firma.ts';
import { crearLimitadores } from '../../src/seguridad/limitador.ts';

/**
 * El contexto del dispositivo con los datos dados y, encima, los cambios de la prueba.
 *
 * @param datos - El paquete ya cargado.
 * @param cambios - Lo que la prueba sustituye.
 * @returns El contexto, sin canales de servidor.
 */
export async function contextoDelDispositivo(datos: Datos, cambios: Partial<ContextoApi> = {}): Promise<ContextoApi> {
  return {
    datos,
    datosGlobales: null,
    registrarAcceso: async () => {},
    firmador: await crearFirmador(undefined, undefined, undefined, { uso: 'estimaciones' }),
    politica: 'ocupacion',
    oferta: OFERTA_POR_DEFECTO,
    motorDeCursos: puertaConSusDatos(motorDeCursos, datos),
    caminoAMano: CAMINO_A_MANO_POR_DEFECTO,
    origenesPermitidos: [],
    limitadores: crearLimitadores(),
    ipDeCloudflare: false,
    mcp: null,
    a2a: null,
    socios: null,
    ...cambios,
  };
}
