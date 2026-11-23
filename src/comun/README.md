# Módulos comunes

Contratos compartidos sin dependencias del dominio ni de la plataforma de ejecución.

| Archivo | Contrato |
|---|---|
| `archivo-del-paquete.ts` | JSON de Node por identidad o bytes UTF-8 del Worker: los bytes se liberan antes del análisis y el texto se conserva hasta que quien lee da la lectura por guardada (`soltarArchivoDelPaquete`), para que una lectura cortada se pueda repetir. |
| `nombres-propios.ts` | Consulta de la lista agregada del INE para reconocer posibles nombres y distinguir vocabulario profesional; el contexto decide su uso. |
| `base64url.js` | Bytes en base64url sin relleno, con alfabeto URL-safe y descodificación a un buffer propio. |
| `huella.ts` | SHA-256 síncrono de texto UTF-8 o bytes, completo o con prefijo de 16 caracteres hexadecimales. |
| `jcs.ts` | Serialización canónica de JSON para firmas: claves ordenadas por UTF-16, números finitos y Unicode válido. |
| `legible.ts` | Lista común de caracteres invisibles que no cambian lo que se lee. |
| `lista-ordenada.ts` | Conjuntos de textos con orden UTF-16 y consulta binaria; representación compacta sin separadores internos. |
| `sin-distinguir-mayusculas.ts` | Traducción acotada de expresiones sin distinción de mayúsculas, sin modificar el resto del patrón. |
| `textos-compartidos.ts` | Compartición en sitio de cadenas cortas de un árbol JSON, conservando valores e identidad del árbol. |
| `texto-buscable.js` | Comparación de títulos y nombres públicos sin mayúsculas, tildes latinas ni diferencias entre apóstrofos rectos y tipográficos; conserva el texto mostrado. |
| `texto.ts` | Normalización para comparación ASCII y lectura de listas de configuración separadas por comas. |
| `titulo-breve.js` | Formas visibles y accesibles de títulos ES/CA; abreviación únicamente cuando puede reconstruirse la pareja. |
| `categorias-moderacion.ts` | Categorías que comparten la moderación local y su política; no toma decisiones por sí solo. |
| `exclusiones-de-archivos.ts` | Patrones positivos de exclusión: rutas, directorios, `*`, `?` y `**` como tramo completo. |
| `sobre-dsse.ts` | Tipos de contenido firmado, base64 estándar con relleno y PAE de DSSE con longitudes en bytes UTF-8. |
| `idioma.ts` | Códigos admitidos `es` y `ca`, valores por defecto y guarda de entradas externas; un dato original también puede estar en inglés. |
| `orden.js` | Orden de códigos, URI y rutas por unidades UTF-16, independiente del idioma del equipo. |
| `orden-alfabetico.ts` | Orden de textos para lectura en castellano o catalán, con idioma explícito y datos de ICU de la plataforma. |
| `json.ts` | Guardas de forma para valores externos ya deserializados, sin normalización; los límites pertenecen al consumidor. |
| `tiempo.ts` | Conversiones del modelo Date y extracción del día UTC; el instante debe pertenecer a los años 0000–9999. |
| `formato.ts` | Formato visible ES/CA de números, porcentajes, listas y fechas; conserva espacios NBSP y puntuación. |
| `recorte.ts` | Recorte de citas por unidades UTF-16, sin partir palabras ni un par sustituto válido. |
| `vectores.ts` | Cuantización int8, carga de índices, normalización y búsqueda por producto escalar; conserva negativos y desempates por código. |
| `protocolo-web.ts` | Versión del contrato REST, cabeceras y límites compartidos con el navegador; su JS se genera. |
| `esquema.ts` | Validación acotada del subconjunto de JSON Schema usado en entradas; longitudes UTF-16. |
| `limites-frases.ts` | Longitud máxima común de las explicaciones del motor. |
| `version.ts` | Versión del producto, independiente de las versiones de sus contratos. |
| `entorno.ts` | Tipo de variables opcionales del entorno; no lee configuración ni el sistema. |
| `estados-http.ts` | Códigos HTTP con nombres compartidos; `as const` fija sus tipos, sin congelar el objeto en ejecución. |
| `reloj-atrasado.ts` | Error de que la fecha del dispositivo es anterior a la de los datos de Faro, distinto de un catálogo no válido; una fecha posterior no se rechaza. |
| `salida-sin-redirecciones.ts` | Petición que no sigue redirecciones y vale en workerd, en el navegador y en Node: modo `manual` y rechazo de 3xx y `opaqueredirect` con `RedireccionRechazada`. |

Los comparadores reciben cadenas del dominio; las entradas externas se validan antes de usarlos.
Las fechas se ordenan cronológicamente por texto solo con formato y zona uniformes.
Las pruebas de estos contratos están en [idioma.test.ts](../../pruebas/comun/idioma.test.ts) y
[orden.test.ts](../../pruebas/comun/orden.test.ts). Las guardas se prueban en
[json-validado.test.ts](../../pruebas/comun/json-validado.test.ts).

