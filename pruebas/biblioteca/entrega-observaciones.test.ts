import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarProyeccionLecturas } from '../../herramientas/web/lecturas/observaciones.ts';

const RAIZ = new URL('../../', import.meta.url);
const CATALOGO = new URL('datos/lecturas.json', RAIZ);
const WEB = new URL('web/', RAIZ);
const TOTAL_FICHAS = 75;
const TOTAL_OBJETIVOS = 84;
const TOTAL_EXTERNOS = 83;
const AHORA = '2026-10-23T12:00:00Z';

test('catálogo real sin artefacto conserva 75 fichas, 84 objetivos y una integridad local', () => {
  const temporal = mkdtempSync(join(tmpdir(), 'biblioteca-'));
  try {
    const antes = readFileSync(CATALOGO);
    const salida = cargarProyeccionLecturas({
      catalogo: fileURLToPath(CATALOGO),
      observaciones: join(temporal, 'ausente.json'),
      raizWeb: fileURLToPath(WEB),
      ahora: AHORA,
    });
    assert.equal(salida.disponibilidad_observaciones, 'no_disponible');
    assert.equal(salida.objetivos.length, TOTAL_OBJETIVOS);
    assert.equal(new Set(salida.objetivos.map(({ id }) => id)).size, TOTAL_FICHAS);
    assert.equal(salida.objetivos.filter(({ abrir }) => abrir).length, TOTAL_OBJETIVOS);
    assert.equal(salida.objetivos.filter(({ estado }) => estado === 'sin_observacion').length, TOTAL_EXTERNOS);
    assert.deepEqual(readFileSync(CATALOGO), antes);
  } finally {
    rmSync(temporal, { recursive: true });
  }
});
test('entrega completa real sin consultas no se transforma en verificación ni vacía el catálogo', () => {
  const temporal = mkdtempSync(join(tmpdir(), 'biblioteca-'));
  try {
    const ruta = join(temporal, 'observaciones.json');
    const entrada = {
      catalogo: fileURLToPath(CATALOGO),
      observaciones: ruta,
      raizWeb: fileURLToPath(WEB),
      ahora: AHORA,
    };
    const inventario = cargarProyeccionLecturas(entrada).objetivos;
    const objetivos = inventario.map(({ objetivo, id, campo, url }) => ({
      objetivo,
      id,
      campo,
      url,
      estado: url?.startsWith('https://') ? 'sin_observacion' : 'no_aplica_consulta_remota',
      ultimo_intento: null,
      ultima_confirmacion: null,
      ultima_evidencia: null,
    }));
    writeFileSync(
      ruta,
      JSON.stringify({
        version: 2,
        catalogo_sha256: createHash('sha256').update(readFileSync(CATALOGO)).digest('hex'),
        validez_dias: 7,
        revision_editorial: 'fuera_del_alcance',
        objetivos,
        verificados: 0,
      }),
    );
    const salida = cargarProyeccionLecturas(entrada);
    assert.equal(salida.disponibilidad_observaciones, 'disponible');
    assert.deepEqual(salida.objetivos, inventario);
    const fecha = readFileSync(ruta);
    assert.deepEqual(cargarProyeccionLecturas(entrada), salida);
    assert.deepEqual(readFileSync(ruta), fecha);
  } finally {
    rmSync(temporal, { recursive: true });
  }
});
test('JSON malformado no se silencia como ausencia y la entrega editorial queda intacta', () => {
  const temporal = mkdtempSync(join(tmpdir(), 'biblioteca-'));
  try {
    const ruta = join(temporal, 'observaciones.json');
    const antes = readFileSync(CATALOGO);
    writeFileSync(ruta, '{');
    assert.throws(() =>
      cargarProyeccionLecturas({
        catalogo: fileURLToPath(CATALOGO),
        observaciones: ruta,
        raizWeb: fileURLToPath(WEB),
        ahora: AHORA,
      }),
    );
    assert.deepEqual(readFileSync(CATALOGO), antes);
  } finally {
    rmSync(temporal, { recursive: true });
  }
});
