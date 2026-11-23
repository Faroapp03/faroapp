import './idiomas.ts';
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import type { ResultadoAvisos } from '../../web/administracion/cliente-avisos.js';
import { correoOculto, crearVistaAvisos } from '../../web/administracion/vista-avisos.js';
import { TEXTOS_AVISOS as TEXTOS_CA } from '../../web/idiomas/ca/panel-avisos.js';
import { TEXTOS_VIGILANTE as VIGILANTE_CA } from '../../web/idiomas/ca/panel-vigilante.js';
import { TEXTOS_AVISOS as TEXTOS_ES } from '../../web/idiomas/es/panel-avisos.js';
import { TEXTOS_VIGILANTE as VIGILANTE_ES } from '../../web/idiomas/es/panel-vigilante.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { avanzar, Elemento, instalar, pulsar } from '../web-informe-lectura/dom-doble.ts';

const CORREO = 'persona@example.org';
const NUEVO = 'otra.persona@example.org';
/** Revisiones de la dirección: la que se leyó, la que dejó otra persona y las de quitar. */
const REVISION_AJENA = 3;
const REVISION_LEIDA = 4;
const REVISION_QUITADA = 5;
const IDS = [
  'avisos',
  'avisos-resumen',
  'avisos-estado',
  'avisos-correo',
  'avisos-guardar',
  'avisos-probar',
  'avisos-quitar',
  'avisos-reintentar',
];
const MOTIVOS_FALLIDO = [
  'remitente-no-configurado',
  'destinatario-no-permitido',
  'limite-alcanzado',
  'rechazo-del-destino',
  'error-temporal',
  'plazo-agotado',
  'envio-rechazado',
];
const MOTIVOS_NO_ENVIADO = [
  'sin-destino',
  'destino-sin-verificar',
  'destino-no-admitido',
  'canal-no-configurado',
  'limite-de-pruebas',
];
type EstadoAvisos = Extract<ResultadoAvisos, { tipo: 'leido' }>['avisos'];
const leido = (
  verificacion: 'sin_destino' | 'pendiente' | 'verificado',
  revision = 1,
  avisos: EstadoAvisos = null,
): ResultadoAvisos => ({
  tipo: 'leido',
  destino: { revision, cambiadoEn: 1000, verificacion, correo: verificacion === 'sin_destino' ? null : CORREO },
  avisos,
});
/** El estado de los canales que trae la lectura: el correo con su último intento y la URL sin configurar. */
const conCanales = (
  correo: NonNullable<EstadoAvisos>['canales'][number],
  comprobaciones: 'activas' | 'desactivadas' = 'activas',
): EstadoAvisos => ({
  comprobaciones,
  canales: [correo, { canal: 'url', estado: 'no-configurados', ultimoIntento: null }],
});
const INSTANTE = Date.parse('2026-11-21T05:00:00Z');
const resumen = (verificacion: 'sin_destino' | 'pendiente' | 'verificado', revision = 2) => ({
  revision,
  cambiadoEn: 2000,
  verificacion,
});

/** Un cliente que apunta cada llamada y responde con la cola que le da cada prueba. */
function clienteDePrueba(lecturas: ResultadoAvisos[], respuestas: (ResultadoAvisos | null)[] = []) {
  const llamadas: unknown[][] = [];
  const responder =
    (nombre: string) =>
    async (...argumentos: unknown[]) => {
      llamadas.push([nombre, ...argumentos]);
      return nombre === 'leer' ? (lecturas.shift() ?? null) : (respuestas.shift() ?? null);
    };
  return {
    llamadas,
    cliente: {
      leerAvisos: responder('leer'),
      cambiarAvisos: responder('cambiar'),
      quitarAvisos: responder('quitar'),
      probarAvisos: responder('probar'),
    },
  };
}
/** La tarjeta con sus elementos; `confirmar` responde a las preguntas y las guarda. */
function montar(t: TestContext, cliente: ReturnType<typeof clienteDePrueba>['cliente'], acepta = true) {
  const ids = Object.fromEntries(IDS.map((id) => [id, new Elemento(id === 'avisos-correo' ? 'input' : 'button')]));
  const campo = ids['avisos-correo'] as Elemento & { value: string; disabled: boolean };
  campo.value = '';
  instalar(t, {
    document: {
      getElementById: (id: string) => ids[id],
      createElement: (tag: string) => new Elemento(tag),
      activeElement: null,
    },
  });
  const preguntas: string[] = [];
  const vista = crearVistaAvisos(cliente, (pregunta) => {
    preguntas.push(pregunta);
    return acepta;
  });
  const el = (id: string) => ids[id] as Elemento & { disabled: boolean };
  return {
    vista,
    ids,
    campo,
    preguntas,
    el,
    texto: () => `${el('avisos-resumen').textContent} ${el('avisos-estado').textContent}`,
  };
}

