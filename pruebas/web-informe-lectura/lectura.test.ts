import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avanzar, html, informe, instalar, nodo, pulsar } from './dom-doble.ts';

test('habitual: lectura conserva orden, cifras, idioma, detalles y alternativa; omite interfaz', async (t) => {
  instalar(t);
  const { fragmentosDe, comoTexto } = await import('../../web/scripts/lectura-del-informe.js');
  const e = informe();
  const tabla = nodo(
    'table',
    {},
    nodo('caption', {}, 'Tabla'),
    nodo('thead', {}, nodo('tr', {}, nodo('th', {}, 'Nota'))),
    nodo('tbody', {}, nodo('tr', {}, nodo('td', {}, '0,735'))),
  );
  e.completa.append(tabla);
  const fragmentos = fragmentosDe(html(e.raizInforme));
  assert.deepEqual(fragmentos, [
    { texto: 'Informe 14·10·2026', idioma: 'es', titulo: true },
    { texto: 'Datos', idioma: 'es', titulo: true },
    { texto: 'Valor 0,735.', idioma: 'es', titulo: false },
    { texto: 'Plegat llegible', idioma: 'ca', titulo: false },
    { texto: 'Alternativa', idioma: 'es', titulo: false },
    { texto: 'Tabla', idioma: 'es', titulo: true },
    { texto: 'Nota: 0,735', idioma: 'es', titulo: false },
  ]);
  assert.ok(comoTexto(fragmentos).includes('\n\nDatos\n'));
});

test('habitual: encuentra el informe desde contenedor, sí mismo o un descendiente', async (t) => {
  instalar(t);
  const { informeDe } = await import('../../web/scripts/lectura-del-informe.js');
  const e = informe();
  for (const raiz of [e.raiz, e.raizInforme, e.portada]) {
    assert.equal(informeDe(html(raiz)), e.raizInforme);
  }
  assert.equal(informeDe(html(nodo('div'))), null);
});

test('habitual: compartir solo por clic, evita duplicados y toma el texto al pulsar', async (t) => {
  const datos: ShareData[] = [];
  let resolver: (() => void) | undefined;
  instalar(t, {
    navigator: {
      canShare: () => true,
      share: (data: ShareData) => {
        datos.push(data);
        return new Promise<void>((resolve) => {
          resolver = resolve;
        });
      },
    },
  });
  const { prepararCompartir } = await import('../../web/scripts/compartir-informe.js');
  const e = informe();
  const control = new AbortController();
  prepararCompartir(html(e.raiz), control.signal);
  assert.equal(datos.length, 0);
  // El informe cambia después de preparar el botón: se comparte lo que hay en el momento del clic.
  e.portada.replaceChildren(nodo('h1', {}, 'Informe 15·10·2026'));
  e.completa.append(nodo('p', {}, 'Dato nuevo'));
  const boton = e.raiz.querySelector('#compartir');
  assert.ok(boton);
  pulsar(boton);
  pulsar(boton);
  assert.equal(datos.length, 1);
  const data = datos[0];
  assert.ok(data);
  assert.equal(data.title, 'Título sintético');
  assert.equal(data.text, 'Título sintético\n\nInforme 15·10·2026\n');
  const file = data.files?.[0];
  assert.ok(file);
  assert.equal(file.name, 'informe-de-faro.txt');
  assert.equal(
    await file.text(),
    'Título sintético\n\nInforme 15·10·2026\n\nDatos\nValor 0,735.\nPlegat llegible\nAlternativa\nDato nuevo\n',
  );
  resolver?.();
  await avanzar();
  control.abort();
  assert.equal(e.raiz.querySelector('#compartir'), null);
  assert.equal(e.raiz.querySelector('#compartir-ayuda'), null);
});

test('habitual: compartir sin archivos conserva resumen; cerrar menú no escribe fallo', async (t) => {
  let data: ShareData | undefined;
  instalar(t, {
    navigator: {
      canShare: () => false,
      share: async (value: ShareData) => {
        data = value;
        throw new DOMException('cancelado', 'AbortError');
      },
    },
  });
  const { prepararCompartir } = await import('../../web/scripts/compartir-informe.js');
  const e = informe();
  const control = new AbortController();
  prepararCompartir(html(e.raiz), control.signal);
  const boton = e.raiz.querySelector('#compartir');
  assert.ok(boton);
  pulsar(boton);
  await avanzar();
  assert.ok(data);
  assert.equal(data.files, undefined);
  assert.equal(e.estado.textContent, 'Estado vigente');
  control.abort();
});

test('habitual: sin Web Share no añade controles ni cambia el informe', async (t) => {
  instalar(t);
  const { prepararCompartir } = await import('../../web/scripts/compartir-informe.js');
  const e = informe();
  prepararCompartir(html(e.raiz), new AbortController().signal);
  assert.equal(e.raiz.querySelector('#compartir'), null);
});

