// Contrato del lector puro: conserva datos y procedencia reales, distingue ausencias y cotas,
// rechaza entradas defectuosas y mantiene los archivos antiguos sin metadatos opcionales. Sin red ni IA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { esObjeto } from '../../src/comun/json.ts';
import {
  cifraDelBloque,
  DatosGlobalesNoDisponibles,
  DatosGlobalesNoValidos,
  leerDatosGlobales,
  pedirDatosGlobales,
  serieDe,
  territorioPorCodigo,
  valorDe,
} from '../../src/datos-globales/datos.ts';
import { objeto } from '../ayudas/objeto-json.ts';

const TEXTO = readFileSync(new URL('../../datos/globales/datos-globales.json', import.meta.url), 'utf8');
const PUBLICADOS = leerDatosGlobales(JSON.parse(TEXTO));
const METADATOS_COMUNES = ['definicion', 'licencia', 'comparable', 'cobertura'] as const;
const METADATOS_ENCUESTA = ['respuesta', 'base', 'campo'] as const;
const PORCENTAJE_FUERA = 101;
const ANIO_FUERA = 1800;
const MAX_CARACTERES = 2_000_000;

/** Copia del JSON publicado para probar corrupciones, sin debilitar su tipo externo unknown. */
function crudos(): Record<string, unknown> {
  const valor: unknown = JSON.parse(TEXTO);
  assert.ok(esObjeto(valor));
  return valor;
}

/** Las pruebas necesitan modificar una fila; sus guardas verifican la forma antes de acceder. */
function fila(valor: Record<string, unknown>, campo: string, indice = 0): Record<string, unknown> {
  const lista = valor[campo];
  assert.ok(Array.isArray(lista));
  return objeto(lista[indice]);
}

function rechaza(cambiar: (valor: Record<string, unknown>) => void): void {
  const valor = crudos();
  cambiar(valor);
  assert.throws(() => leerDatosGlobales(valor), DatosGlobalesNoValidos);
}

test('el archivo real conserva íntegros todos los bloques, cifras, idiomas y metadatos de procedencia', () => {
  const valor = crudos();
  for (const campo of ['indicadores', 'territorios', 'recuentos', 'metas', 'encuestas', 'calculados'] as const) {
    assert.deepEqual(PUBLICADOS[campo], valor[campo], campo);
  }
  assert.equal(PUBLICADOS.muestra, false);
  assert.equal(PUBLICADOS.version, valor.version);
  assert.equal(PUBLICADOS.generado, valor.generado);
  assert.deepEqual(leerDatosGlobales(PUBLICADOS), PUBLICADOS);
});

test('los archivos anteriores sin metadatos opcionales conservan su forma, sin inventar licencias', () => {
  const valor = crudos();
  const recuento = fila(valor, 'recuentos');
  const encuesta = fila(valor, 'encuestas');
  for (const campo of METADATOS_COMUNES) {
    delete recuento[campo];
    delete encuesta[campo];
  }
  for (const campo of METADATOS_ENCUESTA) {
    delete encuesta[campo];
  }
  const leidos = leerDatosGlobales(valor);
  assert.deepEqual(leidos.recuentos[0], recuento);
  assert.deepEqual(leidos.encuestas[0], encuesta);
  assert.ok(!Object.hasOwn(leidos.recuentos[0] ?? {}, 'licencia'));
  assert.ok(!Object.hasOwn(leidos.encuestas[0] ?? {}, 'base'));
});

test('los metadatos opcionales presentes deben tener forma válida en recuentos y encuestas', () => {
  const malas: Readonly<Record<string, unknown>> = {
    definicion: { es: 'Una definición', ca: '' },
    licencia: null,
    comparable: 'sí',
    cobertura: 'otra',
  };
  for (const seccion of ['recuentos', 'encuestas']) {
    for (const [campo, mala] of Object.entries(malas)) {
      rechaza((valor) => {
        fila(valor, seccion)[campo] = mala;
      });
    }
  }
  for (const campo of METADATOS_ENCUESTA) {
    for (const mala of ['', null, false]) {
      rechaza((valor) => {
        fila(valor, 'encuestas')[campo] = mala;
      });
    }
  }
});

test('un porcentaje corrupto, NaN o infinito se rechaza entero, sin transformarse en cero o null', () => {
  for (const mala of [Number.NaN, Number.POSITIVE_INFINITY, -1, PORCENTAJE_FUERA, null, '0']) {
    rechaza((valor) => {
      fila(fila(valor, 'territorios'), 'valores').valor = mala;
    });
    rechaza((valor) => {
      fila(fila(valor, 'encuestas'), 'valores').valor = mala;
    });
  }
  rechaza((valor) => {
    fila(fila(valor, 'recuentos'), 'valores').valor = Number.POSITIVE_INFINITY;
  });
});

