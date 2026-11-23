// Selección de un reparto censal ya publicado; sin imputar actividad a personas ni cruzar tasas empresariales.
import type { ContextoSectorial, DatosSectores } from './tipos-contexto-empresarial.ts';

const CIFRAS_CNO3 = 3;

/** Solo una correspondencia CNO inequívoca permite escoger su grupo; la única ampliación es la remisión publicada. */
export function contextoSectorial(cnos: readonly string[], datos: DatosSectores | undefined): ContextoSectorial | null {
  const cno = cnos.length === 1 ? cnos[0] : undefined;
  if (!datos || !cno || datos.clasificacion_actividad !== 'CNAE-2009' || datos.clasificacion_ocupacion !== 'CNO-11') {
    return null;
  }
  const solicitado = cno.slice(0, CIFRAS_CNO3);
  const origen = datos.cataluna.cno3[solicitado];
  if (!origen) {
    return null;
  }
  const mostrado = origen.ver_cno2 ?? solicitado;
  const reparto = origen.ver_cno2 ? datos.cataluna.cno2[mostrado] : origen;
  if (!reparto?.sectores || reparto.sin_reparto || (origen.ver_cno2 && mostrado !== solicitado.slice(0, 2))) {
    return null;
  }
  if (reparto.sectores.some(([codigo]) => !datos.actividades[codigo])) {
    return null;
  }
  return {
    fuente: datos.fuente,
    fecha: datos.fecha_de_referencia,
    periodo: datos.vigencia.periodo,
    grupoSolicitado: solicitado,
    grupoMostrado: mostrado,
    remision: mostrado !== solicitado,
    personas: reparto.personas,
    sectores: reparto.sectores.map(([codigo, porcentaje, personas]) => ({
      codigo,
      nombre: datos.actividades[codigo] ?? '',
      porcentaje,
      personas,
    })),
    otros: reparto.otros_pct ?? null,
    minimoPersonas: datos.min_personas_sector,
    minimoPorcentaje: datos.min_pct_sector,
  };
}
