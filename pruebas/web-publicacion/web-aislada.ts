// Copia únicamente el lector y sus dependencias reales; la web temporal es un fixture, nunca una entrega.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuentesQueImporta } from '../ayudas/fuentes-que-importa.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PLAZO_MS = 10_000;
/** Los módulos que usan los programas de las pruebas; se copian con todo lo que importan (fuentesQueImporta). */
const ENTRADAS = [
  'herramientas/web/contexto.ts',
  'herramientas/web/referencias.ts',
  'herramientas/web/politica-cache.ts',
  'herramientas/web/publicados.ts',
  'herramientas/web/etiquetas.ts',
  'src/plataforma/cabeceras-web.ts',
];
/**
 * Lo que las herramientas leen como texto al ejecutarse, y se copia sin recorrer sus importaciones: la configuración
 * del formateador y las fuentes con que politica-cache.ts escribe la política clásica. La de la web es además parte
 * de la web de la instalación, que cada prueba escribe a su medida.
 */
const DATOS = [
  'biome.json',
  'src/plataforma/politica-cache-web.ts',
  'src/administracion/secciones-web.js',
  'web/scripts/secciones-publicas.js',
];
/** El registro de extensiones: la instalación escribe el suyo, vacío, y no se recorre el real. */
const REGISTRO = 'src/plataforma/extensiones-instaladas.ts';

/** Copia en la instalación unas rutas del repositorio, con sus carpetas. */
function copiar(raiz: string, rutas: readonly string[]): void {
  for (const ruta of rutas) {
    mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
    copyFileSync(join(RAIZ, ruta), join(raiz, ruta));
  }
}

/**
 * Ejecuta los lectores en una instalación aislada y desde un cwd ajeno, con espacios y Unicode, sin compilar el motor;
 * el verificador de la política usa el formateador instalado.
 */
export function webAislada(archivos: Readonly<Record<string, string>>, programa: string): string {
  const raiz = mkdtempSync(join(tmpdir(), 'Mis documentos Año 2026-publicacion-'));
  try {
    copiar(raiz, [...fuentesQueImporta(RAIZ, ENTRADAS, new Set([REGISTRO])), ...DATOS]);
    symlinkSync(join(RAIZ, 'node_modules'), join(raiz, 'node_modules'));
    writeFileSync(join(raiz, 'package.json'), '{"type":"module"}\n');
    // La web de esta instalación no lleva extensiones: su registro queda vacío.
    mkdirSync(dirname(join(raiz, REGISTRO)), { recursive: true });
    writeFileSync(join(raiz, REGISTRO), '');
    for (const [archivo, contenido] of Object.entries(archivos)) {
      const destino = join(raiz, 'web', archivo);
      mkdirSync(dirname(destino), { recursive: true });
      writeFileSync(destino, contenido);
    }
    const entrada = join(raiz, 'herramientas/web/fixture.ts');
    writeFileSync(entrada, programa);
    return execFileSync(process.execPath, [entrada], { cwd: tmpdir(), encoding: 'utf8', timeout: PLAZO_MS });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}