test('los campos exigidos conservan versión, fecha civil, años, unidad, fuente, licencia y HTTPS', () => {
  rechaza((valor) => {
    valor.version = '2';
  });
  rechaza((valor) => {
    valor.generado = '2026-02-30';
  });
  rechaza((valor) => {
    fila(fila(valor, 'territorios'), 'valores').anio = ANIO_FUERA;
  });
  rechaza((valor) => {
    fila(valor, 'indicadores').unidad = 'euros';
  });
  rechaza((valor) => {
    fila(valor, 'indicadores').fuente = '';
  });
  rechaza((valor) => {
    fila(valor, 'indicadores').licencia = '';
  });
  rechaza((valor) => {
    fila(valor, 'indicadores').url = 'http://ejemplo.invalid/';
  });
  rechaza((valor) => {
    fila(valor, 'indicadores').nombre = { es: 'Nombre' };
  });
});

test('una referencia inexistente, un año repetido o una serie invertida rechazan el archivo', () => {
  rechaza((valor) => {
    fila(fila(valor, 'territorios'), 'valores').indicador = 'no-existe';
  });
  rechaza((valor) => {
    const lista = fila(valor, 'territorios').valores;
    assert.ok(Array.isArray(lista));
    lista.push(lista[0]);
  });
  rechaza((valor) => {
    const lista = fila(valor, 'territorios').valores;
    assert.ok(Array.isArray(lista));
    lista.reverse();
  });
});

test('los IDs de indicador/territorio y las unidades de las metas conservan sus invariantes', () => {
  rechaza((valor) => {
    const lista = valor.indicadores;
    assert.ok(Array.isArray(lista));
    lista.push(lista[0]);
  });
  rechaza((valor) => {
    const lista = valor.territorios;
    assert.ok(Array.isArray(lista));
    lista.push(lista[0]);
  });
  rechaza((valor) => {
    fila(valor, 'metas').unidad = 'miles de personas';
  });
  rechaza((valor) => {
    fila(valor, 'metas').valor = Number.NaN;
  });
});

test('sin bloques opcionales se obtienen listas vacías, congeladas, sin nuevas cifras', () => {
  const valor = crudos();
  for (const bloque of ['recuentos', 'metas', 'encuestas', 'calculados']) {
    delete valor[bloque];
  }
  const leidos = leerDatosGlobales(valor);
  for (const bloque of [leidos.recuentos, leidos.metas, leidos.encuestas, leidos.calculados]) {
    assert.deepEqual(bloque, []);
    assert.ok(Object.isFrozen(bloque));
  }
});

test('un territorio o indicador ausente da null o serie vacía, nunca una cifra inventada', () => {
  assert.equal(territorioPorCodigo(PUBLICADOS, 'XXX'), null);
  assert.equal(valorDe(PUBLICADOS, 'XXX', 'empresas-ia'), null);
  assert.equal(valorDe(PUBLICADOS, 'ES51', 'no-existe'), null);
  assert.deepEqual(serieDe(PUBLICADOS, 'ES51', 'no-existe'), []);
  const encuesta = PUBLICADOS.encuestas[0];
  assert.ok(encuesta);
  assert.equal(cifraDelBloque(PUBLICADOS, encuesta, 'XXX'), null);
});

test('el último dato, los códigos/ISO3 y la serie cronológica conservan cifras y orden fuente', () => {
  const territorio = territorioPorCodigo(PUBLICADOS, 'ES51');
  assert.ok(territorio);
  const serie = territorio.valores.filter((valor) => valor.indicador === 'empresas-ia');
  assert.deepEqual(valorDe(PUBLICADOS, 'ES51', 'empresas-ia'), serie[0]);
  assert.deepEqual(serieDe(PUBLICADOS, 'ES51', 'empresas-ia'), serie.toReversed());
  assert.deepEqual(
    territorio.valores.filter((valor) => valor.indicador === 'empresas-ia'),
    serie,
  );
  const pais = PUBLICADOS.territorios.find((valor) => valor.tipo === 'pais');
  assert.ok(pais?.iso3);
  assert.equal(territorioPorCodigo(PUBLICADOS, pais.iso3), territorioPorCodigo(PUBLICADOS, pais.codigo));
});

