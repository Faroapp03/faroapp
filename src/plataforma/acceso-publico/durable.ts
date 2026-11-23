/** Enlace privado del entorno de Cloudflare: nunca se enruta desde la web ni ofrece un acceso administrativo público. */
import {
  type AlmacenAccesos,
  leerPaginaAccesos,
  leerResultadoAccesosSesion,
  leerUsoConectividad,
  type ResultadoAccesosSesion,
  type UsoConectividad,
} from '../../administracion/accesos.ts';
import {
  type AlmacenRecuperacionActivacion,
  type EstadoActivacionPrivado,
  leerEstadoActivacionPrivado,
} from '../../administracion/activacion.ts';
import type { CatalogoPrivado } from '../../administracion/catalogo-privado.js';
import { type CierreSinRecibo, leerCierreSinRecibo } from '../../administracion/cierre-sin-recibo.ts';
import {
  type AlmacenControles,
  type DocumentoControles,
  esRevisionControles,
  leerDocumentoControles,
  leerPoliticaControles,
  type PoliticaControles,
  type ResultadoCambioControles,
} from '../../administracion/controles.ts';
import {
  leerCatalogoDeRecibo,
  leerDatosDeRecibo,
  leerObservacionDatosTrabajo,
  type ObservacionDatosTrabajo,
} from '../../administracion/datos-trabajo.ts';
import type { ResultadoDespacho } from '../../administracion/ejecutor-github.ts';
import {
  ConfiguracionVigilanteInvalida,
  ConflictoVigilante,
  VigilanteNoDisponible,
} from '../../administracion/errores-vigilante.ts';
import type { EstadoDatosPanel } from '../../administracion/estado-datos.js';
import type { FalloProgramado } from '../../administracion/fallo-programado.ts';
import {
  type AlmacenInstituciones,
  ID_INSTITUCION,
  type IdentidadInvitacion,
  type InvitacionLeida,
  LIMITES_CONECTIVIDAD,
  leerIdentidadInvitacion,
  leerInvitacionActivada,
  leerInvitacionConsultada,
  leerResultadoCambioInstitucionesSesion,
  leerResultadoRegistroSesion,
  leerSolicitudInstitucion,
  leerSolicitudInvitar,
  leerSolicitudRetirarClave,
  type ResultadoActivarInvitacion,
  type ResultadoCambioInstitucionesSesion,
  type ResultadoRegistroSesion,
  type SolicitudInstitucion,
  type SolicitudInvitar,
  type SolicitudRetirarClave,
} from '../../administracion/instituciones.ts';
import {
  type ConfianzaOidcGitHub,
  type IdentidadEjecucionGitHub,
  leerConfianzaOidcGitHub,
} from '../../administracion/oidc-github.ts';
import type {
  AlmacenTrabajosProgramados,
  SolicitudTrabajoProgramado,
} from '../../administracion/programacion-trabajos.ts';
import {
  type AlmacenSeccionesPanel,
  leerResultadoCambioSeccionesSesion,
  leerResultadoLecturaSeccionesSesion,
  type ResultadoCambioSeccionesSesion,
  type ResultadoLecturaSeccionesSesion,
} from '../../administracion/secciones-almacen.ts';
import {
  type DocumentoSecciones,
  leerDocumentoSecciones,
  leerPoliticaSecciones,
  type PoliticaSecciones,
} from '../../administracion/secciones-web.js';
import {
  type AccesoSesionPanel,
  type AlmacenPreparacionPanel,
  type EstadoSesionPanel,
  leerAccesoSesionPanel,
  leerEstadoSesionPanel,
  leerResultadoCambioControlesSesion,
  leerResultadoLecturaControlesSesion,
  type ResultadoCambioControlesSesion,
  type ResultadoLecturaControlesSesion,
} from '../../administracion/sesion.ts';
import {
  type AlmacenTrabajosActualizacion,
  type EstadoTrabajosPrivado,
  type EvidenciaEjecucionCompletada,
  exigirTrabajo,
  type InicioTrabajo,
  leerEstadoTrabajosPrivado,
  leerEvidenciaEjecucionCompletada,
  leerInicioTrabajo,
  leerReciboTrabajo,
  leerReferenciaTrabajo,
  leerResultadoLecturaTrabajo,
  leerRetiradaTrabajo,
  leerSolicitudTrabajo,
  type ReciboTrabajo,
  type ReferenciaTrabajo,
  type ResultadoLecturaTrabajo,
  type ResultadoReservaTrabajo,
  type ResultadoRetiradaTrabajo,
  type ResultadoTransicionTrabajo,
  type RetiradaTrabajo,
  type SolicitudTrabajo,
} from '../../administracion/trabajos.ts';
import type { AlmacenAccesoPublico, CuentaDeAcceso } from '../../api/socios/almacen-publico.ts';
import type { Socio } from '../../api/socios/registro.ts';
import { RevocacionesLlenas } from '../../api/socios/revocaciones.ts';
import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { esRutaAccesosDurable, MAX_RESPUESTA_ACCESOS, operarAccesosDurable } from './accesos-durable.ts';
import {
  type ArgumentosCierre,
  type ArgumentosPaso,
  type ArgumentosRecuperacion,
  type ArgumentosReserva,
  cerrarSolicitadaEnDurable,
  recuperarActivacionEnDurable,
  registrarPasoEnDurable,
  reservarActivacionEnDurable,
  type SolicitudCierreActivacion,
  solicitarCierreEnDurable,
} from './activacion-almacen.ts';
import { esRutaActivacionDurable, operarActivacionDurable } from './activacion-durable.ts';
import { esRutaAutoridadPanel, operarAutoridadPanel } from './autoridad-panel-durable.ts';
import { AlmacenSesionAvisosSqlite, responderPanelConSesionDurable } from './avisos-destino-durable.ts';
import { accesosDiferidos, institucionesDiferidas } from './capacidades-diferidas.ts';
import { leerTransicionCierreDurable, RUTA_CIERRE_SIN_RECIBO_DURABLE } from './cierre-sin-recibo-durable.ts';
import { type AlmacenDatosDelPanel, leerDatosDelPanelDurable, RUTA_DATOS_PANEL } from './datos-panel-durable.ts';
import type { ObservacionDelPanel } from './datos-trabajo-sqlite.ts';
import {
  esRutaEjecucion,
  limitesMensajes,
  MAX_PLAZO_MS,
  MAX_RESPUESTA,
  PLAZO_CLIENTE_MS,
  PLAZO_LECTURA_MS,
} from './durable-limites.ts';
import {
  esRutaInstitucionesDurable,
  MAX_RESPUESTA_INSTITUCIONES,
  operarInstitucionesDurable,
} from './instituciones-durable.ts';
import {
  type AlarmasRegistroDurable,
  accesosConAlarma,
  type ProgramadorAlarmaDurable,
  programadorDelObjetoDurable,
} from './mantenimiento-durable.ts';
import { registrarFalloDurable, reservarProgramadaDurable } from './programacion-almacen.ts';
import { responderOperacionPrivada } from './respuesta-durable.ts';
import { operarSesionDurable } from './sesion-durable.ts';
import { esRutaSesionPortal, operarSesionPortal } from './sesion-portal-durable.ts';
import { AlmacenSesionPortalSqlite } from './sesion-portal-sqlite.ts';
import { AlmacenPublicoSqlite, esJtiPublico, type FilaSql, type SqlAccesoPublico, type ValorSql } from './sqlite.ts';
import {
  esRutaTrabajosDurable,
  leerDespachoTrabajoDurable,
  leerHuellaReciboDurable,
  leerIdentidadTrabajoDurable,
  leerReservaDurable,
  leerRetiradaDurable,
  leerTransicionDespachoDurable,
  leerTransicionInicioDurable,
  leerTransicionInicioRechazadoDurable,
  leerTransicionReciboDurable,
  leerTransicionSinReciboDurable,
  operarTrabajosDurable,
} from './trabajos-durable.ts';
import {
  codigoErrorVigilante,
  esRutaVigilanteDurable,
  MAX_RESPUESTA_VIGILANTE,
  operarVigilanteDurable,
} from './vigilante-durable.ts';

