/**
 * Lista de administradores del Panel de Control. Cloudflare Access autentica a la persona; Faro decide si su correo
 * verificado figura en esta lista. Mientras la lista está vacía basta con Access, para que una instalación nueva no
 * deje fuera a quien la monta; en cuanto tiene una fila, nunca vuelve a quedar vacía por una retirada.
 */
import { type AccesoSesionPanel, leerEstadoSesionPanel, type SesionPanelInactiva } from './sesion.ts';
import { esCorreoVerificado } from './sesion-unica.ts';

/** Una institución con tres administradores es lo habitual; cincuenta acota cualquier error o abuso sin estorbar. */
export const MAX_ADMINISTRADORES = 50;
/** Una instalación siembra a quien la monta y a poca gente más; el resto se añade desde el panel. */
export const MAX_ADMINISTRADORES_INICIALES = 10;
/**
 * Cota holgada de una fila en JSON: dos correos de hasta 254 bytes (ASCII visible, que en JSON no crece), más sus
 * campos y comillas.
 * Con ella, la lista completa cabe siempre en la respuesta del objeto durable y nunca se corta.
 */
const BYTES_POR_ADMINISTRADOR = 1800;
/** El envoltorio de la respuesta: estado, nombres de los campos y corchetes. */
const BYTES_ENVOLTORIO = 512;
export const MAX_RESPUESTA_ADMINISTRADORES = MAX_ADMINISTRADORES * BYTES_POR_ADMINISTRADOR + BYTES_ENVOLTORIO;
/**
 * `retirada-pendiente`: Faro ya no le deja entrar, pero Cloudflare Access todavía no ha confirmado que lo ha quitado
 * del grupo ni ha cerrado sus sesiones. Se queda a la vista hasta que un reintento lo confirme.
 */
export const ESTADOS_ADMINISTRADOR = ['pendiente', 'activo', 'retirada-pendiente'] as const;
export type EstadoAdministrador = (typeof ESTADOS_ADMINISTRADOR)[number];

export interface Administrador {
  readonly correo: string;
  readonly estado: EstadoAdministrador;
  /** null cuando lo sembró la instalación con FARO_ADMINISTRADORES_INICIALES. */
  readonly anadidoPor: string | null;
  readonly anadidoEn: number;
  readonly ultimaEntrada: number | null;
  /** Si su última entrada llegó con segundo factor; null mientras no haya entrado. */
  readonly segundoFactor: boolean | null;
}
/** Lo que la autorización sabe de la petición: el correo verificado por Access y si trajo segundo factor. */
export interface EntradaAdministrador {
  readonly correo: string | null;
  readonly segundoFactor: boolean;
}
/** `sin-lista`: la lista está vacía y la instalación no la sembró; se comporta como si solo existiera Access. */
export type DecisionAutorizacion = 'autorizado' | 'sin-lista' | 'denegado';

/** Resultado de la sincronización con Cloudflare Access que acompaña a cada cambio y queda en el registro. */
export type SincronizacionAccess = 'correcta' | 'fallida' | 'sin-configurar';
export type CambioAdministradores =
  | {
      readonly operacion: 'anadir';
      readonly autor: string;
      readonly correo: string;
      /** El alta llega aquí solo después de que Cloudflare la confirme, o si la sincronización no está configurada. */
      readonly access: Exclude<SincronizacionAccess, 'fallida'>;
    }
  | {
      readonly operacion: 'retirar';
      readonly autor: string;
      readonly correo: string;
      /** Con Access configurado la fila se queda como retirada pendiente hasta que Cloudflare lo confirme. */
      readonly esperarAccess: boolean;
    }
  | {
      readonly operacion: 'confirmar-retirada';
      readonly autor: string;
      readonly correo: string;
      readonly access: Exclude<SincronizacionAccess, 'sin-configurar'>;
    }
  | { readonly operacion: 'anotar-fallo-alta'; readonly autor: string; readonly correo: string };
export type MotivoRechazoCambio =
  | 'correo_no_valido'
  | 'administrador_duplicado'
  | 'lista_llena'
  | 'alta_propia_primero'
  | 'administrador_no_encontrado'
  | 'ultimo_activo';
export type ResultadoCambioAdministradores =
  | { readonly estado: 'activa'; readonly administradores: readonly Administrador[] }
  | { readonly estado: 'rechazado'; readonly motivo: MotivoRechazoCambio };

