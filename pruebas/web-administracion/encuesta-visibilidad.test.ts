/**
 * El apartado «Encuesta» en los dos idiomas: el interruptor «Visible en la web» cambia la política de secciones solo
 * tras confirmar, el estado de la ronda dice «Sin dato» antes de consultar, y el bloque de rondas lista cada ronda,
 * permite ver sus resultados y abrir la siguiente solo cuando no hay ninguna abierta.
 */
import './idiomas.ts';
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { leerResultadosEncuesta } from '../../web/administracion/cliente-encuesta.js';
import { bloqueDeRondas } from '../../web/administracion/vista-encuesta-rondas.js';
import { crearVistaEncuestaVisibilidad } from '../../web/administracion/vista-encuesta-visibilidad.js';
import { Elemento, instalar } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { enRonda, rondaAnterior } from './ronda-encuesta.ts';

const IDIOMAS = ['es', 'ca'] as const;
const VACIO = { emitidos: 0, consumidos: 0, sinUsar: 0 };
const TEXTOS = {
  es: {
    sinDato: 'Sin dato: consulta las secciones para saber si la encuesta está visible.',
    visible: 'La encuesta está visible en la web.',
    oculta: 'La encuesta está oculta en la web.',
    interruptor: 'Visible en la web',
    confirmar: /Cerrar «Encuesta».*las invitaciones no se pierden/su,
    ronda: /Piloto CitilabEstadoAbiertaInvitaciones6Respuestas2/u,
    rondaSinDato: /NombreSin datoEstadoSin dato/u,
    nueva: 'Abrir una ronda nueva',
    soloCerrada: 'Para abrir una ronda nueva, cierra antes la ronda abierta.',
  },
  ca: {
    sinDato: 'Sense dada: consulta les seccions per saber si l’enquesta és visible.',
    visible: 'L’enquesta és visible al web.',
    oculta: 'L’enquesta està oculta al web.',
    interruptor: 'Visible al web',
    confirmar: /Tancar «Enquesta».*les invitacions no es perden/su,
    ronda: /Piloto CitilabEstatObertaInvitacions6Respostes2/u,
    rondaSinDato: /NomSense dadaEstatSense dada/u,
    nueva: 'Obrir una ronda nova',
    soloCerrada: 'Per obrir una ronda nova, tanca abans la ronda oberta.',
  },
} as const;

function activa(cambios: Partial<Record<string, unknown>> = {}): EstadoClientePanel {
  return {
    estado: 'activa',
    ocupado: false,
    secciones: { version: 3, revision: 1, secciones: politicaSeccionesInicial() },
    seccionesPendientes: false,
    ...cambios,
  } as unknown as EstadoClientePanel;
}
/** Los resultados de la ronda del piloto, abierta, tras una ronda anterior ya cerrada. */
function resultados(abierta: true) {
  const totales = { participante: { emitidos: 6, consumidos: 2, sinUsar: 4 }, profesional: VACIO };
  return leerResultadosEncuesta(
    enRonda({ cuestionario: 'faro-piloto-2', abierta, lotes: [], totales, recuentos: null }, [rondaAnterior(1)]),
  );
}
function montar(t: TestContext, acepta: boolean) {
  const confirmaciones: string[] = [];
  instalar(t, {
    window: Object.assign(new EventTarget(), {
      confirm: (mensaje: string) => {
        confirmaciones.push(mensaje);
        return acepta;
      },
    }),
  });
  const contenedor = new Elemento('section');
  const cambios: unknown[] = [];
  const vista = crearVistaEncuestaVisibilidad({
    contenedor: contenedor as unknown as HTMLElement,
    cambiarSecciones: (politica) => cambios.push(politica),
  });
  const campo = contenedor.querySelector('#encuesta-visible') as unknown as { checked: boolean; disabled: boolean };
  const estado = () => contenedor.querySelector('#encuesta-visible-estado')?.textContent;
  return { contenedor, vista, campo, estado, cambios, confirmaciones };
}

