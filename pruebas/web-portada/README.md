# Pruebas de portada

Comprueban el cierre real de imágenes, scripts, CSS y fuentes de inicio y de la página sin conexión, las licencias
incluidas, la identidad común ES/CA y las dimensiones de los iconos declarados por sus manifiestos.
No exigen que los destinos de navegación pendientes ya existan ni los sustituyen por páginas ficticias.

Desde la raíz: `node --test pruebas/web-portada/*.test.ts`.
Las rutas se resuelven desde el archivo de prueba, también con cwd ajeno y espacios/Unicode.
La estructura general del HTML y la integridad generada tienen sus controles compartidos; los estilos computados y
los flujos de navegador se comprueban aparte. Estas pruebas no afirman cubrir la aplicación completa.
