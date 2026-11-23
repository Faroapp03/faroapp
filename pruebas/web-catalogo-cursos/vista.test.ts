import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { comprobarCspHtml } from '../../herramientas/web/csp.ts';
import { comprobarPagina } from '../../herramientas/web/paginas.ts';
import type { EntregaCatalogo, OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { fichaDelListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import { TEXTOS_CATALOGO_CURSOS as CA } from '../../web/idiomas/ca/catalogo-cursos.js';
import { TEXTOS_CATALOGO_CURSOS as ES } from '../../web/idiomas/es/catalogo-cursos.js';
import { pintarOfertas as pintarFichas } from '../../web/scripts/catalogo-cursos/pintar.js';
import { fijarIdioma, registrarDiccionario } from '../../web/scripts/textos.js';
import { dom } from '../web-datos-globales-comunes/dom.ts';

const bytes = readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url));
const referencia = JSON.parse(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8'),
);
const catalogo = leerCatalogo(bytes, referencia);

function pintarOfertas(lista: HTMLElement, datos: EntregaCatalogo, ofertas: readonly OfertaCatalogo[], consulta = '') {
  const proveedores = new Map(datos.proveedores.map((p) => [p.id, p.nombre]));
  pintarFichas(
    lista,
    ofertas.map((o) => fichaDelListado(o, proveedores.get(o.proveedor_id) ?? '')),
    consulta,
  );
}

test('la edición explica la solicitud, entidad, colectivos, sector y plazo en los dos idiomas', (t) => {
  dom(t);
  registrarDiccionario('es', ES);
  registrarDiccionario('ca', CA);
  const oferta = catalogo.ofertas[0];
  assert.ok(oferta);
  const ficha = {
    ...oferta,
    preinscripcion: {
      inicio: '2026-10-01',
      fin: '2026-10-25',
      centro: 'Centro A',
      colectivos: ['autonomos', 'desempleados'] as const,
      sector: 'Metal',
    },
  };
  const lista = document.createElement('ul');
  const terminos = {
    es: [/preinscripción/iu, /cuenta/iu, /autónom/iu, /desemple/iu],
    ca: [/preinscripció/iu, /compte/iu, /autònom/iu, /atur/iu],
  };
  const plazo = { es: 'Del 1 al 25 de octubre de 2026', ca: 'De l’1 al 25 d’octubre del 2026' };
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    pintarOfertas(lista, catalogo, [ficha]);
    const contenido = lista.textContent ?? '';
    for (const literal of ['Centro A', 'Metal', plazo[idioma]]) {
      assert.ok(contenido.includes(literal));
    }
    for (const termino of terminos[idioma]) {
      assert.match(contenido, termino);
    }
    pintarOfertas(lista, catalogo, [
      { ...ficha, preinscripcion: { ...ficha.preinscripcion, sector: 'INTERSECTORIAL' } },
    ]);
    assert.doesNotMatch(lista.textContent ?? '', /INTERSECTORIAL/u);
  }
  fijarIdioma('es');
});

test('ficha de seis datos conserva desconocidos y texto literal sin HTML ajeno, también en catalán', (t) => {
  const d = dom(t);
  registrarDiccionario('es', ES);
  registrarDiccionario('ca', CA);
  const lista = document.createElement('ul');
  const oferta = catalogo.ofertas[0];
  assert.ok(oferta);
  const malicioso = { ...oferta, titulo_programa: '<script>programación</script>' };
  fijarIdioma('es');
  pintarOfertas(lista, catalogo, [malicioso], 'programacion');
  assert.match(lista.textContent ?? '', /<script>programación<\/script>/);
  assert.match(lista.textContent ?? '', /No indicado/);
  assert.match(lista.textContent ?? '', /0,0000001 horas/);
  assert.match(lista.textContent ?? '', /Comprobado: 22 de octubre de 2026/);
  const NUMERO_DATOS = 6;
  assert.equal(lista.querySelectorAll('dt').length, NUMERO_DATOS);
  assert.equal(lista.querySelector('mark')?.textContent, 'programación');
  assert.ok(!d.creados.some((n) => ['SCRIPT', 'DETAILS'].includes(n.tagName)));
  assert.ok(!lista.textContent?.includes('sin_soporte') && !lista.textContent?.includes('Válida hasta'));
  const enlace = lista.querySelector('a');
  assert.equal(enlace?.target, '_blank');
  assert.equal(enlace?.rel, 'noopener noreferrer');
  fijarIdioma('ca');
  pintarOfertas(lista, catalogo, [malicioso]);
  assert.match(lista.textContent ?? '', /No indicat/);
  assert.match(lista.textContent ?? '', /Comprovat: 22 d’octubre del 2026/);
  assert.equal(Object.isFrozen(catalogo), true);
});

