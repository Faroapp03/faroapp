/** Estados de datos con avisos y su pintado en cada idioma, para las pruebas de la vista de datos. */
import assert from 'node:assert/strict';
import { type EstadoDatosPanel, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { resumirSaludDatos } from '../../src/administracion/salud-datos.js';
import { mostrarEstadoDatos } from '../../web/administracion/vista-datos.js';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { CONSULTA_SALUD, instantaneaSalud } from '../ayudas/salud-datos.ts';
import { html, nodo } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';

const LONGITUD_HUELLA = 64;
export const HUELLA = 'b'.repeat(LONGITUD_HUELLA);
export const OBSERVADO_EN = '2026-10-20T08:00:00Z';
export const TRES = 3;

export type Idioma = 'es' | 'ca';
const DICCIONARIOS = { es, ca } as const;
export function de(idioma: Idioma, clave: string): string {
  const texto = DICCIONARIOS[idioma][clave as keyof typeof es];
  assert.ok(texto, clave);
  return texto;
}

/** El estado de base con la fuente por ediciones y, si se pide, lo que cada prueba añade al estado crudo. */
function crudo(cambios: Record<string, unknown> = {}, fuente: Record<string, unknown> = {}): unknown {
  const base = instantaneaSalud();
  const [primera] = base.fuentes;
  return JSON.parse(JSON.stringify({ ...base, fuentes: [{ ...primera, politica: 'edición', ...fuente }], ...cambios }));
}
export function leer(cambios: Record<string, unknown> = {}, fuente: Record<string, unknown> = {}): EstadoDatosPanel {
  return leerEstadoDatosPanel(crudo(cambios, fuente));
}
/** El seguimiento remoto de la fuente de base con los campos que se pidan (salida parcial, enlaces...). */
export function conSeguimiento(campos: Record<string, unknown>): EstadoDatosPanel {
  const base = instantaneaSalud();
  return leer({
    seguimientoRemoto: [
      {
        fuente: 'empresas',
        ultimoIntento: base.seguimientoRemoto?.[0]?.ultimoIntento,
        incidenciasPendientes: [],
        ...campos,
      },
    ],
  });
}
export function conSalida(salidaParcial: unknown): EstadoDatosPanel {
  return conSeguimiento({ salidaParcial });
}
export function conAlmacen(motivoAlmacen: unknown): EstadoDatosPanel {
  const base = instantaneaSalud();
  const paquete = {
    id: 'paquete',
    ultimoIntento: CONSULTA_SALUD,
    veredicto: 'rojo',
    ultimaVersionBuena: null,
    fallos: 1,
    proximoReintento: '2026-10-23T10:00:00Z',
    ...(motivoAlmacen === undefined ? {} : { motivoAlmacen }),
  };
  return leer({ modulos: [...base.modulos.filter((m) => m.id !== 'paquete'), paquete] });
}
export function pintado(datos: EstadoDatosPanel, idioma: Idioma): string {
  activarIdiomaPanel(idioma);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), datos);
  return destino.textContent;
}
export const estadoDeLaFuente = (datos: EstadoDatosPanel) => resumirSaludDatos(datos).operativas[0]?.estado;
