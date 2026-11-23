import './carga-recibido.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../src/api/problemas.ts';
import { codificar } from '../../web/scripts/otro-dispositivo/formato.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';
import { cancelarPeticiones } from '../../web/scripts/recorrido/api/transporte.js';
import { Nodo, navegador, pagina } from '../web-controles/ayudas.js';
import { fijarMotor } from './motor-doble.ts';

const SOLICITUD_INCORRECTA = 400;
const RESULTADO = {
  idioma: 'es' as const,
  isco08: '7512',
  fecha: '2026-10-14',
  tareas: [{ tareaOit: '7512-1', tiempo: 'algo' as const }],
  sinViajar: 0,
};
const FICHA = { isco08: '7512', tareas: [{ id: '7512-1', texto_es: 'Preparar pan' }], ocupaciones: [] };

class Contenedor extends Nodo {
  escrituras: string[] = [];
  set innerHTML(valor: string) {
    this.escrituras.push(valor);
  }
}
class Mensaje extends Nodo {
  prepend(...hijos: (Nodo | string)[]): void {
    this.append(...hijos);
  }
  scrollIntoView(): void {}
}

test('borrar mientras llega el informe transferido impide insertar HTML tardío', async (t) => {
  const dom = pagina(t);
  const contenedor = new Contenedor();
  dom.ids.set('informe', contenedor);
  dom.ids.set('nota-idioma-informe', new Nodo());
  dom.ids.set('conversacion', new Nodo());
  dom.document.createElement = () => new Mensaje();
  navegador(t, { navigator: {}, SVGElement: Nodo, HTMLDialogElement: Nodo, HTMLLinkElement: Nodo });
  const enviada = Promise.withResolvers<void>();
  const respuesta = Promise.withResolvers<Response>();
  fijarMotor(async (ruta) => {
    if (ruta.startsWith('/api/grupos/')) {
      return Response.json(FICHA);
    }
    enviada.resolve();
    return respuesta.promise;
  });
  const { abrirResultadoRecibido, olvidarInforme } = await import('../../web/scripts/recorrido/paso-informe.js');
  const errores: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errores.push(args));
  const trabajo = abrirResultadoRecibido(codificar(RESULTADO), { alBorrar: () => {} });
  await enviada.promise;
  cancelarPeticiones();
  olvidarInforme();
  respuesta.resolve(Response.json({ html: '<p>Informe tardío</p>' }));
  await trabajo;
  assert.deepEqual(contenedor.escrituras, [], 'No reaparece el informe tras borrar');
  assert.deepEqual(errores, [], 'Una cancelación no anuncia un fallo');
  assert.equal(dom.ids.get('conversacion')?.children.length, 0, 'No reaparecen avisos tras borrar');
});

test('receptor transmite exclusivamente códigos/tareas oficiales, API6 y señal de conversación', async (t) => {
  navegador(t, { navigator: {} });
  const { cuerpoDelResultado, informeDelCodigo } = await import('../../web/scripts/otro-dispositivo/recibir.js');
  const cuerpo = cuerpoDelResultado(RESULTADO, new Map([['7512', FICHA]]));
  const rutas: string[] = [];
  fijarMotor(async (ruta, opciones) => {
    rutas.push(ruta);
    assert.equal(new Headers(opciones.headers).get(CABECERA_CONTRATO), String(CONTRATO_API));
    if (ruta.startsWith('/api/grupos/')) {
      return Response.json(FICHA);
    }
    assert.deepEqual(JSON.parse(String(opciones.body)), cuerpo);
    return Response.json({ html: '<p>Informe local</p>' });
  });
  assert.deepEqual(await informeDelCodigo(codificar(RESULTADO)), {
    html: '<p>Informe local</p>',
    resultado: RESULTADO,
  });
  assert.deepEqual(rutas, ['/api/grupos/7512', '/api/informe?formato=breve']);
  assert.equal('ocupacionPersona' in cuerpo, false);
});

test('cancelar espera del SW usa contrato ErrorFaro de cancelación y libera escucha sin llamar al motor', async (t) => {
  const { getEventListeners } = await import('node:events');
  const { esCancelacion } = await import('../../web/scripts/recorrido/api/errores.js');
  const { informeDelCodigo } = await import('../../web/scripts/otro-dispositivo/recibir.js');
  const vida = new AbortController();
  const ready = Promise.withResolvers<void>();
  navegador(t, { navigator: { serviceWorker: { ready: ready.promise } } });
  fijarMotor(async () => assert.fail('No debe pedir con SW pendiente retirado'));
  const esperando = informeDelCodigo(codificar(RESULTADO), { signal: vida.signal });
  const retirada = assert.rejects(esperando, esCancelacion);
  vida.abort();
  await retirada;
  assert.equal(getEventListeners(vida.signal, 'abort').length, 0);
});

