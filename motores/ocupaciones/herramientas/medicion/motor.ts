// Carga el motor de la versión medida desde --producto, como lo usa la pantalla: datos del paquete, tabla de
// atributos, vectores del dispositivo (salvo --sin-vectores) y el clasificador de fragmentos si la pantalla lo usa.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Opciones } from './opciones.ts';
import type {
  Atributos,
  Busqueda,
  Clasificador,
  DatosDelPaquete,
  Motor,
  Previa,
  SalidaDePantalla,
  Vectores,
} from './tipos.ts';

const leerJson = (ruta: string): unknown => JSON.parse(readFileSync(ruta, 'utf8'));
const del = (producto: string, ruta: string): string => join(producto, 'motores/ocupaciones', ruta);

interface Servicio {
  pasoDePantalla: Motor['pasoDePantalla'];
  buscar: Motor['buscar'];
  textoDeBusqueda: (texto: string) => string;
}

interface Fusion {
  usarVectores: (vectores: Vectores | null) => void;
  previaCalibrada: (datos: DatosDelPaquete, busqueda: Busqueda, contexto: object) => Previa;
  textoParaVectores?: (datos: DatosDelPaquete, texto: string, busqueda: Busqueda) => string;
  usarClasificador: (clasificador: Clasificador) => void;
  CLASIFICADOR_EN_LA_PANTALLA?: boolean;
}

async function cargarVectores(producto: string, fusion: Fusion, conVectores: boolean): Promise<Vectores | null> {
  if (!conVectores) {
    fusion.usarVectores(null);
    return null;
  }
  const modulo = (await import(del(producto, 'src/recorrido/fusion/vectores-movil.ts'))) as {
    cargarDesdeContenedor: (contenedor: unknown) => Promise<Vectores>;
  };
  const vectores = await modulo.cargarDesdeContenedor(leerJson(join(producto, 'datos/vectores-movil.json')));
  fusion.usarVectores(vectores);
  return vectores;
}

/** El clasificador que se mide: el de --clasificador o, si la pantalla lo usa y el paquete lo trae, ese. */
function clasificadorUsado(producto: string, fusion: Fusion, opciones: Opciones): string | null {
  if (opciones.sinClasificador) {
    return null;
  }
  if (opciones.clasificador !== null) {
    return String(opciones.clasificador);
  }
  const delPaquete = join(producto, 'datos/clasificador-movil.json');
  return fusion.CLASIFICADOR_EN_LA_PANTALLA === true && existsSync(delPaquete) ? delPaquete : null;
}

async function cargarClasificador(producto: string, fusion: Fusion, ruta: string | null): Promise<Clasificador | null> {
  if (!ruta) {
    return null;
  }
  const modulo = (await import(del(producto, 'src/recorrido/fusion/clasificador-movil.ts'))) as {
    cargarClasificador: (contenido: unknown) => Clasificador;
  };
  const clasificador = modulo.cargarClasificador(leerJson(ruta));
  fusion.usarClasificador(clasificador);
  return clasificador;
}

/**
 * El motor de la versión medida, cargado en un orden fijo (el orden importa: usarVectores y
 * usarClasificador cambian el estado de la fusión).
 *
 * @param opciones - Las opciones de la medición.
 * @returns Las funciones y los datos que usa el medidor.
 */
export async function cargarMotor(opciones: Opciones): Promise<Motor> {
  const producto = opciones.producto;
  const { cargarDatos } = (await import(join(producto, 'src/plataforma/node/datos.ts'))) as {
    cargarDatos: (carpeta: string) => DatosDelPaquete;
  };
  const { comprobarAtributos } = (await import(del(producto, 'src/recorrido/preguntas/atributos.ts'))) as {
    comprobarAtributos: (crudo: unknown) => Atributos;
  };
  const servicio = (await import(del(producto, 'src/recorrido/pantalla/servicio.ts'))) as Servicio;
  const fusion = (await import(del(producto, 'src/recorrido/pantalla/previa-fusion.ts'))) as Fusion;
  const datos = cargarDatos(join(producto, 'datos'));
  const atributos = comprobarAtributos(leerJson(del(producto, 'src/recorrido/preguntas/atributos.json')));
  const vectores = await cargarVectores(producto, fusion, opciones.conVectores);
  const rutaDelClasificador = clasificadorUsado(producto, fusion, opciones);
  const clasificador = await cargarClasificador(producto, fusion, rutaDelClasificador);
  // La entrada exacta del clasificador en el producto: textoComoEnEsco(textoDeBusqueda(texto)).
  const busqueda = (await import(del(producto, 'src/busqueda/ocupaciones.ts'))) as {
    textoComoEnEsco?: (texto: string) => string;
  };
  const comoEnEsco = busqueda.textoComoEnEsco ?? ((texto: string): string => texto);
  return {
    datos,
    atributos,
    pasoDePantalla: (d, a, e): SalidaDePantalla => servicio.pasoDePantalla(d, a, e),
    buscar: (d, t, i): Busqueda => servicio.buscar(d, t, i),
    previaCalibrada: (d, b, c): Previa => fusion.previaCalibrada(d, b, c),
    textoParaVectores: fusion.textoParaVectores,
    entradaDelClasificador: (texto) => comoEnEsco(servicio.textoDeBusqueda(texto)),
    vectores,
    clasificador,
    huellaDelClasificador: rutaDelClasificador
      ? createHash('sha256').update(readFileSync(rutaDelClasificador)).digest('hex')
      : null,
  };
}
