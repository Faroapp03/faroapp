// Lo que la foto de la clasificación de cursos cumple con cualquier catálogo que cumpla su contrato: es determinista,
// cada ficha del listado tiene su unidad, sin repetir ni perder ninguna, y el comparador separa pérdidas, cambios y
// ganancias. La foto de una fecha, en foto-clasificacion.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compararFotos,
  type FotoClasificacion,
  serializarFoto,
} from '../../herramientas/catalogo-cursos/comparar-fotos.ts';
import {
  catalogoPublicado,
  fotoClasificacion,
  paqueteDelSoc,
} from '../../herramientas/catalogo-cursos/foto-clasificacion.ts';
import type { UnidadFotografiada } from '../../herramientas/catalogo-cursos/foto-cursos.ts';
import { proyectarListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';

function fotoPequena(cursos: readonly UnidadFotografiada[]): FotoClasificacion {
  return {
    catalogo: { sha256: 'catalogo-de-prueba', corte_proyeccion_utc: '2026-11-18T00:00:00Z' },
    soc: { fecha_cursos: '2026-11-15' },
    unidades: { cursos, soc: [] },
  };
}

function unidad(clave: string, nivel: unknown, idioma: readonly string[]): UnidadFotografiada {
  return {
    clave,
    fuente: 'prueba',
    titulo: clave,
    datos: {
      nivel:
        nivel === null
          ? { valor: null, origen: null, estado: 'por-confirmar' }
          : { valor: nivel, origen: 'faro', estado: 'orientacion-faro' },
      idioma: { valor: idioma, origen: 'edicion', estado: idioma.length ? 'fuente' : 'por-confirmar' },
    },
  };
}

test('la foto del catálogo publicado es determinista y tiene una unidad por cada ficha del listado, sin perder ninguna', () => {
  const catalogo = catalogoPublicado();
  const primera = serializarFoto(fotoClasificacion(catalogo, paqueteDelSoc()));
  assert.equal(serializarFoto(fotoClasificacion(catalogo, paqueteDelSoc())), primera);
  const foto = JSON.parse(primera) as FotoClasificacion;
  const claves = foto.unidades.cursos.map((u) => u.clave);
  assert.deepEqual(claves, [...claves].sort());
  assert.equal(new Set(claves).size, claves.length);
  // Un curso con datos por confirmar sigue en la foto: no se pierde por un dato que no consta.
  const fichas = proyectarListado(catalogo).ofertas.map((f) => f.identidad);
  assert.deepEqual([...claves].sort(), [...fichas].sort());
});

test('el comparador separa una pérdida, un cambio y una ganancia en un caso pequeño', () => {
  const antes = fotoPequena([unidad('a', 'inicial', ['ca']), unidad('b', 'inicial', ['es']), unidad('c', null, [])]);
  const despues = fotoPequena([unidad('a', null, ['ca']), unidad('b', 'avanzado', ['es']), unidad('c', null, ['es'])]);
  const { perdidas, cambios, ganancias } = compararFotos(antes, despues);
  assert.deepEqual(
    perdidas.map((d) => [d.clave, d.dato]),
    [['a', 'nivel']],
  );
  assert.deepEqual(
    cambios.map((d) => [d.clave, d.dato]),
    [['b', 'nivel']],
  );
  assert.deepEqual(
    ganancias.map((d) => [d.clave, d.dato]),
    [['c', 'idioma']],
  );
  assert.deepEqual(compararFotos(antes, antes), { perdidas: [], cambios: [], ganancias: [] });
});
