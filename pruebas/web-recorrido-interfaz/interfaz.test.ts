import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { navegador } from '../web-controles/ayudas.js';

const PASO_TAREAS = 3;
const TOTAL_PASOS = 4;
const MENSAJES_CON_PERSONA = 3;

import { barra, base, documento, entorno, evento, nodo } from './dom.ts';

test('conversación escribe texto, retira espera y sugerencias y borra todo sin conservar relato', async (t) => {
  entorno(t);
  base();
  await cargarDiccionario('es');
  const c = await import('../../web/scripts/recorrido/conversacion.js');
  const { saludar } = await import('../../web/scripts/recorrido/saludo.js');
  saludar();
  const log = documento.getElementById('conversacion');
  assert.ok(log);
  assert.equal(log.children.length, 1);
  c.mostrarEspera('Uno');
  c.mostrarEspera('Dos');
  assert.equal(log.children.length, 2);
  assert.ok(log.textContent.includes('Dos'));
  assert.ok(!log.textContent.includes('Uno'));
  c.decirPersona('<script>literal</script>');
  assert.equal(log.children.length, MENSAJES_CON_PERSONA);
  assert.ok(log.textContent.includes('<script>literal</script>'));
  assert.equal(log.querySelector('script'), null);
  let acciones = 0;
  const sugerencia = c.ofrecerSugerencias([
    {
      texto: 'Elegir',
      accion: () => {
        acciones += 1;
      },
    },
  ]);
  sugerencia?.dispatchEvent(evento('click'));
  assert.equal(acciones, 1);
  assert.equal(documento.getElementById('sugerencias')?.children.length, 0);
  c.vaciarConversacion();
  assert.equal(log.children.length, 0);
  assert.equal(documento.body.dataset.conversacion, undefined);
});

test('guía y navegación conservan cuatro pasos, tarjetas, diálogo y devolución de foco', async (t) => {
  entorno(t);
  base();
  barra();
  const guia = nodo('aside', 'rc-guia');
  const lista = nodo('ol', '', guia);
  for (const paso of [1, 2, PASO_TAREAS, TOTAL_PASOS]) {
    nodo('li', '', lista).dataset.paso = String(paso);
  }
  for (const id of [
    'rc-paso-nombre',
    'rc-paso-cifra',
    'rc-paso-texto',
    'alternar-guia',
    'ver-recorrido',
    'cerrar-recorrido',
    'dialogo-pasos',
    'tarjeta-ocupacion',
    'tarjeta-tareas',
    'paso-4',
  ]) {
    nodo('div', id);
  }
  const dialogo = nodo('dialog', 'dialogo-recorrido');
  const { irA } = await import('../../web/scripts/recorrido/navegacion.js');
  const { iniciarGuia } = await import('../../web/scripts/recorrido/guia.js');
  iniciarGuia();
  for (const paso of [1, 2, PASO_TAREAS, TOTAL_PASOS, 1]) {
    irA(paso);
    assert.equal(documento.body.dataset.paso, String(paso));
    assert.equal(lista.querySelectorAll('[aria-current="step"]').length, 1);
    assert.equal(documento.getElementById('compositor')?.hidden, paso === TOTAL_PASOS);
    assert.equal(documento.getElementById('tarjeta-ocupacion')?.hidden, paso !== 2);
    assert.equal(documento.getElementById('tarjeta-tareas')?.hidden, paso !== PASO_TAREAS);
    assert.equal(documento.getElementById('paso-4')?.hidden, paso !== TOTAL_PASOS);
  }
  documento.getElementById('ver-recorrido')?.dispatchEvent(evento('click'));
  assert.equal(dialogo.open, true);
  assert.equal(documento.getElementById('dialogo-pasos')?.children[0]?.children.length, TOTAL_PASOS);
  documento.getElementById('cerrar-recorrido')?.dispatchEvent(evento('click'));
  assert.equal(dialogo.open, false);
  assert.equal(documento.activeElement?.id, 'ver-recorrido');
});

