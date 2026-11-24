# Comprobación en navegadores

Este control utiliza los navegadores de `playwright-core` fijado en el lockfile y la construcción
real de `dist/`. No descarga datos, llama a proveedores, lee perfiles locales ni despliega.
La clave Basic de pruebas, las firmas y el SQLite de la autoridad durable son exclusivamente sintéticos. El Worker
compilado se ejecuta en Node, adaptando sus importaciones Data y bindings; esto no acredita Cloudflare ni TLS reales.

Después de instalar las dependencias del producto, preparar los motores con el CLI local de Playwright:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG=C.UTF-8 \
  ${PLAYWRIGHT_BROWSERS_PATH+"PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"} \
  node --require "$PWD/herramientas/red/identidad-http.cjs" \
  "$PWD/node_modules/playwright-core/cli.js" install chromium firefox webkit
npm run construir
npm run probar:navegadores
```

`env -i` deja fuera el resto del entorno, salvo `PLAYWRIGHT_BROWSERS_PATH` si está definida: esa variable indica
dónde se instalan los navegadores, y la verificación y los ensayos la transmiten al buscarlos, así que la instalación
tiene que usar la misma carpeta.

El preload fija únicamente la UA y las tres pistas de `config/identidad-web.json` en `http.request` y `https.request`, incluidas sus variantes
`get`. Mantiene las opciones, los callbacks y la verificación TLS. El descargador hijo de Playwright
hereda `--require`; no necesita modificar `node_modules`, usar un proxy ni heredar `NODE_OPTIONS`.
La prueba focal verifica firmas de llamada, una redirección HTTP→HTTPS, una CA sintética confiada y el
rechazo de esa misma CA cuando no se proporciona. Los dos PEM de esta carpeta son material público
de prueba generado para loopback; nunca son credenciales ni una CA de una instalación real.

En Ubuntu, los workflows de calidad y de actualización comparten el [preparador de navegadores](../../herramientas/mantenimiento/preparar-navegadores.sh),
que instala los motores que se le piden: calidad, los tres; el ciclo, solo Chromium. APT emplea la UA genérica, con
reintentos y una espera corta por conexión. El CLI oficial de Playwright instala cada motor con el perfil de cuatro
cabeceras. El preparador arranca y cierra los motores pedidos antes de registrar su caché para las pruebas del mismo job.

El comando ejecuta Chromium, Firefox y WebKit en orden. Cada uno recibe un proceso independiente con
cinco minutos de plazo, mediante el ejecutor de comprobaciones existente. Cada caso cierra sus contextos,
navegador, servidor y SQLite con `finally`; al agotar el plazo el ejecutor detiene su grupo propio.
Los servidores se abren en puertos efímeros de `127.0.0.1`; no se utiliza un servidor que ya esté abierto.
Cada motor utiliza directorios propios y temporales de aplicación y caché, incluidos los de Firefox,
que se retiran al cerrar. Las expresiones de observación son callbacks y mantienen la CSP aplicada.

Se comprueban:

- Recorrido real en castellano y catalán, desde una ocupación sintética hasta el informe y su descarga PDF. Los dos
  «Imprimir o guardar en PDF» llaman a `window.print`. En Chromium, con el medio de impresión ya recompuesto
  (`estabilizar` tras cambiar de medio), las dos hojas caben de ancho y su pie no tapa el cuerpo; en el PDF, de las
  páginas que haga falta, cada una empieza por su folio «N / total», lleva cuerpo además del pie y no baja de la letra
  aprobada, y todo el texto de la pantalla está en el papel (cotejo). La letra se mide en cada carácter visible del PDF:
  ninguno baja de 6,84 pt, aunque sean pocos (como el «de 100» del indicador), y el mensaje dice el tamaño y el texto
  que incumplen. Solo se admite el texto para lectores de pantalla, que el CSS imprime a propósito en 1 px (0,75 pt) y
  transparente: hasta 1 pt y solo con los textos de los `.solo-lectores` que se imprimen, leídos de la página en el
  medio de impresión antes de generar el PDF; cualquier otro texto a ese tamaño falla. En otra pestaña, el ejemplo publicado mide el corchete de la caída del gráfico de contratos
  en pantalla y al imprimir.
- Instalación del paquete sin conexión y apagado físico del servidor propio. Esta construcción está detrás de un portal
  (Basic): sin red, la recarga del recorrido da la página de estado de Faro con 503, su título y su enlace aprobados, y
  nada de la web guardada. La copia sin red de una instalación pública (empezar y reabrir el recorrido real) la prueban
  las del service worker (`pruebas/web-service-worker/recorrido-sin-red.test.ts`).
- Recorrido de formación (`formacion.ts`), en castellano y catalán: descripción y tarea largas; niveles, disponibilidad
  e inicio explícitos; elección de un curso de IA y otro digital con datos cotejados contra el catálogo publicado. La
  carpeta y el documento deben conservar ambos cursos, objetivo, enlaces y agenda. Se comprueban la impresión de cada
  informe en dos páginas y los dos seguidos en cuatro, contenido completo, folios, legibilidad y ausencia de recortes.
  El caso de nombres largos también debe cumplirlo. La recarga tras apagar el servidor reproduce la puerta privada;
  no demuestra el recorrido completo sin conexión en una instalación pública.
- Puerta privada: 401 anónimo y con clave incorrecta, 404 para panel, scripts y API del panel después de Basic, y 200
  para el recorrido autenticado.
- Cursos por el Worker publicado del motor (`cursos.ts`): con la página del recorrido ya abierta y sin servidor, antes de
  recargarla, un
  `GET /api/cursos` por el protocolo del Worker que arrancó la web; responde 200 con cursos, igual las dos veces, sin
  peticiones al servidor, y la página no arranca un guion sin su política de Trusted Types.
- Errores de página, excepciones DOM, promesas sin manejar, CSP aplicada y ausencia de peticiones externas del recorrido local.
  Se conserva la consola cruda; los errores del motor no se filtran para conseguir un resultado correcto.

El modo sale del destino que declara la construcción en `artefacto.json` (`modo-del-ensayo.ts`), y ninguna opción lo
cambia:

```sh
npm run probar:navegadores -- --artefacto "$PWD/dist" --salida "/ruta/nueva"
```

- Destino privado (el de `npm run construir` sin `--destino-cloudflare`): el fixture da al Worker su clave de
  pruebas y los contextos abren la puerta con el Basic sintético, solo en loopback.
- Destino oficial: se rechaza antes de lanzar ningún motor. Su Worker exige el portal de acceso general (HTTPS, sesión y
  límite de intentos con su autoridad durable), que este fixture HTTP no reproduce; esa entrega se ensaya con
  `portal-oficial-miniflare.mjs` (abajo).
- Una construcción sin destino declarado es un error: hay que volver a construirla.

El panel de administración no se sirve en la construcción privada. Su prueba en navegador real es
`panel.test.mjs`, de la batería de navegador de `npm run verificar` (suelta:
`node scripts/verificar.ts --navegador pruebas/navegadores/panel.test.mjs`): en Chromium, Firefox y WebKit, con el
servidor Node y el panel montado (`fixture-panel.ts`) sobre la web construida que se publica (`.web-local/web`, con
su SRI y sus mapas; si falta o es de otras fuentes, pide `npm run web:preparar`), sin artefacto ni Worker,
comprueba el 403 sin JWT y con uno inválido; que el ratón, Space y Enter, con el sondeo en medio, dan un solo POST sin
reintentos; la etiqueta de Biblioteca; el 409 `sesion_sustituida` y la retirada de `#secciones`; y el cierre de
Biblioteca con sus variantes de ruta (`/%62…`, `//…`, `/x/%2f../…`) y la restauración exacta de sus bytes. Llega al
apartado de Secciones con el enlace de la barra del panel.

