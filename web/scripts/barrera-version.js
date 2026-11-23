// La página y la copia deben ser de la misma versión antes de ejecutar el recorrido.
{
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) {
    throw new Error('Falta la barrera de versión');
  }
  document.documentElement.hidden = true;
  const PLAZO = 5000;
  const ESPERA_PESTANAS = 300;
  const INTERVALO_INSTALACION = 100;
  const INTENTOS_INSTALACION = 300;
  const MAXIMO_TRABAJADOR = 2097152;
  const CLAVE_REINTENTO = 'faro-version-barrera';
  const CLAVE_FRAGMENTO = Symbol.for('faro.fragmento.transitorio');
  const abrioConFragmento = location.hash.startsWith('#pasar=');
  let fragmento = abrioConFragmento ? location.hash : null;
  if (fragmento !== null) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    Reflect.set(window, CLAVE_FRAGMENTO, () => {
      const valor = fragmento;
      fragmento = null;
      Reflect.deleteProperty(window, CLAVE_FRAGMENTO);
      return valor;
    });
  }
  // Bajo un service worker, ningún guion clásico posterior (idioma-inicial.js precarga el diccionario) debe pedir
  // módulos antes de comprobar la copia: el navegador ya registró el mapa de módulos y se aparta del documento hasta
  // activar los guiones.
  const mapa = navigator.serviceWorker?.controller ? document.querySelector('script[type="importmap"]') : null;
  const padreMapa = mapa?.parentNode ?? null;
  const siguienteMapa = mapa?.nextSibling ?? null;
  let mapaApartado = false;
  if (mapa && padreMapa) {
    mapa.remove();
    mapaApartado = true;
  }
  function reponerMapa() {
    if (mapaApartado && mapa && padreMapa) {
      padreMapa.insertBefore(mapa, siguienteMapa);
      mapaApartado = false;
    }
  }
  const marca = document.querySelector('meta[name="faro-version-copia"]')?.getAttribute('content');
  const base = new URL('../', script.src);
  const plantillas = () =>
    [...document.querySelectorAll('template')].filter((elemento) => elemento.hasAttribute('data-faro-carga'));
  let comprobando = false;
  let esperando = false;
  let cambioPendiente = false;
  let guionIniciado = false;
  let activacionFallida = false;
  let recargaPorFragmento = false;
  const ocultosDuranteAviso = new Map();
  function mostrarContenido() {
    for (const [elemento, oculto] of ocultosDuranteAviso) {
      elemento.hidden = oculto;
    }
    ocultosDuranteAviso.clear();
    document.documentElement.hidden = false;
  }
  window.addEventListener('hashchange', () => {
    if (activacionFallida && !recargaPorFragmento && location.hash.startsWith('#pasar=')) {
      recargaPorFragmento = true;
      location.reload();
    }
  });
  async function versionControlador() {
    const r = await fetch(new URL('motor/copia-comprobada.json', base), {
      cache: 'no-store',
      signal: AbortSignal.timeout(PLAZO),
    });
    if (!r.ok) {
      throw new Error('No se puede comprobar la copia');
    }
    const datos = await r.json();
    if (!/^[a-f0-9]{16}$/u.test(datos.version)) {
      throw new Error('Versión inválida');
    }
    return datos.version;
  }
  async function versionEnRed() {
    const respuesta = await fetch(new URL('service-worker.js', base), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(PLAZO),
    });
    if (!respuesta.ok) {
      throw new Error('No se puede comprobar la versión de red');
    }
    const texto = await respuesta.text();
    if (texto.length > MAXIMO_TRABAJADOR) {
      throw new Error('Trabajador demasiado grande');
    }
    // La misma expresión que LINEA_DE_LA_VERSION (version-del-servicio.js): un guion clásico no puede importarla.
    const versiones = [...texto.matchAll(/^(?:var|let|const) VERSION = (?:"([a-f0-9]{16})"|'([a-f0-9]{16})');$/gmu)];
    const version = versiones[0]?.[1] ?? versiones[0]?.[2];
    if (versiones.length !== 1 || version === undefined) {
      throw new Error('Versión de red inválida');
    }
    return version;
  }
  function recargarUnaVez() {
    if (abrioConFragmento) {
      mostrarAviso('reenviar');
      return;
    }
    // Sin la guarda contra bucles (almacenamiento bloqueado) o si esta versión ya recargó una vez, la página no se
    // recarga sola: se pide a la persona que la vuelva a cargar, sin atribuirlo a la conexión.
    if (!recargarConGuarda()) {
      mostrarAviso('anterior');
    }
  }
  const TEXTOS = {
    es: {
      esperando: 'Hay una versión nueva. Espera o vuelve a intentarlo.',
      ocupada: 'Hay otra pestaña con trabajo abierto. Termínalo y vuelve a intentarlo.',
      sinCanal: 'No se puede comprobar si otras pestañas tienen trabajo abierto. Ciérralas y vuelve a intentarlo.',
      error: 'No se ha podido preparar esta página. Comprueba la conexión y vuelve a intentarlo.',
      recargar: 'No se ha podido terminar de cargar esta página. Vuelve a cargarla para seguir.',
      anterior: 'Esta página no coincide con la versión instalada de Faro. Vuelve a cargarla para seguir.',
      antigua: 'La página no coincide con la copia. Vuelve a abrirla para actualizar.',
      reenviar: 'Esta página ha quedado antigua. Vuelve a abrir o escanear el enlace desde el dispositivo de origen.',
      reintentar: 'Volver a intentar',
      volverACargar: 'Volver a cargar',
    },
    ca: {
      esperando: 'Hi ha una versió nova. Espera o torna-ho a provar.',
      ocupada: 'Hi ha una altra pestanya amb feina oberta. Acaba-la i torna-ho a provar.',
      sinCanal: 'No es pot comprovar si altres pestanyes tenen feina oberta. Tanca-les i torna-ho a provar.',
      error: 'No s’ha pogut preparar aquesta pàgina. Comprova la connexió i torna-ho a provar.',
      recargar: 'No s’ha pogut acabar de carregar aquesta pàgina. Torna-la a carregar per continuar.',
      anterior: 'Aquesta pàgina no coincideix amb la versió instal·lada de Faro. Torna-la a carregar per continuar.',
      antigua: 'La pàgina no coincideix amb la còpia. Torna-la a obrir per actualitzar.',
      reenviar: 'Aquesta pàgina ha quedat antiga. Torna a obrir o escanejar l’enllaç des del dispositiu d’origen.',
      reintentar: 'Torna-ho a provar',
      volverACargar: 'Torna a carregar',
    },
  };
  /** @param {'esperando' | 'error' | 'recargar' | 'anterior' | 'antigua' | 'reenviar' | 'ocupada' | 'sinCanal'} clave */
  function mostrarAviso(clave) {
    // El idioma elegido lo marca idioma-inicial.js antes de pintar; lang cambia al traducir, ya con los guiones activos.
    const raiz = document.documentElement;
    const textos = (raiz.dataset.idioma ?? raiz.lang) === 'ca' ? TEXTOS.ca : TEXTOS.es;
    let aviso = document.getElementById('faro-version-aviso');
    if (!(aviso instanceof HTMLElement)) {
      aviso = Object.assign(document.createElement('p'), { id: 'faro-version-aviso' });
      aviso.setAttribute('role', 'alert');
      document.body.prepend(aviso);
    }
    document.body.inert = false;
    for (const elemento of document.body.children) {
      if (elemento instanceof HTMLElement && elemento !== aviso) {
        elemento.inert = true;
        if (!ocultosDuranteAviso.has(elemento)) {
          ocultosDuranteAviso.set(elemento, elemento.hidden);
        }
        elemento.hidden = true;
      }
    }
    document.documentElement.hidden = false;
    aviso.hidden = false;
    aviso.textContent = textos[clave];
    if (clave === 'reenviar') {
      return;
    }
    aviso.append(' ', botonDelAviso(clave, textos));
  }
  /**
   * El botón de un aviso: en `recargar` y `anterior` vuelve a cargar la página; en los demás, repite la comprobación.
   * @param {string} clave @param {typeof TEXTOS.es} textos
   */
  function botonDelAviso(clave, textos) {
    const recarga = clave === 'recargar' || clave === 'anterior';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = recarga ? textos.volverACargar : textos.reintentar;
    boton.addEventListener('click', recarga ? () => location.reload() : () => void comprobar());
    return boton;
  }
  /** @param {HTMLTemplateElement} plantilla */
  async function activarPlantilla(plantilla) {
    const nodo = plantilla.content.firstElementChild?.cloneNode(true);
    if (!nodo) {
      throw new Error('Falta un recurso de la página');
    }
    if (nodo instanceof HTMLLinkElement && nodo.rel === 'stylesheet') {
      const padre = plantilla.parentNode;
      if (!padre) {
        throw new Error('Falta el lugar de la hoja');
      }
      await /** @type {Promise<void>} */ (
        new Promise((resolver, rechazar) => {
          /** @param {boolean} correcta */
          const terminar = (correcta) => {
            clearTimeout(plazo);
            nodo.removeEventListener('load', alCargar);
            nodo.removeEventListener('error', alFallar);
            if (correcta) {
              plantilla.remove();
              resolver();
            } else {
              nodo.remove();
              rechazar(new Error('No se ha podido cargar la hoja'));
            }
          };
          const alCargar = () => terminar(true);
          const alFallar = () => terminar(false);
          const plazo = setTimeout(alFallar, PLAZO);
          nodo.addEventListener('load', alCargar, { once: true });
          nodo.addEventListener('error', alFallar, { once: true });
          padre.insertBefore(nodo, plantilla);
        })
      );
      return;
    }
    if (!(nodo instanceof HTMLScriptElement)) {
      plantilla.replaceWith(nodo);
      return;
    }
    if (navigator.serviceWorker?.controller && (await versionControlador()) !== marca) {
      throw new Error('La copia cambió');
    }
    nodo.async = false;
    const carga = new Promise((ok, fallo) => {
      nodo.addEventListener('load', ok, { once: true });
      nodo.addEventListener('error', fallo, { once: true });
    });
    guionIniciado = true;
    plantilla.replaceWith(nodo);
    await carga;
  }
  async function activarGuiones() {
    reponerMapa();
    const pendientes = plantillas();
    for (const plantilla of pendientes.filter(
      (elemento) => elemento.content.firstElementChild instanceof HTMLLinkElement,
    )) {
      await activarPlantilla(plantilla);
    }
    mostrarContenido();
    for (const plantilla of pendientes.filter(
      (elemento) => elemento.content.firstElementChild instanceof HTMLScriptElement,
    )) {
      await activarPlantilla(plantilla);
    }
    for (const elemento of document.body.children) {
      if (elemento instanceof HTMLElement) {
        elemento.inert = false;
      }
    }
    document.body.inert = false;
    const aviso = document.getElementById('faro-version-aviso');
    if (aviso instanceof HTMLElement) {
      aviso.hidden = true;
    }
  }
  async function otraPestanaOcupada() {
    const canal = new BroadcastChannel('faro-versiones');
    return new Promise((resolver) => {
      let ocupada = false;
      canal.addEventListener('message', (evento) => {
        if (evento.data === 'algo-que-perder') {
          ocupada = true;
        }
      });
      canal.postMessage('algo-que-perder?');
      setTimeout(() => {
        canal.close();
        resolver(ocupada);
      }, ESPERA_PESTANAS);
    });
  }
  /**
   * Espera a que la versión nueva termine de instalarse. Si deja de haber una instalación en curso sin que quede una
   * versión en espera, la instalación ha fallado: se avisa enseguida en lugar de agotar el plazo.
   * @param {ServiceWorkerRegistration} registro
   */
  async function esperarInstalacion(registro) {
    for (let intento = 0; intento < INTENTOS_INSTALACION; intento++) {
      const trabajador = registro.waiting;
      if (trabajador) {
        return trabajador;
      }
      if (!registro.installing) {
        throw new Error('La instalación falló');
      }
      await new Promise((resolver) => setTimeout(resolver, INTERVALO_INSTALACION));
    }
    throw new Error('La instalación no terminó');
  }
  function limpiarReintento() {
    try {
      sessionStorage.removeItem(CLAVE_REINTENTO);
    } catch {
      /* La carga no depende del almacenamiento opcional. */
    }
  }
  // Recarga una vez, con la guarda contra bucles en sessionStorage. Sin almacenamiento, o si esta versión ya recargó,
  // no recarga y devuelve false: tras activar la versión nueva se continúa en la misma página.
  function recargarConGuarda() {
    if (!marca) {
      return false;
    }
    try {
      if (sessionStorage.getItem(CLAVE_REINTENTO) === marca) {
        return false;
      }
      sessionStorage.setItem(CLAVE_REINTENTO, marca);
    } catch {
      return false;
    }
    location.reload();
    return true;
  }
  async function actualizar() {
    esperando = true;
    const registro = await navigator.serviceWorker.getRegistration();
    if (!registro) {
      throw new Error('No hay registro');
    }
    await registro.update();
    const trabajador = await esperarInstalacion(registro);
    if (!('BroadcastChannel' in window)) {
      mostrarAviso('sinCanal');
      return;
    }
    if (await otraPestanaOcupada()) {
      mostrarAviso('ocupada');
      return;
    }
    trabajador.postMessage({ type: 'ACTIVATE_UPDATE' });
    mostrarAviso('esperando');
  }
  async function iniciarSegunVersion() {
    if (!navigator.serviceWorker?.controller) {
      limpiarReintento();
      await activarGuiones();
    } else {
      const version = await versionControlador();
      if (version === marca) {
        limpiarReintento();
        await activarGuiones();
      } else {
        const versionRed = await versionEnRed();
        if (versionRed === version) {
          recargarUnaVez();
        } else if (versionRed === marca) {
          await actualizar();
        } else {
          throw new Error('La entrega cambió durante la comprobación');
        }
      }
    }
  }
  function avisarFallo() {
    if (guionIniciado) {
      activacionFallida = true;
      mostrarAviso(abrioConFragmento ? 'reenviar' : 'recargar');
    } else {
      mostrarAviso('error');
    }
  }
  async function comprobar() {
    if (comprobando || activacionFallida) {
      return;
    }
    comprobando = true;
    try {
      if (!/^[a-f0-9]{16}$/u.test(marca ?? '')) {
        throw new Error('Falta la versión de la página');
      }
      await iniciarSegunVersion();
    } catch {
      avisarFallo();
    } finally {
      comprobando = false;
      if (cambioPendiente) {
        cambioPendiente = false;
        void comprobar();
      }
    }
  }
  function continuarTrasCambio() {
    esperando = false;
    if (!abrioConFragmento && recargarConGuarda()) {
      return;
    }
    if (comprobando) {
      cambioPendiente = true;
    } else {
      void comprobar();
    }
  }
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (!esperando || activacionFallida) {
      return;
    }
    void versionControlador()
      .then((version) => {
        if (activacionFallida) {
          return;
        }
        if (version === marca) {
          continuarTrasCambio();
        } else {
          mostrarAviso('antigua');
        }
      })
      .catch(() => avisarFallo());
  });
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      void comprobar();
    },
    { once: true },
  );
}
