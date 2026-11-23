/** Registro de las extensiones instaladas, en el orden de `extensiones-instaladas.ts`. */
import type { Extension } from './extension.ts';
import * as instaladas from './extensiones-instaladas.ts';

export const EXTENSIONES: readonly Extension[] = Object.freeze(Object.values<Extension>(instaladas));
