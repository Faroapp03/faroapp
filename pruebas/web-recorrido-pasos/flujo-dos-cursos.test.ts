import './aislar.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, mock, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { APRENDIZAJE, REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';
import { estado, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { type Nodo, pagina, prepararDom } from './dom.ts';
import { observadas, reiniciarInterfaz } from './interfaz-doble.ts';

registerHooks({
  resolve(spec, contexto, siguiente) {
    if (
      contexto.parentURL?.endsWith('/seleccion-formacion/seleccionar.ts') &&
      spec === '../catalogo-cursos/clasificacion.ts'
    ) {
      const clasificacion = new URL('../../src/catalogo-cursos/clasificacion.ts', import.meta.url).href;
      const codigo = `import { evaluarClasificacion as original } from ${JSON.stringify(clasificacion)};
        export function evaluarClasificacion(oferta) {
          const evaluacion = original(oferta);
          const id = oferta.unidad.id;
          if (oferta.proveedor_id !== 'proveedor-1') return evaluacion;
          const temas = ['ia-1', 'ia-2'].includes(id)
            ? ['ia']
            : ['digital-1', 'digital-2'].includes(id) ? ['digital'] : evaluacion.metadatos.temas;
          return { ...evaluacion, metadatos: { ...evaluacion.metadatos, temas } };
        }`;
      return { url: `data:text/javascript,${encodeURIComponent(codigo)}`, shortCircuit: true };
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
const { moverRelojFormacion, peticionesFormacion, prepararFormacionLocal } = await import('./formacion-local-doble.ts');
const { dosCursosSinteticos } = await import('../fixtures/dos-cursos-sinteticos.ts');
mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-07T00:00:00Z') });
after(() => mock.timers.reset());
const { empezarHojaDeRuta, olvidarHojaDeRuta } = await import('../../web/scripts/recorrido/hoja-de-ruta.js');
await cargarDiccionario('es');
const { catalogo, companero } = dosCursosSinteticos();
const vuelta = () => new Promise((r) => setTimeout(r, 0));
async function propuesta(
  obtenerAcreditaciones?: (
    signal: AbortSignal,
  ) => Promise<import('../../web/scripts/recorrido/plan-formacion/contrato.js').AcreditacionPlan[]>,
  datos = { catalogo, companero, ahora: Date.parse('2026-11-07T00:00:00Z'), inicio: '2026-11-09' },
) {
  prepararDom();
  Object.defineProperty(pagina, 'baseURI', { configurable: true, value: 'https://dispositivo.test/recorrido.html' });
  reiniciarEstado();
  reiniciarInterfaz();
  fijarIdioma('es');
  olvidarHojaDeRuta();
  prepararFormacionLocal(async () => ({ catalogo: datos.catalogo, companero: datos.companero }), datos.ahora);
  empezarHojaDeRuta({
    dicho: 'Preparar formación',
    alAcabar: () => {},
    ...(obtenerAcreditaciones ? { obtenerAcreditaciones } : {}),
  });
  const form = observadas.nodos.at(-1) as Nodo;
  const controles = form.querySelectorAll('select');
  (controles.find((s) => s.id.endsWith('-registro')) as Nodo).value = 'si';
  (controles.find((s) => s.id.endsWith('-etapa')) as Nodo).value = 'inicial';
  (controles.find((s) => s.id.endsWith('-agenda.nivel-digital')) as Nodo).value = 'intermedio';
  const inputs = form.querySelectorAll('input') as Nodo[];
  (inputs.find((x) => x.id.startsWith('idioma-') && x.id.endsWith('-ca')) as Nodo).checked = true;
  (inputs.find((x) => x.id.startsWith('dia-') && x.id.endsWith('-1')) as Nodo).checked = true;
  (inputs.find((x) => x.id.startsWith('minutos-')) as Nodo).value = '45';
  (inputs.find((x) => x.id.startsWith('inicio-')) as Nodo).value = datos.inicio;
  form.dispatchEvent(new Event('submit'));
  await vuelta();
  const vista = observadas.nodos.at(-1) as Nodo;
  const entradas = vista.querySelectorAll('input') as Nodo[];
  assert.ok(entradas.some((x) => x.name.endsWith('-ia')));
  assert.ok(entradas.some((x) => x.name.endsWith('-digital')));
  const ia = entradas.find((x) => x.name.endsWith('-ia')) as Nodo;
  const digital = entradas.find((x) => x.name.endsWith('-digital') && x.value !== ia.value);
  assert.ok(digital, 'dos ofertas distintas');
  ia.checked = true;
  digital.checked = true;
  return vista;
}
test('sin días, tiempo y fecha explícitos no prepara ni inventa una agenda', async () => {
  prepararDom();
  Object.defineProperty(pagina, 'baseURI', { configurable: true, value: 'https://dispositivo.test/recorrido.html' });
  reiniciarEstado();
  reiniciarInterfaz();
  fijarIdioma('es');
  olvidarHojaDeRuta();
  prepararFormacionLocal(async () => ({ catalogo, companero }), Date.parse('2026-11-07T00:00:00Z'));
  empezarHojaDeRuta({ dicho: 'Preparar formación', alAcabar: () => {} });
  const form = observadas.nodos.at(-1) as Nodo;
  const controles = form.querySelectorAll('select');
  (controles.find((s) => s.id.endsWith('-registro')) as Nodo).value = 'si';
  (controles.find((s) => s.id.endsWith('-etapa')) as Nodo).value = 'inicial';
  (controles.find((s) => s.id.endsWith('-agenda.nivel-digital')) as Nodo).value = 'intermedio';
  form.dispatchEvent(new Event('submit'));
  await vuelta();
  assert.equal(peticionesFormacion.length, 0);
  assert.match(form.textContent, /Indica al menos un día/u);
});
test('confirma exactamente las dos ofertas elegidas tras revalidar en el dispositivo', async () => {
  const vista = await propuesta();
  (vista.querySelector('.rc-boton-principal') as Nodo).dispatchEvent(new Event('click'));
  await vuelta();
  assert.deepEqual(
    estado.hojaDeRuta?.plan.elecciones.map((o) => o.bloque),
    ['ia', 'digital'],
  );
  assert.equal(estado.hojaDeRuta?.plan.elecciones.length, 2);
  assert.deepEqual(estado.hojaDeRuta?.plan.disponibilidad, { dias: [1], minutosPorDia: 45 });
  assert.equal(estado.hojaDeRuta?.plan.preferencias.inicio, '2026-11-09');
  assert.equal(estado.hojaDeRuta?.plan.preferencias.nivelDigital, 'intermedio');
  for (const peticion of peticionesFormacion) {
    assert.doesNotMatch(peticion.cuerpo, /2026-11-09|minutosPorDia|nivelDigital|dias/u);
  }
});
test('confirma y guarda dos ofertas reales distintas tras revalidarlas', async () => {
  const catalogoReal = JSON.parse(readFileSync(new URL(`../../web/${REFERENCIA.ruta}`, import.meta.url), 'utf8'));
  const companeroReal = JSON.parse(readFileSync(new URL(`../../web/${APRENDIZAJE.ruta}`, import.meta.url), 'utf8'));
  const MILISEGUNDOS_POR_SEGUNDO = 1_000;
  const MILISEGUNDOS_POR_DIA = 86_400_000;
  const ahora = Date.parse(catalogoReal.corte_proyeccion_utc) + MILISEGUNDOS_POR_SEGUNDO;
  const inicio = new Date(ahora + MILISEGUNDOS_POR_DIA).toISOString().slice(0, 10);
  mock.timers.setTime(ahora);
  try {
    const vista = await propuesta(undefined, { catalogo: catalogoReal, companero: companeroReal, ahora, inicio });
    const seleccionadas = (vista.querySelectorAll('input') as Nodo[]).filter((x) => x.checked);
    const ids = seleccionadas.map((x) => x.value);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    assert.ok(ids.every((id) => catalogoReal.ofertas.some((o: { unidad: { id: string } }) => o.unidad.id === id)));
    (vista.querySelector('.rc-boton-principal') as Nodo).dispatchEvent(new Event('click'));
    await vuelta();
    assert.equal(peticionesFormacion.length, 2);
    assert.deepEqual(
      estado.hojaDeRuta?.plan.elecciones.map((o) => o.bloque),
      ['ia', 'digital'],
    );
    assert.deepEqual(
      estado.hojaDeRuta?.plan.elecciones.map((o) => o.oferta.unidad.id),
      ids,
    );
  } finally {
    mock.timers.setTime(Date.parse('2026-11-07T00:00:00Z'));
  }
});
test('si las ofertas dejan de estar vigentes antes de confirmar no guarda el plan', async () => {
  const vista = await propuesta();
  moverRelojFormacion(Date.parse('2099-01-01T00:00:00Z'));
  (vista.querySelector('.rc-boton-principal') as Nodo).dispatchEvent(new Event('click'));
  await vuelta();
  assert.equal(estado.hojaDeRuta, null);
});

test('una respuesta antigua de formación no se confunde con el contrato de dos cursos', async () => {
  const { seleccionarFormacion } = await import('../../src/seleccion-formacion/seleccionar.ts');
  const { leerSeleccion } = await import('../../web/scripts/recorrido/formacion/cliente.js');
  const p = {
    etapa: 'inicial',
    idiomas: ['es'],
    modalidad: 'cualquiera',
    aceptaRegistro: true,
    requisitosConfirmados: [],
    excluidos: [],
  } as const;
  const nueva = seleccionarFormacion(catalogo, companero, p, Date.parse('2026-11-07T00:00:00Z'));
  assert.equal(nueva.schema_version, 2);
  assert.equal(leerSeleccion(nueva).schema_version, 2);
  const { opciones: _opciones, ...anterior } = nueva;
  assert.throws(() => leerSeleccion({ ...anterior, schema_version: 1 }), /incompatible/u);
  assert.throws(() => leerSeleccion({ ...nueva, schema_version: 1 }), /incompatible/u);
});

test('ofertas sintéticas muestran por separado límite y acceso al aula, sin inventar matrícula o ficha', async () => {
  const vista = await propuesta();
  const texto = vista.textContent ?? '';
  assert.match(texto, /El proveedor indica que la oferta está publicada hasta el 31 de diciembre de 2026\./u);
  assert.match(texto, /Acceso al aula: del \d{1,2} de \p{L}+ al 31 de diciembre de 2026/u);
  assert.doesNotMatch(texto, /UTC|\d{4}-\d{2}-\d{2}T/u, 'Ni marcas UTC ni fechas ISO a la vista');
  assert.doesNotMatch(
    texto,
    /Límite publicado aplicable|matrícula:/u,
    'Un límite publicado no es una fecha de matrícula',
  );
  assert.match(texto, /El proveedor no publica fechas de matrícula/u);
  assert.match(texto, /Faro no ha podido revisar el programa de este curso/u);
});

test('si cambia el día antes de confirmar, explica que hay que elegir otra fecha', async () => {
  const vista = await propuesta();
  moverRelojFormacion(Date.parse('2026-11-09T23:30:00Z'));
  (vista.querySelector('.rc-boton-principal') as Nodo).dispatchEvent(new Event('click'));
  await vuelta();
  assert.equal(estado.hojaDeRuta, null);
  assert.ok(observadas.mensajes.some((m) => JSON.stringify(m).includes('agenda.fecha-pasada')));
});

const certificado = {
  codigo: 'ABCD1234',
  nombre: 'Transporte',
  nivel: 2 as const,
  relacion: 'ocupacion' as const,
  enlaceBoe: 'https://www.boe.es/ejemplo',
  ocupacion: '8331.1',
  idioma: 'es' as const,
  tramite: 'https://tramits.gencat.cat/ca/21900_Acreditat',
  fuente: 'Fuente oficial',
  comprobado: '2026-10-20',
  ofertaActualizada: '2026-10-01',
};
test('la elección de acreditación se incorpora sin alterar los dos cursos', async () => {
  const vista = await propuesta(async () => [certificado]);
  (vista.querySelector('.rc-boton-principal') as Nodo).dispatchEvent(new Event('click'));
  await vuelta();
  const eleccion = observadas.nodos.at(-1) as Nodo;
  assert.match(eleccion.textContent, /ABCD1234/u);
  (eleccion.querySelector('button') as Nodo).dispatchEvent(new Event('click'));
  await vuelta();
  assert.deepEqual(estado.hojaDeRuta?.plan.acreditacion, certificado);
  assert.deepEqual(
    estado.hojaDeRuta?.plan.elecciones.map((o) => o.bloque),
    ['ia', 'digital'],
  );
});
test('una oferta caducada mientras se elige acreditación no se guarda', async () => {
  const vista = await propuesta(async () => [certificado]);
  (vista.querySelector('.rc-boton-principal') as Nodo).dispatchEvent(new Event('click'));
  await vuelta();
  const eleccion = observadas.nodos.at(-1) as Nodo;
  moverRelojFormacion(Date.parse('2099-01-01T00:00:00Z'));
  (eleccion.querySelector('button') as Nodo).dispatchEvent(new Event('click'));
  await vuelta();
  assert.equal(estado.hojaDeRuta, null);
});
