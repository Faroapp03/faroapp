// Consulta íntegra de las tareas, detrás de las dos hojas: en el orden de la hoja 1, con sus notas y sus márgenes.
import { cifraHasta } from '../../comun/cifras.js';
import type { Informe, TareaInforme } from '../../dominio/tipos-informe.ts';
import type { InformeBreve, TareaBreve } from '../../dominio/tipos-informe-breve.ts';
import { escapar } from '../html.ts';
import type { LenguaHtml } from '../lengua-html.ts';
import { type ClaveBreve, texto } from './idioma.ts';
import { desplegableDeConsulta } from './piezas.ts';

const POR_CIEN = 100;
// Conserva la precisión publicada (hasta dos decimales) sin rellenar los enteros con ceros.
/** El margen, en puntos de 0 a 100, con hasta dos decimales. */
const DECIMALES_DEL_MARGEN = 2;
const TIEMPOS = { mucho: 'Mucho', algo: 'Algo', poco: 'Poco' } as const satisfies Record<string, ClaveBreve>;

export interface TareaConsultable {
  tarea: TareaBreve;
  texto: string;
  margen: string | null;
  incierta: boolean | null;
}

/** Empareja ocurrencias en el orden del informe; no adivina identidades por parecido ni descarta duplicados. */
export function tareasConsultables(breve: InformeBreve, informe: Informe): TareaConsultable[] {
  const pendientes = new Map<string, TareaInforme[]>();
  const clave = (tarea: Pick<TareaBreve, 'nombre' | 'tiempo'>) => JSON.stringify([tarea.nombre, tarea.tiempo]);
  for (const tarea of informe.tareas) {
    const grupo = pendientes.get(clave(tarea)) ?? [];
    grupo.push(tarea);
    pendientes.set(clave(tarea), grupo);
  }
  return breve.tareas.map((tarea) => {
    // Con nombre y tiempo iguales, ambos órdenes conservan la nota descendente y las ocurrencias estables.
    const original = pendientes.get(clave(tarea))?.shift();
    return {
      tarea,
      texto: original?.texto ?? tarea.nombre,
      margen: original?.margen
        ? original.margen.map((valor) => cifraHasta(POR_CIEN * valor, DECIMALES_DEL_MARGEN)).join('–')
        : null,
      incierta: original?.incierta ?? null,
    };
  });
}

export function consultaDeLasTareas(tareas: readonly TareaConsultable[], lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  const filas = tareas
    .map(
      ({ tarea, texto: completo, margen, incierta }, indice) =>
        `<tr><th scope="row">${indice + 1}</th><td>${lengua.dato(completo)}</td><td>${texto(idioma, TIEMPOS[tarea.tiempo])}</td><td>${tarea.valor === null ? texto(idioma, 'Sin nota') : tarea.valor}</td><td>${escapar(margen ?? '—')}${incierta ? ` · ${texto(idioma, 'Incierta')}` : ''}</td></tr>`,
    )
    .join('');
  const primero = `<p>${texto(idioma, 'Todas tus tareas, en el mismo orden y con los mismos números que «Tus tareas, una a una». Las notas y los márgenes se expresan de 0 a 100; un margen no es una probabilidad.')}</p>`;
  const tabla = `<table class="ib-tabla"><thead><tr><th scope="col">N.º</th><th scope="col">${texto(idioma, 'Tarea')}</th><th scope="col">${texto(idioma, 'Tiempo')}</th><th scope="col">${texto(idioma, 'Nota')}</th><th scope="col">${texto(idioma, 'Margen')}</th></tr></thead><tbody>${filas}</tbody></table>`;
  return `<details class="ib-contexto ib-consulta-tareas metodo">${desplegableDeConsulta(texto(idioma, 'Detalle de todas las tareas'), `${primero}${tabla}`)}</details>`;
}
