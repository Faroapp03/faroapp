/** Inventario privado de la proyección de Cursos para comparar dos momentos de un ciclo. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { proyectarListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import { REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';

function huella(valor: unknown): string {
  return createHash('sha256').update(JSON.stringify(valor)).digest('hex');
}

if (!REFERENCIA) {
  process.stdout.write('null');
} else {
  const archivo = new URL(`../../web/datos/catalogo-cursos/${REFERENCIA.sha256}.json`, import.meta.url);
  const catalogo = leerCatalogo(readFileSync(archivo), REFERENCIA);
  const cursos = proyectarListado(catalogo).ofertas.map((ficha) => {
    const { identidad, temas, nivel, idiomas, hechos, ...resto } = ficha;
    return [
      identidad,
      [...temas].sort().join(','),
      nivel.valor ?? 'por-confirmar',
      [...idiomas].sort().join(','),
      hechos.modalidad.valor ?? 'no-indicado',
      huella([nivel, hechos, resto]),
    ];
  });
  process.stdout.write(JSON.stringify(cursos));
}
