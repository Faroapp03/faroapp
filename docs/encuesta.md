# Encuesta de valoración

La encuesta es una función propia de la web de Faro: recoge, de forma anónima, la valoración de quienes usan Faro y
de las profesionales de orientación que les acompañan. Se usa por **rondas**: cada uso con un grupo es una ronda, con
sus invitaciones y sus resultados. La primera es la del piloto, «Piloto Citilab». Desde el Panel de Control se puede
**ocultar** la encuesta en la web, como cualquier sección, y volver a mostrarla cuando se quiera.

El piloto se hace a distancia con las entidades colaboradoras. Se entra al sitio con la contraseña general del
portal; cada entidad recibe por correo un paquete de enlaces de invitación y los reparte entre su gente. Cada enlace
lleva un código de un solo uso: quien participa abre el suyo, hace el recorrido y, al terminar, responde una encuesta
anónima de preguntas cerradas sin teclear nada. Las profesionales de orientación tienen su propio formulario y su
enlace lleva directamente a él. Este documento explica cómo funciona, qué garantiza y qué hay que comprobar en la
cuenta real antes de enviar los enlaces.

## Cómo funciona

1. **Crear un lote por entidad.** Quien administra pide al panel un lote de códigos de un tipo, participante o
   profesional, con entre 3 y 200 códigos y, si quiere, el nombre de la entidad a la que va (no es un dato personal; la regla
   exacta está en «El nombre del lote»); caben 50 lotes por ronda, y solo se crean en la ronda abierta. Un lote de uno o dos códigos
   dejaría ver, por su consumo, si esa persona concreta ha respondido: el panel no lo crea y responde 400
   `{"error":"lote_demasiado_pequeno","minimo":3}`. Faro genera cada código con 140 bits de azar criptográfico y lo
   devuelve **una sola vez**, en una lista barajada, con su enlace: `/inicio.html#invitacion=…` para quien participa y
   `/encuesta.html#codigo=…` para las profesionales. El servidor solo guarda la huella SHA-256 de cada código, con su
   lote y su tipo. Si la lista se pierde, esos códigos no se pueden recuperar: se crea otro lote.
2. **Enviar y repartir.** Quien administra envía a cada entidad los enlaces de su lote y la contraseña general. A la
   entidad se le pide que dé un enlace a cada persona, sin anotar cuál recibe quién, que no reenvíe un mismo enlace a
   dos personas y que borre la lista cuando los haya repartido. Esa es la mitad humana de la garantía: la entidad sabe a
   quién dio un enlace, pero nadie debe poder saber qué enlace concreto.
3. **Llegar con la invitación.** La persona abre su enlace. Si aún no ha entrado en el sitio, el portal le pide la
   contraseña general y la devuelve a la misma página con el fragmento intacto: el navegador lo conserva al seguir la
   redirección y la pantalla de acceso lo añade al volver, sin enviarlo nunca. Al cargar cualquier página del sitio, el
   código sale del fragmento y de la dirección de la pestaña y se guarda solo en el almacenamiento de esa pestaña
   (`sessionStorage`, clave `faro-invitacion`), hasta que se responde la encuesta, se pulsa «Borrar todo» o se cierra la
   pestaña. Si la persona pega su enlace en una pestaña que ya muestra esa página, el navegador solo cambia el
   fragmento sin recargar, y la invitación se recoge igual. Un código que empieza por `PART-` pero no tiene la forma
   completa sale de la dirección y se ignora sin decir nada. Los fragmentos `#invitacion=` que no empiezan por `PART-`
   (como la invitación de socio de `activar-acceso.html`) no se tocan y quedan para su página. El código no viaja al servidor con el recorrido: no va en ninguna consulta ni en ninguna
   petición. El service worker tampoco lo guarda: la clave de cada copia se forma sin consulta ni fragmento
   (`claveDeCopia`), sus avisos en la consola solo nombran esa clave y la dirección de una pestaña solo se compara con
   la raíz del sitio.
