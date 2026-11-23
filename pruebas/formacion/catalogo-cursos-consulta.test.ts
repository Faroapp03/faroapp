// Ofertas exclusivamente sintéticas; no activan una entrega ni sustituyen sus decisiones de vigencia.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contieneBusqueda, palabrasBuscadas, rangosEncontrados } from '../../src/catalogo-cursos/busqueda.ts';
import { consultarCatalogo, type FiltrosCatalogo } from '../../src/catalogo-cursos/consulta.ts';
import type { CampoHecho, EntregaCatalogo, HechoCatalogo, OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { temasDelCurso } from '../../src/catalogo-cursos/temas.ts';

const BASE = leerCatalogo(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url)),
  JSON.parse(readFileSync(new URL('../fixtures/catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8')),
);
const AHORA = Date.parse('2026-10-22T11:00:00Z');
const FILTROS: FiltrosCatalogo = { texto: '', idioma: '', modalidad: '', nivel: '', tema: '', orden: 'proximos' };
function hecho(oferta: OfertaCatalogo, campo: CampoHecho, valor: HechoCatalogo['valor']): OfertaCatalogo {
  return {
    ...oferta,
    hechos: {
      ...oferta.hechos,
      [campo]: {
        ...oferta.hechos[campo],
        valor,
        motivo: valor === null ? 'no_consta_en_evidencia' : 'conocido',
      },
    },
  };
}
function oferta(id: string, titulo: string): OfertaCatalogo {
  const original = BASE.ofertas[0];
  assert.ok(original);
  return hecho(
    hecho(
      {
        ...original,
        titulo_programa: titulo,
        unidad: {
          ...original.unidad,
          id,
          programa_id: id,
        },
      },
      'coste_formacion_tipo',
      'gratis_formacion',
    ),
    'coste_formacion',
    0,
  );
}
function entrega(ofertas: readonly OfertaCatalogo[]): EntregaCatalogo {
  return Object.freeze({
    ...BASE,
    ofertas: Object.freeze(ofertas),
    cobertura: { recurso: ofertas.length, edicion: 0 },
  });
}
function consultar(datos: EntregaCatalogo, filtros: Partial<FiltrosCatalogo> = {}) {
  return consultarCatalogo(datos, { ...FILTROS, ...filtros }, AHORA);
}
const MIXTA = hecho(hecho(oferta('b', 'Excel avanzado'), 'modalidad', 'mixta'), 'idiomas_declarados', ['ca']);
const LINEA = hecho(hecho(oferta('a', 'Introducción a la IA'), 'modalidad', 'en-linea'), 'idiomas_declarados', ['es']);
const PRESENCIAL = hecho(hecho(oferta('c', 'Ciberseguridad'), 'modalidad', 'presencial'), 'idiomas_declarados', ['en']);
const DESCONOCIDA = oferta('d', 'Farmacia avanzada');
const DATOS = entrega([LINEA, MIXTA, PRESENCIAL, DESCONOCIDA]);
const TOTAL_SINTETICO = 4;

test('solo formación gratuita acreditada antes de su límite publicado; no transforma desconocidos ni reescribe el asset', () => {
  const original = JSON.stringify(DATOS);
  const desconocida = BASE.ofertas[0];
  assert.ok(desconocida);
  assert.equal(consultar(entrega([desconocida])).total, 0);
  assert.equal(consultar(entrega([hecho(LINEA, 'coste_formacion', 10)])).total, 0);
  assert.equal(consultar(entrega([hecho(LINEA, 'coste_formacion_tipo', 'gratis_parcial')])).total, 0);
  const semanasDespues = Date.parse('2026-12-01T10:00:00Z');
  assert.equal(consultarCatalogo(DATOS, FILTROS, semanasDespues).total, TOTAL_SINTETICO);
  const limite = '2026-11-02T10:00:00Z';
  const conLimite = entrega([{ ...LINEA, cierra_el: limite }, MIXTA]);
  assert.equal(consultarCatalogo(conLimite, FILTROS, Date.parse(limite) - 1).total, 2);
  assert.deepEqual(
    consultarCatalogo(conLimite, FILTROS, Date.parse(limite)).ofertas.map((o) => o.unidad.id),
    ['b'],
  );
  assert.equal(JSON.stringify(DATOS), original);
});

