/** Registro operativo mínimo: tipos de consulta, recuentos y estado; nunca argumentos ni identidad de red. */
import { type ClienteDeclarado, esConsultaOperativa, sanearClienteDeclarado } from '../api/campos-operativos.ts';
import { ID_INSTITUCION, LIMITES_CONECTIVIDAD, nombreInstitucion } from './instituciones.ts';
import {
  type AccesoSesionPanel,
  leerEstadoSesionPanel,
  type SesionPanelActiva,
  type SesionPanelInactiva,
} from './sesion.ts';

// Los almacenes del registro validan sus filas con las mismas piezas que los canales de agentes.
export { esConsultaOperativa, sanearClienteDeclarado };
export type UsoConectividad =
  | {
      readonly canal: 'api';
      readonly institucionId: string;
      readonly credencial: string;
      readonly consulta: string;
      readonly estadoHttp: number;
    }
  | ({ readonly canal: 'mcp'; readonly consulta: string } & ClienteDeclarado)
  | { readonly canal: 'a2a'; readonly habilidad: string };
export interface AccesoApi {
  readonly fecha: string;
  readonly institucionId: string;
  readonly institucion: string;
  readonly consulta: string;
  readonly estadoHttp: number;
}
export interface AccesoMcp extends ClienteDeclarado {
  readonly dia: string;
  readonly herramienta: string;
  readonly consultas: number;
}
export interface AccesoA2a {
  readonly dia: string;
  readonly habilidad: string;
  readonly consultas: number;
}
/** Paginación global: máximo porPagina filas sumando los tres canales, no una página independiente por canal. */
export interface PaginaAccesos {
  readonly version: 1;
  readonly pagina: number;
  readonly total: number;
  readonly porPagina: number;
  readonly api: readonly AccesoApi[];
  readonly mcp: readonly AccesoMcp[];
  readonly a2a: readonly AccesoA2a[];
}
export type ResultadoAccesosSesion =
  | { readonly estado: 'activa'; readonly sesion: SesionPanelActiva; readonly accesos: PaginaAccesos }
  | SesionPanelInactiva;
export interface AlmacenAccesos {
  prepararAccesos(): Promise<void>;
  registrarAcceso(uso: UsoConectividad): Promise<void>;
  /** Limpieza explícita y repetible. No repara un esquema incompleto ni prepara tablas. */
  depurarAccesos(): Promise<void>;
  leerAccesosDeSesion(acceso: AccesoSesionPanel, pagina: number): Promise<ResultadoAccesosSesion>;
}
export class SolicitudAccesoInvalida extends Error {
  override readonly name = 'SolicitudAccesoInvalida';
  constructor() {
    super('Solicitud de registro operativo no válida');
  }
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new SolicitudAccesoInvalida();
  }
}
function objeto(entrada: unknown, claves: readonly string[]): Record<string, unknown> {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const prototipo: unknown = Object.getPrototypeOf(entrada);
  exigir((prototipo === Object.prototype || prototipo === null) && Object.getOwnPropertySymbols(entrada).length === 0);
  exigir(Object.getOwnPropertyNames(entrada).sort().join(',') === [...claves].sort().join(','));
  const copia: Record<string, unknown> = {};
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    exigir(descriptor !== undefined && 'value' in descriptor && descriptor.enumerable === true);
    copia[clave] = descriptor.value;
  }
  return copia;
}
export function leerPaginaAccesos(entrada: unknown): number {
  const o = objeto(entrada, ['pagina']);
  exigir(
    typeof o.pagina === 'number' &&
      Number.isSafeInteger(o.pagina) &&
      o.pagina >= 1 &&
      o.pagina <= LIMITES_CONECTIVIDAD.registrosOperativos,
  );
  return o.pagina;
}
function leerCliente(o: Record<string, unknown>): ClienteDeclarado {
  exigir(
    o.categoriaCliente === 'declarado' ||
      o.categoriaCliente === 'no_declarado' ||
      o.categoriaCliente === 'omitido' ||
      o.categoriaCliente === 'otros',
  );
  if (o.categoriaCliente !== 'declarado') {
    exigir(o.clienteDeclarado === null);
    return { clienteDeclarado: null, categoriaCliente: o.categoriaCliente };
  }
  exigir(typeof o.clienteDeclarado === 'string');
  const saneado = sanearClienteDeclarado(o.clienteDeclarado);
  exigir(saneado.categoriaCliente === 'declarado' && saneado.clienteDeclarado === o.clienteDeclarado);
  return saneado;
}
/** El enlace del entorno vuelve a validar: nunca da por saneado un campo solo porque lo diga quien llama. */
export function leerUsoConectividad(entrada: unknown): UsoConectividad {
  exigir(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'canal');
  exigir(descriptor !== undefined && 'value' in descriptor);
  if (descriptor.value === 'api') {
    const o = objeto(entrada, ['canal', 'institucionId', 'credencial', 'consulta', 'estadoHttp']);
    exigir(typeof o.institucionId === 'string' && ID_INSTITUCION.test(o.institucionId));
    exigir(typeof o.credencial === 'string' && /^[0-9a-f]{64}$/.test(o.credencial));
    exigir(esConsultaOperativa(o.consulta));
    const MIN_HTTP = 100,
      MAX_HTTP = 599;
    exigir(
      typeof o.estadoHttp === 'number' &&
        Number.isInteger(o.estadoHttp) &&
        o.estadoHttp >= MIN_HTTP &&
        o.estadoHttp <= MAX_HTTP,
    );
    return {
      canal: 'api',
      institucionId: o.institucionId,
      credencial: o.credencial,
      consulta: o.consulta,
      estadoHttp: o.estadoHttp,
    };
  }
  if (descriptor.value === 'mcp') {
    const o = objeto(entrada, ['canal', 'consulta', 'clienteDeclarado', 'categoriaCliente']);
    exigir(esConsultaOperativa(o.consulta));
    return { canal: 'mcp', consulta: o.consulta, ...leerCliente(o) };
  }
  const o = objeto(entrada, ['canal', 'habilidad']);
  exigir(o.canal === 'a2a' && esConsultaOperativa(o.habilidad));
  return { canal: 'a2a', habilidad: o.habilidad };
}

