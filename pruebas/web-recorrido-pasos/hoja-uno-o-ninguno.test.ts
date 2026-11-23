import { planDePrueba } from '../fixtures/plan-formacion.ts';
import './aislar.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import { metadatosClasificados } from '../../src/catalogo-cursos/clasificacion.ts';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { idiomaConOrigen } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import type { SeleccionFormacion } from '../../src/seleccion-formacion/contrato.ts';
import { eleccionesVigentes } from '../../web/scripts/recorrido/formacion/crear-plan.js';
import { crearPlanValidado } from '../../web/scripts/recorrido/formacion/preferencias-plan.js';
import type { PlanElegido } from '../../web/scripts/recorrido/plan-formacion/contrato.js';
import { crearDocumentoDelPlan } from '../../web/scripts/recorrido/plan-formacion/documento.js';
import { etiquetaDeIdioma, idiomaDelTitulo } from '../../web/scripts/recorrido/plan-formacion/ficha-oferta.js';
import { fechaOficial } from '../../web/scripts/recorrido/plan-formacion/textos-documento.js';
import { casoDeFormacion } from '../fixtures/seleccion-formacion.ts';
import { type Nodo, prepararDom } from './dom.ts';

beforeEach(() => prepararDom());

function conIdiomas(plan: PlanElegido, idiomas: string[]): PlanElegido {
  const [primera, ...resto] = plan.elecciones;
  assert.ok(primera);
  const declarados = { ...primera.oferta.hechos.idiomas_declarados, motivo: 'conocido' as const, valor: idiomas };
  const oferta = { ...primera.oferta, hechos: { ...primera.oferta.hechos, idiomas_declarados: declarados } };
  return { ...plan, elecciones: [{ ...primera, oferta, idioma: idiomaConOrigen(oferta) }, ...resto] };
}

test('un plan guardado antes de que las opciones trajeran sus requisitos se sigue pintando igual', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const actual = planDePrueba(idioma);
    const anterior = {
      ...actual,
      elecciones: actual.elecciones.map(({ requisitos: _sinRequisitos, ...opcion }) => opcion),
    } as unknown as PlanElegido;
    const documento = crearDocumentoDelPlan(anterior) as unknown as Nodo;
    const esperado = crearDocumentoDelPlan(actual) as unknown as Nodo;
    assert.equal(documento.querySelectorAll('.pe-ficha-compacta').length, 2);
    assert.equal(documento.textContent, esperado.textContent);
  }
});
test('con un solo curso la hoja tiene sus dos hojas, una ficha y una entradilla en singular', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const completo = planDePrueba(idioma);
    const plan = { ...completo, elecciones: completo.elecciones.slice(0, 1) };
    const documento = crearDocumentoDelPlan(plan) as unknown as Nodo;
    assert.equal(documento.querySelectorAll('.hd-hoja').length, 2);
    assert.equal(documento.querySelectorAll('.pe-ficha-compacta').length, 1);
    assert.match(documento.textContent, idioma === 'ca' ? /Un curs, un pla adaptat/u : /Un curso, un plan adaptado/u);
    assert.doesNotMatch(documento.textContent, /Dos cursos/u);
    assert.equal(documento.querySelector('.pe-mientras-tanto'), null);
  }
});

