// El paquete de JavaScript para el navegador: cada página carga un único módulo de entrada, minificado y sin mapas de
// código, y el motor del dispositivo se publica empaquetado desde sus fuentes. Lo construye esbuild sobre la copia de
// la web que prepara la construcción (construir.ts), antes de las huellas, la CSP y la copia sin conexión.
// - Zonas (empaquetado/zonas.ts): las páginas públicas, las de cada extensión (en su carpeta, bajo sus rutas
//   protegidas) y el panel privado (en administracion/js/) se empaquetan por separado, para que el código de una zona
//   nunca se publique en la carpeta de otra.
// - Cada zona deja todos sus archivos a la misma profundidad. Así `import.meta.url` de cada módulo se reescribe a la
//   dirección que tenía su fuente, y las direcciones que calcula a partir de ella siguen siendo las mismas
//   (empaquetado/fuentes.ts).
// - El Worker del motor (scripts/motor-local/worker.js) se empaqueta solo, en su misma dirección: no tiene mapa de
//   módulos y el service worker lo sirve únicamente si cuadra con su huella.
// - El motor (tsconfig.navegador.json) se empaqueta en motor/, con sus entradas en la dirección fija que cargan el
//   Worker y las páginas; sus trozos llevan la huella en el nombre (empaquetado/construccion.ts).
// - Los dos guiones clásicos, la barrera de versión, el service worker y sus piezas no se empaquetan.
// - Las importaciones con dirección calculada que quedan forman una lista cerrada, cada una con su motivo
//   (empaquetado/importaciones-calculadas.ts): una nueva detiene la construcción. Es el contrato del grafo emitido; lo
//   que se carga con fetch no forma parte de él.
// El resumen del grafo (por página, entradas, trozos y bytes) se comprueba contra PRESUPUESTOS (empaquetado/grafo.ts)
// y se publica fuera de la web, junto al artefacto.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  avisosInesperados,
  empaquetarMotor,
  empaquetarWorker,
  empaquetarZona,
  entradaDeLaPagina,
} from './empaquetado/construccion.ts';
import type { Observado } from './empaquetado/fuentes.ts';
import {
  codigoDeServidor,
  type FormaDelPaquete,
  type GrafoDePagina,
  grafoDePagina,
  type PaqueteNavegador,
  type ResumenDelGrafo,
} from './empaquetado/grafo.ts';
import { problemasDeCalculadas, resumenDeCalculadas } from './empaquetado/importaciones-calculadas.ts';
import { PUBLICACIONES_DEL_LECTOR } from './empaquetado/lector.ts';
import { PANEL, paginaConEntrada, seEmpaqueta, ZONA_DEL_PANEL, type Zona, zonas } from './empaquetado/zonas.ts';
import { archivosPublicados } from './publicados.ts';

export {
  comprobarGrafoEmitido,
  type FormaDelPaquete,
  type GrafoDePagina,
  type PaqueteNavegador,
  PRESUPUESTOS,
  type ResumenDelGrafo,
} from './empaquetado/grafo.ts';
export { IMPORTACIONES_CALCULADAS } from './empaquetado/importaciones-calculadas.ts';
export { paginaConEntrada, seEmpaqueta } from './empaquetado/zonas.ts';

/** La forma que se publica, elegida con las cifras de las dos. */
export const FORMA_DEL_PAQUETE: FormaDelPaquete = 'compartida';
/** El resumen del grafo emitido, que la construcción deja junto al artefacto. */
export const RESUMEN_DEL_GRAFO = 'grafo-emitido.json';

type ZonaConstruida = { readonly zona: Zona } & Awaited<ReturnType<typeof empaquetarZona>>;

function bytesDe(archivos: ReadonlyMap<string, Uint8Array>): number {
  return [...archivos.values()].reduce((suma, bytes) => suma + bytes.byteLength, 0);
}

/** El grafo de cada página y su HTML con una sola entrada; añade a `archivos` los de cada zona. */
function paginasDelPaquete(web: string, construidas: readonly ZonaConstruida[], archivos: Map<string, Uint8Array>) {
  const paginas: Record<string, GrafoDePagina> = {};
  const html = new Map<string, string>();
  const peso = (ruta: string) => archivos.get(ruta)?.byteLength ?? 0;
  for (const { archivos: propios } of construidas) {
    for (const [ruta, bytes] of propios) {
      archivos.set(ruta, bytes);
    }
  }
  for (const { zona, renombres, salidaDePagina, metafile } of construidas) {
    const nombre = (ruta: string) => renombres.get(ruta) ?? ruta;
    for (const pagina of zona.paginas) {
      const grafo = grafoDePagina(metafile, entradaDeLaPagina(salidaDePagina, pagina.ruta), nombre, peso);
      paginas[pagina.ruta] = grafo;
      const fuente = readFileSync(join(web, pagina.ruta), 'utf8');
      html.set(pagina.ruta, paginaConEntrada(pagina.ruta, fuente, grafo.entrada, grafo.estaticos));
    }
  }
  return { paginas, html };
}

/** Las construcciones de todas las zonas, el Worker y el motor, con los avisos que no se esperaban. */
async function construcciones(web: string, forma: FormaDelPaquete, observado: Observado) {
  const construidas: ZonaConstruida[] = [];
  for (const zona of zonas(web)) {
    construidas.push({ zona, ...(await empaquetarZona(web, zona, forma, observado)) });
  }
  const worker = await empaquetarWorker(web, observado);
  const motor = await empaquetarMotor(web, forma, observado.revisiones);
  const problemas = [
    ...construidas.flatMap(({ avisos }) => avisosInesperados(avisos, forma)),
    ...avisosInesperados(worker.avisos, forma),
    ...motor.avisos.map(({ text }) => text),
  ];
  return { construidas, worker, motor, problemas };
}

