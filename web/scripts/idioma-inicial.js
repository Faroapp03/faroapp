// Decide el idioma de la página antes del primer pintado y lo deja en <html data-idioma>, y pide ya su diccionario (el
// elegido; idiomas/cargar.js espera su carga cuando se necesitan los textos). La regla es la misma que la de la portada
// pública y la pantalla de acceso (IDIOMA_INICIAL_JS en src/plataforma/cloudflare/portada-publica.ts): primero el que
// pide la dirección (?idioma=ca o ?idioma=es, para carteles y códigos QR), que se guarda como elección y se quita de la
// barra; después el que eligió la persona; después el primer idioma del navegador si es el catalán o el castellano, y
// por último el castellano. El HTML está escrito en castellano, así que sin JavaScript se lee en castellano. Con otro
// idioma, la página no se enseña (data-traduciendo, en base.css) hasta que scripts/idioma.js escribe sus textos, o se
// retira la marca al ejecutarse el temporizador programado para ESPERA_MAXIMA_MS, aunque el diccionario siga
// pendiente. Es un script clásico en head, como tema-inicial.js: decide el idioma antes de procesar el cuerpo de la
// página. El bloque evita que sus nombres queden en el ámbito global, que comparten todos los scripts clásicos.
{
  /**
   * La misma clave que usa idioma.js y los mismos idiomas que textos.js: un script clásico no puede usar imports
   * estáticos. Las pruebas de idioma inicial comprueban sus decisiones sin ejecutar el resto de la página.
   */
  const CLAVE_IDIOMA = 'faro-idioma';
  /** @type {readonly ('es' | 'ca')[]} */
  const IDIOMAS = ['es', 'ca'];
  const IDIOMA_DE_PARTIDA = 'es';
  /** El parámetro de la dirección con que un enlace pide un idioma. */
  const PARAMETRO_IDIOMA = 'idioma';
  /** «ca», «ca-ES», «ca-ES-valencia», «es», «es-ES»…: las etiquetas BCP 47 del catalán, el castellano y sus variantes. */
  const ETIQUETAS = { ca: /^ca(-|$)/i, es: /^es(-|$)/i };
  /** Plazo programado para retirar la ocultación si el intento de cargar los textos sigue pendiente. */
  const ESPERA_MAXIMA_MS = 1500;
  const raiz = document.documentElement;
  const origenDelGuion = document.currentScript?.getAttribute('src');
  const baseWeb = origenDelGuion ? new URL('../', new URL(origenDelGuion, document.baseURI)) : null;

  /** @param {string | null | undefined} valor */
  const idiomaValido = (valor) => IDIOMAS.find((idioma) => idioma === valor) ?? null;

  /**
   * El idioma que pide la dirección: queda guardado como elección y la dirección se queda sin el parámetro. Decide solo
   * la consulta; la dirección completa, con su fragmento, se lee únicamente para retirar un idioma válido, y no se
   * guarda ni se envía (la encuesta lleva su código en el fragmento: scripts/encuesta-fragmento.js).
   */
  const idiomaDelEnlace = () => {
    const pedido = idiomaValido(new URLSearchParams(location.search).get(PARAMETRO_IDIOMA));
    if (!pedido) {
      return null;
    }
    const direccion = new URL(location.href);
    // Cursos antes compartía este nombre con el idioma de las ofertas. Sus antiguos enlaces con filtros
    // se migran sin perder la elección. Un QR que solo pide un idioma sigue cambiando la interfaz.
    const filtro = document.currentScript?.getAttribute('data-filtro-idioma');
    const tieneFiltro = ['q', 'nivel', 'modalidad', 'tema', 'orden'].some((clave) => direccion.searchParams.has(clave));
    if (filtro && !direccion.searchParams.has(filtro) && tieneFiltro) {
      direccion.searchParams.set(filtro, pedido);
    }
    direccion.searchParams.delete(PARAMETRO_IDIOMA);
    history.replaceState(history.state, '', direccion.href);
    try {
      localStorage.setItem(CLAVE_IDIOMA, pedido);
    } catch {
      // Almacenamiento bloqueado: el idioma pedido vale para esta página.
    }
    return pedido;
  };
  const idiomaElegido = () => {
    try {
      return idiomaValido(localStorage.getItem(CLAVE_IDIOMA));
    } catch {
      // Almacenamiento bloqueado (navegación privada estricta): se sigue al navegador.
      return null;
    }
  };
  const idiomaDelNavegador = () => {
    const primero = navigator.languages?.[0] ?? navigator.language ?? '';
    return IDIOMAS.find((idioma) => ETIQUETAS[idioma].test(primero)) ?? IDIOMA_DE_PARTIDA;
  };

  /**
   * El manifiesto de cada idioma: el nombre y la descripción con que se instala Faro están en él, no en el HTML, y un
   * manifiesto solo puede declarar un idioma (`lang`). Los dos tienen el mismo `id` y el mismo `start_url`, así que
   * para el sistema son la misma aplicación. Se apunta aquí, antes del primer pintado, porque el navegador lee el
   * manifiesto una sola vez por página; al cambiar de idioma lo reapunta scripts/idioma.js.
   * @type {Record<'es' | 'ca', string>}
   */
  const MANIFIESTOS = { es: 'manifest.webmanifest', ca: 'manifest-ca.webmanifest' };
  /** @param {'es' | 'ca'} idioma */
  const apuntarManifiesto = (idioma) => {
    if (baseWeb) {
      document.querySelector('link[rel=manifest]')?.setAttribute('href', new URL(MANIFIESTOS[idioma], baseWeb).href);
    }
  };

  /** Pide el diccionario del idioma elegido mientras se pinta la página, para que ya esté cuando se escriban textos.
   * @param {string} idioma
   */
  const precargarDiccionario = (idioma) => {
    if (!baseWeb) {
      return;
    }
    const mapa = document.querySelector('script[type="importmap"]');
    try {
      const integridad = JSON.parse(mapa?.textContent || '{}').integrity;
      if (!integridad || typeof integridad !== 'object' || Array.isArray(integridad)) {
        return;
      }
      // El diccionario es una entrada estable del paquete, en idiomas/<idioma>.js desde la raíz de la web.
      const destino = new URL(`idiomas/${idioma}.js`, baseWeb).href;
      const candidatas = Object.entries(integridad).flatMap(([ruta, huella]) => {
        const url = new URL(ruta, document.baseURI).href;
        return url === destino && typeof huella === 'string' && huella ? [{ url, huella }] : [];
      });
      if (candidatas.length !== 1 || !candidatas[0]) {
        return;
      }
      const enlace = document.createElement('link');
      enlace.rel = 'modulepreload';
      enlace.href = candidatas[0].url;
      enlace.integrity = candidatas[0].huella;
      document.head.append(enlace);
    } catch {
      // Sin un mapa verificable se omite la precarga; la carga ordinaria del idioma conserva su propia comprobación.
    }
  };

  const idioma = idiomaDelEnlace() ?? idiomaElegido() ?? idiomaDelNavegador();
  raiz.dataset.idioma = idioma;
  apuntarManifiesto(idioma);
  precargarDiccionario(idioma);
  if (idioma !== IDIOMA_DE_PARTIDA) {
    raiz.dataset.traduciendo = '';
    setTimeout(() => {
      delete raiz.dataset.traduciendo;
    }, ESPERA_MAXIMA_MS);
  }
}
