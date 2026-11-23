// Un motor de cursos para las pruebas del trabajador (pruebas/motores/fusible-cursos-trabajador.test.ts): el real, salvo
// catalogoDeCursos, que según el texto buscado calcula N ms sin soltar el hilo («calcula-N»), se queda en bucle
// («bucle»), lanza («lanza») o hace terminar a su trabajador («muere»). Con cualquier otro texto, responde el real.

import { catalogoDeCursos as catalogoReal } from '../../motores/cursos/src/index.ts';

export * from '../../motores/cursos/src/index.ts';

/** Lo que calcula cada vuelta del bucle infinito, en milisegundos. */
const VUELTA_MS = 1000;
/** El código con que termina el trabajador en el caso «muere». */
const CODIGO_DE_SALIDA = 3;

/** Ocupa el hilo `ms` milisegundos, sin soltarlo. */
function calcular(ms: number): number {
  const fin = performance.now() + ms;
  let vueltas = 0;
  while (performance.now() < fin) {
    vueltas += 1;
  }
  return vueltas;
}

/** catalogoDeCursos con los casos de la prueba. */
export function catalogoDeCursos(...argumentos: Parameters<typeof catalogoReal>): ReturnType<typeof catalogoReal> {
  const texto = argumentos[1].filtros?.texto ?? '';
  const ms = /^calcula-(\d+)$/u.exec(texto)?.[1];
  if (ms !== undefined) {
    calcular(Number(ms));
  } else if (texto === 'bucle') {
    for (;;) {
      calcular(VUELTA_MS);
    }
  } else if (texto === 'lanza') {
    throw new Error('fallo de prueba dentro del trabajador');
  } else if (texto === 'muere') {
    process.exit(CODIGO_DE_SALIDA);
  }
  return catalogoReal(...argumentos);
}
