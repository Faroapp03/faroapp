/** Una autoridad de sesión global, sobre la misma transacción SQL que los controles administrativos. */
import {
  type AlmacenAccesos,
  leerPaginaAccesos,
  leerUsoConectividad,
  type ResultadoAccesosSesion,
  type UsoConectividad,
} from '../../administracion/accesos.ts';
import type { AlmacenRecuperacionActivacion, EstadoActivacionPrivado } from '../../administracion/activacion.ts';
import * as administradores from '../../administracion/administradores.ts';
import type { CatalogoPrivado } from '../../administracion/catalogo-privado.js';
import { type CierreSinRecibo, leerCierreSinRecibo } from '../../administracion/cierre-sin-recibo.ts';
import {
  type DocumentoControles,
  leerPoliticaControles,
  type PoliticaControles,
} from '../../administracion/controles.ts';
import type { ObservacionDatosTrabajo } from '../../administracion/datos-trabajo.ts';
import type { ResultadoDespacho } from '../../administracion/ejecutor-github.ts';
import type { EstadoDatosPanel } from '../../administracion/estado-datos.js';
import type { FalloProgramado } from '../../administracion/fallo-programado.ts';
import {
  type AlmacenInstituciones,
  type IdentidadInvitacion,
  type InvitacionLeida,
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
import type {
  AlmacenSeccionesPanel,
  ResultadoCambioSeccionesSesion,
  ResultadoLecturaSeccionesSesion,
} from '../../administracion/secciones-almacen.ts';
import type { DocumentoSecciones, PoliticaSecciones } from '../../administracion/secciones-web.js';
import {
  type AccesoSesionPanel,
  type AlmacenPreparacionPanel,
  DURACION_MAXIMA_SESION_PANEL_MS,
  type EstadoSesionPanel,
  leerAccesoSesionPanel,
  type ResultadoCambioControlesSesion,
  type ResultadoLecturaControlesSesion,
  type SesionPanelActiva,
  type SesionPanelInactiva,
} from '../../administracion/sesion.ts';
import {
  type BienvenidaPanel,
  crearIdLegible,
  type FilaRegistroPanel,
  type IdentidadPanel,
  leerIdentidadPanel,
  type ResultadoAperturaUnica,
} from '../../administracion/sesion-unica.ts';
import {
  type AlmacenTrabajosActualizacion,
  type EstadoTrabajosPrivado,
  type EvidenciaEjecucionCompletada,
  estadoPublicoTrabajos,
  type InicioTrabajo,
  leerEvidenciaEjecucionCompletada,
  leerInicioTrabajo,
  leerReciboTrabajo,
  leerReferenciaTrabajo,
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
import type { Socio } from '../../api/socios/registro.ts';
import {
  depurarAccesosSqlite,
  leerAccesosSqlite,
  prepararAccesosSqlite,
  registrarAccesoSqlite,
  siguienteVencimientoAccesosSqlite,
} from './accesos-sqlite.ts';
import {
  type ArgumentosCierre,
  type ArgumentosPaso,
  type ArgumentosRecuperacion,
  type ArgumentosReserva,
  cerrarSolicitadaEnSqlite,
  recuperarActivacionEnSqlite,
  registrarPasoEnSqlite,
  reservarActivacionEnSqlite,
  type SolicitudCierreActivacion,
  solicitarCierreEnSqlite,
} from './activacion-almacen.ts';
import { leerActivacionSqlite, prepararActivacionSqlite } from './activacion-sqlite.ts';
import * as lista from './administradores-sqlite.ts';
import { cerrarSinReciboSqlite, finalizarSinReciboSqlite } from './cierre-sin-recibo-sqlite.ts';
import {
  activarControlesSqlite,
  cambiarControlesSqlite,
  cambiarSeccionesSqlite,
  leerControlesSqlite,
  leerSeccionesSqlite,
} from './controles-sqlite.ts';
import type { ObservacionDelPanel } from './datos-trabajo-sqlite.ts';
import { anotarInicioRechazadoSqlite } from './inicio-rechazado-sqlite.ts';
import {
  activarInvitacionSqlite,
  buscarInstitucionAutorizadaSqlite,
  consultarInvitacionSqlite,
  invitarInstitucionSqlite,
  leerRegistroInstitucionesSqlite,
  prepararInstitucionesSqlite,
  renovarInvitacionSqlite,
  retirarClaveInstitucionSqlite,
  retirarInstitucionSqlite,
} from './instituciones-sqlite.ts';
import { registrarFalloSqlite, reservarProgramadaSqlite } from './programacion-almacen.ts';
import { prepararProgramacionSqlite } from './programacion-sqlite.ts';
import {
  comprobarAcceso,
  crearActiva,
  exigir,
  existeTabla,
  type FilaSesion,
  instante,
  validarFila,
} from './sesion-fila-sqlite.ts';
import {
  anotarAperturaSqlite,
  anotarCaducidadSqlite,
  anotarCierreSqlite,
  type CrearIdLegible,
  decidirAperturaSqlite,
  leerRegistroPanelSqlite,
  prepararSesionUnicaSqlite,
  recibirEnPanelSqlite,
} from './sesion-unica-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import {
  anotarDespachoSqlite,
  confirmarInicioSqlite,
  leerDatosDelPanelSqlite,
  leerDatosDelUltimoTrabajoSqlite,
  leerTrabajosSqlite,
  prepararTrabajosSqlite,
  registrarReciboSqlite,
  reservarTrabajoSqlite,
  retirarTrabajoSqlite,
} from './trabajos-sqlite.ts';

export interface OpcionesSesionPanelSqlite {
  readonly ahora?: () => number;
  readonly crearId?: CrearIdLegible;
}

export class AlmacenSesionPanelSqlite
  implements
    AlmacenPreparacionPanel,
    AlmacenAccesos,
    AlmacenInstituciones,
    AlmacenSeccionesPanel,
    AlmacenTrabajosActualizacion,
    AlmacenRecuperacionActivacion,
    AlmacenTrabajosProgramados,
    administradores.AlmacenAdministradores
{
  protected readonly sql: SqlAccesoPublico;
  private readonly ahora: () => number;
  private readonly crearId: CrearIdLegible;

  /** Constructor pasivo: la composición decide cuándo adoptar, sin modificar instalaciones heredadas. */
  constructor(sql: SqlAccesoPublico, opciones: OpcionesSesionPanelSqlite = {}) {
    this.sql = sql;
    this.ahora = opciones.ahora ?? Date.now;
    this.crearId = opciones.crearId ?? ((prefijo) => crearIdLegible(prefijo));
  }
  private instante(): number {
    const ahora = this.ahora();
    exigir(instante(ahora) && ahora <= Number.MAX_SAFE_INTEGER - DURACION_MAXIMA_SESION_PANEL_MS);
    return ahora;
  }
  private leerFila(): FilaSesion {
    const metadata = this.sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
    exigir(
      metadata !== undefined && metadata.version === 1 && metadata.sesion_panel_version === 1 && existeTabla(this.sql),
    );
    const filas = this.sql.filas('SELECT * FROM administracion_sesion');
    exigir(filas.length === 1 && filas[0] !== undefined);
    return validarFila(filas[0]);
  }
  /** El llamador mantiene la transacción: no se adopta ningún estado parcial por separado. */
  private crearSesion(): void {
    const metadata = this.sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
    exigir(metadata !== undefined && !Object.hasOwn(metadata, 'sesion_panel_version') && !existeTabla(this.sql));
    const ahora = this.instante();
    this.sql.ejecutar(
      'ALTER TABLE publico_estado ADD COLUMN sesion_panel_version INTEGER NOT NULL DEFAULT 0 CHECK(sesion_panel_version IN (0,1))',
    );
    this.sql.ejecutar(`CREATE TABLE administracion_sesion (
      id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1),
      huella_sesion TEXT, huella_principal TEXT, iniciada INTEGER, actividad INTEGER,
      cerrada INTEGER NOT NULL CHECK(cerrada IN (0,1)), reloj INTEGER NOT NULL) STRICT`);
    this.sql.ejecutar('INSERT INTO administracion_sesion VALUES (1,1,NULL,NULL,NULL,NULL,1,?)', ahora);
    this.sql.ejecutar('UPDATE publico_estado SET sesion_panel_version=1 WHERE id=1');
    lista.prepararAdministradoresSqlite(this.sql);
  }
  async activarSesionPanel(): Promise<void> {
    this.sql.transaccion(() => {
      exigir(leerControlesSqlite(this.sql) !== null);
      this.crearSesion();
    });
  }
  async prepararPanel(inicial: PoliticaControles): Promise<DocumentoControles> {
    const politica = leerPoliticaControles(inicial);
    return this.sql.transaccion(() => {
      const controles = leerControlesSqlite(this.sql);
      const metadata = this.sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
      exigir(metadata !== undefined);
      if (Object.hasOwn(metadata, 'sesion_panel_version')) {
        exigir(controles !== null);
        const fila = this.leerFila();
        exigir(this.instante() >= fila.reloj);
        // Una instalación anterior a la sesión única o a la lista de administradores las adopta aquí, una sola vez y
        // antes de atender a nadie; la lista prepara antes la sesión única, de la que depende.
        lista.prepararAdministradoresSqlite(this.sql);
        return controles;
      }
      exigir(!existeTabla(this.sql));
      const documento = controles ?? activarControlesSqlite(this.sql, politica);
      this.crearSesion();
      return documento;
    });
  }
  private instalarSesion(acceso: AccesoSesionPanel, ahora: number): SesionPanelActiva {
    this.sql.ejecutar(
      'UPDATE administracion_sesion SET huella_sesion=?,huella_principal=?,iniciada=?,actividad=?,cerrada=0,reloj=? WHERE id=1',
      ...[acceso.huellaSesion, acceso.huellaPrincipal, ahora, ahora, ahora],
    );
    return crearActiva(ahora, ahora);
  }
  private sesionVigente() {
    exigir(leerControlesSqlite(this.sql) !== null);
    const sesion = this.leerFila(),
      ahora = this.instante();
    exigir(ahora >= sesion.reloj);
    return { sesion, ahora };
  }
  private contextoUnico(identidad: IdentidadPanel) {
    return { sql: this.sql, ...this.sesionVigente(), identidad, crearId: this.crearId };
  }
  /** Bienvenida: anota la entrada (una por sesión de Access) y dice si el panel está libre o quién lo tiene. */
  async recibirEnPanel(entrada: IdentidadPanel): Promise<BienvenidaPanel> {
    const identidad = leerIdentidadPanel(entrada);
    return this.sql.transaccion(() => recibirEnPanelSqlite(this.contextoUnico(identidad)));
  }
  async abrirSesionUnica(entrada: AccesoSesionPanel, persona: IdentidadPanel, retomar: boolean) {
    const acceso = leerAccesoSesionPanel(entrada),
      identidad = leerIdentidadPanel(persona);
    exigir(acceso.huellaPrincipal === identidad.huellaPrincipal);
    return this.sql.transaccion((): ResultadoAperturaUnica => {
      const contexto = this.contextoUnico(identidad);
      exigir(acceso.huellaSesion !== contexto.sesion.huellaSesion);
      const decision = decidirAperturaSqlite(contexto, retomar);
      if (decision.estado === 'ocupada') {
        return decision;
      }
      const sesion = this.instalarSesion(acceso, contexto.ahora);
      const idSesion = anotarAperturaSqlite({ ...contexto, huellaSesion: acceso.huellaSesion, ...decision });
      return { estado: 'abierta', idSesion, idEntrada: decision.idEntrada, sesion };
    });
  }
  async leerRegistroPanel(): Promise<readonly FilaRegistroPanel[]> {
    return this.sql.transaccion(() => {
      const { sesion, ahora } = this.sesionVigente();
      prepararSesionUnicaSqlite(this.sql);
      anotarCaducidadSqlite(this.sql, sesion, ahora);
      return leerRegistroPanelSqlite(this.sql, ahora);
    });
  }
  /** Lista de administradores: la autorización de cada petición y sus cambios con la sesión única de quien pide. */
  async autorizarAdministrador(entrada: administradores.EntradaAdministrador, siembra: readonly string[]) {
    return this.sql.transaccion(() => lista.autorizarAdministradorSqlite(this.sql, entrada, siembra, this.instante()));
  }
  async leerAdministradores() {
    return this.sql.transaccion(() => lista.leerAdministradoresSqlite(this.sql));
  }
  async cambiarAdministradores(acceso: AccesoSesionPanel, entrada: administradores.CambioAdministradores) {
    const cambio = administradores.leerCambioAdministradores(entrada);
    return this.conSesion(acceso, (_sesion, ahora) => lista.cambiarAdministradoresSqlite(this.sql, cambio, ahora));
  }
  protected conSesion<T>(
    entrada: AccesoSesionPanel,
    accion: (sesion: SesionPanelActiva, ahora: number, fila: FilaSesion) => T,
  ): T | SesionPanelInactiva {
    const acceso = leerAccesoSesionPanel(entrada);
    return this.sql.transaccion(() => {
      const fila = this.leerFila();
      const ahora = this.instante();
      exigir(ahora >= fila.reloj);
      anotarCaducidadSqlite(this.sql, fila, ahora);
      const estado = comprobarAcceso(fila, acceso, ahora);
      if (fila.huellaSesion === acceso.huellaSesion && fila.huellaPrincipal === acceso.huellaPrincipal) {
        // Registrar el reloj impide resucitar una sesión caducada si el reloj del sistema retrocede.
        this.sql.ejecutar('UPDATE administracion_sesion SET reloj=? WHERE id=1', ahora);
      }
      return estado.estado === 'activa' ? accion(estado, ahora, fila) : estado;
    });
  }
  async comprobarSesion(acceso: AccesoSesionPanel): Promise<EstadoSesionPanel> {
    return this.conSesion(acceso, (sesion) => sesion);
  }
  async mantenerSesion(acceso: AccesoSesionPanel): Promise<EstadoSesionPanel> {
    return this.conSesion(acceso, (sesion, ahora) => {
      this.sql.ejecutar('UPDATE administracion_sesion SET actividad=? WHERE id=1', ahora);
      return crearActiva(sesion.iniciadaEn, ahora);
    });
  }
  async cerrarSesion(acceso: AccesoSesionPanel): Promise<EstadoSesionPanel> {
    return this.conSesion(acceso, (_sesion, ahora, fila) => {
      anotarCierreSqlite(this.sql, fila, ahora);
      this.sql.ejecutar('UPDATE administracion_sesion SET cerrada=1 WHERE id=1');
      return { estado: 'cerrada' } as const;
    });
  }
  async leerControlesDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaControlesSesion> {
    return this.conSesion(acceso, (sesion) => {
      const controles = leerControlesSqlite(this.sql);
      exigir(controles !== null);
      return { estado: 'activa', sesion, controles } as const;
    });
  }
  async cambiarControlesDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    politica: PoliticaControles,
  ): Promise<ResultadoCambioControlesSesion> {
    return this.conSesion(acceso, (sesion) => ({
      ...cambiarControlesSqlite(this.sql, revisionEsperada, politica),
      sesion,
    }));
  }
  /** Sesión, revisión y cambio institucional se comprueban bajo el mismo BEGIN IMMEDIATE/transactionSync. */
  async leerInstitucionesDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoRegistroSesion> {
    return this.conSesion(acceso, (sesion, ahora) => ({
      estado: 'activa',
      sesion,
      registro: leerRegistroInstitucionesSqlite(this.sql, ahora),
    }));
  }
  async invitarInstitucionDeSesion(
    acceso: AccesoSesionPanel,
    entrada: SolicitudInvitar,
    nueva: IdentidadInvitacion & { readonly institucionId: string },
  ): Promise<ResultadoCambioInstitucionesSesion> {
    const solicitud = leerSolicitudInvitar(entrada);
    return this.conSesion(acceso, (sesion, ahora) => ({
      ...invitarInstitucionSqlite(this.sql, solicitud, nueva, ahora),
      sesion,
    }));
  }
  async renovarInvitacionDeSesion(
    acceso: AccesoSesionPanel,
    entrada: SolicitudInstitucion,
    nueva: IdentidadInvitacion,
  ): Promise<ResultadoCambioInstitucionesSesion> {
    const solicitud = leerSolicitudInstitucion(entrada);
    return this.conSesion(acceso, (sesion, ahora) => ({
      ...renovarInvitacionSqlite(this.sql, solicitud, nueva, ahora),
      sesion,
    }));
  }
  async retirarInstitucionDeSesion(
    acceso: AccesoSesionPanel,
    entrada: SolicitudInstitucion,
  ): Promise<ResultadoCambioInstitucionesSesion> {
    const solicitud = leerSolicitudInstitucion(entrada);
    return this.conSesion(acceso, (sesion, ahora) => ({
      ...retirarInstitucionSqlite(this.sql, solicitud, ahora),
      sesion,
    }));
  }
  async retirarClaveDeSesion(
    acceso: AccesoSesionPanel,
    entrada: SolicitudRetirarClave,
  ): Promise<ResultadoCambioInstitucionesSesion> {
    const solicitud = leerSolicitudRetirarClave(entrada);
    return this.conSesion(acceso, (sesion, ahora) => ({
      ...retirarClaveInstitucionSqlite(this.sql, solicitud, ahora),
      sesion,
    }));
  }
  /** Las operaciones públicas tienen autoridad operativa, nunca adoptan ni renuevan una sesión humana. */
  private conAutoridadOperativa<T>(accion: (ahora: number) => T): T {
    return this.sql.transaccion(() => {
      exigir(leerControlesSqlite(this.sql) !== null);
      const fila = this.leerFila(),
        ahora = this.instante();
      exigir(ahora >= fila.reloj);
      return accion(ahora);
    });
  }
  async prepararAccesos(): Promise<void> {
    this.conAutoridadOperativa((ahora) => prepararAccesosSqlite(this.sql, ahora));
  }
  async registrarAcceso(entrada: UsoConectividad): Promise<void> {
    const uso = leerUsoConectividad(entrada);
    this.conAutoridadOperativa((ahora) => registrarAccesoSqlite(this.sql, uso, ahora));
  }
  async depurarAccesos(): Promise<void> {
    this.conAutoridadOperativa((ahora) => depurarAccesosSqlite(this.sql, ahora));
  }
  async siguienteVencimientoAccesos(): Promise<number | null> {
    return this.conAutoridadOperativa(() => siguienteVencimientoAccesosSqlite(this.sql));
  }
  async leerAccesosDeSesion(acceso: AccesoSesionPanel, entradaPagina: number): Promise<ResultadoAccesosSesion> {
    const pagina = leerPaginaAccesos({ pagina: entradaPagina });
    return this.conSesion(acceso, (sesion, ahora) => ({
      estado: 'activa',
      sesion,
      accesos: leerAccesosSqlite(this.sql, pagina, ahora),
    }));
  }
  async prepararInstituciones(): Promise<void> {
    this.conAutoridadOperativa((ahora) => prepararInstitucionesSqlite(this.sql, ahora));
  }
  async consultarInvitacion(recibida: IdentidadInvitacion): Promise<InvitacionLeida | null | 'apagada'> {
    return this.conAutoridadOperativa((ahora) => consultarInvitacionSqlite(this.sql, recibida, ahora));
  }
  async activarInvitacion(
    recibida: IdentidadInvitacion,
    clave: IdentidadInvitacion,
  ): Promise<ResultadoActivarInvitacion> {
    return this.conAutoridadOperativa((ahora) => activarInvitacionSqlite(this.sql, recibida, clave, ahora));
  }
  async buscarInstitucion(id: string): Promise<Socio | null> {
    return this.conAutoridadOperativa(() => buscarInstitucionAutorizadaSqlite(this.sql, id));
  }
  async leerSecciones(): Promise<DocumentoSecciones | null> {
    return this.sql.transaccion(() => leerSeccionesSqlite(this.sql));
  }
  async leerSeccionesDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaSeccionesSesion> {
    return this.conSesion(acceso, (sesion) => {
      const secciones = leerSeccionesSqlite(this.sql);
      exigir(secciones !== null);
      return { estado: 'activa', sesion, secciones } as const;
    });
  }
  async cambiarSeccionesDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    secciones: PoliticaSecciones,
  ): Promise<ResultadoCambioSeccionesSesion> {
    return this.conSesion(acceso, (sesion) => ({
      ...cambiarSeccionesSqlite(this.sql, revisionEsperada, secciones),
      sesion,
    }));
  }
  /** La preparación y las llamadas de retorno privadas validan también la autoridad, sin exigir una sesión humana viva. */
  protected conTrabajos<T>(accion: (ahora: number) => T): T {
    return this.sql.transaccion(() => {
      exigir(leerControlesSqlite(this.sql) !== null);
      const fila = this.leerFila();
      const ahora = this.instante();
      exigir(ahora >= fila.reloj);
      return accion(ahora);
    });
  }
  async prepararTrabajos(): Promise<void> {
    this.conTrabajos((ahora) => {
      prepararTrabajosSqlite(this.sql, ahora);
      prepararProgramacionSqlite(this.sql, ahora);
    });
  }
  async reservarTrabajoProgramado(entrada: SolicitudTrabajoProgramado, confianza: ConfianzaOidcGitHub) {
    return reservarProgramadaSqlite(this.sql, (accion) => this.conTrabajos(accion), entrada, confianza);
  }
  async registrarFalloProgramado(fallo: FalloProgramado) {
    return registrarFalloSqlite(this.sql, (accion) => this.conTrabajos(accion), fallo);
  }
  async prepararActivacion(): Promise<void> {
    this.conTrabajos((ahora) => prepararActivacionSqlite(this.sql, ahora));
  }
  async leerActivacionPrivada(): Promise<EstadoActivacionPrivado> {
    return this.conTrabajos((ahora) => leerActivacionSqlite(this.sql, ahora));
  }
  async reservarActivacion(...argumentos: ArgumentosReserva) {
    return reservarActivacionEnSqlite(this.activacion(), ...argumentos);
  }
  async recuperarActivacion(...argumentos: ArgumentosRecuperacion) {
    return recuperarActivacionEnSqlite(this.activacion(), ...argumentos);
  }
  async registrarPasoRecuperacionActivacion(...argumentos: ArgumentosPaso) {
    return registrarPasoEnSqlite(this.activacion(), true, ...argumentos);
  }
  async solicitarCierreActivacion(solicitud: SolicitudCierreActivacion) {
    return solicitarCierreEnSqlite(this.activacion(), solicitud);
  }
  async cerrarActivacionSolicitada(...argumentos: ArgumentosCierre) {
    return cerrarSolicitadaEnSqlite(this.activacion(), ...argumentos);
  }
  async registrarPasoActivacion(...argumentos: ArgumentosPaso) {
    return registrarPasoEnSqlite(this.activacion(), false, ...argumentos);
  }
  private activacion() {
    return { sql: this.sql, enTransaccion: <T>(accion: (ahora: number) => T) => this.conTrabajos(accion) };
  }
  async leerTrabajoPrivado(): Promise<EstadoTrabajosPrivado> {
    return this.conTrabajos((ahora) => leerTrabajosSqlite(this.sql, ahora));
  }
  async leerDatosDelUltimoTrabajo(): Promise<ObservacionDatosTrabajo | null> {
    return this.conTrabajos((ahora) => leerDatosDelUltimoTrabajoSqlite(this.sql, ahora));
  }
  async leerDatosDelPanel(): Promise<ObservacionDelPanel | null> {
    return this.conTrabajos((ahora) => leerDatosDelPanelSqlite(this.sql, ahora));
  }
  async leerTrabajoDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaTrabajo> {
    return this.conSesion(acceso, (sesion, ahora) => {
      exigir(leerControlesSqlite(this.sql) !== null);
      return {
        estado: 'activa',
        sesion,
        trabajos: estadoPublicoTrabajos(leerTrabajosSqlite(this.sql, ahora)),
      } as const;
    });
  }
  async reservarTrabajoDeSesion(
    acceso: AccesoSesionPanel,
    entrada: SolicitudTrabajo,
    entradaConfianza: ConfianzaOidcGitHub,
  ): Promise<ResultadoReservaTrabajo> {
    const solicitud = leerSolicitudTrabajo(entrada);
    const confianza = leerConfianzaOidcGitHub(entradaConfianza);
    return this.conSesion(acceso, (sesion, ahora) => {
      exigir(leerControlesSqlite(this.sql) !== null);
      return { ...reservarTrabajoSqlite(this.sql, { ...solicitud, origen: 'panel' }, confianza, ahora), sesion };
    });
  }
  async anotarDespacho(
    referencia: ReferenciaTrabajo,
    resultado: ResultadoDespacho,
  ): Promise<ResultadoTransicionTrabajo> {
    const comprobada = leerReferenciaTrabajo(referencia);
    return this.conTrabajos((ahora) => anotarDespachoSqlite(this.sql, comprobada, resultado, ahora));
  }
  // biome-ignore lint/complexity/useMaxParams: Extensión opcional del contrato existente, conserva sus llamadores.
  async registrarRecibo(
    entrada: ReciboTrabajo,
    huellaRecibo: string,
    identidad: IdentidadEjecucionGitHub,
    datos?: EstadoDatosPanel | null,
    catalogo?: CatalogoPrivado | null,
  ): Promise<ResultadoTransicionTrabajo> {
    const recibo = leerReciboTrabajo(entrada);
    return this.conTrabajos((ahora) =>
      registrarReciboSqlite(
        this.sql,
        {
          recibo,
          huellaRecibo,
          identidad,
          ...(datos === undefined ? {} : { datos }),
          ...(catalogo === undefined ? {} : { catalogo }),
        },
        ahora,
      ),
    );
  }
  async confirmarInicio(
    entrada: InicioTrabajo,
    identidad: IdentidadEjecucionGitHub,
  ): Promise<ResultadoTransicionTrabajo> {
    const inicio = leerInicioTrabajo(entrada);
    return this.conTrabajos((ahora) => confirmarInicioSqlite(this.sql, inicio, identidad, ahora));
  }
  async anotarInicioRechazado(entrada: InicioTrabajo, identidad: IdentidadEjecucionGitHub) {
    const inicio = leerInicioTrabajo(entrada);
    return this.conTrabajos((ahora) => anotarInicioRechazadoSqlite(this.sql, inicio, identidad, ahora));
  }
  async retirarTrabajoDeSesion(acceso: AccesoSesionPanel, entrada: RetiradaTrabajo): Promise<ResultadoRetiradaTrabajo> {
    const retirada = leerRetiradaTrabajo(entrada);
    return this.conSesion(acceso, (sesion, ahora) => {
      exigir(leerControlesSqlite(this.sql) !== null);
      return { ...retirarTrabajoSqlite(this.sql, retirada, ahora), sesion };
    });
  }
  async finalizarEjecucionSinRecibo(
    referencia: ReferenciaTrabajo,
    entrada: EvidenciaEjecucionCompletada,
  ): Promise<ResultadoTransicionTrabajo> {
    const comprobada = leerReferenciaTrabajo(referencia);
    const evidencia = leerEvidenciaEjecucionCompletada(entrada);
    return this.conTrabajos((ahora) => finalizarSinReciboSqlite(this.sql, comprobada, evidencia, ahora));
  }
  async cerrarSinRecibo(entrada: CierreSinRecibo, identidad: IdentidadEjecucionGitHub) {
    const cierre = leerCierreSinRecibo(entrada);
    return this.conTrabajos((ahora) => cerrarSinReciboSqlite(this.sql, cierre, identidad, ahora));
  }
}