`invitacion-portal.test.mjs` es de la batería de navegador de `npm run verificar` (suelta:
`node scripts/verificar.ts --navegador pruebas/navegadores/invitacion-portal.test.mjs`, o `node --test` tras
`npm run web:preparar`). Sirve la web construida (`.web-local/web`) tras la puerta real del portal
(`responderAccesoPortal`) y comprueba en Chromium, Firefox y WebKit la invitación del piloto: el enlace
`/inicio.html#invitacion=…` pasa la contraseña general con el fragmento intacto; la página real, con su `sitio.js` y su
`invitacion.js`, lo retira de la dirección, lo guarda solo en `sessionStorage` y pone el enlace del pie; un enlace de
socio pegado en `activar-acceso.html` llega a su activación sin que la invitación del piloto lo toque; y al responder
la encuesta en la pestaña que abre el pie, la del recorrido olvida la invitación y retira su enlace. Ninguna petición
lleva el código hasta el envío de la encuesta.

`trabajador-de-cursos.test.mjs` es de la batería de navegador de `npm run verificar` (suelta:
`node scripts/verificar.ts --navegador pruebas/navegadores/trabajador-de-cursos.test.mjs`). Comprueba en Chromium,
Firefox y WebKit lo que la web publicada no expone: que la puerta de Cursos corta un cálculo que excede su límite, que
el recorrido responde sin esperarlo, que un trabajador bloqueado o averiado se sustituye y que una referencia a datos
de otro trabajador o a un archivo indicado en los argumentos se rechaza sin tocar el trabajador. Empaqueta sus dos
entradas con el empaquetador del motor publicado (`empaquetarEntradasDelMotor`) en una web temporal, con un motor de
prueba, sin CSP ni service worker, y solo `127.0.0.1`.

`fechas.test.mjs` es de la batería de navegador de `npm run verificar` (suelta:
`node scripts/verificar.ts --navegador pruebas/navegadores/fechas.test.mjs`). Carga en Chromium, Firefox y WebKit,
desde un servidor de `127.0.0.1` que solo sirve los módulos, el de fechas de la web (`web/scripts/fechas.js`), las
cifras del recorrido (`recorrido/formato.js`) y las fechas del documento del plan (`textos-documento.js`), con la
página en inglés, en árabe de Egipto y en tailandés con calendario budista, y en la zona de Auckland. Para los doce meses, los siete días de la semana, los cambios de hora de
marzo y de octubre, la medianoche y el fin de año, en castellano y en catalán, cada formato tiene que dar en los tres
exactamente el texto escrito a mano en `pruebas/comun/fechas-esperadas.ts`, el mismo que comprueba Node en
`pruebas/comun/fechas.test.ts`. Comprueba también las cifras propias (`cifras.js`: punto de miles desde las cuatro
cifras y coma decimal, con decimales fijos o variables), que escriben todas las cifras del sitio, y las listas de
territorios (`Intl.ListFormat`), que dan el mismo texto en los tres. La hora del dispositivo se toma de sus números y
sale en la zona de la página.

`informe-impreso.test.mjs` es de la batería de navegador de `npm run verificar` (suelta:
`node scripts/verificar.ts --navegador pruebas/navegadores/informe-impreso.test.mjs`). Compone en Node el informe breve
de una oficinista con fecha posterior al 2/12/2027, en castellano y en catalán, para que la columna «Próxima fecha»
lleve sus estados más largos (las normas ya en aplicación y la próxima encuesta TIC-H como fecha prevista, que sus
filas declaran en `data-proxima`), y lo sirve desde `127.0.0.1` con las hojas de estilo que carga
`informe-ejemplo.html`. Casos: el corriente (tres tareas oficiales), el habitual más cargado (las 12 tareas que Faro
recoge de un relato, de 60 a 120 caracteres, escritas en el idioma del informe), el más largo que admite Faro (30 tareas
de 300 caracteres, estimadas por Faro, inciertas y con sus dos frases de 220 caracteres) y los que más exigen a la
estimación de `tareas-en-papel.ts` (letras anchas, palabras largas sin espacios, 30 tareas de una palabra, una mezcla
y las tareas menos expuestas de 300 letras anchas, las dos o solo la segunda).
Mide sin comparar textos. En Chromium, Firefox y WebKit, con el medio de impresión emulado: ninguna celda de «Qué
vigilar» desborda en horizontal, ninguna hoja pasa del área útil de su página (el A4 menos los márgenes de
`@page informe`, leídos de `informe-breve.css`), en pantalla están todas las tareas, la línea de papel sale solo si hay
tareas fuera y sus cifras son las filas impresas y el total (igual con las tareas menos expuestas), con las 12 tareas se imprimen al menos 2, ninguna fila
impresa puede partirse entre páginas y la hoja 2 empieza página. En Chromium, con el PDF real: exactamente 2 páginas en
todos los casos, una por hoja, y cada tarea impresa entera en una sola página. Mide también el plan de formación tal
como lo pinta la web (`crearDocumentoDelPlan`, con el plan de `pruebas/fixtures/plan-formacion.ts` y las hojas de
estilo de `recorrido.html`): sin cursos, con uno, con dos y el más largo medido (objetivo, motivos y proveedor largos,
estudio los siete días en bloques de 15 minutos y una acreditación de nombre largo). En los tres motores y en los dos
idiomas ninguna hoja pasa del área útil de `@page formacion`; en Chromium el PDF tiene una página por hoja (una sin
cursos, dos con ellos). Las medidas de cada hoja, de sus bloques y de sus filas quedan en el informe de la prueba.

**Alcance de la candidata unificada:** detrás de un portal (la construcción privada y la oficial) la autoridad se
comprueba siempre por red: sin red, cualquier navegación da la página de estado de Faro con 503, y la variante inactiva
exige además una contraseña. En una instalación pública, sin red, el recorrido real se abre desde la copia si cuadra con
su huella y su sección está abierta; las variantes de las extensiones y su modo nunca entran en la copia.

`real-privada-remoto.mjs` prepara una prueba de la candidata HTTPS con el recorrido real activo. Recibe por un conducto
privado en stdin un objeto con `origen`, `usuario`, `clave` (Basic) y `estadosPanel` (tres estados HTTP exactos
esperados para página, script y API, en ese orden); no admite credenciales por argumentos ni las escribe en archivos.
`--salida` es opcional y debe indicar una carpeta nueva; sin ella escribe en una carpeta temporal nueva del sistema.
Comprueba los tres navegadores, la autoridad real, la protección del panel administrativo, la ausencia de las dos
rutas retiradas, la entrada inaccesible sin red y dos ocupaciones ESCO, en ambos idiomas. Conserva capturas y PDF de
Chromium. Incluye formación conectada, hoja de ruta e impresión en cada motor e idioma. La ejecución y sus resultados
se consignan aparte; preparar el arnés no prueba el despliegue. Los estados del panel se indican explícitamente: 404
cerrado, o el estado de rechazo comprobado de Access. La recuperación de un estado heredado no se ejecuta sobre el
servicio remoto: se prueba de forma aislada con una autoridad y un panel simulados.

`unificado-miniflare.mjs <sha256-del-artefacto>` prepara la misma prueba integrada en loopback con el
Worker construido de `dist/` (destino privado), ASSETS, Durable Object SQLite, el Worker de cursos por el enlace
`CURSOS` y credenciales sintéticas. Comprueba antes y después la huella del artefacto, y además el panel
habilitado sin identidad Access, con una instancia separada. Se usa así, con los motores de Playwright instalados:

```sh
npm run construir -- --revision-codigo "$REVISION_CODIGO" --destino-cloudflare privado
node pruebas/navegadores/unificado-miniflare.mjs "$SHA256_ARTEFACTO"
```

