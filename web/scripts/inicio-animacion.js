// Sin este módulo, imagen y textos son visibles; la animación arranca cuando carga la foto.
if (document.documentElement.classList.contains('inicio-permitido')) {
  const imagen = /** @type {HTMLImageElement | null} */ (document.querySelector('.apertura-imagen img'));
  const abrir = () => {
    if (!document.documentElement.classList.contains('inicio-esperar')) {
      return;
    }
    document.documentElement.classList.remove('inicio-esperar');
    document.documentElement.classList.add('inicio-abrir');
  };
  if (!imagen || imagen.complete) {
    abrir();
  } else {
    imagen.addEventListener('load', abrir, { once: true });
    imagen.addEventListener('error', abrir, { once: true });
  }
  const tarjetas = document.querySelectorAll('.historia');
  if ('IntersectionObserver' in window) {
    /** @type {IntersectionObserver | undefined} */
    let observador;
    try {
      observador = new IntersectionObserver(
        (entradas) => {
          for (const entrada of entradas) {
            if (entrada.isIntersecting) {
              entrada.target.classList.add('historia-visible');
              /** @type {IntersectionObserver} */ (observador).unobserve(entrada.target);
            }
          }
        },
        { threshold: 0.08 },
      );
      tarjetas.forEach((tarjeta) => {
        /** @type {IntersectionObserver} */ (observador).observe(tarjeta);
      });
      document.documentElement.classList.add('inicio-observar');
    } catch {
      observador?.disconnect();
    }
  }
}
