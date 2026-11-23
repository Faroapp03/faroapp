# Operaciones manuales de datos

Estas operaciones trabajan con entradas y bases elegidas por quien las ejecuta. Se realizan desde la raíz del
repositorio con el entorno Python de la instalación. Preparar o importar una candidata no la activa ni la publica en
la aplicación. Las consultas y sus evidencias no prueban por sí mismas matrícula, plaza o acceso personal.

## Importar capturas

Digitalízate tiene un adaptador independiente. Sin `--base` prepara y escribe en stdout los lotes y su control; con
`--base` importa los lotes y canales completos en la base indicada, que debe ser un catálogo V10 creado con
`python -m plataforma_datos.cursos.crear_catalogo --base CANDIDATA`. La importación no
concilia ausencias ni demuestra vigencia actual.

```sh
python -m plataforma_datos.cursos.fuentes.fundae.digitalizate --captura CAPTURA [--base CANDIDATA]
```

Los corchetes indican un argumento opcional y no forman parte de la orden. También se puede llamar a
`importar_captura(base, raiz_captura)` desde el módulo. La raíz debe contener la captura y su
manifiesto admitido; los lotes se importan con sus canales temporales, sin convertir fechas distintas en una sola.

Para Cibernàrium, la operación sobre capturas existentes no consulta la red y conserva sus instantáneas en una
salida explícita. La base es de investigación, fuera de la aplicación:

```sh
python -m plataforma_datos.cursos.fuentes.barcelonactiva.robot_cibernarium \
  --desde-capturas CAPTURA --salida INSTANTANEAS --base BASE_INVESTIGACION
```

El modo `--consultar` del mismo módulo realiza consultas reales y requiere sus entradas, identidad y condiciones de
operación; no forma parte de la orden offline anterior. Véase el
[contrato del robot](../plataforma_datos/cursos/fuentes/barcelonactiva/robot_cibernarium.py).

## Conciliar un censo

Las APIs de `plataforma_datos.cursos.catalogo` reciben un `InstantaneaCatalogo` con proveedor, ámbito, identificadores,
total, integridad del censo, errores y observación. La conciliación autónoma trabaja sobre una base existente:

```python
from plataforma_datos.cursos.catalogo import conciliar_instantanea, importar_y_conciliar

resultado_censo = conciliar_instantanea(base, instantanea)
resultado_ciclo = importar_y_conciliar(base, entrada, instantanea, opciones=opciones)
```

Para un ciclo de fuente que importa datos y actualiza pertenencias se usa `importar_y_conciliar`: confirma ambos en
una misma transacción y revierte todo si falla. Las opciones y las evidencias deben corresponder a la entrada real;
no se sustituye un censo completo por un lote parcial. Las formas de `InstantaneaCatalogo` y `OpcionesCiclo` están en
el [catálogo](../plataforma_datos/cursos/catalogo.py).

## Consultar vigencia e historia

Las funciones de `plataforma_datos.cursos.registro_vigencia` leen el catálogo elegido. El límite de página es de 1 a
100. Para continuar un listado de ediciones se devuelve el cursor junto con la revisión que debe acompañar la petición
siguiente; si cambia la revisión se reinicia la lectura. Los historiales usan el cursor anterior devuelto:

```python
from plataforma_datos.cursos import registro_vigencia as vigencia

pagina = vigencia.listar_ediciones(base, limite=50)
siguiente = vigencia.listar_ediciones(
    base, limite=50, despues_de=pagina["siguiente"], revision_esperada=pagina["revision"]
)
historia_edicion = vigencia.historial_decisiones(base, edicion_id, limite=50, antes_de=cursor)
historia_unidad = vigencia.historial_unidad(base, tipo="recurso", id=programa_id, limite=50, antes_de=cursor)
```

Continuar solo cuando `pagina["siguiente"]` exista; para la primera página de historial se omite `antes_de`. Los
registros conservan decisiones y evidencias, no son una lista de ofertas publicadas. Leer una página no sustituye la
auditoría completa de integridad. Los demás tipos, cursores y límites se describen en el
[registro de vigencia](../plataforma_datos/cursos/registro_vigencia.md).