Arranca workerd con `worker-miniflare.ts`, el arranque común de la construcción con la Miniflare fijada en
`package-lock.json` y los bindings de `config/cloudflare/instalaciones/wrangler.ensayo*.jsonc`: declara uno a uno el
script y cada `datos/*.json` como módulo Data (esta Miniflare rechaza `modulesRules`), marca
`routerConfig.has_user_worker` (sin él, ASSETS responde 500 porque no ve el Worker), deja `html_handling` y
`not_found_handling` en `none`, enlaza `REGISTRO_SOCIOS`, `CURSOS` y `CF_VERSION_METADATA` y, si se le pide
persistencia, la pone en `resourcePersistencePath` (la clave antigua `durableObjectsPersist` se descarta sin aviso).
Hay una diferencia con Cloudflare: `CF_VERSION_METADATA` tiene la forma de producción (`id`, `tag`, `timestamp`), pero
el `id` es aleatorio en cada arranque y la etiqueta está vacía, y `/mantenimiento/construccion` sigue exigiendo el
token OIDC de GitHub, que en local no existe; esa ruta no se ensaya aquí.
`worker-miniflare.test.ts`, en la batería de unidad de `npm run verificar`, lo comprueba sin navegador sobre una
construcción sintética con la misma forma: datos, ASSETS detrás del Worker (con `index.html`, rutas sin extensión y con
barra final que solo sirven con `none`, y sin página 404 ni SPA), `CURSOS`, `CF_VERSION_METADATA` y el objeto durable
conservado entre dos arranques. El puente traduce el origen HTTP local a
HTTPS para el Worker; no prueba TLS ni el servicio Access de Cloudflare. No ejecuta aún los escenarios
históricos completos de formación offline ni una actualización entre dos versiones de la PWA. El ensayo aislado de fragmentos QR se ejecuta aparte con `node --test pruebas/navegadores/recorrido-fragmento.test.mjs`; no acredita la transferencia completa.

El navegador y Node hablan HTTP real con `127.0.0.1`; el puente transforma exclusivamente el protocolo del objeto
`Request` que entrega al Worker compilado en HTTPS, para ejercitar la puerta. Es una simulación en Node y no acredita
TLS, el comportamiento de Basic en HTTPS real ni Cloudflare. Su complemento requiere ejecutar el Worker exacto en un
runtime compatible y comprobar la candidata desplegada. Los resultados no contienen la clave real del despliegue.

## Ensayos manuales de la entrega

Estos ensayos no forman parte de `npm run verificar` ni de `npm run probar:navegadores`. Se ejecutan a mano,
con los motores de Playwright ya instalados, cuando cambia lo que comprueban; cada uno, salvo
`arranque-bloqueado.test.mjs`, escribe su resultado, y todos terminan con salida 1 si algún motor falla. Son nueve, los
de esta sección:

1. `portal-oficial-miniflare.mjs`
2. `portal-remoto-oficial.mjs`
3. `descargas-js.mjs`
4. `modulo-alterado.mjs`
5. `copia-en-el-dispositivo.mjs`
6. `webmcp-paquete.mjs`
7. `actualizacion-sw.mjs`
8. `csp-del-panel.ts`
9. `arranque-bloqueado.test.mjs`

`presupuesto-rendimiento.mjs` (`npm run probar:presupuesto`) también se lanza a mano, pero no entra en esta cuenta:
mide en vez de aprobar o suspender un ensayo de la entrega, y se describe aparte, en «Presupuesto de rendimiento».

`portal-oficial-miniflare.mjs` ensaya en local la entrega oficial, antes de publicarla: portal de acceso,
recorrido, informe y transferencia por QR en los tres motores, con Miniflare, HTTPS en loopback (los dos PEM
sintéticos de esta carpeta) y credenciales sintéticas. Requiere la entrega construida con
`--destino-cloudflare oficial`, su `sha256Artefacto` y los dos entornos de `config/cloudflare/`, que comprueba
antes y después del ensayo. El destino debe ser una carpeta nueva:

```sh
node pruebas/navegadores/portal-oficial-miniflare.mjs "$ENTREGA" "$SHA256_ARTEFACTO" "/ruta/nueva"
```

`portal-remoto-oficial.mjs` repite el portal en los tres motores y el QR en Chromium contra la instalación de
ensayo ya publicada, y comprueba que MCP, A2A y la API de socios responden 404 y que el panel redirige a Access.
Es el único que sale de `127.0.0.1`: solo acepta el origen exacto que declara el registro de la instalación de
ensayo (`--instalacion`), nunca producción, y espera dos segundos entre sondas. Las credenciales llegan por un
conducto en stdin como `{"usuario", "clave", "claveRecorrido"}` y solo se guardan en memoria. Sin `--salida`
escribe en una carpeta temporal nueva; `--solo-qr <motor>` repite solo el QR de ese motor. El resultado indica
en `noReintentarAntesDe` cuándo se puede repetir sin agotar la cuota de intentos del portal:

```sh
node pruebas/navegadores/portal-remoto-oficial.mjs --origen "$ORIGEN_ENSAYO" --instalacion "$REGISTRO_ENSAYO" \
  --huella "$SHA256_ARTEFACTO" [--salida "/ruta/nueva"] < "$CONDUCTO_DE_CREDENCIALES"
```

Los cinco ensayos del paquete en navegador miden una construcción ya hecha (`npm run construir`), servida por
`fixture.ts` en modo privado con su Basic sintético; `verificar` no construye, por eso quedan fuera. Cada uno tiene su
orden npm, prueba Chromium, Firefox y WebKit si no se indica `--motor` y, con `--salida`, deja su JSON en esa carpeta.
Una construcción con destino oficial se sirve con el Worker privado de otra (`--worker-privado <dist>`). Chromium y
Firefox no aplican la identidad web del contexto a la descarga del service worker, y el fixture la exige: los dos la
reciben también al arrancar (`identidad-al-arrancar.ts`, que usan todos los lanzadores: `--user-agent` y
`general.useragent.override`); sin ella, Firefox no registra el service worker.

- `descargas-js.mjs` (`npm run probar:descargas-js`) cuenta en el servidor los JavaScript que descarga cada escenario
  (portada, acceso, inicio, recorrido real e informe) en una primera visita con perfil limpio, en
  direcciones distintas y en peticiones, y falla si alguna de las dos cifras supera el presupuesto de su escenario.
  El presupuesto (`presupuesto-descargas.mjs`) son las dos cifras medidas, el máximo de Chromium,
  Firefox y WebKit; un escenario sin presupuesto hace fallar la prueba antes de arrancar ningún navegador, y
  el JSON guarda el presupuesto usado. `presupuesto-descargas.test.mjs` comprueba sus valores y su comparación sin
  navegador, con las pruebas de unidad de `verificar`. La portada y la pantalla de acceso las
  responde el Worker oficial, con el mismo servidor y los mismos criterios de JavaScript que el presupuesto de
  rendimiento (`presupuesto-servidor.mjs` y `presupuesto-criterios.mjs`): con una construcción oficial (y
  `--worker-privado`), su propio `worker/worker.mjs`, comprobado; con una privada, que no lo lleva, el de las fuentes
  (`worker-oficial.ts`), y su JSON lo dice en `portadaYAcceso`.
- `modulo-alterado.mjs` (`npm run probar:modulo-alterado`) altera en memoria la entrada de la página del recorrido
  y un trozo estático, también sin su atributo `integrity`, y exige que el código añadido no se ejecute; un control
  sin integridad ni CSP tiene que ejecutarlo. Altera además un trozo del motor del dispositivo en el servidor antes
  de la primera visita (la instalación falla: el aviso de la primera visita, sin reintentos ni nada que ofrecer,
  ningún service worker activo y nada guardado; con el motor repuesto, todo funciona), en la copia ya guardada (el
  service worker responde 500, Faro ofrece «Reparar Faro» y, al pulsarlo, el recorrido funciona y siguen una marca en
  localStorage y otra en IndexedDB) y en la copia con el servidor también alterado (tras reparar, el aviso de la
  primera visita, con los datos intactos). `--caso <caso>` (repetible) prueba solo esos casos.
- `copia-en-el-dispositivo.mjs` (`npm run probar:copia-en-el-dispositivo`) altera entradas de la copia sin conexión
  del dispositivo y exige que solo se sirva lo que cuadra con su huella: con red, un script, un estilo y una sección
  alterados se reparan, y sin red dan 503, nunca los bytes alterados. Comprueba también el 503 de texto fijo con la
  página de sin conexión alterada, y la sección y la fotografía de 800 px sin red. Además ensaya el cerrojo del
  paquete con el service worker activo y el que espera (una descarga por archivo) y con la pestaña cerrada a mitad, y
  que un fallo del programa en el service worker llegue como error de red. `--mutante <nombre>` (repetible) sirve el
  service worker con un cambio mínimo en memoria, que el caso que lo cubre tiene que rechazar.