4. **Responder al terminar.** En la vista final del recorrido («Tus documentos») aparece un bloque que invita a
   responder la encuesta, con un botón que abre la encuesta en otra pestaña con el código en el fragmento
   (`encuesta.html#codigo=…`), para no perder los documentos. Mientras la invitación siga guardada, el pie de cada página
   lleva también un enlace discreto, «Encuesta del piloto», por si la persona cierra la vista final sin responder.
   Con la encuesta oculta en la web, ni la vista final ni el pie la ofrecen: el pie dice en su lugar «La encuesta no
   está disponible ahora. Tu invitación sigue guardada en esta pestaña.», y la invitación no se pierde. Al
   enviar con éxito, la invitación se olvida en esa pestaña y en las demás del sitio que la tengan, y los dos accesos
   desaparecen. Los dos accesos avisan a los lectores de pantalla de que la encuesta se abre en otra pestaña. La
   encuesta sigue admitiendo el código pegado o tecleado, por si el enlace se abre en otro dispositivo.
   Una pestaña que estaba descartada o en la caché del navegador cuando se respondió, o cuyo código se usó en otro
   dispositivo, no recibe el aviso y sigue ofreciendo la encuesta con un código ya gastado; lo mismo pasa al cerrarse la
   encuesta. Al abrirla, la persona ve el aviso «Este código no sirve: puede que esté mal escrito, que ya se haya usado
   o que la encuesta haya terminado…». La pestaña no puede saber por su cuenta que el código está gastado sin
   preguntarlo al servidor, y eso diría cuándo vuelve la persona: no se pregunta.
5. **La página de la encuesta.** Lee el código del fragmento `#` y lo retira de la dirección de la pestaña al cargar.
   Eso no borra el historial del navegador, que guarda la dirección con la que se abrió la página, ni impide que la lean
   los dos guiones propios que se ejecutan antes: `tema-inicial.js` no lee la dirección, e `idioma-inicial.js` solo la
   lee entera cuando el enlace trae un idioma (`?idioma=…`), para retirarlo conservando lo demás, y ni la guarda ni la
   envía. En un equipo compartido, la persona puede borrar después el historial o abrir el enlace en una ventana
   privada. El tipo va delante del código (`PART` o `PROF`) y decide las preguntas, que se describen en «El
   cuestionario». Las dos versiones tienen cinco preguntas cerradas, todas obligatorias y sin texto libre, y cada una
   lleva su propia entrada: qué se pregunta, cuánto se tarda (menos de dos minutos) y qué se guarda.
6. **Cerrar la ronda.** El panel cierra la ronda abierta: se borran las huellas de los códigos sin usar y ninguno
   vuelve a servir. Una ronda cerrada no admite lotes nuevos ni se vuelve a abrir, y sus recuentos quedan congelados.
   Después se puede abrir otra ronda (ver «Rondas»).
7. **Resultados.** El panel da, por lote y tipo, los códigos emitidos, consumidos y sin usar de la ronda que se
   consulta. Con la ronda cerrada, da además el identificador del cuestionario y, por cada pregunta y valor,
   «n de N (x %)», con los indicadores de cada meta del piloto. El archivo CSV lleva las mismas cifras, el número y el
   nombre de su ronda, y se llama como ella (`faro-resultados-piloto-citilab.csv`). «Cómo se leen los resultados»
   explica cada cifra. Los resultados de cada ronda se pueden consultar y descargar siempre.

Los recuentos no se pueden leer con la ronda abierta: comparar dos lecturas seguidas permitiría ver qué ha sumado
una respuesta concreta, por ejemplo la de alguien que acaba de responder delante de quien administra.

## Visible u oculta en la web

La encuesta es una sección pública más (`encuesta` en `src/administracion/secciones-web.js`, con la página
`/encuesta.html`) y se gobierna con el mismo mecanismo que las demás: la autoridad de secciones del servidor, su
proyección pública (`secciones-v3.json`), el service worker y la copia sin conexión. Su interruptor, «Visible en la
web», está en el apartado «Encuesta» del Panel de Control (`web/administracion/vista-encuesta-visibilidad.js`), junto
al estado de la ronda, y pide confirmación como cualquier cambio de secciones. Por defecto está visible, también en
las instalaciones que guardaban una política de secciones anterior a la encuesta.

Oculta:

- `/encuesta.html` responde como cualquier sección cerrada, en el servidor y en la copia sin conexión, y la página
  dice «La encuesta no está disponible ahora. Tu enlace sigue valiendo: vuelve a abrirlo más adelante para responder.»
  Ese es también el aviso que ve una profesional que abre su enlace (`/encuesta.html#codigo=…`).
- Quien participa llega con su invitación a `/inicio.html`, que no es de la encuesta y sigue abierta: el código se
  guarda en la pestaña como siempre. El recorrido no ofrece la encuesta al terminar y el pie dice que no está
  disponible ahora.
- Ocultar no toca el almacén: ningún código se borra ni se consume. Al volver a mostrarla, el mismo enlace vale.

