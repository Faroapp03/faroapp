/** Perfil de despliegue: configuraciones revisadas de producción y ensayo, su separación y lo que recibe Wrangler. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { comprobarArtefactoCloudflare, leerDescriptorArtefactoCloudflare } from './artefacto.ts';
import { esOrigenWorkersDev, leerAccesoEnsayo, validarOrigenEnsayo } from './parametros-ensayo.ts';
import { cursosDelPrincipal } from './pareja-de-workers.ts';

export type Entorno = 'produccion' | 'ensayo';
export type Servicio = 'principal' | 'cursos';
export type Configuracion = Record<string, unknown>;
export interface PerfilEntorno {
  readonly principal: Configuracion;
  readonly cursos: Configuracion;
}
export interface Perfil {
  readonly produccion: PerfilEntorno;
  readonly ensayo: PerfilEntorno;
}
export interface RegistroInstalacion {
  readonly version: 1;
  readonly entorno: Entorno;
  readonly tipo: 'nueva' | 'existente';
  readonly worker: string;
  readonly cursos: string;
  /** Origen público exacto: el dominio propio en producción; en ensayo, el workers.dev de su Worker en la cuenta. */
  readonly origen: string;
  /** Las migraciones aplicadas, completas y en orden: la etiqueta sola no prueba qué operación se aplicó. */
  readonly migraciones_aplicadas: readonly Readonly<Record<string, unknown>>[];
}

export const ARCHIVOS: Readonly<Record<Entorno, Readonly<Record<Servicio, string>>>> = {
  produccion: {
    principal: 'config/cloudflare/instalaciones/wrangler.produccion.jsonc',
    cursos: 'config/cloudflare/instalaciones/wrangler.produccion-cursos.jsonc',
  },
  ensayo: {
    principal: 'config/cloudflare/instalaciones/wrangler.ensayo.jsonc',
    cursos: 'config/cloudflare/instalaciones/wrangler.ensayo-cursos.jsonc',
  },
};
/** Qué entrega admite cada entorno: producción solo los bytes oficiales; el ensayo, también la entrada privada. */
export const DESTINOS: Readonly<Record<Entorno, readonly string[]>> = {
  produccion: ['oficial'],
  ensayo: ['privado', 'oficial'],
};
const CLASE = 'AccesoPublicoDurable';
const NOMBRE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ETIQUETA = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const CLASE_JS = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const OPERACIONES: ReadonlySet<string> = new Set(['new_sqlite_classes', 'renamed_classes', 'transferred_classes']);
const CANALES_APAGADOS = ['FARO_MCP:no', 'FARO_A2A:no', 'FARO_API_SOCIOS:no'];
const COMUNES = {
  compatibility_date: '2026-10-01',
  compatibility_flags: ['global_fetch_strictly_public'],
  preview_urls: false,
  send_metrics: false,
  observability: { enabled: false },
  rules: [{ type: 'Data', globs: ['**/datos/*.json'], fallthrough: true }],
};
/** Campos del producto: iguales en cualquier instalación; la entidad solo elige nombres, migraciones y dominio. */
const FIJOS: Readonly<Record<Servicio, Configuracion>> = {
  principal: {
    ...COMUNES,
    main: '../../../dist/worker/worker.mjs',
    base_dir: '../../../dist/worker',
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    assets: {
      directory: '../../../dist/web',
      binding: 'ASSETS',
      run_worker_first: true,
      html_handling: 'none',
      not_found_handling: 'none',
    },
    durable_objects: { bindings: [{ name: 'REGISTRO_SOCIOS', class_name: CLASE }] },
  },
  cursos: { ...COMUNES, main: '../../../dist/worker-cursos/worker.mjs', base_dir: '../../../dist/worker-cursos' },
};

function objeto(valor: unknown, mensaje: string): asserts valor is Record<string, unknown> {
  assert.ok(typeof valor === 'object' && valor !== null && !Array.isArray(valor), mensaje);
}
function claves(valor: Record<string, unknown>, esperadas: readonly string[], mensaje: string): void {
  assert.deepEqual(Object.keys(valor).sort(), [...esperadas].sort(), mensaje);
}
function nombre(valor: unknown, mensaje: string): string {
  assert.ok(typeof valor === 'string' && NOMBRE.test(valor), mensaje);
  return valor;
}