- `webmcp-paquete.mjs` (`npm run probar:webmcp-paquete`) exige que la página del recorrido registre las mismas
  herramientas WebMCP que el servidor MCP de las fuentes y que una consulta responda el mismo texto; sin contexto de
  modelo, ningún error de la página ni de WebMCP. Anota cada respuesta 404 por su dirección y solo admite las que una
  instalación privada da por diseño, declaradas por su nombre.
- `actualizacion-sw.mjs` (`npm run probar:actualizacion-sw`) sirve en el mismo origen una construcción anterior
  (`--anterior <dist>`) y después la nueva, con perfil persistente, y exige que sigan la sesión, las preferencias e
  IndexedDB, que la página quede controlada por la versión nueva y que la copia de la anterior desaparezca. Que la
  versión nueva está activada lo dice su sonda (`motor/copia-comprobada.json`, que solo responde un service worker
  activado) y no el estado del objeto de la página: en WebKit, la página que se recarga sola mientras la versión nueva
  se activa se queda con ese objeto en `activating` aunque la activación haya terminado.

```sh
npm run probar:webmcp-paquete -- --artefacto "minima=$DIST" [--motor chromium …] [--salida "/ruta/nueva"]
```

El resultado funcional y las guardias estrictas se registran por separado. Solo se reconoce un aviso
interno reproducido de WebKit en el contexto del panel: documento del mismo origen exactamente
`/administracion` o `/administracion/`, directiva `style-src-attr`, recurso `inline`, muestra
`text-overflow:inherit`, elemento `SELECT` sin atributo `style`, fuente vacía, línea entera positiva y columna 1,
y evento nativo de confianza. Se conserva en `csp` y en `cspReconocidos`, junto a la consola cruda.
La política mantiene `style-src 'self'`; `report-sample` permite distinguir la muestra sin autorizarla.
Chromium, Firefox y el recorrido conservan la guardia CSP sin excepciones.

Antes del flujo WebKit se ejecuta una prueba aislada con contextos propios y páginas mínimas, conservada
en `cspDelPanel`: el aviso nativo pasa en HTML de una línea y multilínea, conservando la posición
del elemento; los estilos explícitos fallan, incluidos un `P` con la
misma muestra y un `SELECT` con atributo `style`. Puede repetirse aisladamente:

```sh
node pruebas/navegadores/csp-del-panel.ts
```

Si los flujos pueden continuar, se completan para conservar su evidencia, y cualquier guardia fallida
mantiene la salida 1 del control. Los resultados locales no sustituyen la ejecución real de CI/Linux
ni permiten anunciar todos los motores como aprobados.

`arranque-bloqueado.test.mjs` (`npm run probar:arranque-bloqueado`) recorre el primer paso del recorrido real con la
web local construida (`npm run web:preparar`) cuando el motor del dispositivo no puede arrancar, y exige el texto
aprobado «Faro no ha podido prepararse. Vuelve a intentarlo.» con su «Volver a intentarlo». En un caso, IndexedDB no
avisa al Worker de que ha guardado la clave de firma: el texto sale a los 15 s y, al soltarlo, el reintento responde
y la clave se ha guardado una sola vez. En el otro, el Worker no atiende: el texto sale a los 120 s y el reintento
responde con un Worker nuevo. Es una prueba de `node:test`, pero no entra en la batería de navegador de
`npm run verificar`: sus esperas no caben en su plazo total de 600 s. `scripts/pruebas-mjs.ts` la declara como
ensayo con esta orden, y `verificar` falla si la orden falta. El servidor local, las carpetas y el navegador de cada
caso son recursos del caso (`recursos-del-caso.mjs`): se cierran aunque el caso venza. Dura unos 140 s por motor
(medido en Chromium), unos 7 minutos con los tres. No escribe ningún archivo de resultado: informa por la salida
estándar, con el informe de `node:test`, caso por caso y motor por motor. En WebKit necesita el HOME habitual, con su
llavero: con un HOME aislado sin llavero, el `put` real de la clave se bloquea antes de que la prueba pueda avisar.
Con un HOME aislado para los demás motores, WebKit se ejecuta aparte:

```sh
npm run probar:arranque-bloqueado -- --motor chromium --motor firefox   # HOME aislado admitido
npm run probar:arranque-bloqueado -- --motor webkit                     # con el HOME habitual
```

Los resultados se crean por defecto en una carpeta temporal nueva fuera del producto y se indica su ruta.
Para conservarlos en otro destino, utilizar `npm run probar:navegadores -- --salida "/ruta/nueva"`.
La carpeta explícita debe ser nueva. Cada motor escribe su resultado, observaciones y PDF; el resumen
general indica qué motores terminaron correctamente. Los metadatos identifican versiones reales de
Playwright, navegador, Node, plataforma, arquitectura y huella del artefacto probado.
No reutiliza informes anteriores ni omite casos por haberlos ejecutado en otra sesión.

`sin-rutas-ajenas.test.ts` comprueba que ningún guion de `pruebas/`, `herramientas/` ni `scripts/` nombra carpetas
de la máquina de quien desarrolla ni resuelve rutas por encima de la raíz del repositorio.

Estas comprobaciones usan una ventana de escritorio de 1280×900. No acreditan todos los dispositivos,
teléfonos físicos ni otros sistemas operativos. La comparación de estilos corresponde a la ejecución
conectada y sin conexión del mismo artefacto y motor; no constituye una homologación visual universal.

## Presupuesto de rendimiento

`presupuesto-rendimiento.mjs` (`npm run probar:presupuesto`) mide cada escenario de `descargas-js.mjs` (portada,
acceso, inicio, recorrido real e informe) por navegador y por condición, sin ningún techo que
falle: es la medición de la que sale el presupuesto y con la que se ensaya cada mejora contra una construcción de
referencia. Por escenario anota cuatro hitos, cada uno con su tiempo desde la navegación y lo acumulado hasta él
(peticiones llegadas al servidor y bytes de las respuestas ya terminadas):

- **Interfaz usable**: la página pintada e interactiva. En inicio, el idioma aplicado y el documento completo; en
  el recorrido real, el primer mensaje de Faro visible y el campo de texto listo para escribir; en portada, acceso e informe, su contenido visible. No
  espera al motor.
- **Primer análisis completo** (recorrido real): la primera respuesta entera del motor del dispositivo al
  primer mensaje, el hito de `descargas-js.mjs`.
- **Copia web lista**: el service worker activado (su instalación guarda la web entera, también las tipografías y
  las imágenes, antes de activarse).
- **Copia completa lista**: además, el service worker responde a la página que el paquete de datos del motor está
  guardado (`ESTADO_DEL_PAQUETE`). Las marcas de la copia las deja la página desde antes de sus propios scripts.

Además, de la visita medida y hasta que deja de haber tráfico:

- **Datos**: por respuesta, la codificación (`br`, `gzip` o ninguna), los bytes servidos y el peso sin comprimir,
  con la `accept-encoding` del navegador; por tipo de contenido (JS, JSON, HTML, CSS, fuentes, imágenes), la
  razón de compresión; la lista del texto servido sin comprimir (candidatos a mejora) y la de lo comprimido que
  conserva más del 90 % de su peso (solo se lista; no falla).
- **Peticiones** reales al servidor, direcciones distintas y repetidas, en total y por vía según `sec-fetch-dest`:
  el propio service worker (`serviceworker`), `fetch` (`empty`: la precarga y el paquete del service worker, y
  también los `fetch()` de la página, como los diccionarios) y la página con sus Workers (el resto). Aparte, el
  JavaScript con el criterio del servidor que comparte con `descargas-js.mjs` hasta el hito y la activación, que da
  la misma cifra que ese ensayo sobre la misma construcción; y, en Chromium, lo que ve el contexto con su propio
  criterio (el tipo de recurso, porque el contexto no da el destino), solo como contraste.
- **Duplicaciones**: el mismo contenido (misma huella SHA-256 sin comprimir) bajo direcciones distintas, con los
  bytes que sobran; y las direcciones pedidas más de una vez, dentro de una vía y por más de una vía.