// Receptor y transporte reales: se cancela con la petición ya enviada, y la respuesta que llega después (un HTML que
// además no pasaría el filtro) no se pinta, no se anuncia en la conversación ni se cuenta como error.
test('la señal de una transferencia cancelada impide pintar una respuesta rechazada tardía', async (t) => {
  const dom = pagina(t);
  const contenedor = new Contenedor();
  dom.ids.set('informe', contenedor);
  dom.ids.set('nota-idioma-informe', new Nodo());
  dom.ids.set('conversacion', new Nodo());
  dom.document.createElement = () => new Mensaje();
  navegador(t, { navigator: {}, SVGElement: Nodo, HTMLDialogElement: Nodo, HTMLLinkElement: Nodo });
  const enviada = Promise.withResolvers<void>();
  const respuesta = Promise.withResolvers<Response>();
  const vida = new AbortController();
  fijarMotor(async (ruta) => {
    if (ruta.startsWith('/api/grupos/')) {
      return Response.json(FICHA);
    }
    enviada.resolve();
    return respuesta.promise;
  });
  const { abrirResultadoRecibido } = await import('../../web/scripts/recorrido/paso-informe.js');
  const errores: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errores.push(args));
  const trabajo = abrirResultadoRecibido(codificar(RESULTADO), { alBorrar: () => {}, signal: vida.signal });
  await enviada.promise;
  vida.abort();
  respuesta.resolve(Response.json({ html: '<script>alert(1)</script>' }));
  await trabajo;
  assert.deepEqual(contenedor.escrituras, []);
  assert.deepEqual(errores, []);
  assert.equal(dom.ids.get('conversacion')?.children.length, 0);
});

test('con relojDelDispositivo el informe se pide con la marca; sin ella, no', async (t) => {
  navegador(t, { navigator: {} });
  const { informeDelCodigo } = await import('../../web/scripts/otro-dispositivo/recibir.js');
  const rutas: string[] = [];
  fijarMotor(async (ruta) => {
    rutas.push(ruta);
    return ruta.startsWith('/api/grupos/') ? Response.json(FICHA) : Response.json({ html: '<p>Informe local</p>' });
  });
  await informeDelCodigo(codificar(RESULTADO), { relojDelDispositivo: true });
  await informeDelCodigo(codificar(RESULTADO));
  assert.deepEqual(
    rutas.filter((ruta) => ruta.startsWith('/api/informe')),
    ['/api/informe?formato=breve&reloj=dispositivo', '/api/informe?formato=breve'],
  );
});

test('un 400 de reloj atrasado se cuenta con la explicación del reloj; otro 400 sigue siendo un código que no vale', async (t) => {
  navegador(t, { navigator: {} });
  const { informeDelCodigo } = await import('../../web/scripts/otro-dispositivo/recibir.js');
  const { CodigoNoValido } = await import('../../web/scripts/otro-dispositivo/formato.js');
  const { ErrorFaro } = await import('../../web/scripts/recorrido/api/errores.js');
  const { resolver } = await import('../../web/scripts/textos.js');
  const responderInforme = (cuerpo: unknown) =>
    fijarMotor(async (ruta) =>
      ruta.startsWith('/api/grupos/') ? Response.json(FICHA) : Response.json(cuerpo, { status: SOLICITUD_INCORRECTA }),
    );
  responderInforme({ type: `${RAIZ_DE_LOS_PROBLEMAS}reloj_atrasado` });
  await assert.rejects(informeDelCodigo(codificar(RESULTADO), { relojDelDispositivo: true }), (error) => {
    assert.ok(error instanceof ErrorFaro && !(error instanceof CodigoNoValido));
    assert.equal(JSON.stringify(error.explicacion).includes('recorrido.error.reloj-atrasado'), true);
    assert.ok(resolver(error.explicacion).length > 0);
    return true;
  });
  responderInforme({ type: `${RAIZ_DE_LOS_PROBLEMAS}solicitud_invalida` });
  await assert.rejects(informeDelCodigo(codificar(RESULTADO)), CodigoNoValido);
});