/** Un dominio propio en minúsculas, sin comodines, puertos ni rutas; nunca el subdominio workers.dev. */
function comprobarDominio(valor: unknown, archivo: string): void {
  const mensaje = `${archivo}: routes admite exactamente un dominio propio con custom_domain`;
  assert.ok(Array.isArray(valor) && valor.length === 1, mensaje);
  const ruta: unknown = valor[0];
  objeto(ruta, mensaje);
  claves(ruta, ['pattern', 'custom_domain'], mensaje);
  assert.equal(ruta.custom_domain, true, mensaje);
  const dominio = ruta.pattern;
  assert.ok(typeof dominio === 'string' && dominio.includes('.'), mensaje);
  assert.ok(
    dominio.split('.').every((parte) => NOMBRE.test(parte)),
    mensaje,
  );
  assert.ok(!dominio.endsWith('.workers.dev'), `${archivo}: producción no se sirve en workers.dev`);
}

function clasesDe(valor: unknown, etiqueta: string): string[] {
  const mensaje = `migración ${etiqueta}: se esperaba una lista de clases`;
  assert.ok(Array.isArray(valor) && valor.length > 0, mensaje);
  assert.ok(
    valor.every((clase) => typeof clase === 'string' && CLASE_JS.test(clase)),
    mensaje,
  );
  return valor as string[];
}
function pares(valor: unknown, campos: readonly string[], etiqueta: string): Record<string, string>[] {
  const mensaje = `migración ${etiqueta}: se esperaban objetos con ${campos.join(', ')}`;
  assert.ok(Array.isArray(valor) && valor.length > 0, mensaje);
  for (const par of valor) {
    objeto(par, mensaje);
    claves(par, campos, mensaje);
    assert.ok(
      campos.every((campo) => typeof par[campo] === 'string'),
      mensaje,
    );
  }
  return valor as Record<string, string>[];
}

/** Aplica una operación al conjunto de clases; crear una clase que ya existe impide transferir después sus datos. */
function aplicar(
  clases: Set<string>,
  migracion: {
    readonly operacion: string;
    readonly valor: unknown;
    readonly worker: string;
    readonly etiqueta: string;
  },
): void {
  const { operacion, valor, worker, etiqueta } = migracion;
  const nueva = (clase: string) => {
    assert.ok(!clases.has(clase), `migración ${etiqueta}: la clase ${clase} ya existe en este Worker`);
    clases.add(clase);
  };
  if (operacion === 'new_sqlite_classes') {
    clasesDe(valor, etiqueta).forEach(nueva);
  } else if (operacion === 'renamed_classes') {
    for (const { from, to } of pares(valor, ['from', 'to'], etiqueta)) {
      assert.ok(clases.delete(from as string), `migración ${etiqueta}: no existe la clase ${from}`);
      nueva(to as string);
    }
  } else {
    for (const par of pares(valor, ['from', 'from_script', 'to'], etiqueta)) {
      nombre(par.from_script, `migración ${etiqueta}: Worker de origen inválido`);
      assert.notEqual(par.from_script, worker, `migración ${etiqueta}: un Worker no se transfiere a sí mismo`);
      nueva(par.to as string);
    }
  }
}

/** Etiqueta única y una sola operación admitida de una migración; las clases las comprueba quien la aplica. */
function entradaDeMigracion(entrada: unknown, previas: readonly string[], contexto: string) {
  objeto(entrada, `${contexto}: cada migración es un objeto`);
  const etiqueta = entrada.tag;
  assert.ok(typeof etiqueta === 'string' && ETIQUETA.test(etiqueta), `${contexto}: etiqueta ausente o inválida`);
  assert.ok(!previas.includes(etiqueta), `${contexto}: etiqueta repetida ${etiqueta}`);
  const operaciones = Object.keys(entrada).filter((clave) => clave !== 'tag');
  const [operacion = ''] = operaciones;
  assert.ok(
    operaciones.length === 1 && OPERACIONES.has(operacion),
    `${contexto}: migración ${etiqueta}: solo se admite una operación de crear clases SQLite, renombrarlas o transferirlas`,
  );
  return { etiqueta, operacion, contenido: entrada[operacion] };
}

/**
 * Historial de migraciones Durable Object con una operación por etiqueta. Admite crear clases SQLite, renombrarlas
 * y transferirlas desde otro Worker; nunca borrarlas ni crearlas sin SQLite. Debe terminar con la clase del producto.
 */