Ocultar la encuesta no cierra la ronda. Cerrar la ronda, en cambio, sí deja sin valor los códigos sin usar.

## Rondas

Cada ronda tiene su número, su nombre (texto llano de 1 a 60 caracteres, con la misma regla que el nombre de un lote),
el día en que se abrió, el día en que se cerró y sus propios lotes y recuentos. Las reglas:

- **Una abierta a la vez.** Solo se abre una ronda nueva cuando no hay ninguna abierta (409 `ronda_abierta`); la base
  lo garantiza además con un índice único sobre las rondas abiertas. Caben 20 rondas (409 `limite_rondas`).
- **Cerrar congela.** Al cerrar una ronda se borran las huellas que quedan, así que sus recuentos ya no pueden cambiar.
  Abrir la siguiente crea sus propias celdas a cero sin tocar las de las anteriores.
- **Los días los pone el servidor.** Al abrir y al cerrar, el servidor anota el día (AAAA-MM-DD, en UTC), nunca la hora;
  el panel no puede fecharlos. Son decisiones de quien administra, no momentos de ninguna respuesta.
- **La primera ronda.** Una encuesta nueva empieza con la ronda «Piloto Citilab» abierta. Una encuesta guardada antes
  de las rondas pasa entera a esa ronda, abierta o cerrada como estaba, con sus lotes, sus códigos sin usar y sus
  recuentos exactos; sus días quedan «Sin dato», porque esos esquemas no los guardaban.

## El cuestionario

El cuestionario vigente es `faro-piloto-2` (`src/encuesta/cuestionario.ts`). Todas las escalas son la misma, de cinco
puntos y con todas las etiquetas escritas: 1 Nada, 2 Poco, 3 Algo, 4 Bastante y 5 Mucho (en catalán, Gens, Poc, Una
mica, Força y Molt). Cada opción enseña su número y su nombre, y el lector de pantalla lee los dos («4, Bastante»).

| Tipo | Clave | Pregunta | Valores |
| --- | --- | --- | --- |
| Personas | `informe` | ¿Has podido ver tu informe de Faro? | `visto`, `sin_ver` |
| Personas | `ocupacion` | ¿La ocupación que aparece en tu informe se corresponde con tu trabajo? | `si`, `en_parte`, `no` |
| Personas | `comprension` | ¿Cuánto te ha ayudado tu informe a entender cómo puede cambiar la IA las tareas de tu trabajo? | 1 a 5 |
| Personas | `formacion` | ¿Cuánto te ha ayudado Faro a decidir qué formación buscar? | 1 a 5 o `sin_ver` («No he llegado a ver la propuesta de formación») |
| Personas | `dificultad` | ¿Qué parte te ha costado más? | `describir_trabajo`, `elegir_tareas`, `entender_informe`, `encontrar_formacion`, `nada` |
| Profesionales | `ayudaOrientacion` | ¿Cuánto te ha ayudado Faro en tu trabajo de orientación con las personas que has atendido? | 1 a 5 |
| Profesionales | `explicarCambio` | ¿Cuánto te ha ayudado Faro a explicar cómo puede cambiar la IA las tareas de cada persona? | 1 a 5 |
| Profesionales | `encajeFormacion` | ¿Hasta qué punto encaja la formación que propone Faro con lo que necesitaban esas personas? | 1 a 5 |
| Profesionales | `fiabilidad` | ¿Hasta qué punto te parece fiable la información que muestra Faro? | 1 a 5 |
| Profesionales | `mejora` | ¿Qué mejorarías primero para usar Faro en tus sesiones? | `explicacion_informe`, `ocupacion`, `datos_fuentes`, `formacion`, `uso_sesion`, `accesibilidad`, `nada` |

Quien responde «No he podido llegar a verlo» en `informe` envía solo esa respuesta: las demás preguntas de las
personas se apagan y no se envían. Los puntos de la escala viajan como números enteros y cualquier otro valor como
texto; el servidor rechaza un «4» como texto o un número en una pregunta sin escala. La encuesta no tiene pregunta de
recomendación ni campos de texto libre: con pocas profesionales conocidas, el estilo o el contenido de un texto
bastarían para reconocerlas.

## Cómo se leen los resultados

Estas decisiones fijan cómo se miden las metas del piloto con lo que guarda la encuesta. El servidor calcula cada
indicador solo con los recuentos de las celdas y lo envía junto a ellos (`escala` y `meta` de cada pregunta), así que
el panel y el CSV no deciden qué respuestas cuentan ni sobre qué base:

- **Solo con la ronda cerrada.** Los recuentos de una ronda se leen una vez cerrada; mientras está abierta, el panel
  solo da los códigos emitidos, consumidos y sin usar.
- **Respuesta válida.** Es un código consumido: el servidor solo lo consume con todas las preguntas de su tipo
  respondidas con valores admitidos, o, en las personas, con «No he podido llegar a verlo». Cuenta para el objetivo de
  respuestas del piloto y se informa su total.
- **La base de las metas de las personas** son quienes respondieron `informe` = `visto`: solo ellas contestan las
  demás preguntas.
- **Ocupación.** Numerador: `si`. Denominador: la base. Meta del piloto: al menos el 90 %.
- **Comprensión.** Numerador: 4 + 5. Denominador: la base. Meta del piloto: al menos el 90 %.
- **Formación.** Numerador: 4 + 5. Denominador: la base menos quienes respondieron `sin_ver`, que se informan aparte
  con su número. Meta del piloto: al menos el 90 %.
- **Profesionales.** De cada pregunta de escala se da la media, Σ(punto × recuento) / N, con su N. La meta del piloto
  (una media de al menos 4 sobre 5) se mide en `ayudaOrientacion`; las otras tres son descriptivas. `mejora` deja el
  registro cerrado de las mejoras que priorizan: cada opción con su recuento. Los detalles se recogen en la sesión de
  devolución con las entidades al cerrar el piloto, con notas por temas, sin nombres ni entidades.
- **Cifras.** Cada porcentaje va con su numerador y su denominador, «n de N (x %)», y porcentajes y medias se
  redondean a un decimal. Las metas aparecen como referencia: el panel no cambia nada por alcanzarlas o no.
- **Cada meta por separado.** No hay tabla cruzada: cada pregunta tiene su propio recuento por valor. Después no se
  puede saber cuántas personas puntuaron con 4 o 5 la comprensión y la formación a la vez, ni ninguna otra combinación
  de respuestas de una misma persona: guardarlo exigiría conservar qué respondió cada una.
- **Cerrar es definitivo.** Una ronda cerrada no se reabre y sus códigos sin usar no vuelven a servir; las respuestas
  de un grupo nuevo van a una ronda nueva, con sus propias cifras.

### Límites de interpretación

- La muestra es pequeña y no es aleatoria: la eligen las entidades por invitación. Los resultados describen a quienes
  respondieron y no se pueden generalizar a la población trabajadora.
- Con 40 respuestas, un 90 % observado es compatible con un valor real claramente inferior: el intervalo de Wilson al
  95 % para 36 de 40 va aproximadamente del 77 % al 96 %.
- Las respuestas de las personas reflejan su percepción y la ocupación que ellas mismas confirmaron en el recorrido;
  la primera pregunta valorativa puede influir en las siguientes.
- La valoración de tres a cinco profesionales es indicativa. Con tan pocas, quien conozca el lote puede deducir
  respuestas individuales a partir de los recuentos.
- No se puede atribuir a Faro ningún efecto sobre el empleo, los ingresos ni la formación realizada después, ni
  comparar grupos por género o edad, porque no se recogen datos demográficos.

## La garantía de anonimato

En el estado vigente del almacén, una respuesta no se puede vincular a una persona porque no existe ningún dato que las
una. Las copias anteriores del almacén y la lista de códigos en claro tienen sus propios límites, descritos en
«Lo que la garantía no cubre»:

- **No hay datos de la persona.** La encuesta no pide nombre, contacto, edad, género, lugar, ocupación ni nada del
  informe, y no tiene texto libre.
- **No hay fila por respuesta.** Responder hace, en una sola transacción del almacén, tres cosas: comprueba que la
  huella del código existe, la borra y suma 1 a cada celda de sus respuestas (tipo, pregunta y valor) y al consumo de
  su lote. Lo que queda es un contador más y una huella menos, nunca una relación entre las dos.
- **No hay hora ni orden.** Ninguna tabla tiene columnas de hora, de código ni de orden. Las rondas solo guardan el día
  en que quien administra las abre y las cierra, y el almacén no lee el reloj: esos días los pone el panel. La tabla de huellas y la de
  recuentos son `WITHOUT ROWID`, con la huella o la celda como clave: tampoco hay un número de fila que crezca con cada
  inserción. El almacén recibe las huellas de un lote ordenadas por su valor, no por el orden en que se generaron, y
  la lista en claro se baraja aparte.
