import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  capturarRevisiones,
  diagnosticoClasificacion,
  prepararDiagnosticoClasificacion,
} from '../../herramientas/web/diagnostico-clasificacion.ts';
import { empaquetarEntradasDelMotor, empaquetarZona } from '../../herramientas/web/empaquetado/construccion.ts';
import { crearEvaluadorClasificacion, evaluarClasificacion } from '../../src/catalogo-cursos/clasificacion.ts';
import { type OfertaCatalogo, VERSION_CATALOGO } from '../../src/catalogo-cursos/contrato.ts';
import { firmaEditorial, identidadEditorial } from '../../src/catalogo-cursos/firma-editorial.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';

const BASE = JSON.parse(readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url), 'utf8'));
const CIFRAS_SHA = 64;
function editorial(oferta: OfertaCatalogo) {
  return {
    schemaVersion: 1,
    catalogoSha256: 'a'.repeat(CIFRAS_SHA),
    programas: [
      {
        programaId: oferta.unidad.programa_id,
        titulo: oferta.titulo_programa,
        proveedorId: oferta.proveedor_id,
        temas: ['ia'] as const,
        motivoTemas: { es: 'Materia.', ca: 'Matèria.' },
        nivel: {
          valor: null,
          origen: 'por-confirmar' as const,
          literal: null,
          motivo: { es: 'Sin nivel.', ca: 'Sense nivell.' },
          evidencia: null,
          alcance: null,
          escala: null,
        },
      },
    ],
    unidadesRevisadas: { [identidadEditorial(oferta)]: firmaEditorial(oferta) },
  };
}

test('la candidata usa el evaluador común y conserva las huellas de las entradas', (t) => {
  const web = mkdtempSync(join(tmpdir(), 'diagnostico-clasificacion-'));
  t.after(() => rmSync(web, { recursive: true, force: true }));
  mkdirSync(join(web, 'datos/catalogo-cursos'), { recursive: true });
  mkdirSync(join(web, 'administracion'));
  const bytes = Buffer.from(JSON.stringify(BASE));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ruta = `datos/catalogo-cursos/${sha256}.json`;
  const referencia = { ruta, sha256, bytes: bytes.length, revision: BASE.revision as string };
  writeFileSync(join(web, ruta), bytes);
  const plantilla = readFileSync(new URL('../../web/administracion/clasificacion-catalogo.js', import.meta.url));
  writeFileSync(join(web, 'administracion/clasificacion-catalogo.js'), plantilla);
  const leido = leerCatalogo(bytes, referencia);
  const oferta = leido.ofertas[0];
  assert.ok(oferta);
  const revision = editorial(oferta);
  const editorialBytes = Buffer.from(JSON.stringify(revision));
  const diagnostico = diagnosticoClasificacion(web, referencia, editorialBytes);
  assert.ok(diagnostico);
  assert.equal(diagnostico.catalogoSha256, sha256);
  assert.equal(diagnostico.revision, referencia.revision);
  assert.equal(diagnostico.revisionEditorialSha256, createHash('sha256').update(editorialBytes).digest('hex'));
  assert.equal(diagnostico.total, leido.ofertas.length);
  assert.deepEqual(
    diagnostico.unidades.map((u) => u.revision),
    leido.ofertas.map((o) => crearEvaluadorClasificacion(revision).evaluarClasificacion(o).revision),
  );
  assert.deepEqual(diagnostico.unidades[0]?.revision, { estado: 'aplicada' });
  assert.deepEqual(diagnostico.unidades[0]?.revisionNivel, { estado: 'no-aplicada', motivo: 'nivel-por-confirmar' });
  assert.match(diagnostico.revisionMateriasSha256, /^[a-f0-9]{64}$/u);
  const otra = { ...revision, unidadesRevisadas: { [identidadEditorial(oferta)]: 'b'.repeat(CIFRAS_SHA) } };
  const cambiado = diagnosticoClasificacion(web, referencia, Buffer.from(JSON.stringify(otra)));
  assert.deepEqual(cambiado?.unidades[0]?.revision, { estado: 'no-aplicada', motivo: 'firma-distinta' });
  assert.notEqual(cambiado?.revisionEditorialSha256, diagnostico.revisionEditorialSha256);
  comprobarRechazos({ web, referencia, revision, editorialBytes, ruta, plantilla });
});

