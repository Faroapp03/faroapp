// Trabajador compartido por Node y navegador: carga el motor una vez, conserva los datos del paquete enviados por
// su puerta y responde consultas factuales. La puerta lo termina si una operación no responde a tiempo, sin bloquear
// Ocupaciones. No lee archivos indicados en los argumentos.

import { comprobarMotor, esAusencia, FalloDelMotor, mensajeDe } from './motor-de-cursos.ts';
import {
  aplicarOperacion,
  esGuardado,
  esOrigen,
  type MensajeAlTrabajador,
  type MensajeDelTrabajador,
} from './operaciones-de-cursos.ts';

/** Lo que el trabajador necesita de su plataforma: cargar el motor, leer el paquete y mandar mensajes a la puerta. */
export interface PlataformaDelTrabajador {
  readonly importar: () => Promise<object>;
  readonly enviar: (mensaje: MensajeDelTrabajador) => void;
}

/** Rechaza referencias de memoria o archivos; solo admite argumentos con sus valores factuales. */
function exigirArgumentosFactuales(mensaje: Extract<MensajeAlTrabajador, { tipo: 'operacion' }>): void {
  if ('guardarEn' in mensaje || mensaje.argumentos.some(esOrigen) || mensaje.argumentos.some(esGuardado)) {
    throw new Error('Las consultas factuales no aceptan referencias de recursos o archivos');
  }
}

/**
 * Pone en marcha el trabajador: carga el motor y devuelve lo que atiende cada mensaje de la puerta.
 *
 * @param plataforma - La carga del motor y el envío de mensajes.
 * @returns La función que atiende un mensaje.
 */
export function iniciarTrabajadorDeCursos({
  importar,
  enviar,
}: PlataformaDelTrabajador): (mensaje: MensajeAlTrabajador) => Promise<void> {
  const guardados = new Map<string, unknown>();
  const motor = Promise.resolve()
    .then(importar)
    .then(comprobarMotor)
    .then(
      (cargado) => {
        enviar({ tipo: 'listo' });
        return cargado;
      },
      (error: unknown) => {
        const ausente = error instanceof FalloDelMotor ? error.motivo === 'ausente' : esAusencia(error);
        enviar({ tipo: 'sin-motor', motivo: ausente ? 'ausente' : 'averiado', detalle: mensajeDe(error) });
        return null;
      },
    );
  return async (mensaje) => {
    if (mensaje.tipo === 'guardar') {
      guardados.set(mensaje.clave, mensaje.valor);
      return;
    }
    const { id } = mensaje;
    try {
      const cargado = await motor;
      if (cargado === null) {
        throw new Error('el motor de cursos no se ha cargado');
      }
      if (mensaje.datos !== null && !guardados.has(mensaje.datos)) {
        throw new Error('El trabajador no tiene los datos de esta consulta');
      }
      exigirArgumentosFactuales(mensaje);
      const datos = mensaje.datos === null ? undefined : guardados.get(mensaje.datos);
      const argumentos = mensaje.argumentos;
      const valor = await aplicarOperacion(cargado, mensaje.nombre, datos, argumentos);
      enviar({ tipo: 'hecho', id, valor });
    } catch (error) {
      enviar({ tipo: 'fallo', id, detalle: mensajeDe(error) });
    }
  };
}
