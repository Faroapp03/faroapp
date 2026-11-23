// La barrera de versión se publica con la huella de sus bytes en el nombre (scripts/barrera-<sha256>.js), como los
// demás guiones con huella (guiones-con-huella.ts): ningún service worker anterior la tiene en su copia, así que siempre
// llega de la red. Su fuente (scripts/barrera-version.js) no se publica (web/.assetsignore): la construcción la copia a
// la candidata, donde toma el nombre de su huella. Solo la cargan las páginas con versión, cada una una vez.
import type { GuionConHuella } from './guiones-con-huella.ts';
import { PAGINAS_CON_VERSION } from './version-copia.ts';

export const BARRERA: GuionConHuella = {
  fuente: 'scripts/barrera-version.js',
  prefijo: 'barrera',
  paginas: PAGINAS_CON_VERSION,
};