function iso(entrada: unknown): string {
  exigir(typeof entrada === 'string');
  const fecha = new Date(entrada);
  exigir(Number.isFinite(fecha.getTime()) && fecha.getTime() >= 0 && fecha.toISOString() === entrada);
  return entrada;
}
function dia(entrada: unknown): string {
  exigir(typeof entrada === 'string');
  const fecha = `${entrada}T00:00:00.000Z`;
  exigir(iso(fecha) === fecha);
  return entrada;
}
function contar(entrada: unknown, minimo = 0): number {
  exigir(typeof entrada === 'number' && Number.isSafeInteger(entrada) && entrada >= minimo);
  return entrada;
}
function accesoApi(entrada: unknown): AccesoApi {
  const o = objeto(entrada, ['fecha', 'institucionId', 'institucion', 'consulta', 'estadoHttp']);
  exigir(
    typeof o.institucionId === 'string' && ID_INSTITUCION.test(o.institucionId) && esConsultaOperativa(o.consulta),
  );
  const MIN_HTTP = 100,
    MAX_HTTP = 599;
  exigir(
    typeof o.estadoHttp === 'number' &&
      Number.isInteger(o.estadoHttp) &&
      o.estadoHttp >= MIN_HTTP &&
      o.estadoHttp <= MAX_HTTP,
  );
  return {
    fecha: iso(o.fecha),
    institucionId: o.institucionId,
    institucion: nombreInstitucion(o.institucion),
    consulta: o.consulta,
    estadoHttp: o.estadoHttp,
  };
}
function accesoMcp(entrada: unknown): AccesoMcp {
  const o = objeto(entrada, ['dia', 'herramienta', 'clienteDeclarado', 'categoriaCliente', 'consultas']);
  exigir(esConsultaOperativa(o.herramienta));
  return { dia: dia(o.dia), herramienta: o.herramienta, ...leerCliente(o), consultas: contar(o.consultas, 1) };
}
function accesoA2a(entrada: unknown): AccesoA2a {
  const o = objeto(entrada, ['dia', 'habilidad', 'consultas']);
  exigir(esConsultaOperativa(o.habilidad));
  return { dia: dia(o.dia), habilidad: o.habilidad, consultas: contar(o.consultas, 1) };
}
/** Valida también el tamaño de la página y la distinción entre filas y consultas agregadas. */
export function leerPaginaAccesosRecibida(entrada: unknown): PaginaAccesos {
  const o = objeto(entrada, ['version', 'pagina', 'total', 'porPagina', 'api', 'mcp', 'a2a']);
  exigir(o.version === 1 && o.porPagina === LIMITES_CONECTIVIDAD.porPagina);
  const pagina = leerPaginaAccesos({ pagina: o.pagina }),
    total = contar(o.total);
  exigir(
    total <= LIMITES_CONECTIVIDAD.registrosOperativos &&
      Array.isArray(o.api) &&
      Array.isArray(o.mcp) &&
      Array.isArray(o.a2a),
  );
  const cantidad = o.api.length + o.mcp.length + o.a2a.length;
  const esperada = Math.min(
    LIMITES_CONECTIVIDAD.porPagina,
    Math.max(0, total - (pagina - 1) * LIMITES_CONECTIVIDAD.porPagina),
  );
  exigir(cantidad === esperada);
  const api = o.api.map(accesoApi),
    mcp = o.mcp.map(accesoMcp),
    a2a = o.a2a.map(accesoA2a);
  return { version: 1, pagina, total, porPagina: LIMITES_CONECTIVIDAD.porPagina, api, mcp, a2a };
}
export function leerResultadoAccesosSesion(entrada: unknown): ResultadoAccesosSesion {
  exigir(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'estado');
  exigir(descriptor !== undefined && 'value' in descriptor);
  if (descriptor.value !== 'activa') {
    const sesion = leerEstadoSesionPanel(entrada);
    exigir(sesion.estado !== 'activa');
    return sesion;
  }
  const o = objeto(entrada, ['estado', 'sesion', 'accesos']),
    sesion = leerEstadoSesionPanel(o.sesion);
  exigir(sesion.estado === 'activa');
  return { estado: 'activa', sesion, accesos: leerPaginaAccesosRecibida(o.accesos) };
}
