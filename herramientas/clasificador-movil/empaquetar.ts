// Empaqueta una exportación Python y conserva su control de paridad como entrada operativa del producto.
// --comprobar verifica el modelo admitido, las entradas y las mismas predicciones, sin escribir.
// Uso: node herramientas/clasificador-movil/empaquetar.ts <carpeta de la exportación> | --comprobar

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clasificadorDesdeContenedor } from '../../motores/ocupaciones/src/index.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { ARCHIVOS_EXTRA_DEL_PAQUETE, MANIFIESTO } from '../../src/plataforma/archivos-del-paquete.ts';

const DATOS = fileURLToPath(new URL('../../datos/', import.meta.url));
const FUENTES = join(DATOS, 'fuentes/clasificador');
const ARCHIVO = ARCHIVOS_EXTRA_DEL_PAQUETE.clasificadorMovil;
const CONTROL = 'control.json';
const HUELLAS = 'huellas.json';
const TOLERANCIA = 1e-4;
const FRASES_EN_EL_ERROR = 3;
const GRUPOS_DE_CONTROL = 5;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface FraseDeControl {
  readonly texto: string;
  readonly top5: readonly (readonly [string, number])[];
}

/** Un grupo conocido con una probabilidad finita en el intervalo cerrado 0..1. */
function esGrupo(valor: unknown, clases: ReadonlySet<string>): valor is readonly [string, number] {
  return (
    Array.isArray(valor) &&
    valor.length === 2 &&
    typeof valor[0] === 'string' &&
    clases.has(valor[0]) &&
    typeof valor[1] === 'number' &&
    Number.isFinite(valor[1]) &&
    valor[1] >= 0 &&
    valor[1] <= 1
  );
}

/** Exige cinco grupos distintos, ordenados por probabilidad, y un texto con contenido. */
function esFrase(valor: unknown, clases: ReadonlySet<string>): valor is FraseDeControl {
  if (
    !(
      esObjeto(valor) &&
      typeof valor.texto === 'string' &&
      valor.texto.trim() &&
      Array.isArray(valor.top5) &&
      valor.top5.length === GRUPOS_DE_CONTROL
    )
  ) {
    return false;
  }
  const grupos: unknown[] = valor.top5;
  if (!grupos.every((grupo): grupo is readonly [string, number] => esGrupo(grupo, clases))) {
    return false;
  }
  return (
    new Set(grupos.map(([grupo]) => grupo)).size === GRUPOS_DE_CONTROL &&
    grupos.every((grupo, i) => i === 0 || grupo[1] <= (grupos[i - 1]?.[1] ?? -1))
  );
}

/** La misma comprobación de paridad para importar y para verificar, sin crear expectativas con este código. */
export function comprobarParidad(modelo: Uint8Array, control: unknown): number {
  const clasificador = clasificadorDesdeContenedor(JSON.parse(Buffer.from(modelo).toString('utf8')));
  const clases = new Set(clasificador.clases);
  if (!(Array.isArray(control) && control.length > 0 && control.every((frase) => esFrase(frase, clases)))) {
    throw new Error('control.json: se exige un control no vacío con texto y cinco grupos distintos válidos');
  }
  const frases = control as FraseDeControl[];
  const distintas = frases.filter(({ texto, top5 }) => {
    const p = clasificador.predecir(texto, GRUPOS_DE_CONTROL);
    return (
      p.length !== top5.length ||
      p.some((x, i) => x.grupo !== top5[i]?.[0] || !(Math.abs(x.p - (top5[i]?.[1] ?? Number.NaN)) <= TOLERANCIA))
    );
  });
  if (distintas.length > 0) {
    throw new Error(
      `${distintas.length} de ${frases.length} frases no coinciden con la exportación Python: ${distintas
        .slice(0, FRASES_EN_EL_ERROR)
        .map(({ texto }) => `«${texto}»`)
        .join(', ')}`,
    );
  }
  return frases.length;
}

/** La procedencia contiene solo entradas locales; la huella del modelo vincula el control con la salida admitida. */
function entrada(modelo: Buffer, control: Buffer, huellas: Buffer) {
  return {
    origenes: {
      'datos/fuentes/clasificador/control.json': sha256(control),
      'datos/fuentes/clasificador/huellas.json': sha256(huellas),
    },
    sha256: sha256(modelo),
  };
}

/** Comprueba las huellas fijadas antes de ejecutar la paridad. */
export function comprobarExportacion(modelo: Buffer, control: Buffer, huellas: Buffer): number {
  const esperadas: unknown = JSON.parse(huellas.toString('utf8'));
  if (!(esObjeto(esperadas) && esperadas[ARCHIVO] === sha256(modelo) && esperadas[CONTROL] === sha256(control))) {
    throw new Error('El modelo o control.json no coincide con datos/fuentes/clasificador/huellas.json');
  }
  return comprobarParidad(modelo, JSON.parse(control.toString('utf8')));
}

/** Interfaz ejecutable; importar las comprobaciones no realiza operaciones de disco. */
function principal(): void {
  const manifiesto = JSON.parse(readFileSync(join(DATOS, MANIFIESTO), 'utf8')) as Record<string, unknown>;
  const argumentos = process.argv.slice(2);
  const comprobar = argumentos.length === 1 && argumentos[0] === '--comprobar';
  const carpeta = argumentos[0];
  if (!comprobar && (argumentos.length !== 1 || !carpeta || carpeta.startsWith('--'))) {
    throw new Error('Uso: node herramientas/clasificador-movil/empaquetar.ts <exportación> | --comprobar');
  }
  const modelo = readFileSync(join(comprobar ? DATOS : (carpeta as string), ARCHIVO));
  const control = readFileSync(join(comprobar ? FUENTES : (carpeta as string), CONTROL));
  const huellas = comprobar
    ? readFileSync(join(FUENTES, HUELLAS))
    : Buffer.from(`${JSON.stringify({ [ARCHIVO]: sha256(modelo), [CONTROL]: sha256(control) }, null, 2)}\n`);
  const frases = comprobarExportacion(modelo, control, huellas);
  const nueva = entrada(modelo, control, huellas);
  if (comprobar) {
    if (JSON.stringify(manifiesto[ARCHIVO]) !== JSON.stringify(nueva)) {
      throw new Error(`${ARCHIVO}: la procedencia o su huella no está al día`);
    }
    console.log(`${ARCHIVO}: huellas y ${frases} frases de control iguales`);
    return;
  }
  writeFileSync(join(FUENTES, CONTROL), control);
  writeFileSync(join(FUENTES, HUELLAS), huellas);
  writeFileSync(join(DATOS, ARCHIVO), modelo);
  manifiesto[ARCHIVO] = nueva;
  writeFileSync(join(DATOS, MANIFIESTO), `${JSON.stringify(manifiesto, null, 2)}\n`);
  console.log(`Escrito datos/${ARCHIVO}, su control y procedencia (${frases} frases iguales)`);
}

if (import.meta.main) {
  principal();
}