/** Lo que exponen el almacén SQLite y su cliente del objeto durable. */
export interface AlmacenAdministradores {
  autorizarAdministrador(entrada: EntradaAdministrador, siembra: readonly string[]): Promise<DecisionAutorizacion>;
  leerAdministradores(): Promise<readonly Administrador[]>;
  cambiarAdministradores(
    acceso: AccesoSesionPanel,
    cambio: CambioAdministradores,
  ): Promise<ResultadoCambioAdministradores | SesionPanelInactiva>;
}

export class DatosAdministradoresNoValidos extends Error {
  override readonly name = 'DatosAdministradoresNoValidos';
  constructor() {
    super('Datos de administradores no válidos');
  }
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new DatosAdministradoresNoValidos();
  }
}
/** Access entrega el correo tal como se escribió; la lista lo guarda y lo compara siempre en minúsculas. */
export function correoDeAdministrador(valor: unknown): string | null {
  if (typeof valor !== 'string') {
    return null;
  }
  const correo = valor.trim().toLowerCase();
  return esCorreoVerificado(correo) ? correo : null;
}
function instante(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
}
function leerAdministrador(entrada: unknown): Administrador {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  exigir(Object.getPrototypeOf(entrada) === Object.prototype);
  const copia = { ...(entrada as Record<string, unknown>) };
  exigir(Object.keys(copia).sort().join(',') === 'anadidoEn,anadidoPor,correo,estado,segundoFactor,ultimaEntrada');
  exigir(correoDeAdministrador(copia.correo) === copia.correo);
  exigir(ESTADOS_ADMINISTRADOR.includes(copia.estado as EstadoAdministrador));
  exigir(copia.anadidoPor === null || correoDeAdministrador(copia.anadidoPor) === copia.anadidoPor);
  exigir(instante(copia.anadidoEn) && (copia.ultimaEntrada === null || instante(copia.ultimaEntrada)));
  exigir(copia.segundoFactor === null || typeof copia.segundoFactor === 'boolean');
  return {
    correo: copia.correo as string,
    estado: copia.estado as EstadoAdministrador,
    anadidoPor: copia.anadidoPor as string | null,
    anadidoEn: copia.anadidoEn,
    ultimaEntrada: copia.ultimaEntrada,
    segundoFactor: copia.segundoFactor,
  };
}
/** Rutas privadas del objeto durable; solo las usa el enlace del propio Worker. */
export const RUTAS_ADMINISTRADORES_DURABLE = Object.freeze({
  autorizar: '/panel/administradores/autorizar',
  leer: '/panel/administradores/leer',
  cambiar: '/panel/administradores/cambiar',
});
export function leerEntradaAdministrador(valor: unknown): EntradaAdministrador {
  if (
    valor === null ||
    typeof valor !== 'object' ||
    Object.keys(valor).sort().join(',') !== 'correo,segundoFactor' ||
    typeof (valor as Record<string, unknown>).segundoFactor !== 'boolean'
  ) {
    throw new DatosAdministradoresNoValidos();
  }
  const copia = valor as Record<string, unknown>;
  const correo = copia.correo === null ? null : correoDeAdministrador(copia.correo);
  if (correo !== copia.correo) {
    throw new DatosAdministradoresNoValidos();
  }
  return { correo, segundoFactor: copia.segundoFactor as boolean };
}
export function leerSiembraAdministradores(valor: unknown): readonly string[] {
  if (!Array.isArray(valor) || valor.length > MAX_ADMINISTRADORES_INICIALES) {
    throw new DatosAdministradoresNoValidos();
  }
  return valor.map((correo) => {
    if (correoDeAdministrador(correo) !== correo) {
      throw new DatosAdministradoresNoValidos();
    }
    return correo as string;
  });
}
/** Lista completa y sin repetidos; el orden lo fija el almacén (por fecha de alta). */
export function leerListaAdministradores(entrada: unknown): readonly Administrador[] {
  exigir(Array.isArray(entrada) && entrada.length <= MAX_ADMINISTRADORES);
  const lista = entrada.map(leerAdministrador);
  exigir(new Set(lista.map((fila) => fila.correo)).size === lista.length);
  return lista;
}
export function leerDecisionAutorizacion(entrada: unknown): DecisionAutorizacion {
  exigir(entrada === 'autorizado' || entrada === 'sin-lista' || entrada === 'denegado');
  return entrada;
}
const MOTIVOS: readonly MotivoRechazoCambio[] = [
  'correo_no_valido',
  'administrador_duplicado',
  'lista_llena',
  'alta_propia_primero',
  'administrador_no_encontrado',
  'ultimo_activo',
];
/** Una sesión que ya no está abierta llega con su propio contrato, el de la sesión del panel. */
export function leerResultadoCambioAdministradores(
  entrada: unknown,
): ResultadoCambioAdministradores | SesionPanelInactiva {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const copia = entrada as Record<string, unknown>;
  if (copia.estado !== 'activa' && copia.estado !== 'rechazado') {
    const sesion = leerEstadoSesionPanel(copia);
    exigir(sesion.estado !== 'activa');
    return sesion;
  }
  if (copia.estado === 'rechazado') {
    exigir(Object.keys(copia).sort().join(',') === 'estado,motivo');
    exigir(MOTIVOS.includes(copia.motivo as MotivoRechazoCambio));
    return { estado: 'rechazado', motivo: copia.motivo as MotivoRechazoCambio };
  }
  exigir(copia.estado === 'activa' && Object.keys(copia).sort().join(',') === 'administradores,estado');
  return { estado: 'activa', administradores: leerListaAdministradores(copia.administradores) };
}
export function leerCambioAdministradores(entrada: unknown): CambioAdministradores {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const copia = entrada as Record<string, unknown>;
  // Los dos correos llegan ya normalizados: el almacén compara y borra por igualdad exacta.
  const autor = correoDeAdministrador(copia.autor);
  const correo = correoDeAdministrador(copia.correo);
  exigir(autor !== null && autor === copia.autor && correo !== null && correo === copia.correo);
  const claves = Object.keys(copia).sort().join(',');
  if (copia.operacion === 'anotar-fallo-alta') {
    exigir(claves === 'autor,correo,operacion');
    return { operacion: copia.operacion, autor, correo };
  }
  if (copia.operacion === 'anadir') {
    exigir(claves === 'access,autor,correo,operacion');
    exigir(copia.access === 'correcta' || copia.access === 'sin-configurar');
    return { operacion: 'anadir', autor, correo, access: copia.access };
  }
  if (copia.operacion === 'retirar') {
    exigir(claves === 'autor,correo,esperarAccess,operacion' && typeof copia.esperarAccess === 'boolean');
    return { operacion: 'retirar', autor, correo, esperarAccess: copia.esperarAccess };
  }
  exigir(copia.operacion === 'confirmar-retirada' && claves === 'access,autor,correo,operacion');
  exigir(copia.access === 'correcta' || copia.access === 'fallida');
  return { operacion: 'confirmar-retirada', autor, correo, access: copia.access };
}

