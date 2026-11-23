import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { comprobarArtefactoCloudflare } from '../../herramientas/cloudflare/artefacto.ts';
import { promoverSalidaConstruida } from '../../herramientas/web/salida-construida.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';

const REVISION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function sha(contenido: Uint8Array): string {
  return createHash('sha256').update(contenido).digest('hex');
}
function bytes(valor: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(valor, null, 2)}\n`);
}
function contenidos(texto: string) {
  const dato = bytes({ datos: texto });
  const manifiesto = bytes({ 'uno.json': { sha256: sha(dato) } });
  const version = versionDelPaquete(sha(manifiesto));
  const motor = Buffer.from('export const motor = 1;\n');
  const archivos = new Map<string, Buffer>([
    ['worker/worker.mjs', Buffer.from('export default {};\n')],
    ['worker/datos/uno.json', dato],
    ['web/index.html', Buffer.from(texto)],
    ['web/motor/entrada.js', motor],
    [`web/paquete/${version}/manifiesto.json`, manifiesto],
    [`web/paquete/${version}/uno.json`, dato],
    [
      'web/firmas/manifiesto.json',
      bytes({
        formato: 1,
        paquete: version,
        archivos: {
          'motor/entrada.js': sha(motor),
          [`paquete/${version}/manifiesto.json`]: sha(manifiesto),
          [`paquete/${version}/uno.json`]: sha(dato),
        },
      }),
    ],
  ]);
  return { archivos, version, manifiesto };
}
function artefacto(carpeta: string, texto: string): string {
  const { archivos, version, manifiesto } = contenidos(texto);
  for (const [ruta, contenido] of archivos) {
    fs.mkdirSync(dirname(join(carpeta, ruta)), { recursive: true });
    fs.writeFileSync(join(carpeta, ruta), contenido);
  }
  const descriptor = bytes({
    version: 1,
    revisionCodigo: REVISION,
    huellaPaquete: version,
    sha256ManifiestoPaquete: sha(manifiesto),
    sha256ManifiestoDispositivo: sha(archivos.get('web/firmas/manifiesto.json') as Buffer),
    archivos: [...archivos]
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([ruta, contenido]) => ({ ruta, bytes: contenido.byteLength, sha256: sha(contenido) })),
  });
  fs.writeFileSync(join(carpeta, 'artefacto.json'), descriptor);
  return sha(descriptor);
}
function escenario(t: TestContext) {
  const padre = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'salida-construida-'));
  t.after(() => fs.rmSync(padre, { recursive: true, force: true }));
  const origen = join(padre, 'origen'),
    destino = join(padre, 'dist');
  const hash = artefacto(origen, 'nuevo');
  return { padre, origen, destino, hash };
}
function instantanea(carpeta: string): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const ruta of fs.readdirSync(carpeta, { recursive: true, encoding: 'utf8' })) {
    const archivo = join(carpeta, ruta),
      info = fs.lstatSync(archivo);
    resultado[ruta] = info.isFile() ? fs.readFileSync(archivo).toString('base64') : 'directorio';
  }
  return resultado;
}
function sinRestos(padre: string): void {
  assert.deepEqual(fs.readdirSync(padre).sort(), ['dist', 'origen']);
}

test('promueve mediante copia regular sin borrar origen y repone una salida íntegra distinta', (t) => {
  const f = escenario(t),
    fuente = instantanea(f.origen);
  promoverSalidaConstruida(f.origen, f.destino, f.hash);
  comprobarArtefactoCloudflare(f.destino, f.hash);
  assert.deepEqual(instantanea(f.destino), fuente);
  assert.notEqual(
    fs.statSync(join(f.origen, 'artefacto.json')).ino,
    fs.statSync(join(f.destino, 'artefacto.json')).ino,
  );
  fs.rmSync(f.origen, { recursive: true });
  const hash = artefacto(f.origen, 'siguiente');
  promoverSalidaConstruida(f.origen, f.destino, hash);
  comprobarArtefactoCloudflare(f.destino, hash);
  assert.deepEqual(instantanea(f.destino), instantanea(f.origen));
  sinRestos(f.padre);
});

test('rechaza origen extra, alterado, enlazado o con huella incorrecta sin tocar salida previa', (t) => {
  const cambios = [
    (f: ReturnType<typeof escenario>) => fs.writeFileSync(join(f.origen, 'ajeno.txt'), 'ajeno'),
    (f: ReturnType<typeof escenario>) => fs.writeFileSync(join(f.origen, 'web/index.html'), 'alterado'),
    (f: ReturnType<typeof escenario>) => {
      fs.rmSync(join(f.origen, 'web/index.html'));
      fs.symlinkSync(join(f.destino, 'web/index.html'), join(f.origen, 'web/index.html'));
    },
  ];
  for (const cambiar of cambios) {
    const f = escenario(t),
      previo = artefacto(f.destino, 'previo'),
      copia = instantanea(f.destino);
    comprobarArtefactoCloudflare(f.origen, f.hash);
    cambiar(f);
    assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash));
    assert.deepEqual(instantanea(f.destino), copia);
    comprobarArtefactoCloudflare(f.destino, previo);
    sinRestos(f.padre);
  }
  const f = escenario(t);
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, '0'.repeat(f.hash.length)));
  assert.equal(fs.existsSync(f.destino), false);
});

test('rechaza destino ajeno, extra, alterado o enlazado sin borrar su contenido', (t) => {
  for (const modo of ['ajeno', 'extra', 'alterado', 'enlace']) {
    const f = escenario(t);
    if (modo === 'ajeno') {
      fs.mkdirSync(f.destino);
      fs.writeFileSync(join(f.destino, 'conservar.txt'), 'ajeno');
    } else {
      artefacto(f.destino, 'previo');
      if (modo === 'extra') {
        fs.writeFileSync(join(f.destino, 'conservar.txt'), 'ajeno');
      } else if (modo === 'alterado') {
        fs.writeFileSync(join(f.destino, 'web/index.html'), 'ajeno');
      } else {
        fs.rmSync(join(f.destino, 'web/index.html'));
        fs.symlinkSync(join(f.origen, 'web/index.html'), join(f.destino, 'web/index.html'));
      }
    }
    const previo = fs.readdirSync(f.destino).sort();
    assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash));
    assert.deepEqual(fs.readdirSync(f.destino).sort(), previo);
    const conservar = join(f.destino, 'conservar.txt');
    if (fs.existsSync(conservar)) {
      assert.equal(fs.readFileSync(conservar, 'utf8'), 'ajeno');
    }
    sinRestos(f.padre);
  }
});

test('rechaza rutas solapadas, padres simbólicos y raíz simbólica', (t) => {
  const f = escenario(t);
  for (const destino of [f.origen, join(f.origen, 'dist'), f.padre]) {
    assert.throws(() => promoverSalidaConstruida(f.origen, destino, f.hash));
  }
  const enlace = join(f.padre, 'enlace');
  fs.symlinkSync(f.origen, enlace);
  assert.throws(() => promoverSalidaConstruida(enlace, f.destino, f.hash));
  assert.throws(() => promoverSalidaConstruida(f.origen, join(enlace, 'dist'), f.hash));
  fs.symlinkSync(f.origen, f.destino);
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash));
  assert.equal(fs.lstatSync(f.destino).isSymbolicLink(), true);
});

test('reserva exclusiva impide concurrencia y no elimina reservas abandonadas', (t) => {
  const f = escenario(t),
    bloqueo = join(f.padre, '.dist.promocion');
  fs.mkdirSync(bloqueo);
  fs.writeFileSync(join(bloqueo, 'conservar'), 'reserva');
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash), /EEXIST/);
  assert.equal(fs.readFileSync(join(bloqueo, 'conservar'), 'utf8'), 'reserva');
  fs.rmSync(bloqueo, { recursive: true });
  const copiar = fs.copyFileSync;
  let comprobada = false;
  t.mock.method(fs, 'copyFileSync', (...args: Parameters<typeof fs.copyFileSync>) => {
    if (!comprobada) {
      comprobada = true;
      assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash), /EEXIST/);
    }
    return copiar(...args);
  });
  promoverSalidaConstruida(f.origen, f.destino, f.hash);
  assert.equal(comprobada, true);
  sinRestos(f.padre);
});

test('un fallo de copia deja intacta la anterior y limpia solo la etapa propia', (t) => {
  const f = escenario(t),
    hash = artefacto(f.destino, 'previo'),
    copia = instantanea(f.destino);
  t.mock.method(fs, 'copyFileSync', () => {
    throw new Error('fallo de copia');
  });
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash), /fallo de copia/);
  assert.deepEqual(instantanea(f.destino), copia);
  comprobarArtefactoCloudflare(f.destino, hash);
  sinRestos(f.padre);
});

test('vuelve a cotejar el inventario previo después de construir la etapa', (t) => {
  const f = escenario(t);
  artefacto(f.destino, 'previo');
  const copiar = fs.copyFileSync;
  t.mock.method(fs, 'copyFileSync', (...args: Parameters<typeof fs.copyFileSync>) => {
    fs.writeFileSync(join(f.destino, 'conservar.txt'), 'aparecido durante la copia');
    return copiar(...args);
  });
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash));
  assert.equal(fs.readFileSync(join(f.destino, 'conservar.txt'), 'utf8'), 'aparecido durante la copia');
  assert.equal(fs.readFileSync(join(f.destino, 'web/index.html'), 'utf8'), 'previo');
  sinRestos(f.padre);
});

test('restaura la anterior cuando falla el renombrado final', (t) => {
  const f = escenario(t),
    hash = artefacto(f.destino, 'previo'),
    copia = instantanea(f.destino);
  const renombrar = fs.renameSync;
  t.mock.method(fs, 'renameSync', (origen: fs.PathLike, destino: fs.PathLike) => {
    if (String(origen).endsWith('/nuevo')) {
      throw new Error('fallo al publicar');
    }
    return renombrar(origen, destino);
  });
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash), /fallo al publicar/);
  assert.deepEqual(instantanea(f.destino), copia);
  comprobarArtefactoCloudflare(f.destino, hash);
  sinRestos(f.padre);
});

test('conserva respaldo verificable y su ruta cuando también falla la restauración', (t) => {
  const f = escenario(t),
    hash = artefacto(f.destino, 'previo');
  const renombrar = fs.renameSync;
  t.mock.method(fs, 'renameSync', (origen: fs.PathLike, destino: fs.PathLike) => {
    if (String(origen).endsWith('/nuevo') || String(origen).endsWith('/anterior')) {
      throw new Error('fallo de renombrado');
    }
    return renombrar(origen, destino);
  });
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash), /se conserva la etapa de recuperación/);
  const etapas = fs.readdirSync(f.padre).filter((n) => n.startsWith('.dist.etapa-'));
  assert.equal(etapas.length, 1);
  comprobarArtefactoCloudflare(join(f.padre, etapas[0] as string, 'anterior'), hash);
  assert.equal(fs.existsSync(f.destino), false);
  assert.equal(fs.existsSync(join(f.padre, '.dist.promocion')), false);
});

test('una carpeta que aparece al reemplazar no se sobrescribe ni se borra', (t) => {
  const f = escenario(t),
    hash = artefacto(f.destino, 'previo');
  const renombrar = fs.renameSync;
  t.mock.method(fs, 'renameSync', (origen: fs.PathLike, destino: fs.PathLike) => {
    const resultado = renombrar(origen, destino);
    if (String(destino).endsWith('/anterior')) {
      fs.mkdirSync(f.destino);
      fs.writeFileSync(join(f.destino, 'ajeno'), 'conservar');
    }
    return resultado;
  });
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash), /se conserva la etapa de recuperación/);
  assert.equal(fs.readFileSync(join(f.destino, 'ajeno'), 'utf8'), 'conservar');
  const etapa = fs.readdirSync(f.padre).find((n) => n.startsWith('.dist.etapa-')) as string;
  comprobarArtefactoCloudflare(join(f.padre, etapa, 'anterior'), hash);
});

test('copia una fuente de otro volumen sin renombrarla ni enlazar sus archivos', (t) => {
  const f = escenario(t);
  const externa = fs.mkdtempSync(join(fs.realpathSync('/tmp'), 'salida-construida-origen-'));
  t.after(() => fs.rmSync(externa, { recursive: true, force: true }));
  const hash = artefacto(externa, 'otro volumen');
  const previo = instantanea(externa),
    renombrar = fs.renameSync;
  t.mock.method(fs, 'renameSync', (origen: fs.PathLike, destino: fs.PathLike) => {
    assert.equal(String(origen).startsWith(externa), false);
    return renombrar(origen, destino);
  });
  promoverSalidaConstruida(externa, f.destino, hash);
  comprobarArtefactoCloudflare(f.destino, hash);
  assert.deepEqual(instantanea(externa), previo);
  assert.deepEqual(instantanea(f.destino), previo);
  assert.equal(fs.statSync(join(f.destino, 'artefacto.json')).nlink, 1);
  t.diagnostic(`Dispositivos origen=${fs.statSync(externa).dev}, destino=${fs.statSync(f.destino).dev}`);
});

test('restaura la anterior si la verificación posterior al renombrado encuentra alteración', (t) => {
  const f = escenario(t),
    hash = artefacto(f.destino, 'previo'),
    copia = instantanea(f.destino);
  const renombrar = fs.renameSync;
  t.mock.method(fs, 'renameSync', (origen: fs.PathLike, destino: fs.PathLike) => {
    const resultado = renombrar(origen, destino);
    if (String(origen).endsWith('/nuevo')) {
      fs.writeFileSync(join(f.destino, 'web/index.html'), 'alterado después de renombrar');
    }
    return resultado;
  });
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash));
  assert.deepEqual(instantanea(f.destino), copia);
  comprobarArtefactoCloudflare(f.destino, hash);
  sinRestos(f.padre);
});

test('un fallo de renombrado sin salida anterior elimina solo su reserva vacía', (t) => {
  const f = escenario(t),
    fuente = instantanea(f.origen);
  t.mock.method(fs, 'renameSync', () => {
    throw new Error('fallo de renombrado');
  });
  assert.throws(() => promoverSalidaConstruida(f.origen, f.destino, f.hash), /fallo de renombrado/);
  assert.deepEqual(fs.readdirSync(f.padre), ['origen']);
  assert.deepEqual(instantanea(f.origen), fuente);
});