test('no atribuye nivel o marca del título ni convierte asincronía en fechas abiertas', (t) => {
  dom(t);
  fijarIdioma('es');
  registrarDiccionario('es', ES);
  const lista = document.createElement('ul');
  const oferta = catalogo.ofertas[0];
  assert.ok(oferta);
  const hechos = {
    ...oferta.hechos,
    sincronia: { ...oferta.hechos.sincronia, motivo: 'conocido' as const, valor: 'asincrona' },
  };
  pintarOfertas(lista, catalogo, [{ ...oferta, titulo_programa: 'Excel avanzado de Microsoft', hechos }]);
  assert.ok(!lista.textContent?.includes('Cuando quieras'));
  assert.ok(!lista.textContent?.includes('Enseña a usar'));
  assert.equal(lista.querySelector('dd .lecturas-nivel')?.textContent, 'Por confirmar');
  assert.match(
    lista.querySelector('dd')?.textContent ?? '',
    /No hay una revisión de dificultad vinculada a esta oferta/,
  );
});

test('certificado general conserva su alcance y precio conocido no inventa opcionalidad', (t) => {
  dom(t);
  fijarIdioma('es');
  registrarDiccionario('es', ES);
  const lista = document.createElement('ul');
  const oferta = catalogo.ofertas[0];
  assert.ok(oferta);
  const hechos = {
    ...oferta.hechos,
    certificado_gratuito: {
      ...oferta.hechos.certificado_gratuito,
      motivo: 'conocido' as const,
      valor: true,
      alcance: 'declaracion_general' as const,
    },
  };
  pintarOfertas(lista, catalogo, [{ ...oferta, hechos }]);
  assert.match(lista.textContent ?? '', /Certificado gratuito según la entidad/);
  pintarOfertas(lista, catalogo, [
    {
      ...oferta,
      hechos: {
        ...hechos,
        certificado_gratuito: { ...hechos.certificado_gratuito, valor: null, motivo: 'no_consta_en_evidencia' },
        coste_certificado: { ...oferta.hechos.coste_certificado, motivo: 'conocido', valor: 25, moneda: 'EUR' },
      },
    },
  ]);
  assert.match(lista.textContent ?? '', /Certificado: 25/);
  assert.ok(!lista.textContent?.includes('opcional'));
});

test('página accesible y sin controles IA; diccionarios mantienen claves/marcadores', () => {
  const html = readFileSync(new URL('../../web/cursos.html', import.meta.url), 'utf8');
  assert.deepEqual(comprobarPagina('cursos.html', html), []);
  assert.deepEqual(comprobarCspHtml('cursos.html', html), []);
  assert.ok(!html.includes('data-interruptor-modo') && !html.includes('turnstile'));
  assert.match(html, /<title data-texto="catalogo.pagina-titulo">Cursos · Faro<\/title>/);
  assert.equal(ES['catalogo.pagina-titulo'], 'Cursos · Faro');
  assert.equal(CA['catalogo.pagina-titulo'], 'Cursos · Faro');
  assert.match(html, /data-texto="comun.pie.doctor">Comprobar Faro<\/a/);
  assert.match(html, /role="status" aria-live="polite" data-cuenta data-texto="catalogo.cargando"/);
  assert.deepEqual(Object.keys(ES).sort(), Object.keys(CA).sort());
  for (const clave of Object.keys(ES)) {
    assert.deepEqual(ES[clave as keyof typeof ES].match(/\{\w+\}/gu), CA[clave as keyof typeof CA].match(/\{\w+\}/gu));
  }
});