## Consultar el aprendizaje de un programa

La orden `aprendizaje` del catálogo lee el aprendizaje previsto de un programa y comprueba cada referencia contra el
registro de aprendizaje con el que se decidió. Imprime el resultado en JSON, o `null` si el programa no existe. Es una
consulta de diagnóstico: no cambia la base ni acredita oferta. Sin base, termina con código 2 y no la crea.

```sh
python -m plataforma_datos.cursos.catalogo aprendizaje --base BASE --programa PROGRAMA_ID
```

## Productores externos de IA y trabajo

`ia_nacional` (uso de la IA por las empresas fuera de la UE) y `encuestas_isco4` (exposición calculada con microdatos
de encuestas) no forman parte de la actualización automática. Se ejecutan a mano con las órdenes de «Reproducción» de
su README (`python -m plataforma_datos.ia_y_trabajo.fuentes.<fuente>.lector preparar` y `validar`). Sus conjuntos
validados, `var/actualizacion/validados/ia-nacional` y `validados/encuestas-isco4`, son entradas externas de la cadena:
la composición de datos globales los lee, pero ninguna actualización los escribe. Conservar solo esos conjuntos
permite recomponer los datos globales, pero no reconstruirlos: para eso hacen falta sus entradas operativas.

## Grupos de competencias ESCO

`python -m plataforma_datos.ocupaciones.fuentes.esco.piezas.grupos_competencias_esco --comprobar` comprueba, sin
escribir nada, que `motores/ocupaciones/src/busqueda/grupos-de-competencias.json` corresponde a la base ESCO validada y
a `datos/esco.json`. Sin `--comprobar`, la herramienta reescribe ese archivo del motor protegido: solo con
autorización y, después, banco idéntico y sello renovado. Si el paquete no tiene las competencias de la base en su
orden, se detiene sin escribir; antes hay que exportar el paquete ESCO.

## Versión de Chrome del perfil web

La fuente `versiones_navegadores` está registrada como candidata: ninguna actualización automática la descarga ni
cambia la identidad de red. Para renovar la versión de Chrome de `plataforma_datos/comun/perfil_web.py`
(`VERSION_CHROME`), una persona ejecuta, con red, `python -m plataforma_datos.comun.fuentes.versiones_navegadores.lector
descargar`, después `preparar` y `validar`, y `python -m plataforma_datos.contratos.fuentes --fuente
versiones_navegadores --tema comun --comprobar`. Con la versión estable admitida a la vista, se cambia `VERSION_CHROME`
a mano en un cambio revisado, junto con sus pruebas (`plataforma_datos/comun/pruebas/test_red_perfil.py`). Un error o
una respuesta incompleta no sustituye la última admisión.

## Confirmar la oferta del SOC pendiente

El SOC no declara cuántos cursos publica. Si la oferta que descarga `formacion` tiene menos del 80 % de los cursos
distintos (campo `curs`) de la última copia admitida, no se admite como censo completo, tampoco con la aceptación
automática de la actualización (el criterio es `PERDIDA_MAXIMA`, el mismo con que la actualización avisa de pérdidas).
La descarga termina con este error, que aparece en la salida de la orden y en el informe de la actualización:

```text
Error: SOC: la oferta descargada tiene N cursos y la copia soc-cursos-AAAA-MM-DD.json tenía M; pierde más del 20 %,
queda pendiente de confirmación y se conserva la copia anterior
```

La copia anterior sigue siendo la vigente y su procedencia no cambia. En `var/actualizacion/originales/formacion/`
quedan la oferta descargada, `soc-cursos-pendiente.json`, y sus cifras, `soc-cursos-pendiente-de-confirmacion.json`:
cursos de la oferta y de la copia anterior, nombre de esa copia, huella y tamaño de la oferta, hora real de la consulta
remota y criterio aplicado. Una descarga completa posterior retira la pendiente.

