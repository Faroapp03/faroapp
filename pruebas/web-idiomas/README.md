# Pruebas de idiomas

Pruebas de los diccionarios, resolución de textos, selección inicial, carga diferida, cambio de idioma y versión.
Los documentos y el service worker se simulan; no hay llamadas de red ni páginas completas en estos ensayos.

Ejecutar desde la raíz: `node --test pruebas/web-idiomas/*.test.ts`.
Los dobles implementan solo los miembros DOM utilizados y cada archivo se ejecuta en su propio proceso de Node.
Las URL de carga fallidas se recuerdan para comprobar que un reintento cambia el fragmento del módulo de entrada.
La recuperación de una parte estática fallida y los estilos requieren una prueba posterior en navegadores reales.
