import type { Parte } from '../../web/scripts/textos.js';
import { Nodo } from './dom.ts';

interface Modo {
  alEnviar: (texto: string) => void | Promise<void>;
  limite: number;
}
/** Una respuesta rápida de Faro, como la recibe conversacion.js. */
export interface Sugerencia {
  texto: Parte;
  accion?: () => void;
  volver?: number;
  clase?: string;
  conservar?: boolean;
}
export const MAX_LETRAS_MENSAJE = 4000;
export const PASO_OCUPACION = 2;
export const PASO_RELATO = 1;
export const PASO_TAREAS = 3;
export const PASO_INFORME = 4;
export const observadas = {
  mensajes: [] as Parte[],
  /** Los nodos que Faro dice dentro de sus mensajes (la ficha de una propuesta, por ejemplo). */
  nodos: [] as Nodo[],
  avisos: [] as unknown[],
  modo: null as Modo | null,
  paso: 0,
  escrito: '',
  /** Las respuestas rápidas que se ven: las últimas ofrecidas. */
  sugerencias: [] as Sugerencia[],
  /** Si se ve la barra de escribir: se esconde mientras toca elegir. */
  compositorVisible: true,
  /** Los pasos de cada pensamiento de Faro, en orden. */
  pensamientos: [] as Parte[][],
  /** El primer paso de cada pensamiento que empieza con una petición al motor. */
  pensamientosEmpezados: [] as Parte[],
  /** Los nodos de esos pensamientos empezados, en el mismo orden. */
  nodosEmpezados: [] as Nodo[],
  /** El mensaje de espera en curso, como el real: mostrarEspera lo pone y quitarEspera lo retira. */
  espera: null as Nodo | null,
  /** De cada pensamiento terminado, el que empezó con su petición (`empezado`), o null si no lo había. */
  pensamientosSeguidos: [] as (Nodo | null)[],
};
export function reiniciarInterfaz() {
  observadas.mensajes = [];
  observadas.nodos = [];
  observadas.avisos = [];
  observadas.modo = null;
  observadas.escrito = '';
  observadas.sugerencias = [];
  observadas.compositorVisible = true;
  observadas.pensamientos = [];
  observadas.pensamientosEmpezados = [];
  observadas.nodosEmpezados = [];
  observadas.espera = null;
  observadas.pensamientosSeguidos = [];
}
export function cambiarModo(modo: Modo) {
  observadas.modo = modo;
}
export function enviar(texto: string) {
  if (!observadas.modo) {
    throw new Error('El paso no ha configurado el compositor');
  }
  return observadas.modo.alEnviar(texto);
}
export function barraLlena(letras: number) {
  return letras <= 0;
}
/** Como en compositor.js, llevar el foco a la barra la vuelve a enseñar. */
export function enfocarCompositor() {
  observadas.compositorVisible = true;
}
export function mostrarCompositor(visible: boolean) {
  observadas.compositorVisible = visible;
}
export function ponerTexto(texto: string) {
  observadas.escrito = texto;
}
export function decirFaro(partes: Parte | Nodo | (Parte | Nodo)[], _opciones?: unknown) {
  // Como el real, lo que dice Faro sustituye a la espera.
  observadas.espera = null;
  for (const parte of Array.isArray(partes) ? partes : [partes]) {
    if (parte instanceof Nodo) {
      observadas.nodos.push(parte);
    } else {
      observadas.mensajes.push(parte);
    }
  }
  return new Nodo('p');
}
/**
 * El pensamiento que empieza con la petición al motor: el doble apunta su primer paso y lo da en curso. Como el real,
 * entra en el mensaje de espera, si lo hay.
 */
export function empezarAPensar(primerPaso: Parte) {
  observadas.pensamientosEmpezados.push(primerPaso);
  const nodo = new Nodo('div');
  nodo.className = 'rc-pensamiento';
  nodo.dataset.estado = 'pensando';
  observadas.nodosEmpezados.push(nodo);
  observadas.espera?.append(nodo);
  return nodo;
}
/**
 * El pensamiento de Faro: el doble lo da ya terminado, sin esperar a sus pasos (no alarga las pruebas). Como el real,
 * sigue con el pensamiento empezado si aún piensa.
 */
export function crearPensamientoEnCurso(
  pasos: Parte[],
  opciones?: { alAparecer?: () => void; empezado?: Nodo | null },
) {
  observadas.pensamientos.push(pasos);
  observadas.pensamientosSeguidos.push(opciones?.empezado ?? null);
  const sigue = opciones?.empezado?.dataset.estado === 'pensando' ? opciones.empezado : null;
  const nodo = sigue ?? new Nodo('div');
  nodo.className = 'rc-pensamiento';
  nodo.dataset.estado = 'hecho';
  return nodo;
}
export const EVENTO_PENSANDO = 'faro-pensando';
export function faroEstaPensando() {
  return false;
}
/** Como en conversacion.js, lo que dice la persona retira las respuestas rápidas. */
export function decirPersona(_parte: Parte) {
  observadas.sugerencias = [];
}
export function decirAvisos(avisos: unknown[], _idioma?: string) {
  observadas.avisos.push(...avisos);
}
export function hayAvisoDeAyuda(avisos: { tipo: string }[]) {
  return avisos.some(({ tipo }) => tipo === 'ayuda');
}
/** La primera respuesta rápida en pantalla: como en el navegador, está conectada hasta que la sustituyen otras. */
let primeraEnPantalla: (Nodo & { isConnected?: boolean }) | null = null;
export function ofrecerSugerencias(sugerencias: Sugerencia[]) {
  observadas.sugerencias = [...sugerencias];
  if (primeraEnPantalla) {
    primeraEnPantalla.isConnected = false;
  }
  primeraEnPantalla = Object.assign(new Nodo('button'), { isConnected: true });
  return primeraEnPantalla;
}
export function llevarALaVista(_nodo: unknown, _posicion?: string) {}
export function mostrarEspera(_parte: Parte) {
  if (!observadas.espera) {
    observadas.espera = new Nodo('div');
    observadas.espera.dataset.tipo = 'espera';
  }
}
export function quitarEspera() {
  observadas.espera = null;
}
export function actualizarEspera(_parte: Parte) {}
export function irA(paso: number) {
  observadas.paso = paso;
}
export function saludar(_opciones?: unknown) {}
export async function completarDatosEnIdioma() {}
