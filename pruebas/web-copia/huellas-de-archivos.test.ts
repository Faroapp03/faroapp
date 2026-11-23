// HUELLAS_DE_ARCHIVOS (copia-sin-conexion.ts): la preparación de la web escribe en el catálogo del service worker la
// huella SHA-256 de cada archivo de ARCHIVOS y BAJO_DEMANDA, de sus bytes publicados, y la comprobación la exige: una
// huella que falta o que no cuadra hace fallar web:comprobar. La VERSION la cubre: cambiar los bytes de un archivo cambia
// su huella y también la VERSION.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copiaAislada, entradaDePrueba } from './aislada.ts';

const PROGRAMA = `
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comprobarServiceWorker, generarCatalogos } from './copia-sin-conexion.ts';
import { contexto, HUELLA } from './contexto-de-prueba.ts';
import { leer, WEB } from './publicados.ts';
import { listasDelCatalogo, valoresDelServicio } from './servicio/servicio-publicado.ts';
const publicados = ${JSON.stringify(Object.keys(entradaDePrueba()))}.concat(
  'estilos/base.css',
  'imagenes/fotografias/casa.webp',
  'imagenes/fotografias/casa-800.webp',
);
const SERVICIO = 'service-worker.js';
const valores = () => {
  const leidos = valoresDelServicio(leer(SERVICIO));
  return { ...leidos, ...listasDelCatalogo(leidos.CATALOGO) };
};
const sha256 = (ruta) => createHash('sha256').update(readFileSync(join(WEB, ruta))).digest('hex');
await generarCatalogos(publicados, HUELLA, contexto());
const generado = leer(SERVICIO);
const { ARCHIVOS, BAJO_DEMANDA, HUELLAS_DE_ARCHIVOS, VERSION } = valores();
const resultado = {
  rutas: HUELLAS_DE_ARCHIVOS.map(([ruta]) => ruta),
  deLaCopia: [...ARCHIVOS, ...BAJO_DEMANDA].sort(),
  todasCuadran: HUELLAS_DE_ARCHIVOS.every(([ruta, huella]) => huella === sha256(ruta)),
  alGenerar: await comprobarServiceWorker(publicados, HUELLA, contexto()),
};
const sinUna = valores().CATALOGO.filter(([ruta]) => ruta !== 'estilos/base.css');
writeFileSync(
  join(WEB, SERVICIO),
  generado.replace(/^var CATALOGO = .*;$/m, () => 'var CATALOGO = ' + JSON.stringify(sinUna) + ';'),
);
resultado.sinUna = await comprobarServiceWorker(publicados, HUELLA, contexto());
writeFileSync(join(WEB, SERVICIO), generado);
writeFileSync(join(WEB, 'estilos/base.css'), 'p { color: red; }');
resultado.otroEstilo = await comprobarServiceWorker(publicados, HUELLA, contexto());
await generarCatalogos(publicados, HUELLA, contexto());
resultado.otraVersion = valores().VERSION !== VERSION;
resultado.otraHuella =
  valores().HUELLAS_DE_ARCHIVOS.find(([ruta]) => ruta === 'estilos/base.css')?.[1] === sha256('estilos/base.css');
process.stdout.write(JSON.stringify(resultado));
`;

test('cada archivo de ARCHIVOS y BAJO_DEMANDA lleva su huella, y una que falta o no cuadra no pasa', () => {
  const archivos = {
    ...entradaDePrueba(),
    'estilos/base.css': 'p { color: black; }',
    'imagenes/fotografias/casa.webp': 'FOTO',
    'imagenes/fotografias/casa-800.webp': 'FOTO REDUCIDA',
    'motor/src/plataforma/navegador/motor.js': 'export const motor = true;\n',
  };
  const r = JSON.parse(copiaAislada(archivos, PROGRAMA));
  assert.deepEqual(r.rutas, r.deLaCopia, 'una huella por cada archivo de la copia, ni más ni menos');
  assert.deepEqual(r.rutas, [
    'estilos/base.css',
    'imagenes/fotografias/casa-800.webp',
    'imagenes/fotografias/casa.webp',
    'p.html',
  ]);
  assert.equal(r.todasCuadran, true, 'cada huella es la de los bytes publicados');
  assert.deepEqual(r.alGenerar, []);
  assert.ok(
    r.sinUna.some((problema: string) => problema.includes('falta «estilos/base.css» en ARCHIVOS')),
    `Sin su entrada (ruta y huella) en el CATALOGO, la comprobación falla: ${r.sinUna}`,
  );
  assert.ok(
    r.otroEstilo.some((problema: string) =>
      problema.includes('la huella de «estilos/base.css» en HUELLAS_DE_ARCHIVOS no es la de lo publicado'),
    ),
    `Con otros bytes, su huella no cuadra: ${r.otroEstilo}`,
  );
  assert.ok(
    r.otroEstilo.some((problema: string) => problema.includes('VERSION es')),
    'y la VERSION tampoco',
  );
  assert.equal(r.otraVersion, true, 'al volver a generar, otra VERSION');
  assert.equal(r.otraHuella, true, 'y la huella nueva es la de los bytes nuevos');
});
