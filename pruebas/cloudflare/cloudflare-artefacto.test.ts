import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';

const REVISION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HUELLA_AJENA = '0000000000000000000000000000000000000000000000000000000000000000';
const TAMANO_EXCESIVO = 1_073_741_825;
const PLAZO_CLI_MS = 5_000;
const DESCRIPTOR_EXCESIVO = 8_388_609;
const WORKER_EXCESIVO = 67_108_865;
const ASSET_EXCESIVO = 26_214_401;
const CANTIDAD_ASSETS_EXCESIVA = 20_001;

import {
  comprobarArtefactoCloudflare,
  exportarArtefactoCloudflare,
  leerDescriptorArtefactoCloudflare,
} from '../../herramientas/cloudflare/artefacto.ts';

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function bytes(valor: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(valor, null, 2)}\n`);
}
function cli(...argumentos: string[]) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../../herramientas/cloudflare/artefacto.ts', import.meta.url)), ...argumentos],
    { encoding: 'utf8', timeout: PLAZO_CLI_MS, env: {} },
  );
}
function contenidosFixture() {
  const dato = bytes({ datos: 'fixture' });
  const manifiesto = bytes({ 'uno.json': { sha256: sha(dato) } });
  const version = versionDelPaquete(sha(manifiesto));
  const motor = Buffer.from('export const motor = 1;\n');
  const archivos = new Map<string, Buffer>([
    ['worker/worker.mjs', Buffer.from("import datos from './datos/uno.json'; export default datos;\n")],
    ['worker/datos/uno.json', dato],
    ['web/index.html', Buffer.from('<!doctype html>')],
    ['web/administracion/panel.js', Buffer.from('export const privado = true;')],
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
function fixture() {
  const padre = mkdtempSync(join(realpathSync(tmpdir()), 'artefacto Año 2026-'));
  const destino = join(padre, 'entrega');
  mkdirSync(destino);
  const { archivos, version, manifiesto } = contenidosFixture();
  for (const [ruta, contenido] of archivos) {
    mkdirSync(dirname(join(destino, ruta)), { recursive: true });
    writeFileSync(join(destino, ruta), contenido);
  }
  const descriptor = {
    version: 1,
    revisionCodigo: REVISION,
    huellaPaquete: version,
    sha256ManifiestoPaquete: sha(manifiesto),
    sha256ManifiestoDispositivo: sha(archivos.get('web/firmas/manifiesto.json') as Buffer),
    archivos: [...archivos]
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([ruta, contenido]) => ({ ruta, bytes: contenido.byteLength, sha256: sha(contenido) })),
  };
  const sellar = () => {
    const contenido = bytes(descriptor);
    writeFileSync(join(destino, 'artefacto.json'), contenido);
    return sha(contenido);
  };
  const hash = sellar();
  return {
    padre,
    destino,
    archivos,
    descriptor,
    sellar,
    hash,
    limpiar: () => rmSync(padre, { recursive: true, force: true }),
  };
}
test('verifica una entrega privada trasladada sin origen ni recompilación y devuelve resumen cerrado', () => {
  const f = fixture();
  try {
    const resumen = comprobarArtefactoCloudflare(f.destino, f.hash);
    assert.deepEqual(Object.keys(resumen).sort(), [
      'archivos',
      'bytesTotales',
      'huellaPaquete',
      'revisionCodigo',
      'sha256Artefacto',
      'version',
    ]);
    assert.equal(resumen.archivos, f.archivos.size);
    const entrada = join(f.destino, 'worker/worker.mjs');
    assert.match(readFileSync(entrada, 'utf8'), /from '\.\/datos\/uno\.json'/);
    assert.deepEqual(readFileSync(join(dirname(entrada), 'datos/uno.json')), f.archivos.get('worker/datos/uno.json'));
    assert.ok(f.descriptor.archivos.every((a) => a.ruta.startsWith('worker/') || a.ruta.startsWith('web/')));
    assert.equal(resumen.sha256Artefacto, f.hash);
    assert.equal(
      resumen.bytesTotales,
      [...f.archivos.values()].reduce((s, v) => s + v.byteLength, 0),
    );
  } finally {
    f.limpiar();
  }
});
test('SHA externa incorrecta, descriptor alterado o versión desconocida rechazan', () => {
  const f = fixture();
  try {
    assert.throws(() => comprobarArtefactoCloudflare(f.destino, HUELLA_AJENA));
    assert.throws(() => comprobarArtefactoCloudflare(f.destino, 'no-huella'));
    writeFileSync(join(f.destino, 'artefacto.json'), bytes({ ...f.descriptor, version: 2 }));
    assert.throws(() => comprobarArtefactoCloudflare(f.destino, sha(readFileSync(join(f.destino, 'artefacto.json')))));
  } finally {
    f.limpiar();
  }
});
test('corrupción, omisión y archivo o directorio sobrante impiden acreditar entrega', () => {
  for (const defecto of ['corrupcion', 'omision', 'extra', 'directorio']) {
    const f = fixture();
    try {
      if (defecto === 'corrupcion') {
        writeFileSync(join(f.destino, 'worker/worker.mjs'), 'alterado');
      }
      if (defecto === 'omision') {
        rmSync(join(f.destino, 'worker/worker.mjs'));
      }
      if (defecto === 'extra') {
        writeFileSync(join(f.destino, 'extra'), 'no');
      }
      if (defecto === 'directorio') {
        mkdirSync(join(f.destino, 'extra'));
      }
      assert.throws(() => comprobarArtefactoCloudflare(f.destino, f.hash));
    } finally {
      f.limpiar();
    }
  }
});
test('archivo y directorio enlazados, incluso dentro del inventario, son rechazados', () => {
  const raiz = fixture();
  try {
    const enlace = join(raiz.padre, 'alias');
    symlinkSync(raiz.destino, enlace);
    assert.throws(() => comprobarArtefactoCloudflare(`${enlace}/`, raiz.hash));
  } finally {
    raiz.limpiar();
  }
  for (const enlace of ['worker/worker.mjs', 'web/administracion']) {
    const f = fixture();
    try {
      const ajeno = join(f.padre, 'ajeno');
      if (enlace === 'worker/worker.mjs') {
        copyFileSync(join(f.destino, enlace), ajeno);
      } else {
        mkdirSync(ajeno);
      }
      rmSync(join(f.destino, enlace), { recursive: true });
      symlinkSync(ajeno, join(f.destino, enlace));
      assert.throws(() => comprobarArtefactoCloudflare(f.destino, f.hash));
    } finally {
      f.limpiar();
    }
  }
});
test('inventario cerrado rechaza rutas, duplicados, tipos, desorden y topes aunque SHA coincida', () => {
  for (const defecto of ['ruta', 'duplicado', 'desorden', 'booleano', 'tamano']) {
    const f = fixture();
    try {
      const a = f.descriptor.archivos[0];
      assert.ok(a);
      if (defecto === 'ruta') {
        a.ruta = '../fuera';
      }
      if (defecto === 'duplicado') {
        f.descriptor.archivos.push(a);
      }
      if (defecto === 'desorden') {
        f.descriptor.archivos.reverse();
      }
      if (defecto === 'tamano') {
        a.bytes = TAMANO_EXCESIVO;
      }
      const o: unknown = f.descriptor;
      if (defecto === 'booleano') {
        (a as unknown as { bytes: boolean }).bytes = true;
      }
      const contenido = bytes(o);
      writeFileSync(join(f.destino, 'artefacto.json'), contenido);
      assert.throws(() => comprobarArtefactoCloudflare(f.destino, sha(contenido)));
    } finally {
      f.limpiar();
    }
  }
});
test('Data diferente del paquete se rechaza aunque descriptor y archivo hayan sido actualizados juntos', () => {
  const f = fixture();
  try {
    const nuevo = bytes({ otro: true });
    writeFileSync(join(f.destino, 'worker/datos/uno.json'), nuevo);
    const a = f.descriptor.archivos.find((v) => v.ruta === 'worker/datos/uno.json');
    assert.ok(a);
    a.bytes = nuevo.byteLength;
    a.sha256 = sha(nuevo);
    assert.throws(() => comprobarArtefactoCloudflare(f.destino, f.sellar()));
  } finally {
    f.limpiar();
  }
});
test('huellas de manifiestos y referencia del motor siguen vinculadas con los bytes copiados', () => {
  for (const defecto of ['paquete', 'dispositivo', 'motor']) {
    const f = fixture();
    try {
      if (defecto === 'paquete') {
        f.descriptor.huellaPaquete = versionDelPaquete(HUELLA_AJENA);
      }
      if (defecto === 'dispositivo') {
        f.descriptor.sha256ManifiestoDispositivo = HUELLA_AJENA;
      }
      if (defecto === 'motor') {
        const contenido = Buffer.from('otro motor');
        writeFileSync(join(f.destino, 'web/motor/entrada.js'), contenido);
        const a = f.descriptor.archivos.find((v) => v.ruta === 'web/motor/entrada.js');
        assert.ok(a);
        a.bytes = contenido.byteLength;
        a.sha256 = sha(contenido);
      }
      assert.throws(() => comprobarArtefactoCloudflare(f.destino, f.sellar()));
    } finally {
      f.limpiar();
    }
  }
});
test('exportador rechaza destino preexistente y referencias inválidas antes de compilar o sustituir', async () => {
  const f = fixture();
  try {
    const original = readFileSync(join(f.destino, 'artefacto.json'));
    const contexto = { web: RUTAS.web, paquete: RUTAS.paquete, motor: new Map(), huellaMapaModulos: '' };
    await assert.rejects(exportarArtefactoCloudflare(f.destino, REVISION, f.descriptor.huellaPaquete, contexto));
    await assert.rejects(
      exportarArtefactoCloudflare(join(f.padre, 'nuevo'), 'main', f.descriptor.huellaPaquete, contexto),
    );
    await assert.rejects(exportarArtefactoCloudflare(join(f.padre, 'nuevo'), REVISION, 'incorrecta', contexto));
    assert.deepEqual(readFileSync(join(f.destino, 'artefacto.json')), original);
  } finally {
    f.limpiar();
  }
});
test('descriptor suelto se valida antes del payload y la CLI devuelve el mismo contrato', () => {
  const f = fixture();
  try {
    const archivo = join(f.padre, 'Descriptor Año 2026.json');
    copyFileSync(join(f.destino, 'artefacto.json'), archivo);
    rmSync(f.destino, { recursive: true });
    assert.deepEqual(leerDescriptorArtefactoCloudflare(archivo, f.hash), f.descriptor);
    const resultado = cli('descriptor', archivo, '--sha256', f.hash);
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.equal(resultado.stderr, '');
    assert.deepEqual(JSON.parse(resultado.stdout), f.descriptor);
    assert.equal(resultado.stdout, `${JSON.stringify(f.descriptor)}\n`);
  } finally {
    f.limpiar();
  }
});
test('lector del descriptor exige SHA externa y rechaza esquema, rutas y cotas antes de abrir payload', () => {
  const f = fixture();
  try {
    const archivo = join(f.destino, 'artefacto.json');
    assert.throws(() => leerDescriptorArtefactoCloudflare(archivo, HUELLA_AJENA));
    assert.throws(() => leerDescriptorArtefactoCloudflare(archivo, 'no-huella'));
    const entrada = { ruta: 'worker/worker.mjs', bytes: 0, sha256: HUELLA_AJENA };
    const variantes = [
      { ...f.descriptor, extra: true },
      { ...f.descriptor, revisionCodigo: 'main' },
      { ...f.descriptor, archivos: [{ ...entrada, ruta: '../fuera' }] },
      { ...f.descriptor, archivos: [{ ...entrada, bytes: true }] },
      { ...f.descriptor, archivos: [{ ...entrada, bytes: WORKER_EXCESIVO }] },
      { ...f.descriptor, archivos: [{ ...entrada, ruta: 'web/index.html', bytes: ASSET_EXCESIVO }] },
      {
        ...f.descriptor,
        archivos: [
          { ...entrada, ruta: 'web/A' },
          { ...entrada, ruta: 'web/a' },
        ],
      },
      {
        ...f.descriptor,
        archivos: Array.from({ length: CANTIDAD_ASSETS_EXCESIVA }, (_, i) => ({
          ...entrada,
          ruta: `web/${String(i).padStart(String(CANTIDAD_ASSETS_EXCESIVA).length, '0')}`,
        })),
      },
    ];
    for (const variante of variantes) {
      const contenido = bytes(variante);
      writeFileSync(archivo, contenido);
      assert.throws(() => leerDescriptorArtefactoCloudflare(archivo, sha(contenido)));
    }
  } finally {
    f.limpiar();
  }
});
test('descriptor local regular y acotado rechaza directorios, symlinks y hardlinks', () => {
  const f = fixture();
  try {
    const archivo = join(f.destino, 'artefacto.json');
    const enlace = join(f.padre, 'descriptor-enlazado.json');
    symlinkSync(archivo, enlace);
    assert.throws(() => leerDescriptorArtefactoCloudflare(enlace, f.hash));
    assert.throws(() => leerDescriptorArtefactoCloudflare(f.destino, f.hash));
    const duro = join(f.padre, 'descriptor-hardlink.json');
    linkSync(archivo, duro);
    assert.throws(() => leerDescriptorArtefactoCloudflare(archivo, f.hash));
    assert.throws(() => leerDescriptorArtefactoCloudflare(duro, f.hash));
    const excesivo = join(f.padre, 'descriptor-excesivo.json');
    writeFileSync(excesivo, Buffer.alloc(DESCRIPTOR_EXCESIVO));
    assert.throws(() => leerDescriptorArtefactoCloudflare(excesivo, HUELLA_AJENA));
  } finally {
    f.limpiar();
  }
});
test('CLI conserva resumen comprobar y errores neutros para descriptor y exportación inválidos', () => {
  const f = fixture();
  try {
    const comprobar = cli('comprobar', f.destino, '--sha256', f.hash);
    assert.equal(comprobar.status, 0, comprobar.stderr);
    assert.deepEqual(JSON.parse(comprobar.stdout), comprobarArtefactoCloudflare(f.destino, f.hash));
    for (const [argumentos, mensaje] of [
      [['descriptor', join(f.destino, 'artefacto.json'), '--sha256', HUELLA_AJENA], /huella/i],
      [
        ['descriptor', join(f.destino, 'artefacto.json'), '--sha256', f.hash, '--revision-codigo', REVISION],
        /argumentos/i,
      ],
      [
        [
          'exportar',
          join(f.padre, 'nuevo'),
          '--revision-codigo',
          'main',
          '--huella-paquete',
          f.descriptor.huellaPaquete,
        ],
        /argumentos/i,
      ],
    ] as const) {
      const resultado = cli(...argumentos);
      assert.equal(resultado.status, 1);
      assert.equal(resultado.stdout, '');
      assert.match(resultado.stderr, mensaje);
      assert.doesNotMatch(resultado.stderr, /artefacto Año 2026/u);
    }
  } finally {
    f.limpiar();
  }
});

test('el destino del descriptor es explícito y suplantarlo cambia su huella', () => {
  const f = fixture();
  try {
    const archivo = join(f.destino, 'artefacto.json');
    for (const destino of ['privado', 'oficial']) {
      const contenido = bytes({ ...f.descriptor, destino });
      writeFileSync(archivo, contenido);
      assert.equal(leerDescriptorArtefactoCloudflare(archivo, sha(contenido)).destino, destino);
      assert.throws(() => leerDescriptorArtefactoCloudflare(archivo, f.hash));
    }
    const contenido = bytes({ ...f.descriptor, destino: 'otro' });
    writeFileSync(archivo, contenido);
    assert.throws(() => leerDescriptorArtefactoCloudflare(archivo, sha(contenido)));
  } finally {
    f.limpiar();
  }
});

test('la comprobación oficial rechaza artefactos privados y acepta su destino íntegro', async () => {
  const { comprobarEntregaOficial } = await import('../ayudas/comprobar-oficial.ts');
  const f = fixture();
  try {
    const archivo = join(f.destino, 'artefacto.json');
    const raiz = fileURLToPath(new URL('../../', import.meta.url));
    for (const destino of ['privado', 'oficial']) {
      const contenido = bytes({ ...f.descriptor, destino });
      writeFileSync(archivo, contenido);
      if (destino === 'privado') {
        assert.throws(() => comprobarEntregaOficial(raiz, f.destino, sha(contenido)));
      } else {
        assert.equal(comprobarEntregaOficial(raiz, f.destino, sha(contenido)).sha256Artefacto, sha(contenido));
      }
    }
  } finally {
    f.limpiar();
  }
});

test('staging acepta solo un artefacto oficial íntegro y configuración aislada', async () => {
  const { comprobarEnsayoProduccion } = await import('../ayudas/comprobar-ensayo-produccion.ts');
  const f = fixture();
  try {
    const raiz = fileURLToPath(new URL('../../', import.meta.url));
    // El ensayo se comprueba junto a producción: solos, sus archivos no demuestran que estén separados.
    for (const nombre of [
      'config/cloudflare/instalaciones/wrangler.ensayo.jsonc',
      'config/cloudflare/instalaciones/wrangler.ensayo-cursos.jsonc',
      'config/cloudflare/instalaciones/wrangler.produccion.jsonc',
      'config/cloudflare/instalaciones/wrangler.produccion-cursos.jsonc',
    ]) {
      mkdirSync(dirname(join(f.padre, nombre)), { recursive: true });
      copyFileSync(join(raiz, nombre), join(f.padre, nombre));
    }
    const dist = join(f.padre, 'dist');
    renameSync(f.destino, dist);
    for (const destino of ['privado', 'oficial']) {
      const contenido = bytes({ ...f.descriptor, destino });
      writeFileSync(join(dist, 'artefacto.json'), contenido);
      if (destino === 'privado') {
        assert.throws(() => comprobarEnsayoProduccion(f.padre, sha(contenido)));
      } else {
        assert.equal(comprobarEnsayoProduccion(f.padre, sha(contenido)).sha256Artefacto, sha(contenido));
      }
    }
  } finally {
    f.limpiar();
  }
});