test('la hoja conserva el aviso de nivel y muestra el origen del nivel conocido en ambos idiomas', () => {
  const catalogo = JSON.parse(
    readFileSync(new URL('../fixtures/catalogo-clasificacion-20261025.utf8', import.meta.url), 'utf8'),
  );
  const conocida = (catalogo.ofertas as OfertaCatalogo[]).find(
    (oferta) => metadatosClasificados(oferta).nivel.valor !== null,
  );
  assert.ok(conocida);
  for (const idioma of ['es', 'ca'] as const) {
    const base = planDePrueba(idioma);
    const [primera] = base.elecciones;
    assert.ok(primera);
    const desconocida = {
      ...primera,
      oferta: { ...primera.oferta, unidad: { ...primera.oferta.unidad, programa_id: 'sin-revision' } },
    };
    const plan = { ...base, elecciones: [desconocida, { ...primera, oferta: conocida }] };
    const documento = crearDocumentoDelPlan(plan) as unknown as Nodo;
    const [sinNivel, conNivel] = documento.querySelectorAll('.pe-nivel-curso');
    assert.ok(sinNivel && conNivel);
    assert.match(
      sinNivel.textContent,
      idioma === 'es'
        ? /El nivel está por confirmar\. Consulta los requisitos antes de elegir este curso\./u
        : /El nivell està per confirmar\. Consulta els requisits abans de triar aquest curs\./u,
    );
    assert.match(
      conNivel.textContent,
      idioma === 'es'
        ? /Nivel: (Inicial|Intermedio|Avanzado) · (publicado|orientación|extracto)/u
        : /Nivell: (Inicial|Intermedi|Avançat) · (publicat|orientació|extracte)/u,
    );
  }
});

test('sin cursos la hoja es una sola página con «Mientras tanto» y sin calendario ni fichas', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const plan = { ...planDePrueba(idioma), elecciones: [] };
    const documento = crearDocumentoDelPlan(plan) as unknown as Nodo;
    assert.equal(documento.querySelectorAll('.hd-hoja').length, 1);
    assert.match(documento.textContent, idioma === 'ca' ? /Full 1 de 1/u : /Hoja 1 de 1/u);
    const bloque = documento.querySelector('.pe-mientras-tanto');
    assert.ok(bloque);
    assert.match(bloque.textContent, idioma === 'ca' ? /Mentrestant/u : /Mientras tanto/u);
    const destinos = bloque.querySelectorAll('a').map((a) => (a as unknown as HTMLAnchorElement).href);
    assert.deepEqual(destinos, ['entender-ia.html', 'entender-ia.html#desafio', 'biblioteca.html']);
    assert.doesNotMatch(bloque.textContent, /Acreditar/u, 'Sin acreditación elegida no se cita');
    assert.equal(documento.querySelector('.pe-calendario'), null);
    assert.equal(documento.querySelector('.pe-ficha-compacta'), null);
    assert.equal(documento.querySelector('.pe-calendario-ics'), null);
  }
});

test('sin cursos y con una vía de acreditación elegida, «Mientras tanto» remite a ella', () => {
  const plan = {
    ...planDePrueba('es'),
    elecciones: [],
    acreditacion: {
      codigo: 'TMVI0108',
      nombre: 'Conducción de autobuses',
      nivel: 2 as const,
      relacion: 'ocupacion' as const,
      enlaceBoe: 'https://www.boe.es/ejemplo',
      ocupacion: '8331',
      idioma: 'es' as const,
      tramite: 'https://ejemplo.invalid/tramite',
      fuente: 'https://ejemplo.invalid/fuente',
      comprobado: '2026-10-06',
      ofertaActualizada: '2026-10-06',
    },
  };
  const documento = crearDocumentoDelPlan(plan) as unknown as Nodo;
  assert.match(documento.querySelector('.pe-mientras-tanto')?.textContent ?? '', /«Acreditar tu experiencia»/u);
  assert.match(documento.textContent, /Comprobado: 6 oct\. 2026/u);
  assert.doesNotMatch(documento.textContent, /2026-10-06/u);
});

test('«Lo que nos dijiste» resume las respuestas en una línea, sin perfiles fijos', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const documento = crearDocumentoDelPlan(planDePrueba(idioma)) as unknown as Nodo;
    const linea = documento.querySelector('.pe-dijiste')?.textContent ?? '';
    assert.match(
      linea,
      idioma === 'ca' ? /^El que ens vas dir: Nivell en IA: Inicial/u : /^Lo que nos dijiste: Nivel en IA: Inicial/u,
    );
    assert.match(linea, idioma === 'ca' ? /23 d’oct\. del 2026/u : /23 oct\. 2026/u);
    assert.doesNotMatch(linea, /Perfil|Oficinista|Electricista/u);
  }
});

