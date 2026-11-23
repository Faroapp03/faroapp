/** La puerta y el trabajador de Cursos en Chromium, Firefox y WebKit, en una web temporal (trabajador-de-cursos.ts). */
import { after, before, test } from 'node:test';
import { NOMBRES_DE_MOTORES, prepararServicio, probar } from './trabajador-de-cursos.ts';

/** @type {{ origen: string, cerrar: () => Promise<void> } | undefined} */
let servicio;
before(async () => {
  servicio = await prepararServicio();
});
after(async () => {
  await servicio?.cerrar();
});

for (const nombre of NOMBRES_DE_MOTORES) {
  test(`${nombre}: la puerta de Cursos corta, se recupera y rechaza referencias ajenas`, async () => {
    if (!servicio) {
      throw new Error('La web temporal de la prueba no está preparada');
    }
    await probar(nombre, servicio.origen);
  });
}
