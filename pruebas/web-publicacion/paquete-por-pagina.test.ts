// El mapa de integridad de cada página con el paquete: lista solo su entrada, sus trozos estáticos y dinámicos y los
// módulos del motor que importa por su dirección fija. Los bytes salen del paquete, y un trozo cambiado después de
// preparar sale en rojo aunque ninguna etiqueta lo nombre.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { ContextoWeb } from '../../herramientas/web/contexto.ts';
import type { GrafoDePagina, ResumenDelGrafo } from '../../herramientas/web/empaquetado.ts';
import {
  comprobarIntegridad,
  corregirIntegridad,
  huellaSri,
  MOTOR_EN_LAS_PAGINAS,
  mapaEsperado,
} from '../../herramientas/web/integridad.ts';

const bytes = (texto: string) => new TextEncoder().encode(texto);
const PRIVACIDAD = 'motor/src/seguridad/privacidad.js';
const TROZO_DEL_MOTOR = 'motor/trozos/comun.js';
const PAQUETE: Record<string, string> = {
  'js/pagina-inicio.js': 'import"./comun.js";',
  'js/pagina-recorrido.js': 'import"./comun.js";import"./limpieza.js";import("./paso.js");',
  'js/pagina-informe.js': 'export const informe=1;',
  'js/comun.js': 'export const comun=1;',
  'js/limpieza.js': `const PRIVACIDAD=new URL("../${PRIVACIDAD}",import.meta.url).href;export{PRIVACIDAD};`,
  'js/paso.js': 'export const paso=1;',
  [PRIVACIDAD]: 'import"../../trozos/comun.js";export const limpiar=1;',
  [TROZO_DEL_MOTOR]: 'export const base=1;',
  ...Object.fromEntries(MOTOR_EN_LAS_PAGINAS.filter((m) => m !== PRIVACIDAD).map((m) => [m, 'export{};'])),
};
const PAGINAS: Record<string, GrafoDePagina> = {
  'inicio.html': grafo('js/pagina-inicio.js', ['js/comun.js'], []),
  'recorrido.html': grafo('js/pagina-recorrido.js', ['js/comun.js', 'js/limpieza.js'], ['js/paso.js']),
  'informe-ejemplo.html': grafo('js/pagina-informe.js', [], []),
};

function grafo(entrada: string, estaticos: string[], dinamicos: string[]): GrafoDePagina {
  return { entrada, estaticos, dinamicos, bytesEstaticos: 0, bytesTotales: 0 };
}

/** Una construcción sintética: las páginas y el paquete escritos en la web, con sus bytes y su grafo en el contexto. */
function construccion(): { contexto: ContextoWeb; publicados: string[]; raiz: string } {
  const raiz = mkdtempSync(join(tmpdir(), 'paquete-por-pagina-'));
  const web = join(raiz, 'web');
  const archivos: Record<string, string> = { ...PAQUETE };
  for (const [pagina, { entrada }] of Object.entries(PAGINAS)) {
    archivos[pagina] = `<html><head><script type="module" src="${entrada}"></script></head><body></body></html>`;
  }
  for (const [ruta, texto] of Object.entries(archivos)) {
    mkdirSync(dirname(join(web, ruta)), { recursive: true });
    writeFileSync(join(web, ruta), texto);
  }
  const paquete = new Map(Object.entries(PAQUETE).map(([ruta, texto]) => [ruta, bytes(texto)]));
  const motor = new Map([...paquete].filter(([ruta]) => ruta.startsWith('motor/')));
  const grafoEmitido = { paginas: PAGINAS } as unknown as ResumenDelGrafo;
  const contexto: ContextoWeb = { web, paquete: raiz, motor, paqueteNavegador: paquete, grafoEmitido };
  const publicados = Object.keys(archivos).filter((ruta) => !ruta.startsWith('motor/'));
  return { contexto, publicados, raiz };
}

test('cada página lista solo sus trozos y los módulos del motor que importa', () => {
  const { contexto, publicados, raiz } = construccion();
  try {
    const claves = (pagina: string) => Object.keys(mapaEsperado(publicados, undefined, contexto, pagina)).sort();
    assert.deepEqual(claves('inicio.html'), ['./js/comun.js', './js/pagina-inicio.js']);
    assert.deepEqual(claves('informe-ejemplo.html'), ['./js/pagina-informe.js']);
    assert.deepEqual(claves('recorrido.html'), [
      './js/comun.js',
      './js/limpieza.js',
      './js/pagina-recorrido.js',
      './js/paso.js',
      `./${PRIVACIDAD}`,
      `./${TROZO_DEL_MOTOR}`,
    ]);
    const mapa = mapaEsperado(publicados, undefined, contexto, 'recorrido.html');
    assert.equal(mapa['./js/paso.js'], huellaSri(bytes(PAQUETE['js/paso.js'] ?? '')));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('un byte cambiado en un trozo dinámico después de preparar sale en rojo', () => {
  const { contexto, publicados, raiz } = construccion();
  try {
    const huella = corregirIntegridad(publicados, contexto);
    const paginas = () =>
      new Map(Object.keys(PAGINAS).map((pagina) => [pagina, readFileSync(join(contexto.web, pagina), 'utf8')]));
    assert.deepEqual(comprobarIntegridad(publicados, paginas(), huella, contexto), []);
    writeFileSync(join(contexto.web, 'js/paso.js'), 'export const paso=2;');
    assert.deepEqual(comprobarIntegridad(publicados, paginas(), huella, contexto), [
      'js/paso.js: no es el archivo del paquete',
    ]);
    writeFileSync(join(contexto.web, TROZO_DEL_MOTOR), 'export const base=2;');
    assert.ok(
      comprobarIntegridad(publicados, paginas(), huella, contexto).includes(
        `${TROZO_DEL_MOTOR}: no es el archivo del paquete`,
      ),
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