test('al abrir, la tarjeta lee una sola vez y dice a dónde llegan los avisos sin escribir nada', async (t) => {
  fijarIdioma('es');
  const { cliente, llamadas } = clienteDePrueba([leido('verificado')]);
  const f = montar(t, cliente);
  f.vista.mostrar(false, null);
  await avanzar();
  f.vista.mostrar(false, null);
  await avanzar();
  assert.deepEqual(llamadas, [['leer']]);
  assert.equal(f.el('avisos').hidden, false);
  assert.equal(f.el('avisos-resumen').textContent, `Los avisos llegan a ${correoOculto(CORREO)}.`);
  assert.equal(correoOculto(CORREO), 'p•••@example.org');
  assert.ok(!f.texto().includes(CORREO), 'La dirección completa solo vive en el campo');
  assert.equal(f.campo.value, CORREO);
  assert.equal(f.el('avisos').getAttribute('aria-busy'), 'false');
  for (const [verificacion, frase] of [
    ['pendiente', /Pendiente de confirmar: envía un aviso de prueba\./u],
    ['sin_destino', /Todavía no hay ninguna dirección/u],
  ] as const) {
    const otra = clienteDePrueba([leido(verificacion)]);
    const g = montar(t, otra.cliente);
    g.vista.mostrar(false, null);
    await avanzar();
    assert.match(g.el('avisos-resumen').textContent, frase);
    assert.equal(g.el('avisos-quitar').disabled, verificacion === 'sin_destino');
  }
});

test('una lectura que falla no se repite sola: deja «Volver a consultar»', async (t) => {
  fijarIdioma('es');
  const { cliente, llamadas } = clienteDePrueba([]);
  const f = montar(t, cliente);
  f.vista.mostrar(false, null);
  await avanzar();
  f.vista.mostrar(false, null);
  await avanzar();
  assert.equal(llamadas.length, 1);
  assert.match(f.el('avisos-resumen').textContent, /No se ha podido consultar/u);
  assert.equal(f.el('avisos-reintentar').hidden, false);
  assert.equal(f.el('avisos-guardar').disabled, true);
});

test('guardar pide confirmación repitiendo la dirección, usa la revisión leída y vuelve a leer', async (t) => {
  fijarIdioma('es');
  const { cliente, llamadas } = clienteDePrueba(
    [leido('verificado', 1), leido('pendiente', 2)],
    [{ tipo: 'cambiado', destino: resumen('pendiente') }],
  );
  const rechazada = montar(t, clienteDePrueba([leido('verificado')]).cliente, false);
  rechazada.vista.mostrar(false, null);
  await avanzar();
  rechazada.campo.value = NUEVO;
  pulsar(rechazada.el('avisos-guardar'));
  await avanzar();
  assert.equal(rechazada.preguntas.length, 1);
  const f = montar(t, cliente);
  f.vista.mostrar(false, null);
  await avanzar();
  f.campo.value = ` ${NUEVO} `;
  // Con el teclado: Intro en el campo guarda, igual que el botón.
  f.campo.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter' }));
  await avanzar();
  await avanzar();
  assert.match(f.preguntas[0] ?? '', new RegExp(`Los avisos llegarán a ${NUEVO.replace('.', '\\.')}\\.`, 'u'));
  assert.deepEqual(llamadas, [['leer'], ['cambiar', 1, NUEVO], ['leer']]);
  assert.match(
    f.el('avisos-estado').textContent,
    /Has guardado la dirección\. Para confirmarla, envía un aviso de prueba\./u,
  );
  assert.match(f.el('avisos-resumen').textContent, /Pendiente de confirmar/u);
});

test('un conflicto de revisión se explica y la tarjeta enseña la dirección nueva', async (t) => {
  fijarIdioma('es');
  const { cliente, llamadas } = clienteDePrueba(
    [leido('verificado', 1), leido('pendiente', REVISION_AJENA)],
    [{ tipo: 'conflicto', destino: resumen('pendiente', REVISION_AJENA) }],
  );
  const f = montar(t, cliente);
  f.vista.mostrar(false, null);
  await avanzar();
  f.campo.value = NUEVO;
  pulsar(f.el('avisos-guardar'));
  await avanzar();
  await avanzar();
  assert.deepEqual(llamadas.at(-1), ['leer']);
  assert.equal(
    f.el('avisos-estado').textContent,
    'Alguien cambió la dirección mientras tanto: revisa la nueva antes de volver a guardar.',
  );
  assert.equal(f.campo.value, CORREO);
});

