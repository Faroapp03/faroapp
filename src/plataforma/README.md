# Adaptadores de plataforma

Esta capa conecta el dominio y la API con Node, Cloudflare y el navegador. Cada adaptador carga datos,
recibe peticiones y aplica la configuración; las reglas del informe permanecen en el dominio.

## Datos

`archivos-del-paquete.ts` relaciona las partes del contrato `Datos` con sus archivos JSON y declara las cinco
partes obligatorias. Node y navegador comprueban las huellas antes de preparar los archivos. El Worker importa los módulos del
paquete cuya integridad comprueba la verificación del producto; no recalcula sus huellas al arrancar. Esta tabla conserva nombres y orden; no valida contenido externo por sí sola.

`prepararParte` compacta las relaciones ESCO y los vectores de formación para su uso en Worker y navegador.
Las demás partes conservan su identidad. La preparación conserva valores, orden y metadatos; no modifica
el catálogo recién leído. Los índices de los vectores se comparten con su representación original.

`relaciones-esco.ts` guarda las relaciones en un `Int32Array` común. Recibe índices enteros no negativos
menores que 2³⁰, producidos por la cadena de datos. Cada iterable de entrada se consume una sola vez;
las relaciones resultantes pueden recorrerse repetidamente y cada recorrido devuelve pares independientes.

Las pruebas de [archivos del paquete](../../pruebas/paquetes/archivos-del-paquete.test.ts) y
[relaciones ESCO](../../pruebas/datos-dominio/relaciones-esco.test.ts) comprueban los contratos de nombres, identidad,
orden, ausencia de mutación y consumo de iterables.

Los datos se encuentran en [datos](../../datos/README.md), con una copia canónica por archivo.
`node/datos.ts` recibe la carpeta, verifica los bytes y devuelve los datos sin compactación.
`navegador/paquete.ts` recibe la URL base; limita cada descarga a un minuto, comprueba las huellas y conserva
el orden al preparar el conjunto. Una parte opcional se lee en Node si existe su archivo; en navegador,
si aparece en el manifiesto. Un error de UTF-8 o de JSON no se sustituye por datos parciales.

`cloudflare/paquete.ts` carga cada parte cuando se usa por primera vez y conserva esa lectura. En Node los
imports JSON son objetos; el empaquetado de Cloudflare debe entregarlos como módulos de bytes para liberar
su memoria tras la primera lectura. Las pruebas simulan esa interfaz; no sustituyen el ensayo del Worker desplegado.

`paquete-publicado.ts` define las rutas públicas inmutables `/paquete/<versión>/<archivo>.json`;
`node/paquete-publicado.ts` obtiene la versión de los bytes del manifiesto y ordena sus nombres.
Estos módulos describen el paquete: no suben, copian ni publican archivos.

`herramientas/publicar-paquete.ts` prepara la copia del paquete en la web construida (`construir.ts`).
Lee una captura del manifiesto y de los datos, comprueba todas las huellas y escribe los mismos bytes verificados.
Una entrada inválida no llega a crear el destino; la retirada de versiones anteriores ocurre tras la escritura.
La validación completa se realiza al construir esa copia, no en cada petición que consulta el manifiesto.

Las pruebas de lectores comprueban errores, opcionales, orden, consumo único y rutas con espacios, Unicode
y signos de URL. [paquete-integridad.test.ts](../../pruebas/paquetes/paquete-integridad.test.ts) exige que el contenido
oficial coincida con su manifiesto y no contenga archivos adicionales.

## Configuración y recursos HTTP

`configuracion.ts` valida las variables de oferta, acceso, firmas y servicios de consulta.
El recorrido utiliza los motores locales y los servicios factuales habilitados.

`catalogo-de-apis.ts` publica los enlaces de descubrimiento de los servicios habilitados.
`cabeceras-web.ts` define las políticas de seguridad y caché de los recursos; `mapa-de-modulos.ts` conserva
la huella del mapa de importaciones utilizado por esas políticas. Al cambiar ese mapa hay que reconstruir y
comprobar juntos los recursos y su política.
`avisos-del-navegador.ts` limita y minimiza los avisos técnicos; `punto-de-avisos.ts` valida su recepción.
El punto admite 30 envíos por minuto y por instancia; no es un límite global del despliegue, porque cada instancia del
Worker lleva su propia cuenta. De cada envío aceptado escribe una línea en la consola de la instancia, sin almacén
propio y con la observabilidad de Cloudflare desactivada en la configuración. Las dos entradas de Cloudflare admiten
`POST /avisos-del-navegador` sin sesión ni credencial (`cloudflare/canales-portal.ts`), porque el navegador envía
así los informes de NEL y los de la CSP cuando la sesión ya no vale; el resto de la ruta sigue tras la puerta.
`seguridad-txt.ts` construye el contacto público de seguridad a partir de la configuración del despliegue.

## Node

`node/rutas.ts` calcula las rutas desde la instalación. `node/entorno.ts` lee la configuración local.
`node/servidor.ts` adapta HTTP a la API Fetch y sirve recursos dentro de las carpetas autorizadas.
`node/envio-de-archivos.ts` envía esos archivos solo a GET y HEAD; a otro método, 405 con `Allow: GET, HEAD`.
`node/respuesta-http.ts` materializa los cuerpos acotados y cancela su lectura cuando el cliente se desconecta.
El arranque y sus variables se explican en [operación local](../../docs/operacion-local.md).

## Cloudflare

`cloudflare/worker.ts` compone los enlaces del entorno, los datos, la seguridad y la API. La configuración básica se valida
antes de preparar la persistencia. `cerrojo-access.ts` comprueba las firmas, el emisor, la audiencia y
la vigencia de los pases de Access; conserva una caché temporal de claves públicas.
`FARO_ACCESS_DECLARACION=pruebas-con-relatos-ficticios` exige Access también para las consultas públicas,
con `FARO_ACCESS_EQUIPO` y `FARO_ACCESS_AUD`. Esta guardia no sustituye el acceso administrativo obligatorio.
Una opción de seguridad retirada se rechaza al arrancar, sin ignorarla ni conceder acceso abierto.
`dominio-canonico.ts` prepara la redirección al dominio configurado.

`acceso-publico/durable.ts` conserva las instituciones invitadas, las cuotas y revocaciones, los accesos,
los controles, la sesión y los trabajos administrativos. El montaje utiliza el enlace del entorno `REGISTRO_SOCIOS`. La plantilla de instalación
nueva y los límites de actualización se explican en [Cloudflare](../../config/cloudflare/README.md).
Las pruebas locales de los enlaces del entorno no equivalen a un despliegue real.

## Navegador

`navegador/motor.ts` carga el paquete y compone la API del dispositivo.
Recibe del Worker la URL, el método, las cabeceras y el texto del cuerpo; construye una petición local acotada
antes de entregarla a la API. El contrato de las respuestas coincide con el de los demás adaptadores.
La construcción del motor para la web debe preservar esta entrada y las rutas de sus recursos.
Las pruebas comprueban su contrato usando los datos propios y sin servicios externos.

## Administración

`administracion.ts` valida el montaje común y reserva sus rutas antes de servir archivos. Los adaptadores Node y
Cloudflare comparten controles y sesión con el almacén de acceso público. Leen la política por petición y preparan
los servicios factuales autorizados. Mantienen las autoridades de conectividad, secciones, datos y trabajos.
La configuración, las operaciones y los límites se explican en [administración](../../docs/administracion.md).
