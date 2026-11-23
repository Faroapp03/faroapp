/**
 * Calcula, comprueba o regenera las huellas CSP de la portada pública desde su HTML final y la huella de la fotografía
 * que comparte con el acceso desde su archivo de la web, sin publicar.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type ActivoPublico, FOTOGRAFIA_PORTADA } from '../../src/plataforma/cloudflare/activos-publicos.ts';
import { PORTADA_PUBLICA } from '../../src/plataforma/cloudflare/portada-publica.ts';
import { ejecutar, orden } from '../comun/opciones.ts';

const ARCHIVO = new URL('../../src/plataforma/cloudflare/portada-publica.ts', import.meta.url);
const ARCHIVO_DE_ACTIVOS = new URL('../../src/plataforma/cloudflare/activos-publicos.ts', import.meta.url);
const WEB = new URL('../../web/', import.meta.url);
const USO = 'node herramientas/cloudflare/actualizar-portada.ts [--comprobar]';

/** Huellas CSP por nombre de la constante exportada que las declara. */
export type HuellasCsp = Readonly<Record<string, string>>;

/** Huella CSP de un texto en línea, en el formato que admite la directiva. */
export function huellaCsp(texto: string): string {
  return `sha256-${createHash('sha256').update(texto).digest('base64')}`;
}

/** Contenido de la primera etiqueta indicada del HTML; sin ella no hay huella que calcular. */
export function contenidoDeEtiqueta(html: string, etiqueta: 'script' | 'style'): string {
  const resultado = new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`).exec(html)?.[1];
  if (!resultado) {
    throw new Error(`Falta el contenido de <${etiqueta}> del que se calcula la huella CSP`);
  }
  return resultado;
}

function patronDeHuella(nombre: string): RegExp {
  return new RegExp(`(export const ${nombre} = ')([^']+)(';)`);
}

/** Valor declarado de cada huella en la fuente del módulo; falla si una constante no existe. */
export function huellasDeclaradas(fuente: string, nombres: readonly string[]): HuellasCsp {
  return Object.fromEntries(
    nombres.map((nombre) => {
      const valor = patronDeHuella(nombre).exec(fuente)?.[2];
      if (!valor) {
        throw new Error(`Falta la constante ${nombre} con la huella CSP`);
      }
      return [nombre, valor];
    }),
  );
}

/** Nombres de las huellas declaradas que no coinciden con las calculadas desde el HTML. */
export function huellasDesactualizadas(fuente: string, huellas: HuellasCsp): readonly string[] {
  const declaradas = huellasDeclaradas(fuente, Object.keys(huellas));
  return Object.keys(huellas).filter((nombre) => declaradas[nombre] !== huellas[nombre]);
}

/** Fuente del módulo con cada huella sustituida por la calculada; no escribe. */
export function sustituirHuellas(fuente: string, huellas: HuellasCsp): string {
  huellasDeclaradas(fuente, Object.keys(huellas));
  return Object.entries(huellas).reduce(
    (resultado, [nombre, valor]) => resultado.replace(patronDeHuella(nombre), `$1${valor}$3`),
    fuente,
  );
}

/** Huellas del guion y del estilo de la portada pública, calculadas desde su HTML final. */
export function huellasDePortada(html: string): HuellasCsp {
  return {
    CSP_SCRIPT_CABECERA: huellaCsp(contenidoDeEtiqueta(html, 'script')),
    CSP_PORTADA: huellaCsp(contenidoDeEtiqueta(html, 'style')),
  };
}

/** La huella SHA-256 en hexadecimal de los bytes que la web publica para un activo compartido. */
function huellaDeActivo(activo: ActivoPublico, web: URL = WEB): string {
  return createHash('sha256')
    .update(readFileSync(new URL(activo.archivo, web)))
    .digest('hex');
}

/** Las huellas de los activos que comparten portada y acceso, calculadas desde sus archivos de la web. */
export function huellasDeActivos(web: URL = WEB): HuellasCsp {
  return { HUELLA_FOTOGRAFIA_PORTADA: huellaDeActivo(FOTOGRAFIA_PORTADA, web) };
}

/** Comprueba sin escribir, o sustituye en un módulo las huellas que no coinciden con lo que las origina. */
function actualizar(archivo: URL, huellas: HuellasCsp, origen: string, comprobar: boolean): void {
  const fuente = readFileSync(archivo, 'utf8');
  const desactualizadas = huellasDesactualizadas(fuente, huellas);
  if (comprobar) {
    if (desactualizadas.length > 0) {
      throw new Error(
        `huellas que no coinciden con su ${origen} en ${fileURLToPath(archivo)}: ${desactualizadas.join(', ')}; ` +
          'se recalculan con npm run cloudflare:actualizar-portada',
      );
    }
    console.log(`Huellas al día en ${fileURLToPath(archivo)}`);
    return;
  }
  if (desactualizadas.length === 0) {
    console.log(`Huellas ya al día en ${fileURLToPath(archivo)}; no se escribe el módulo`);
    return;
  }
  writeFileSync(archivo, sustituirHuellas(fuente, huellas));
  console.log(`Huellas actualizadas en ${fileURLToPath(archivo)}: ${desactualizadas.join(', ')}`);
}

/** Las huellas CSP de la portada, desde su HTML, y las de los activos compartidos, desde la web. */
function principal(): void {
  const { values } = orden(USO).leer({ options: { comprobar: { type: 'boolean' } } });
  const comprobar = values.comprobar === true;
  actualizar(ARCHIVO_DE_ACTIVOS, huellasDeActivos(), 'archivo de la web', comprobar);
  actualizar(ARCHIVO, huellasDePortada(PORTADA_PUBLICA), 'HTML', comprobar);
}

if (import.meta.main) {
  await ejecutar(principal, 'Huellas CSP de la portada');
}