- **No se lee quién envía.** El punto `POST /encuesta/responder` solo lee el método, las cabeceras `content-type` y
  `content-length` y el cuerpo. No lee la dirección IP, ni otras cabeceras, ni la URL, ni los datos que Cloudflare
  añade a la petición, y no escribe nada en la consola, tampoco ante un fallo: cualquier fallo responde 503 sin
  registro, porque el error podría llevar el código y un registro con su hora uniría el código con el momento en que
  se respondió.
- **Lo borrado se sobrescribe en el servidor local.** En Node, la conexión de la encuesta usa `PRAGMA secure_delete=ON`:
  la huella de un código usado y las que se borran al cerrar se sobrescriben con ceros dentro del archivo, en lugar de
  quedar en páginas libres del archivo hasta que SQLite las reutilice. No alcanza a copias del archivo hechas antes.
- **Todos los rechazos son iguales.** Un código que no existe, uno ya usado y uno de una encuesta cerrada reciben la
  misma respuesta exacta (409, `{"error":"codigo_no_valido"}`): para el almacén son lo mismo, porque la huella de un
  código usado ya no está.
- **El código no deja rastro en la red.** Viaja en el fragmento de la dirección, que el navegador no envía al servidor;
  la página declara `no-referrer` y el envío también.

El tope de envíos es de 60 por minuto en cada instancia del Worker (o en cada servidor local), venga de quien venga,
como el del punto de avisos.
Un tope por persona exigiría leer la dirección IP, aunque fuera para convertirla en una huella rotatoria como hace el
limitador del recorrido, y este punto no la lee. Adivinar un código de 140 bits no es posible con ningún número de
intentos.

### Lo que la garantía no cubre

- **El historial de la base.** El SQLite de los objetos durables conserva 30 días de historial para recuperarlo a un
  instante. Quien tenga acceso a la cuenta puede comparar dos instantes seguidos y ver qué huella desapareció, de qué
  lote y qué celdas sumaron 1 en ese mismo cambio: une cada respuesta con su código y su lote, y con el momento en que
  se respondió. En Node pasa lo mismo con cualquier copia del archivo (Time Machine, copias de seguridad o del disco).
- **Quien creó el lote y la entidad.** La lista de enlaces en claro sale una sola vez, pero quien la recibe la tiene,
  y la entidad que los reparte puede saber a quién dio cada uno. Quien tenga a la vez la lista con sus destinatarios y acceso
  al historial puede saber qué contestó cada persona. El correo con los enlaces también los guarda: en los buzones de
  quien envía y de quien recibe.
- **Lo que se deduce por lote.** Cada lote puede llevar el nombre de su entidad, y el panel da por lote los códigos
  emitidos, consumidos y sin usar. Los recuentos de respuestas son siempre globales, nunca por lote, pero:
  - en una entidad con pocas personas, el número de consumidos ya dice cuántas han respondido;
  - si solo el lote de una entidad tiene códigos consumidos de un tipo, los recuentos globales de ese tipo son los de
    esa entidad;
  - quien mire los consumidos por lote con la encuesta abierta y sepa quién hizo el recorrido y cuándo puede saber
    quién respondió, aunque no qué respondió.
- **El enlace fuera de la pestaña.** El enlace con el código queda en el correo de quien lo envía y de quien lo recibe,
  y en el historial del navegador, tanto el de la invitación (`inicio.html#invitacion=…`) como el de la encuesta
  (`encuesta.html#codigo=…`). Retirarlo de la dirección no lo borra de ese historial.
- **Mientras no se responde.** El código guardado en la pestaña lo puede leer cualquier guion del sitio en esa pestaña,
  y quien use el dispositivo mientras está abierta. Desaparece al responder, al pulsar «Borrar todo» o al cerrar la
  pestaña; pero si el navegador recupera la pestaña cerrada o la sesión entera, recupera también su almacenamiento, y
  el código vuelve con ella hasta que se responde.

Para acotarlo (puntos 4 a 6 de «Antes de repartir los códigos»): los permisos de la cuenta y de despliegue, solo para
quien administra Faro hasta 30 días después del cierre; en Node, el archivo del almacén fuera de Time Machine y de las
copias de seguridad, y sin copias del disco, durante ese mismo plazo; y la lista de enlaces, borrada por quien
administra y por la entidad en cuanto se hayan repartido, sin anotar nunca qué enlace recibe quién.

### Lo que lo demuestra

Las pruebas de `pruebas/encuesta/anonimato.test.ts` acreditan cada punto con el objeto durable real sobre SQLite:

