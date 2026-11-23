import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { versionDeLaWeb } from '../../herramientas/web/copia-sin-conexion.ts';
import { fijarMarcador, huellaDeLaCopia, marcadorNormalizado } from '../../herramientas/web/version-copia.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';

const encoder = new TextEncoder();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fuente = encoder.encode('<meta name="faro-version-copia" content="0000000000000000" />');
/** Las páginas con barrera de versión: la del recorrido real y las que declara cada extensión del registro. */
const DE_LAS_EXTENSIONES = EXTENSIONES.flatMap(({ paginasConVersion }) => paginasConVersion);
const PAGINAS = ['recorrido.html', ...DE_LAS_EXTENSIONES];
test('el marcador conserva preimagen y modifica bytes reales de cada página con versión', () => {
  for (const ruta of PAGINAS) {
    const fijada = fijarMarcador(ruta, fuente, '1234567890abcdef');
    assert.notEqual(hash(fijada), hash(fuente));
    assert.equal(hash(marcadorNormalizado(ruta, fijada)), hash(marcadorNormalizado(ruta, fuente)));
  }
});
test('no acepta marcador ausente, duplicado o versión malformada', () => {
  assert.throws(() => marcadorNormalizado('recorrido.html', encoder.encode('sin marcador')));
  assert.throws(() =>
    marcadorNormalizado('recorrido.html', encoder.encode(new TextDecoder().decode(fuente).repeat(2))),
  );
  assert.throws(() => fijarMarcador('recorrido.html', fuente, 'otra'));
});

test('la huella incorpora los bytes del HTML salvo únicamente el marcador', () => {
  for (const ruta of PAGINAS) {
    const bytes = new Map<string, Uint8Array>([[ruta, fuente]]);
    const calcular = () =>
      huellaDeLaCopia(
        { catalogo: [[ruta, hash(fuente), 'seccion']], paginasConVersion: [], codigo: {}, cabeceras: {} },
        (nombre) => {
          const valor = bytes.get(nombre);
          assert.ok(valor);
          return valor;
        },
      );
    const inicial = calcular();
    bytes.set(ruta, fijarMarcador(ruta, fuente, inicial));
    assert.equal(calcular(), inicial);
    bytes.set(ruta, encoder.encode(`${new TextDecoder().decode(bytes.get(ruta))} texto cambiado`));
    assert.notEqual(calcular(), inicial);
  }
});

test('el generador incluye cada HTML con versión aunque no figure en el catálogo de caché', async () => {
  const web = mkdtempSync(join(tmpdir(), 'faro-version-test-'));
  try {
    writeFileSync(join(web, 'sitio.js'), 'sitio');
    for (const ruta of PAGINAS) {
      mkdirSync(join(web, dirname(ruta)), { recursive: true });
      writeFileSync(join(web, ruta), fuente);
    }
    const contexto = { web, paquete: join(web, 'paquete'), motor: new Map<string, Uint8Array>() };
    const listas = { archivos: ['sitio.js'], bajoDemanda: [], comprobados: [], secciones: [] };
    const calcular = async () => (await versionDeLaWeb(listas, {}, contexto)).version;
    const inicial = await calcular();
    writeFileSync(join(web, 'recorrido.html'), encoder.encode(`${new TextDecoder().decode(fuente)} cambio real`));
    const cambiadoReal = await calcular();
    assert.notEqual(cambiadoReal, inicial);
    writeFileSync(join(web, 'recorrido.html'), fuente);
    for (const ruta of DE_LAS_EXTENSIONES) {
      writeFileSync(join(web, ruta), encoder.encode(`${new TextDecoder().decode(fuente)} cambio de la extensión`));
      assert.notEqual(await calcular(), inicial, ruta);
      writeFileSync(join(web, ruta), fuente);
    }
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});