El servidor del ensayo (`presupuesto-servidor.mjs`) se pone delante de `fixture.ts` (o del Worker oficial, en la
portada y el acceso) y sirve como lo haría el alojamiento: HTTPS con HTTP/2 y el certificado sintético de esta
carpeta; Brotli o gzip según
`accept-encoding` para los tipos de texto, con niveles de compresión al vuelo (Brotli 5, gzip 6), y el texto
publicado comprimido de antemano. La red limitada se aplica en ese servidor, igual para los tres motores: una
latencia añadida a cada respuesta y un ancho de bajada compartido por todas las respuestas (cubo de fichas, en
trozos de 16 KiB). La subida no se limita (son GET sin cuerpo).

Para que la segunda visita se mida como contra el dominio real, con la caché HTTP del navegador (las tres piezas
están en `cache-fiel.mjs`, que usan también `descargas-js.mjs` y la prueba `presupuesto-cache.test.mjs`):

- Chromium arranca con `--ignore-certificate-errors-spki-list` y la huella SPKI del certificado sintético
  (`SPKI_DEL_ENSAYO`, interna de `cache-fiel.mjs`): da el certificado por válido solo en su perfil (la opción
  exige `--user-data-dir`, que Playwright pone siempre), sin tocar la confianza del sistema, y la conexión queda sin
  error de certificado. Con `--ignore-certificate-errors` el error solo se pasa por alto: el service worker se
  registra, pero Chromium no guarda en su caché HTTP nada que llegue con error de certificado
  (`net/http/http_cache_transaction.cc`). Firefox y WebKit aceptan el certificado con `ignoreHTTPSErrors`.
- En Chromium el Basic de la construcción privada no lo dan las `httpCredentials` de Playwright, que detienen cada
  petición (`Fetch.enable` con todas las direcciones) y desactivan la caché HTTP del contexto
  (`Network.setCacheDisabled`), sino `autenticarEnChromium()`: solo detiene los documentos, que siguen sin cambios,
  y responde la credencial sintética al desafío Basic del servidor del ensayo; los demás recursos, los Workers y el
  service worker usan la que el navegador guarda para ese ámbito, como con una persona que ha escrito su clave. En
  Firefox y WebKit la dan las `httpCredentials`, que no tocan la caché.
- WebKit no tiene caché HTTP en el contexto efímero que le da Playwright (`newContext`), solo la de memoria de la
  página: lo que la página no tiene en memoria (lo pedido con `fetch()`, por ejemplo) volvería al servidor. Por eso
  cada medida de WebKit usa un perfil persistente en una carpeta nueva y vacía (`contextoConCache()`), dentro de la
  carpeta temporal del navegador, que se retira al cerrarlo: la primera visita sigue siendo la de un perfil limpio y
  la recarga sale de su caché HTTP, como en Safari.

En WebKit, el servidor del ensayo puede registrar un GET con 401 y después la misma ruta con 200. Esas peticiones
cuentan en los totales y se identifican como repeticiones de autenticación (`repeticionesDeAutenticacion` en las
cifras de `presupuesto-cifras.mjs`, columna «aut.» del resumen).

Los ensayos funcionales, de pasa o falla, no lo necesitan y siguen con `httpCredentials`: `ensayo.ts`,
`actualizacion-sw.mjs`, `webmcp-paquete.mjs`, `modulo-alterado.mjs` y `real-privada-remoto.mjs`. Ninguno cuenta
peticiones ni mide una segunda visita; además, `ensayo.ts` y `real-privada-remoto.mjs` interceptan todas las
peticiones con `route()` para cortar las de terceros, y en Chromium eso ya desactiva la caché por sí solo.

| Condición | Pantalla | Red (en el servidor) | CPU |
| --- | --- | --- | --- |
| `escritorio` | 1280×900 | sin limitar | sin limitar |
| `segunda-visita` | 1280×900 | sin limitar; se mide la recarga tras una primera visita completa | sin limitar |
| `movil-4g-lenta` | `Pixel 7` de Playwright | 1,6 Mbps de bajada y 150 ms por respuesta | Chromium 4× |
| `movil-3g` | `Pixel 7` de Playwright | 400 kbps de bajada y 400 ms por respuesta | Chromium 4× |

Las cifras de red son las de dos perfiles habituales: el perfil móvil predeterminado de Lighthouse («Slow 4G»:
150 ms de ida y vuelta, 1,6 Mbps y CPU 4× más lenta) y el «3G Slow» de WebPageTest (400 kbps y 400 ms). La
emulación móvil usa la pantalla, la densidad y la pantalla táctil del `Pixel 7` de Playwright, y `isMobile` en
Chromium y WebKit (Firefox no la admite). La identidad móvil se deriva de la del proyecto: la misma versión de
Chrome con el sistema genérico del agente reducido de Android («Linux; Android 10; K»), `sec-ch-ua-mobile: ?1` y
`sec-ch-ua-platform: "Android"`; el servidor del ensayo comprueba que cada petición llega con ella y pasa al
fixture la identidad de escritorio que exige. La CPU solo se limita en Chromium, por el protocolo de depuración
(`Emulation.setCPUThrottlingRate`), y alcanza al hilo principal de la página, no a sus Workers ni al service
worker; WebKit y Firefox no ofrecen limitación de CPU en Playwright y el resultado lo dice.

La portada y el acceso los sirve el `worker/worker.mjs` del artefacto oficial medido, con la web de ese artefacto y
variables sintéticas (`servidorOficialDe` de `presupuesto-servidor.mjs`); sin construcción oficial, esos dos
escenarios fallan con el motivo. Antes de medir se comprueba que el Worker servido es ese y no el de la fuente del
arnés ni el de otra construcción: su ruta, sus bytes frente a la huella de su `artefacto.json`, ese `artefacto.json`
frente al cargado y el mismo módulo; y al terminar, que lo que recibió el navegador en `/` y `/acceso-web` lleva la
huella que dio ese Worker (`presupuesto-worker-oficial.test.mjs`). El resto de escenarios los sirve el Worker privado
indicado para esa construcción, que tiene que ser de su misma revisión del código y su misma VERSION (el presupuesto
llama a `servible` de `paquete-comun.mjs` con `mismaRevision`, que lo rechaza si no); antes de medir cada escenario se comprueba de la misma forma que es ese Worker y
el mismo módulo con que el fixture sirve la web (`comprobarWorkerPrivado`). Cada medida dice en `servidoPor` qué la
sirvió: el destino (oficial o privado), la ruta y la huella del Worker, la huella del `artefacto.json` de su
construcción y `comprobado`; una medida solo vale con `comprobado: true`, y un fallo anterior a la comprobación deja lo
declarado con `comprobado: false`. El JSON lleva además `workers` con los dos de cada construcción (el privado, con su
revisión y su VERSION). Un Worker que no cuadra deja la medida en «fallo del arnés», con lo medido.

La prueba solo falla si el servidor del ensayo o el de arriba fallan, si alguna petición llega sin la identidad de
la condición, si la página no responde 200 o si, sin red limitada, la interfaz o el primer análisis no llegan; con
la red limitada, un hito o una copia que no terminan dentro del límite total de la condición se anotan como medida
(abajo, «Límite total y cierre»). Opciones:
`--artefacto nombre=<dist>` (repetible, con nombres distintos: la primera construcción es la referencia; todas se
preparan antes de medir ninguna), `--worker-privado nombre=<dist>` (uno por construcción oficial, con su nombre; solo
con una construcción vale `--worker-privado <dist>`),
`--motor` (repetible; sin él, los tres), `--condicion` (repetible; sin ella, las cuatro), `--escenario`
(repetible, con guiones o espacios: `recorrido-real`) y `--salida <carpeta>`, donde deja, tras cada navegador,
`presupuesto-<nombre>.json` (todas las cifras y cada petición con sus tiempos) y `presupuesto-<nombre>.md` (una
tabla por condición, escenario × navegador, con los cuatro hitos, y la revisión de compresión y duplicaciones);
con dos o más construcciones, además `presupuesto-comparacion.md`: por condición, escenario y navegador, cada cifra
de la referencia, la de la otra construcción y su diferencia (los cuatro hitos, MB servidos y sin comprimir,
peticiones y direcciones).

```sh
npm run probar:presupuesto -- --artefacto "referencia=$DIST_REFERENCIA" --artefacto "mejora=$DIST_MEJORA" \
  --worker-privado "referencia=$PRIVADO_REFERENCIA" --worker-privado "mejora=$PRIVADO_MEJORA" \
  [--condicion movil-3g …] [--escenario inicio …] [--motor chromium …] [--salida "/ruta/nueva"]
```