function comprobarRechazos({
  web,
  referencia,
  revision,
  editorialBytes,
  ruta,
  plantilla,
}: {
  web: string;
  referencia: { ruta: string; sha256: string; bytes: number; revision: string };
  revision: ReturnType<typeof editorial>;
  editorialBytes: Buffer;
  ruta: string;
  plantilla: Buffer;
}): void {
  for (const invalido of [
    '{',
    JSON.stringify({ ...revision, programas: [revision.programas[0], revision.programas[0]] }),
    JSON.stringify({ ...revision, unidadesRevisadas: { mal: 'x' } }),
    JSON.stringify({ ...revision, programas: [{ ...revision.programas[0], nivel: { evidencia: null } }] }),
  ]) {
    assert.throws(() => diagnosticoClasificacion(web, referencia, Buffer.from(invalido)));
  }
  assert.throws(() => diagnosticoClasificacion(web, referencia, editorialBytes, Buffer.from('{')));
  assert.throws(() =>
    diagnosticoClasificacion(
      web,
      referencia,
      editorialBytes,
      Buffer.from(JSON.stringify({ schemaVersion: 1, programas: [{ programaId: 'sin-evidencia' }] })),
    ),
  );
  prepararDiagnosticoClasificacion(web, referencia, editorialBytes);
  assert.match(
    readFileSync(join(web, 'administracion/clasificacion-catalogo.js'), 'utf8'),
    /DIAGNOSTICO_CLASIFICACION = \{/u,
  );
  assert.throws(() => prepararDiagnosticoClasificacion(web, referencia, editorialBytes), /plantilla/u);
  writeFileSync(join(web, 'administracion/clasificacion-catalogo.js'), plantilla);
  writeFileSync(join(web, ruta), 'corrupto');
  assert.throws(() => prepararDiagnosticoClasificacion(web, referencia, editorialBytes));
  rmSync(join(web, ruta));
  assert.throws(() => diagnosticoClasificacion(web, referencia, editorialBytes));
  assert.equal(diagnosticoClasificacion(web, null, editorialBytes), null);
  prepararDiagnosticoClasificacion(web, null, editorialBytes);
  assert.match(readFileSync(join(web, 'administracion/clasificacion-catalogo.js'), 'utf8'), /= null;/u);
}

test('un catálogo válido sin ofertas produce cero, no ausencia', (t) => {
  const web = mkdtempSync(join(tmpdir(), 'diagnostico-vacio-'));
  t.after(() => rmSync(web, { recursive: true, force: true }));
  mkdirSync(join(web, 'datos/catalogo-cursos'), { recursive: true });
  const bytes = Buffer.from(
    JSON.stringify({ ...BASE, ofertas: [], proveedores: [], cobertura: { edicion: 0, recurso: 0 } }),
  );
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ruta = `datos/catalogo-cursos/${sha256}.json`;
  writeFileSync(join(web, ruta), bytes);
  const editorialBytes = Buffer.from(
    JSON.stringify({ schemaVersion: 1, catalogoSha256: 'a'.repeat(CIFRAS_SHA), programas: [], unidadesRevisadas: {} }),
  );
  const resultado = diagnosticoClasificacion(
    web,
    { ruta, sha256, bytes: bytes.length, revision: BASE.revision },
    editorialBytes,
  );
  assert.equal(resultado?.total, 0);
  assert.equal(resultado?.aplicadas, 0);
  assert.deepEqual(resultado?.unidades, []);
});

test('la revisión existente se interpreta con paridad y su huella exacta', (t) => {
  const web = mkdtempSync(join(tmpdir(), 'diagnostico-editorial-'));
  t.after(() => rmSync(web, { recursive: true, force: true }));
  mkdirSync(join(web, 'datos/catalogo-cursos'), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(BASE));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ruta = `datos/catalogo-cursos/${sha256}.json`;
  const referencia = { ruta, sha256, bytes: bytes.length, revision: BASE.revision as string };
  writeFileSync(join(web, ruta), bytes);
  const editorialBytes = readFileSync(
    new URL('../../src/catalogo-cursos/clasificacion-revisada.json', import.meta.url),
  );
  const resultado = diagnosticoClasificacion(web, referencia, editorialBytes);
  assert.equal(resultado?.revisionEditorialSha256, createHash('sha256').update(editorialBytes).digest('hex'));
  assert.deepEqual(
    resultado?.unidades.map((u) => u.revision),
    leerCatalogo(bytes, referencia).ofertas.map((o) => evaluarClasificacion(o).revision),
  );
});

function catalogoParaCaptura(web: string) {
  mkdirSync(join(web, 'datos/catalogo-cursos'), { recursive: true });
  mkdirSync(join(web, 'scripts'), { recursive: true });
  const dato = structuredClone(BASE);
  dato.schema_version = VERSION_CATALOGO;
  dato.proveedores = [{ id: 'cibernarium', nombre: 'Proveedor' }];
  dato.cobertura = { recurso: 0, edicion: 1 };
  const unidad = dato.ofertas[0];
  unidad.unidad = { tipo: 'edicion', id: 'cibernarium-edicion:2', programa_id: 'cibernarium:1' };
  unidad.proveedor_id = 'cibernarium';
  const soporte = {
    url: 'https://example.org/api',
    sha256: 'a'.repeat(CIFRAS_SHA),
    capturado_utc: '2026-10-22T08:00:00Z',
    localizador: 'activities[0]',
  };
  unidad.evidencia_materia = {
    version: 1,
    actividad_id: '3',
    programa_id: 'cibernarium:1',
    edicion_id: 'cibernarium-edicion:2',
    vinculo: soporte,
    contenido: { ...soporte, metodo: 'cibernarium-descripcion-api-v1', sha256_captura: 'b'.repeat(CIFRAS_SHA) },
    censo_ia: null,
    estado_censo: 'completo',
  };
  const bytes = Buffer.from(JSON.stringify(dato));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ruta = `datos/catalogo-cursos/${sha256}.json`;
  const referencia = { ruta, sha256, bytes: bytes.length, revision: dato.revision as string };
  writeFileSync(join(web, ruta), bytes);
  const oferta = leerCatalogo(bytes, referencia).ofertas[0];
  assert.ok(oferta);
  return { oferta, referencia, soporte };
}

function diagnosticoConSoporteAusente(web: string, dato: typeof BASE) {
  mkdirSync(join(web, 'datos/catalogo-cursos'), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(dato));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ruta = `datos/catalogo-cursos/${sha256}.json`;
  const referencia = { ruta, sha256, bytes: bytes.length, revision: dato.revision as string };
  writeFileSync(join(web, ruta), bytes);
  const oferta = leerCatalogo(bytes, referencia).ofertas[0];
  assert.ok(oferta);
  const anterior = editorial(oferta);
  const revision = {
    ...anterior,
    programas: anterior.programas.map((p) => ({
      ...p,
      nivel: {
        ...p.nivel,
        valor: 'inicial',
        origen: 'faro',
        evidencia: { url: 'https://example.org/ausente', sha256: 'f'.repeat(CIFRAS_SHA), capturadoEl: null },
      },
    })),
  };
  return diagnosticoClasificacion(web, referencia, Buffer.from(JSON.stringify(revision)));
}

test('el diagnóstico distingue soporte histórico ausente y censo de IA v5', (t) => {
  const raiz = mkdtempSync(join(tmpdir(), 'diagnostico-soporte-'));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const legacy = diagnosticoConSoporteAusente(join(raiz, 'v4'), structuredClone(BASE));
  assert.deepEqual(legacy?.unidades[0]?.revision, { estado: 'no-aplicada', motivo: 'evidencia-nivel-ausente' });
  const web = join(raiz, 'v5');
  const { referencia, soporte } = catalogoParaCaptura(web);
  const actual = JSON.parse(readFileSync(join(web, referencia.ruta), 'utf8'));
  actual.ofertas[0].evidencia_materia.contenido = null;
  actual.ofertas[0].evidencia_materia.censo_ia = { ambito: 'ia', ...soporte };
  const diagnostico = diagnosticoConSoporteAusente(web, actual);
  assert.deepEqual(diagnostico?.unidades[0]?.revision, { estado: 'aplicada' });
  assert.deepEqual(diagnostico?.unidades[0]?.revisionNivel, {
    estado: 'no-aplicada',
    motivo: 'evidencia-nivel-ausente',
  });
});

function editorialParaCaptura(oferta: OfertaCatalogo) {
  const anterior = editorial(oferta);
  const referenciaNivel = oferta.referencias[0];
  assert.ok(referenciaNivel);
  return {
    ...anterior,
    programas: anterior.programas.map((p) => ({
      ...p,
      nivel: {
        ...p.nivel,
        valor: 'inicial',
        origen: 'faro',
        evidencia: { url: referenciaNivel.url, sha256: referenciaNivel.sha256, capturadoEl: null },
      },
    })),
  };
}

function materiasParaCaptura(oferta: OfertaCatalogo, soporte: ReturnType<typeof catalogoParaCaptura>['soporte']) {
  return {
    schemaVersion: 1,
    programas: [
      {
        programaId: oferta.unidad.programa_id,
        titulo: oferta.titulo_programa,
        proveedorId: 'cibernarium',
        temas: ['digital'],
        contenido: {
          metodo: 'cibernarium-descripcion-api-v1',
          sha256: soporte.sha256,
          url: soporte.url,
          sha256Captura: 'b'.repeat(CIFRAS_SHA),
          capturadoEl: soporte.capturado_utc,
          localizador: soporte.localizador,
        },
      },
    ],
  };
}

function revisionesParaCaptura(
  web: string,
  oferta: OfertaCatalogo,
  soporte: ReturnType<typeof catalogoParaCaptura>['soporte'],
) {
  const rutaEditorial = join(web, 'editorial.json');
  const rutaMaterias = join(web, 'materias.json');
  writeFileSync(rutaEditorial, JSON.stringify(editorialParaCaptura(oferta)));
  writeFileSync(rutaMaterias, JSON.stringify(materiasParaCaptura(oferta, soporte)));
  const leidosEditorial = readFileSync(rutaEditorial);
  const leidosMaterias = readFileSync(rutaMaterias);
  const captura = capturarRevisiones(leidosEditorial, leidosMaterias);
  const shaEditorial = createHash('sha256').update(captura.editorial).digest('hex');
  const shaMaterias = createHash('sha256').update(captura.materias).digest('hex');
  leidosEditorial.fill(0);
  leidosMaterias.fill(0);
  captura.editorial.fill(0);
  captura.materias.fill(0);
  writeFileSync(rutaEditorial, '{}');
  writeFileSync(rutaMaterias, '{}');
  return { captura, shaEditorial, shaMaterias };
}

async function comprobarMotorCapturado(
  web: string,
  revisiones: ReadonlyMap<string, Uint8Array>,
  oferta: OfertaCatalogo,
  revision: unknown,
): Promise<void> {
  const motor = await empaquetarEntradasDelMotor(
    web,
    'por-pagina',
    ['src/catalogo-cursos/clasificacion.ts'],
    revisiones,
  );
  const modulo = motor.archivos.get('motor/src/catalogo-cursos/clasificacion.js');
  assert.ok(modulo);
  const evaluador = await import(`data:text/javascript;base64,${Buffer.from(modulo).toString('base64')}`);
  assert.deepEqual(evaluador.evaluarClasificacion(oferta).revision, revision);
  assert.deepEqual(evaluador.metadatosClasificados(oferta).temas, ['digital']);
  assert.equal(evaluador.metadatosClasificados(oferta).nivel.valor, 'inicial');
}

async function comprobarPaginaCapturada(
  web: string,
  revisiones: ReadonlyMap<string, Uint8Array>,
  oferta: OfertaCatalogo,
): Promise<void> {
  writeFileSync(
    join(web, 'scripts/entrada.js'),
    "import { metadatosClasificados } from '../recursos/catalogo-cursos/lector.js'; globalThis.__pruebaMaterias = metadatosClasificados;\n",
  );
  const zona = { id: 'publica', carpeta: 'js', paginas: [{ ruta: 'inicio.html', modulos: ['scripts/entrada.js'] }] };
  const paquete = await empaquetarZona(web, zona, 'por-pagina', { calculadas: [], revisiones });
  const codigo = [...paquete.archivos.values()][0];
  assert.ok(codigo);
  await import(`data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`);
  const navegador = globalThis as typeof globalThis & {
    __pruebaMaterias: (oferta: OfertaCatalogo) => { temas: readonly string[]; nivel: { valor: string | null } };
  };
  assert.deepEqual(navegador.__pruebaMaterias(oferta).temas, ['digital']);
  assert.equal(navegador.__pruebaMaterias(oferta).nivel.valor, 'inicial');
  delete (navegador as { __pruebaMaterias?: unknown }).__pruebaMaterias;
}

test('diagnóstico y paquete consumen la misma captura aunque cambien las entradas externas', async (t) => {
  const web = realpathSync(mkdtempSync(join(tmpdir(), 'diagnostico-captura-')));
  t.after(() => rmSync(web, { recursive: true, force: true }));
  const { oferta, referencia, soporte } = catalogoParaCaptura(web);
  const { captura, shaEditorial, shaMaterias } = revisionesParaCaptura(web, oferta, soporte);
  const diagnostico = diagnosticoClasificacion(web, referencia, captura.editorial, captura.materias);
  assert.equal(diagnostico?.revisionEditorialSha256, shaEditorial);
  assert.equal(diagnostico?.revisionMateriasSha256, shaMaterias);
  assert.deepEqual(diagnostico?.unidades[0]?.revision, { estado: 'aplicada' });
  assert.deepEqual(diagnostico?.unidades[0]?.revisionNivel, { estado: 'aplicada' });
  const revisiones = new Map([
    ['src/catalogo-cursos/clasificacion-revisada.json', captura.editorial],
    ['src/catalogo-cursos/materias-revisadas.json', captura.materias],
  ]);
  await comprobarMotorCapturado(web, revisiones, oferta, diagnostico?.unidades[0]?.revision);
  await comprobarPaginaCapturada(web, revisiones, oferta);
});