test('mixta cuenta y filtra en ambas modalidades; desconocida solo con Todos', () => {
  assert.deepEqual(
    consultar(DATOS, { modalidad: 'en-linea' }).ofertas.map((o) => o.unidad.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    consultar(DATOS, { modalidad: 'presencial' }).ofertas.map((o) => o.unidad.id),
    ['c', 'b'],
  );
  const cuentas = consultar(DATOS).cuentas.get('modalidad');
  assert.equal(cuentas?.get('todo'), TOTAL_SINTETICO);
  assert.equal(cuentas?.get('en-linea'), 2);
  assert.equal(cuentas?.get('presencial'), 2);
});

test('recuentos cruzados excluyen solo su filtro propio y conservan búsqueda y demás elecciones', () => {
  const q = consultar(DATOS, { texto: 'excel', idioma: 'es', modalidad: 'en-linea' });
  assert.equal(q.ofertas.length, 0);
  assert.equal(q.cuentas.get('idioma')?.get('ca'), 1);
  assert.equal(q.cuentas.get('idioma')?.get('todo'), 1);
  assert.equal(q.cuentas.get('modalidad')?.get('todo'), 0);
  assert.equal(q.total, TOTAL_SINTETICO);
});

test('nivel y calendarios sin soporte no se infieren del título; órdenes sin fechas acreditadas son alfabéticos', () => {
  assert.equal(consultar(DATOS, { nivel: 'avanzado' }).ofertas.length, 0);
  assert.equal(consultar(DATOS, { nivel: 'no-indicado' }).ofertas.length, TOTAL_SINTETICO);
  const porNombre = consultar(DATOS, { orden: 'nombre' }).ofertas;
  assert.deepEqual(porNombre, consultar(DATOS, { orden: 'proximos' }).ofertas);
  assert.deepEqual(
    porNombre.map((o) => o.titulo_programa),
    ['Ciberseguridad', 'Excel avanzado', 'Farmacia avanzada', 'Introducción a la IA'],
  );
});

test('búsqueda usa normalización común, todas las palabras y límites completos para IA/AI', () => {
  assert.equal(consultar(DATOS, { texto: 'INTRODUCCION ia' }).ofertas[0], LINEA);
  assert.equal(consultar(DATOS, { texto: 'ia farmacia' }).ofertas.length, 0);
  assert.equal(contieneBusqueda('Farmacia avanzada', palabrasBuscadas('ia')), false);
  assert.equal(contieneBusqueda('AI: tareas y datos', palabrasBuscadas('ai datos')), true);
  assert.equal(contieneBusqueda('Programación', palabrasBuscadas('programa')), true);
  // El título explícito Excel orienta el filtro de ofimática.
  assert.deepEqual(consultar(DATOS, { texto: 'ofimatica' }).ofertas, [MIXTA]);
  assert.deepEqual(consultar(DATOS, { texto: 'excel' }).ofertas, [MIXTA]);
});

test('los rangos conservan caracteres y acentos combinados; el título sigue siendo texto literal', () => {
  const titulo = '😀 Cafe\u0301 y programación <script>';
  const rangos = rangosEncontrados(titulo, 'cafe programacion');
  assert.deepEqual(
    rangos.map(([a, b]) => titulo.slice(a, b)),
    ['Cafe\u0301', 'programación'],
  );
  const frase = 'farmacia IA';
  assert.deepEqual(rangosEncontrados(frase, 'ia'), [['farmacia '.length, frase.length]]);
  assert.deepEqual(rangosEncontrados('Excel', '<script>'), []);
});

test('la API de títulos y el filtro comparten indicadores específicos', () => {
  for (const [titulo, temas] of [
    ['Introducción a la IA', ['ia']],
    ['Farmacia avanzada', ['no-indicado']],
    ['Excel avanzado', ['ofimatica']],
    ['Ciberseguridad', ['seguridad']],
    ['Programación en Python', ['datos']],
    ['Marketing', ['comunicacion']],
    ['Competències digitals', ['digital']],
    ['Competencias digitales con Excel', ['digital', 'ofimatica']],
    ['Python y marketing', ['datos', 'comunicacion']],
    ['IA con Excel', ['ia', 'ofimatica']],
    ['Desarrollo profesional', ['no-indicado']],
  ] as const) {
    assert.deepEqual(temasDelCurso(titulo), temas, titulo);
  }
  const mixta = oferta('temas', 'IA con Excel');
  const python = oferta('python', 'Python y marketing');
  const datos = entrega([mixta, python, oferta('generico', 'Desarrollo profesional')]);
  assert.deepEqual(consultar(datos, { tema: 'datos' }).ofertas, [python]);
  assert.deepEqual(consultar(datos, { tema: 'comunicacion' }).ofertas, [python]);
  assert.deepEqual(consultar(datos, { tema: 'ia' }).ofertas, [mixta]);
  assert.deepEqual(consultar(datos, { tema: 'ofimatica' }).ofertas, [mixta]);
  assert.equal(consultar(datos, { tema: 'oficio' }).ofertas.length, 0);
  assert.deepEqual(
    consultar(datos, { tema: 'no-indicado' }).ofertas.map((o) => o.titulo_programa),
    ['Desarrollo profesional'],
  );
  assert.equal(consultar(datos).total, datos.ofertas.length);
});

test('un idioma conocido distinto de ES/CA/EN no se convierte en No indicado', () => {
  const francesa = hecho(oferta('frances', 'Formación general'), 'idiomas_declarados', ['fr']);
  const datos = entrega([francesa, DESCONOCIDA]);
  assert.equal(consultar(datos).cuentas.get('idioma')?.get('no-indicado'), 1);
  assert.deepEqual(consultar(datos, { idioma: 'no-indicado' }).ofertas, [DESCONOCIDA]);
  assert.equal(consultar(datos).total, 2);
});

test('una oferta sin revisión se busca por título y por la materia orientativa', () => {
  const artificial = oferta('artificial', 'Inteligencia artificial aplicada');
  const datos = entrega([artificial, DESCONOCIDA]);
  assert.deepEqual(consultar(datos, { texto: 'inteligencia artificial' }).ofertas, [artificial]);
  assert.deepEqual(consultar(datos, { texto: 'ia' }).ofertas, [artificial]);
});

test('la inferencia respeta identidad y decisiones editoriales, y no altera las ofertas', async () => {
  const { evaluarClasificacion } = await import('../../src/catalogo-cursos/clasificacion.ts');
  const { temasParaFiltro, sugerirTemasPorTitulo } = await import('../../src/catalogo-cursos/inferir-temas.ts');
  assert.deepEqual(sugerirTemasPorTitulo('Farmacia avanzada'), []);
  assert.deepEqual(sugerirTemasPorTitulo('No usar IA'), []);
  assert.deepEqual(sugerirTemasPorTitulo('Diseño de páginas web para hostelería'), ['web']);
  const actual = oferta('nuevo', 'Python y marketing');
  const antes = JSON.stringify(actual);
  assert.deepEqual(temasParaFiltro(actual, evaluarClasificacion(actual)), ['datos', 'comunicacion']);
  assert.equal(JSON.stringify(actual), antes);
  const anclada = { ...oferta('cibernarium:1601188', 'Curso Python'), proveedor_id: 'cibernarium' };
  assert.deepEqual(temasParaFiltro(anclada, evaluarClasificacion(anclada)), ['no-indicado']);
});

test('los objetivos proyectados exigen unidad, título, captura y reglas actuales', async () => {
  const { evaluarClasificacion } = await import('../../src/catalogo-cursos/clasificacion.ts');
  const { temasParaFiltro } = await import('../../src/catalogo-cursos/inferir-temas.ts');
  const { sha256Hex } = await import('../../src/comun/huella.ts');
  const { jsonCanonico } = await import('../../src/comun/jcs.ts');
  const reglas = (await import('../../src/catalogo-cursos/indicadores-objetivos.json', { with: { type: 'json' } }))
    .default;
  const original = oferta('objetivo', 'Formación general');
  const ref = original.referencias[0];
  assert.ok(ref);
  const evidencia_temas = {
    unidad_id: 'objetivo',
    programa_id: 'objetivo',
    titulo: original.titulo_programa,
    url: ref.url,
    sha256: ref.sha256,
    localizador: '/objetivos',
    reglas_sha256: sha256Hex(new TextEncoder().encode(jsonCanonico(reglas))),
    temas: ['empresa'] as const,
  };
  const actual = { ...original, evidencia_temas };
  assert.deepEqual(temasParaFiltro(actual, evaluarClasificacion(actual)), ['empresa']);
  const longitudSha = 64;
  for (const alterada of [
    { ...evidencia_temas, unidad_id: 'otra' },
    { ...evidencia_temas, programa_id: 'otro' },
    { ...evidencia_temas, titulo: 'Otro' },
    { ...evidencia_temas, sha256: '0'.repeat(longitudSha) },
    { ...evidencia_temas, reglas_sha256: '0'.repeat(longitudSha) },
  ]) {
    const noVigente = { ...original, evidencia_temas: alterada };
    assert.deepEqual(temasParaFiltro(noVigente, evaluarClasificacion(noVigente)), ['no-indicado']);
  }
});

test('la negación afecta a su señal, no a todo el título ni a los requisitos previos', async () => {
  const { sugerirTemasPorTitulo } = await import('../../src/catalogo-cursos/inferir-temas.ts');
  assert.deepEqual(sugerirTemasPorTitulo('Excel sin conocimientos previos'), ['ofimatica']);
  assert.deepEqual(sugerirTemasPorTitulo('Excel sin experiencia'), ['ofimatica']);
  assert.deepEqual(sugerirTemasPorTitulo('Marketing sin IA'), ['comunicacion']);
  assert.deepEqual(sugerirTemasPorTitulo('No usar IA'), []);
  assert.deepEqual(sugerirTemasPorTitulo('Sin IA ni Excel'), []);
  assert.deepEqual(sugerirTemasPorTitulo('Sin IA y Excel'), ['ofimatica']);
  assert.deepEqual(sugerirTemasPorTitulo('Sense coneixements previs de Python'), ['datos']);
  assert.deepEqual(sugerirTemasPorTitulo('Excel y marketing'), ['ofimatica', 'comunicacion']);
});

test('la seguridad de redes sociales y las marcas de IA requieren sentido afirmativo', async () => {
  const { sugerirTemasPorTitulo } = await import('../../src/catalogo-cursos/inferir-temas.ts');
  assert.deepEqual(sugerirTemasPorTitulo('Seguridad en redes sociales: contraseñas y privacidad'), [
    'seguridad',
    'comunicacion',
  ]);
  assert.deepEqual(sugerirTemasPorTitulo('Seguretat a les xarxes socials'), ['seguridad', 'comunicacion']);
  assert.deepEqual(sugerirTemasPorTitulo('Sin seguridad en redes sociales'), []);
  assert.deepEqual(sugerirTemasPorTitulo('Historia del arte: Claude Monet'), []);
  assert.deepEqual(sugerirTemasPorTitulo('Fotografía de la constelación Gemini'), ['diseno']);
  assert.deepEqual(sugerirTemasPorTitulo('Introducción a Google Gemini'), ['ia']);
  assert.deepEqual(sugerirTemasPorTitulo('Anthropic Claude y Excel'), ['ia', 'ofimatica']);
  assert.deepEqual(sugerirTemasPorTitulo('No es necesario Python para Excel'), ['ofimatica']);
  assert.deepEqual(sugerirTemasPorTitulo('No cal Python per Excel'), ['ofimatica']);
  assert.deepEqual(sugerirTemasPorTitulo('No Python needed for Excel'), ['ofimatica']);
});