### Límite total y cierre

Cada escenario tiene un límite total por condición (`limiteTotalMs` de `presupuesto-condiciones.mjs`), el mismo
para todas las construcciones, que acota todas sus esperas juntas: la navegación, la interfaz, el primer análisis,
la copia, la calma del tráfico y, en la segunda visita, las dos visitas. Cada espera recibe lo que queda del límite
(el plazo por espera de la condición, `plazoMs`, solo es su techo) y termina 5 s antes de que venza, para que lo
medido quede anotado y escrito antes. Los límites:

| Condición | Límite total | Techo por espera | Por qué |
| --- | ---: | ---: | --- |
| `escritorio` | 2 min | 2 min | sin red limitada la copia completa se guarda en segundos |
| `segunda-visita` | 4 min | 2 min | son dos visitas de escritorio |
| `movil-4g-lenta` | 10 min | 20 min | 4,3 veces la copia completa medida (25,09 MB, 287 peticiones: 131,5 s en Firefox y 138,5 s en Chromium; no puede bajar de 125 s a 200 kB/s) |
| `movil-3g` | 40 min | 45 min | la bajada es la cuarta parte (50 kB/s, al menos 502 s para la misma copia): el de 4G por cuatro |

Al vencer, lo que la página aún no ha dado se deja: la medida consta con `estado: "no completada dentro del plazo"`,
los hitos sin llegar como `pendiente` y todas las cifras observadas hasta entonces (tiempos, peticiones, bytes, y
lo escrito de las respuestas aún en curso, con `enCurso`). Después, contexto, servidor del ensayo y servidor de
arriba se cierran a la vez en 15 s como mucho, y el navegador en otros 15 s: un margen de cierre fijo de 30 s
(`MARGEN_DE_CIERRE_MS` de `presupuesto-plazo.mjs`). Lo que no cierra a tiempo se dice en `cierre.sinCerrar`; si el
proceso sigue vivo al pasar límite y margen, un vigilante escribe lo medido con `cierreForzado` y termina con salida 3.

La ejecución completa tiene además su propio límite, armado al arrancar el proceso, antes de preparar nada
(`limiteDeEjecucion` de `presupuesto-plazo.mjs`): por cada construcción, la preparación (`PREPARACION_MS`, 120 s:
`servible`, `precomprimir` y lo que abran) y, por cada condición y navegador, el arranque (`ARRANQUE_MS`, 60 s), el
límite total de la condición y el cierre del escenario (15 s) por cada escenario, y el cierre del navegador (15 s).
Con un escenario por proceso (la matriz) son `limiteTotalMs` + 210 s: 330 s en escritorio, 450 s en segunda visita,
810 s en 4G lenta y 2610 s en 3G; cada escenario más en la misma sesión suma su límite y 15 s. Los límites de las
condiciones no cambian. El JSON lleva siempre la fase en curso (`fase`: `preparación <construcción>`,
`arranque <navegador> · <condición>`, `escenario <nombre>` o `cierre <navegador>`), cada documento la suya; el JSON y el
resumen, también los parciales, se escriben en un temporal de su misma carpeta y se renombran, así que un corte nunca
los deja a medias; si vence el límite de la ejecución,
escribe lo medido con `limiteDeEjecucionVencido` (fase, tiempo usado y el cierre de lo abierto, acotado por el margen
de cierre) y termina con salida 4.

Antes de cualquier salida (normal, 3, 4 o por señal) y tras cerrar cada navegador, el arnés termina con SIGKILL el
árbol de procesos que cuelga de él (los navegadores de Playwright van en su propio grupo de procesos, así que matar el
grupo del arnés no basta), y también los que vio colgar de él y quedaron huérfanos al cerrar su padre, si siguen
huérfanos y con la misma orden, con sus descendientes. Antes de matar nada lo congela: recorre el árbol con `ps` y
detiene con SIGSTOP lo nuevo, vuelta tras vuelta, hasta que una no encuentra nada (un proceso detenido no lanza hijos
ni termina, así que lo que lanzó sigue colgando de él); después termina todo lo congelado. Solo escaparía el hijo de un
proceso que terminara por sí mismo entre la toma de `ps` y su congelación. Los PID terminados constan en `limpieza`.
Salidas: 0, terminada; 1, una prueba falló; 3, cierre forzado por el vigilante de un escenario o del navegador, o
interrupción por SIGINT o SIGTERM (`cierreForzado` o `interrumpido` dicen cuál); 4, venció el límite de la ejecución
completa. Lo acreditan `presupuesto-limpieza.test.mjs` y `presupuesto-proceso.test.mjs` con procesos reales: un
navegador simulado que ignora SIGTERM, con su nieto y sus servidores, cortado en cada fase. Si un caso de
`presupuesto-proceso.test.mjs` acaba antes que su hijo, su `after` detiene al hijo, toma su árbol con `ps` y lo mata;
cuando ha leído su salida entera, termina con su grupo los procesos anotados (los `PROCESO <pid>` que dijo y los de ese
árbol, con su PID y su hora de inicio, solo si siguen siendo los mismos), que de otro modo quedarían huérfanos.

Cada medida del JSON lleva `estado` (`completa`, `no completada dentro del plazo`, `en curso` o `fallo del arnés`) y
`plazo` (`limiteTotalMs`, `techoPorEsperaMs`, `anticipacionMs`, `margenDeCierreMs`, `margenDeCierreDelEscenarioMs` y
`usadoMs`), y el documento, el apartado `plazo` con los límites de sus condiciones y los márgenes. Lo medido se
escribe en disco tras cada hito con `estado: "en curso"`: si el proceso se corta, el JSON conserva lo de hasta
entonces y ese estado lo delata (con `interrumpido` si fue por SIGINT o SIGTERM). Si la medida no vale o el ensayo
falla a mitad, se anota lo medido (o lo último anotado) con `estado: "fallo del arnés"`, `estadoAlMedir` y `fallo`.
`presupuesto-resumen.mjs` da el estado en una columna de cada tabla y de la comparación.

`presupuesto-plazo.test.mjs` lo comprueba sin navegador, con un límite de 1,5 s, el servidor del ensayo real con la
bajada limitada sirviendo una respuesta que tarda diez veces el límite y una página simulada que no completa ningún
hito: con la página y su contexto colgados, la medida termina dentro del límite más el margen sin ningún servidor
escuchando y lo dice; sin colgarse, consta «no completada dentro del plazo» con la copia web que sí llegó, la
petición en curso y lo escrito de ella; y si la medida no vale o el ensayo falla a mitad, se anotan lo medido y el
fallo (`node --test pruebas/navegadores/presupuesto-plazo.test.mjs`, con las pruebas de unidad de `verificar`).

Lo usan `presupuesto-medida.mjs` (escenarios, los cuatro hitos dentro del límite total, la segunda visita y lo
acumulado), `presupuesto-plazo.mjs` (el límite total, los estados de una medida y el cierre acotado),
`presupuesto-ejecucion.mjs` (la medida de un escenario comprobada y anotada, con su fallo si no vale),
`presupuesto-condiciones.mjs` (perfiles, identidad móvil, arranque de cada motor y contexto),
`presupuesto-servidor.mjs` (el servidor del ensayo y el del Worker oficial, que anota cada petición),
`presupuesto-criterios.mjs` (los dos criterios de JavaScript, el del servidor y el del contexto, con sus casos fijos
en `presupuesto-criterios.test.ts`), `presupuesto-cifras.mjs` (vías, compresión por tipo y duplicaciones) y
`presupuesto-resumen.mjs` (resumen en Markdown y comparación entre construcciones). `descargas-js.mjs` importa el
mismo servidor del Worker oficial y los mismos criterios, y su presupuesto por escenario de `presupuesto-descargas.mjs`.

