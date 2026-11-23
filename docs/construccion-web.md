# Construcción de la web y del motor para el navegador

Las fuentes del motor están en `src/` y sus datos canónicos en `datos/`. El navegador recibe JavaScript generado;
no se mantiene una segunda implementación del dominio. Las herramientas calculan sus rutas desde la instalación.

## Salida para publicar

Con fuentes verificadas y datos admitidos, ejecutar `npm run construir`. Genera `dist/` sin cambiar `web/`,
`src/` ni `datos/`: recursos del navegador en `dist/web/`, Worker compilado y módulos de datos en `dist/worker/`,
y un inventario verificable en `dist/artefacto.json`. No requiere credenciales, no descarga fuentes, no firma
ni despliega. Los adaptadores de despliegue consumen esta salida, no la carpeta del código fuente.

La construcción conserva los nombres y las rutas de los recursos. Retira comentarios ordinarios del código propio
con analizadores de sintaxis; conserva avisos legales, literales y terminadores de línea de JavaScript. El HTML
conserva su estructura y espacios. El CSS se compacta sin renombrar ni transformar su sintaxis; ante avisos
Copyright/SPDX conserva el archivo completo. Las bibliotecas y licencias de terceros permanecen intactas.

El motor se empaqueta una vez. Sus bytes de referencia y los recursos finales determinan SRI, CSP, VERSION,
catálogos y manifiesto del dispositivo; el Worker recibe esa misma CSP durante su construcción. Los controles
comprueban la salida antes de admitirla. El paquete publicado conserva los bytes y las huellas de `datos/`.

La actualización operativa usa este mismo constructor con `--huella-paquete` tomada del recibo validado y
`--solo-nuevo`: rechaza un paquete distinto y exige un destino nuevo fuera del producto y la variante de la
instalación en `--destino-cloudflare`. El ejecutor vuelve a contrastar el resumen antes de almacenarlo. La exportación manual de Cloudflare sigue la misma preparación;
no mantiene una vía de publicación de la web fuente.

## Web local

`npm run web:preparar` (`construir --local`) construye en `.web-local/` (fuera de Git) la misma web que `dist/web/`, por
el
mismo camino (`construirCandidata`): copia lo publicado, empaqueta, inyecta los mapas, el SRI y el marcador, y comprueba
la candidata, sin escribir nada en `web/`. Deja la web en `.web-local/web/` y, al lado, `construccion.json` con la
huella de sus fuentes, la huella CSP de sus mapas y la versión del paquete. Solo sustituye la anterior cuando la nueva
está comprobada. `npm run servir` sirve `.web-local/web/` y la construye si falta o si la huella de sus fuentes no es la
actual: un sha256 de las rutas y los bytes de todo lo que lee la construcción: `web/`, `src/`, `compartido/`,
`motores/`, `datos/`, `herramientas/web/`, `herramientas/comun/`, `herramientas/cloudflare/`,
`herramientas/publicar-paquete.ts`, el registro de hechos del informe
(`plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json`), `tsconfig.navegador.json` (las entradas del
motor), `package.json` y `package-lock.json`. Quien añada a la construcción una lectura fuera de esa lista tiene que
añadirla a `ENTRADAS_DE_LA_WEB` (`herramientas/web/construir.ts`). Se usan huellas y no fechas, porque una copia o un
checkout cambian las fechas sin cambiar nada. Frente a `dist/web/`, la web local conserva `.assetsignore`, que el
servidor local necesita para no servir lo excluido y que la exportación deja fuera, y las carpetas vacías que deja el
empaquetado.

El servidor local envía la CSP con las huellas de los mapas de esa web (las de `construccion.json`, las mismas que
la construcción oficial pone en el Worker). Antes de escuchar, una guardia comprueba que esas huellas admiten el mapa
real de cada página servida. `servir` comprueba la huella de las fuentes solo al arrancar: después de editar, hay que
pararlo y volver a lanzarlo para que reconstruya la web local.

La salida no depende de la carpeta temporal en que se construye: los módulos que el empaquetado toma del repositorio y
no de la copia temporal de la web (el lector del catálogo de cursos, `src/catalogo-cursos/publico.ts`, y lo que importa)
entran por un espacio de nombres propio con su ruta desde la raíz del repositorio
(`herramientas/web/empaquetado/fuentes.ts`).
Antes, esbuild los nombraba con su ruta relativa a la copia temporal, que depende de `TMPDIR`, y cambiaban los nombres
con huella de un trozo y de la entrada de `cursos.html`. `pruebas/web-publicacion/construccion-reproducible.test.ts`
construye
con dos `TMPDIR` de profundidad distinta y exige la misma salida.

