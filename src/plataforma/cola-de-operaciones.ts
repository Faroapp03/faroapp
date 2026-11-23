// Cola FIFO de ejecución única: una retirada pendiente elimina el trabajo sin llegar a ejecutarlo.
// La operación activa atiende su propia señal; la cola espera su limpieza antes de iniciar la siguiente.

interface Tarea {
  ejecutar(): Promise<void>;
}

export class ColaDeOperaciones {
  private readonly pendientes = new Set<Tarea>();
  private activa = false;

  agregar<Valor>(ejecutar: () => Promise<Valor>, senal?: AbortSignal): Promise<Valor> {
    return new Promise((resolver, rechazar) => {
      if (senal?.aborted) {
        rechazar(senal.reason);
        return;
      }
      let tarea: Tarea;
      const retirar = () => {
        if (this.pendientes.delete(tarea)) {
          limpiar();
          rechazar(senal?.reason);
        }
      };
      const limpiar = () => senal?.removeEventListener('abort', retirar);
      tarea = {
        async ejecutar() {
          limpiar();
          try {
            senal?.throwIfAborted();
            resolver(await ejecutar());
          } catch (error) {
            rechazar(error);
          }
        },
      };
      this.pendientes.add(tarea);
      senal?.addEventListener('abort', retirar, { once: true });
      this.procesar();
    });
  }

  private procesar(): void {
    if (this.activa) {
      return;
    }
    const tarea = this.pendientes.values().next().value;
    if (!tarea) {
      return;
    }
    this.activa = true;
    this.pendientes.delete(tarea);
    queueMicrotask(() => {
      void tarea.ejecutar().finally(() => {
        this.activa = false;
        this.procesar();
      });
    });
  }
}
