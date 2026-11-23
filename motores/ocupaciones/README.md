# Motor de ocupaciones

El motor que averigua la ocupación de la persona: la búsqueda de ocupaciones por lo que escribe (`src/busqueda/`) y el
recorrido de la pantalla, con sus preguntas, sus propuestas y la fusión con los vectores y el clasificador del
dispositivo (`src/recorrido/`). Vive aparte del motor de cursos (`motores/cursos/`): si uno se rompe, el otro sigue
funcionando. Está protegido: no se cambia su lógica sin autorización explícita ni sin demostrar resultados idénticos en su
banco.

## Carpetas

- `src/`: el código del motor y sus datos propios (`src/busqueda/*.json` y `src/recorrido/preguntas/atributos.json`).
  `src/index.ts` es su única entrada pública.
- `modelos/`: los cuatro modelos calibrados de la fusión (`modelo-lexico.json`, `modelo-estatico.json` y sus versiones
  sin clasificador).
- `pruebas/`: sus pruebas de Node, que recoge `scripts/verificar.ts` con las de `pruebas/`.
- `herramientas/`: `generar-atributos.ts` (escribe `atributos.json` desde los datos oficiales; `--comprobar` dice si
  está al día), `sellar.ts` (el sello, abajo) y `medir-casos.ts` con sus módulos de `medicion/` (el medidor, en
  «Cómo se mide»). Se lanzan con
  `npm run ocupaciones:atributos`, `ocupaciones:comprobar-atributos`, `ocupaciones:sellar`,
  `ocupaciones:comprobar-sello` y `ocupaciones:medir`; sus pruebas, con `npm run probar:ocupaciones`.
- `banco/`: los tres bancos del medidor, con su manifiesto, su procedencia y sus huellas
  (`banco/README.md`).
- `sello.json`: el sello.

## Entrada pública

Desde fuera del motor (`src/api`, `src/plataforma`, `herramientas`, `pruebas`) solo se importa `src/index.ts`: la
búsqueda (`prepararBuscador`, `buscarOcupaciones`, `buscarConTodo` y `buscarEnElRelato`), el paso de la
pantalla (`pasoDePantalla` y sus piezas), los vectores y el clasificador del dispositivo y la comprobación de la tabla
de atributos (`comprobarAtributos`). Dentro del motor, los archivos se importan entre sí con rutas relativas; sus
pruebas y herramientas sí pueden importar archivos internos.

Una sola excepción, de datos y no de código: la tabla de atributos (`src/recorrido/preguntas/atributos.json`, 390 KB)
la importa como JSON el motor del dispositivo (`src/plataforma/navegador/motor.ts`), que es el único que la usa. No va
en la entrada pública porque esta la importan también la API y el Worker de Cloudflare, que no la necesitan (la
construcción del Worker no admite tablas de más de 256 KB). Las pruebas y el medidor la leen del disco.

Lo que no es motor se queda en su capa: `src/plataforma/navegador/ruta-local.ts` (las peticiones de la pantalla al
Worker del dispositivo, con su forma de respuesta HTTP) es un adaptador de la plataforma y usa la entrada pública.

## API de prueba

Doce exportaciones internas solo las usan las pruebas, porque fijan una conducta que la entrada pública no deja
comprobar por separado. No forman parte de la entrada pública:

- `busqueda/puntuacion.ts`: `ConsultaParaPuntuar` y `OcupacionParaPuntuar`, los tipos de entrada de
  `puntuarFormas`, con que las pruebas fijan la puntuación de una forma aislada de la búsqueda completa.
- `recorrido/pantalla/moderacion.ts`: `categoriasLocales`, las categorías que marca el moderador local (la pantalla
  solo devuelve el aviso).
- `recorrido/pantalla/servicio.ts`: `tareasDelGrupo` y `gruposPorTareas` (el orden de las tareas por parecido, que la
  pantalla muestra recortado), `fraseDelArea` (la frase del área con su preposición, que solo se ve dentro del
  enunciado) y `PasoDePantalla`, el tipo del paso que devuelve `pasoDePantalla`.