La salida incluye recursos administrativos que debe proteger el Worker. **No servir `dist/web/` directamente
como una web pública sin ese control** ni exponer `dist/` completo como directorio estático.

La revisión declarada se toma de Git. Una copia sin Git puede indicar su revisión de origen:

```sh
npm run construir -- --revision-codigo "$REVISION_CODIGO" --destino "../Salida Faro"
```

En una entrega sin historial Git, `REVISION_CODIGO` es el SHA completo documentado de esa entrega. Tiene que
corresponder al contenido recibido: no sustituye las huellas de los archivos ni se inventa para completar la orden.

En `construir`, `--destino` indica la carpeta de salida y `--destino-cloudflare` la variante
`privado` u `oficial`. En `cloudflare:artefacto`, la carpeta o el descriptor se indican como argumento
posicional y `--destino` selecciona la variante al exportar.

`construir` escribe además el resumen del grafo que emitió el empaquetado del navegador (por página, su entrada, sus
trozos estáticos y dinámicos y sus bytes) en el archivo que indique `--grafo-emitido`. Sin esa opción lo deja fuera
del destino, a su lado, con el nombre del destino seguido de `.grafo-emitido.json`: para `dist/`, en
`dist.grafo-emitido.json`, junto a `dist/`. Si ya existe, lo sustituye. Fuera del destino, no forma parte de la salida
ni de su inventario.

El padre del destino debe existir y no contener enlaces simbólicos. Una salida anterior solo se sustituye si
coincide íntegramente con su propio inventario; archivos añadidos o alterados detienen el reemplazo. Se prepara
una copia privada en el volumen del destino y se conserva respaldo ante un fallo que impida restaurar la anterior.
La reserva de promoción excluye otras promociones cooperantes; si queda tras una interrupción, revisar el estado
antes de retirarla. No es una actualización atómica de una carpeta que ya esté sirviendo tráfico ni un sistema
de recuperación automática tras un corte de alimentación.

La orden devuelve `sha256Artefacto`. Conservarlo por una vía confiable para verificar una copia trasladada:

```sh
npm run cloudflare:artefacto -- comprobar dist --sha256 "$SHA256_ARTEFACTO"
```

La revisión es una declaración, no una prueba de que la carpeta coincide con su código en Git; la huella tampoco es
una firma. La entrega debe partir de fuentes estables y verificadas. Las pruebas de navegador, las firmas y el ensayo
del alojamiento se realizan sobre la salida concreta antes de publicarla.

## Preparación de las fuentes generadas

Con las dependencias del [README](../README.md) instaladas:

```sh
npm run comunes:generar
npm run api:generar
npm run lecturas:generar
npm run globales:generar
npm run informe:ejemplo
npm run web:preparar
npm run verificar
```

El orden conserva las dependencias: los datos y el ejemplo preceden a la construcción de la web local, que empaqueta
el motor con esbuild, publica el paquete desde `datos/`, escribe el manifiesto del dispositivo, inyecta mapas, SRI y
marcador, genera el service worker con sus catálogos y lo comprueba todo, incluido el cotejo de artefactos
(`comprobarArtefactos`: el motor es exactamente el empaquetado, el paquete publicado coincide con los archivos y huellas
de `datos/`, y el manifiesto del dispositivo, con ambos). La actualización de datos ejecuta esta secuencia en una copia
aislada antes de sustituir la versión operativa. Estas órdenes parten de los datos oficiales ya admitidos en `datos/`;
no descargan ni actualizan fuentes por sí mismas.

El motor del navegador sale siempre del empaquetado (`herramientas/web/empaquetado/construccion.ts`,
`empaquetarMotor`): sus entradas son las de `tsconfig.navegador.json` y los módulos que las páginas importan por su
dirección fija, y la entrada publicada es `motor/src/plataforma/navegador/motor.js` de la web construida. esbuild
incrusta los JSON que importa el motor: el motor publicado no lleva módulos JSON, que el Worker de WebKit no carga.
El manifiesto identifica los bytes, pero la construcción no los firma.