test('las cifras calculadas reales de CHL y COL conservan null, IC95%, cotas y procedencia propia', () => {
  const alta = PUBLICADOS.calculados.find(({ id }) => id === 'exposicion-alta');
  const alguna = PUBLICADOS.calculados.find(({ id }) => id === 'exposicion-alguna');
  assert.ok(alta && alguna);
  for (const [bloque, codigo] of [
    [alta, 'CHL'],
    [alguna, 'CHL'],
    [alguna, 'COL'],
  ] as const) {
    const cifra = bloque.valores.find(({ territorio }) => territorio === codigo);
    assert.ok(cifra?.cotas);
    assert.equal(cifra.valor, null);
    assert.ok(cifra.intervalo.desde <= cifra.cotas.inferior);
    assert.ok(cifra.cotas.inferior < cifra.cotas.superior);
    assert.ok(cifra.cotas.superior <= cifra.intervalo.hasta);
    assert.equal(cifra.cotas.motivo, 'sin_correspondencia_4_digitos');
    assert.ok(cifra.encuesta && cifra.licencia && cifra.cita && cifra.url.startsWith('https:'));
  }
});

test('las cifras calculadas rechazan NaN, intervalo invertido, método ajeno y valor fuera del IC', () => {
  rechaza((valor) => {
    fila(fila(valor, 'calculados'), 'valores').valor = Number.NaN;
  });
  rechaza((valor) => {
    fila(fila(valor, 'calculados'), 'valores').valor = PORCENTAJE_FUERA;
  });
  rechaza((valor) => {
    const intervalo = objeto(fila(fila(valor, 'calculados'), 'valores').intervalo);
    intervalo.desde = PORCENTAJE_FUERA;
  });
  rechaza((valor) => {
    const intervalo = objeto(fila(fila(valor, 'calculados'), 'valores').intervalo);
    intervalo.metodo = 'otro';
  });
});

test('una cifra null requiere sus cotas válidas y un país no puede repetirse', () => {
  rechaza((valor) => {
    fila(fila(valor, 'calculados'), 'valores').valor = null;
  });
  rechaza((valor) => {
    const lista = fila(valor, 'calculados').valores;
    assert.ok(Array.isArray(lista));
    lista.push(lista[0]);
  });
  rechaza((valor) => {
    const calculado = fila(valor, 'calculados');
    const cifra = fila(calculado, 'valores', 1);
    const cotas = objeto(cifra.cotas);
    cotas.parte_sin_correspondencia = 0;
  });
});

test('la petición inyectada conserva URL, datos y distinción entre disponibilidad y contrato', async () => {
  const raiz = new URL('https://ejemplo.invalid/subruta/');
  const pedidas: URL[] = [];
  const leidos = await pedirDatosGlobales(async (direccion) => {
    pedidas.push(direccion);
    return new Response(TEXTO);
  }, raiz);
  assert.deepEqual(leidos, PUBLICADOS);
  assert.equal(pedidas[0]?.href, 'https://ejemplo.invalid/subruta/datos/datos-globales.json');
  await assert.rejects(
    pedirDatosGlobales(async () => new Response('', { status: 404 }), raiz),
    DatosGlobalesNoDisponibles,
  );
  await assert.rejects(
    pedirDatosGlobales(async () => new Response('<html>'), raiz),
    DatosGlobalesNoDisponibles,
  );
  await assert.rejects(
    pedirDatosGlobales(async () => new Response('x'.repeat(MAX_CARACTERES + 1)), raiz),
    DatosGlobalesNoDisponibles,
  );
  await assert.rejects(
    pedirDatosGlobales(async () => new Response('{}'), raiz),
    DatosGlobalesNoValidos,
  );
});

test('metas: una cifra positiva finita conserva íntegro el registro normativo', () => {
  const valor = crudos();
  const meta = fila(valor, 'metas');
  assert.ok(typeof meta.valor === 'number' && Number.isFinite(meta.valor) && meta.valor > 0);
  assert.deepEqual(leerDatosGlobales(valor).metas[0], meta);
});

test('metas: NaN e infinito positivo se rechazan sin producir un null serializado', () => {
  for (const mala of [Number.NaN, Number.POSITIVE_INFINITY]) {
    rechaza((valor) => {
      fila(valor, 'metas').valor = mala;
    });
  }
});

test('metas: el exponente JSON 1e999 deserializado se rechaza como cifra no finita', () => {
  const valor = crudos();
  fila(valor, 'metas').valor = JSON.parse('1e999');
  assert.throws(() => leerDatosGlobales(valor), DatosGlobalesNoValidos);
});
