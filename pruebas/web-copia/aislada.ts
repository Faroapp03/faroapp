// Instalación mínima para el constructor real. Las fuentes enlazadas solo se leen; las salidas tienen casa propia.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { servicioConValores, VALORES_NEUTROS } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { fuentesQueImporta } from '../ayudas/fuentes-que-importa.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
/** La página pública de la entrada de prueba; su huella en el CATALOGO es la de estos bytes. */
const P_HTML = '<p>Público</p>';
const PLAZO_MS = 20_000;
/** Los módulos que usan los programas de las pruebas; se copian con todo lo que importan (fuentesQueImporta). */
const ENTRADAS = [
  'herramientas/web/preparar.ts',
  'herramientas/web/copia-sin-conexion.ts',
  'herramientas/web/version-copia.ts',
  'herramientas/web/publicados.ts',
  'herramientas/web/politica-cache.ts',
  'herramientas/web/comunes.ts',
  'herramientas/web/datos-globales.ts',
];
/** Los módulos del service worker, que la construcción (herramientas/web/servicio) lee como texto. */
const MODULOS_DEL_SERVICIO = readdirSync(join(RAIZ, 'src/service-worker'))
  .filter((nombre) => nombre.endsWith('.js'))
  .map((nombre) => `src/service-worker/${nombre}`);
/**
 * Lo que las herramientas leen como texto al ejecutarse, y se copia sin recorrer sus importaciones: la configuración
 * del formateador, los hechos del informe, el contacto público, las fuentes con que politica-cache.ts escribe la
 * política clásica y los módulos del service worker.
 */
const DATOS = [
  ...MODULOS_DEL_SERVICIO,
  'biome.json',
  'plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json',
  'plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/fuente.json',
  'compartido/contacto-publico.js',
  'src/plataforma/politica-cache-web.ts',
  'src/administracion/secciones-web.js',
  'web/scripts/secciones-publicas.js',
];
/** Lo que la instalación enlaza a la de origen, en lugar de copiarlo. */
const ENLAZADOS = ['node_modules', 'src/datos-globales/datos.ts', 'src/plataforma/node/paquete-publicado.ts'];
/**
 * El contexto con que los programas preparan y comprueban la web de la instalación: su web/, su paquete y el motor que
 * declara la entrada en motor/, por rutas `motor/…`; la huella del mapa es fija. En la construcción, el motor es la
 * captura del empaquetado (construir.ts).
 */
const CONTEXTO_DE_PRUEBA = `import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { WEB } from './publicados.ts';
export const HUELLA = "'sha256-prueba'";
export function contexto() {
  const carpeta = join(WEB, 'motor');
  const archivos = existsSync(carpeta) ? readdirSync(carpeta, { recursive: true, withFileTypes: true }) : [];
  const motor = new Map(
    archivos
      .filter((entrada) => entrada.isFile())
      .map((entrada) => join(entrada.parentPath, entrada.name))
      .map((ruta) => ['motor/' + relative(carpeta, ruta).split(sep).join('/'), readFileSync(ruta)]),
  );
  return { web: WEB, paquete: RUTAS.paquete, motor };
}
`;
/** El registro de extensiones: la instalación escribe el suyo, vacío, y no se recorre el real. */
const REGISTRO = 'src/plataforma/extensiones-instaladas.ts';

/** El service worker real con un catálogo mínimo, el de p.html, y la VERSION y el paquete vacíos. */
const SERVICIO_DE_PRUEBA = await servicioConValores({
  ...VALORES_NEUTROS,
  CATALOGO: [['p.html', createHash('sha256').update(P_HTML).digest('hex'), 'instalar']],
});

/** El service worker real más una entrada mínima: es un fixture del constructor, no una web de aplicación. */
export function entradaDePrueba(): Record<string, string> {
  return { 'p.html': P_HTML, 'service-worker.js': SERVICIO_DE_PRUEBA };
}

function preparar(raiz: string, archivos: Readonly<Record<string, string>>): void {
  const fuentes = fuentesQueImporta(RAIZ, ENTRADAS, new Set([...ENLAZADOS, REGISTRO]));
  for (const archivo of [...new Set([...fuentes, ...DATOS])]) {
    mkdirSync(dirname(join(raiz, archivo)), { recursive: true });
    copyFileSync(join(RAIZ, archivo), join(raiz, archivo));
  }
  for (const archivo of ENLAZADOS) {
    mkdirSync(dirname(join(raiz, archivo)), { recursive: true });
    symlinkSync(join(RAIZ, archivo), join(raiz, archivo));
  }
  mkdirSync(join(raiz, 'datos'));
  writeFileSync(join(raiz, 'datos/manifiesto.json'), '{}');
  writeFileSync(join(raiz, 'package.json'), '{"type":"module"}');
  // La web de esta instalación no lleva extensiones: su registro queda vacío.
  writeFileSync(join(raiz, REGISTRO), '');
  writeFileSync(join(raiz, 'herramientas/web/contexto-de-prueba.ts'), CONTEXTO_DE_PRUEBA);
  writeFileSync(
    join(raiz, 'tsconfig.navegador.json'),
    JSON.stringify({ extends: join(RAIZ, 'tsconfig.navegador.json') }),
  );
  for (const [archivo, texto] of Object.entries(archivos)) {
    mkdirSync(dirname(join(raiz, 'web', archivo)), { recursive: true });
    writeFileSync(join(raiz, 'web', archivo), texto);
  }
}

/** Ejecuta el código sobre P aislado desde cwd ajeno y ruta con espacios/Unicode. */
export function copiaAislada(archivos: Readonly<Record<string, string>>, programa: string): string {
  const raiz = mkdtempSync(join(tmpdir(), 'Mis documentos Año 2026-copia-'));
  try {
    preparar(raiz, archivos);
    const entrada = join(raiz, 'herramientas/web/fixture.ts');
    writeFileSync(entrada, programa);
    return execFileSync(process.execPath, [entrada], { cwd: tmpdir(), encoding: 'utf8', timeout: PLAZO_MS });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}