La web local se construye en una carpeta temporal y sustituye a la anterior entera al terminar: si algo falla
(también esbuild), la anterior se conserva. La sustitución de carpetas no es una publicación atómica para lectores
concurrentes ni una recuperación frente a un corte de alimentación.

`web/` solo contiene fuentes: ni `web/motor/`, ni `web/paquete/`, ni `web/firmas/manifiesto.json`, ni
`web/service-worker.js`, ni la barrera con su huella; el marcador de versión de las páginas es `0000000000000000`.
`npm run web:comprobar` lo exige. La construcción solo admite el artefacto sin firmas: las firmas de una entrega
anterior se rechazan y no se reutilizan. Firmar y desplegar son operaciones posteriores.

## Utilidades compartidas

`npm run comunes:generar` publica las utilidades de orden, tiempo y el formato del mensaje firmado desde `src/comun/`.
También publica el validador del estado de datos del panel desde `src/administracion/estado-datos.js`, con la lectura
de la edición nueva que observa una fuente por ediciones en `src/administracion/edicion-nueva-datos.js`; el servidor y
el navegador comprueban el mismo contrato. Esos módulos privados quedan fuera de los catálogos públicos y de la caché
PWA. `npm run comunes:comprobar` comprueba sus bytes sin escribir. Las pruebas propias también detectan una publicación
desactualizada. Los lectores de datos globales y el protocolo de API conservan sus órdenes `globales:*` y `api:*`.
Modificar la fuente TypeScript y regenerar su publicación; no mantener a mano dos reglas equivalentes.

Las bibliotecas de terceros mantienen sus archivos y licencias originales. El formato editorial se aplica al
código propio; la integración comprueba sus interfaces y las huellas de los archivos incorporados.

## Catálogo de cursos

El catálogo de cursos pasa por cinco ubicaciones, de la fuente a la pantalla. `plataforma_datos/cursos/` lee cada
fuente, admite el catálogo y prepara la entrega con el contrato público de
`plataforma_datos/cursos/esquemas/entrega_catalogo.json`; su publicación (`publicar_catalogo.py`, descrita en
[`PUBLICACION.md`](../plataforma_datos/cursos/PUBLICACION.md)) escribe la entrega en
`web/datos/catalogo-cursos/<sha256>.json` y su referencia (ruta, huella, bytes y revisión) en
`web/scripts/catalogo-cursos/referencia.js`. `src/catalogo-cursos/` es el [lector](../src/catalogo-cursos/README.md) de
ese contrato: comprueba los bytes contra la referencia y devuelve una instantánea congelada.
`node herramientas/web/catalogo-cursos.ts` empaqueta su entrada pública, `src/catalogo-cursos/publico.ts`, en
`web/recursos/catalogo-cursos/lector.js`, un archivo generado que no se edita; `npm run web:comprobar` comprueba que
está al día con su fuente. `web/scripts/catalogo-cursos/` es la página `web/cursos.html`: carga la entrega con ese lector y su
referencia, y pinta filtros y fichas; el recorrido usa el mismo lector en el plan de formación. Fuera de esa cadena,
`herramientas/catalogo-cursos/firmas-editoriales.ts` mantiene las guardas editoriales de
`src/catalogo-cursos/clasificacion-revisada.json` a partir de la instantánea pública fijada en
`pruebas/fixtures/catalogo-clasificacion-20261025.utf8`.
La construcción captura una vez los bytes de esa revisión y de
`src/catalogo-cursos/materias-revisadas.json`: el evaluador empaquetado y el diagnóstico
usan la misma instantánea, y las dos huellas del diagnóstico identifican exactamente esos
bytes. El diagnóstico distingue materia, nivel y contenido pendiente o cambiado; sus
motivos indican por qué no se aplica una revisión, sin alterar el catálogo público.

## Biblioteca

`plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json` es la fuente editorial de la Biblioteca;
`datos/lecturas.json` es su entrega admitida, idéntica byte a byte. Los textos en castellano y catalán, referencias
y segmentos se editan en la fuente, junto a su procedencia. El [productor de
lecturas](../plataforma_datos/biblioteca/fuentes/lecturas/README.md)
comprueba el catálogo, su huella y sus contratos antes de exportarlo. No editar directamente la entrega.
Las observaciones de enlaces se admiten por separado en `datos/observaciones-lecturas.json`. La construcción
proyecta sus decisiones por enlace e idioma sin publicar el registro técnico. Una consulta inconcluyente no cierra
una lectura; solo una evidencia concluyente desactiva el enlace. El navegador retira la marca de comprobación
cuando vence, conservando la ficha editorial. El [contrato de
observaciones](../src/biblioteca/observaciones-lecturas.md)
detalla la política y las secuencias de recuperación.

