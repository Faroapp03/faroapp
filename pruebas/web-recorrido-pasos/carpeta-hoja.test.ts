import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { reescribirTextos } from '../../web/scripts/idioma.js';
import { crearTarjetaDeLaHoja } from '../../web/scripts/recorrido/carpeta.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { pagina, prepararDom } from './dom.ts';

await cargarDiccionario('es');
await cargarDiccionario('ca');

const ESPERADOS = {
  es: ['1 hoja · Recursos para seguir aprendiendo', '2 hojas · Plan con un curso', '2 hojas · Plan con dos cursos'],
  ca: ['1 full · Recursos per continuar aprenent', '2 fulls · Pla amb un curs', '2 fulls · Pla amb dos cursos'],
};

test('la tarjeta de la hoja dice cuántas hojas y cuántos cursos tiene, también sin cursos, en los dos idiomas', () => {
  prepararDom();
  fijarIdioma('es');
  const tarjetas = [0, 1, 2].map((cursos) => crearTarjetaDeLaHoja(cursos, true));
  pagina.body.append(...(tarjetas as unknown as Parameters<typeof pagina.body.append>));
  const cabeza = (tarjeta: HTMLElement) => tarjeta.querySelector('.rc-doc-cabeza')?.textContent ?? '';
  const comprobar = (esperados: string[]) => {
    for (const [cursos, tarjeta] of tarjetas.entries()) {
      assert.ok(cabeza(tarjeta).endsWith(esperados[cursos] ?? ''), cabeza(tarjeta));
    }
  };
  comprobar(ESPERADOS.es);
  fijarIdioma('ca');
  reescribirTextos();
  comprobar(ESPERADOS.ca);
  assert.ok(tarjetas.every((tarjeta) => !/0 cursos|0 curs/u.test(tarjeta.textContent ?? '')));
});