test('fechas muestran formación y matrícula por separado sin sustituir el idioma o la hora publicada', (t) => {
  dom(t);
  registrarDiccionario('es', ES);
  registrarDiccionario('ca', CA);
  const original = catalogo.ofertas[0];
  assert.ok(original);
  const base = { motivo: 'conocido' as const, alcance: 'edicion' as const, unidad: null, moneda: null };
  const oferta = {
    ...original,
    hechos: {
      ...original.hechos,
      calendario_formacion: {
        ...base,
        valor: { tipo: 'sesiones' as const, sesiones: [{ inicio: '2026-10-25T10:00', fin: '2026-10-25T12:00' }] },
      },
      calendario_matricula: { ...base, valor: { tipo: 'matricula' as const, inicio: null, fin: '2026-10-24' } },
    },
  };
  const lista = document.createElement('ul');
  fijarIdioma('es');
  pintarOfertas(lista, catalogo, [oferta]);
  assert.match(lista.textContent ?? '', /Formación: 25 de octubre de 2026, de 10:00 a 12:00 \(huso horario/);
  assert.match(lista.textContent ?? '', /Fin de la inscripción: 24 de octubre de 2026/);
  assert.ok(!lista.textContent?.includes('UTC'));
  fijarIdioma('ca');
  pintarOfertas(lista, catalogo, [oferta]);
  assert.match(lista.textContent ?? '', /Formació: 25 d’octubre del 2026, de 10:00 a 12:00 \(fus horari/);
  assert.match(lista.textContent ?? '', /Fi de la inscripció: 24 d’octubre del 2026/); // Con un solo extremo, la etiqueta dice qué fecha es: el comienzo del curso o la apertura de la inscripción.
  const soloInicio = {
    ...oferta,
    hechos: {
      ...oferta.hechos,
      calendario_formacion: { ...base, valor: { tipo: 'periodo-formativo' as const, inicio: '2026-01-05', fin: null } },
      calendario_matricula: { ...base, valor: { tipo: 'matricula' as const, inicio: '2025-12-01', fin: null } },
    },
  };
  pintarOfertas(lista, catalogo, [soloInicio]);
  assert.match(lista.textContent ?? '', /Comença: 5 de gener del 2026/);
  assert.match(lista.textContent ?? '', /Inici de la inscripció: 1 de desembre del 2025/);
  fijarIdioma('es');
  pintarOfertas(lista, catalogo, [soloInicio]);
  assert.match(lista.textContent ?? '', /Empieza: 5 de enero de 2026/);
  assert.match(lista.textContent ?? '', /Inicio de la inscripción: 1 de diciembre de 2025/);
});

test('las sesiones llevan una sola etiqueta, con su rango o su fecha sola, en castellano y en catalán', (t) => {
  dom(t);
  const original = catalogo.ofertas[0];
  assert.ok(original);
  const base = { motivo: 'conocido' as const, alcance: 'edicion' as const, unidad: null, moneda: null };
  const conSesiones = (sesiones: { inicio: string | null; fin: string | null }[]) => ({
    ...original,
    hechos: { ...original.hechos, calendario_formacion: { ...base, valor: { tipo: 'sesiones' as const, sesiones } } },
  });
  const dos = conSesiones([
    { inicio: '2026-10-25T10:00', fin: '2026-10-25T12:00' },
    { inicio: '2026-10-26', fin: null },
  ]);
  const cinco = conSesiones([
    ...['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((dia) => ({
      inicio: dia,
      fin: null,
    })),
  ]);
  const lista = document.createElement('ul');
  const casos = [
    [
      'es',
      dos,
      'Formación: 25 de octubre de 2026, de 10:00 a 12:00 (huso horario por confirmar); 26 de octubre de 2026',
    ],
    ['es', cinco, 'Formación: 2 de noviembre de 2026; 3 de noviembre de 2026; 3 sesiones más en la ficha'],
    ['ca', dos, 'Formació: 25 d’octubre del 2026, de 10:00 a 12:00 (fus horari per confirmar); 26 d’octubre del 2026'],
    ['ca', cinco, 'Formació: 2 de novembre del 2026; 3 de novembre del 2026; 3 sessions més a la fitxa'],
  ] as const;
  for (const [idioma, oferta, esperado] of casos) {
    fijarIdioma(idioma);
    pintarOfertas(lista, catalogo, [oferta]);
    assert.ok(lista.textContent?.includes(esperado), `${idioma}: ${esperado}`);
    assert.equal(lista.textContent?.split(idioma === 'ca' ? 'Formació:' : 'Formación:').length, 2, 'Una sola etiqueta');
  }
  fijarIdioma('es');
});

