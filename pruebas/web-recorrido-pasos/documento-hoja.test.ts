import { planDePrueba } from '../fixtures/plan-formacion.ts';
import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { idiomaConOrigen } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import { datosPorConfirmar } from '../../src/seleccion-formacion/por-confirmar.ts';
import type { HojaConfirmada } from '../../web/scripts/recorrido/estado.js';
import { estado, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { casoDeFormacion } from '../fixtures/seleccion-formacion.ts';
import { Nodo, pagina, prepararDom } from './dom.ts';
import { reiniciarInterfaz } from './interfaz-doble.ts';

const { crearDocumentoDeLaHoja, pintarDocumentoDeLaHoja, irALaHoja, planVigenteAlImprimir } = await import(
  '../../web/scripts/recorrido/documento-hoja.js'
);
// Hoja confirmada como la guarda hoja-de-ruta.js: siempre con su plan.
function hoja(idioma: 'es' | 'ca' = 'es'): HojaConfirmada {
  const caso = casoDeFormacion();
  return {
    seleccion: caso.seleccion,
    plan: planDePrueba(idioma),
    preferencias: caso.preferencias,
    objetivo: 'Preparar una tarea con privacidad y contraste',
    idioma,
    fecha: caso.seleccion.calculado_el,
  } as unknown as HojaConfirmada;
}
beforeEach(() => {
  prepararDom();
  reiniciarEstado();
  reiniciarInterfaz();
  fijarIdioma('es');
  const paso = new Nodo('div');
  paso.id = 'paso-4';
  const host = new Nodo('div');
  host.id = 'hoja-de-ruta';
  host.className = 'rc-hoja-documento';
  paso.append(host);
  pagina.body.append(paso);
});
test('Pintar exige selección confirmada; Leer abre la hoja y lleva el foco a su título', () => {
  assert.throws(() => pintarDocumentoDeLaHoja(), /No hay hoja de formación confirmada/u);
  estado.hojaDeRuta = hoja();
  pintarDocumentoDeLaHoja();
  irALaHoja();
  assert.equal(pagina.getElementById('paso-4')?.dataset.vista, 'hoja');
  assert.equal(pagina.activeElement?.id, 'hd-titulo');
});

test('la hoja en catalán conserva su idioma aunque la página esté en castellano', () => {
  fijarIdioma('es');
  const documento = crearDocumentoDeLaHoja(hoja('ca')) as unknown as Nodo;
  assert.equal(documento.lang, 'ca');
  assert.match(documento.textContent, /El teu pla de formació/u);
});

test('la hoja impresa dice, en cada idioma, que la modalidad del curso está por confirmar', () => {
  const avisos = {
    es: 'No consta si este curso es en línea o presencial. Confírmalo en su ficha oficial antes de inscribirte.',
    ca: 'No consta si aquest curs és en línia o presencial. Confirma-ho a la seva fitxa oficial abans d’inscriure’t.',
  };
  for (const idioma of ['es', 'ca'] as const) {
    const c = hoja(idioma);
    const [primera, segunda] = c.plan.elecciones;
    assert.ok(primera && segunda);
    const documento = crearDocumentoDeLaHoja({
      ...c,
      plan: { ...c.plan, elecciones: [{ ...primera, porConfirmar: ['modalidad'] }, segunda] },
    }) as unknown as Nodo;
    const notas = documento.querySelectorAll('.pe-nota').map((nota) => nota.textContent);
    assert.equal(notas.filter((nota) => nota === avisos[idioma]).length, 1, idioma);
  }
});

test('la antigüedad de la comprobación no bloquea la impresión, tampoco sin conexión ni con hechos antiguos', () => {
  const plan = planDePrueba('es');
  const [primera, ...resto] = plan.elecciones;
  assert.ok(primera);
  const antigua = {
    ...primera,
    oferta: {
      ...primera.oferta,
      cierra_el: null,
      hechos: {
        ...primera.oferta.hechos,
        requiere_registro_previo: {
          ...primera.oferta.hechos.requiere_registro_previo,
          vigencia: { comprobado_el: primera.oferta.comprobado_el },
        },
      },
    },
  };
  const conAntigua = {
    ...plan,
    elecciones: [antigua, ...resto.map((o) => ({ ...o, oferta: { ...o.oferta, cierra_el: null } }))],
  };
  const red = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Sin conexión');
  };
  try {
    assert.equal(planVigenteAlImprimir(conAntigua, Date.parse('2027-06-01T10:00:00Z')), true);
    assert.equal(planVigenteAlImprimir({ ...plan, elecciones: [] }, Date.parse(plan.confirmadoEl)), true);
    assert.equal(planVigenteAlImprimir(plan, Number.NaN), false);
  } finally {
    globalThis.fetch = red;
  }
});