for (const idioma of IDIOMAS) {
  const textos = TEXTOS[idioma];
  test(`${idioma}: el interruptor muestra lo confirmado y solo cambia la política tras confirmarlo`, (t) => {
    activarIdiomaPanel(idioma);
    const { contenedor, vista, campo, estado, cambios, confirmaciones } = montar(t, true);
    assert.match(contenedor.textContent, new RegExp(textos.interruptor, 'u'));
    assert.equal(estado(), textos.sinDato);
    assert.equal(campo.checked, false);
    vista.mostrar(activa(), false);
    assert.equal(campo.checked, true);
    assert.equal(campo.disabled, false);
    assert.equal(estado(), textos.visible);
    campo.checked = false;
    (campo as unknown as Elemento).dispatchEvent(new Event('change'));
    assert.match(confirmaciones[0] ?? '', textos.confirmar);
    // Solo cambia la Encuesta; las demás secciones conservan el valor confirmado.
    assert.deepEqual(cambios, [{ ...politicaSeccionesInicial(), encuesta: false }]);
    vista.mostrar(activa({ secciones: { version: 3, revision: 2, secciones: cambios[0] } }), false);
    assert.equal(estado(), textos.oculta);
    activarIdiomaPanel('es');
  });

  test(`${idioma}: sin confirmar, ocupado, sin conexión o con secciones pendientes no se cambia nada`, (t) => {
    activarIdiomaPanel(idioma);
    const { vista, campo, cambios } = montar(t, false);
    vista.mostrar(activa(), false);
    campo.checked = false;
    (campo as unknown as Elemento).dispatchEvent(new Event('change'));
    assert.deepEqual(cambios, []);
    assert.equal(campo.checked, true);
    for (const [estado, sinConexion] of [
      [activa({ ocupado: true }), false],
      [activa(), true],
      [activa({ seccionesPendientes: true }), false],
      [activa({ secciones: null }), false],
    ] as const) {
      vista.mostrar(estado, sinConexion);
      assert.equal(campo.disabled, true);
    }
    activarIdiomaPanel('es');
  });

  test(`${idioma}: el estado de la ronda dice «Sin dato» hasta consultar y después sus cifras`, (t) => {
    activarIdiomaPanel(idioma);
    const { contenedor, vista } = montar(t, true);
    assert.match(contenedor.textContent, textos.rondaSinDato);
    vista.mostrarRonda(resultados(true));
    assert.match(contenedor.textContent, textos.ronda);
    activarIdiomaPanel('es');
  });

  test(`${idioma}: las rondas se listan con sus fechas y solo sin ronda abierta se ofrece abrir otra`, (t) => {
    activarIdiomaPanel(idioma);
    instalar(t);
    const vistas: number[] = [];
    const abiertas: string[] = [];
    const avisos: string[] = [];
    const acciones = {
      libre: true,
      ver: (numero: number) => vistas.push(numero),
      abrir: (nombre: string) => abiertas.push(nombre),
      avisar: (mensaje: string) => avisos.push(mensaje),
    };
    const conAbierta = bloqueDeRondas(resultados(true), acciones) as unknown as Elemento;
    assert.match(conAbierta.textContent, /Grupo 1.*01\/10\/2026.*15\/10\/2026/su);
    assert.match(conAbierta.textContent, new RegExp(textos.soloCerrada, 'u'));
    assert.equal(conAbierta.querySelector('form'), null);
    const [verPrimera] = conAbierta.querySelectorAll('button');
    verPrimera?.dispatchEvent(new Event('click'));
    assert.deepEqual(vistas, [1]);
    // Con la ronda del piloto ya cerrada: el bloque solo lee la lista de rondas y la ronda de los resultados.
    const abierta = resultados(true);
    const cerrada = { ...abierta.ronda, abierta: false, cierre: '2026-11-20' };
    const todasCerradas = { ...abierta, abierta: false, ronda: cerrada, rondas: [abierta.rondas[0], cerrada] };
    const sinAbierta = bloqueDeRondas(todasCerradas as typeof abierta, acciones) as unknown as Elemento;
    assert.match(sinAbierta.textContent, new RegExp(textos.nueva, 'u'));
    const formulario = sinAbierta.querySelector('form');
    const campo = sinAbierta.querySelector('#encuesta-ronda-nombre') as unknown as { value: string };
    campo.value = 'Dos\nlíneas';
    formulario?.dispatchEvent(new Event('submit'));
    assert.deepEqual(abiertas, []);
    assert.equal(avisos.length, 1);
    campo.value = '  Segundo grupo  ';
    formulario?.dispatchEvent(new Event('submit'));
    assert.deepEqual(abiertas, ['Segundo grupo']);
    activarIdiomaPanel('es');
  });
}