`presupuesto-servidor-cortes.test.mjs` comprueba el servidor del ensayo con un cliente HTTP/2 real, sin navegador; la
ejecuta `verificar` con las pruebas de unidad (`node --test pruebas/navegadores/presupuesto-servidor-cortes.test.mjs`
por separado): una respuesta que el navegador corta a mitad deja de pedir turnos del enlace y de escribir trozos, y
las que siguen llegan enteras sin pasar del límite global de velocidad; cortada mientras espera su turno del enlace,
no escribe el trozo de ese turno; una respuesta leída entera se sirve completa. Un corte antes de las cabeceras,
también si después falla el servidor de arriba o se cierra la sesión entera, termina la respuesta sin dejar ninguna
promesa rechazada sin tratar, y el servidor sigue sirviendo. El servidor del Worker oficial anota cada petición con
su ruta, su método y su destino. Protege la medición con red limitada: si un corte no se detecta, la respuesta queda
sin fin y el ensayo agota el plazo en lugar de anotar el corte.

`presupuesto-cache.test.mjs` comprueba con navegador, en Chromium y Firefox, que la segunda visita del ensayo sale de
la caché HTTP (`node --test pruebas/navegadores/presupuesto-cache.test.mjs`): recorre `medir()` con un servidor de
arriba propio que, como la construcción privada, exige Basic; en la recarga, los recursos inmutables (un guion, una
imagen y unos datos pedidos con `fetch()`, que solo pueden salir de la caché HTTP y no de la de memoria de la página)
no llegan al servidor, el que se revalida con su ETag llega una vez y responde 304, y todo va por HTTP/2 con TLS.

## Desglose del análisis

El camino del análisis en el dispositivo deja en la línea temporal de cada hilo medidas User Timing
(`performance.measure`) con nombres estables, definidos en una sola fuente, `src/comun/marcas-de-tiempo.ts` (publicada
en `web/scripts/marcas-de-tiempo.js` con `npm run comunes:generar`). Solo se anotan: no cambian ningún resultado ni
ningún orden, no escriben en la consola ni se guardan con los datos de la persona, y su detalle lleva solo nombres de
archivos, rutas de la pantalla y cifras, nunca lo que ha escrito la persona. Cada hilo tiene su línea temporal: la
página lee las suyas con `performance.getEntriesByType('measure')`, y las del Worker del motor se leen en el Worker
(en Playwright, `pagina.workers()` y `evaluate`); para ponerlas en la misma escala se suma a cada una la diferencia
entre el `performance.timeOrigin` del Worker y el de la página.

| Medida | Hilo | Tramo | Detalle |
| --- | --- | --- | --- |
| `faro:pagina:espera-de-la-copia` | página | la espera a que el service worker confirme lo que necesita el primer análisis (`copia: primer-analisis`) o, para lo que pide el resto del paquete, la copia completa (`copia: completa`) (`motor-local/cliente.js`) | `copia` |
| `faro:pagina:ida-y-vuelta` | página | de mandar una petición al Worker del motor a tener su respuesta | `ruta` |
| `faro:pagina:paso` | página | un paso del recorrido entero, con la espera de la copia, los reintentos y los títulos de sus opciones | `intentos` |
| `faro:pagina:pensamiento` | página | el pensamiento de Faro, de empezar a enseñarlo a dejar ver la respuesta | `pasos` |
| `faro:worker:sonda` | Worker | la sonda del service worker | — |
| `faro:worker:firmas` | Worker | el manifiesto firmado y los archivos del motor, si la web lleva firmas | — |
| `faro:worker:importar-motor` | Worker | importar el motor compilado y leer el secreto de firma | — |
| `faro:worker:crear-motor` | Worker | crear el motor, con la lectura y la preparación de sus datos | — |
| `faro:worker:comprobar-lectura` | Worker | comparar con el manifiesto firmado una lectura del paquete | `archivo` |
| `faro:worker:calculo` | Worker | el cálculo de una petición, con la espera de un paso a los extras | `ruta` |
| `faro:worker:entrega` | Worker | leer el cuerpo de la respuesta y mandarlo a la página | `ruta` |
| `faro:datos:paquete` | Worker | una carga del paquete, del manifiesto a la última parte preparada: primero las partes del primer análisis y, con la copia completa, el resto | `partes` |
| `faro:datos:lectura` | Worker | recibir los bytes de un archivo del paquete | `archivo`, `bytes` |
| `faro:datos:huella` | Worker | la huella SHA-256 de un archivo del paquete | `archivo` |
| `faro:datos:json` | Worker | descodificar y leer su JSON | `archivo` |
| `faro:datos:preparacion` | Worker | dejar una parte como queda en memoria | `archivo` |
| `faro:motor:inicializacion` | Worker | preparar el índice de la búsqueda al arrancar y, con el resto del paquete, crear la API local | — |
| `faro:motor:preparar-extra` | Worker | preparar la tabla de vectores o el clasificador ya leídos | `archivo` |
| `faro:motor:espera-de-los-extras` | Worker | lo que un paso espera a los extras | — |

Los nombres son un contrato con las herramientas de medición: `pruebas/paquetes/marcas-de-tiempo.test.ts` comprueba
que son únicos, que están en esta tabla y que cada uno se anota en el camino, que un tramo no escribe en la consola y
que la carga del paquete da lo mismo, en el mismo orden, con la línea temporal o sin ella.

## Módulos de apoyo

Estos archivos no se ejecutan por sí solos: los importan los ensayos de esta carpeta, que son los que se lanzan
(`npm run probar:navegadores`, que arranca `ensayo.ts`, y los ensayos manuales descritos arriba).

