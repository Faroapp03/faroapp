// Decide antes de pintar; si no hay almacenamiento se prioriza no repetir el movimiento.
(() => {
  const PLAZO_MARCA_MS = 2000;
  const PLAZO_ESPERA_MS = 4000;
  let desdeMenu = false;
  const navegacion = /** @type {PerformanceNavigationTiming | undefined} */ (
    performance.getEntriesByType?.('navigation')?.[0]
  );
  try {
    const marca = JSON.parse(sessionStorage.getItem('faro-inicio-desde-menu') || 'null');
    sessionStorage.removeItem('faro-inicio-desde-menu');
    const destino = new URL(location.href);
    destino.hash = '';
    const origen = new URL(marca?.origen);
    const referente = document.referrer ? new URL(document.referrer) : null;
    if (referente) {
      referente.hash = '';
    }
    origen.hash = '';
    // La descarga puede tardar: se compara con el comienzo de la navegación, no con la ejecución de este guion.
    const distancia = Math.abs(performance.timeOrigin - marca?.instante);
    desdeMenu =
      navegacion?.type === 'navigate' &&
      distancia <= PLAZO_MARCA_MS &&
      marca?.destino === destino.href &&
      marca?.origen === origen.href &&
      origen.origin === destino.origin &&
      origen.href !== destino.href &&
      (!referente || referente.href === origen.href);
  } catch {
    /* Sin almacenamiento o marca válida, se anima. */
  }
  if (
    !desdeMenu &&
    navegacion?.type !== 'back_forward' &&
    typeof matchMedia === 'function' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    // Si el módulo no llega, este plazo deja visibles los textos de nuevo.
    setTimeout(() => document.documentElement.classList.remove('inicio-esperar'), PLAZO_ESPERA_MS);
    document.documentElement.classList.add('inicio-permitido', 'inicio-esperar');
  }
})();