const LONGITUD_HUELLA_PRUEBA = 64;
const SABADO = 6;
const DOMINGO = 7;
const DIAS_DE_PRUEBA = [2, SABADO, DOMINGO];

function comprobarVigenciaDelPlan(plan: import('../../web/scripts/recorrido/plan-formacion/contrato.js').PlanElegido) {
  const instante = Date.parse(plan.confirmadoEl);
  assert.equal(planVigenteAlImprimir(plan, instante), true);
  assert.equal(planVigenteAlImprimir(plan, instante - 1), false);
  const [primera, segunda] = plan.elecciones;
  assert.ok(primera && segunda);
  const cerrada = { ...segunda, oferta: { ...segunda.oferta, cierra_el: plan.confirmadoEl } };
  assert.equal(planVigenteAlImprimir({ ...plan, elecciones: [primera, cerrada] }, instante), false);
}

/** El idioma de la oferta y lo que no consta de ella, como los entrega el motor en cada opción. */
function idiomaComoLoEntregaElMotor(oferta: Parameters<typeof idiomaConOrigen>[0]) {
  const idioma = idiomaConOrigen(oferta);
  return { idioma, porConfirmar: datosPorConfirmar(oferta, idioma, 'cualquiera') };
}

test('el plan confirmado muestra dos elecciones, motivos y agenda en ambos idiomas sin inventar ficha', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const c = hoja(idioma);
    const recurso = c.seleccion.camino?.recursos[0];
    assert.ok(recurso);
    const opcion = {
      oferta: recurso.oferta,
      aprendizaje: null,
      requisitos: [],
      bloque: 'ia' as const,
      proveedor: 'Entidad de prueba',
      motivo: { es: 'Motivo acreditado de la elección', ca: 'Motiu acreditat de la tria' },
      ...idiomaComoLoEntregaElMotor(recurso.oferta),
    };
    const digital = { ...opcion, bloque: 'digital' as const };
    const plan = {
      version: 1 as const,
      fuente: { ruta: 'catalogo', sha256: 'a'.repeat(LONGITUD_HUELLA_PRUEBA), revision: '1' },
      confirmadoEl: c.fecha,
      idioma,
      perfil: null,
      objetivo: c.objetivo,
      preferencias: {
        nivel: 'inicial' as const,
        nivelDigital: 'inicial' as const,
        idiomas: [idioma],
        modalidad: 'cualquiera' as const,
        aceptaRegistro: false,
        inicio: '2026-11-07',
      },
      disponibilidad: { dias: DIAS_DE_PRUEBA, minutosPorDia: 60 },
      elecciones: [opcion, digital] as [typeof opcion, typeof digital],
      requisitosConfirmados: [],
    };
    comprobarVigenciaDelPlan(plan);
    const documento = crearDocumentoDeLaHoja({ ...c, plan }) as unknown as Nodo;
    assert.equal(documento.querySelectorAll('.hd-hoja').length, 2);
    assert.equal(documento.querySelectorAll('.pe-ficha-compacta').length, 2);
    assert.match(
      documento.textContent,
      idioma === 'ca' ? /Motiu acreditat de la tria/u : /Motivo acreditado de la elección/u,
    );
    assert.match(documento.textContent, idioma === 'ca' ? /fitxa oficial del curs/u : /ficha oficial del curso/u);
    assert.doesNotMatch(documento.textContent, /Perfil de ejemplo|Perfil d’exemple/u);
  }
});

test('el folio de pantalla del plan no duplica el folio físico del PDF', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../web/estilos/recorrido/plan-formacion.css', import.meta.url), 'utf8');
  assert.match(css, /@media\s+print\s*\{\s*\.hd\[data-plan-elegido\]\s+\.hd-pie\s*\{\s*display:\s*none/u);
});

test('el plan muestra el objetivo elegido como texto literal en ambos idiomas', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const c = hoja(idioma);
    const plan = { ...planDePrueba(idioma), objetivo: '<tarea> Comparar turnos y anotar incidencias' };
    const documento = crearDocumentoDeLaHoja({ ...c, plan } as Parameters<
      typeof crearDocumentoDeLaHoja
    >[0]) as unknown as Nodo;
    assert.ok(documento.textContent.includes(plan.objetivo));
    assert.equal(documento.querySelector('tarea'), null);
  }
});

