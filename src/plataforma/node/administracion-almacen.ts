import type { ConfiguracionProgramada } from '../../administracion/configuracion-programada.ts';
import type { ConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import { vigilanteConConfiguracionInvalida } from '../../administracion/http-vigilante.ts';
import { crearVigilantePanelNode } from './vigilante-panel.ts';
/** Disponibilidad del mismo SQLite administrativo: éxito compartido, fallos reintentables, nunca otra autoridad. */

import { PLAZO_PANEL_MS } from '../../administracion/http.ts';
import { registrarErrorOperativo } from '../../api/errores.ts';
import { dentroDelPlazo } from '../../api/plazo.ts';
import type { AlmacenAccesoPublico } from '../../api/socios/almacen-publico.ts';
import type { OpcionesDeSocios } from '../../api/socios/servidor-socios.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { AlmacenSesionEncuestaPanelSqlite } from '../../encuesta/almacen-sqlite.ts';
import type { OpcionesAlmacenPublicoNode } from '../acceso-publico/node.ts';
import { abrirSqlAdministrativoNode, crearAlmacenPublicoNode } from '../acceso-publico/node.ts';
import type { AdministracionMontada, OpcionesMontajeAdministrativo } from '../administracion.ts';
import { montarAdministracion } from '../administracion.ts';
import { crearServidorWebAdministrativo } from '../administracion-web.ts';

type Montaje = {
  readonly configuracionVigilante?: ConfiguracionVigilante;
  readonly errorConfiguracionVigilante?: boolean;
  readonly configuracionProgramada?: () => ConfiguracionProgramada | undefined;
} & Pick<
  OpcionesMontajeAdministrativo,
  'configuracion' | 'guardiaAdministrativa' | 'inicial' | 'leerEstadoDatos' | 'actualizacion' | 'activacionHabilitada'
>;
interface Backend {
  readonly almacen: ReturnType<typeof crearAlmacenPublicoNode>;
  readonly encuesta: AlmacenSesionEncuestaPanelSqlite;
  readonly administracion: AdministracionMontada;
  readonly cerrar: () => void;
}
function capacidadVigilante(montaje: Montaje, almacen: ReturnType<typeof crearAlmacenPublicoNode>) {
  if (montaje.errorConfiguracionVigilante) {
    return { vigilante: vigilanteConConfiguracionInvalida() };
  }
  return montaje.configuracionVigilante?.habilitado && montaje.leerEstadoDatos
    ? {
        vigilante: crearVigilantePanelNode(
          almacen.sesion,
          montaje.configuracionVigilante,
          montaje.configuracionProgramada,
          montaje.leerEstadoDatos,
        ),
      }
    : {};
}
/**
 * La encuesta sobre el mismo archivo SQLite, en una conexión propia con borrado seguro: el almacén público no expone la
 * suya, y cada operación comprueba la sesión y escribe en una sola transacción (BEGIN IMMEDIATE), que SQLite serializa
 * con las del resto del panel. Si no se puede abrir, se cierra también el almacén ya abierto; después, se cierran los
 * dos juntos.
 */
function abrirEncuesta(opciones: OpcionesAlmacenPublicoNode, almacen: { close(): void }) {
  let conexion: ReturnType<typeof abrirSqlAdministrativoNode>;
  try {
    conexion = abrirSqlAdministrativoNode(opciones.archivo);
  } catch (error) {
    almacen.close();
    throw error;
  }
  const { sql, close } = conexion;
  const cerrarAmbos = () => {
    try {
      close();
    } finally {
      almacen.close();
    }
  };
  try {
    // Lo que se borra (la huella de un código al usarse, las que quedan al cerrar) se sobrescribe con ceros en el
    // archivo, en lugar de quedar en las páginas libres hasta que SQLite las reutilice.
    sql.ejecutar('PRAGMA secure_delete=ON');
  } catch (error) {
    cerrarAmbos();
    throw error;
  }
  return { encuesta: new AlmacenSesionEncuestaPanelSqlite(sql, { ahora: opciones.ahora ?? Date.now }), cerrarAmbos };
}
function backendDelPanel(opciones: OpcionesAlmacenPublicoNode, montaje: Montaje) {
  let activo: Backend | null = null;
  let enCurso: Promise<Backend> | null = null;
  let cerrado = false;
  const abrir = async (): Promise<Backend> => {
    const almacen = crearAlmacenPublicoNode(opciones);
    const { encuesta, cerrarAmbos } = abrirEncuesta(opciones, almacen);
    try {
      const administracion = await montarAdministracion({
        ...montaje,
        almacen,
        encuesta,
        sesion: almacen.sesion,
        secciones: almacen.secciones,
        instituciones: almacen.instituciones,
        accesos: almacen.accesos,
        trabajos: almacen.trabajos,
        almacenActivacion: almacen.activacion,
        ...capacidadVigilante(montaje, almacen),
      });
      if (cerrado) {
        throw new Error('El almacén administrativo está cerrado');
      }
      activo = { almacen, encuesta, administracion, cerrar: cerrarAmbos };
      return activo;
    } catch (error) {
      cerrarAmbos();
      throw error;
    }
  };
  return {
    obtener: (): Promise<Backend> => {
      if (cerrado) {
        return Promise.reject(new Error('El almacén administrativo está cerrado'));
      }
      if (activo) {
        return Promise.resolve(activo);
      }
      enCurso ??= abrir().finally(() => {
        enCurso = null;
      });
      return enCurso;
    },
    cerrar: () => {
      if (!cerrado) {
        cerrado = true;
        activo?.cerrar();
        activo = null;
      }
    },
  };
}
function almacenDiferido(obtener: () => Promise<Backend>): AlmacenAccesoPublico {
  return {
    consumir: async (cuentas) => (await obtener()).almacen.consumir(cuentas),
    revocar: async (jti, caduca) => (await obtener()).almacen.revocar(jti, caduca),
    revocado: async (jti) => (await obtener()).almacen.revocado(jti),
  };
}
/**
 * Deja en el registro por qué el panel no ha podido atender una petición. Una retirada de la persona no es un fallo del
 * panel: no se registra.
 */
function registrarNoDisponible(peticion: Request, error: unknown): void {
  if (!peticion.signal.aborted) {
    registrarErrorOperativo('montaje-conectividad', error);
  }
}
function noDisponible(peticion: Request): Response {
  if (peticion.method === 'HEAD') {
    return new Response(null, { status: ESTADO_HTTP.noDisponible, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json(
    { error: 'no_disponible' },
    { status: ESTADO_HTTP.noDisponible, headers: { 'cache-control': 'no-store' } },
  );
}
/** La llamada de retorno usa su propia identidad OIDC; no hereda la sesión humana del panel. */
function receptorDiferido(
  obtener: () => Promise<Backend>,
  tipo: 'recibirResultado' | 'recibirInicio' | 'recibirActivacion',
) {
  return async (peticion: Request): Promise<Response> => {
    try {
      return await dentroDelPlazo(
        async (senal) => {
          const backend = await obtener();
          senal.throwIfAborted();
          return backend.administracion[tipo]?.(new Request(peticion, { signal: senal })) ?? noDisponible(peticion);
        },
        PLAZO_PANEL_MS,
        peticion.signal,
      );
    } catch (error) {
      registrarNoDisponible(peticion, error);
      return noDisponible(peticion);
    }
  };
}
/** Autoriza cada petición antes de abrir el almacén diferido y acota su duración. */
function responderDiferido(montaje: Montaje, obtener: () => Promise<Backend>) {
  return async (peticion: Request): Promise<Response> => {
    try {
      return await dentroDelPlazo(
        async (senal) => {
          const acotada = new Request(peticion, { signal: senal });
          if (!(await montaje.guardiaAdministrativa(acotada))) {
            return Response.json(
              { error: 'acceso_denegado' },
              { status: ESTADO_HTTP.prohibido, headers: { 'cache-control': 'no-store' } },
            );
          }
          senal.throwIfAborted();
          const backend = await obtener();
          senal.throwIfAborted();
          return backend.administracion.responder(acotada);
        },
        PLAZO_PANEL_MS,
        peticion.signal,
      );
    } catch (error) {
      registrarNoDisponible(peticion, error);
      return noDisponible(peticion);
    }
  };
}
function vistaAdministrativa(montaje: Montaje, obtener: () => Promise<Backend>): AdministracionMontada {
  return {
    // El punto público de la encuesta no pasa por Access ni por la sesión: solo responde con un código de un solo uso.
    encuesta: { responder: async (respuesta) => (await obtener()).encuesta.responder(respuesta) },
    ...(montaje.actualizacion
      ? {
          recibirResultado: receptorDiferido(obtener, 'recibirResultado'),
          recibirInicio: receptorDiferido(obtener, 'recibirInicio'),
        }
      : {}),
    ...(montaje.activacionHabilitada ? { recibirActivacion: receptorDiferido(obtener, 'recibirActivacion') } : {}),
    capacidadesPanel: {
      controles: true,
      recorrido: false,
      actualizacion: !!montaje.actualizacion,
      vigilante: montaje.errorConfiguracionVigilante === true || montaje.configuracionVigilante?.habilitado === true,
    },
    configuracion: montaje.configuracion,
    registrarAcceso: async (uso) => (await obtener()).administracion.registrarAcceso(uso),
    responderRecurso: crearServidorWebAdministrativo(montaje),
    leerControles: async (senal) => {
      senal.throwIfAborted();
      return (await obtener()).administracion.leerControles(senal);
    },
    leerSecciones: async (senal) => {
      senal.throwIfAborted();
      return (await obtener()).administracion.leerSecciones(senal);
    },
    leerSeccionesConAutoridad: async (senal) => {
      senal.throwIfAborted();
      const backend = await obtener();
      senal.throwIfAborted();
      return backend.almacen.leerSeccionesConAutoridad();
    },
    responder: responderDiferido(montaje, obtener),
    catalogo: async (peticion) => {
      try {
        return await dentroDelPlazo(
          async (senal) => (await obtener()).administracion.catalogo(new Request(peticion, { signal: senal })),
          PLAZO_PANEL_MS,
          peticion.signal,
        );
      } catch (error) {
        registrarNoDisponible(peticion, error);
        return noDisponible(peticion);
      }
    },
  };
}
/** La identidad y la política de acceso se validan antes del getter. El actualizador es una capacidad separada. */
export function prepararPersistenciaAdministrativaNode(opciones: OpcionesAlmacenPublicoNode, montaje: Montaje) {
  const backend = backendDelPanel(opciones, montaje);
  return {
    socios: {
      almacen: almacenDiferido(backend.obtener),
      instituciones: {
        buscarInstitucion: async (id) => (await backend.obtener()).almacen.instituciones.buscarInstitucion(id),
        consultarInvitacion: async (recibida) =>
          (await backend.obtener()).almacen.instituciones.consultarInvitacion(recibida),
        activarInvitacion: async (recibida, clave) =>
          (await backend.obtener()).almacen.instituciones.activarInvitacion(recibida, clave),
      },
      accesos: { registrarAcceso: async (uso) => (await backend.obtener()).almacen.accesos.registrarAcceso(uso) },
    } satisfies OpcionesDeSocios,
    administracion: vistaAdministrativa(montaje, backend.obtener),
    cerrar: backend.cerrar,
  };
}