const URL_PRIVADA = 'https://registro-socios.invalid';
const NOMBRE = 'registro-publico-v1';
export interface EstadoAccesoPublicoDurable {
  readonly storage: Partial<AlarmasRegistroDurable> & {
    readonly sql: { exec(sql: string, ...valores: ValorSql[]): { toArray(): FilaSql[] } };
    transactionSync<T>(accion: () => T): T;
  };
}
export interface EspacioAccesoPublicoDurable {
  idFromName(nombre: string): unknown;
  get(id: unknown): { fetch(peticion: Request): Promise<Response> };
}
export class AlmacenPublicoNoDisponible extends Error {
  override readonly name = 'AlmacenPublicoNoDisponible';
}

function objeto(valor: unknown, campos: string): valor is Record<string, unknown> {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    !Array.isArray(valor) &&
    Object.keys(valor).sort().join(',') === campos
  );
}
function esRevocacion(cuerpo: unknown): cuerpo is { jti: string; caducaS: number } {
  return objeto(cuerpo, 'caducaS,jti') && esJtiPublico(cuerpo.jti) && typeof cuerpo.caducaS === 'number';
}
/** Solo captura el rechazo del contrato de entrada; los fallos del almacén se propagan aparte. */
function politicaValida(entrada: unknown): PoliticaControles | undefined {
  try {
    return leerPoliticaControles(entrada);
  } catch {
    return undefined;
  }
}
/** Límite aplicado durante la lectura; cancelar por plazo también corta un flujo que no termina. */
async function jsonLimitado(mensaje: Request | Response, maximo: number, senal: AbortSignal): Promise<unknown> {
  const lector = mensaje.body?.getReader();
  if (!lector) {
    throw new Error('Mensaje privado vacío');
  }
  const cancelar = (): void => {
    void lector.cancel().catch(() => undefined);
  };
  senal.addEventListener('abort', cancelar, { once: true });
  let total = 0;
  let texto = '';
  const decodificador = new TextDecoder('utf-8', { fatal: true });
  try {
    senal.throwIfAborted();
    for (;;) {
      const { done, value } = await lector.read();
      senal.throwIfAborted();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maximo) {
        cancelar();
        throw new Error('Mensaje privado demasiado grande');
      }
      texto += decodificador.decode(value, { stream: true });
    }
    texto += decodificador.decode();
    return JSON.parse(texto) as unknown;
  } finally {
    senal.removeEventListener('abort', cancelar);
    lector.releaseLock();
  }
}
async function conPlazo<T>(ms: number, accion: (senal: AbortSignal) => Promise<T>): Promise<T> {
  const control = new AbortController();
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vencimiento = new Promise<never>((_resolver, rechazar) => {
    reloj = setTimeout(() => {
      control.abort();
      rechazar(new AlmacenPublicoNoDisponible('Almacén público no disponible'));
    }, ms);
  });
  try {
    return await Promise.race([accion(control.signal), vencimiento]);
  } finally {
    clearTimeout(reloj);
  }
}
function responder(valor: unknown, status: number = ESTADO_HTTP.correcto): Response {
  return new Response(JSON.stringify(valor), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
/** El SQL del registro sobre el almacenamiento del objeto durable: el mismo para todas sus partes. */
export function sqlDelObjetoDurable(storage: EstadoAccesoPublicoDurable['storage']): SqlAccesoPublico {
  return {
    filas: (sentencia, ...valores) => storage.sql.exec(sentencia, ...valores).toArray(),
    ejecutar: (sentencia, ...valores) => void storage.sql.exec(sentencia, ...valores).toArray(),
    transaccion: (accion) => storage.transactionSync(accion),
  };
}
/** SQLite DO real en producción; el ensayo local sustituye exclusivamente el motor SQL, sin simular su despliegue. */
export class AccesoPublicoDurable {
  private readonly almacen: AlmacenPublicoSqlite;
  private readonly sesion: AlmacenSesionAvisosSqlite;
  private readonly sesionPortal: AlmacenSesionPortalSqlite;
  private readonly variablesVigilante: VariablesDelEntorno;
  private readonly mantenimiento: ProgramadorAlarmaDurable;
  private readonly instituciones: AlmacenInstituciones;
  private readonly accesos: AlmacenAccesos;
  constructor(estado: EstadoAccesoPublicoDurable, _entorno: VariablesDelEntorno) {
    const sql = sqlDelObjetoDurable(estado.storage);
    this.variablesVigilante = _entorno;
    this.almacen = new AlmacenPublicoSqlite(sql, {
      maxClientes: LIMITES_CONECTIVIDAD.instituciones,
    });
    this.sesion = new AlmacenSesionAvisosSqlite(sql, {
      cubrir: (fecha, escribir) => this.mantenimiento.cubrir(fecha, escribir),
    });
    this.sesionPortal = new AlmacenSesionPortalSqlite(sql);
    this.mantenimiento = programadorDelObjetoDurable(estado.storage, sql, this.sesion, this.sesionPortal);
    this.instituciones = institucionesDiferidas(this.sesion);
    this.accesos = accesosDiferidos(accesosConAlarma(this.sesion, this.mantenimiento), () =>
      this.instituciones.prepararInstituciones(),
    );
  }
  async alarm(): Promise<void> {
    await this.mantenimiento.alarm();
  }
  async fetch(peticion: Request): Promise<Response> {
    const url = new URL(peticion.url);
    if (url.origin !== URL_PRIVADA || url.href !== `${URL_PRIVADA}${url.pathname}` || peticion.method !== 'POST') {
      return responder({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
    }
    let cuerpo: unknown;
    try {
      cuerpo = await conPlazo(PLAZO_LECTURA_MS, (senal) =>
        jsonLimitado(peticion, limitesMensajes(url.pathname).entrada, senal),
      );
    } catch {
      return responder({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
    }
    try {
      const respuesta = await this.operar(url.pathname, cuerpo);
      if (respuesta.ok) {
        // Adelanta, nunca retrasa, la alarma por filas anteriores; si faltan alarmas, se repite en la petición siguiente.
        await this.mantenimiento.arranque().catch(() => undefined);
      }
      return respuesta;
    } catch (error) {
      const errorVigilante = codigoErrorVigilante(url.pathname, error);
      if (errorVigilante) {
        return responder({ error: errorVigilante });
      }
      return responder(
        { error: error instanceof RevocacionesLlenas ? 'revocaciones_llenas' : 'almacen_no_disponible' },
        ESTADO_HTTP.noDisponible,
      );
    }
  }
  private async operar(ruta: string, cuerpo: unknown): Promise<Response> {
    if (esRutaVigilanteDurable(ruta)) {
      return responderOperacionPrivada(
        await operarVigilanteDurable(this.sesion, {
          variables: this.variablesVigilante,
          ruta,
          cuerpo,
        }),
        MAX_RESPUESTA_VIGILANTE,
      );
    }
    if (esRutaSesionPortal(ruta)) {
      return responderOperacionPrivada(
        await operarSesionPortal(this.sesionPortal, ruta, cuerpo, this.mantenimiento.cubrir),
        MAX_RESPUESTA,
      );
    }
    if (esRutaAccesosDurable(ruta)) {
      return responderOperacionPrivada(await operarAccesosDurable(this.accesos, ruta, cuerpo), MAX_RESPUESTA_ACCESOS);
    }
    if (esRutaInstitucionesDurable(ruta)) {
      return responderOperacionPrivada(
        await operarInstitucionesDurable(this.instituciones, ruta, cuerpo),
        MAX_RESPUESTA_INSTITUCIONES,
      );
    }
    if (esRutaAutoridadPanel(ruta)) {
      return responderOperacionPrivada(await operarAutoridadPanel(this.sesion, ruta, cuerpo), MAX_RESPUESTA);
    }
    return (
      (await responderPanelConSesionDurable(this.sesion, ruta, cuerpo, this.variablesVigilante)) ??
      this.operarPublico(ruta, cuerpo)
    );
  }
  private async operarPublico(ruta: string, cuerpo: unknown): Promise<Response> {
    switch (ruta) {
      case '/consumir':
        if (objeto(cuerpo, 'cuentas') && Array.isArray(cuerpo.cuentas)) {
          return responder({ permitido: await this.almacen.consumir(cuerpo.cuentas as CuentaDeAcceso[]) });
        }
        break;
      default:
        return this.administrar(ruta, cuerpo);
    }
    return responder({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
  }
  private async administrar(ruta: string, cuerpo: unknown): Promise<Response> {
    switch (ruta) {
      case '/revocar':
        if (esRevocacion(cuerpo)) {
          await this.almacen.revocar(cuerpo.jti, cuerpo.caducaS);
          return responder({ correcto: true });
        }
        break;
      case '/revocado':
        if (objeto(cuerpo, 'jti') && esJtiPublico(cuerpo.jti)) {
          return responder({ revocado: await this.almacen.revocado(cuerpo.jti) });
        }
        break;
      default:
        return this.controlar(ruta, cuerpo);
    }
    return responder({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
  }
  /** Protocolo privado del enlace del entorno; la autorización HTTP pertenece al adaptador administrativo. */
  private async controlar(ruta: string, cuerpo: unknown): Promise<Response> {
    if (esRutaEjecucion(ruta)) {
      return this.trabajar(ruta, cuerpo);
    }
    if (ruta === '/controles/leer' && objeto(cuerpo, '')) {
      return responder({ controles: await this.almacen.leerControles() });
    }
    if (ruta === '/controles/activar' && objeto(cuerpo, 'politica')) {
      const politica = politicaValida(cuerpo.politica);
      if (politica) {
        return responder({ controles: await this.almacen.activarControles(politica) });
      }
    }
    if (
      ruta === '/controles/cambiar' &&
      objeto(cuerpo, 'politica,revisionEsperada') &&
      esRevisionControles(cuerpo.revisionEsperada)
    ) {
      const politica = politicaValida(cuerpo.politica);
      if (politica) {
        return responder(await this.almacen.cambiarControles(cuerpo.revisionEsperada, politica));
      }
    }
    const resultado = await operarSesionDurable(this.sesion, ruta, cuerpo);
    if (resultado !== undefined) {
      return responder(resultado);
    }
    return responder({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
  }
  private async trabajar(ruta: string, cuerpo: unknown): Promise<Response> {
    const resultado = esRutaActivacionDurable(ruta)
      ? await operarActivacionDurable(this.sesion, ruta, cuerpo)
      : await operarTrabajosDurable(this.sesion, ruta, cuerpo);
    return responderOperacionPrivada(resultado, limitesMensajes(ruta).salida);
  }
}

/** Cada operación obtiene un representante del objeto para su petición. Fallos, respuestas defectuosas y plazos rechazan sin alternativa. */
export class AlmacenPublicoDurable
  implements
    AlmacenAccesoPublico,
    AlmacenAccesos,
    AlmacenInstituciones,
    AlmacenControles,
    AlmacenPreparacionPanel,
    AlmacenSeccionesPanel,
    AlmacenTrabajosActualizacion,
    AlmacenDatosDelPanel,
    AlmacenRecuperacionActivacion,
    AlmacenTrabajosProgramados
{
  private readonly espacio: EspacioAccesoPublicoDurable;
  private readonly tiempoLimiteMs: number;
  constructor(espacio: EspacioAccesoPublicoDurable, opciones: { tiempoLimiteMs?: number } = {}) {
    this.espacio = espacio;
    this.tiempoLimiteMs = opciones.tiempoLimiteMs ?? PLAZO_CLIENTE_MS;
    if (!Number.isSafeInteger(this.tiempoLimiteMs) || this.tiempoLimiteMs < 1 || this.tiempoLimiteMs > MAX_PLAZO_MS) {
      throw new Error('Plazo del almacén público no válido');
    }
  }
  protected async enviar<T>(ruta: string, cuerpo: unknown, leer: (valor: unknown) => T | undefined): Promise<T> {
    try {
      const activacion = esRutaActivacionDurable(ruta);
      const trabajo = esRutaTrabajosDurable(ruta);
      const texto = JSON.stringify(cuerpo);
      if (trabajo || activacion || esRutaInstitucionesDurable(ruta) || esRutaAccesosDurable(ruta)) {
        exigirTrabajo(new TextEncoder().encode(texto).byteLength <= limitesMensajes(ruta).entrada);
      }
      return await conPlazo(this.tiempoLimiteMs, async (signal) => {
        const remoto = this.espacio.get(this.espacio.idFromName(NOMBRE));
        const respuesta = await remoto.fetch(
          new Request(`${URL_PRIVADA}${ruta}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: texto,
            signal,
          }),
        );
        const valor = await jsonLimitado(respuesta, limitesMensajes(ruta).salida, signal);
        if (
          respuesta.status === ESTADO_HTTP.noDisponible &&
          objeto(valor, 'error') &&
          valor.error === 'revocaciones_llenas'
        ) {
          throw new RevocacionesLlenas('No caben más revocaciones');
        }
        if (respuesta.status !== ESTADO_HTTP.correcto) {
          throw new AlmacenPublicoNoDisponible('Almacén público no disponible');
        }
        const leido = leer(valor);
        if (leido === undefined) {
          throw new AlmacenPublicoNoDisponible('Respuesta del almacén público no válida');
        }
        return leido;
      });
    } catch (error) {
      if (
        error instanceof RevocacionesLlenas ||
        error instanceof AlmacenPublicoNoDisponible ||
        error instanceof ConflictoVigilante ||
        error instanceof ConfiguracionVigilanteInvalida ||
        error instanceof VigilanteNoDisponible
      ) {
        throw error;
      }
      throw new AlmacenPublicoNoDisponible('Almacén público no disponible');
    }
  }
  async prepararAccesos(): Promise<void> {
    await this.escribir('/accesos/preparar', {});
  }
  async registrarAcceso(entrada: UsoConectividad): Promise<void> {
    await this.escribir('/accesos/registrar', { uso: leerUsoConectividad(entrada) });
  }
  async depurarAccesos(): Promise<void> {
    await this.escribir('/accesos/depurar', {});
  }
  async leerAccesosDeSesion(acceso: AccesoSesionPanel, entradaPagina: number): Promise<ResultadoAccesosSesion> {
    const pagina = leerPaginaAccesos({ pagina: entradaPagina });
    return this.enviar('/accesos/leer', { acceso: leerAccesoSesionPanel(acceso), pagina }, (valor) => {
      const resultado = leerResultadoAccesosSesion(valor);
      return resultado.estado !== 'activa' || resultado.accesos.pagina === pagina ? resultado : undefined;
    });
  }
  async prepararInstituciones(): Promise<void> {
    await this.escribir('/instituciones/preparar', {});
  }
  async leerInstitucionesDeSesion(entrada: AccesoSesionPanel): Promise<ResultadoRegistroSesion> {
    return this.enviar('/instituciones/leer', { acceso: leerAccesoSesionPanel(entrada) }, leerResultadoRegistroSesion);
  }
  private async cambiarInstitucion(
    ruta: string,
    cuerpo: {
      readonly acceso: AccesoSesionPanel;
      readonly solicitud: SolicitudInstitucion | SolicitudInvitar;
      readonly nueva?: IdentidadInvitacion | (IdentidadInvitacion & { readonly institucionId: string });
    },
  ): Promise<ResultadoCambioInstitucionesSesion> {
    return this.enviar(ruta, cuerpo, (valor) => {
      const resultado = leerResultadoCambioInstitucionesSesion(valor);
      if (
        'registro' in resultado &&
        ((resultado.estado === 'cambiado' && resultado.registro.revision !== cuerpo.solicitud.revisionEsperada + 1) ||
          (resultado.estado === 'conflicto' && resultado.registro.revision === cuerpo.solicitud.revisionEsperada))
      ) {
        return undefined;
      }
      return resultado;
    });
  }
  async invitarInstitucionDeSesion(
    entrada: AccesoSesionPanel,
    solicitud: SolicitudInvitar,
    nueva: IdentidadInvitacion & { readonly institucionId: string },
  ): Promise<ResultadoCambioInstitucionesSesion> {
    if (!ID_INSTITUCION.test(nueva.institucionId)) {
      throw new Error('Identidad institucional no válida');
    }
    return this.cambiarInstitucion('/instituciones/invitar', {
      acceso: leerAccesoSesionPanel(entrada),
      solicitud: leerSolicitudInvitar(solicitud),
      nueva: { ...leerIdentidadInvitacion({ id: nueva.id, huella: nueva.huella }), institucionId: nueva.institucionId },
    });
  }
  async renovarInvitacionDeSesion(
    entrada: AccesoSesionPanel,
    solicitud: SolicitudInstitucion,
    nueva: IdentidadInvitacion,
  ): Promise<ResultadoCambioInstitucionesSesion> {
    return this.cambiarInstitucion('/instituciones/renovar', {
      acceso: leerAccesoSesionPanel(entrada),
      solicitud: leerSolicitudInstitucion(solicitud),
      nueva: leerIdentidadInvitacion(nueva),
    });
  }
  async retirarInstitucionDeSesion(
    entrada: AccesoSesionPanel,
    solicitud: SolicitudInstitucion,
  ): Promise<ResultadoCambioInstitucionesSesion> {
    return this.cambiarInstitucion('/instituciones/retirar', {
      acceso: leerAccesoSesionPanel(entrada),
      solicitud: leerSolicitudInstitucion(solicitud),
    });
  }
  async retirarClaveDeSesion(
    entrada: AccesoSesionPanel,
    solicitud: SolicitudRetirarClave,
  ): Promise<ResultadoCambioInstitucionesSesion> {
    return this.cambiarInstitucion('/instituciones/retirar-clave', {
      acceso: leerAccesoSesionPanel(entrada),
      solicitud: leerSolicitudRetirarClave(solicitud),
    });
  }
  async consultarInvitacion(recibida: IdentidadInvitacion): Promise<InvitacionLeida | null | 'apagada'> {
    return this.enviar(
      '/instituciones/consultar',
      { recibida: leerIdentidadInvitacion(recibida) },
      leerInvitacionConsultada,
    );
  }
  async activarInvitacion(
    recibida: IdentidadInvitacion,
    clave: IdentidadInvitacion,
  ): Promise<ResultadoActivarInvitacion> {
    return this.enviar(
      '/instituciones/activar',
      { recibida: leerIdentidadInvitacion(recibida), clave: leerIdentidadInvitacion(clave) },
      leerInvitacionActivada,
    );
  }
  async buscarInstitucion(id: string): Promise<Socio | null> {
    if (!ID_INSTITUCION.test(id)) {
      return null;
    }
    return this.enviar('/instituciones/buscar', { id }, (valor) => {
      if (!objeto(valor, 'socio')) {
        return undefined;
      }
      if (valor.socio === null) {
        return null;
      }
      const s = valor.socio;
      if (
        !objeto(s, 'consultasPorHora,huellas,id') ||
        s.id !== id ||
        s.consultasPorHora !== LIMITES_CONECTIVIDAD.consultasPorInstitucionHora ||
        !Array.isArray(s.huellas) ||
        s.huellas.length === 0 ||
        s.huellas.length > LIMITES_CONECTIVIDAD.clavesActivasPorInstitucion ||
        !s.huellas.every((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) ||
        new Set(s.huellas).size !== s.huellas.length
      ) {
        return undefined;
      }
      return { id, huellas: [...s.huellas], consultasPorHora: s.consultasPorHora };
    });
  }
  async leerControles(): Promise<DocumentoControles | null> {
    return this.enviar('/controles/leer', {}, (v) => {
      if (!objeto(v, 'controles')) {
        return undefined;
      }
      return v.controles === null ? null : leerDocumentoControles(v.controles);
    });
  }
  async leerSecciones(): Promise<DocumentoSecciones | null> {
    return this.enviar('/secciones/leer', {}, (valor) => {
      if (!objeto(valor, 'secciones')) {
        return undefined;
      }
      return valor.secciones === null ? null : leerDocumentoSecciones(valor.secciones);
    });
  }
  async leerSeccionesDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaSeccionesSesion> {
    return this.enviar(
      '/secciones/leer-sesion',
      { acceso: leerAccesoSesionPanel(acceso) },
      leerResultadoLecturaSeccionesSesion,
    );
  }
  async cambiarSeccionesDeSesion(
    entrada: AccesoSesionPanel,
    revisionEsperada: number,
    nueva: PoliticaSecciones,
  ): Promise<ResultadoCambioSeccionesSesion> {
    const acceso = leerAccesoSesionPanel(entrada);
    if (!esRevisionControles(revisionEsperada)) {
      throw new Error('Revisión de secciones no válida');
    }
    const secciones = leerPoliticaSecciones(nueva);
    return this.enviar('/secciones/cambiar-sesion', { acceso, revisionEsperada, secciones }, (valor) => {
      const resultado = leerResultadoCambioSeccionesSesion(valor);
      if (
        resultado.estado === 'cambiado' &&
        (resultado.secciones.revision !== revisionEsperada + 1 ||
          JSON.stringify(resultado.secciones.secciones) !== JSON.stringify(secciones))
      ) {
        return undefined;
      }
      if (resultado.estado === 'conflicto' && resultado.secciones.revision === revisionEsperada) {
        return undefined;
      }
      return resultado;
    });
  }
  async activarControles(inicial: PoliticaControles): Promise<DocumentoControles> {
    const politica = leerPoliticaControles(inicial);
    return this.enviar('/controles/activar', { politica }, (v) => {
      if (!objeto(v, 'controles')) {
        return undefined;
      }
      const controles = leerDocumentoControles(v.controles);
      return controles.revision === 0 ? controles : undefined;
    });
  }
  async cambiarControles(revisionEsperada: number, entrada: PoliticaControles): Promise<ResultadoCambioControles> {
    if (!esRevisionControles(revisionEsperada) || revisionEsperada === Number.MAX_SAFE_INTEGER) {
      throw new Error('Revisión de controles no válida');
    }
    const politica = leerPoliticaControles(entrada);
    return this.enviar('/controles/cambiar', { revisionEsperada, politica }, (v) => {
      if (!objeto(v, 'controles,estado') || (v.estado !== 'cambiado' && v.estado !== 'conflicto')) {
        return undefined;
      }
      const controles = leerDocumentoControles(v.controles);
      const revisionValida =
        v.estado === 'cambiado' ? controles.revision === revisionEsperada + 1 : controles.revision !== revisionEsperada;
      return revisionValida ? { estado: v.estado, controles } : undefined;
    });
  }
  async activarSesionPanel(): Promise<void> {
    await this.escribir('/panel/activar', {});
  }
  async prepararPanel(inicial: PoliticaControles): Promise<DocumentoControles> {
    const politica = leerPoliticaControles(inicial);
    return this.enviar('/panel/preparar', { politica }, (valor) =>
      objeto(valor, 'controles') ? leerDocumentoControles(valor.controles) : undefined,
    );
  }
  async comprobarSesion(entrada: AccesoSesionPanel): Promise<EstadoSesionPanel> {
    return this.enviar('/panel/estado', { acceso: leerAccesoSesionPanel(entrada) }, leerEstadoSesionPanel);
  }
  async mantenerSesion(entrada: AccesoSesionPanel): Promise<EstadoSesionPanel> {
    return this.enviar('/panel/actividad', { acceso: leerAccesoSesionPanel(entrada) }, leerEstadoSesionPanel);
  }
  async cerrarSesion(entrada: AccesoSesionPanel): Promise<EstadoSesionPanel> {
    return this.enviar('/panel/cerrar', { acceso: leerAccesoSesionPanel(entrada) }, (valor) => {
      const sesion = leerEstadoSesionPanel(valor);
      return sesion.estado === 'activa' ? undefined : sesion;
    });
  }
  async leerControlesDeSesion(entrada: AccesoSesionPanel): Promise<ResultadoLecturaControlesSesion> {
    return this.enviar('/panel/leer', { acceso: leerAccesoSesionPanel(entrada) }, leerResultadoLecturaControlesSesion);
  }
  async cambiarControlesDeSesion(
    entrada: AccesoSesionPanel,
    revisionEsperada: number,
    nueva: PoliticaControles,
  ): Promise<ResultadoCambioControlesSesion> {
    const acceso = leerAccesoSesionPanel(entrada);
    if (!esRevisionControles(revisionEsperada) || revisionEsperada === Number.MAX_SAFE_INTEGER) {
      throw new Error('Revisión de controles no válida');
    }
    const politica = leerPoliticaControles(nueva);
    return this.enviar('/panel/cambiar', { acceso, revisionEsperada, politica }, (valor) => {
      const resultado = leerResultadoCambioControlesSesion(valor);
      if (resultado.estado === 'cambiado' && resultado.controles.revision !== revisionEsperada + 1) {
        return undefined;
      }
      if (resultado.estado === 'conflicto' && resultado.controles.revision === revisionEsperada) {
        return undefined;
      }
      return resultado;
    });
  }
  async consumir(cuentas: readonly CuentaDeAcceso[]): Promise<boolean> {
    return this.enviar('/consumir', { cuentas }, (v) =>
      objeto(v, 'permitido') && typeof v.permitido === 'boolean' ? v.permitido : undefined,
    );
  }
  async prepararTrabajos(): Promise<void> {
    await this.enviar('/trabajos/preparar', {}, (v) =>
      objeto(v, 'correcto') && v.correcto === true ? true : undefined,
    );
  }
  async reservarTrabajoProgramado(entrada: SolicitudTrabajoProgramado, confianza: ConfianzaOidcGitHub) {
    return reservarProgramadaDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), entrada, confianza);
  }
  async registrarFalloProgramado(fallo: FalloProgramado) {
    return registrarFalloDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), fallo);
  }
  async prepararActivacion(): Promise<void> {
    await this.escribir('/activacion/preparar', {});
  }
  async leerActivacionPrivada(): Promise<EstadoActivacionPrivado> {
    return this.enviar('/activacion/leer', {}, leerEstadoActivacionPrivado);
  }
  async reservarActivacion(...argumentos: ArgumentosReserva) {
    return reservarActivacionEnDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), ...argumentos);
  }
  async recuperarActivacion(...argumentos: ArgumentosRecuperacion) {
    return recuperarActivacionEnDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), ...argumentos);
  }
  async registrarPasoRecuperacionActivacion(...argumentos: ArgumentosPaso) {
    return registrarPasoEnDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), true, ...argumentos);
  }
  async solicitarCierreActivacion(solicitud: SolicitudCierreActivacion) {
    return solicitarCierreEnDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), solicitud);
  }
  async cerrarActivacionSolicitada(...argumentos: ArgumentosCierre) {
    return cerrarSolicitadaEnDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), ...argumentos);
  }
  async registrarPasoActivacion(...argumentos: ArgumentosPaso) {
    return registrarPasoEnDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), false, ...argumentos);
  }
  async leerTrabajoDeSesion(entrada: AccesoSesionPanel): Promise<ResultadoLecturaTrabajo> {
    return this.enviar('/trabajos/leer', { acceso: leerAccesoSesionPanel(entrada) }, leerResultadoLecturaTrabajo);
  }
  async leerTrabajoPrivado(): Promise<EstadoTrabajosPrivado> {
    return this.enviar('/trabajos/privado', {}, leerEstadoTrabajosPrivado);
  }
  async leerDatosDelUltimoTrabajo(): Promise<ObservacionDatosTrabajo | null> {
    return this.enviar('/trabajos/datos', {}, (valor) => (valor === null ? null : leerObservacionDatosTrabajo(valor)));
  }
  async leerDatosDelPanel(): Promise<ObservacionDelPanel | null> {
    return this.enviar(RUTA_DATOS_PANEL, {}, leerDatosDelPanelDurable);
  }
  async reservarTrabajoDeSesion(
    entrada: AccesoSesionPanel,
    entradaSolicitud: SolicitudTrabajo,
    entradaConfianza: ConfianzaOidcGitHub,
  ): Promise<ResultadoReservaTrabajo> {
    const acceso = leerAccesoSesionPanel(entrada);
    const solicitud = leerSolicitudTrabajo(entradaSolicitud);
    const confianza = leerConfianzaOidcGitHub(entradaConfianza);
    return this.enviar('/trabajos/reservar', { acceso, solicitud, confianza }, (v) => leerReservaDurable(v, solicitud));
  }
  async anotarDespacho(
    entrada: ReferenciaTrabajo,
    entradaResultado: ResultadoDespacho,
  ): Promise<ResultadoTransicionTrabajo> {
    const referencia = leerReferenciaTrabajo(entrada);
    const resultado = leerDespachoTrabajoDurable(entradaResultado);
    return this.enviar('/trabajos/despacho', { referencia, resultado }, (v) =>
      leerTransicionDespachoDurable(v, referencia, resultado),
    );
  }
  // biome-ignore lint/complexity/useMaxParams: Extensión opcional del contrato existente, conserva sus llamadores.
  async registrarRecibo(
    entrada: ReciboTrabajo,
    entradaHuella: string,
    entradaIdentidad: IdentidadEjecucionGitHub,
    entradaEstado?: EstadoDatosPanel | null,
    entradaCatalogo?: CatalogoPrivado | null,
  ): Promise<ResultadoTransicionTrabajo> {
    const recibo = leerReciboTrabajo(entrada);
    const huellaRecibo = leerHuellaReciboDurable(entradaHuella);
    const identidad = leerIdentidadTrabajoDurable(entradaIdentidad);
    const estado = entradaEstado === undefined ? undefined : leerDatosDeRecibo(recibo, entradaEstado);
    const cuerpo =
      estado === undefined ? { recibo, huellaRecibo, identidad } : { recibo, huellaRecibo, identidad, estado };
    const catalogo = entradaCatalogo === undefined ? undefined : leerCatalogoDeRecibo(recibo, entradaCatalogo);
    exigirTrabajo(catalogo == null || estado != null);
    return this.enviar('/trabajos/recibo', catalogo === undefined ? cuerpo : { ...cuerpo, catalogo }, (v) =>
      leerTransicionReciboDurable(v, recibo, identidad),
    );
  }
  async confirmarInicio(
    entradaInicio: InicioTrabajo,
    entradaIdentidad: IdentidadEjecucionGitHub,
  ): Promise<ResultadoTransicionTrabajo> {
    const inicio = leerInicioTrabajo(entradaInicio);
    const identidad = leerIdentidadTrabajoDurable(entradaIdentidad);
    return this.enviar('/trabajos/inicio', { inicio, identidad }, (v) =>
      leerTransicionInicioDurable(v, inicio, identidad),
    );
  }
  async anotarInicioRechazado(
    entradaInicio: InicioTrabajo,
    entradaIdentidad: IdentidadEjecucionGitHub,
  ): Promise<ResultadoTransicionTrabajo> {
    const inicio = leerInicioTrabajo(entradaInicio);
    const identidad = leerIdentidadTrabajoDurable(entradaIdentidad);
    return this.enviar('/trabajos/inicio-rechazado', { inicio, identidad }, (v) =>
      leerTransicionInicioRechazadoDurable(v, inicio),
    );
  }
  async retirarTrabajoDeSesion(
    entrada: AccesoSesionPanel,
    entradaRetirada: RetiradaTrabajo,
  ): Promise<ResultadoRetiradaTrabajo> {
    const acceso = leerAccesoSesionPanel(entrada);
    const retirada = leerRetiradaTrabajo(entradaRetirada);
    return this.enviar('/trabajos/retirar', { acceso, retirada }, (v) => leerRetiradaDurable(v, retirada));
  }
  async finalizarEjecucionSinRecibo(
    entrada: ReferenciaTrabajo,
    entradaEvidencia: EvidenciaEjecucionCompletada,
  ): Promise<ResultadoTransicionTrabajo> {
    const referencia = leerReferenciaTrabajo(entrada);
    const evidencia = leerEvidenciaEjecucionCompletada(entradaEvidencia);
    return this.enviar('/trabajos/sin-recibo', { referencia, evidencia }, (v) =>
      leerTransicionSinReciboDurable(v, referencia, evidencia),
    );
  }
  async cerrarSinRecibo(entrada: CierreSinRecibo, identidad: IdentidadEjecucionGitHub) {
    const cierre = leerCierreSinRecibo(entrada);
    const cuerpo = { cierre, identidad: leerIdentidadTrabajoDurable(identidad) };
    return this.enviar(RUTA_CIERRE_SIN_RECIBO_DURABLE, cuerpo, (v) =>
      leerTransicionCierreDurable(v, cierre, identidad),
    );
  }
  private async escribir(ruta: string, cuerpo: unknown): Promise<void> {
    await this.enviar(ruta, cuerpo, (v) => (objeto(v, 'correcto') && v.correcto === true ? true : undefined));
  }
  async revocar(jti: string, caducaS: number): Promise<void> {
    await this.escribir('/revocar', { jti, caducaS });
  }
  async revocado(jti: string): Promise<boolean> {
    return this.enviar('/revocado', { jti }, (v) =>
      objeto(v, 'revocado') && typeof v.revocado === 'boolean' ? v.revocado : undefined,
    );
  }
}
