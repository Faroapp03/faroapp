# Verificación del producto

- `verificar.ts` ejecuta los controles de tipos, estilo, integridad y pruebas con límites de tiempo y salida. Termina
  con el código del paso que falla (1 si el paso no terminó con código: señal, plazo o salida excesiva) y con 0 solo si
  todo pasa. `node scripts/verificar.ts --navegador <pruebas>` ejecuta pruebas sueltas de la suite de navegador con el
  mismo lanzador que la verificación completa.
- `verificar-datos.ts` (`npm run verificar:datos`) es la comprobación del ciclo diario sobre el paquete recién generado:
  los controles que leen `datos/` o `web/datos/` y las pruebas de Node y de Python que abren el paquete real o la web
  local construida con él, sin navegadores. Las elige por lo que leen, no por una lista escrita a mano. No sustituye a
  `verificar.ts`, que es la batería que exige publicar el código.
- `medir-pruebas-de-datos.ts` (`npm run verificar:datos -- --medir`) ejecuta la batería de unidad de Node y cada
  módulo Python con la traza (`traza-de-datos.ts`, precarga de Node, y `traza_datos/sitecustomize.py`, gancho de
  auditoría de Python) y escribe en `pruebas-que-leen-datos.json` qué pruebas abren lo que produce la cadena de datos.
  `pruebas/herramientas/verificar-datos.test.ts` exige que todas estén en la selección del ciclo. Las fotos del
  paquete no se miden.
- `fotos-del-paquete.ts`: una prueba que fija cifras o contenidos del paquete de una fecha es una foto. En Node registra
  sus casos con `fotoDelPaquete` (`pruebas/ayudas/foto-del-paquete.ts`), que declara la huella del catálogo y de los
  archivos de `datos/` a los que está fijada; en Python, el módulo decora su clase de casos con `@foto_del_paquete`
  (`plataforma_datos/comun/pruebas/foto_del_paquete.py`), que declara la huella del catálogo. Esa llamada es la marca:
  la comprobación del ciclo y la medición no ejecutan las fotos, y la batería completa sí; con otro paquete, cada caso
  falla diciendo cuál es el suyo y cómo regenerarla. Lo que vale con cualquier paquete va en una prueba aparte, que el
  ciclo sí ejecuta.
- `verificar-datos-variantes.ts` (`npm run verificar:datos-variantes [variante …]`) prepara, para cada paquete válido
  que no es el de hoy (`pruebas/ayudas/variantes_del_paquete.py`), una raíz propia con copias reales del producto
  (solo `node_modules` y `.venv` van enlazados) y ejecuta en ella `npm run web:preparar` y `npm run verificar:datos`
  sin el humo. Falla si la comprobación del ciclo rechaza alguna; unos dos minutos por variante. Es una orden propia,
  fuera de la batería de unidad.
- `entorno-firefox.ts` crea para cada ejecución de la suite de navegador (una vez por batería, no por caso) las
  carpetas absolutas de `MOZ_APP_DATA` y `MOZ_LOCAL_APP_DATA`, sin las que Firefox no arranca en macOS; las heredan
  todos los procesos hijos y se retiran al terminar. Un fallo de la batería conserva su código y uno de la limpieza se
  informa aparte. Del entorno heredado se retira `CFFIXED_USER_HOME`; `HOME` se conserva. Los módulos que lanzan
  navegadores por su cuenta (`fragmento-acceso.mjs`, `portal-remoto-oficial.mjs`, `portal-oficial-miniflare.mjs`,
  `real-privada-remoto.mjs`) usan `entornoParaLanzar`: reutilizan las de la batería y, fuera del verificador, crean
  unas propias del proceso que se retiran al salir. Un proceso terminado por señal deja su `faro-firefox-*` en la
  carpeta temporal; se barren, sin ninguna ejecución en curso, con
  `find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name 'faro-firefox-*' -mmin +60 -exec rm -rf {} +`.
