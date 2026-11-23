/** Piezas comunes de los DOM de prueba del panel real y de su muestra: campos, ventana, consulta de ocultas. */
import { Elemento } from '../web-informe-lectura/dom-doble.ts';

export class Campo extends Elemento {
  disabled = false;
  value = '';
  checked = false;
  selectedIndex = 0;
  reportValidity() {
    return true;
  }
  reset() {
    this.value = '';
  }
  select() {}
}

export function ventanaDePanel() {
  const reloj = new Map<number, () => void>();
  // Plazos de una sola vez (setTimeout): la prueba los vence cuando quiere, sin esperar.
  const plazos = new Map<number, () => void>();
  let siguientePlazo = 0;
  const confirmaciones: string[] = [];
  let confirmar = (_texto: string) => true;
  const ventana = Object.assign(new EventTarget(), {
    confirm: (texto: string) => {
      confirmaciones.push(texto);
      return confirmar(texto);
    },
    setInterval: (accion: () => void) => {
      reloj.set(1, accion);
      return 1;
    },
    clearInterval: (id: number) => reloj.delete(id),
    setTimeout: (accion: () => void) => {
      siguientePlazo += 1;
      plazos.set(siguientePlazo, accion);
      return siguientePlazo;
    },
    clearTimeout: (id: number) => plazos.delete(id),
  });
  return {
    reloj,
    confirmaciones,
    ventana,
    alConfirmar: (accion: (texto: string) => boolean) => {
      confirmar = accion;
    },
    vencerPlazos: () => {
      const pendientes = [...plazos.values()];
      plazos.clear();
      for (const accion of pendientes) {
        accion();
      }
    },
  };
}

export function anotarConsultaOcultas(
  peticion: { tipo: string; pagina: number },
  registros: unknown[],
  llamadas: string[],
) {
  registros.push(peticion);
  llamadas.push('ocultas');
}

export function assertCampo(campo: Campo | undefined): asserts campo is Campo {
  if (!campo) {
    throw new Error('Falta campo del doble');
  }
}