test('la ventana del aula y las sesiones con huso se leen como días y horas de Barcelona, sin huso ni segundos', (t) => {
  dom(t);
  registrarDiccionario('es', ES);
  registrarDiccionario('ca', CA);
  const original = catalogo.ofertas[0];
  assert.ok(original);
  const base = { motivo: 'conocido' as const, alcance: 'edicion' as const, unidad: null, moneda: null };
  const ventana = {
    tipo: 'ventana-acceso' as const,
    inicio: '2026-01-01T00:00:00+01:00',
    fin: '2026-12-31T23:59:00+01:00',
  };
  const sesion = { inicio: '2026-11-19T16:00:00+01:00', fin: '2026-11-19T19:00:00+01:00' };
  const conFechas = {
    ...original,
    hechos: {
      ...original.hechos,
      calendario_aula: { ...base, valor: ventana },
      calendario_formacion: { ...base, valor: { tipo: 'sesiones' as const, sesiones: [sesion] } },
    },
  };
  const lista = document.createElement('ul');
  const esperado = {
    es: 'Formación: 19 de noviembre de 2026, de 16:00 a 19:00 · Acceso al aula: del 1 de enero al 31 de diciembre de 2026',
    ca: 'Formació: 19 de novembre del 2026, de 16:00 a 19:00 · Accés a l’aula: de l’1 de gener al 31 de desembre del 2026',
  };
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    pintarOfertas(lista, catalogo, [conFechas]);
    assert.ok(lista.textContent?.includes(esperado[idioma]), `${idioma}: ${esperado[idioma]}`);
    assert.doesNotMatch(lista.textContent ?? '', /[+-]\d{2}:\d{2}|\d{2}:\d{2}:\d{2}|UTC|00:00|23:59/u);
  }
  fijarIdioma('es');
});

test('una incidencia del enlace conserva el curso y su enlace, con un aviso junto a él, en castellano y catalán', (t) => {
  dom(t);
  registrarDiccionario('es', ES);
  registrarDiccionario('ca', CA);
  const lista = document.createElement('ul');
  const oferta = catalogo.ofertas[0];
  assert.ok(oferta);
  fijarIdioma('es');
  pintarOfertas(lista, catalogo, [oferta]);
  assert.doesNotMatch(lista.textContent ?? '', /no respondió como se esperaba/u);
  const conIncidencia = { ...oferta, incidencia_enlace_el: '2026-10-22T09:00:00Z' };
  pintarOfertas(lista, catalogo, [conIncidencia]);
  assert.equal(lista.querySelector('a')?.href, oferta.url);
  assert.match(
    lista.textContent ?? '',
    /este enlace no respondió como se esperaba\. Si no se abre, el curso puede buscarse/u,
  );
  fijarIdioma('ca');
  pintarOfertas(lista, catalogo, [conIncidencia]);
  assert.match(lista.textContent ?? '', /aquest enllaç no va respondre com s’esperava/u);
});