export function comprobarMigraciones(valor: unknown, worker: string): string[] {
  assert.ok(Array.isArray(valor) && valor.length > 0, 'migrations: se exige el historial de migraciones');
  const clases = new Set<string>();
  const etiquetas: string[] = [];
  for (const entrada of valor) {
    const { etiqueta, operacion, contenido } = entradaDeMigracion(entrada, etiquetas, 'migrations');
    aplicar(clases, { operacion, valor: contenido, worker, etiqueta });
    etiquetas.push(etiqueta);
  }
  assert.deepEqual([...clases], [CLASE], `migrations: el historial debe terminar exactamente con ${CLASE}`);
  return etiquetas;
}

/** Comprueba un archivo: los campos del producto, intactos; los de la entidad, con forma y papel de su entorno. */
export function comprobarServicio(valor: unknown, entorno: Entorno, servicio: Servicio): Configuracion {
  const archivo = ARCHIVOS[entorno][servicio];
  objeto(valor, `${archivo}: se esperaba un objeto`);
  const propios = ['name', 'workers_dev'];
  if (servicio === 'principal') {
    propios.push('migrations', 'services', ...(entorno === 'produccion' ? ['routes'] : []));
  }
  claves(valor, [...Object.keys(FIJOS[servicio]), ...propios], `${archivo}: campos no admitidos o ausentes`);
  for (const [campo, esperado] of Object.entries(FIJOS[servicio])) {
    assert.deepStrictEqual(valor[campo], esperado, `${archivo}: ${campo} difiere del producto`);
  }
  nombre(valor.name, `${archivo}: nombre de Worker inválido`);
  const publico = entorno === 'ensayo' && servicio === 'principal';
  assert.equal(valor.workers_dev, publico, `${archivo}: workers_dev debe ser ${publico}`);
  if (servicio === 'principal') {
    const servicios = valor.services;
    assert.ok(Array.isArray(servicios) && servicios.length === 1, `${archivo}: se exige solo el servicio CURSOS`);
    objeto(servicios[0], `${archivo}: servicio inválido`);
    claves(servicios[0], ['binding', 'service'], `${archivo}: servicio inválido`);
    assert.equal(servicios[0].binding, 'CURSOS', `${archivo}: se exige solo el servicio CURSOS`);
    nombre(servicios[0].service, `${archivo}: Worker de Cursos inválido`);
    comprobarMigraciones(valor.migrations, valor.name as string);
  }
  if (servicio === 'principal' && entorno === 'produccion') {
    comprobarDominio(valor.routes, archivo);
  }
  return valor;
}

function transferidos(config: Configuracion): string[] {
  return (config.migrations as Record<string, unknown>[]).flatMap((entrada) =>
    Array.isArray(entrada.transferred_classes)
      ? (entrada.transferred_classes as Record<string, string>[]).map((par) => par.from_script as string)
      : [],
  );
}
function etiquetas(config: Configuracion): string[] {
  return (config.migrations as Record<string, unknown>[]).map((entrada) => entrada.tag as string);
}

/** Lee y comprueba los dos archivos de un entorno; el principal llama a su propio Worker de Cursos. */
export function leerEntorno(raiz: string, entorno: Entorno): PerfilEntorno {
  const leer = (servicio: Servicio) => {
    const archivo = ARCHIVOS[entorno][servicio];
    let valor: unknown;
    try {
      valor = JSON.parse(readFileSync(join(raiz, archivo), 'utf8'));
    } catch {
      throw new Error(`${archivo}: ausente o no es JSON sin comentarios`);
    }
    return comprobarServicio(valor, entorno, servicio);
  };
  const perfil = { principal: leer('principal'), cursos: leer('cursos') };
  assert.ok(
    cursosDelPrincipal(perfil.principal, perfil.cursos),
    `${ARCHIVOS[entorno].principal}: CURSOS debe ser su Worker de Cursos`,
  );
  return perfil;
}

/** Producción y ensayo no comparten Worker, migración ni datos transferidos. */
export function comprobarSeparacion(perfil: Perfil): void {
  const produccion = [perfil.produccion.principal.name, perfil.produccion.cursos.name] as string[];
  const ensayo = [perfil.ensayo.principal.name, perfil.ensayo.cursos.name] as string[];
  const todos = [...produccion, ...ensayo];
  assert.equal(new Set(todos).size, todos.length, 'Producción y ensayo deben usar cuatro Workers distintos');
  const comunes = etiquetas(perfil.produccion.principal).filter((t) => etiquetas(perfil.ensayo.principal).includes(t));
  assert.deepEqual(comunes, [], 'Producción y ensayo no comparten etiquetas de migración');
  assert.ok(
    transferidos(perfil.ensayo.principal).every((origen) => !produccion.includes(origen)),
    'El ensayo no puede transferir datos de producción',
  );
  assert.ok(
    transferidos(perfil.produccion.principal).every((origen) => !ensayo.includes(origen)),
    'Producción no puede adoptar datos del ensayo',
  );
}