Una vez exportadas las entradas admitidas, regenerar su presentación:

```sh
npm run lecturas:generar
npm run lecturas:comprobar
npm run web:preparar
npm run verificar
```

El generador valida la estructura y las referencias antes de escribir. Actualiza la sección delimitada de
`web/biblioteca.html` y `web/idiomas/{es,ca}/lecturas.js`; el resto de la página se mantiene. La comprobación no
escribe. Los tres segmentos se leen como pestañas (`web/scripts/etapas.js`, variante «segmentos») y los filtros de
nivel y tipo se ejecutan en el navegador; sin JavaScript, todas las lecturas permanecen visibles.
El catálogo no forma parte del paquete ocupacional. Su contrato admite fichas PDF locales en `web/fichas/`,
pero el catálogo vigente no enlaza ninguna. Esta orden no reconstruye PDF ni descarga documentos externos.

## Datos globales y globo

Las páginas `datos-globales.html`, `datos-globales-ue.html` y `datos-globales-mundo.html` leen la publicación
`web/datos/datos-globales.json`, generada desde `datos/globales/datos-globales.json`. `globales:generar` actualiza
la publicación y sus lectores compartidos; `globales:comprobar` detecta diferencias sin escribir. Después de
regenerar, ejecutar `web:preparar` (el motor empaqueta `src/datos-globales/`) y `verificar` para
comprobar también integridad y copia sin conexión.

Las fichas, tablas y gráficos utilizan esos datos locales. `globo:generar -- --originales <carpeta>` reconstruye
los recursos cartográficos desde los originales identificados; requiere ffmpeg y no descarga archivos.
La entrega operativa los conserva en `var/actualizacion/originales/globo/`, con los tres nombres que
comprueba el generador. Desde la raíz de una copia de construcción:

```sh
npm run globo:generar -- --originales var/actualizacion/originales/globo
```

Estos originales no se sirven al navegador ni forman parte de la actualización periódica de fuentes.
Conservar su procedencia y contrastar los recursos generados: cambiar ffmpeg, Biome o su configuración
puede cambiar los bytes derivados. Después se preparan y comprueban los artefactos de la web.
El globo usa WebGL y los
[recursos con procedencia documentada](../web/recursos/globo/README.md) del mismo origen. Si WebGL no está
disponible, la selección de países y sus fichas permanecen operativas. Cerrar el globo retira sus escuchas y recursos;
cambiar de país retira las escuchas de los gráficos de la ficha anterior.

## Controles de la web

`web/idiomas/` contiene los textos de interfaz de castellano y catalán. `web/scripts/sitio.js` espera la carga del
idioma antes de iniciar los controles comunes: menú, tema, selección de idioma e instalación.
Antes de iniciar los módulos de página se consulta la disponibilidad pública de secciones; el buscador combina
esa política con su filtro local sin enviar los términos escritos al servidor.

La instalación coordina las versiones entre pestañas; una pestaña con trabajo pendiente conserva su contenido
y pide confirmación antes de recargar. «Borrar todo» conserva la configuración de la entidad, elimina los recursos
propios del navegador y espera los intentos de borrado antes de volver al inicio. Un fallo se comunica sin acreditar
que se haya completado la eliminación, mediante un aviso en la consola. Las pruebas de estos contratos usan almacenes y
documentos simulados; no sustituyen la comprobación de la PWA completa en navegadores.

Las herramientas de `herramientas/web/` leen el inventario permitido por `.assetsignore`, comprueban referencias,
restricciones de contenido y huellas SRI/CSP. Las huellas se calculan sobre los recursos de esta instalación y los
bytes del motor que se publica. Los recursos generados se comprueban desde sus fuentes y manifiestos; el `CATALOGO` del
service worker y los mapas de las páginas deben regenerarse al cambiar sus dependencias.

## Mapas de integridad y copia sin conexión