- `recorrido/pantalla/tareas.ts`: `mismaForma`, la regla de forma común entre dos palabras.
- `recorrido/preguntas/atributos.ts`: `FUENTES_EXTERNAS` (las fuentes de las fichas que no están en atributos.json)
  y `AtributosInvalidos`, el error que lanza `comprobarAtributos`.
- `recorrido/preguntas/motor.ts`: `distribucionInicial`, la distribución de partida antes de cualquier pregunta.
- `recorrido/preguntas/preguntas.ts`: `OPCIONES_POR_PREGUNTA`, el número de opciones de cada pregunta.

## Lo que no puede importar

Nada de `motores/cursos/`, por ninguna cadena de imports, ni siquiera de tipos ni pasando por `src/`; y el motor de
cursos, nada de este. Los contratos que comparten (los tipos de los datos del paquete, el idioma) están en
`compartido/contratos/`. `pruebas/motores/motores-independientes.test.ts` lo comprueba, y también que fuera del motor solo se
importa `src/index.ts`.

Del resto de la app usa solo piezas comunes: `src/comun/`, `src/seguridad/`, `src/ia/infinitivo.ts` y, de
`src/dominio/`, los tipos del paquete (`tipos-paquete.ts`), los títulos por idioma (`datos-en-idioma.ts`) y los grupos
(`grupos.ts`). Por dentro, estos traen además `src/dominio/referencias.ts`, los tipos de
`src/dominio/tipos-acreditacion.ts` y de `compartido/contratos/`, y `src/comun/vectores.ts`, `src/comun/orden.js`,
`src/comun/orden-alfabetico.ts` y `src/comun/idioma.ts`. El cargador del paquete aplica antes las erratas de ESCO
(`src/dominio/erratas-esco.ts`): el motor no las importa, pero sus resultados dependen de ellas.

## Sus datos

Lee el núcleo del paquete (ESCO, clasificaciones, textos) y la correspondencia EURES entre ESCO y CO-SISPE, que va en
su propio archivo, `datos/correspondencia-eures.json` (la exporta la cadena de datos,
`plataforma_datos/cursos/fuentes/formacion/exportacion.py`). No lee `formacion.json`, que es solo del motor de cursos: si ese archivo
falta, está corrupto o no coincide con su huella, el paquete carga sin él y el recorrido responde igual
(`pruebas/motores/fusible-cursos-datos.test.ts` y `pruebas/motores/motores-independientes.test.ts`).

## Cómo se mide

Con el medidor del motor (`herramientas/medir-casos.ts`) y sus bancos (`banco/`, ver su
README.md): 2.112 frases y 2.473 personas simuladas, una por cada grupo válido de cada frase. Se mide con
`--traza` (todo lo que vio y respondió cada persona en cada paso) y se compara persona por persona: misma ocupación,
mismas preguntas y mismo orden. Se mide al menos sin ruido, con `--ruido personas` y con `--sin-vectores`.
La referencia está en `banco/README.md`: las huellas SHA-256 de `resultados` en las tres variantes, que acaban
en su grupo 2.473 sin ruido, 2.444 con ruido y 2.473 sin vectores. La igualdad de trayectorias no equivale a
acierto.

## El sello

`sello.json` guarda la huella SHA-256 de cada archivo de ejecución del motor (todo `src/` y `modelos/`, salvo la
documentación). `pruebas/sello.test.ts` falla si un archivo cambia, aparece o desaparece sin volver a sellar.

Se sella de nuevo solo así:

1. El cambio del motor recibe autorización explícita.
2. Se mide el banco de 2.473 personas antes y después, con la comparación persona por persona; los resultados son
   idénticos o las diferencias reciben aprobación explícita, y la evidencia se conserva fuera del paquete de producto.
3. `node motores/ocupaciones/herramientas/sellar.ts` escribe el sello nuevo, que va en el mismo commit que el cambio
   (`--comprobar` dice si está al día, sin escribir).
