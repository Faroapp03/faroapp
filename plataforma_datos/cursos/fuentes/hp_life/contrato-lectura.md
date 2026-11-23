# Lector candidato de HP LIFE

Módulo: `plataforma_datos.cursos.fuentes.hp_life.lector`.

`extraer_ficha(cuerpo: bytes, captura: CapturaHpLife, *, condiciones_generales=None)`
devuelve `FichaHpLife` inmutable. `extraer_condiciones_generales` lee por separado
la FAQ española y devuelve declaraciones de alcance general. Ninguna función
hace red, descubre ficheros, consulta cuentas, importa a SQLite, admite ofertas o
activa fuentes. No hay reloj oculto. La aplicación proporciona cuerpo y metadatos.

Entradas: `html_next` exige un único `__NEXT_DATA__` completo de tipo JSON;
`json_next` exige el árbol `props.pageProps`; `curso_observado` exige el envoltorio
histórico `campos` y declara `arbol_next=False`. La FAQ admite además
`html_general_observado`. No se necesitan traducciones, datos de usuarios ni
campos de interfaz. Se validan identidad nativa, código, título, idioma y cuerpo.
Los campos opcionales conocidos tienen validación de tipo; ausencia/null queda
`None`. JSON duplicado, constantes no JSON, UTF-8 inválido y URLs incoherentes
fallan explícitamente. Un cambio de slug conserva identidad si mantiene id/idioma.

`CapturaHpLife` identifica la evidencia mediante un localizador opaco; nunca se
abre como ruta. `sha256_cuerpo` y `bytes_cuerpo` verifican los bytes suministrados.
`sha256_respuesta` identifica, si se conoce, la respuesta HTTP original y no se
sustituye por el hash del derivado. Si `original_conservado=True`, ambos hashes
deben coincidir. `completo` acredita integridad del cuerpo suministrado, no que
contenga todo el sitio ni que haya captura HTTP original conservada. `arbol_next`
solo distingue el formato de negocio frente al extracto histórico. El lector
no puede demostrar por sí mismo la exhaustividad de una selección anterior.
`recibido_utc` solo se rellena si se conoce esa recepción; `fecha_declarada_utc`
conserva la fecha atribuida al extracto anterior. Ambas exigen UTC explícito;
ninguna se convierte en la otra ni acredita vigencia actual.

El `body` HTML se conserva exactamente, incluidos párrafos y enlaces. Para las
declaraciones se conserva el texto completo de cada bloque con encabezado,
localizador y SHA del texto normalizado. Secciones explícitas de destinatarios,
requisitos, registro, precio del curso y costes de práctica se devuelven separadas; un
párrafo que declare expresamente a quién se dirige también se reconoce. No se
pretende comprender cualquier redacción: ausencia de coincidencia es desconocido,
no una negación. La FAQ aporta gratuidad, destinatario general explícito,
registro y certificación con su propia procedencia. No rellena destinatario
específico, requisitos individuales, precio de herramientas, edades ni elegibilidad.
Las instrucciones de cuenta/perfil ajenas a las secciones pertinentes se omiten.

`SelfPaced`, `Published`, `Public`, duración `00:00:00`, inicio/fin publicados y
booleanos de certificado/licencia/grupo se conservan literalmente, sin inferir
horas, disponibilidad, ediciones, coste de práctica, acreditación, niveles ni
producto/marca por título. Tampoco se exploran lecciones protegidas.

El resultado es un candidato de lectura. El adaptador posterior debe mapear
identidad/código/título/idioma/cuerpo y evidencias al contrato existente, conservar
el alcance general de las condiciones, resolver admisibilidad y usar el contrato
de catálogo para su transacción. Este módulo no constituye otro normalizador.

Contraste local de cierre: 37 identidades/códigos/títulos/idiomas y cuerpos HTML.
Solo dos entradas usan árboles completos de negocio recién capturados (143 y
431, derivados de privacidad con hash de respuesta separado). Las otras 35 usan
los cuerpos históricos observados; no son 37 capturas HTTP completas recientes.
El contraste y sus huellas se guardan fuera del producto.

Los extractos observados pueden conservar `http=None`: no se inventa un HTTP 200
para reutilizar su negocio; esta excepción exige no conservar original ni
atribuir recepción real. Las capturas Next exigen HTTP 200; un fallo conocido
no se acepta como captura válida. Esto permite leer historia sin acreditar una
comprobación de disponibilidad actual.

| Salida | Campo original del curso / alcance |
| --- | --- |
| `id_fuente`, `codigo`, `titulo`, `idioma` | `id`, `code`, `name`, `language`; id/idioma contrastados con ambas URLs |
| `cuerpo_html`, `descripcion` | `body` íntegro, `description` |
| `tipo`, `privacidad`, `estado` | `type`, `privacyLevel`, `status`, sin promoción a oferta disponible |
| `certificado`, `requiere_licencia`, `requiere_grupo` | `hasCertificate`, `requiresLicenseToEnroll`, `isGroupMembershipRequired` |
| Fechas y duración publicadas | `startDate`, `finishDate`, `duration`, sin completar fechas ni horas |
| Declaraciones del curso | Bloques explícitos de `body`; prefijo de localizador `body/` |
| Condiciones generales | FAQ `staticHelpTopics`, captura independiente; prefijo `staticHelpTopics/` |

En Next los campos del curso están bajo `props.pageProps.initialCourseData`; en
el extracto anterior bajo `campos`. Los índices `bloque[n]` cuentan aperturas de
párrafos, elementos de lista y encabezados en el HTML fuente, incluidos los
encabezados que no se devuelven. Cada declaración enlaza así al cuerpo conservado
por su captura y conserva además SHA de su propio texto. El consumidor no debe
tratar esos índices como XPath ni los textos normalizados como el HTML original.