Las páginas fuente de la raíz de `web/` no llevan mapa de módulos, `integrity` ni `crossorigin`: la construcción los
inyecta en su salida (`herramientas/web/integridad.ts`), y `web:comprobar` rechaza una fuente que los lleve. Vale para
todas las páginas, también las del panel de administración. La construcción genera también el `CATALOGO` del service
worker y el propio `service-worker.js` de la web construida, y calcula las huellas del motor con los bytes del
empaquetado, nunca con los de la salida que se comprueba. La VERSION es la huella de en qué lista va cada ruta de la
copia, de los bytes de cada archivo, del código del service worker y de las cabeceras
(`herramientas/web/version-copia.ts`): un cambio de cualquiera de ellos crea una copia nueva en el dispositivo. El
código que entra es el del service worker construido con los valores neutros de su plantilla, sin VERSION, paquete ni
`CATALOGO`, que no pueden depender de ella. Entra por sus piezas léxicas: entre dos piezas solo cuenta si hay un salto
de línea, que decide la inserción automática de «;». Un cambio de espacios o de comentarios no renueva la copia mientras
no añada ni quite un salto de línea entre dos piezas: meter un comentario `//` entre dos piezas que estaban en la misma
línea sí la renueva, porque el comentario termina en salto de línea. Lo que se escribe en el service worker es un solo
`CATALOGO`: cada ruta una vez, con su clase (`instalar`, `adorno`, `demanda`, `seccion` o `comprobado`) y su huella
SHA-256 tal como se publica (con el marcador de versión ya fijado en las páginas que lo llevan), calculada con los
mismos bytes que la VERSION. El service worker no guarda en la copia nada que no cuadre con su huella, ni al instalar,
ni al reparar, ni al guardar lo que trae la red al usarse: un archivo imprescindible de otra versión hace fallar la
instalación o la reparación sin tocar la copia; uno complementario (tipografías e imágenes) se queda fuera sin hacerla
fallar, y se vuelve a pedir a la red cuando se usa. Cada archivo de la copia, como cada archivo del paquete, se corta si
pasa 20 s sin recibir datos, ni la respuesta ni un trozo de su cuerpo: el plazo mide la falta de avance y no la
duración, y una red lenta que sigue recibiendo no se corta. Un archivo imprescindible cortado hace fallar la
instalación: se borra su copia provisional, una copia de esa misma versión que ya existiera no se toca, el navegador
descarta la versión y la vuelve a intentar en la siguiente visita. En una reparación, termina con su fallo, sin cambiar
la copia, y la página ofrece volver a intentarlo. Uno complementario cortado se queda fuera, como si no hubiera
llegado. La copia guarda el cuerpo ya descodificado, sin `content-encoding` ni `content-length`. Una huella que falta
o no cuadra hace fallar `web:comprobar`. La comprobación de la candidata
(`construirCandidata`, en `web:preparar` y en `construir`) vuelve a calcular y comprueba estructura HTML básica, CSP,
SRI y el `CATALOGO`, y vuelve a construir el service worker en sus dos pasadas: exige que el `service-worker.js`
construido sea, byte a byte, el que da `src/service-worker/` con esos valores. `npm run verificar` la ejecuta
(`construir --local`), junto con `web:comprobar` y el tipado estricto de los módulos de `src/service-worker/`.

La política de `src/plataforma/politica-cache-web.ts` es la fuente única tanto del constructor como del navegador.
API, MCP, A2A, OAuth, configuración dinámica y páginas o recursos de credenciales y administración quedan fuera
de la copia pública y van a la red. El service worker es un solo guion clásico, sin `importScripts`: la construcción
(`herramientas/web/servicio/`) empaqueta con esbuild sus módulos de `src/service-worker/`, la política clásica que da
esa fuente única y el `CATALOGO`, cada valor en su línea. Las páginas que el service worker sirve por sí mismo (sin
conexión y sin una página guardada que cuadre, una sección que no se puede comprobar, que está desactivada o cuya página
llega de otra publicación, y el portal privado sin red) salen de la construcción
(`herramientas/web/servicio/politica-del-servicio.ts`, `ESTADOS_DEL_SERVICIO`): una página bilingüe por estado, con sus
textos de los diccionarios `es` y `ca`, su estilo mínimo en línea y una CSP que solo admite ese estilo; si los
diccionarios cambian, la construcción las rehace con el service worker. Para permitir la navegación pública sin red, la
respuesta correcta de `inicio.html` debe llevar `X-Faro-Portal: publico`; los adaptadores públicos de Node y
Cloudflare la añaden. Un alojamiento estático público diferente debe configurarla expresamente. Si falta o tiene
otro valor, la navegación exige red. Los adaptadores privados deben conservar `X-Faro-Portal: privado` y nunca
emitir la marca pública; no se debe añadir la marca pública a un alojamiento protegido. Las copias anteriores sin
marca tampoco autorizan navegación sin red. Un service worker antiguo puede seguir sirviendo su copia hasta
actualizarse. Las descargas iniciadas terminan antes de limpiar una instalación
fallida; los nombres del manifiesto de datos no pueden salir de la carpeta de su paquete.

