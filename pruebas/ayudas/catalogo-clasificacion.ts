/** Instantánea pública del 25/10/2026: los recuentos de su revisión no fijan las futuras actualizaciones. */
import { readFileSync } from 'node:fs';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';

export const REFERENCIA_CLASIFICACION = {
  sha256: '2c5c0efdbaf46d4eb147d52061707079268ab1a98eef0f8af2f0083b09d0df5e',
  bytes: 5372871,
  revision: '25fcb83ee7067c059bb8f81332090997d44254e43779799fc8a883488bc21b42',
};

export const CATALOGO_CLASIFICACION = leerCatalogo(
  readFileSync(new URL('../fixtures/catalogo-clasificacion-20261025.utf8', import.meta.url)),
  REFERENCIA_CLASIFICACION,
);
