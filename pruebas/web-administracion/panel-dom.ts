/** DOM de interacción compartido con el informe; el doble no interpreta HTML ni calcula estilos. */
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import type { TestContext } from 'node:test';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { anotarConsultaOcultas, assertCampo, Campo, ventanaDePanel } from './panel-dom-comun.ts';

const PANEL = new URL('../../web/administracion/panel.js', import.meta.url);
let instancia = 0;
/** Los elementos con id del index.html real: el panel solo encuentra lo que la página trae de verdad. */
const IDS = [
  ...readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8').matchAll(/\sid="([^"]+)"/g),
].map(([, id]) => id as string);
export async function prepararPanel(
  t: TestContext,
  capacidades: { controles: boolean; actualizacion: boolean; vigilante?: boolean } = {
    controles: true,
    actualizacion: true,
  },
) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ version: 1, ...capacidades }));
  activarIdiomaPanel();
  const cambiosIdioma: (() => void)[] = [];
  const ids = new Map(IDS.map((id) => [id, Object.assign(new Campo('div'), { id })]));
  const campo = (id: string) => {
    const encontrado = ids.get(id);
    assertCampo(encontrado);
    return encontrado;
  };
  const documento = Object.assign(new EventTarget(), {
    hidden: false,
    // Como un navegador: un id que la página no trae da null, y el panel dice qué elemento le falta.
    getElementById: (id: string) => ids.get(id) ?? null,
    createElement: (tag: string) => new Elemento(tag),
    createElementNS: (_espacio: string, tag: string) => new Elemento(tag),
  });
  const { reloj, confirmaciones, ventana, alConfirmar, vencerPlazos } = ventanaDePanel();
  const { llamadas, registros, publicar, crear } = dobleCliente();
  instalarDom(t, { documento, ventana, crear, escuchar: (accion: () => void) => cambiosIdioma.push(accion) });
  interceptarCliente(t, reloj);
  await import(`${PANEL.href}?vista=${++instancia}`);
  await new Promise((resolver) => setImmediate(resolver));
  return {
    campo,
    cambiarIdioma: (idioma: 'es' | 'ca') => {
      activarIdiomaPanel(idioma);
      for (const accion of cambiosIdioma) {
        accion();
      }
    },
    confirmaciones,
    alConfirmar,
    vencerPlazos,
    documento,
    ventana,
    llamadas,
    registros,
    publicar,
    tick: () => {
      for (const accion of reloj.values()) {
        accion();
      }
    },
    reloj,
  };
}
function interceptarCliente(t: TestContext, reloj: Map<number, () => void>) {
  const hooks = registerHooks({
    resolve(especificador, contexto, siguiente) {
      if (contexto.parentURL?.startsWith(PANEL.href) && especificador === '../scripts/etapas.js') {
        return { url: 'data:text/javascript,', shortCircuit: true };
      }
      if (contexto.parentURL?.startsWith(PANEL.href) && especificador === './sitio.js') {
        return { url: 'data:text/javascript,', shortCircuit: true };
      }
      if (contexto.parentURL?.startsWith(PANEL.href) && especificador === '../scripts/idioma.js') {
        return {
          url: 'data:text/javascript,export const alCambiarIdioma = (accion) => globalThis.__pruebaPanel.escuchar(accion);',
          shortCircuit: true,
        };
      }
      if (contexto.parentURL?.startsWith(PANEL.href) && especificador === './cliente.js') {
        const codigo = 'export const crearClientePanel = (opciones) => globalThis.__pruebaPanel.crear(opciones);';
        return { url: `data:text/javascript,${encodeURIComponent(codigo)}`, shortCircuit: true };
      }
      return siguiente(especificador, contexto);
    },
  });
  t.after(() => {
    reloj.clear();
    hooks.deregister();
  });
}
function encuestaDePrueba(registros: unknown[], llamadas: string[]) {
  return {
    consultarEncuesta: async (ronda: number | null = null) => {
      llamadas.push(ronda === null ? 'encuesta' : `encuesta-ronda-${ronda}`);
      return respuestasEncuesta.consultar;
    },
    abrirRondaEncuesta: async (nombre: string) => {
      registros.push({ nombre });
      llamadas.push('abrir-ronda');
      return respuestasEncuesta.consultar;
    },
    cerrarEncuesta: async () => {
      llamadas.push('cerrar-encuesta');
      return respuestasEncuesta.cerrar;
    },
    crearLoteEncuesta: async (pedido: unknown) => {
      registros.push(pedido);
      llamadas.push('crear-lote');
      return respuestasEncuesta.crearLote;
    },
  };
}
function vigilanteDePrueba(llamadas: string[]) {
  const registrar = (nombre: string) => async () => {
    llamadas.push(nombre);
    return null;
  };
  // La tarjeta «Avisos» lee al abrir la sesión; aquí no responde y no cuenta entre las llamadas que se comprueban.
  const sinRespuesta = async () => null;
  return {
    comprobarVigilante: registrar('vigilante'),
    historialVigilante: registrar('historial-vigilante'),
    leerAvisos: sinRespuesta,
    cambiarAvisos: sinRespuesta,
    quitarAvisos: sinRespuesta,
    probarAvisos: sinRespuesta,
  };
}
function accesosDePrueba(registros: unknown[], llamadas: string[]) {
  return (pagina = 1) => {
    registros.push({ pagina });
    llamadas.push('accesos');
  };
}
/** Respuestas que la prueba fija para las tres operaciones de la encuesta, con el contrato del servidor. */
export const respuestasEncuesta: { consultar: unknown; cerrar: unknown; crearLote: unknown } = {
  consultar: null,
  cerrar: null,
  crearLote: null,
};
/** Lo que responden la bienvenida y el registro de la sesión única; cada prueba puede cambiarlo antes de preparar. */
export const respuestasSesion: { bienvenida: unknown; registro: unknown } = {
  bienvenida: { correo: 'ana@faro.invalid', idEntrada: 'E-7K2M9QXA', entradaEn: 1_000_000, ocupacion: null },
  registro: { registro: [] },
};
/** Lo que responde cada ruta de administradores y lo que el panel ha pedido, aparte de `llamadas`. */
export const administradoresDePrueba: {
  respuestas: Record<string, { estado: number; cuerpo: unknown }>;
  pedidos: { ruta: string; cuerpo: unknown }[];
} = { respuestas: {}, pedidos: [] };
/** El almacenamiento de la pestaña (sessionStorage): sobrevive a la recarga y cada prueba lo deja como lo encontró. */
export const pestanaDePrueba = new Map<string, string>();
const almacenDePestana = {
  getItem: (clave: string) => pestanaDePrueba.get(clave) ?? null,
  setItem: (clave: string, valor: string) => void pestanaDePrueba.set(clave, valor),
  removeItem: (clave: string) => void pestanaDePrueba.delete(clave),
};
/** Si los envíos simulados «salen» (el panel queda ocupado) o no salen, como cuando el cliente real no envía nada. */
export const enviosDePrueba = { salen: true };
/** Como el cliente real: un envío que sale deja el panel ocupado en el mismo turno. */
function enviosQueOcupan(destino: () => (estado: EstadoClientePanel) => void) {
  let ultimo: EstadoClientePanel | null = null;
  const publicar = (estado: EstadoClientePanel) => {
    ultimo = estado;
    destino()(estado);
  };
  return {
    publicar,
    enviar: () => {
      if (enviosDePrueba.salen && ultimo?.estado === 'activa') {
        publicar({ ...ultimo, ocupado: true });
      }
    },
  };
}
/** Guardar controles o secciones: anota la política y simula el envío. */
function configuracionDePrueba(registros: unknown[], llamadas: string[], enviar: () => void) {
  const guardar = (nombre: string) => (entrada: unknown) => {
    registros.push(entrada);
    llamadas.push(nombre);
    enviar();
  };
  return { cambiar: guardar('cambiar'), cambiarSecciones: guardar('guardar-secciones') };
}
/** La bienvenida y el registro: un error en lugar de la respuesta es un rechazo del servidor, como en el cliente real. */
async function leerSesionUnica(ruta: string) {
  const respuesta = respuestasSesion[ruta === 'sesion/registro' ? 'registro' : 'bienvenida'];
  if (respuesta instanceof Error) {
    throw respuesta;
  }
  return respuesta;
}
async function pedirAdministradores(ruta: string, cuerpo: unknown) {
  administradoresDePrueba.pedidos.push({ ruta, cuerpo });
  return administradoresDePrueba.respuestas[ruta] ?? { estado: 0, cuerpo: null };
}
function dobleCliente() {
  const llamadas: string[] = [];
  const registros: unknown[] = [];
  let cambiar = (_estado: EstadoClientePanel) => {};
  const envios = enviosQueOcupan(() => cambiar);
  const crear = ({ alCambiar }: { alCambiar: typeof cambiar }) => {
    cambiar = alCambiar;
    cambiar({ estado: 'inicial', aviso: null });
    const anotar = (nombre: string) => () => llamadas.push(nombre);
    return {
      abrir: (retomar = false) => llamadas.push(retomar ? 'retomar' : 'abrir'),
      leerSesionUnica,
      comprobar: anotar('comprobar'),
      consultarControles: anotar('consultar-controles'),
      consultarOcultas: (tipo = 'todos', pagina = 0) => anotarConsultaOcultas({ tipo, pagina }, registros, llamadas),
      consultarAccesos: accesosDePrueba(registros, llamadas),
      consultarInstituciones: anotar('instituciones'),
      invitarInstitucion: (entrada: unknown) => {
        registros.push(entrada);
        llamadas.push('invitar-institucion');
      },
      renovarInvitacion: anotar('renovar-invitacion'),
      retirarInstitucion: anotar('retirar-institucion'),
      retirarClaveInstitucion: anotar('retirar-clave'),
      descartarInvitacion: anotar('descartar-invitacion'),
      ...encuestaDePrueba(registros, llamadas),
      pedirAdministradores,
      consultarSecciones: anotar('secciones'),
      ...configuracionDePrueba(registros, llamadas, envios.enviar),
      mantener: anotar('mantener'),
      consultarDatos: anotar('datos'),
      consultarTrabajo: anotar('trabajo'),
      ...vigilanteDePrueba(llamadas),
      retirarTrabajo: anotar('retirar'),
      reconciliarTrabajo: anotar('reconciliar'),
      consultarActivacion: anotar('activacion'),
      cerrar: anotar('cerrar'),
      destruir: anotar('destruir'),
      actualizarDatos: (accion: string) => llamadas.push(accion),
    };
  };
  return { llamadas, registros, crear, publicar: envios.publicar };
}
function instalarDom(
  t: TestContext,
  piezas: {
    documento: EventTarget;
    ventana: EventTarget;
    crear: unknown;
    escuchar: (accion: () => void) => void;
  },
) {
  navegador(t, {
    document: piezas.documento,
    window: Object.assign(piezas.ventana, { sessionStorage: almacenDePestana }),
    navigator: { onLine: true },
    location: { origin: 'https://faro.prueba', hash: '' },
    __pruebaPanel: { crear: piezas.crear, escuchar: piezas.escuchar },
    HTMLElement: Campo,
    HTMLParagraphElement: Campo,
    HTMLButtonElement: Campo,
    HTMLFieldSetElement: Campo,
    HTMLFormElement: Campo,
    HTMLSelectElement: Campo,
    HTMLInputElement: Campo,
    HTMLTextAreaElement: Campo,
  });
}