Antes de confirmar hay que comprobar que la caída es real. El contraste independiente se hace en el buscador de
formación de la web del SOC, no en el archivo `ofertaCursos.json` que lee la descarga. El código enlaza cada curso a su
ficha en ese buscador con la dirección base `FICHA_CURSO` de `plataforma_datos/cursos/fuentes/formacion/constantes.py`:
`https://serveiocupacio.gencat.cat/ca/persones/vull-formar-me/cercadors-formacio-especialitats/cercador-integrat/fitxa-curs.html?codi_curso_seleccionado=`,
seguida del código del curso. Hay que contrastar allí el número de cursos con las cifras guardadas y revisar si falta un bloque entero (un tipo de formación,
un territorio o un periodo) que haga pensar en una publicación cortada. Si la caída no se confirma, no se hace nada: la
siguiente descarga completa sustituye la pendiente.

Si se confirma, se pasa la huella de la oferta revisada, que es el campo `sha256` de sus cifras:

```sh
python -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' \
  var/actualizacion/originales/formacion/soc-cursos-pendiente-de-confirmacion.json
python -m plataforma_datos.cursos.fuentes.formacion.confirmar_censo HUELLA
```

La orden no consulta la red. Comprueba los originales y exige que la pendiente sea la revisada: si la actualización la
ha sustituido mientras tanto por otra oferta, termina con un error y no confirma nada, y hay que revisar las cifras
nuevas. Exige también que los bytes coincidan con esa huella y vuelve a pasar los controles de la oferta. Después la
admite como copia del día de su consulta, con la hora de esa consulta y no con la de la confirmación, y retira la
pendiente. Sin oferta pendiente, con otra huella o con otros bytes, termina con un error y no cambia nada. Después se
siguen `preparar` y `validar` de `formacion`, como tras cualquier descarga.

## Confirmar las fechas de Citilab sin leer