- el esquema tiene exactamente las columnas descritas, ninguna de hora, código u orden, y las tablas de huellas y
  recuentos no tienen `rowid`;
- al responder, la huella desaparece; después, ni el código ni su huella están en ninguna tabla, y los códigos en
  claro no llegan nunca a la base;
- el mensaje al objeto durable lleva solo huellas, ordenadas por su valor;
- un código inexistente, uno usado y uno de una encuesta cerrada reciben respuestas idénticas en estado, cabeceras y
  cuerpo;
- el punto público solo toca `method`, `headers` (`content-type` y `content-length`) y `body`, aunque la petición lleve
  IP, cookie, agente y procedencia;
- ningún camino del punto ni del almacén escribe en la consola, tampoco con el almacén averiado;
- el código de la encuesta no contiene lecturas de IP ni de cabeceras identificativas, y el almacén no usa el reloj.

`pruebas/encuesta/encuesta.test.ts` comprueba el resto: la entropía y el formato de los códigos, la validación estricta
de cada respuesta, el mínimo de tres códigos por lote, los recuentos y denominadores exactos, el cierre, los topes y el
enrutado del Worker.

`pruebas/web-recorrido-pasos/invitacion-encuesta.test.ts` comprueba la invitación en la página: sale del fragmento y de
la dirección, se guarda solo en la pestaña, se ignora sin la forma correcta, abre la encuesta desde la vista final y
desde el pie con el código en el fragmento, y se olvida al responder. `pruebas/encuesta/invitacion.test.ts` vigila que
ningún guion salvo la invitación y la vista final lea el código guardado, que no se haga ninguna petición con él y que
«Borrar todo» lo retire; `pruebas/encuesta/portal.test.ts`, que el fragmento sobrevive a la contraseña del portal sin
viajar en la entrada.

`pruebas/encuesta/servidor-node.test.ts` recorre la encuesta entera por HTTP en el servidor local de Node, con el
mismo almacén y las mismas transacciones: el panel crea el lote, el punto suma la respuesta, los rechazos son
idénticos, en la base no queda el código ni nada de quien envió (aunque la petición lleve IP y agente en sus
cabeceras) y la consola no recibe nada; tampoco queda la huella borrada en los bytes del archivo, por el borrado
seguro. Sin panel, el punto responde 503.

## Antes de repartir los códigos: comprobaciones en la cuenta real

La garantía del código se mantiene solo si el alojamiento tampoco guarda quién envía. En Cloudflare:

1. **Registros apagados.** En el Worker, Workers Logs y la observabilidad deben estar desactivados (`observability`
   ausente o `enabled: false` en la configuración desplegada) y no debe haber trabajos de Logpush para el Worker ni para
   la zona. Durante el piloto, nadie abre `wrangler tail` ni la vista de registros en vivo: mostrarían cada petición con
   su IP y su hora.
2. **Sin acceso que identifique.** `encuesta.html` y `/encuesta/responder` no pueden quedar detrás de una aplicación de
   Cloudflare Access que identifique por correo, porque Access sabría quién entra y a qué hora. Si el sitio sigue tras
   el portal, que sea con la contraseña compartida del portal, que no identifica a nadie.
3. **Sin analítica.** Web Analytics, Zaraz y cualquier script de terceros deben estar apagados para el sitio.
4. **Quién puede leer el historial.** El almacén SQLite de los objetos durables conserva 30 días de historial. Quien
   pueda desplegar código o recuperar la base en la cuenta puede comparar dos instantes y unir cada respuesta con su
   código, su lote y su hora (ver «Lo que la garantía no cubre»). Limita los permisos de la cuenta y de despliegue a
   quien administra Faro durante el piloto y hasta 30 días después del cierre, y no recuperes la base a un instante
   anterior en ese plazo.
5. **Copias en el servidor local.** Si el piloto usa el servidor de Node, excluye el archivo del almacén de Time Machine
   y de cualquier copia de seguridad hasta 30 días después del cierre, y no copies el disco en ese plazo.
6. **La lista de enlaces.** Quien crea el lote recibe los códigos en claro. Envía a cada entidad solo los enlaces de
   su lote, borra la lista y el correo enviado cuando los haya recibido, pide a la entidad que haga lo mismo al
   repartirlos y no anotéis nunca qué enlace recibe quién. Un enlace deja de servir para responder en cuanto se usa, y
   todos caducan al cerrar su ronda.