test('la prueba aceptada confirma la dirección; una rechazada da su motivo en una frase, sin códigos', async (t) => {
  fijarIdioma('es');
  const aceptada = clienteDePrueba(
    [leido('pendiente'), leido('verificado')],
    [{ tipo: 'prueba', prueba: { resultado: 'enviado' }, destino: resumen('verificado', 1) }],
  );
  const f = montar(t, aceptada.cliente);
  f.vista.mostrar(false, null);
  await avanzar();
  pulsar(f.el('avisos-probar'));
  await avanzar();
  await avanzar();
  assert.match(f.el('avisos-estado').textContent, /la dirección ha quedado confirmada/u);
  assert.equal(f.el('avisos-resumen').textContent, `Los avisos llegan a ${correoOculto(CORREO)}.`);
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    for (const [resultado, motivos] of [
      ['fallido', MOTIVOS_FALLIDO],
      ['no-enviado', MOTIVOS_NO_ENVIADO],
    ] as const) {
      for (const motivo of motivos) {
        const rechazo = clienteDePrueba(
          [leido('pendiente'), leido('pendiente')],
          [{ tipo: 'prueba', prueba: { resultado, motivo }, destino: resumen('pendiente', 1) }],
        );
        const g = montar(t, rechazo.cliente);
        g.vista.mostrar(false, null);
        await avanzar();
        pulsar(g.el('avisos-probar'));
        await avanzar();
        await avanzar();
        const frase = g.el('avisos-estado').textContent;
        const textos = idioma === 'es' ? TEXTOS_ES : TEXTOS_CA;
        assert.ok(frase.endsWith(textos[`panel.avisos.motivo.${motivo}` as keyof typeof textos]), frase);
        assert.doesNotMatch(frase, new RegExp(`${motivo}|panel\\.|E_[A-Z]`, 'u'));
      }
    }
  }
  fijarIdioma('es');
});

test('quitar pide confirmación y, después, la tarjeta dice que no hay dirección', async (t) => {
  fijarIdioma('es');
  const { cliente, llamadas } = clienteDePrueba(
    [leido('verificado', REVISION_LEIDA), leido('sin_destino', REVISION_QUITADA)],
    [{ tipo: 'cambiado', destino: resumen('sin_destino', REVISION_QUITADA) }],
  );
  const f = montar(t, cliente);
  f.vista.mostrar(false, null);
  await avanzar();
  pulsar(f.el('avisos-quitar'));
  await avanzar();
  await avanzar();
  assert.match(f.preguntas[0] ?? '', /Vas a quitar la dirección persona@example\.org\./u);
  assert.deepEqual(llamadas, [['leer'], ['quitar', REVISION_LEIDA], ['leer']]);
  assert.match(f.el('avisos-estado').textContent, /Has quitado la dirección\./u);
  assert.match(f.el('avisos-resumen').textContent, /Todavía no hay ninguna dirección/u);
  assert.equal(f.campo.value, '');
});

test('durante una petición la tarjeta está ocupada y no deja enviar dos veces', async (t) => {
  fijarIdioma('es');
  let soltar: ((valor: ResultadoAvisos) => void) | undefined;
  const { cliente, llamadas } = clienteDePrueba([leido('verificado'), leido('verificado')]);
  cliente.probarAvisos = async () => {
    llamadas.push(['probar']);
    return new Promise((resolver) => {
      soltar = resolver;
    });
  };
  const f = montar(t, cliente);
  f.vista.mostrar(false, null);
  await avanzar();
  pulsar(f.el('avisos-probar'));
  pulsar(f.el('avisos-probar'));
  pulsar(f.el('avisos-guardar'));
  await avanzar();
  assert.equal(f.el('avisos').getAttribute('aria-busy'), 'true');
  for (const id of ['avisos-correo', 'avisos-guardar', 'avisos-probar', 'avisos-quitar']) {
    assert.equal(f.el(id).disabled, true, id);
  }
  assert.equal(f.el('avisos-estado').textContent, 'Enviando el aviso de prueba…');
  assert.equal(llamadas.filter(([nombre]) => nombre === 'probar').length, 1);
  soltar?.({ tipo: 'prueba', prueba: { resultado: 'enviado' }, destino: resumen('verificado', 1) });
  await avanzar();
  await avanzar();
  assert.equal(f.el('avisos').getAttribute('aria-busy'), 'false');
  assert.equal(f.el('avisos-guardar').disabled, false);
  // Con otra petición del panel en curso, la tarjeta tampoco envía.
  f.vista.mostrar(true, null);
  pulsar(f.el('avisos-probar'));
  assert.equal(llamadas.filter(([nombre]) => nombre === 'probar').length, 1);
});