- Variables de entorno que no se transmiten (`ejecutarPaso` en `ejecucion-del-paso.ts`): cada paso hereda el entorno de quien
  lanza salvo `NODE_TEST_CONTEXT`, el marcador interno de node:test, para que una suite hija no se crea parte de la de
  su padre, y salvo las que excluya el propio paso, que después recibe las variables que fija él (`NODE_OPTIONS` con
  las precargas, en las pruebas). La suite de unidad no transmite `FARO_CONSTRUCCION`: el motor empaquetado se omite
  siempre en ella (`OMISIONES_DE_LA_GLOBAL`) y se ejecuta aparte sobre el artefacto final, aunque quien lanza la
  tenga. La batería de navegador no transmite `VARIABLES_EXCLUIDAS` de `entorno-firefox.ts`, que contiene
  `CFFIXED_USER_HOME`: cambia el hogar que ven las bibliotecas de macOS de cada navegador, y una heredada haría
  depender la batería de la sesión de quien lanza. Además sustituye `MOZ_APP_DATA` y `MOZ_LOCAL_APP_DATA` por las
  carpetas de la batería. Los lanzamientos directos con `entornoParaLanzar` retiran las mismas variables.
  `probar-motor-empaquetado.ts` excluye las mismas `VARIABLES_EXCLUIDAS`, porque la muestra en navegador arranca
  Chromium, Firefox y WebKit, y `FARO_VARIANTES` y `FARO_NAVEGADORES`, para que una heredada no reduzca las variantes ni
  los navegadores exigidos; fija `FARO_CONSTRUCCION` con la construcción indicada. Los pasos de código (`pasosDeCodigo`) y el de Python solo retiran `NODE_TEST_CONTEXT`.
- `base-esco.ts` es la etapa «Base ESCO local», la primera de `npm run verificar` y de `npm test` (no de
  `--navegador`): exige que `var/actualizacion/validados/esco/biblioteca-esco.sqlite` sea un archivo propio de la
  instalación, no un enlace simbólico ni duro, con la huella que fija `datos/manifiesto.json`, y que su
  `validacion.json` registre esa base (`sha256_sqlite`) y la captura de
  `plataforma_datos/ocupaciones/fuentes/esco/captura.sha256` (`sha256_original`). Solo lee; si falla, remite al README
  («Base ESCO para la verificación»). Así, en la verificación, la prueba del motor de ocupaciones que la necesita nunca
  se omite.
- `ejecucion-del-paso.ts` ejecuta cada paso (`ejecutarPaso`, que `verificar.ts` reexporta con su plazo por defecto):
  sin shell, en su grupo de procesos, con plazo y salida acotada. Al cortarlo (plazo, salida excesiva o SIGINT/SIGTERM)
  informa del primer fallo, aunque después llegue otro corte; los oyentes de SIGINT/SIGTERM siguen activos hasta que
  termina la limpieza, así que una señal repetida no interrumpe la verificación a medias. Si tras la limpieza la salida
  del paso no se cierra en 1 s, la cierra y lo informa.
- `detener-arbol.ts` detiene, al cortar un paso, su árbol entero: toma la tabla de `ps` (con `LC_ALL=C`) antes de
  señalar, envía SIGTERM a los grupos y procesos del árbol (también los de otros grupos, como los navegadores), vuelve a
  recorrerlo, envía SIGKILL a lo que siga vivo, lo recorre otra vez para los tardíos y añade al fallo del paso, en líneas
  después de la primera y sin cambiar su código, cualquier superviviente, consulta fallida o señal rechazada.
  Identifica cada proceso por su PID y su hora de inicio (en Linux, la de `/proc/<pid>/stat`, que no cambia con el
  reloj; en macOS, `lstart`) y solo lo señala mientras la conserva; si cambia de grupo (como un navegador tras su
  `setsid`), su grupo nuevo entra en el árbol. Un grupo solo se señala mientras su líder no está, ha terminado o es el
  mismo proceso. Así, un PID reutilizado entre dos consultas no recibe señales, salvo en macOS si se reutiliza dentro
  del mismo segundo y en el mismo grupo (`lstart` tiene resolución de un segundo); queda además la ventana de
  milisegundos entre la última consulta y la señal, la mínima posible sin un mecanismo del sistema como `pidfd` (solo
  en Linux). La tabla no incluye el propio `ps` de la consulta. Sin hora
  estable, un proceso que conserva grupo y padre pero cambia de hora no se señala y se informa. Tampoco señala el
  proceso principal una vez recogido.