7. **Grupos pequeños.** Pasa con los dos tipos, participantes y profesionales: con uno o dos códigos consumidos, los
   recuentos son individuales; si todas las respuestas coinciden, se sabe qué contestó cada persona; y en un lote de 3
   con 3 códigos consumidos se sabe que respondieron las tres. Díselo a las personas en la invitación y no publiques
   resultados por lote, por tipo ni de ningún grupo tan pequeño que alguien pueda reconocerse.

## El nombre del lote

Quien decide es el servidor (`leerNombreLote` en `src/encuesta/contrato.ts`): un nombre que no cumple la regla no crea el
lote. El panel avisa antes con la misma regla, para que quien administra lo corrija sin esperar a la respuesta; si los
dos motores no coinciden en algún carácter (las categorías de Unicode cambian con cada versión, y `\p{Cn}` con ellas),
vale lo que diga el servidor. El nombre es `null` o un texto que cumple todo esto:

- es una cadena Unicode bien formada, sin sustitutos sueltos;
- tiene de 1 a 60 caracteres, contados como puntos de código, no como bytes;
- no empieza ni termina con espacios;
- no tiene controles (saltos de línea y tabuladores incluidos), caracteres de formato invisibles (`\p{Cf}`), sustitutos
  (`\p{Cs}`), caracteres de uso privado (`\p{Co}`), puntos sin asignar (`\p{Cn}`) ni separadores de línea o de
  párrafo (`\p{Zl}`, `\p{Zp}`);
- no tiene los rellenos que se ven en blanco aunque sean letras o símbolos: U+115F, U+1160, U+3164, U+FFA0 y U+2800;
- tiene al menos un carácter visible: una letra, una cifra, un signo de puntuación o un símbolo (`\p{L}`, `\p{N}`,
  `\p{P}`, `\p{S}`); un nombre hecho solo de marcas combinantes no vale.

Con 60 caracteres de cuatro bytes, el peor caso, «resultados» y «cerrar» con 50 lotes ocupan unos 19,5 KiB entre el
objeto durable y el Worker, y su tope es de 32 KiB (`MAX_RESPUESTA_ENCUESTA`); crear un lote de 200 envía unos 13,6 KiB,
con un tope de 16 KiB. `pruebas/encuesta/topes.test.ts` lo mide.

## Esquema y versiones

Hay dos versiones, y se comprueban por separado (`src/encuesta/esquema-sqlite.ts`):

- **El esquema**, en `encuesta_estado.version`: las columnas de las tablas. La 1 no tenía el nombre del lote, la 2 lo
  añade, la 3 guarda el cuestionario y la 4 reparte lotes y recuentos en rondas (`encuesta_rondas`, y la columna
  `ronda` en `encuesta_lotes` y `encuesta_recuentos`); la apertura pasa de la encuesta a cada ronda. Al prepararse se comprueba que cada tabla tiene exactamente las columnas de su
  versión: un esquema distinto bloquea la encuesta en vez de darse por bueno.
- **El cuestionario**, en `encuesta_estado.cuestionario`: a qué preguntas pertenecen las celdas de
  `encuesta_recuentos`. Los resultados lo llevan (`cuestionario`) y el panel solo lee los del cuestionario que conoce.

Pasar del esquema 3 al 4 con el mismo cuestionario no cambia ninguna cifra, haya respuestas o no: las tablas se
rehacen en la misma transacción y todo lo que había pasa a la ronda 1, «Piloto Citilab». Pasar desde los esquemas 1 y 2
o a otro cuestionario rehace las celdas, y eso solo se hace con la encuesta sin estrenar: ningún
código consumido y todos los recuentos a cero. Entonces se conservan los lotes y los códigos sin usar, que siguen
sirviendo con las preguntas nuevas. Con una sola respuesta, la preparación se niega con su error propio y no cambia
nada: sumar respuestas de dos cuestionarios daría resultados que no corresponden a ninguno. Faro no tiene ninguna
operación que borre respuestas.

`publico_estado.encuesta_version` sigue en 1 y solo indica que la encuesta está preparada: nació con
`CHECK(encuesta_version IN (0,1))` y esa restricción no se puede cambiar sin rehacer la tabla común. Cualquier estado
inesperado (también un resto de una migración a medias) bloquea la encuesta con su error propio, nunca con uno crudo de
SQLite. `pruebas/encuesta/migracion.test.ts` prueba los dos caminos, `pruebas/encuesta/rondas.test.ts` el paso a las
rondas con respuestas y sin perder códigos, y `pruebas/cloudflare/encuesta-workerd.test.ts`
comprueba lo mismo en el SQLite de un objeto durable real (workerd, con Miniflare y sin red).