test('la dirección no sale en la consola, el almacenamiento ni los atributos, y al cerrar se borra del campo', async (t) => {
  fijarIdioma('es');
  const escrito: unknown[] = [];
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    t.mock.method(console, metodo, (...valores: unknown[]) => escrito.push(valores));
  }
  const almacen = { setItem: (...valores: unknown[]) => escrito.push(valores), getItem: () => null };
  for (const nombre of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, nombre, { value: almacen, configurable: true });
    t.after(() => Reflect.deleteProperty(globalThis, nombre));
  }
  const { cliente } = clienteDePrueba(
    [leido('verificado', 1), leido('pendiente', 2)],
    [{ tipo: 'cambiado', destino: resumen('pendiente') }],
  );
  const f = montar(t, cliente);
  f.vista.mostrar(false, null);
  await avanzar();
  f.campo.value = NUEVO;
  pulsar(f.el('avisos-guardar'));
  await avanzar();
  await avanzar();
  assert.equal(JSON.stringify(escrito).includes('@example.org'), false);
  for (const elemento of Object.values(f.ids)) {
    for (const atributo of ['value', 'aria-label', 'title', 'data-correo']) {
      assert.ok(!(elemento.getAttribute(atributo) ?? '').includes('@'), atributo);
    }
    assert.ok(!elemento.textContent.includes(CORREO));
  }
  f.vista.retirar();
  assert.equal(f.campo.value, '');
  assert.equal(f.el('avisos').hidden, true);
});

test('los textos de los avisos tienen las mismas claves en los dos idiomas y ningún nombre interno', () => {
  assert.deepEqual(Object.keys(TEXTOS_CA).sort(), Object.keys(TEXTOS_ES).sort());
  for (const textos of [TEXTOS_ES, TEXTOS_CA]) {
    for (const [clave, valor] of Object.entries(textos)) {
      assert.doesNotMatch(valor, /FARO_|https?:\/\/|panel\.|_[a-z]+_/u, clave);
    }
  }
  // Ningún texto de avisos del vigilante pide tocar una variable de la configuración.
  for (const textos of [VIGILANTE_ES, VIGILANTE_CA]) {
    for (const [clave, valor] of Object.entries(textos)) {
      if (clave.startsWith('panel.vigilante.avisos.') || clave.startsWith('panel.avisos.')) {
        assert.doesNotMatch(valor, /FARO_/u, clave);
      }
    }
  }
});

test('al abrir, la tarjeta enseña el último aviso fallido, si el correo no puede salir y si no saldrá ningún aviso', async (t) => {
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    const textos = idioma === 'es' ? TEXTOS_ES : TEXTOS_CA;
    const fallido = conCanales({
      canal: 'correo',
      estado: 'verificado',
      ultimoIntento: { en: INSTANTE, resultado: 'fallido', motivo: 'rechazo-del-destino' },
    });
    const f = montar(t, clienteDePrueba([leido('verificado', 1, fallido)]).cliente);
    f.vista.mostrar(false, null);
    await avanzar();
    const resumen = f.el('avisos-resumen').textContent;
    assert.match(
      resumen,
      idioma === 'es'
        ? /El último aviso no se pudo entregar .+\. El buzón/u
        : /L’últim avís no s’ha pogut lliurar .+\. La bústia/u,
    );
    assert.ok(resumen.endsWith(textos['panel.avisos.motivo.rechazo-del-destino']), resumen);
    const apagadas = conCanales({ canal: 'correo', estado: 'no-configurado', ultimoIntento: null }, 'desactivadas');
    const g = montar(t, clienteDePrueba([leido('pendiente', 1, apagadas)]).cliente);
    g.vista.mostrar(false, null);
    await avanzar();
    const otro = g.el('avisos-resumen').textContent;
    assert.ok(otro.includes(textos['panel.avisos.canal.no-configurado']), otro);
    assert.ok(otro.endsWith(textos['panel.avisos.comprobaciones-desactivadas']), otro);
    // Se puede guardar igualmente.
    assert.equal(g.el('avisos-guardar').disabled, false);
    assert.doesNotMatch(`${resumen} ${otro}`, /panel\.|FARO_|rechazo-del-destino/u);
  }
  fijarIdioma('es');
});
