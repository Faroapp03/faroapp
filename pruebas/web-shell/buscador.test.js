import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import es from '../../web/idiomas/es.js';
import { registrarDiccionario } from '../../web/scripts/textos.js';
import { Boton, cargar, evento, Nodo, navegador, pagina } from '../web-controles/ayudas.js';

registrarDiccionario('es', es);
const hooks = registerHooks({
  load(url, contexto, siguiente) {
    if (url === new URL('../../web/scripts/sitio.js', import.meta.url).href) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    if (url === new URL('../../web/scripts/secciones.js', import.meta.url).href) {
      // Disponibilidad ya conocida y abierta: aquí se comprueba el filtro local, sin consultar la política por red.
      return { format: 'module', source: 'export const accesoASeccionDisponible = () => true;', shortCircuit: true };
    }
    return siguiente(url, contexto);
  },
});
after(() => hooks.deregister());

class Dialogo extends Nodo {
  open = false;
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }
}
class Campo extends Nodo {
  value = '';
}

/** Prepara la página y arranca el filtro con una red que falla si se utiliza. @param {import('node:test').TestContext} contexto */
async function escenario(contexto) {
  const p = pagina(contexto);
  const dialogo = new Dialogo();
  const campo = p.enfocable(new Campo());
  const abrir = p.enfocable(new Boton());
  const estado = new Nodo();
  const vacio = new Nodo();
  const formacion = new Nodo();
  formacion.dataset.busqueda = 'Formación formació cursos aprender aprendre l’alfabetització d’IA';
  const datos = new Nodo();
  datos.dataset.busqueda = 'Datos dades Cataluña Catalunya';
  p.ids.set('buscador', dialogo);
  p.ids.set('buscador-consulta', campo);
  p.ids.set('buscador-estado', estado);
  p.consultas.set('.buscador-boton', [abrir]);
  dialogo.consultas.set('.buscador-resultados li', [formacion, datos]);
  dialogo.consultas.set('.buscador-vacio', [vacio]);
  const peticiones = contexto.mock.fn(() => {
    throw new Error('El filtro no necesita red');
  });
  navegador(contexto, { navigator: {}, HTMLDialogElement: Dialogo, HTMLInputElement: Campo, fetch: peticiones });
  await cargar('buscador-secciones.js');
  return { ...p, dialogo, campo, abrir, estado, vacio, formacion, datos, peticiones };
}

test('filtra en el dispositivo sin red, admite tildes y prefijos y devuelve el foco', async (contexto) => {
  const p = await escenario(contexto);
  const { dialogo, campo, abrir, estado, vacio, formacion, datos, peticiones } = p;
  assert.equal(abrir.hidden, false);
  abrir.dispatchEvent(evento('click'));
  assert.equal(dialogo.open, true);
  assert.equal(p.document.activeElement, campo);
  assert.equal(formacion.hidden, false);
  assert.equal(datos.hidden, false);
  for (const consulta of [
    'form',
    'FORMACIÓN',
    'formacio\u0301',
    'quiero saber sobre cursos',
    'l’alfabetització',
    "l'alfabetització",
    'D’IA',
    "d'IA",
  ]) {
    Object.assign(campo, { value: consulta });
    campo.dispatchEvent(evento('input'));
    assert.equal(formacion.hidden, false, consulta);
    assert.equal(datos.hidden, true, consulta);
    assert.equal(estado.textContent, '1 sección encontrada.');
  }
  Object.assign(campo, { value: 'inexistente' });
  campo.dispatchEvent(evento('input'));
  assert.equal(vacio.hidden, false);
  assert.equal(formacion.hidden, true);
  assert.equal(datos.hidden, true);
  dialogo.close();
  assert.equal(p.document.activeElement, abrir);
  assert.equal(p.document.body.clases.has('buscador-abierto'), false);
  assert.equal(peticiones.mock.callCount(), 0);
});