test('un rechazo tardío de compartir tras retirar no sobrescribe estado vigente', async (t) => {
  let rechazar: ((e: Error) => void) | undefined;
  instalar(t, {
    navigator: {
      share: () =>
        new Promise<void>((_, reject) => {
          rechazar = reject;
        }),
    },
  });
  const { prepararCompartir } = await import('../../web/scripts/compartir-informe.js');
  const e = informe();
  const control = new AbortController();
  prepararCompartir(html(e.raiz), control.signal);
  const boton = e.raiz.querySelector('#compartir');
  assert.ok(boton);
  pulsar(boton);
  control.abort();
  e.estado.dataset.texto = 'estado-del-informe-nuevo';
  rechazar?.(new Error('fallo sintético'));
  await avanzar();
  assert.equal(e.estado.dataset.texto, 'estado-del-informe-nuevo');
});

class Frase extends EventTarget {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
}

function sintesis(t: Parameters<typeof instalar>[0], voces: SpeechSynthesisVoice[]) {
  const frases: Frase[] = [];
  let cancelaciones = 0;
  const motor = Object.assign(new EventTarget(), {
    getVoices: () => voces,
    speak: (frase: Frase) => frases.push(frase),
    cancel: () => {
      cancelaciones++;
    },
  });
  instalar(t, { speechSynthesis: motor, SpeechSynthesisUtterance: Frase });
  return { frases, motor, cancelaciones: () => cancelaciones };
}

function voz(lang: string, localService: boolean): SpeechSynthesisVoice {
  return { lang, localService, name: lang, voiceURI: lang, default: true };
}

test('habitual: voz local, pausa/repite, eventos viejos, parar/foco y retirada', async (t) => {
  const motor = sintesis(t, [voz('es-ES', true), voz('ca_ES', true)]);
  const { prepararEscucha } = await import('../../web/scripts/escuchar-informe.js');
  const e = informe();
  const control = new AbortController();
  prepararEscucha(html(e.raiz), control.signal);
  const boton = e.raiz.querySelector('#escuchar');
  assert.ok(boton);
  assert.equal(boton.hidden, false);
  assert.equal(motor.frases.length, 0);
  pulsar(boton);
  const primera = motor.frases[0];
  assert.ok(primera);
  assert.equal(primera.text, 'Informe 14/10/2026');
  assert.equal(primera.voice?.localService, true);
  pulsar(boton);
  assert.equal(boton.dataset.texto, 'informe.escuchar.seguir');
  primera.dispatchEvent(new Event('end'));
  assert.equal(motor.frases.length, 1);
  pulsar(boton);
  const repetida = motor.frases[1];
  assert.ok(repetida);
  assert.equal(repetida.text, primera.text);
  primera.dispatchEvent(new Event('end'));
  assert.equal(motor.frases.length, 2);
  repetida.dispatchEvent(new Event('end'));
  const parar = e.raiz.querySelector('#parar-lectura');
  assert.ok(parar);
  parar.focus();
  pulsar(parar);
  assert.equal(parar.hidden, true);
  assert.equal(boton.dataset.texto, 'informe.escuchar');
  pulsar(boton);
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(parar.hidden, true);
  control.abort();
  assert.equal(e.raiz.querySelector('#escuchar'), null);
  assert.ok(motor.cancelaciones() > 0);
});

test('habitual: voz remota no ofrece lectura; voiceschanged local sí', async (t) => {
  const voces = [voz('es-ES', false)];
  const motor = sintesis(t, voces);
  const { prepararEscucha } = await import('../../web/scripts/escuchar-informe.js');
  const e = informe();
  const control = new AbortController();
  prepararEscucha(html(e.raiz), control.signal);
  const boton = e.raiz.querySelector('#escuchar');
  assert.ok(boton);
  assert.equal(boton.hidden, true);
  const aviso = e.raiz.querySelector('#escuchar-sin-voz');
  assert.ok(aviso);
  assert.equal(aviso.hidden, false);
  voces.push(voz('es-ES', true));
  motor.motor.dispatchEvent(new Event('voiceschanged'));
  assert.equal(boton.hidden, false);
  assert.equal(aviso.hidden, true);
  control.abort();
});

test('una escucha ya abortada no deja controles huérfanos ni voz', async (t) => {
  const motor = sintesis(t, [voz('es-ES', true)]);
  const { prepararEscucha } = await import('../../web/scripts/escuchar-informe.js');
  const e = informe();
  prepararEscucha(html(e.raiz), AbortSignal.abort());
  assert.equal(e.raiz.querySelector('#escuchar'), null);
  assert.equal(motor.frases.length, 0);
});