test('el plan conserva la incidencia del enlace y su fecha en ambos idiomas', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const c = hoja(idioma);
    const plan = planDePrueba(idioma);
    const [primero, segundo] = plan.elecciones;
    assert.ok(primero && segundo);
    const conIncidencia = { ...primero, oferta: { ...primero.oferta, incidencia_enlace_el: '2026-10-22T09:00:00Z' } };
    const seleccion = { ...plan, elecciones: [conIncidencia, segundo] };
    const documento = crearDocumentoDeLaHoja({ ...c, plan: seleccion } as Parameters<
      typeof crearDocumentoDeLaHoja
    >[0]) as unknown as Nodo;
    assert.match(
      documento.textContent,
      idioma === 'ca' ? /no va respondre com esperava/u : /no respondió como esperaba/u,
    );
    assert.match(documento.textContent, idioma === 'ca' ? /\(22 d’oct\. del 2026\)/u : /\(22 oct\. 2026\)/u);
    const sinIncidencia = crearDocumentoDeLaHoja({ ...c, plan } as Parameters<
      typeof crearDocumentoDeLaHoja
    >[0]) as unknown as Nodo;
    assert.doesNotMatch(
      sinIncidencia.textContent,
      idioma === 'ca' ? /no va respondre com esperava/u : /no respondió como esperaba/u,
    );
  }
});

const ROTULOS_ESPERADOS = {
  es: {
    modalidad: /Modalidad: En línea/u,
    limite: /El proveedor indica que la oferta está publicada hasta el 15 de diciembre de 2026 a las 11:00\./u,
    sinModalidad: /Modalidad: No consta/u,
    certificado: /Certificado: No consta/u,
    imparte: /Lo imparte: Proveedor de prueba/u,
  },
  ca: {
    modalidad: /Modalitat: En línia/u,
    limite: /El proveïdor indica que l’oferta està publicada fins al 15 de desembre del 2026, a les 11:00\./u,
    sinModalidad: /Modalitat: No consta/u,
    certificado: /Certificat: No consta/u,
    imparte: /L’imparteix: Proveedor de prueba/u,
  },
};
test('el plan presenta modalidad, límite y comprobación de cada oferta sin inventar matrícula', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const c = hoja(idioma);
    const plan = planDePrueba(idioma);
    const [primero, segundo] = plan.elecciones;
    assert.ok(primero && segundo);
    const modalidad = { ...primero.oferta.hechos.modalidad, motivo: 'conocido' as const, valor: 'en-linea' };
    const sinModalidad = { ...segundo.oferta.hechos.modalidad, motivo: 'no_consta_en_evidencia' as const, valor: null };
    const ia = { ...primero, oferta: { ...primero.oferta, hechos: { ...primero.oferta.hechos, modalidad } } };
    const digital = {
      ...segundo,
      oferta: { ...segundo.oferta, cierra_el: null, hechos: { ...segundo.oferta.hechos, modalidad: sinModalidad } },
    };
    const documento = crearDocumentoDeLaHoja({ ...c, plan: { ...plan, elecciones: [ia, digital] } } as Parameters<
      typeof crearDocumentoDeLaHoja
    >[0]) as unknown as Nodo;
    const fichas = documento.querySelectorAll('.pe-ficha-compacta');
    const rotulos = ROTULOS_ESPERADOS[idioma];
    assert.equal(fichas.length, 2);
    assert.match(fichas[0]?.textContent ?? '', rotulos.modalidad);
    assert.match(fichas[0]?.textContent ?? '', rotulos.limite);
    assert.match(fichas[0]?.textContent ?? '', rotulos.imparte);
    assert.match(fichas[0]?.textContent ?? '', rotulos.certificado);
    assert.match(fichas[1]?.textContent ?? '', rotulos.sinModalidad);
    assert.doesNotMatch(
      fichas[1]?.textContent ?? '',
      /publicada hasta|publicada fins/u,
      'Sin límite no se inventa uno',
    );
    assert.doesNotMatch(fichas[0]?.textContent ?? '', /matrícula:|matrícula el/iu);
    assert.doesNotMatch(documento.textContent, /UTC|Clasificación|Classificació|Inicio personal|Inici personal/u);
    assert.doesNotMatch(documento.textContent, /\d{4}-\d{2}-\d{2}/u, 'Ninguna fecha en formato ISO');
  }
});

test('en papel la capacidad diaria acompaña a la fecha sin reducir la letra', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../web/estilos/recorrido/plan-formacion.css', import.meta.url), 'utf8');
  assert.match(css, /@media\s+print\s*\{[^}]*\.pe-capacidad-dia\s*\{[^}]*display:\s*inline/u);
  const regla = /@media\s+print\s*\{[^}]*\.pe-capacidad-dia\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
  assert.doesNotMatch(regla, /font(?:-size)?\s*:|overflow\s*:|visibility\s*:/u);
});
