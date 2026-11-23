import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, type TestContext, test } from 'node:test';
import { publicarPaquete } from '../../herramientas/publicar-paquete.ts';
import { comprobarArtefactos } from '../../herramientas/web/comprobar-artefactos.ts';
import { empaquetarMotor } from '../../herramientas/web/empaquetado/construccion.ts';
import { FORMA_DEL_PAQUETE } from '../../herramientas/web/empaquetado.ts';
import {
  MANIFIESTO_PUBLICADO,
  manifiestoConElPaqueteDeOrigen,
  manifiestoDelDispositivo,
} from '../../herramientas/web/manifiesto-del-dispositivo.ts';

// Un solo empaquetado real del motor; todos los casos cotejan contra esta misma captura.
let motor: ReadonlyMap<string, Uint8Array>;
before(async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'artefactos-motor-'));
  try {
    motor = (await empaquetarMotor(join(carpeta, 'web'), FORMA_DEL_PAQUETE)).archivos;
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

function escribir(carpeta: string, archivo: string, bytes: Uint8Array | string): void {
  const ruta = join(carpeta, archivo);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, bytes);
}

function candidato(t: TestContext) {
  const raiz = mkdtempSync(join(tmpdir(), 'artefactos Año 2026 '));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const web = join(raiz, 'web');
  const paquete = join(raiz, 'datos');
  const texto = '{ "texto": "Año 2026 😀" }\n';
  escribir(paquete, 'a.json', texto);
  escribir(
    paquete,
    'manifiesto.json',
    `${JSON.stringify({ 'a.json': { sha256: createHash('sha256').update(texto).digest('hex') } })}\n`,
  );
  for (const [archivo, bytes] of motor) {
    escribir(web, archivo, bytes);
  }
  const version = publicarPaquete(paquete, web);
  escribir(web, MANIFIESTO_PUBLICADO, manifiestoConElPaqueteDeOrigen(web, paquete));
  return { raiz, web, paquete, version };
}

test('acepta el motor realmente compilado, paquete UTF-8 y manifiesto exactos sin escribir', (t) => {
  const { web, paquete, version } = candidato(t);
  const antes = readFileSync(join(web, MANIFIESTO_PUBLICADO));
  assert.equal(comprobarArtefactos(web, paquete, motor), version);
  assert.deepEqual(readFileSync(join(web, MANIFIESTO_PUBLICADO)), antes);
});

test('rechaza un motor obsoleto aunque los dos manifiestos recalculados coincidan', (t) => {
  const { web, paquete, version } = candidato(t);
  escribir(web, 'motor/src/plataforma/navegador/motor.js', 'export const antiguo = true;\n');
  escribir(web, MANIFIESTO_PUBLICADO, manifiestoConElPaqueteDeOrigen(web, paquete));
  assert.deepEqual(manifiestoDelDispositivo(web, version), manifiestoConElPaqueteDeOrigen(web, paquete));
  assert.throws(
    () => comprobarArtefactos(web, paquete, motor),
    /Artefacto desactualizado: Contenido distinto en .*motor\.js/u,
  );
});

test('rechaza datos embebidos antiguos aunque el manifiesto del dispositivo los describa', (t) => {
  const { web, paquete, version } = candidato(t);
  const [conLosDatos] = [...motor].sort(([, a], [, b]) => b.byteLength - a.byteLength);
  assert.ok(conLosDatos);
  escribir(web, conLosDatos[0], 'export default {};\n');
  escribir(web, MANIFIESTO_PUBLICADO, manifiestoConElPaqueteDeOrigen(web, paquete));
  assert.deepEqual(manifiestoDelDispositivo(web, version), manifiestoConElPaqueteDeOrigen(web, paquete));
  assert.throws(() => comprobarArtefactos(web, paquete, motor), /Artefacto desactualizado: Contenido distinto en /u);
});

test('rechaza paquete publicado anterior, archivo sobrante y origen que no respeta su SHA', (t) => {
  const { web, paquete, version } = candidato(t);
  const publicado = join(web, 'paquete', version, 'a.json');
  const original = readFileSync(publicado);
  writeFileSync(publicado, '{}');
  assert.throws(
    () => comprobarArtefactos(web, paquete, motor),
    /Artefacto desactualizado: Contenido distinto en .*a\.json/u,
  );
  writeFileSync(publicado, original);
  escribir(web, 'paquete/anterior/ajeno.json', '{}');
  assert.throws(() => comprobarArtefactos(web, paquete, motor), /Artefacto desactualizado: Sobra en .*ajeno\.json/u);
  rmSync(join(web, 'paquete/anterior'), { recursive: true });
  escribir(paquete, 'a.json', '{}');
  writeFileSync(publicado, '{}');
  assert.throws(() => comprobarArtefactos(web, paquete, motor), /El origen no coincide con su huella/u);
});

test('rechaza un motor al que le falta un archivo o le sobra uno', (t) => {
  const { web, paquete } = candidato(t);
  const [primero] = [...motor.keys()].sort();
  assert.ok(primero);
  rmSync(join(web, primero));
  assert.throws(() => comprobarArtefactos(web, paquete, motor), /Artefacto desactualizado: Falta en .*motor/u);
  escribir(web, primero, motor.get(primero) ?? '');
  escribir(web, 'motor/c.js', 'export const c = 1;\n');
  assert.throws(() => comprobarArtefactos(web, paquete, motor), /Artefacto desactualizado: Sobra en .*motor.*c\.js/u);
});

test('rechaza manifiesto anterior y una firma histórica sin retirarlos', (t) => {
  const { web, paquete } = candidato(t);
  const ruta = join(web, MANIFIESTO_PUBLICADO);
  const original = readFileSync(ruta);
  writeFileSync(ruta, '{}');
  assert.throws(
    () => comprobarArtefactos(web, paquete, motor),
    /Artefacto desactualizado: Contenido distinto en .*manifiesto\.json/u,
  );
  writeFileSync(ruta, original);
  const firma = join(web, 'firmas/manifiesto.firma.json');
  writeFileSync(firma, '{"firma":"anterior"}');
  assert.throws(() => comprobarArtefactos(web, paquete, motor), /Sobra en .*manifiesto\.firma\.json/u);
  assert.equal(readFileSync(firma, 'utf8'), '{"firma":"anterior"}');
});

test('rechaza enlaces que el listado ordinario omitiría, incluido un destino de motor enlazado', (t) => {
  const { raiz, web, paquete } = candidato(t);
  const externo = join(raiz, 'ajeno.json');
  writeFileSync(externo, '{}');
  const enlace = join(web, 'motor/ajeno.json');
  symlinkSync(externo, enlace);
  assert.throws(() => comprobarArtefactos(web, paquete, motor), /enlaces ni entradas especiales/u);
  rmSync(enlace);
  rmSync(join(web, 'motor'), { recursive: true });
  symlinkSync(dirname(externo), join(web, 'motor'));
  assert.throws(() => comprobarArtefactos(web, paquete, motor), /carpeta propia/u);
  assert.equal(readFileSync(externo, 'utf8'), '{}');
});