Las fechas de Citilab salen del texto de cada ficha con un patrón estricto («1 d'octubre de 2026»), también en rangos y
listas de sesiones («del 3 al 5 de març de 2026», «3, 10 i 17 de març de 2026»). Si una ficha usada se queda sin fecha
de fin aunque su sección «DURADA I HORARI» trae algo con forma de fecha que puede serlo (numérica como «24/11/2026»,
con el mes abreviado como «24 de nov.» o en castellano), `validar` de `citilab` se detiene y el conjunto admitido sigue
siendo el anterior. Avisan dos fechas o más, o una sola que no se ha leído ni como inicio. No avisan un curso de un día
con su fecha leída, uno periódico sin fechas ni «De setembre a gener». El control de `validacion.json` dice cuántas fichas son y sus ids, y en
`var/actualizacion/originales/citilab/fechas-pendientes-de-confirmacion.json` quedan su id, la huella de su texto y la
huella de la lista.

Antes de confirmar hay que abrir cada ficha en citilab.eu y ver si su texto da un fin legible. Si lo da con otra
redacción, hay que adaptar el lector (`plataforma_datos/cursos/fuentes/citilab/lector.py`) y no confirmar nada. Si de
verdad no da un fin, se confirma la lista revisada con su huella (campo `huella`) y se vuelve a validar:

```sh
python -c 'import json,sys; print(json.load(open(sys.argv[1]))["huella"])' \
  var/actualizacion/originales/citilab/fechas-pendientes-de-confirmacion.json
python -m plataforma_datos.cursos.fuentes.citilab.confirmar_fechas HUELLA
python -m plataforma_datos.cursos.fuentes.citilab.lector validar
```

La confirmación queda en `fechas-confirmadas.json` y vale para el texto exacto de cada ficha: si Citilab la cambia,
vuelve a detenerse. Si la lista pendiente ya no es la revisada, la orden termina con un error y no confirma nada.

## Por qué se retuvo un ciclo

Un ciclo rechazado no publica nada y deja la referencia como estaba. Si su generación no se puede conservar, la
referencia mantiene su `baseOperativa` y el ciclo siguiente arranca solo desde ella. El porqué queda en el diario del
ciclo y en su resumen archivado (`diarios-resumen/…`), siempre con palabras de listas cerradas:

- Un paso del paquete en rojo o una alarma de su comparación: el diario lleva `fase: paquete`, `estado: retenido`,
  con `paso` (`exportar`, `componer-catalogo`, `incorporar-globales`, `preparar-globales`, `preparar-biblioteca`,
  `preparar-informe`, `cotejar-web`, `comprobar-datos`, `sustituir` u `otro`), su `codigo` y la lista `alarmas`. Cada
  alarma tiene `tipo` (`desaparece`, `entrada-fijada-cambia`, `vectores-desfasados` u `otra`) y el `archivo` del
  paquete al que afecta. En el resumen está en `retenciones.paquete`. `estado: ilegible` quiere decir que el estado o
  el informe del candidato no se pudieron leer.
- Una fuente en ámbar: cada etapa se anota como `etapa-fuente` con su `causa` (por ejemplo `http-503`,
  `plazo-agotado` o `pagina-de-comprobacion`, la de una web que responde con una página HTML de comprobación en lugar
  de datos). En el resumen está en `fuentes`.
- Una generación que no se pudo conservar: `fase: generacion`, `estado: no-conservada`, con `clase` (la clase del
  error), `comprobacion` (la función de `generacion_operativa` que lo rechazó) y `causa` (por ejemplo
  `paquete-cita-otros-originales`). En el resumen está en `retenciones.generacion`.

## Levantar el bloqueo operativo

Un rechazo no bloquea la referencia del almacén de trabajos (`referencias/mantenimiento.json`). Si la referencia
trae `bloqueoOperativo` activo de antes, el ciclo que la encuentra lo levanta solo, con la misma verificación y la
misma acta que esta orden. En el diario se ve como `levantar-bloqueo` (`inicio` y `confirmado`) antes de
`permiso-inicio`. Solo hace falta una persona cuando el ciclo no puede levantarlo: entonces anota
`levantar-bloqueo` en `error`, con la causa `base-no-verificable` (la base no está entera o no verifica) o
`referencia-en-conflicto` (la referencia ha cambiado o bloquea otro trabajo), y no arranca el motor. En ese caso hay
que restaurar una base íntegra o revisar la referencia, y después vale esta orden. Antes de usarla, diagnostica el
rechazo con su recibo y su índice (`trabajos/<solicitudId>/<revisionReserva>/<runId>.json`). El reenvío del recibo
de ese trabajo se puede completar antes o después: con la referencia levantada se acepta sin escribirla ni volver a
bloquearla. La orden se ejecuta
como `ejecutar_mantenimiento inicializar`
([inicialización de la referencia](almacenamiento-datos.md#referencia-operativa-y-recibos)): desde la instalación
del administrador y con las tres variables del almacén en el entorno, `FARO_ALMACEN_S3`,
`FARO_ALMACEN_ACCESS_KEY_ID` y `FARO_ALMACEN_SECRET_ACCESS_KEY`. La base se descarga entera en un directorio temporal
que se crea en `TMPDIR` y se borra al terminar: hay que apuntar `TMPDIR` a un volumen con sitio para una generación
completa, que ocupa lo que indica `bytesTotales` en su manifiesto (el resumen de `transferir_generacion` lo muestra) y
nunca más de los 16 GiB que admite el
[contrato de las generaciones](almacenamiento-datos.md#integridad-y-conservación). Recibe el trabajo que dejó el
bloqueo:

```sh
.venv/bin/python -m plataforma_datos.orquestacion.levantar_bloqueo \
  --solicitud-id "<solicitudId>" --revision-reserva "<revisionReserva>" --run-id "<runId>"
```

Comprueba, por este orden, que la referencia está bloqueada, que bloquea ese trabajo y que su `baseOperativa` se
recupera entera y verifica igual que antes de aprovisionar un candidato: manifiesto, huella y tamaño de cada archivo,
inventario y admisión. Después vuelve a leer la referencia y, si no ha cambiado, crea el acta
`desbloqueos/<solicitudId>/<revisionReserva>/<runId>.json` con creación condicional; solo entonces escribe la
referencia con `If-Match` del ETag de su propia lectura y la confirma por lectura exacta. La referencia nueva es la
anterior con `bloqueoOperativo` a `false`: mismas bases, misma `ultimaValidada`, misma revisión y mismo trabajo. No
borra ni cambia recibos, índices ni generaciones, no reintenta una escritura en conflicto y no activa datos.

El acta tiene forma cerrada: `version`, `instante` (UTC), `trabajo` (la tupla del trabajo bloqueado),
`sha256ReferenciaAnterior` y `sha256ReferenciaNueva` (de los bytes exactos de cada referencia), `generacion` (la base
verificada) y `transicion` (`levantar-bloqueo`). Registra la transición pedida, no su resultado: se escribe antes que
la referencia, y la referencia solo está levantada si su SHA-256 coincide con `sha256ReferenciaNueva`. Si la orden se
corta entre las dos escrituras, repetirla encuentra el acta, la conserva con su instante original y termina el
levantamiento. Si dos órdenes coinciden, la que llega después de que la otra haya levantado el bloqueo termina con
«sin bloqueo».

Si alguien cambia la referencia a mano mientras sigue bloqueando el mismo trabajo y ya había un acta, el acta no
corresponde a la referencia nueva y la orden termina siempre con «conflicto»: repetirla no lo resuelve. Hay que
restaurar la referencia cuyos bytes nombra el acta en `sha256ReferenciaAnterior`, comprobar que su SHA-256 coincide
con ese valor y volver a ejecutar la orden.

La orden imprime una línea con el resultado y termina con su código:

| Código | Resultado | Qué queda escrito |
|---|---|---|
| 0 | `levantado`: base verificada y referencia sin bloqueo | El acta y la referencia nueva |
| 3 | `sin-bloqueo`: la referencia no estaba bloqueada, u otra orden la ha levantado mientras tanto; repetir la orden después de levantarlo da este código | Nada; el acta, si otra orden levantó el bloqueo después de que esta creara la suya |
| 4 | `no-verificable`: la base operativa no está entera en el almacén (falta su manifiesto o algún archivo) o no verifica (huella o tamaño de algún archivo, inventario o admisión). Repetir no lo arregla: hay que restaurar una base íntegra | Nada |
| 5 | `conflicto`: la referencia bloquea otro trabajo, otra escritura la ha cambiado durante la orden sin levantar el bloqueo o el acta del trabajo describe otra referencia. Hay que leer la referencia y el acta antes de repetir | Nada en la referencia; el acta, si otra escritura cambió la referencia justo después de crearla |
| 1 | Sin resultado. Si el almacén no ha respondido o no ha confirmado una escritura (un corte de red, un error del servidor como 503 o un fallo del disco local), la línea lo dice y basta con repetir la orden más tarde; si no, la configuración privada o la referencia no cumplen el contrato y hay que revisarlas | Nada en la referencia; el acta, si el corte llegó al escribir la referencia, y repetir la orden la reutiliza |
| 2 | Argumentos no admitidos | Nada; no abre el almacén |

## Formatos persistidos y versiones

| Formato | Se escribe | Se lee | Notas |
|---|---|---|---|
| Catálogo de cursos (SQLite, `PRAGMA user_version`) | V10, con `crear_catalogo` o al importar el primer lote | V10 en la actualización, la admisión y la entrega | No hay migraciones: una base de otra versión se rechaza al abrirla |
| Vigencia del catálogo (evaluaciones y observaciones) | Formato 3, con el contenido estable compartido | Formato 3 | El catálogo admitido (`cd5d230a…`) tiene sus 2.188 evaluaciones en formato 3 y todo su contenido compartido |
| Admisión del catálogo (`validacion.json`) | 1, o 2 con índices de evidencias | 1 y 2 | Lleva la huella del código que la auditó; `python -m plataforma_datos.cursos.revalidar_catalogo` la repite cuando ese código cambia |
| Evidencias del catálogo | Por trozos | Enteras o por trozos | `python -m plataforma_datos.cursos.migrar_trozos_catalogo --almacen RUTA` convierte un almacén entero |
| Índice de trabajos de mantenimiento | 2, o 3 cuando el recibo se compacta con catálogo | 1, 2 y 3 | La activación exige 2 o 3 |
| Recibo de mantenimiento | 3, con el catálogo | 1, 2 y 3 | Los recibos 1 y 2 pueden estar en el almacén remoto de trabajos |
| Instantáneas del panel | 5 | 1 a 5 | — |
| Estado de la actualización (`ejecuciones/estado.json`) | 5, con 56 módulos | 5 | `python -m plataforma_datos.orquestacion.migrar_estado_actualizacion` convierte, en un paso y con respaldo, los estados sin versión (47 módulos), 2 (48), 3 y 4 (49) a 5, y amplía a 56 los estados 5 de 49, 52 o 53 módulos. La actualización aplica sola, al arrancar y bajo su cerrojo, una ampliación de esos estados 5, que solo añade módulos sin intento, con respaldo del estado anterior; un ensayo no escribe el estado y, con esos inventarios, se detiene avisando de que la actualización real lo ampliará sola; cualquier otro inventario la detiene con el nombre de esta orden. Repetirla no cambia nada. El lector admite en 5 el origen de una migración anterior y la integridad sin huella histórica |
| Registro de comprobaciones remotas | 2 | 1 y 2 | Cada actualización que no es un ensayo convierte un registro 1 antes de consultar las fuentes, con una escritura atómica; si ya es 2 o no existe, no escribe. Un registro 1 no se amplía sin convertirlo |

## Órdenes soportadas

- Actualización y paquete: `npm run datos:actualizar`, `datos:exportar`, `datos:catalogo`, `datos:estado` y
  `datos:reconstruir` (módulos de `plataforma_datos.orquestacion`).
- Catálogo de cursos: `python -m plataforma_datos.cursos.sembrar_almacen` (último recurso, cuando no hay copia
  conservada del almacén que restaurar: siembra el almacén operativo vacío y admitido; las altas llegan después de
  Cibernàrium, Cibervoluntarios y Claude Academy, HP LIFE y FUNDAE no vuelven sin restaurar, y `componer_catalogo`
  no publica mientras el almacén falte, no se lea o no tenga cursos; detalle en `plataforma_datos/cursos/README.md`),
  `python -m plataforma_datos.cursos.crear_catalogo --base BASE`,
  `python -m plataforma_datos.cursos.revalidar_catalogo` y `python -m plataforma_datos.cursos.catalogo` (`importar`,
  `buscar`, `resumen` y `aprendizaje`).
- Operaciones manuales: las de este documento (Digitalízate, Cibernàrium desde capturas, conciliación, consultas de
  vigencia y aprendizaje, ESCO, versión de Chrome, confirmación de la oferta del SOC pendiente y de las fechas de
  Citilab sin leer, levantamiento del bloqueo operativo y productores externos de IA y trabajo).
- Descriptores y README de las fuentes: `python -m plataforma_datos.contratos.fuentes --tema TEMA [--comprobar]`.

## Comprobar las operaciones

Las pruebas siguientes usan fixtures y bases temporales; no exigen capturas reales ni realizan publicaciones:

```sh
python -m unittest \
  plataforma_datos.cursos.pruebas.test_adaptador_digitalizate \
  plataforma_datos.cursos.pruebas.test_robot_cibernarium \
  plataforma_datos.cursos.pruebas.test_catalogo \
  plataforma_datos.cursos.pruebas.test_contrato_aprendizaje \
  plataforma_datos.cursos.pruebas.test_registro_vigencia \
  plataforma_datos.cursos.pruebas.test_vigencia_recurso_sin_edicion \
  plataforma_datos.cursos.pruebas.test_formacion_descarga \
  plataforma_datos.cursos.pruebas.test_citilab \
  plataforma_datos.orquestacion.pruebas.test_levantar_bloqueo
```

La prueba de captura real de Digitalízate solo se activa cuando se proporciona expresamente su ruta. El aislamiento de
red de la verificación general y los requisitos de desarrollo se explican en el [README de pruebas](../pruebas/README.md).