export function leerPerfil(raiz: string): Perfil {
  const perfil = { produccion: leerEntorno(raiz, 'produccion'), ensayo: leerEntorno(raiz, 'ensayo') };
  comprobarSeparacion(perfil);
  return perfil;
}

/** Registro del estado remoto ya verificado por la entidad; no contiene credenciales y no consulta la cuenta. */
export function leerRegistroInstalacion(valor: unknown): RegistroInstalacion {
  const mensaje = 'Registro de instalación inválido';
  objeto(valor, mensaje);
  claves(valor, ['version', 'entorno', 'tipo', 'worker', 'cursos', 'origen', 'migraciones_aplicadas'], mensaje);
  assert.equal(valor.version, 1, mensaje);
  assert.ok(valor.entorno === 'produccion' || valor.entorno === 'ensayo', `${mensaje}: entorno`);
  assert.ok(valor.tipo === 'nueva' || valor.tipo === 'existente', `${mensaje}: tipo nueva o existente`);
  const worker = nombre(valor.worker, `${mensaje}: worker`);
  nombre(valor.cursos, `${mensaje}: cursos`);
  const { origen } = valor;
  if (valor.entorno === 'ensayo') {
    assert.ok(
      typeof origen === 'string' && esOrigenWorkersDev(origen, worker),
      `${mensaje}: el origen de ensayo es https://${worker}.<subdominio de la cuenta>.workers.dev`,
    );
  } else {
    assert.ok(
      typeof origen === 'string' &&
        URL.canParse(origen) &&
        new URL(origen).origin === origen &&
        origen.startsWith('https://') &&
        !origen.endsWith('.workers.dev'),
      `${mensaje}: el origen de producción es https:// y su dominio propio, sin ruta ni workers.dev`,
    );
  }
  const aplicadas = valor.migraciones_aplicadas;
  assert.ok(Array.isArray(aplicadas), `${mensaje}: migraciones_aplicadas debe ser una lista`);
  const etiquetasAplicadas: string[] = [];
  for (const entrada of aplicadas) {
    etiquetasAplicadas.push(
      entradaDeMigracion(entrada, etiquetasAplicadas, `${mensaje}: migraciones_aplicadas`).etiqueta,
    );
  }
  assert.equal(
    aplicadas.length === 0,
    valor.tipo === 'nueva',
    `${mensaje}: una instalación nueva no tiene migraciones aplicadas y una existente sí`,
  );
  return valor as unknown as RegistroInstalacion;
}

/** La instalación declarada es la de este entorno, con sus Workers y su origen; devuelve ese origen exacto. */
export function origenDeInstalacion(perfil: PerfilEntorno, registro: RegistroInstalacion, entorno: Entorno): string {
  assert.equal(registro.entorno, entorno, 'El registro de instalación corresponde a otro entorno');
  assert.ok(
    registro.worker === perfil.principal.name && registro.cursos === perfil.cursos.name,
    'El registro de instalación corresponde a otros Workers: cambiar un nombre crea otro Worker y otro almacén',
  );
  if (entorno === 'produccion') {
    const [ruta] = perfil.principal.routes as readonly Record<string, unknown>[];
    assert.equal(
      registro.origen,
      `https://${ruta?.pattern}`,
      'El registro de instalación declara otro dominio que la configuración de producción',
    );
  } else {
    assert.ok(
      esOrigenWorkersDev(registro.origen, perfil.principal.name as string),
      'El origen del registro de ensayo no es el workers.dev de su Worker',
    );
  }
  return registro.origen;
}

/**
 * Destino de una prueba remota: perfil completo y separado de producción, registro de la instalación de ensayo y,
 * dentro de él, el origen exacto con el subdominio de la cuenta. Cualquier otro origen se rechaza. El registro lo
 * declara quien opera: esto comprueba coherencia local, no la identidad remota de la cuenta.
 */
export function origenDeEnsayoAutorizado(raiz: string, instalacion: unknown, origen: string): URL {
  const autorizado = origenDeInstalacion(leerPerfil(raiz).ensayo, leerRegistroInstalacion(instalacion), 'ensayo');
  return validarOrigenEnsayo(origen, autorizado);
}

