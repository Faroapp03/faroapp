// Las pantallas enseñan lo que decide el motor: casilla solo para condiciones y afirmaciones sin revisar, el resumen de
// una condición en el idioma elegido y lo informativo como información, sin casilla.
import './aislar.ts';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';
import type { OpcionPlan, RequisitoRevisado } from '../../src/seleccion-formacion/contrato.ts';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { condicionesDeOpcion } from '../../web/scripts/recorrido/formacion/condiciones.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { type Nodo, pagina, prepararDom } from './dom.ts';
import { observadas, reiniciarInterfaz } from './interfaz-doble.ts';
import { opcionSintetica } from './opcion-sintetica.ts';

// El transporte es doble y la revisión la fija cada prueba; la selección y el recorrido son reales.
registerHooks({
  resolve(spec, contexto, siguiente) {
    if (contexto.parentURL?.endsWith('/seleccion-formacion/seleccionar.ts') && spec === './requisitos-revisados.ts') {
      return { url: new URL('./revision-requisitos-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    if (contexto.parentURL?.endsWith('/recorrido/formacion/cliente.js') && spec === '../../motor-local/cliente.js') {
      return { url: new URL('./formacion-local-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    if (spec.includes('/motor/src/catalogo-cursos/calendarios.js')) {
      return { url: new URL('../../src/catalogo-cursos/calendarios.ts', import.meta.url).href, shortCircuit: true };
    }
    if (spec.includes('/motor/src/catalogo-cursos/forma.js')) {
      return { url: new URL('../../src/catalogo-cursos/forma.ts', import.meta.url).href, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});
const { fijarRevision } = await import('./revision-requisitos-doble.ts');
const { prepararFormacionLocal } = await import('./formacion-local-doble.ts');
const { AHORA_FORMACION, casoDeFormacion } = await import('../fixtures/seleccion-formacion.ts');
const { empezarHojaDeRuta, olvidarHojaDeRuta } = await import('../../web/scripts/recorrido/hoja-de-ruta.js');
await cargarDiccionario('es');
await cargarDiccionario('ca');

const LITERAL = 'Saber guardar un fichero.';
const RESUMEN = { es: 'Saber guardar un archivo en tu equipo.', ca: 'Saber desar un fitxer al teu equip.' };
const RAZON = { es: 'Razón sintética.', ca: 'Raó sintètica.' };
const CIFRAS_SHA = 64;
const HUELLA = 'c'.repeat(CIFRAS_SHA);
const vuelta = () => new Promise((resolve) => setTimeout(resolve, 0));

function ultimo(selector: string): Nodo {
  const nodo = [...observadas.nodos].reverse().find((n) => n.matches(selector) || n.querySelector(selector));
  assert.ok(nodo, selector);
  return nodo.matches(selector) ? nodo : (nodo.querySelector(selector) as Nodo);
}
async function enviar() {
  const form = ultimo('form.rc-hoja-pregunta');
  const selects = form.querySelectorAll('select') as Nodo[];
  for (const [sufijo, valor] of [
    ['-registro', 'si'],
    ['-etapa', 'inicial'],
    ['-agenda.nivel-digital', 'intermedio'],
  ]) {
    (selects.find((s) => s.id.endsWith(sufijo ?? '')) as Nodo).value = valor ?? '';
  }
  const inputs = form.querySelectorAll('input') as Nodo[];
  (inputs.find((x) => x.id.startsWith('idioma-') && x.id.endsWith('-ca')) as Nodo).checked = true;
  (inputs.find((x) => x.id.startsWith('dia-') && x.id.endsWith('-1')) as Nodo).checked = true;
  (inputs.find((x) => x.id.startsWith('minutos-')) as Nodo).value = '45';
  (inputs.find((x) => x.id.startsWith('inicio-')) as Nodo).value = '2027-01-20';
  form.dispatchEvent(new Event('submit'));
  await vuelta();
}
/** El formulario de preferencias tras una primera selección, con las casillas de requisitos que ofrece. */
async function casillasDeRequisitos(tipo: 'condicion' | 'descripcion' | null) {
  const caso = casoDeFormacion(true);
  const id = JSON.stringify([caso.companero.fichas[0]?.programa_id, 'entrada']);
  const base = { revisadaSobre: HUELLA, literal: LITERAL, razon: RAZON };
  if (tipo === 'condicion') {
    fijarRevision({ [id]: { ...base, tipo, resumen: RESUMEN } });
  } else {
    fijarRevision(tipo ? { [id]: { ...base, tipo } } : {});
  }
  prepararFormacionLocal(async () => caso, AHORA_FORMACION);
  empezarHojaDeRuta({ dicho: 'Preparar mi formación', alAcabar: () => {} });
  await enviar();
  (ultimo('.rc-hoja').querySelector('.rc-hoja-pie .rc-boton-secundario') as Nodo).dispatchEvent(new Event('click'));
  const form = ultimo('form.rc-hoja-pregunta');
  return form.querySelectorAll('input').filter((i) => i.id.startsWith('requisito-')) as Nodo[];
}
/** La etiqueta de una casilla en el último formulario. */
function etiqueta(casilla: Nodo): Nodo {
  const etiquetas = ultimo('form.rc-hoja-pregunta').querySelectorAll('label') as Nodo[];
  const label = etiquetas.find((l) => l.htmlFor === casilla.id);
  assert.ok(label);
  return label;
}
beforeEach(() => {
  prepararDom();
  reiniciarEstado();
  reiniciarInterfaz();
  olvidarHojaDeRuta();
  fijarIdioma('es');
  Object.defineProperty(pagina, 'baseURI', { configurable: true, value: 'https://dispositivo.test/recorrido.html' });
});

test('Una condición revisada se confirma con su resumen en el idioma elegido', async () => {
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    olvidarHojaDeRuta();
    const casillas = await casillasDeRequisitos('condicion');
    assert.equal(casillas.length, 1);
    assert.equal(etiqueta(casillas[0] as Nodo).textContent, RESUMEN[idioma]);
  }
});
test('Una afirmación sin revisar se confirma con el texto publicado, en el idioma de la ficha', async () => {
  const casillas = await casillasDeRequisitos(null);
  assert.equal(casillas.length, 1);
  const label = etiqueta(casillas[0] as Nodo);
  assert.equal(label.textContent, LITERAL);
  assert.equal(label.lang, casoDeFormacion(true).companero.fichas[0]?.idioma_ficha);
});
test('Lo informativo no pide casilla', async () => {
  assert.deepEqual(await casillasDeRequisitos('descripcion'), []);
});

function requisito(caso: RequisitoRevisado['caso'], descripcion: string): RequisitoRevisado {
  return {
    id: JSON.stringify(['programa-x', descripcion]),
    programa_id: 'programa-x',
    caso,
    descripcion,
    idioma: 'en',
    resumen: caso === 'condicion' ? RESUMEN : null,
  };
}
test('Las condiciones de una opción separan las condiciones de la información publicada, sin casillas', () => {
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    const opcion = {
      ...opcionSintetica('ia', 'x'),
      aprendizaje: {},
      requisitos: [
        requisito('condicion', 'A Claude account'),
        requisito('sin_revisar', 'Basic command line'),
        requisito('informativa', 'No prior experience needed'),
      ],
    } as unknown as OpcionPlan;
    const bloques = condicionesDeOpcion(opcion).slice(-2) as unknown as Nodo[];
    const [condiciones, informacion] = bloques.map((b) => b.querySelectorAll('li').map((li) => li.textContent));
    assert.deepEqual(condiciones, [RESUMEN[idioma], 'Basic command line']);
    assert.deepEqual(informacion, ['No prior experience needed']);
    assert.match(
      bloques[1]?.textContent ?? '',
      idioma === 'es' ? /no es una condición para seguir el curso/u : /no és una condició per seguir el curs/u,
    );
    assert.equal(bloques.flatMap((b) => b.querySelectorAll('input')).length, 0);
    const publicada = bloques[1]?.querySelector('li') as Nodo | undefined;
    assert.equal(publicada?.lang, 'en');
  }
});
