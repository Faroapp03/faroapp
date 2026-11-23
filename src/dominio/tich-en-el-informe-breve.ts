// La encuesta TIC-H en el informe breve: los años que mide el dato y la señal de las personas de su grupo, con la
// edición nueva que el INE ya publicó y el dato aún no incorpora, observada en su catálogo (su forma, en
// forma-del-dato-tich.ts).

import { diaObservado } from './forma-del-dato-tich.ts';
import { PROXIMA_TICH, TICH_PUBLICADA_SEGUN_CALENDARIO } from './hechos-del-informe-breve.ts';
import type { DatosTich } from './tipos-contexto.ts';
import type { SenalBreve } from './tipos-informe-breve.ts';

export { aniosMedidos } from './forma-del-dato-tich.ts';

/** La señal de las personas: la fecha prevista y, si el dato la trae, la edición ya publicada que aún no incorpora. */
export function senalDeLasPersonas(tich: DatosTich | undefined): SenalBreve {
  const nueva = tich?.edicion_nueva;
  // El calendario solo dice algo nuevo si su edición es posterior a la que trae el dato; si es la misma, ya se muestra.
  const publicadaCal = TICH_PUBLICADA_SEGUN_CALENDARIO;
  const posterior = publicadaCal !== null && tich !== undefined && Number(publicadaCal) > Number(tich.anio);
  const calendario = posterior ? { publicadaSegunCalendario: publicadaCal } : {};
  return tich && nueva
    ? {
        clave: 'personas',
        proxima: PROXIMA_TICH,
        ...calendario,
        publicada: {
          anio: nueva.anio,
          observada: diaObservado(nueva, tich.anio),
          conMicrodatos: nueva.estado === 'pendiente-de-incorporar',
        },
      }
    : { clave: 'personas', proxima: PROXIMA_TICH, ...calendario };
}