test('ayudas añaden comienzo traducido sin enviar y Escape devuelve foco', async (t) => {
  entorno(t);
  base();
  const { campo } = barra();
  for (const id of ['rc-ayudas', 'abrir-ayudas', 'cerrar-ayudas', 'rc-ayudas-descripcion', 'rc-ayudas-opciones']) {
    nodo('div', id);
  }
  const panel = documento.getElementById('rc-ayudas');
  assert.ok(panel);
  panel.hidden = true;
  const { iniciarAyudas, COMIENZOS_POR_PASO } = await import('../../web/scripts/recorrido/ayudas.js');
  const { cambiarModo } = await import('../../web/scripts/recorrido/compositor.js');
  const { cambiarIdioma } = await import('../../web/scripts/idioma.js');
  cambiarModo({ etiqueta: '', marcador: '', alEnviar: () => assert.fail('ayuda no envía') });
  iniciarAyudas();
  documento.body.dataset.paso = '1';
  for (const idioma of ['es', 'ca'] as const) {
    await cargarDiccionario(idioma);
    await cambiarIdioma(idioma);
    documento.getElementById('abrir-ayudas')?.dispatchEvent(evento('click'));
    const opciones = documento.getElementById('rc-ayudas-opciones');
    assert.ok(opciones);
    assert.equal(opciones.children.length, COMIENZOS_POR_PASO);
    const primera = opciones.children[0];
    assert.ok(primera);
    assert.equal(documento.activeElement, primera);
    const texto = primera.textContent.replace(/…$/, ' ');
    campo.value = 'Antes';
    primera.dispatchEvent(evento('click'));
    assert.equal(campo.value, `Antes ${texto}`);
    assert.equal(panel.hidden, true);
    assert.equal(documento.activeElement, campo);
    documento.getElementById('abrir-ayudas')?.dispatchEvent(evento('click'));
    panel.dispatchEvent(evento('keydown', { key: 'Escape' }));
    assert.equal(documento.activeElement?.id, 'abrir-ayudas');
  }
});

test('altura visible y opción enfocada conservan zoom y desplazamiento limitado', async (t) => {
  const { ventana } = entorno(t);
  const propiedades = new Map<string, string>();
  Object.assign(documento.documentElement.style, {
    setProperty: (k: string, v: string) => propiedades.set(k, v),
    removeProperty: (k: string) => propiedades.delete(k),
  });
  const vista = Object.assign(new EventTarget(), { height: 512.6, scale: 1 });
  Object.assign(ventana, { visualViewport: vista });
  const media = { matches: true };
  navegador(t, { matchMedia: () => media });
  const a = await import('../../web/scripts/recorrido/altura-visible.js');
  a.seguirAlturaVisible();
  assert.equal(propiedades.get('--alto-visible'), '513px');
  vista.scale = 2;
  vista.dispatchEvent(evento('resize'));
  assert.equal(propiedades.has('--alto-visible'), false);
  a.llevarLaOpcionEnfocadaALaVista();
  const opcion = nodo('label');
  opcion.className = 'rc-opcion';
  const campo = nodo('input', '', opcion);
  documento.dispatchEvent(evento('focusin', { target: campo }));
  assert.equal(opcion.desplazamientos.length, 1);
  media.matches = false;
  documento.dispatchEvent(evento('focusin', { target: campo }));
  assert.equal(opcion.desplazamientos.length, 1);
});

test('avisos fijos ES/CA conservan íntegro el texto del motor y enlaces telefónicos', async (t) => {
  entorno(t);
  base();
  const c = await import('../../web/scripts/recorrido/conversacion.js');
  const avisos = await import('../../src/seguridad/avisos.ts');
  const { cambiarIdioma } = await import('../../web/scripts/idioma.js');
  for (const idioma of ['es', 'ca'] as const) {
    await cargarDiccionario(idioma);
    await cambiarIdioma(idioma);
    c.vaciarConversacion();
    c.decirAvisos([{ tipo: 'ayuda', texto: 'no sustituye el aviso fijo' }], idioma);
    const log = documento.getElementById('conversacion');
    assert.ok(log);
    assert.equal(
      log.querySelector('.rc-texto p')?.textContent,
      idioma === 'es' ? avisos.AVISO_AYUDA : avisos.AVISO_AYUDA_CA,
    );
    assert.deepEqual(
      log.querySelectorAll('a').map((a) => a.getAttribute('href')),
      ['tel:024', 'tel:112'],
    );
    assert.equal(c.avisoYaDicho('ayuda'), true);
  }
});
