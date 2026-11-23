# Actualización por módulos

## Actualización por módulos

`actualizar.py` coordina las fuentes con `modulos.py` (dependencias),
`piezas_de_la_actualizacion.py` (políticas y comparación), `oferta_soc_del_paquete.py` (contrato de la oferta SOC),
`cuarentena_del_paquete.py` (cuarentena y aceptaciones) y `area_de_ensayo.py` (copia aislada del producto). Requiere
macOS o Linux, Python y Node con las dependencias del producto instaladas, y las entradas operativas de cada fuente.
No es una instalación inicial ni una orden de despliegue: actualiza una copia operativa ya preparada.

```sh
npm run datos:actualizar -- --ensayo
npm run datos:actualizar
npm run datos:actualizar -- --pendientes
npm run datos:estado
```

La primera orden ensaya sin sustituir las fuentes ni los datos y recursos web vigentes; sí crea informes y estado.
La segunda intenta todos los módulos. La tercera parte de los reintentos vencidos: si cambia una
publicación, recompone también sus consumidores con los originales conservados, sin descargarlos,
y comprueba el paquete final. Solo el registro de comprobaciones remotas permite descargar: una fuente
se consulta cuando vence su reintento remoto; un módulo que solo falló en local (una orden rechazada o
una recomposición en rojo) se reintenta sin descarga y la fuente sigue con su cadencia. El ensayo conserva su selección
inicial porque no publica cambios.
El estado muestra fechas, plazos, revisión pendiente de las fichas y última ejecución; necesita las fichas
preparadas de formación abierta. No consulta la red ni escribe datos.

Las políticas evitan admitir silenciosamente una edición incompatible:

| Política | Tratamiento |
| --- | --- |
| Diaria / Mensual | Descarga y admite una captura nueva solo tras superar preparación y validación; el descriptor fija la cadencia. |
| Edición | Descarga, pero un cambio de original requiere revisión y aceptación explícita. |
| Fija | Conserva la edición declarada y comprueba sus originales. |
| Manual | Comprueba la entrada aportada por una persona e informa de su antigüedad. |
| Redactada | Prepara o valida el contenido propio; no genera texto con IA durante la actualización. |

Las políticas renovables no instalan tareas periódicas: permiten admitir capturas compatibles
mediante la misma validación. En la fuente Formación, esta operación renueva solo la oferta del SOC. Los catálogos
EURES, SEPE,
especialidades del SOC y DigComp conservan sus ediciones manuales y requieren revisión propia.
Su fila de seguimiento manual usa la fecha más antigua de esos originales y del SEPE; consultar
la oferta SOC no rejuvenece esa fecha. Si falta evidencia de alguno, la fecha queda desconocida.
Una descarga o una reconstrucción correcta no acredita por sí sola la vigencia de todas las fuentes.

El coordinador trabaja en serie, con una pausa de 5 segundos antes de cada fuente que descarga de
la red, incluida la primera. Una descarga fallida se reintenta una vez tras 60 segundos.
Las órdenes tienen un límite de 45 minutos; `procesos.py` cierra el grupo de procesos que ha creado
al terminar o agotar el plazo. Cada fuente puede aplicar además sus propios límites y pausas.
No se terminan procesos ajenos por su nombre. Las órdenes reciben un entorno explícito que excluye
claves de IA, selección de perfiles y programas de aviso.

`--area "ruta externa/nueva"` permite elegir una carpeta que todavía no exista y no se solape con
el producto. La copia excluye secretos, perfiles, registro local, Git, cachés y estado de ejecuciones;
reutiliza mediante enlaces las dependencias instaladas. Los demás archivos deben ser propios, sin
enlaces simbólicos. `--conservar-area` retiene el ensayo. `--sin-descargar FUENTE` utiliza esta vez
la captura existente de esa fuente; puede repetirse. `--pausa SEGUNDOS` admite una duración finita
no negativa. El transporte mantiene además un mínimo de dos segundos entre consultas al mismo host.

