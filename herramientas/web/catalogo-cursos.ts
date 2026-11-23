/** Construcción del lector público: fuente TS estricta, paquete construido fuera de los scripts manuscritos. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { ejecutar, orden } from '../comun/opciones.ts';

const RAIZ = new URL('../../', import.meta.url);
/** La fuente del lector: la web local la publica construida aparte; la construcción la empaqueta con las páginas. */
export const FUENTE_DEL_LECTOR = 'src/catalogo-cursos/publico.ts';
export const LECTOR_PUBLICADO = 'web/recursos/catalogo-cursos/lector.js';
export const PUBLICACIONES_CATALOGO = {
  lector: LECTOR_PUBLICADO,
  tipos: 'web/recursos/catalogo-cursos/lector.d.ts',
  huella: 'web/recursos/catalogo-cursos/lector.json',
} as const;
const AVISO =
  '// Generado desde src/catalogo-cursos/publico.ts. No editar; usar herramientas/web/catalogo-cursos.ts.\n';

export function artefactosCatalogo(raiz: URL = RAIZ): ReadonlyMap<URL, string> {
  const entrada = new URL(FUENTE_DEL_LECTOR, raiz);
  const resultado = buildSync({
    absWorkingDir: fileURLToPath(raiz),
    entryPoints: [fileURLToPath(entrada)],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2024',
    legalComments: 'inline',
  });
  const [salida] = resultado.outputFiles;
  if (!salida || resultado.outputFiles.length !== 1) {
    throw new Error('El lector debe producir un solo paquete construido');
  }
  const texto = AVISO + salida.text;
  const huella = createHash('sha256').update(texto).digest('hex');
  const tipos = `${AVISO}export * from '../../../src/catalogo-cursos/publico.ts';\n`;
  return new Map([
    [new URL(LECTOR_PUBLICADO, raiz), texto],
    [new URL(PUBLICACIONES_CATALOGO.tipos, raiz), tipos],
    [
      new URL(PUBLICACIONES_CATALOGO.huella, raiz),
      `{ "version": 1, "sha256": "${huella}", "bytes": ${Buffer.byteLength(texto)} }\n`,
    ],
  ]);
}
function principal(): void {
  const { values } = orden('node herramientas/web/catalogo-cursos.ts [--comprobar]').leer({
    options: { comprobar: { type: 'boolean' } },
  });
  for (const [ruta, texto] of artefactosCatalogo()) {
    if (values.comprobar) {
      if (readFileSync(ruta, 'utf8') !== texto) {
        throw new Error(`Lector de Cursos desactualizado: ${ruta.pathname}`);
      }
    } else {
      mkdirSync(dirname(fileURLToPath(ruta)), { recursive: true });
      writeFileSync(ruta, texto);
    }
  }
}
if (import.meta.main) {
  await ejecutar(principal, 'Lector de Cursos');
}