/** Las fuentes de la web que el paquete sustituye y las que no alcanza nada. */
function fuentesSustituidas(
  web: string,
  { construidas, worker }: Awaited<ReturnType<typeof construcciones>>,
  archivos: ReadonlyMap<string, Uint8Array>,
) {
  const empaquetadas = new Set(
    [...construidas.map(({ metafile }) => metafile), worker.metafile]
      .flatMap(({ inputs }) => Object.keys(inputs))
      // Solo las fuentes de la copia de la web: el lector entra desde src/, que no se toca.
      .filter((entrada) => entrada.endsWith('.js') && !entrada.startsWith('../') && existsSync(join(web, entrada))),
  );
  // Las fuentes a las que no llega nada no se publican: se listan en el resumen para retirarlas del repositorio.
  const sinAlcanzar = archivosPublicados(web).filter(
    (archivo) =>
      seEmpaqueta(archivo) &&
      !empaquetadas.has(archivo) &&
      !archivos.has(archivo) &&
      !PUBLICACIONES_DEL_LECTOR.includes(archivo),
  );
  const publicados = new Set(archivosPublicados(web));
  for (const archivo of PUBLICACIONES_DEL_LECTOR.filter((publicacion) => publicados.has(publicacion))) {
    empaquetadas.add(archivo);
  }
  return { empaquetadas, sinAlcanzar };
}

/** Los archivos JavaScript de cada zona, del Worker y del motor. */
function porZona({ construidas, worker, motor }: Awaited<ReturnType<typeof construcciones>>): Record<string, number> {
  const cuenta: Record<string, number> = { motor: motor.archivos.size, worker: worker.archivos.size };
  for (const { zona, archivos } of construidas) {
    cuenta[zona.id] = [...archivos.keys()].filter((ruta) => ruta.endsWith('.js')).length;
  }
  return cuenta;
}

/**
 * Empaqueta la web de `web` (la copia de la construcción) sin escribir nada: devuelve los archivos que sustituyen a los
 * módulos de la web, las páginas reescritas y el resumen del grafo.
 *
 * @param web - La copia de la web que se construye, con sus fuentes de JavaScript sin transformar.
 * @param forma - La forma del paquete; por omisión, la que se publica.
 * @returns El paquete, las páginas con su entrada y las fuentes que el paquete sustituye.
 */
export async function empaquetarWeb(
  web: string,
  forma: FormaDelPaquete = FORMA_DEL_PAQUETE,
  revisiones?: ReadonlyMap<string, Uint8Array>,
) {
  const observado: Observado = { calculadas: [], ...(revisiones ? { revisiones } : {}) };
  const construido = await construcciones(web, forma, observado);
  const { construidas, worker, motor } = construido;
  const archivos = new Map<string, Uint8Array>([...worker.archivos, ...motor.archivos]);
  const { paginas, html } = paginasDelPaquete(web, construidas, archivos);
  const { empaquetadas, sinAlcanzar } = fuentesSustituidas(web, construido, archivos);
  const servidor = codigoDeServidor(motor.metafile);
  const enPanel = construidas
    .filter(({ zona }) => zona.id !== ZONA_DEL_PANEL.id)
    .flatMap(({ metafile }) => Object.keys(metafile.inputs).filter((entrada) => entrada.startsWith(PANEL)));
  const problemas = [
    ...construido.problemas,
    ...problemasDeCalculadas(observado.calculadas, (archivo) => existsSync(join(web, archivo))),
    ...enPanel.map((entrada) => `${entrada}: el panel privado no puede ir en el paquete de otra zona`),
  ];
  const js = [...archivos].filter(([ruta]) => ruta.endsWith('.js'));
  const resumen: ResumenDelGrafo = {
    forma,
    paginas,
    worker: { archivos: [...worker.archivos.keys()], bytes: bytesDe(worker.archivos) },
    motor: { entradas: motor.entradas, archivos: [...motor.archivos.keys()].sort(), bytes: bytesDe(motor.archivos) },
    totales: { js: js.length, bytes: bytesDe(new Map(js)), porZona: porZona(construido) },
    servidorPorRuta: servidor.servidor,
    privados: [...servidor.privados, ...enPanel],
    contratoDelDispositivo: servidor.contrato,
    importacionesCalculadas: resumenDeCalculadas(observado.calculadas),
    fuentesEmpaquetadas: empaquetadas.size,
    fuentesSinAlcanzar: sinAlcanzar,
  };
  if (problemas.length) {
    throw new Error(`El paquete del navegador no se puede publicar:\n${problemas.join('\n')}`);
  }
  return {
    paquete: { archivos, motor: motor.archivos, resumen } satisfies PaqueteNavegador,
    html,
    empaquetadas: new Set([...empaquetadas, ...sinAlcanzar]),
  };
}

/**
 * Sustituye en la copia de la web los módulos por el paquete: retira las fuentes empaquetadas y escribe las páginas.
 * Los archivos del paquete los escribe quien construye, que comprueba que no sustituyen a nada.
 */
export function retirarFuentes(web: string, empaquetadas: ReadonlySet<string>): void {
  for (const fuente of empaquetadas) {
    rmSync(join(web, fuente));
  }
}