| Archivo | Qué aporta | Lo importan |
|---|---|---|
| `artefacto.ts` | Ejecuta la construcción entregada en Node, con las importaciones de datos de Workers adaptadas, y lee su destino. | `ensayo.ts`, `fixture.ts`, `formacion.ts`, `panel.ts`, `recorrido.ts` |
| `modo-del-ensayo.ts` | El modo del ensayo según el destino de la construcción: privado con su Basic sintético; oficial o sin destino, rechazo. | `ensayo.ts`, `modo-del-ensayo.test.ts` |
| `fixture.ts` | HTTP real sobre `dist/` con el Worker privado de la construcción, su clave de pruebas y SQLite sintético; emula los bindings, no Cloudflare. | `ensayo.ts`, `formacion.ts`, `observacion.ts`, `recorrido.ts`, `privado.test.ts`, `descargas-js.mjs`, `modulo-alterado.mjs`, `webmcp-paquete.mjs`, `actualizacion-sw.mjs` |
| `paquete-comun.mjs` | Lo común de los ensayos del paquete: argumentos, arranque de cada motor con carpetas propias y el plazo común (`PLAZO_DE_ARRANQUE_MS`, que solo reexporta de `recursos-del-caso.mjs`), siempre por `arrancarConPlazo`, con `recursos` y sin ellos (el fallo de Playwright queda como causa; si no responde ni con el margen de respaldo, se terminan los procesos del arranque y se cierra el navegador que llegue tarde), cierre que no sustituye el error del cuerpo y termina el árbol del navegador si vence (con `recursos`, los de un caso de `node:test` con plazo, como `arranque-bloqueado.test.mjs` y `presupuesto-cache.test.mjs`, la carpeta y el navegador son recursos del caso, y la sesión los lleva a los perfiles de WebKit de `contextoConCache`), contexto limpio con la identidad web y el Basic sintético, instalación del service worker con plazo y mensaje en cada espera (`instalarServiceWorker`), espera del service worker activado, primer mensaje del recorrido y servicio de una construcción oficial con el Worker privado de otra. | `actualizacion-sw.mjs`, `arranque-bloqueado.test.mjs`, `bandera-catalana.test.mjs`, `cache-fiel.mjs`, `copia-en-el-dispositivo.mjs`, `descargas-js.mjs`, `instalacion-cuota.test.mjs`, `lanzar-con-plazo.test.ts`, `modulo-alterado.mjs`, `paso-a-privada.test.mjs`, `pensamiento-tarjeta.test.mjs`, `presupuesto-condiciones.mjs`, `presupuesto-medida.mjs`, `presupuesto-proceso-dobles.mjs`, `presupuesto-rendimiento.mjs`, `presupuesto-worker-oficial.test.mjs`, `recorrido-en-la-copia.test.mjs`, `webmcp-paquete.mjs` |
| `recursos-del-caso.mjs` | Recursos de un caso (servidor, navegador o perfil, procesos y carpeta) que se cierran también si el caso vence: node:test ejecuta los `after` de un caso vencido, pero no el `finally` de su cuerpo. Cada cierre tiene su plazo; si el de un navegador vence, se terminan sus procesos (los líderes de grupo, con su árbol; los demás, por su PID verificado). `cerrarSinSustituir` y `avisarDelCierre` cierran desde un `finally` sin sustituir el error del cuerpo. `conPlazo` da a cada espera un plazo menor que el del caso y un mensaje con el paso en que se quedó. `PLAZO_DE_ARRANQUE_MS` (90 s, menor que los 120 s de un caso) es el plazo común de arranque de los navegadores. `lanzarConPlazo` arranca un navegador con ese plazo, que recibe también Playwright. Si no arranca, también porque vence ese plazo, falla diciendo qué motor y en qué prueba, seguido del fallo de Playwright, que queda como causa (el `TimeoutError` de un plazo vencido trae el registro de las fases del arranque). Si Playwright no responde ni pasado `MARGEN_DE_RESPALDO_MS` (5 s más, 95 s en total), un respaldo falla con el plazo, termina, como en un cierre vencido, los procesos hijos que aparecieron durante el arranque y cierra el navegador que llegue tarde. Con los recursos del caso, el navegador se cierra aunque el caso venza; `durante` anota el arranque como paso en curso y, si el caso vence o se cancela mientras tanto, su `after` lo escribe en stderr, porque node:test solo dice que el caso venció. Si el caso vence antes que el respaldo, su `after` fija los procesos que había: los que aparezcan después ya no se atribuyen a este caso y no se terminan; una vigilancia que empiece cuando el `after` ya limpió (`conSusProcesos` o `arrancarConPlazo` con los recursos del caso) queda fija y vacía desde el principio. Después del `after`, el cuerpo de un caso vencido ya no puede abrir recursos ni empezar pasos (`abrir` y `durante` fallan sin crear nada) y un recurso que llega tarde se cierra; los dos fallos se anotan también con `avisarDelCierre`, porque node:test ya no escucha ese cuerpo. Un cierre vencido sin procesos vistos no se da por forzado: dice que no se vieron procesos que forzar (`forzarLosVistos`). `arrancarConPlazo` da el mismo respaldo a otro arranque, como el de `arrancar` (`paquete-comun.mjs`) o un perfil persistente, siempre que ese arranque lleve el mismo plazo para Playwright. | `acceso-web-vista.test.mjs`, `arranque-bloqueado.test.mjs`, `bandera-catalana.test.mjs`, `barrera-descarga.test.ts`, `cache-fiel.mjs`, `caso-colgado.mjs`, `casos-de-cierre.mjs`, `csp-del-panel.ts`, `ensayo.ts`, `fechas.test.mjs`, `fragmento-acceso.mjs`, `informe-impreso.test.mjs`, `instalacion-cuota.test.mjs`, `invitacion-portal.test.mjs`, `lanzar-con-plazo.test.ts`, `motor-empaquetado/navegador.ts`, `panel.test.mjs`, `paquete-comun.mjs`, `paso-a-privada.test.mjs`, `pensamiento-tarjeta.test.mjs`, `portada-publica.test.mjs`, `portal-oficial-miniflare.mjs`, `portal-preferencias.test.mjs`, `portal-remoto-oficial.mjs`, `presupuesto-cache.test.mjs`, `real-privada-remoto.mjs`, `recorrido-en-la-copia.test.mjs`, `recursos-del-caso.test.ts`, `remoto-formacion.mjs`, `textos-entrada.test.mjs`, `verificar-cortes.test.ts` |
| `motores-en-orden.ts` | El orden de los motores de `ensayo.ts`: un fallo no impide el siguiente; una interrupción (Ctrl+C) guarda el resumen y detiene el ensayo. | `ensayo.ts`, `motores-en-orden.test.ts` |
| `almacen.ts` | SQLite en memoria compartido por el panel Node y el binding compilado. | `fixture.ts`, `fixture-panel.ts` |
| `identidad.ts` | Identidad sintética firmada, sin Access ni claves de la instalación. | `fixture-panel.ts` |
| `fixture-panel.ts` | El panel real sobre el servidor Node y la web construida (`.web-local/web`), con identidad Access y SQLite sintéticos; sin artefacto ni Worker. | `panel.test.mjs` |
| `privado.ts` | Credencial sintética de loopback y control de la puerta privada y del panel cerrado. | `ensayo.ts`, `fixture.ts`, `privado.test.ts` |
| `observacion.ts` | Registro de errores, CSP, peticiones y consola cruda de cada página. | `ensayo.ts`, `formacion.ts`, `recorrido.ts`, `csp-del-panel.ts`, `observacion.test.ts` |
| `csp-panel.ts` | Única violación de CSP admitida: el estilo interno de SELECT en WebKit. | `observacion.ts`, `observacion.test.ts` |
| `cursos.ts` | Cursos por el protocolo del Worker publicado del motor, con la CSP, Trusted Types y la copia sin conexión reales. | `ensayo.ts` |
| `panel.ts` | Gestos nativos con el sondeo en medio, sesión única, y cierre y restauración de Biblioteca por el formulario y HTTP reales. | `panel.test.mjs` (batería de navegador de `npm run verificar`) |
| `trabajador-de-cursos.ts` | La puerta y el trabajador de Cursos con un motor de prueba: corte, recuperación, error sin atender y rechazo de referencias ajenas. | `trabajador-de-cursos.test.mjs` (batería de navegador de `npm run verificar`) |
| `recorrido.ts` | Recorrido de ocupación → tareas → informe breve → imprimir en ES/CA, también con el servidor apagado. | `ensayo.ts`, `formacion.ts`, `portal-oficial-miniflare.mjs`, `portal-remoto-oficial.mjs`, `remoto-formacion.mjs` |
| `formacion.ts` | Recorrido completo de formación en ES/CA con textos largos, hasta la propuesta de cursos. | `ensayo.ts`, `remoto-formacion.mjs` |
| `remoto-formacion.mjs` | La receta de formación del ensayo conectado, con el catálogo que sirve la candidata. | `real-privada-remoto.mjs` |
| `remoto-unificado.mjs` | Comprueba la autoridad real, las rutas retiradas y la protección del panel. | `real-privada-remoto.mjs`, `remoto-unificado.test.mjs` |
| `remoto-ayudas.mjs` | Diagnóstico de los ensayos remotos sin conservar claves, URL, cabeceras ni textos. | `portal-oficial-miniflare.mjs`, `portal-remoto-oficial.mjs`, `real-privada-remoto.mjs` y sus pruebas |
| `portal-ensayo.mjs` | Control del portal oficial sin imprimir ni conservar usuario, clave, cookie ni cuerpos. | `portal-oficial-miniflare.mjs`, `portal-remoto-oficial.mjs` |
| `portal-fixture.mjs` | Workerd local y proxy HTTPS en loopback, con certificados y datos sintéticos. | `portal-oficial-miniflare.mjs` |
| `worker-miniflare.ts` | La construcción (`worker/`, `web/` y `worker-cursos/`) en workerd con la Miniflare fijada y los bindings de `wrangler.ensayo*.jsonc`: módulos de datos uno a uno, ASSETS detrás del Worker con `html_handling` y `not_found_handling` en `none`, objeto durable SQLite con persistencia opcional, `CF_VERSION_METADATA` (id aleatorio por arranque) y enlace `CURSOS`. | `unificado-miniflare.mjs`, `portal-fixture.mjs`, `../ensayo-miniflare-privado.mjs`, `worker-miniflare.test.ts` |
| `portal-remoto-utilidades.mjs` | Lectura de la configuración solo por stdin, sin repetirla en los errores. | `portal-remoto-oficial.mjs`, `portal-remoto-utilidades.test.mjs` |
| `qr-integral.mjs` | Transferencia por QR real, con los datos solo en memoria. | `portal-oficial-miniflare.mjs`, `portal-remoto-oficial.mjs` |
| `tls-sintetico.pem`, `tls-clave-sintetica.pem` | Certificado y clave sintéticos de loopback. | `identidad-descargas.test.ts` |