Un cerrojo impide dos actualizaciones simultáneas. `sustitucion.py` comprueba las copias y usa
un diario por módulo para recuperar una sustitución interrumpida. Esto permite recuperación tras
un corte de proceso; no ofrece una transacción indivisible entre todas las carpetas para lectores
simultáneos ni una garantía ante avería física del almacenamiento. Ejecutar fuera del árbol que
sirve tráfico y sin otros escritores. Un fallo de recuperación conserva los respaldos y exige
intervención antes de continuar. Si falla el exportador, el área se conserva para revisar su respaldo.

Cada módulo admite sus carpetas operativas completas o conserva la versión anterior. Los módulos
siguientes leen únicamente versiones admitidas; una dependencia modificada obliga a revalidar las
versiones conservadas que la usan.

La primera publicación de un módulo del registro es automática: si todas sus órdenes salen en verde y una carpeta
que declara (`modulos.carpetas`) todavía no existe en lo publicado, la sustitución la crea con el mismo diario que
protege las demás. Un corte o un fallo antes de que el diario conste como hecho retira lo creado y deja lo publicado
como estaba; el estado del módulo queda en verde, con la huella de lo publicado. Siguen necesitando revisión explícita,
y el módulo queda en ámbar con el motivo, una carpeta publicada que el módulo ya no produce («desaparece») y una ruta
que cambia entre archivo y carpeta. El paquete no crea rutas nuevas por su cuenta. Un ensayo no publica nada, tampoco
la primera vez.

