# Cibervoluntarios: censo y oferta de autoformación pública

Generado de `fuente.json`; editar el descriptor y regenerar.

Productor del catálogo Cursos: recepción pública y control propios, conservación de hechos y preparación de la única SQLite compartida; la entrega final usa admisión, proyección y publicación comunes.

ID: `cibervoluntarios` · tema: `cursos` · institución: Cibervoluntarios.
Lector estático: `plataforma_datos.cursos.fuentes.cibervoluntarios.lector`. Casa de datos: `cibervoluntarios`.

## Alcance

- Exige URL de www.cibervoluntarios.org/api/public/activity_catalogs, HTTP200 declarado, captura completa, bytes y SHA coherentes, recepción UTC no anterior al intento y localizador explícito. No acredita autenticidad remota por sí sola.
- Mantiene identidad nativa del material y actividad contenedora, idioma, tipos y campos de negocio publicados. No fusiona títulos, formatos o idiomas ni inventa ediciones a partir de actividades o materiales.
- El parser puro lee una página; adquisicion verifica páginas consecutivas, total coherente e IDs únicos antes de acreditar el censo de actividades. Disponible, nivel y duración no bastan para ofrecer, ni acreditan nivel Faro, precio, plaza o admisión personal.
- El conjunto conserva portada, declaraciones estáticas, componente e idioma de la ruta española y redirección del alias Fundae con recibos independientes. El JavaScript se lee como evidencia y nunca se ejecuta.
- La aplicación actualiza el negocio propio por canal atribuido y ancla histórica exacta; conserva ID, proveedor, URL y campos ajenos. El alias Fundae mantiene íntegro su negocio e historia: la evidencia directa solo inicia una comprobación actual de la misma identidad, con origen Cibervoluntarios separado y sin otro programa. Una equivalencia de codificación URL y el título visible conservan el literal publicado.
- La oferta exige autoformación española seleccionada por el método revisado, formación declarada gratuita, destinatario compatible, requisitos y destino identificados. Excluye destinatarios familiares; una mención incidental a la familia no es exclusión. El registro previo se distingue de acceso sin cuenta. Certificados, prácticas, productos y admisión individual no se dan por gratuitos o confirmados.
- El control actual factoriza los apoyos por página y conserva cada recepción pertinente sin mezclar versiones. Los fallos, métodos distintos o identidades incompatibles retienen la comprobación anterior sin rejuvenecerla.
- Las bajas las afirma el censo completo (todas sus páginas con la forma esperada y al menos un material) y nunca uno parcial. Un material conocido que el censo trae con `erased` verdadero o con un `status` distinto de «Disponible» (por ejemplo «Descatalogado» o «Pendiente»), en él o en su actividad, deja de ofrecerse sin más consulta; la evidencia guarda el motivo (borrado, descatalogado u otro estado) y el valor literal, y vuelve cuando el censo lo trae «Disponible» y sin borrar. Uno que el censo no trae se confirma con su destino registrado (`https://e-learning.cibervoluntarios.org/course/view.php?id=N`), pedido una vez por material, sin seguir redirecciones: un 404 con la página de error de la plataforma lo retira, con las dos lecturas como evidencia; un 303 al inicio de sesión lo mantiene y la contradicción llega al panel; cualquier otra respuesta no cambia nada y avisa. Un estado que Faro no conoce (distinto de «Disponible», «Descatalogado» y «Pendiente», con esa grafía exacta) no retira nada ese día y el panel lo avisa (`estado-desconocido-en-el-catalogo`); un censo completo sin ningún material disponible tampoco da bajas. Cada destino pedido es un recurso esperado de la cobertura del día: se acredita con la página 404 de error o el 303 al inicio de sesión, y no con un destino sin confirmar. Un retirado que sigue ausente cuenta como resuelto. Las consultas a destinos las acota el número de materiales conocidos, sin tope diario propio. Un material ya retirado que sigue ausente no se vuelve a consultar mientras el registro lo tenga retirado; uno sin confirmar o con su página se pide cada día. Un material retirado que vuelve a un censo completo disponible y sin borrar se ofrece de nuevo. La página pública del curso responde igual exista o no y no se usa. El alias de Fundae sigue su camino: sin su material en el censo no se renueva y no se retira.
- Las altas incrementales usan el ID nativo y un canal inicial explícito, sin normalizador de investigación ni cifras inferidas del título. Antes de insertar exigen oferta continua acreditada; repetir la misma recepción no duplica la unidad ni crea observaciones o atribuciones nuevas.

## Recursos y condiciones de uso

- `pagina-api` (url): Censo Hydra público paginado; máximo 20 páginas de 100 actividades, con cota compartida 64 MiB por cuerpo. El total y las identidades se contrastan antes de declarar cobertura.
  Ubicación: https://www.cibervoluntarios.org/api/public/activity_catalogs. Licencia: desconocida; no acreditada por este descriptor.
- `captura` (familia): Bytes JSON Hydra y CapturaCiber aportados por el llamador, con SHA, tamaño, HTTP, inicio/recepción UTC y localizador. No se conservan cuerpos reales en Git.
  Ubicación: desconocida. Licencia: desconocida; no acreditada por este descriptor.