test('un curso en otra lengua lleva su etiqueta y el título se marca con su idioma, sin traducirlo', () => {
  const plan = conIdiomas(planDePrueba('es'), ['ca']);
  const [catalan] = plan.elecciones;
  assert.ok(catalan);
  assert.equal(idiomaDelTitulo(catalan), 'ca');
  assert.equal(etiquetaDeIdioma(catalan, 'es'), 'Curso en catalán');
  assert.equal(etiquetaDeIdioma(catalan, 'ca'), null, 'En la hoja en catalán no hace falta');
  const documento = crearDocumentoDelPlan(plan) as unknown as Nodo;
  assert.match(documento.textContent, /Curso en catalán/u);
  const titulos = documento
    .querySelectorAll('[lang="ca"]')
    .map((nodo) => nodo.textContent)
    .filter((texto) => texto === catalan.oferta.titulo_programa);
  assert.ok(titulos.length >= 2, 'El título se marca en el calendario y en la ficha');
  const varios = conIdiomas(planDePrueba('es'), ['ca', 'Castellano']);
  assert.ok(varios.elecciones[0]);
  assert.equal(idiomaDelTitulo(varios.elecciones[0]), null, 'Con varios idiomas no se sabe el del título');
  assert.equal(etiquetaDeIdioma(varios.elecciones[0], 'es'), null);
  const libre = conIdiomas(planDePrueba('es'), ['Anglès']);
  assert.ok(libre.elecciones[0]);
  assert.equal(etiquetaDeIdioma(libre.elecciones[0], 'es'), 'Curso en inglés');
});

test('las horas publicadas se dan en hora de Barcelona; sin zona se dice, sin inventarla', () => {
  assert.equal(fechaOficial('2026-11-10T09:00:00Z', 'es'), '10 nov. 2026, 10:00');
  assert.equal(fechaOficial('2026-07-10T09:00:00Z', 'es'), '10 jul. 2026, 11:00');
  assert.equal(fechaOficial('2026-11-10T09:00:00-00:00', 'es'), '10 nov. 2026, 09:00 (huso horario por confirmar)');
  assert.equal(fechaOficial('2026-11-10', 'ca'), '10 de nov. del 2026');
});

test('el plan se valida con uno o ningún curso y las elecciones vigentes respetan el bloque vacío', () => {
  const caso = casoDeFormacion();
  const plan = planDePrueba('es');
  const [ia] = plan.elecciones;
  assert.ok(ia);
  const datos = {
    actual: caso.seleccion,
    preferencias: caso.preferencias,
    nivelDigital: 'inicial' as const,
    disponibilidad: { dias: [1], minutosPorDia: 30, inicio: '2026-10-23' },
    objetivo: 'Objetivo',
    idioma: 'es' as const,
    perfil: null,
  };
  assert.equal(crearPlanValidado({ ...datos, ia, digital: null }).elecciones.length, 1);
  assert.deepEqual(crearPlanValidado({ ...datos, ia: null, digital: null }).elecciones, []);
  assert.throws(() => crearPlanValidado({ ...datos, ia: null, digital: ia }), /no es válido/u);
  const seleccion = { opciones: { ia: [ia], digital: [] } } as unknown as SeleccionFormacion;
  assert.deepEqual(eleccionesVigentes(seleccion, seleccion, ia.oferta.unidad.id, null), { ia, digital: null });
  assert.deepEqual(eleccionesVigentes(seleccion, seleccion, null, null), { ia: null, digital: null });
  const sinOferta = { opciones: { ia: [], digital: [] } } as unknown as SeleccionFormacion;
  assert.equal(eleccionesVigentes(seleccion, sinOferta, ia.oferta.unidad.id, null), null);
});