El módulo final exporta el paquete y lo compara con el publicado; después aplica la
[cuarentena](#cuarentena-de-un-archivo-del-paquete), compone el catálogo de Cursos e incorpora el global admitido,
contrastándolo de nuevo con sus veinte agregados. Construye los datos globales de la web, el informe de ejemplo y el paquete publicado.
Después ejecuta `npm run web:preparar`, que construye la web local (mapas, catálogos, el motor empaquetado y su
manifiesto) y coteja los artefactos construidos, no solo sus fuentes, y `npm run verificar:datos`, que comprueba con
ese paquete todo lo que lo lee (scripts/verificar-datos.ts y
[qué comprueba el ciclo](../../../docs/actualizacion-remota.md#qué-comprueba-el-ciclo)); la batería completa,
`npm run verificar`, es la que exige publicar el código. La web construida no forma parte de la entrega.
Con todas las comprobaciones correctas, sustituye `datos/` y `web/` con un único
diario recuperable. `src/plataforma/mapa-de-modulos.ts` no se promueve: es una plantilla neutra que no cambia. No firma
ni despliega la entrega.
La construcción local requiere `web/firmas/` sin firmas anteriores; no las elimina automáticamente.
Se detiene la sustitución si desaparece un archivo declarado o cambia una entrada fijada o vinculada
a vectores que deban regenerarse. No se ajustan cifras para superar los controles.
La oferta SOC admite una excepción delimitada: pueden cambiar los cursos, la fecha de su copia y sus
dos contadores de cobertura si ambos documentos cumplen el contrato conocido y conservan íntegros
los catálogos, las correspondencias, las citas y su orden.

| Código de salida | Resultado |
| --- | --- |
| `0` | Verde: los módulos ejecutados se admitieron o no cambiaron; un ensayo lo indica. |
| `3` | Ámbar: al menos un módulo conserva su última versión admitida. |
| `1` | Rojo: no se puede continuar con coherencia o el cerrojo está ocupado. |
| `2` | Argumentos de la orden incorrectos, o se acepta un archivo que no está en cuarentena. |

`estado_de_la_actualizacion.py` y `informe_de_la_actualizacion.py` escriben estado e informes
Markdown/JSON en `var/actualizacion/ejecuciones/`. Los módulos en ámbar se reintentan tras 1, 2, 4 y,
a partir del cuarto fallo consecutivo, 8 días. `--pendientes` debe invocarse desde el planificador
elegido por la entidad: el programa no instala tareas periódicas por sí mismo. Un estado defectuoso
se diagnostica, sin convertirlo silenciosamente en una ejecución correcta.
El informe conserva el final de la salida de cada paso fallido, también el de la composición, en el
Markdown y en el JSON (`diagnostico`). Sale saneado: de una ruta queda su nombre final y se ocultan
credenciales, correos y la identidad del equipo. Se acota a 8 KiB por paso y 32 KiB en total; un fallo
que ya no cabe consta sin detalle, pero consta.

Los avisos quedan en `avisos.log`. Opcionalmente, `FARO_AVISO` señala un ejecutable del administrador,
invocado sin shell y con el mensaje como único argumento; sus errores también se registran.
El programa de aviso es configuración de mantenimiento y no se propaga a las órdenes de las fuentes.

### Cuarentena de un archivo del paquete

Un archivo que pierde más del 20 % de sus entradas, o de sus cursos SOC aunque el catálogo de especialidades
tenga más entradas, queda en cuarentena: conserva su versión publicada y el resto del paquete sigue. Con él se
conservan los archivos que salen de alguna de sus mismas carpetas de entrada (por ejemplo, `formacion.json` y
`correspondencia-eures.json`), según los orígenes de los manifiestos. La cuarentena se aplica en el área justo
después de exportar, así que la composición, `npm run web:preparar` y `npm run verificar:datos` comprueban el paquete
que se publicaría; si no es coherente, el paquete queda en ámbar y no se sustituye nada. Si la versión publicada
no coincide con su manifiesto o el estado de la cuarentena no se puede leer (también si no es JSON), tampoco se
sustituye; ese estado se lee en cada actualización antes de publicar, haya pérdidas o no.

Lo que la regla de retirada activa de una fuente quita de su archivo (`formacion.json`, `consorci.json` o
`citilab.json`) no cuenta como pérdida: cada retirada tiene su evidencia registrada y comprobada. La comparación mide
el archivo nuevo frente al publicado sin esas unidades (`retiradas_explicadas.py`), con la regla y el estado que usó la
exportación en el área; lo que falte además sí es una pérdida sin explicar y va a cuarentena, aunque coincida con un
ciclo en que la regla retira. Cada archivo se explica solo con la regla de su fuente, y con la regla en sombra la
comparación es la de siempre. Si la regla retira de golpe más del 20 % de los cursos que leyó, el panel lo avisa con
su cifra (`aviso_de_la_retirada.py`); el umbral avisa y la evidencia decide.

El umbral no decide lo que se publica: avisa y conserva lo último bueno. Al publicar, la cuarentena queda en
`var/actualizacion/ejecuciones/cuarentena.json` con las cifras de antes y después, el grupo conservado, desde
cuándo y la última observación; `npm run datos:estado` la muestra en `cuarentena`, y cada archivo que entra en
ella deja un aviso en `avisos.log` (y en `FARO_AVISO`). El motivo del módulo `paquete` en `estado.json` y la
comparación del informe JSON (`cuarentena`, `aceptados`) dicen qué se conservó y qué cambio aceptado entró.
Un archivo sale de la cuarentena cuando la fuente deja de dar la pérdida o cuando una persona acepta su cambio:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.actualizar --aceptar-cuarentena formacion.json
```

La orden no actualiza: registra la aceptación, bajo el cerrojo, para la siguiente ejecución, que publica el
cambio si el paquete pasa sus comprobaciones y lo anota. Aceptar es aceptar que el archivo baje hasta las cifras
que se vieron (`perdidas`). Una ejecución posterior lo publica si la versión publicada sigue siendo la misma que al
aceptar, el archivo nuevo no trae menos entradas que las aceptadas en ninguna de sus cuentas y toda cuenta que hoy
supera el umbral figura entre las aceptadas; los bytes pueden ser otros (si se vio «5 → 2», vale 2 o más; no vale 1).
Si trae menos, o una pérdida que no se vio al aceptar (por ejemplo, se aceptaron entradas y ahora bajan los cursos
SOC), el archivo sigue en cuarentena sin aceptación, con las cifras nuevas registradas y un aviso con las cifras
aceptadas y las nuevas. `exportado_sha256` registra la versión nueva que se vio, como
evidencia; no tiene que coincidir. Si un archivo aceptado va con otro que sigue en cuarentena, se conserva con él.

### Medir la fase del paquete

`.venv/bin/python -m plataforma_datos.orquestacion.medir_paquete` ejecuta solo las órdenes del paquete en un área de
ensayo copiada de esta instalación, con los mismos topes que el ciclo, y escribe los minutos de cada paso. No ejecuta
ninguna orden de las fuentes, así que no descarga nada, y no sustituye nada de lo publicado. Sirve para medir el
paquete en el Mac y ver qué paso pesa más antes de lanzar un ciclo real. El plazo del motor y la parada ordenada parten
de esa medida, llevada al runner de GitHub más lento medido con el factor de cada tipo de trabajo
(`medidas_del_ciclo.py`).

### Consultas periódicas contra las fuentes

`--programada` selecciona consultas oficiales vencidas; `--buscar-actualizaciones` permite comprobarlas
a demanda con el mismo motor. `planificacion_de_comprobaciones.py` distingue conjuntos y cadencias;
`ejecucion_observada.py` y `plataforma_datos/comun/observacion_remota.py` registran las lecturas HTTP completas de cada
intento. `seguimiento_de_comprobaciones.py` las vincula a la admisión del módulo y
`comprobaciones_remotas.py` conserva el estado privado y las interrupciones.

Cada conjunto declara su intervalo en `fuente.json`; los canales recurrentes de cursos
usan un intervalo diario. Las demás consultas respetan la cadencia de su descriptor. Una reconstrucción local no renueva
la consulta remota. Consultar una edición conocida
no descubre su sucesora, y una consulta parcial no significa «Todo actualizado». Las órdenes no instalan
tareas periódicas ni activan versiones; su alcance y recuperación se describen en
[Comprobaciones periódicas](../../../docs/comprobaciones-periodicas.md).

### Candidato para un ejecutor de mantenimiento

`candidato.py` ofrece cinco acciones cerradas: `actualizar-datos`, `reintentar-pendientes`,
`comprobar-programada`, `comprobar-vencidas` y `actualizar-cursos`. `comprobar-programada` selecciona las consultas
vencidas y se utiliza desde el programador interno del alojamiento; no es una acción libre del navegador.
`comprobar-vencidas` hace la misma selección pedida a demanda, y `actualizar-cursos` busca a demanda solo en las
fuentes de cursos que se leen a diario. Lo que hace cada una está en «Qué hace cada acción en el motor», en
[Ejecutor de actualización](../../../docs/actualizacion-remota.md).
Trabaja sobre una instalación privada completa, con dependencias y entradas operativas presentes,
reservada para esa ejecución y que no sirve tráfico. La ruta es configuración del ejecutor;
no se acepta una ruta ni una orden enviada desde el navegador.

```sh
.venv/bin/python -m plataforma_datos.orquestacion.candidato actualizar-datos "/ruta/instalacion candidata" \
  --recibo "/ruta/recibos/intento.json"
```

El recibo debe estar fuera del candidato y no existir todavía. Describe el resultado y el estado
de fuentes y módulos, sin rutas, mensajes internos ni registros libres. Un candidato validado
incluye la identidad del paquete obtenida del mismo lector que utiliza Faro y un cotejo de
sus artefactos. Un resultado ámbar sin ningún rojo y con el paquete en verde también se valida: se publica lo que
sí se actualizó y cada módulo que falló conserva su última versión publicada, entera (la actualización la restaura y
la comprueba por huella). Esto incluye las fuentes del catálogo de Cursos cuya consulta falla: sus originales nuevos se
guardan, pero la composición solo lee el conjunto admitido y los originales que este cita por huella. El recibo v4
lo dice en `conservados`: `[{"id": "<módulo>", "fecha": "<fecha de la versión conservada>" | null}]`, los módulos
en ámbar de `estado.modulos`, en su orden. Los recibos v1, v2 y v3 siguen siendo legibles; solo la v4 valida en
ámbar. Un ámbar sin paquete nuevo (nada llega a publicarse), un ámbar con el paquete sin publicar o un rojo se
rechazan con su diagnóstico y con `conservados`; los validadores rechazan además un validado con algún módulo en rojo;
un reintento sin pendientes o una comprobación programada sin selección no ejecutan la cadena ni
declaran un nuevo paquete. Los recibos nuevos usan la versión 2; los anteriores siguen siendo legibles
y se reenvían sin convertirlos ni cambiar sus bytes.

El recibo no acredita que una versión esté activa. Este componente no firma, no despliega ni
cambia el servicio que recibe tráfico. El ejecutor que lo integra debe conservar el estado
operativo coherente, autenticar el resultado y comprobar por separado la activación.

### Traslado de una generación operativa

`generacion_operativa.py` reúne el paquete vigente de `datos/` y las entradas que necesita la cadena
periódica en `var/actualizacion/`. Incluye originales declarados con su procedencia, preparados,
conjuntos admitidos, revisiones e historial funcional del Consorci. Conserva el estado de ejecución,
el registro privado de comprobaciones y el estado de la cuarentena si existen; una instalación sin intentos mantiene
esa ausencia, sin fabricar un resultado correcto. Un registro presente defectuoso impide trasladar la generación.

La exportación toma el cerrojo de actualización y exige que no haya sustituciones pendientes de
recuperación. Escribe en un directorio nuevo `manifiesto.json` y `contenido/`. El manifiesto vincula
la revisión de código, el inventario exacto y las huellas SHA-256. La restauración exige tanto esa
revisión como la huella del manifiesto obtenidas de configuración privada confiable, comprueba
todos los archivos y solo admite un destino nuevo. No mezcla ni sobrescribe una instalación.

```sh
.venv/bin/python -m plataforma_datos.orquestacion.generacion_operativa exportar "/ruta/instalacion" \
  --destino "/ruta/generacion nueva" --revision-codigo <commit completo>
.venv/bin/python -m plataforma_datos.orquestacion.generacion_operativa restaurar "/ruta/generacion nueva" \
  --destino "/ruta/datos restaurados" --revision-codigo <commit completo> \
  --sha256-manifiesto <huella del recibo de exportacion>
```

El destino restaurado contiene `datos/` y `var/`, sin código ni dependencias. El ejecutor debe
incorporar ambos árboles en su copia privada del código correspondiente antes de construir el
candidato; no basta con restaurar `var/` sobre un paquete antiguo. La herramienta no descarga,
firma, publica ni activa datos, y una huella no sustituye la autenticación del almacén de origen.

Quedan fuera secretos, informes y registros libres de ejecución y microdatos no redistribuibles. También quedan
fuera los originales cartográficos del globo: sus recursos publicados pertenecen al código y
la cadena periódica no los reconstruye. La [entrega completa](../../../docs/construccion-web.md#datos-globales-y-globo)
conserva esos originales para la reconstrucción cartográfica explícita. Esta generación de datos
no sustituye al paquete completo de transferencia de la aplicación.

#### Generación exportada con otra revisión del código

Una generación solo se verifica y se restaura con el código de la revisión que la exportó (`revisionCodigo` en su
recibo y en su manifiesto), porque la admisión del catálogo de cursos firma el código que la auditó. La
[guía de portabilidad](../../../docs/portabilidad.md#generación-exportada-con-otra-revisión-del-código) explica cómo
pasar una generación a una revisión nueva sin relajar esa admisión.

### Módulos de actualización

`modulos.py` declara el orden y las dependencias comprobadas. La tabla se contrasta en las pruebas.
Además requiere las revisiones, la captura SEPE de formación y los conjuntos admitidos de
`ia-nacional` y `encuestas-isco4`, que se preparan por sus órdenes específicas.

<!-- tabla de módulos: comprobada contra modulos.py -->
| Módulo | Entradas de otros módulos |
| --- | --- |
| `esco` | — |
| `oit` | — |
| `clasificaciones` | `oit` |
| `cambra` | `clasificaciones` |
| `hechos_informe` | — |
| `cataluna` | `clasificaciones`, `cambra` |
| `ocupados` | `clasificaciones`, `cambra`, `cataluna` |
| `censo` | `clasificaciones`, `cataluna`, `ocupados` |
| `tich` | `clasificaciones` |
| `salarios` | `clasificaciones` |
| `formacion` | `esco` |
| `consorci` | `formacion` |
| `agencia` | — |
| `acreditacion` | `esco`, `clasificaciones`, `cataluna`, `formacion`, `agencia` |
| `citilab` | — |
| `abierta` | — |
| `lecturas` | — |
| `enlaces_lecturas` | `lecturas` |
| `derechos` | — |
| `textos` | `oit` |
| `idescat` | `clasificaciones` |
| `catalan` | `esco`, `oit`, `clasificaciones`, `textos`, `idescat` |
| `nombres` | `esco`, `oit`, `cataluna`, `formacion`, `textos`, `idescat`, `catalan` |
| `sectores` | `clasificaciones`, `cataluna` |
| `empresas` | `sectores` |
| `observatori` | `clasificaciones`, `cataluna` |
| `necesidades` | `clasificaciones` |
| `perfiles` | `esco`, `clasificaciones`, `cataluna`, `formacion`, `agencia`, `acreditacion` |
| `certificados2016` | `esco`, `clasificaciones`, `cataluna`, `formacion`, `agencia`, `acreditacion`, `perfiles` |
| `actic` | — |
| `barcelonactiva` | `catalan` |
| `fundae` | — |
| `memoria` | — |
| `hp_life` | — |
| `cibervoluntarios` | — |
| `claude_academy` | — |
| `territorios` | — |
| `mundo_eurostat` | `tich`, `empresas` |
| `ilostat` | `territorios`, `mundo_eurostat` |
| `tic_llars` | `tich` |
| `clima_empresarial` | — |
| `ue_eurostat` | — |
| `decada_digital` | — |
| `eurobarometro` | — |
| `ceo_panel` | — |
| `ia_nacional_isl` | — |
| `ia_nacional_gbr` | — |
| `ia_nacional_bra` | — |
| `ia_nacional_che` | — |
| `ia_nacional_isr` | — |
| `ia_nacional_kor` | — |
| `epa` | — |
| `eaes` | — |
| `ofertas` | — |
| `enlaces` | `consorci`, `formacion` |
| `datos_globales` | `clasificaciones`, `idescat`, `empresas`, `territorios`, `mundo_eurostat`, `ilostat`, `tic_llars`, `clima_empresarial`, `ue_eurostat`, `decada_digital`, `eurobarometro`, `ceo_panel`, `ia_nacional_isl`, `ia_nacional_gbr`, `ia_nacional_bra`, `ia_nacional_che`, `ia_nacional_isr`, `ia_nacional_kor` |
| `paquete` | Todos los módulos y las entradas externas admitidas. |

Para reconstruir desde capturas locales, `npm run datos:reconstruir` ejecuta preparación y validación
en orden y exporta al final; `--sin-paquete` omite la exportación. `--descargar` añade las descargas.
Esta orden escribe directamente las etapas operativas: usarla en una copia aislada, sin otros
escritores. Para actualizar una instalación existente con recuperación y versiones conservadas,
utilizar `datos:actualizar`.

La sustitución del paquete del motor no despliega la web, no firma sus recursos ni publica por sí
sola el agregado global. La preparación de esos recursos y su verificación pertenecen al proceso de
publicación de una versión completa; no se debe servir una mezcla de recursos de versiones distintas.