/** Los que siguen contando como administradores: una retirada pendiente ya no entra ni se cuenta. */
export function vigentes(lista: readonly Administrador[]): readonly Administrador[] {
  return lista.filter((fila) => fila.estado !== 'retirada-pendiente');
}
/**
 * Decide un alta antes de tocar nada, también antes de llamar a Cloudflare. Con la lista vacía, el primer correo tiene
 * que ser el de quien la empieza: si fuera otro, quien la empieza se quedaría fuera del panel en su siguiente paso.
 */
export function rechazoDeAlta(
  lista: readonly Administrador[],
  autor: string,
  entrada: string,
): MotivoRechazoCambio | null {
  const correo = correoDeAdministrador(entrada);
  if (correo === null) {
    return 'correo_no_valido';
  }
  if (lista.some((fila) => fila.correo === correo)) {
    return 'administrador_duplicado';
  }
  if (lista.length >= MAX_ADMINISTRADORES) {
    return 'lista_llena';
  }
  return lista.length === 0 && correo !== autor ? 'alta_propia_primero' : null;
}
/** Nunca se retira al último administrador activo, tampoco a uno mismo si es el último. */
export function rechazoDeRetirada(lista: readonly Administrador[], entrada: string): MotivoRechazoCambio | null {
  const correo = correoDeAdministrador(entrada);
  const fila = lista.find((candidata) => candidata.correo === correo);
  if (correo === null || fila === undefined || fila.estado === 'retirada-pendiente') {
    return 'administrador_no_encontrado';
  }
  const otrosActivos = lista.filter((candidata) => candidata.estado === 'activo' && candidata.correo !== correo);
  return otrosActivos.length === 0 ? 'ultimo_activo' : null;
}