La configuración de `esFormaDe` declara campos propios enumerables, con claves string o numéricas.
Los símbolos se omiten en el recorrido y en el tipo inferido; esta guarda no valida la configuración.
La inferencia de tipos se comprueba con TypeScript y Node en
[json-tipos.test.ts](../../pruebas/comun/json-tipos.test.ts).

El calendario y el reloj sustituible se comprueban en [tiempo.test.ts](../../pruebas/comun/tiempo.test.ts).

Los codificadores reciben buffers o vistas de bytes válidos. Corresponde al consumidor validar entradas y acotar
su tamaño; estas utilidades no fijan topes ni validan sobres completos. Los decodificadores aceptan bits sobrantes no nulos:
`QQ` y `QR` producen los mismos bytes, como `AA==` y `AB==`. No comprueban la representación canónica.
Base64url rechaza relleno y el alfabeto estándar; `bytesDeBase64` exige el alfabeto estándar y longitud múltiplo de cuatro.
La PAE incorpora el tipo sin normalizarlo y el contenido binario sin convertirlo a texto.
Estos contratos se comprueban en [codificacion.test.ts](../../pruebas/comun/codificacion.test.ts).

SHA-256 conserva la notación de FIPS 180-4 y se contrasta con `node:crypto` en
[huella.test.ts](../../pruebas/comun/huella.test.ts). El relleno usa memoria proporcional a la entrada;
el consumidor debe acotar su tamaño. La huella corta sirve como identificador y no sustituye una firma.

Los formatos reciben listas sin huecos ni elementos indefinidos y fechas AAAA-MM-DD con mes 01–12.
Son precondiciones del consumidor; no se validan ni se sustituyen valores en estas utilidades.
`numero` usa los datos de Intl de la plataforma con idioma es-ES, agrupación de miles y decimales explícitos;
las fechas usan tablas fijas de meses.
`frase` convierte todas las partes a minúsculas, incluidas siglas y nombres propios, y sube la primera unidad UTF-16.
Estos contratos se comprueban en [formato.test.ts](../../pruebas/comun/formato.test.ts).

`recortarEnPalabras` requiere un límite entero positivo en unidades UTF-16; la elipsis cuenta dentro del límite.
Devuelve intacto el texto que cabe y, al recortar, retira blancos y los signos , ; : . del final.
Evita dividir un par sustituto válido, pero no conserva necesariamente grafemas completos ni repara Unicode inválido.
El contrato y sus límites se comprueban en [recorte.test.ts](../../pruebas/comun/recorte.test.ts).

Los vectores conservan el orden de operaciones y los redondeos Float32 del índice. Una similitud puede ser negativa
y no es una probabilidad. La carga comprueba tamaños y base64; la consulta normalizada y los límites de posición
pertenecen al llamador. Los arrays del índice se comparten y no deben modificarse tras su carga. Las pruebas
sintéticas de cálculo, errores, caché y serialización están en [vectores.test.ts](../../pruebas/formacion/vectores.test.ts).

Las utilidades de texto se comprueban en [texto-comun.test.ts](../../pruebas/comun/texto-comun.test.ts).
`ListaOrdenada` recibe cadenas ordenadas y distintas que no contienen un salto de línea; el constructor rechaza
incumplimientos. `conTextosCompartidos` recibe un árbol recién leído de JSON, sin ciclos, y no recorre clases ajenas.
`formasDeTituloBreve` reconstruye las abreviaciones producidas por el módulo; no valida cualquier notación con barras.

`sinAcentos` usa minúsculas y NFD, y retira las marcas U+0300–U+036F conservando la puntuación.
`normalizar` conserva solo letras ASCII y cifras, separadas por espacios: no translitera otros alfabetos.
Estas funciones comparan texto; no preparan texto para mostrar ni sustituyen la protección de datos personales.
`listaDeComas` retira elementos vacíos y espacios exteriores, conservando orden, duplicados y mayúsculas.
Sus contratos se comprueban en [texto-normalizado.test.ts](../../pruebas/comun/texto-normalizado.test.ts).

El intérprete de exclusiones rechaza negaciones, rangos, escapes y dobles asteriscos dentro de un nombre.
No interpreta toda la sintaxis de gitignore. El llamador proporciona rutas relativas a la raíz web con separador `/`.
Los anclajes, comodines y rechazos se comprueban en
[exclusiones-de-archivos.test.ts](../../pruebas/herramientas/exclusiones-de-archivos.test.ts).

`nombres-propios.ts` importa la lista operativa de [datos](../../datos/README.md); es el único módulo común con datos.
La normalización, la forma del archivo y su huella se comprueban en las pruebas de nombres. No decide por sí solo
si una palabra identifica a una persona. `archivo-del-paquete.ts` libera los bytes después de descodificar UTF-8
y antes de analizar JSON: un JSON defectuoso ya consumió el buffer; unos bytes UTF-8 inválidos todavía no.
El llamador guarda la primera lectura. Estos límites se comprueban en
[archivo-del-paquete.test.ts](../../pruebas/paquetes/archivo-del-paquete.test.ts).