El `CATALOGO` se deriva del inventario publicado, sin incorporar el listado de una versión anterior. La versión
incluye recursos, cabeceras y política de caché. Un mapa SRI contiene datos JSON, no código ejecutable en línea;
la CSP admite exactamente su huella, también en la página aislada de alta pública. Su desafío mantiene una URL
externa cerrada, solo se carga tras una acción explícita y sus credenciales quedan fuera de la caché PWA.

El catálogo y validador de secciones proceden de `src/administracion/secciones-web.js`: se publican como módulo
compartido y dentro de la política clásica del service worker. Las entradas `seccion` del `CATALOGO` llevan la huella
del HTML final y se cotejan con esos bytes. Permite omitir páginas retiradas al instalar y admitirlas después solo si
pertenecen a esa misma versión. `secciones.json` va a la red; la última política válida se conserva en una
caché separada de las versiones de la web. Su alcance desconectado se describe en [administración](administracion.md).

La preparación escribe archivos locales; no constituye una publicación atómica ni debe ejecutarse sobre una
carpeta que esté atendiendo tráfico. Preparar y comprobar una copia antes de ofrecerla como nueva versión.
La lista `FIRMAS` permanece vacía en las fuentes: la incorporación del manifiesto y las firmas de despliegue es
un paso separado. Estas órdenes no firman ni despliegan.

## PDF local del informe

La persona imprime o guarda el mismo informe laboral de dos hojas mediante el diálogo del navegador. La composición y la
restauración de su estado temporal están descritas en [`web/scripts/pdf/README.md`](../web/scripts/pdf/README.md). Los
datos del informe no se envían a un servicio de conversión.

`npm run informe:ejemplo` reconstruye el informe público desde el caso ficticio
`herramientas/web/informe-ejemplo.json`, con los datos y el motor de esta instalación, sin consultas de red.
Conserva la navegación y los recursos de la página. Tras cambiar el caso, ejecutar esa orden y `npm run web:preparar`.
Tras cambiar el renderer (`src/presentacion/`), que también compila el motor del navegador, ejecutar esa orden,
y `npm run web:preparar`. `informe:comprobar` y las pruebas detectan un ejemplo
desactualizado sin escribirlo.

## Alcance

El [recorrido](../web/scripts/recorrido/README.md) comparte el motor, el paquete y la presentación del informe
con el servidor. El uso sin conexión requiere el service worker activo y una copia local completa y comprobada. La copia
del paquete de datos se prepara mientras la persona usa Faro: la página repite su petición cada 20 s para que el
navegador no detenga el service worker durante la descarga, y si se interrumpe (cierre de la página o del navegador)
continúa después con una reanudación por archivos: lo ya guardado y comprobado no se vuelve a bajar y un archivo que
quedó a medias se baja entero (`web/scripts/paquete-sin-conexion.js` y el service worker). El intercambio
entre dispositivos reconstruye el informe desde referencias oficiales mediante ese motor local.

Los controles de construcción no sustituyen los flujos de navegador, las comprobaciones de accesibilidad ni el
cotejo de estilos calculados. La instalación, la recuperación sin conexión y las firmas deben comprobarse sobre
los artefactos que se vayan a publicar. Un manifiesto por sí solo no acredita ninguna de ellas.

## Límites

- La publicación aún no lleva firma de despliegue: falta la raíz de confianza, y `FIRMAS` queda vacía. El esquema de
  firmas (raíz y claves diarias) no tiene documento propio; su contrato está en `web/scripts/firmas/firmas.js`.
- Los contrastes anotados en `web/estilos/tokens.css` y la igualdad entre cada `light-dark()` y su valor del bloque
  de respaldo para navegadores sin esa función no se comprueban automáticamente.
- `web:comprobar` exige la huella de cada precarga de módulos de `web/recorrido.html`, pero no que la lista esté
  completa.
- Los navegadores admitidos no están documentados; `tokens.css` cubre con su bloque de respaldo los que no tienen
  `light-dark()` (Safari anterior a 17.5).
