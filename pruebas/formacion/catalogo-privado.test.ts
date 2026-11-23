import assert from 'node:assert/strict';
import test from 'node:test';
import {
  leerCatalogoPrivado,
  leerPaginaCatalogoPrivado,
  paginarCatalogoPrivado,
} from '../../src/administracion/catalogo-privado.js';
import { catalogoPrivado } from '../ayudas/catalogo-privado.ts';

const TOTAL = 53;
const POR_PAGINA = 50;
const RESTANTES = 3;
const EDICIONES = 26;
const TAM_SHA = 64;

test('paginación mantiene corte, referencias y diferencia entre ausencia y cero acreditado', () => {
  const c = catalogoPrivado(TOTAL);
  const p = paginarCatalogoPrivado(c, { tipo: 'todos', pagina: 0, revision: null });
  assert.deepEqual(leerPaginaCatalogoPrivado(p), p);
  assert.equal(p.catalogo?.total, TOTAL);
  assert.equal(p.catalogo?.unidades.length, POR_PAGINA);
  assert.equal(p.catalogo?.referencias.length, 1);
  const segunda = paginarCatalogoPrivado(c, { tipo: 'todos', pagina: 1, revision: c.revision });
  assert.deepEqual(leerPaginaCatalogoPrivado(segunda), segunda);
  assert.equal(segunda.catalogo?.unidades.length, RESTANTES);
  assert.equal(segunda.catalogo?.siguiente, null);
  assert.equal(segunda.catalogo?.unidades[0]?.comprobadoEl, '2026-10-15T10:00:00Z');
  assert.equal(segunda.catalogo?.publicacionConfirmada, null);
  assert.equal(paginarCatalogoPrivado(c, { tipo: 'edicion', pagina: 0, revision: null }).catalogo?.total, EDICIONES);
  assert.deepEqual(paginarCatalogoPrivado(null, { tipo: 'todos', pagina: 0, revision: null }), {
    estado: 'sin-registro',
    catalogo: null,
  });
  assert.equal(
    paginarCatalogoPrivado(catalogoPrivado(0), { tipo: 'todos', pagina: 0, revision: null }).catalogo?.total,
    0,
  );
  assert.throws(() => paginarCatalogoPrivado(c, { tipo: 'todos', pagina: 1, revision: '0'.repeat(TAM_SHA) }));
});
test('rechaza referencias huérfanas, tipos abiertos, URLs con secretos y publicación inventada', () => {
  const c = catalogoPrivado();
  for (const cambiar of [
    (v: Record<string, unknown>) => {
      v.version = true;
    },
    (v: Record<string, unknown>) => {
      v.publicacionConfirmada = true;
    },
    (v: Record<string, unknown>) => {
      v.ruta = '/equipo/privado';
    },
  ]) {
    const mal = structuredClone(c);
    cambiar(mal);
    assert.throws(() => leerCatalogoPrivado(mal));
  }
  const alterado = structuredClone(c) as unknown as { referencias: { url: string }[] };
  const ref = alterado.referencias[0];
  assert.ok(ref);
  ref.url = 'https://curso.example/ficha?token=privado';
  assert.throws(() => leerCatalogoPrivado(alterado));
  const p = structuredClone(paginarCatalogoPrivado(c, { tipo: 'todos', pagina: 0, revision: null }));
  assert.ok(p.catalogo);
  assert.throws(() => leerPaginaCatalogoPrivado({ ...p, catalogo: { ...p.catalogo, referencias: [] } }));
  assert.ok(Object.isFrozen(c.unidades[0]));
});

test('la cota se comprueba antes de expandir una colección programática con contenido compartido', () => {
  const c = catalogoPrivado();
  const primera = c.unidades[0];
  assert.ok(primera);
  const repeticiones = 10_000,
    tamanoTexto = 2048,
    motivosPorUnidad = 128;
  const fila = { ...primera, motivos: Array.from({ length: motivosPorUnidad }, () => 'x'.repeat(tamanoTexto)) };
  let leidas = 0;
  const unidades = new Proxy(
    Array.from({ length: repeticiones }, (_, i) => ({ ...fila, id: `fila-${i}` })),
    {
      get(objeto, clave, receptor) {
        if (typeof clave === 'string' && /^\d+$/.test(clave)) {
          leidas++;
        }
        return Reflect.get(objeto, clave, receptor);
      },
    },
  );
  assert.throws(() => leerCatalogoPrivado({ ...c, unidades }));
  assert.ok(leidas < repeticiones);
});

test('la frontera no ejecuta accesores ni admite prototipos ajenos', () => {
  const c = catalogoPrivado();
  let lecturas = 0;
  const mal = { ...c };
  Object.defineProperty(mal, 'revision', {
    enumerable: true,
    get() {
      lecturas++;
      return c.revision;
    },
  });
  assert.throws(() => leerCatalogoPrivado(mal));
  assert.equal(lecturas, 0);
  assert.throws(() => leerCatalogoPrivado(Object.assign(Object.create({ oculto: true }), c)));
});

const NO_ENCONTRADO = 404;
test('la incidencia del enlace se valida: fecha no posterior al corte, origen y tipo cerrados, código HTTP o null', () => {
  const con = (incidenciaEnlace: unknown) => () =>
    catalogoPrivado(1, (u) => ({ ...u, motivoRetencion: null, incidenciaEnlace }));
  const ficha = con({ el: '2026-10-15T11:00:00Z', origen: 'ficha', tipo: 'http', codigoHttp: NO_ENCONTRADO })();
  assert.equal(ficha.unidades[0]?.incidenciaEnlace?.codigoHttp, NO_ENCONTRADO);
  assert.equal(ficha.unidades[0]?.incidenciaEnlace?.origen, 'ficha');
  const catalogo = con({ el: '2026-10-15T11:00:00Z', origen: 'catalogo', tipo: 'red', codigoHttp: null })();
  assert.equal(catalogo.unidades[0]?.incidenciaEnlace?.origen, 'catalogo');
  for (const mala of [
    { el: '2026-10-16T11:00:00Z', origen: 'ficha', tipo: 'http', codigoHttp: NO_ENCONTRADO },
    { el: '2026-10-15T11:00:00Z', origen: 'ficha', tipo: 'HTTP <b>', codigoHttp: NO_ENCONTRADO },
    { el: '2026-10-15T11:00:00Z', origen: 'ficha', tipo: 'http', codigoHttp: 99 },
    { el: '2026-10-15T11:00:00Z', origen: 'ficha', tipo: 'http' },
    { el: '2026-10-15T11:00:00Z', origen: 'portada', tipo: 'http', codigoHttp: NO_ENCONTRADO },
    { el: '2026-10-15T11:00:00Z', tipo: 'http', codigoHttp: NO_ENCONTRADO },
    '2026-10-15T11:00:00Z',
  ]) {
    assert.throws(con(mala));
  }
});
