# Servidor local

`servidor-local.ts` carga el paquete oficial, valida la configuración y compone los servicios de Faro para Node.
Solo inicia el servidor cuando se ejecuta como programa; importarlo no abre un puerto.

La orden `npm run servir` escucha en la interfaz local, con el puerto configurable mediante `FARO_PUERTO`.
La configuración del servicio y de seguridad se valida al arrancar; una configuración inválida impide el arranque.
Sirve la web local construida en `.web-local/web` (la construye si falta o si cambian sus fuentes, como
`npm run web:preparar`); no despliega servicios.

La [guía de operación](../../docs/operacion-local.md) explica perfiles, rutas y límites del servidor local.