- `fallo-de-comprobacion.ts` define el fallo de un paso con su código, y `resumen-pruebas.ts` lee los resúmenes del
  reportero de Node: exige uno por cada archivo de la suite y solo las omisiones de su lista cerrada, con su número
  exacto (en la verificación general, las 12 del motor empaquetado; sin extensiones, además las de sus casos marcados).
  Hay dos listas cerradas. Con alguna extensión instalada se aplica `OMISIONES_DE_LA_GLOBAL`: las 12 de
  `pruebas/web-recorrido-integral/motor-empaquetado.test.ts`, que necesitan una construcción. Sin extensiones
  instaladas, que es el estado de la entrega (`src/plataforma/extensiones-instaladas.ts` no registra ninguna), se
  aplica `OMISIONES_SIN_EXTENSIONES`: esas 12 y 25 más, 37 en total, de casos que sin extensiones no tienen otra
  variante que probar. Son 13 en `pruebas/acceso-publico/acceso-recorrido.test.ts`, 3 en
  `pruebas/acceso-publico/acceso-recorrido-sin-sesion.test.ts`, 2 en
  `pruebas/acceso-publico/acceso-cancelacion-flujos.test.ts`, 2 en `pruebas/acceso-publico/recorrido-worker.test.ts`,
  2 en `pruebas/cloudflare/worker-oficial-selector-durable.test.ts`, 2 en
  `pruebas/herramientas/web-publicaciones.test.ts` y 1 en `pruebas/cloudflare/worker-oficial-marca-del-recorrido.test.ts`.
  Cada archivo omite exactamente los casos que le asigna la lista aplicada, y ninguno si no figura en ella: otro número
  hace fallar la verificación. La comprobación que necesita la base ESCO local no se omite: sin la base, la
  verificación falla en su etapa propia ([README](../README.md#base-esco-para-la-verificación)).
- `probar-motor-empaquetado.ts` (`npm run probar:motor-empaquetado -- <construcción>`) ejecuta
  `pruebas/web-recorrido-integral/motor-empaquetado.test.ts` sobre una construcción, con las precargas y el reportero
  de la batería, y termina con error si no aprueba exactamente 12 de 12, sin fallos ni omisiones: las tres mediciones
  del banco y la muestra en navegador (50 casos por el Worker del paquete frente al motor de las fuentes, en Chromium,
  Firefox y WebKit). Las variantes de la muestra son propias del navegador, no la simulación de personas del medidor:
  en «ruido» se sortea la opción de cada pregunta y en «sin-vectores» se retira la tabla de vectores.
- `guardar-resultado.sh DIRECTORIO_NUEVO -- ORDEN...` reserva el directorio con un `mkdir` exclusivo (si ya existe,
  termina con 73 sin ejecutar la orden), ejecuta la orden sin tubería, guarda su salida en `ejecucion.log` y su
  código en `codigo-salida.txt`, y termina con ese mismo código: así un registro en segundo plano no convierte un
  fallo en 0.
- `registro-pruebas.ts` produce el registro estructurado de las pruebas Node.
- `pruebas_python.py` descubre y ejecuta las pruebas de la plataforma de datos y rechaza una suite sin casos aprobados.
- `ensayo-sin-extension.ts` (`npm run ensayo:sin-extension -- [--extension <id>]`) ensaya la retirada de una
  extensión en una copia aparte de la instalación: borra la carpeta y la línea del registro que salen de `EXTENSIONES`,
  regenera los derivados, construye, verifica, comprueba que lo servido no nombra la extensión, recorre el real en los
  navegadores y compara la medición del motor de ocupaciones con su referencia. Sin `--extension` ensaya la única
  instalada; sin ninguna, termina con error. `--sin-navegadores` y `--sin-banco` dejan un ensayo parcial. Cada paso
  deja su registro en `informe/` y la salida es 0 solo si todo pasa. No forma parte de `npm run verificar`.
- `pruebas-mjs.ts` clasifica cada `*.test.mjs` del producto como prueba de navegador, de unidad o ensayo con orden
  propia (`ENSAYOS_CON_ORDEN`: no entra en las baterías y `verificar.ts` exige su orden `probar:*`); las de la carpeta
  de pruebas de una extensión instalada son de navegador.
- `tamano-de-archivos.json` fija el umbral de líneas de código por archivo y la lista nominal de excepciones, cada
  una con su techo y su motivo. Biome mide TypeScript y JavaScript (`biome.json`); Python lo mide
  `plataforma_datos/comun/pruebas/test_tamano_de_archivos.py`, que además comprueba que `biome.json` y la lista
  coinciden. Un archivo nuevo cabe en el umbral; una excepción no supera su techo y sale de la lista al bajar de él.

La entrada general es `npm run verificar`, desde la raíz de la instalación. `npm test` selecciona las pruebas.
Los errores, cancelaciones y omisiones se contabilizan por separado; el éxito de una fase no sustituye a las
fases restantes. La preparación de dependencias y recursos se explica en el [manual principal](../README.md).