### Pasar de un cuestionario a otro

1. **Antes de instalar la versión nueva**, con la versión de Faro que recogió las respuestas: cierra la ronda abierta desde
   el panel y descarga el CSV de resultados de cada ronda. El archivo lleva el identificador del cuestionario que las recogió.
2. **Instala la versión nueva.** Si la encuesta no tenía respuestas, pasa sola al cuestionario nuevo y conserva sus
   lotes. Si las tenía, la versión nueva no abre esa encuesta.
3. **Abre el cuestionario nuevo en una instalación nueva**, con su propia base de la encuesta, y crea allí los lotes.

Si se instaló la versión nueva sin exportar antes, las respuestas siguen intactas, porque la preparación no las toca.
El panel lo dice al consultar, cerrar o crear un lote («Esta instalación guarda respuestas de un cuestionario
anterior…»), con el error 409 `cuestionario_anterior`, y el punto público responde 503 a quien intente responder.
Para recuperarlas, vuelve a poner en marcha la versión que las recogió, cierra allí la ronda abierta, descarga el CSV de cada ronda y
sigue después desde el paso 3.

## Operaciones del panel

Todas van por `POST`, con la sesión del panel como el resto de operaciones (Access, `Origin`, `X-Faro-Panel` y
`X-Faro-Sesion`).

| Ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `/administracion/api/encuesta/abrir-ronda` | `{ "nombre": texto de 1 a 60 }` | `encuesta` con los resultados, vacíos, de la ronda nueva; 400 `nombre_invalido` o `solicitud_invalida`; 409 `ronda_abierta`, `limite_rondas` o `cuestionario_anterior` |
| `/administracion/api/encuesta/crear-lote` | `{ "tipo": "participante" \| "profesional", "cantidad": 3…200, "nombre"?: texto de 1 a 60 o null }` | `lote` (con `nombre`, texto o null) y `codigos` (`codigo`, `enlaceRelativo`: `/inicio.html#invitacion=…` o `/encuesta.html#codigo=…`); 400 `lote_demasiado_pequeno` (con `minimo`) o `solicitud_invalida`; 409 `encuesta_cerrada` (ninguna ronda abierta), `limite_lotes` o `cuestionario_anterior` |
| `/administracion/api/encuesta/cerrar` | `{}` | `encuesta` con los resultados finales de la ronda cerrada (sin ronda abierta, los de la última); 409 `cuestionario_anterior` |
| `/administracion/api/encuesta/resultados` | `{}` o `{ "ronda": número }` | `encuesta` de esa ronda o de la última: `version` (3), `ronda` y `rondas` (`numero`, `nombre`, `inicio`, `cierre`, `abierta`, `invitaciones`, `respuestas`), `cuestionario`, `abierta`, `lotes`, `totales` y, cerrada, `recuentos`, con `denominador`, `valores`, `escala` y `meta` en cada pregunta; 409 `cuestionario_anterior` |

El punto público `POST /encuesta/responder` recibe `{ "codigo": "PART-…", "respuestas": { … } }`, con las escalas como
números enteros, y responde 200 a una respuesta sumada, 409 a un código que no sirve, 400 a un cuerpo fuera de
contrato o de más de 1 KiB, 405, 415, 429 con `Retry-After` y 503 si el almacén no está disponible.

El código está en `src/encuesta/`: el cuestionario y sus metas (`cuestionario.ts`), el contrato (`contrato.ts`), los
códigos (`codigos.ts`), el esquema y su preparación (`esquema-sqlite.ts`), las rondas (`rondas-sqlite.ts`), el almacén SQLite (`almacen-sqlite.ts`), el protocolo y el cliente del objeto durable (`protocolo-durable.ts`, `cliente-durable.ts`), las
operaciones del panel (`panel-http.ts`), el punto público (`punto-publico.ts`) y sus entradas en el Worker
(`entrada-cloudflare.ts`) y en el servidor local de Node (`entrada-node.ts`, con el almacén que monta
`src/plataforma/node/administracion-almacen.ts` sobre el mismo archivo SQLite del panel). La página es `web/encuesta.html`, con `web/scripts/encuesta.js`,
`web/scripts/encuesta-fragmento.js`, `web/estilos/encuesta.css` y sus textos en `web/idiomas/es/encuesta.js` y
`web/idiomas/ca/encuesta.js`. A la persona, la privacidad de la encuesta se le explica en un solo lugar, el apartado
de datos de `web/informacion-y-creditos.html` (`#t-datos`), al que enlaza la entradilla de la página.
