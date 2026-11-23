/** Montaje de prueba de la encuesta: el objeto durable real sobre node:sqlite, su cliente y el panel con sesión. */
import type { DatabaseSync } from 'node:sqlite';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { AlmacenEncuestaDurable } from '../../src/encuesta/cliente-durable.ts';
import {
  AccesoPublicoDurable,
  type EspacioAccesoPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

export const ORIGEN = 'https://panel.example';

function estadoSqlite(db: DatabaseSync): EstadoAccesoPublicoDurable {
  return {
    storage: {
      sql: {
        exec: (sql: string, ...valores: ValorSql[]) => {
          const filas = db.prepare(sql).all(...valores);
          return { toArray: () => filas };
        },
      },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const resultado = accion();
          db.exec('COMMIT');
          return resultado;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
}

/** Cada mensaje que el Worker envía al objeto durable, con su ruta y su cuerpo, para comprobar qué cruza el enlace. */
export interface MensajePrivado {
  readonly ruta: string;
  readonly cuerpo: string;
}
/** Cada respuesta del objeto durable al Worker, con su ruta y su tamaño en bytes, para medirla contra su tope. */
export interface RespuestaPrivada {
  readonly ruta: string;
  readonly bytes: number;
}
/** El espacio del objeto durable que anota cada mensaje que le llega y el tamaño de cada respuesta que da. */
function espacioQueAnota(
  durable: AccesoPublicoDurable,
  mensajes: MensajePrivado[],
  respuestas: RespuestaPrivada[],
): EspacioAccesoPublicoDurable {
  return {
    idFromName: (nombre) => nombre,
    get: () => ({
      fetch: async (peticion) => {
        const ruta = new URL(peticion.url).pathname;
        mensajes.push({ ruta, cuerpo: await peticion.clone().text() });
        const respuesta = await durable.fetch(peticion);
        respuestas.push({ ruta, bytes: (await respuesta.clone().arrayBuffer()).byteLength });
        return respuesta;
      },
    }),
  };
}
export async function montarEncuesta(db: DatabaseSync) {
  const durable = new AccesoPublicoDurable(estadoSqlite(db), {});
  const mensajes: MensajePrivado[] = [];
  const respuestas: RespuestaPrivada[] = [];
  const espacio = espacioQueAnota(durable, mensajes, respuestas);
  const sesion = new SesionUnicaDurable(espacio);
  await sesion.prepararPanel(POLITICA_PANEL);
  const encuesta = new AlmacenEncuestaDurable(espacio);
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen: sesion,
    encuesta,
    guardiaAdministrativa: async (r) =>
      r.headers.get('cf-access-jwt-assertion') === 'identidad-ficticia'
        ? principalDePrueba('https://fixture.cloudflareaccess.com', 'administrador-ficticio')
        : null,
  });
  /** Una operación del panel con las cabeceras de la página; `cambios` sustituye cabeceras o, con null, las quita. */
  const panel = (ruta: string, token: string, cuerpo: unknown = {}, cambios: Record<string, string | null> = {}) => {
    const cabeceras = new Headers({
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'x-faro-panel': '1',
      'content-type': 'application/json',
      'cf-access-jwt-assertion': 'identidad-ficticia',
      'x-faro-sesion': token,
    });
    for (const [nombre, valor] of Object.entries(cambios)) {
      if (valor === null) {
        cabeceras.delete(nombre);
      } else {
        cabeceras.set(nombre, valor);
      }
    }
    return router(
      new Request(`${ORIGEN}/administracion/api/${ruta}`, {
        method: 'POST',
        body: JSON.stringify(cuerpo),
        headers: cabeceras,
      }),
    );
  };
  const abierta = await panel('sesion/abrir', '');
  const { token } = (await abierta.json()) as { token: string };
  return { encuesta, mensajes, respuestas, panel, token };
}

/** Una petición pública a la encuesta, como la envía la página. */
export function envio(cuerpo: unknown, cabeceras: Record<string, string> = {}): Request {
  return new Request('https://faro.example/encuesta/responder', {
    method: 'POST',
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    headers: { 'content-type': 'application/json', ...cabeceras },
  });
}
export const PARTICIPANTE_COMPLETO = {
  informe: 'visto',
  ocupacion: 'si',
  comprension: 4,
  formacion: 5,
  dificultad: 'nada',
};
export const PROFESIONAL_COMPLETO = {
  ayudaOrientacion: 5,
  explicarCambio: 4,
  encajeFormacion: 3,
  fiabilidad: 4,
  mejora: 'accesibilidad',
};
