/** Adaptador Node 24: archivo privado fuera de la web; ninguna ruta depende del cwd del proceso. */
import { chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { AlmacenAccesos } from '../../administracion/accesos.ts';
import type { AlmacenActivacion } from '../../administracion/activacion.ts';
import type { AlmacenInstituciones } from '../../administracion/instituciones.ts';
import type { AlmacenTrabajosProgramados } from '../../administracion/programacion-trabajos.ts';
import type { AlmacenSeccionesPanel } from '../../administracion/secciones-almacen.ts';
import type { AlmacenTrabajosActualizacion } from '../../administracion/trabajos.ts';
import { accesosDiferidos, institucionesDiferidas } from './capacidades-diferidas.ts';
import { crearMantenimientoAccesosNode } from './mantenimiento-node.ts';
import { leerSeccionesConAutoridad } from './secciones-autoridad-sqlite.ts';
import { AlmacenSesionVigilanteSqlite } from './sesion-vigilante-sqlite.ts';
import { AlmacenPublicoSqlite, type OpcionesAlmacenPublico, type SqlAccesoPublico } from './sqlite.ts';

const MODO_DIRECTORIO = 0o700;
const MODO_ARCHIVO = 0o600;

export interface OpcionesAlmacenPublicoNode extends OpcionesAlmacenPublico {
  readonly archivo: string;
}
/** Examina todos los componentes existentes: no se admiten enlaces, ni siquiera en directorios ascendentes. */
function sinEnlaces(ruta: string): void {
  let parte = ruta;
  for (;;) {
    const estado = lstatSync(parte, { throwIfNoEntry: false });
    if (estado?.isSymbolicLink()) {
      throw new Error('La ruta del almacén público contiene un enlace');
    }
    const padre = dirname(parte);
    if (padre === parte) {
      return;
    }
    parte = padre;
  }
}

function comprobarAuxiliares(archivo: string): void {
  for (const sufijo of ['-journal', '-wal', '-shm']) {
    const auxiliar = `${archivo}${sufijo}`;
    let estado = lstatSync(auxiliar, { throwIfNoEntry: false });
    if (estado?.isFile() && estado.nlink === 0) {
      // SQLite puede retirar el journal durante lstat. Una lectura adicional debe confirmar una ruta segura.
      estado = lstatSync(auxiliar, { throwIfNoEntry: false });
    }
    if (estado && (!estado.isFile() || estado.nlink !== 1)) {
      throw new Error('Archivo auxiliar del almacén público no válido');
    }
  }
}

function prepararArchivo(ruta: string): { archivo: string; descriptor: number } {
  if (!isAbsolute(ruta)) {
    throw new Error('El almacén público necesita una ruta absoluta');
  }
  const archivo = resolve(ruta);
  const web = fileURLToPath(new URL('../../../web/', import.meta.url));
  const desdeWeb = relative(web, archivo);
  if (desdeWeb === '' || (!desdeWeb.startsWith(`..${sep}`) && desdeWeb !== '..' && !isAbsolute(desdeWeb))) {
    throw new Error('El almacén público debe estar fuera de la web');
  }
  sinEnlaces(archivo);
  const directorio = dirname(archivo);
  mkdirSync(directorio, { recursive: true, mode: MODO_DIRECTORIO });
  sinEnlaces(archivo);
  if (!lstatSync(directorio).isDirectory()) {
    throw new Error('Directorio del almacén público no válido');
  }
  chmodSync(directorio, MODO_DIRECTORIO);
  comprobarAuxiliares(archivo);
  // O_NOFOLLOW cierra también la carrera entre lstat y open para el propio archivo.
  const descriptor = openSync(archivo, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, MODO_ARCHIVO);
  return { archivo, descriptor };
}

/** Una reversión fallida conserva también la causa original, sin presentar la transacción como confirmada. */
function ejecutarTransaccion<T>(db: DatabaseSync, accion: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = accion();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (reversion) {
      throw new AggregateError([error, reversion], 'La transacción y su reversión han fallado', { cause: error });
    }
    throw error;
  }
}

/** El cierre es solo para el ciclo de vida del servidor y las pruebas; jamás se expone por HTTP. */
export function crearAlmacenPublicoNode(opciones: OpcionesAlmacenPublicoNode): AlmacenPublicoSqlite & {
  readonly sesion: AlmacenSesionVigilanteSqlite;
  readonly instituciones: AlmacenInstituciones;
  readonly accesos: AlmacenAccesos;
  readonly secciones: AlmacenSeccionesPanel;
  readonly leerSeccionesConAutoridad: () => ReturnType<typeof leerSeccionesConAutoridad>;
  readonly trabajos: AlmacenTrabajosActualizacion & AlmacenTrabajosProgramados;
  readonly activacion: AlmacenActivacion;
  close(): void;
} {
  const { sql, close } = abrirSqlAdministrativoNode(opciones.archivo);
  try {
    const almacen = new AlmacenPublicoSqlite(sql, opciones);
    const sesion = new AlmacenSesionVigilanteSqlite(sql, { ahora: opciones.ahora ?? Date.now });
    const instituciones = institucionesDiferidas(sesion);
    const mantenimiento = crearMantenimientoAccesosNode(
      sesion,
      () => sesion.siguienteVencimientoAccesos(),
      opciones.ahora ?? Date.now,
    );
    // Reanuda solo una capacidad ya persistida: no prepara tablas ni adopta registros al arrancar.
    if (Object.hasOwn(sql.filas('SELECT * FROM publico_estado WHERE id=1')[0] ?? {}, 'accesos_version')) {
      mantenimiento.reanudar();
    }
    const accesos = accesosDiferidos(mantenimiento.accesos, () => instituciones.prepararInstituciones());
    return Object.assign(almacen, {
      sesion,
      secciones: sesion,
      leerSeccionesConAutoridad: () => leerSeccionesConAutoridad(sql),
      instituciones,
      accesos,
      trabajos: sesion,
      activacion: sesion,
      close: () => {
        mantenimiento.cerrar();
        close();
      },
    });
  } catch (error) {
    close();
    throw error;
  }
}

/** Apertura segura común sin inicializar tablas ni preparar capacidades administrativas. */
export function abrirSqlAdministrativoNode(ruta: string): { readonly sql: SqlAccesoPublico; close(): void } {
  const { archivo, descriptor } = prepararArchivo(ruta);
  let base: DatabaseSync | undefined;
  try {
    const identidad = fstatSync(descriptor);
    if (!identidad.isFile() || identidad.nlink !== 1) {
      throw new Error('Archivo del almacén público no válido');
    }
    fchmodSync(descriptor, MODO_ARCHIVO);
    base = new DatabaseSync(archivo, { timeout: 1000, allowExtension: false, enableDoubleQuotedStringLiterals: false });
    const posterior = lstatSync(archivo);
    if (posterior.isSymbolicLink() || posterior.ino !== identidad.ino || posterior.dev !== identidad.dev) {
      throw new Error('La ruta del almacén público cambió al abrir');
    }
    const db = base;
    db.exec('PRAGMA journal_mode=DELETE');
    db.exec('PRAGMA synchronous=FULL');
    const sql: SqlAccesoPublico = {
      filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
      ejecutar: (sentencia, ...valores) => {
        db.prepare(sentencia).run(...valores);
      },
      transaccion: <T>(accion: () => T): T => ejecutarTransaccion(db, accion),
    };
    return { sql, close: () => db.close() };
  } catch (error) {
    base?.close();
    throw error;
  } finally {
    closeSync(descriptor);
  }
}
