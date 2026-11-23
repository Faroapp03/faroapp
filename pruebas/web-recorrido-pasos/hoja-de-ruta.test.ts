import './aislar.ts';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, beforeEach, mock, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { estado, nuevaTarea, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { type Nodo, pagina, prepararDom } from './dom.ts';
import { observadas, reiniciarInterfaz } from './interfaz-doble.ts';

// El transporte y la clasificación de las ofertas sintéticas son dobles; la selección y el recorrido son reales.
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
        const temas = id.startsWith('ia-') ? ['ia'] : id.startsWith('digital-') ? ['digital'] : [];
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
const { AHORA_FORMACION, casoDeFormacion } = await import('../fixtures/seleccion-formacion.ts');
const AHORA = Date.parse('2026-11-07T00:00:00Z');
mock.timers.enable({ apis: ['Date'], now: AHORA });
after(() => mock.timers.reset());
const { catalogo: catalogoSintetico, companero: companeroSintetico } = dosCursosSinteticos();
const { empezarHojaDeRuta, olvidarHojaDeRuta } = await import('../../web/scripts/recorrido/hoja-de-ruta.js');
await cargarDiccionario('es');
await cargarDiccionario('ca');
const finalizadas: (number | null)[] = [];
const vuelta = () => new Promise((resolve) => setTimeout(resolve, 0));
function ultimo(selector: string): Nodo {
  const nodo = [...observadas.nodos].reverse().find((n) => n.matches(selector) || n.querySelector(selector));
  assert.ok(nodo, selector);
  return nodo.matches(selector) ? nodo : (nodo.querySelector(selector) as Nodo);
}
function campo(form: Nodo, sufijo: string): Nodo {
  const c = form.querySelectorAll('select').find((s) => s.id.endsWith(sufijo));
  assert.ok(c, sufijo);
  return c as Nodo;
}
function confirmadaActual() {
  return estado.hojaDeRuta;
}
function empezar() {
  empezarHojaDeRuta({ dicho: 'Preparar mi formación', alAcabar: (n) => finalizadas.push(n) });
}
/** registro: «si» acepta crear una cuenta, «no» la rechaza y «» es «Prefiero revisarlo antes». */
async function enviar(registro: 'si' | 'no' | '' = 'si') {
  const form = ultimo('form.rc-hoja-pregunta');
  campo(form, '-registro').value = registro;
  campo(form, '-etapa').value = 'inicial';
  campo(form, '-agenda.nivel-digital').value = 'intermedio';
  const inputs = form.querySelectorAll('input') as Nodo[];
  (inputs.find((x) => x.id.startsWith('idioma-') && x.id.endsWith('-ca')) as Nodo).checked = true;
  (inputs.find((x) => x.id.startsWith('dia-') && x.id.endsWith('-1')) as Nodo).checked = true;
  (inputs.find((x) => x.id.startsWith('minutos-')) as Nodo).value = '45';
  (inputs.find((x) => x.id.startsWith('inicio-')) as Nodo).value = '2027-01-20';
  form.dispatchEvent(new Event('submit'));
  await vuelta();
}
function elegir() {
  const propuesta = ultimo('.rc-hoja');
  const inputs = propuesta.querySelectorAll('input') as Nodo[];
  const ia = inputs.find((x) => x.name.endsWith('-ia'));
  const digital = inputs.find((x) => x.name.endsWith('-digital') && x.value !== ia?.value);
  assert.ok(ia && digital, 'dos ofertas distintas');
  ia.checked = true;
  digital.checked = true;
  return { propuesta, ids: [ia.value, digital.value] };
}
async function confirmar(propuesta: Nodo) {
  (propuesta.querySelector('.rc-hoja-pie .rc-boton-principal') as Nodo).dispatchEvent(new Event('click'));
  await vuelta();
}
beforeEach(() => {
  mock.timers.setTime(AHORA);
  prepararDom();
  reiniciarEstado();
  reiniciarInterfaz();
  fijarIdioma('es');
  olvidarHojaDeRuta();
  finalizadas.length = 0;
  Object.defineProperty(pagina, 'baseURI', {
    configurable: true,
    value: 'https://dispositivo.test/Mis%20documentos/A%C3%B1o%202026/recorrido.html',
  });
  const privada = nuevaTarea('Tarea privada sintética');
  privada.tiempo = 'mucho';
  estado.tareas.push(privada);
  prepararFormacionLocal(async () => ({ catalogo: catalogoSintetico, companero: companeroSintetico }), AHORA);
});
test('La carpeta anidada usa la operación virtual y no envía ocupación, tarea ni disponibilidad', async () => {
  empezar();
  assert.equal(peticionesFormacion.length, 0);
  await enviar();
  assert.equal(new URL(peticionesFormacion[0]?.url ?? '').pathname, '/local/formacion/seleccionar');
  const cuerpo = peticionesFormacion[0]?.cuerpo ?? '';
  assert.doesNotMatch(cuerpo, /Tarea privada|isco|tareas|minutosPorDia|2027-01-20/u);
  const { ids } = elegir();
  assert.notEqual(ids[0], ids[1]);
});
test('«Prefiero revisarlo antes» llega como nulo y no excluye las ofertas que piden registro', async () => {
  empezar();
  await enviar('');
  assert.equal(JSON.parse(peticionesFormacion[0]?.cuerpo ?? '{}').aceptaRegistro, null);
  const propuesta = ultimo('.rc-hoja');
  assert.ok(propuesta.querySelectorAll('input').length > 0);
  assert.match(propuesta.textContent ?? '', /El proveedor indica que es necesario registrarse\./u);
  assert.equal(estado.hojaDeRuta, null);
});
test('Quien no quiere crear una cuenta no recibe ofertas que consta que piden registro', async () => {
  empezar();
  await enviar('no');
  assert.equal(JSON.parse(peticionesFormacion[0]?.cuerpo ?? '{}').aceptaRegistro, false);
  assert.equal(ultimo('.rc-hoja').querySelectorAll('input').length, 0);
  assert.equal(estado.hojaDeRuta, null);
});
test('Confirmar vuelve a comprobar vigencia y guarda las dos elecciones', async () => {
  empezar();
  await enviar();
  const { propuesta, ids } = elegir();
  assert.equal(estado.hojaDeRuta, null);
  await confirmar(propuesta);
  assert.equal(peticionesFormacion.length, 2);
  const confirmada = confirmadaActual();
  assert.ok(confirmada);
  assert.deepEqual(
    confirmada.plan.elecciones.map((o) => o.oferta.unidad.id),
    ids,
  );
  assert.deepEqual(
    confirmada.plan.elecciones.map((o) => o.bloque),
    ['ia', 'digital'],
  );
  assert.equal(confirmada.seleccion.calculado_el, new Date(AHORA).toISOString());
  assert.deepEqual(finalizadas, [2]);
});
test('Semanas después sin catálogo nuevo se guardan elecciones con sus condiciones acreditadas', async () => {
  empezar();
  await enviar();
  const { propuesta, ids } = elegir();
  const semanasDespues = Date.parse('2026-11-19T10:00:00Z');
  moverRelojFormacion(semanasDespues);
  await confirmar(propuesta);
  assert.deepEqual(
    estado.hojaDeRuta?.plan.elecciones.map((o) => o.oferta.unidad.id),
    ids,
  );
  assert.equal(estado.hojaDeRuta?.seleccion.calculado_el, new Date(semanasDespues).toISOString());
  assert.ok(estado.hojaDeRuta?.plan.elecciones.every((o) => o.oferta.hechos && o.oferta.comprobado_el));
  assert.deepEqual(finalizadas, [2]);
});
test('Una oferta que alcanza su límite mientras se leía exige revisar la nueva propuesta', async () => {
  empezar();
  await enviar();
  const { propuesta } = elegir();
  moverRelojFormacion(Date.parse('2026-12-31T22:59:00Z'));
  await confirmar(propuesta);
  assert.equal(estado.hojaDeRuta, null);
  assert.deepEqual(finalizadas, []);
  assert.ok(observadas.mensajes.some((m) => JSON.stringify(m).includes('formacion.actualizada')));
});
test('Si el reloj retrocede antes de confirmar, no se guarda nada y se dice que la fecha del dispositivo está atrasada', async () => {
  empezar();
  await enviar();
  const { propuesta } = elegir();
  moverRelojFormacion(Date.parse('2020-01-01T00:00:00Z'));
  await confirmar(propuesta);
  assert.equal(estado.hojaDeRuta, null);
  assert.deepEqual(finalizadas, []);
  assert.ok(observadas.mensajes.some((m) => JSON.stringify(m).includes('recorrido.error.reloj-atrasado')));
  assert.ok(!observadas.mensajes.some((m) => JSON.stringify(m).includes('formacion.fallo')));
});
test('Revisar conserva preferencias y cierra los controles de la propuesta anterior', async () => {
  empezar();
  await enviar();
  const { propuesta } = elegir();
  (propuesta.querySelector('.rc-hoja-pie .rc-boton-secundario') as Nodo).dispatchEvent(new Event('click'));
  const form = ultimo('form.rc-hoja-pregunta');
  assert.equal(campo(form, '-registro').value, 'si');
  assert.equal(campo(form, '-agenda.nivel-digital').value, 'intermedio');
  assert.ok(propuesta.querySelectorAll('button').every((b) => (b as Nodo).disabled));
  assert.ok(propuesta.querySelectorAll('input').every((b) => (b as Nodo).disabled));
});
test('Excluir un programa conserva preferencias y lo retira de ambas listas y de la revalidación', async () => {
  empezar();
  await enviar();
  const anterior = ultimo('.rc-hoja');
  const boton = anterior.querySelector('.rc-hoja-curso button') as Nodo;
  assert.ok(boton);
  boton.dispatchEvent(new Event('click'));
  await vuelta();
  const cuerpo = JSON.parse(peticionesFormacion.at(-1)?.cuerpo ?? '{}');
  assert.equal(cuerpo.aceptaRegistro, true);
  assert.equal(cuerpo.excluidos.length, 1);
  assert.ok(anterior.querySelectorAll('button').every((b) => (b as Nodo).disabled));
  assert.ok(anterior.querySelectorAll('input').every((b) => (b as Nodo).disabled));
  const { propuesta } = elegir();
  await confirmar(propuesta);
  assert.ok(estado.hojaDeRuta?.plan.elecciones.every((o) => o.oferta.unidad.programa_id !== cuerpo.excluidos[0]));
  assert.deepEqual(JSON.parse(peticionesFormacion.at(-1)?.cuerpo ?? '{}').excluidos, cuerpo.excluidos);
});
test('Requisitos publicados se confirman por identidad del programa y nunca por defecto', async () => {
  const caso = casoDeFormacion(true);
  prepararFormacionLocal(async () => caso, AHORA_FORMACION);
  empezar();
  await enviar();
  (ultimo('.rc-hoja').querySelector('.rc-hoja-pie .rc-boton-secundario') as Nodo).dispatchEvent(new Event('click'));
  const form = ultimo('form.rc-hoja-pregunta');
  const requisito = form.querySelectorAll('input').find((i) => i.id.startsWith('requisito-')) as Nodo;
  assert.ok(requisito);
  assert.equal(requisito.checked, false);
  requisito.checked = true;
  await enviar();
  const ids = JSON.parse(peticionesFormacion.at(-1)?.cuerpo ?? '{}').requisitosConfirmados;
  assert.deepEqual(ids, [JSON.stringify([caso.catalogo.ofertas[0]?.unidad.programa_id, 'entrada'])]);
});
test('CA traduce la propuesta y conserva la lengua de la ficha original', async () => {
  fijarIdioma('ca');
  olvidarHojaDeRuta();
  empezar();
  await enviar();
  const propuesta = ultimo('.rc-hoja');
  assert.ok(propuesta.querySelectorAll('input').length > 0);
  assert.match(propuesta.textContent, /curs/iu);
});
test('Un fallo conserva preferencias y ofrece reintento; borrar cancela una petición pendiente', async () => {
  prepararFormacionLocal(async () => {
    throw new Error('Fallo sintético de lectura');
  }, AHORA);
  empezar();
  await enviar();
  assert.match(ultimo('form.rc-hoja-pregunta').textContent, /No se ha podido comprobar/u);
  const retenida = Promise.withResolvers<ReturnType<typeof casoDeFormacion>>();
  prepararFormacionLocal(() => retenida.promise, AHORA);
  const form = ultimo('form.rc-hoja-pregunta');
  form.dispatchEvent(new Event('submit'));
  olvidarHojaDeRuta();
  retenida.resolve(casoDeFormacion());
  await vuelta();
  assert.equal(estado.hojaDeRuta, null);
  assert.deepEqual(finalizadas, []);
});

test('Con el reloj anterior al corte, el paso de formación dice que corrija la fecha del dispositivo, en los dos idiomas, y no el aviso general', async () => {
  const atrasado = Date.parse('2020-01-01T00:00:00Z');
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    prepararFormacionLocal(async () => ({ catalogo: catalogoSintetico, companero: companeroSintetico }), atrasado);
    olvidarHojaDeRuta();
    empezar();
    await enviar();
    const texto = ultimo('form.rc-hoja-pregunta').textContent;
    assert.match(
      texto,
      idioma === 'es' ? /fecha de este dispositivo parece atrasada/u : /data d’aquest dispositiu sembla endarrerida/u,
    );
    assert.doesNotMatch(texto, /No se ha podido comprobar|No s’ha pogut comprovar/u);
    assert.equal(estado.hojaDeRuta, null);
  }
  fijarIdioma('es');
  prepararFormacionLocal(async () => ({ catalogo: catalogoSintetico, companero: companeroSintetico }), AHORA);
  olvidarHojaDeRuta();
  empezar();
  await enviar();
  assert.ok(ultimo('.rc-hoja').querySelectorAll('input').length > 0);
});

test('La vista rechaza respuestas sin los campos que interpreta, sin fabricar una hoja vacía', async () => {
  const { leerSeleccion } = await import('../../web/scripts/recorrido/formacion/cliente.js');
  const caso = casoDeFormacion();
  const sinCondicion = structuredClone(caso.seleccion);
  const recurso = sinCondicion.camino?.recursos[0];
  assert.ok(recurso);
  Reflect.deleteProperty(recurso.oferta.hechos, 'requiere_registro_previo');
  assert.throws(() => leerSeleccion(sinCondicion), /Respuesta de formación incompatible/u);
  const original = caso.seleccion.camino?.recursos[0];
  assert.ok(original);
  const sinFecha = {
    ...caso.seleccion,
    camino: {
      ...caso.seleccion.camino,
      recursos: [{ ...original, oferta: { ...original.oferta, comprobado_el: 'sin fecha válida' } }],
    },
  };
  assert.throws(() => leerSeleccion(sinFecha), /Respuesta de formación incompatible/u);
});