/**
 * Compara la configuración con lo ya aplicado en la cuenta. El historial aplicado no se reescribe y una publicación
 * aplica como mucho una migración nueva. Devuelve su etiqueta, o null si no hay ninguna pendiente.
 */
export function migracionPendiente(
  perfil: PerfilEntorno,
  registro: RegistroInstalacion,
  entorno: Entorno,
): string | null {
  origenDeInstalacion(perfil, registro, entorno);
  const configuradas = perfil.principal.migrations as readonly Record<string, unknown>[];
  const aplicadas = registro.migraciones_aplicadas;
  assert.deepStrictEqual(
    configuradas.slice(0, aplicadas.length),
    [...aplicadas],
    'La configuración no conserva el historial de migraciones aplicado: etiquetas y operaciones deben coincidir',
  );
  const pendientes = configuradas.slice(aplicadas.length).map((entrada) => entrada.tag as string);
  assert.ok(pendientes.length <= 1, 'Cada publicación aplica como mucho una migración nueva');
  return pendientes[0] ?? null;
}

/** Comprueba todos los bytes de la entrega, su destino y, si se indica, que contiene el Worker del servicio. */
export function comprobarEntrega(directorio: string, sha256: string, entorno: Entorno, servicio?: Servicio) {
  const resumen = comprobarArtefactoCloudflare(directorio, sha256);
  const { destino, archivos } = leerDescriptorArtefactoCloudflare(join(directorio, 'artefacto.json'), sha256);
  assert.ok(
    destino !== undefined && DESTINOS[entorno].includes(destino),
    `La entrega ${destino ?? 'sin destino'} no se admite en ${entorno}`,
  );
  if (servicio !== undefined) {
    const entrada = `${servicio === 'principal' ? 'worker' : 'worker-cursos'}/worker.mjs`;
    assert.ok(
      archivos.some((archivo) => archivo.ruta === entrada),
      `La entrega no contiene ${entrada}`,
    );
  }
  return { ...resumen, destino };
}

/** Copia para Wrangler: sin rutas (el dominio se gestiona aparte) y con rutas absolutas a la entrega comprobada. */
export function configuracionParaWrangler(config: Configuracion, servicio: Servicio, entrega: string): Configuracion {
  const { routes: _rutas, ...resto } = config;
  const carpeta = servicio === 'principal' ? 'worker' : 'worker-cursos';
  const copia: Configuracion = {
    ...resto,
    main: join(entrega, carpeta, 'worker.mjs'),
    base_dir: join(entrega, carpeta),
  };
  if (servicio === 'principal') {
    copia.assets = { ...(resto.assets as Configuracion), directory: join(entrega, 'web') };
  }
  return copia;
}

/**
 * Variables que fija cada despliegue. Los canales externos salen siempre apagados (el panel conserva su política);
 * producción conserva sus variables de administración; el ensayo solo la habilita con parámetros de Access válidos
 * y con el origen exacto de su instalación autorizada.
 */
export function variablesDeDespliegue(
  entorno: Entorno,
  servicio: Servicio,
  destino: string,
  contexto: { readonly origen?: string | undefined; readonly acceso?: unknown },
): string[] {
  if (servicio === 'cursos') {
    assert.equal(contexto.acceso, undefined, 'Los parámetros de Access solo corresponden al Worker principal');
    return [];
  }
  if (entorno === 'produccion') {
    assert.equal(contexto.acceso, undefined, 'Producción conserva su Access; no recibe parámetros de ensayo');
    return [...CANALES_APAGADOS];
  }
  const interruptor = destino === 'privado' ? 'FARO_PRUEBAS_ADMINISTRACION' : 'FARO_ADMINISTRACION';
  if (contexto.acceso === undefined) {
    return [`${interruptor}:no`, ...CANALES_APAGADOS];
  }
  assert.ok(
    contexto.origen !== undefined,
    'El panel de ensayo exige --instalacion: su origen se compara con el de la instalación autorizada',
  );
  const acceso = leerAccesoEnsayo(contexto.acceso, contexto.origen);
  return [
    `${interruptor}:si`,
    `FARO_ADMIN_ACCESS_EQUIPO:${acceso.equipo}`,
    `FARO_ADMIN_ACCESS_AUD:${acceso.audiencia}`,
    `FARO_ADMIN_ORIGEN:${acceso.origen}`,
    ...CANALES_APAGADOS,
  ];
}
