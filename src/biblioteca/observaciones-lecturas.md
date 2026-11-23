# Proyección de observaciones de Biblioteca

`proyectarObservaciones` consume la versión 2 de `observaciones-lecturas.json` producida y admitida por `enlaces_lecturas`. Es una función pura: exige reloj UTC, inventario de objetivos y SHA256 del catálogo exacto. No consulta páginas, identifica documentos, modifica el catálogo ni decide su actualidad editorial. El paquete se admite por el circuito común antes de llegar al consumidor; esta función no autentica un JSON arbitrario mediante un campo «admitido».

El resultado versionado separa `evaluado_utc` de las fechas originales `comprobado_utc`, `vence_utc` y `ultimo_intento_utc`. Repetirlo no rejuvenece una captura. `disponibilidad_observaciones: no_disponible` significa que falta el archivo, y conserva todos los objetivos desconocidos. Un archivo corrupto, de otro catálogo o con inventario incompleto se rechaza. No se convierte el fallo de lectura en una lista vacía.

Por objetivo (`id:enlace` o `id:enlace_ca`):

- El enlace editorial permanece visible si falta observación o vence su comprobación, sin una marca de vigencia. Una confirmación identificada y no vencida permite mostrar esa marca; su fecha es la de captura, no la ejecución del proyector.
- Un fallo técnico (red, servidor, cortafuegos o límite local de descarga) solo aporta un intento. No elimina ni renueva la última confirmación ni la última evidencia concluyente. HTTP 404/410 describen ausencia en la URL consultada: desactivan ese enlace, sin dar de baja la lectura ni afirmar desaparición permanente. Un fallo posterior no lo reabre.
- Una redirección genérica o un destino inseguro desactivan el enlace. Falta de identidad revisada, acceso restringido y límites de extracción solo acreditan que el intento es inconcluyente: no demuestran sustitución, ausencia ni recuperación. Se conserva la última evidencia concluyente, sea positiva o negativa. Si la anterior confirmación sigue vigente, el estado `verificado_con_intento_inconcluyente` conserva su fecha y plazo; sin confirmación no hay marca de comprobado.
- Al alcanzar exactamente el vencimiento, el estado pasa a `vencido`; el enlace permanece visible si no hay evidencia contraria. `comprobado_utc` conserva su valor histórico, pero no autoriza mostrar una marca de comprobación vigente. La comparación UTC conserva hasta seis decimales; no trunca orden ni frontera a milisegundos.
- La evidencia concluyente más reciente se declara en `ultima_evidencia`, separada de `ultimo_intento` y `ultima_confirmacion`. La cronología se valida por instante de observación. Solo una confirmación posterior a la evidencia contraria reabre el enlace.
- Las variantes por idioma tienen evidencia independiente. Ninguna hereda la confirmación de otra URL.
- Un recurso local exige SHA256 de sus bytes dentro del mismo artefacto. Su estado es `integridad_local`, nunca una comprobación remota, y `comprobado_utc` queda nulo.

`cargarProyeccionLecturas` es el adaptador Node para el generador: recibe rutas explícitas del catálogo, observaciones y raíz web, más el reloj. Reutiliza el validador del catálogo editorial, calcula su SHA y comprueba archivos locales sin seguir enlaces simbólicos. No escribe ni descarga. Un fragmento HTML local pertenece a los mismos bytes del archivo. El consumidor puede conservar las 75 fichas como referencias históricas y mostrar por separado la acción permitida y su motivo.

El generador de `web/biblioteca.html` consume esta proyección desde `datos/observaciones-lecturas.json` y conserva todas las fichas editoriales. Publica únicamente las acciones por idioma y las fechas de confirmación/vencimiento que autoriza la evidencia; los diagnósticos internos permanecen en la entrega técnica. Sin JavaScript, un destino desactivado ya carece de `href` y ninguna fecha aparece como comprobación vigente.

`web/scripts/enlaces-biblioteca.js` aplica la acción correspondiente al idioma seleccionado y retira la marca de comprobación al vencer su plazo, al volver a la página o al cambiar de idioma. Nunca consulta el destino ni inventa una fecha nueva. Cambiar al catalán no permite reabrir la variante castellana desactivada, ni al revés.

La cadena ejecuta `lecturas:generar` antes de preparar integridad y copia sin conexión. La construcción directa también genera Biblioteca en su candidata desde la entrega de datos, sin modificar las fuentes web. Una observación corrupta impide construir; un archivo ausente conserva el catálogo sin marcas de comprobación. El navegador no atribuye vigencia a la lectura intelectual ni a los hechos que contiene.
