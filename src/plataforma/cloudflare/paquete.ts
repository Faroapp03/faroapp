// Paquete de datos del Worker: imports JSON explícitos de datos/ para empaquetar las partes usadas por el motor.
// Cada parte se lee la primera vez que se pide y después conserva el mismo resultado preparado en memoria.
// En Cloudflare los módulos de datos llegan como bytes; leerArchivoDelPaquete los analiza y suelta su ArrayBuffer, y
// guarda el texto hasta que la parte queda guardada, para que una lectura cortada se pueda repetir.
// En Node llegan ya analizados como objetos. La tabla común asigna cada archivo a su parte y a su preparación.
// MODULOS cubre todos los archivos de la tabla: no se importa el manifiesto ni los datos que el motor no consume.

import acreditacion from '../../../datos/acreditacion.json' with { type: 'json' };
import actic from '../../../datos/actic.json' with { type: 'json' };
import barcelonaActiva from '../../../datos/barcelonactiva.json' with { type: 'json' };
import catalan from '../../../datos/catalan.json' with { type: 'json' };
import cataluna from '../../../datos/cataluna.json' with { type: 'json' };
import censo from '../../../datos/censo.json' with { type: 'json' };
import certificadosSepe2016 from '../../../datos/certificados-sepe-2016.json' with { type: 'json' };
import citilab from '../../../datos/citilab.json' with { type: 'json' };
import clasificaciones from '../../../datos/clasificaciones.json' with { type: 'json' };
import comarcas from '../../../datos/comarcas.json' with { type: 'json' };
import consorci from '../../../datos/consorci.json' with { type: 'json' };
import eures from '../../../datos/correspondencia-eures.json' with { type: 'json' };
import empresas from '../../../datos/empresas.json' with { type: 'json' };
import enlaces from '../../../datos/enlaces-comprobados.json' with { type: 'json' };
import esco from '../../../datos/esco.json' with { type: 'json' };
import cambra from '../../../datos/exposicion-cambra.json' with { type: 'json' };
import formacion from '../../../datos/formacion.json' with { type: 'json' };
import formacionAbierta from '../../../datos/formacion-abierta.json' with { type: 'json' };
import fundae from '../../../datos/fundae.json' with { type: 'json' };
import mercado from '../../../datos/mercado.json' with { type: 'json' };
import metodos from '../../../datos/metodos.json' with { type: 'json' };
import observatori from '../../../datos/observatori.json' with { type: 'json' };
import ocupados from '../../../datos/ocupados.json' with { type: 'json' };
import oit from '../../../datos/oit.json' with { type: 'json' };
import perfilesSepe from '../../../datos/perfiles-sepe.json' with { type: 'json' };
import salarios from '../../../datos/salarios.json' with { type: 'json' };
import sectores from '../../../datos/sectores.json' with { type: 'json' };
import necesidades from '../../../datos/sepe-necesidades.json' with { type: 'json' };
import temarios from '../../../datos/temarios.json' with { type: 'json' };
import textos from '../../../datos/textos.json' with { type: 'json' };
import tich from '../../../datos/tich.json' with { type: 'json' };
import vectoresFormacion from '../../../datos/vectores-formacion.json' with { type: 'json' };
import vectores from '../../../datos/vectores-oit.json' with { type: 'json' };
import { leerArchivoDelPaquete, soltarArchivoDelPaquete } from '../../comun/archivo-del-paquete.ts';
import { conTextosCompartidos } from '../../comun/textos-compartidos.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import { ARCHIVO_DE_CADA_PARTE, type ArchivoDelPaquete, PARTES, prepararParte } from '../archivos-del-paquete.ts';

/** Cada archivo del paquete, importado: en el Worker, sus bytes hasta que se lee. */
const MODULOS: Record<ArchivoDelPaquete, unknown> = {
  'esco.json': esco,
  'oit.json': oit,
  'clasificaciones.json': clasificaciones,
  'exposicion-cambra.json': cambra,
  'textos.json': textos,
  'vectores-oit.json': vectores,
  'correspondencia-eures.json': eures,
  'formacion.json': formacion,
  'consorci.json': consorci,
  'enlaces-comprobados.json': enlaces,
  'citilab.json': citilab,
  'formacion-abierta.json': formacionAbierta,
  'barcelonactiva.json': barcelonaActiva,
  'fundae.json': fundae,
  'comarcas.json': comarcas,
  'temarios.json': temarios,
  'vectores-formacion.json': vectoresFormacion,
  'cataluna.json': cataluna,
  'ocupados.json': ocupados,
  'censo.json': censo,
  'tich.json': tich,
  'salarios.json': salarios,
  'observatori.json': observatori,
  'mercado.json': mercado,
  'empresas.json': empresas,
  'sectores.json': sectores,
  'metodos.json': metodos,
  'catalan.json': catalan,
  'acreditacion.json': acreditacion,
  'perfiles-sepe.json': perfilesSepe,
  'certificados-sepe-2016.json': certificadosSepe2016,
  'sepe-necesidades.json': necesidades,
  'actic.json': actic,
};

/**
 * Lee una parte del paquete y la deja como queda en memoria: con una sola copia de cada texto corto que se repite
 * (conTextosCompartidos) y preparada como en el navegador (prepararParte).
 */
function leerParte<Parte extends keyof Datos>(parte: Parte, datos: Datos, importado: unknown): Datos[Parte] {
  const esco = parte === 'catalan' ? datos.esco : undefined;
  return prepararParte(parte, conTextosCompartidos(leerArchivoDelPaquete(importado)), esco);
}

/**
 * Los datos del paquete, con cada parte leída la primera vez que se pide; después se queda como una propiedad normal,
 * que no se puede reasignar. Su forma se afirma con `as Datos`: cada archivo es, byte a byte, el que exportó y validó la
 * cadena de datos con su manifiesto de huellas, y el Worker no lo vuelve a comprobar para no gastar su segundo de
 * arranque.
 *
 * Una parte leída se guarda primero en una sola asignación; después se suelta su texto y se fija la propiedad. Si el
 * aislado se corta antes de guardarla, la lectura siguiente la repite desde el texto conservado. Si se corta después,
 * la parte queda pendiente de cerrar, y la siguiente lectura de ella misma o de cualquier parte aún sin fijar suelta
 * su texto y fija su propiedad.
 *
 * @param modulos - Cada archivo del paquete, tal como lo entrega su import.
 */
export function datosQueSeLeenAlUsarlos(modulos: Readonly<Record<ArchivoDelPaquete, unknown>>): Datos {
  const datos = {};
  const sinCerrar = new Set<() => void>();
  for (const parte of PARTES) {
    const importado = modulos[ARCHIVO_DE_CADA_PARTE[parte]];
    let guardada: { readonly valor: Datos[typeof parte] } | undefined;
    const cerrar = (): void => {
      if (guardada === undefined) {
        return;
      }
      soltarArchivoDelPaquete(importado);
      Object.defineProperty(datos, parte, { value: guardada.valor, enumerable: true });
      sinCerrar.delete(cerrar);
    };
    Object.defineProperty(datos, parte, {
      enumerable: true,
      configurable: true,
      get() {
        sinCerrar.add(cerrar);
        for (const pendiente of sinCerrar) {
          pendiente();
        }
        guardada ??= { valor: leerParte(parte, datos as Datos, importado) };
        cerrar();
        return guardada.valor;
      },
    });
  }
  return datos as Datos;
}

/** El paquete de datos del Worker: uno por aislado, porque cada archivo se lee una sola vez. */
export const PAQUETE: Datos = datosQueSeLeenAlUsarlos(MODULOS);