- `portada-autoformacion` (url): Enlaza el módulo público. Sus declaraciones de formación, Internet y registro tienen alcance general, no de admisión personal.
  Ubicación: https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo. Licencia: desconocida; no acreditada por este descriptor.
- `codigo-interfaz` (familia): Módulo principal enlazado por portada y componentes de ruta/idioma; bytes y método revisados. Sin ejecución, aulas, cuentas o login.
  Ubicación: desconocida. Licencia: desconocida; no acreditada por este descriptor.
- `destino-material` (url): Destino registrado de cada material (`moodleLink`), solo de los que el censo completo no trae. Se pide sin seguir redirecciones y con un límite de 1 MiB: 303 al inicio de sesión si el curso existe, 404 con la página de error si no existe.
  Ubicación: https://e-learning.cibervoluntarios.org/course/view.php. Licencia: desconocida; no acreditada por este descriptor.
- `alias-fundae` (url): Redirección pública para contrastar el vínculo del material 10059786850 con la identidad admitida fundae:1:3462, sin duplicación ni cambio de proveedor.
  Ubicación: https://ciber.be/introduccion-ecommerce. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `entrada-local` (local): Parser puro de capturas históricas; el canal remoto usa la operación común declarada y conserva su propia recepción.
  Recursos: pagina-api, captura. Autenticación: La lectura de capturas locales no usa credenciales ni acredita una consulta nueva.
  - No abre archivos, consulta red ni reloj; el llamador conserva la captura y su metadato.
  - No valida la exhaustividad del catálogo ni configura cuotas, cadencia, reintentos o límites de la API.
  - Solo devuelve los campos de negocio enumerados en ACTIVIDAD y MATERIAL; excluye imágenes, comentarios y datos de participantes de su salida.
- `consulta-publica` (remoto): Operación declarada en el ciclo común, con salud y recibo por fuente; la extracción conserva campos y desconocidos propios.
  Recursos: pagina-api, destino-material, portada-autoformacion, codigo-interfaz, alias-fundae. Autenticación: Ninguna. Sin cuentas, cookies, claves, login, CAPTCHA o bypass.
  - Transporte e identidad comunes; serie y al menos dos segundos por dominio.
  - Identidades nativas conocidas, sin convertir HTTP200 o mera presencia en acceso confirmado.
  - El censo descubre materiales; una identidad nueva solo se incorpora si supera el mismo contrato de oferta acreditada y ámbito. Tipos, idiomas, destinatarios o condiciones no admisibles quedan fuera con motivo; el alias no se duplica.
  - Con el censo completo, una petición por material conocido que no trae, a su destino registrado, sin seguir redirecciones. Un día normal son las páginas del censo, cinco apoyos y ninguna petición de destino; un retirado que sigue ausente no se vuelve a pedir.
  - Portada→módulo→ruta→componente→idioma y alias se verifican con sus recibos. Cambiar el código revisado no hereda la revisión anterior ni prueba una oferta.

## Operación actual

Política: `diaria`. Consulta red: sí.
Frecuencia declarada: Consulta diaria del censo API, el destino de cada material conocido que el censo completo no trae, portada, declaraciones y dependencias públicas del método revisado; copiar o revisar no renueva pruebas históricas. Aviso de renovación: 1 días.
Originales: `cibervoluntarios`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| cibervoluntarios | cambiante | contenido-actual-acotado | descargar | 1 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:CapturaCiber, lector.py:MaterialCiber, lector.py:extraer_materiales, lector.py:ACTIVIDAD, lector.py:MATERIAL, contrato-lectura.md, plataforma_datos/cursos/pruebas/test_lectura_cibervoluntarios.py, plataforma_datos/cursos/operacion_fuente.py, plataforma_datos/cursos/componer_catalogo.py, adquisicion.py:calcular, adquisicion.py:extraer, actualizacion.py:aplicar, control_actual.py:validar, metodo_interfaz.py, observaciones_vigencia.py, politica_vigencia_v3.json, bajas.py, destinos.py, direcciones.py, retiradas.py, plataforma_datos/cursos/pruebas/test_ciber_adquisicion.py, plataforma_datos/cursos/pruebas/test_ciber_observaciones.py, plataforma_datos/cursos/pruebas/test_ciber_actualizacion.py, plataforma_datos/cursos/pruebas/test_ciber_bajas.py.

Retirada: Un error de transporte no da de baja ni renueva la última comprobación. Un material se retira solo por el censo completo: porque lo declara borrado, o porque no lo trae y su destino registrado responde que el curso no existe; un censo parcial no retira nada y una ausencia sin esa corroboración no borra entidades ni historia.

Conservación: Cuerpos deduplicados por SHA y recibos inmutables por consulta. Fechas de recepción, revisión e ingestión separadas. La composición final conserva la instantánea de una fuente fallida y promueve conjuntamente SQLite, recurso y referencia; sin limpieza automática.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.cibervoluntarios.lector preparar
python -m plataforma_datos.cursos.fuentes.cibervoluntarios.lector validar
python -m plataforma_datos.contratos.fuentes --fuente cibervoluntarios --tema cursos --comprobar
```
