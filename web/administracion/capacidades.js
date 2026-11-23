// Una capacidad ausente nunca habilita una acción administrativa.
/** @typedef {{controles:boolean,actualizacion:boolean,vigilante:boolean}} Capacidades */
/** @param {(capacidades:Capacidades)=>void} recibir */
export function consultarCapacidades(recibir) {
  void fetch('/capacidades-panel.json', { cache: 'no-store' })
    .then(async (respuesta) => {
      if (!respuesta.ok) {
        return;
      }
      const dato = await respuesta.json();
      if (
        dato?.version !== 1 ||
        typeof dato.controles !== 'boolean' ||
        typeof dato.actualizacion !== 'boolean' ||
        (dato.vigilante !== undefined && typeof dato.vigilante !== 'boolean')
      ) {
        return;
      }
      recibir({
        controles: dato.controles,
        actualizacion: dato.actualizacion,
        vigilante: dato.vigilante === true,
      });
    })
    .catch(() => {});
}

/** Al abrir, consulta las secciones sin reemplazar un borrador que ya se esté editando y, después, las lecturas que
 * resume el Inicio (datos y, si la instalación actualiza datos, trabajo y publicación), para que el usuario vea el
 * estado sin tener que pedirlo. Cada lectura espera a la anterior y se omite si la sesión ya no está activa.
 * @param {Pick<ReturnType<typeof import('./cliente.js').crearClientePanel>, 'abrir'|'consultarSecciones'|'consultarDatos'|'consultarTrabajo'|'consultarActivacion'>} cliente
 * @param {()=>boolean} tieneBorrador @param {()=>import('./cliente.js').EstadoClientePanel|null} ultimo
 * @param {{retomar:boolean,actualizacion:boolean}} lecturas */
export async function abrirPanelYConsultar(cliente, tieneBorrador, ultimo, lecturas) {
  const estado = await cliente.abrir(lecturas.retomar);
  if (estado?.estado === 'activa' && !estado.secciones && !tieneBorrador()) {
    await cliente.consultarSecciones();
  }
  const disponible = () => {
    const actual = ultimo();
    return actual?.estado === 'activa' && !actual.ocupado;
  };
  if (disponible()) {
    await cliente.consultarDatos();
  }
  if (lecturas.actualizacion && disponible()) {
    await cliente.consultarTrabajo();
  }
  if (lecturas.actualizacion && disponible()) {
    await cliente.consultarActivacion();
  }
}
