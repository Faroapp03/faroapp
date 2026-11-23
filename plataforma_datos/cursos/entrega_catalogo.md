# Entrega operativa del catálogo de Cursos

Este componente es la única proyección pública del catálogo SQLite V10 admitido.
La investigación conservada aporta decisiones y pruebas históricas consultables;
no se repite su importación para preparar una entrega cotidiana. No
consulta Internet, evalúa vigencia, migra SQLite, activa productores o modifica
el catálogo. Un recurso sin edición no recibe una edición artificial.

## Interfaz

```python
SolicitudEntrega(
    admision=SolicitudAdmision(...),
    instalacion=...,
    sha256_admision=...,
    area=...,
    corte_utc=...,
    naturalezas_referencias_id=None,
)
preparar(solicitud)
validar(solicitud)
exportar(solicitud, destino=...)
```

La admisión cotidiana debe corresponder a los bytes exactos de la instantánea V10,
procedencia, código y contratos efectivos. Se reutiliza su guarda y la admisión
común; no existe un nuevo diario de autorización. El área y el destino son
explícitos, portables y exclusivos. El corte de proyección se suministra en UTC;
no es una fecha de recepción ni rejuvenece las observaciones. Un corte anterior
a la última evaluación se rechaza, sin escoger otra historia silenciosamente.

`preparar` produce dos archivos con funciones distintas: `catalogo-cursos.json`
es el único recurso estático público; `linaje-privado.json` conserva la entrada admitida (con el estado de la regla
de retirada de cada fuente de la `instalacion`, que decide qué retiene la selección) y
`catalogo_privado`, con el catálogo factual completo, estados del registro,
cobertura por dominio y motivos de retención en esta proyección. Este último
nunca se exporta como recurso web. `validar` reproduce ambos desde la instantánea
y escribe el informe estándar vinculado a sus hashes. `exportar` verifica la
admisión y sus vínculos sin replay ni auditoría histórica global. Una petición
web solo lee bytes estáticos; no accede a SQLite ni prepara datos.

## Contrato público 3

[entrega_catalogo.json](esquemas/entrega_catalogo.json) es el único contrato público.
Todos los objetos usan listas cerradas de campos. La raíz contiene versión,
corte de proyección, revisión lógica, derechos, proveedores de las ofertas
incluidas, ofertas y recuentos públicos por recurso/edición. El consumidor debe
verificar el SHA externo de los bytes fijado por composición de la entrega.
`revision` es un hash lógico Python: no se equipara a JCS ni se debe recalcular
con JSON.stringify para acreditar integridad del archivo.

El productor escribe el JSON compacto en `web/datos/catalogo-cursos/<sha256>.json`.
Sus bytes forman parte de la identidad del artefacto: no se reformatean a mano.
Biome conserva el análisis del JSON y excluye únicamente su formateo; la
comprobación de artefactos y el lector público verifican su huella y contrato.

Cada oferta identifica `{tipo, id, programa_id}` y su proveedor. Conserva el
título y tipo del programa como tales, hechos de la unidad evaluada, referencias,
URL específica, fecha de comprobación, límite publicado (`cierra_el`, o null si
la fuente no publica ninguno) y corte de evaluación. Los
hechos de una edición no se rellenan heredando los de su programa o variante.
Una edición usa exclusivamente `evaluacion.entradas.oferta.url`; nunca recibe
la URL del programa como enlace alternativo. Un recurso exige URL igual a su
columna nativa. Los programas con cualquier edición no son recursos evaluables:
la proyección usa el dominio real del registro y conserva vigencia de recurso
null para esos programas padres en el privado.

Solo se seleccionan resultados nativos `evaluado` y `disponible-publicamente`,
con cuerpo/evaluador actuales, identidad/URL y soportes contractuales suficientes,
y fechas que cumplan:

```
comprobado_el <= corte_evaluacion_utc <= corte_proyeccion_utc
corte_proyeccion_utc < cierra_el   (solo si cierra_el no es null)
```

`cierra_el` es el primer límite publicado con evidencia (fin de matrícula, fin de
acceso o fin de la formación). Si el corte lo alcanza, la oferta se retiene con
`limite_publicado_alcanzado_en_corte`. La próxima revisión interna de Faro
(`revisar_el`) y el último intento fallido (`ultimo_intento_fallido_el`) van al
linaje privado y al panel: avisan, pero no retiran la oferta ni cambian sus datos.
Una incidencia del enlace (404/410, redirección sin identidad o ficha de otro curso)
tampoco retira la oferta: el linaje privado conserva `incidencia_enlace` con su tipo
y la oferta pública lleva solo `incidencia_enlace_el`, la fecha para avisar de que el
enlace falló, que es posterior a `comprobado_el` y no posterior a
`corte_evaluacion_utc`.
Un resultado de evaluación de una versión anterior, sin `cierra_el`, se retiene
hasta reevaluarlo.

No se ejecuta otro evaluador. Los validadores y vínculos existentes comprueban
las entradas del resultado heredado; no se transforma un acceso o calendario
indispensable desconocidos en apertura. Una apertura continua confirmada no
necesita inventar un calendario fijo. La falta de metadatos de acceso personal
no implica elegibilidad ni incompatibilidad de una persona. Los motivos de
insuficiencia, límite alcanzado o decisión no acreditada permanecen privados. No se
publican unidades ocultas, estado del registro, diagnósticos internos, políticas,
entradas del evaluador, cuerpos o rutas locales.

Los recuentos públicos describen solo ofertas acreditadas en este artefacto y
corte; una lista vacía no afirma que no existan cursos. El consumidor retira la
oferta cuando su reloj alcanza `cierra_el`, sin modificar fechas; los hechos no
caducan con su reloj. Emitir el archivo no confirma
que ya se haya promovido, servido o publicado: la activación de entrega sigue
siendo responsabilidad de la orquestación común.

Variantes, anuncios y centros permanecen privados. No se exportan como entidades
públicas sin procedencia completa, y no hay referencias públicas a centros
omitidos. Los vínculos internos siguen acreditados por el SQLite admitido.

## Clasificación de cada oferta (versión 7)

La versión 7 del contrato es la 6 con un bloque opcional más en cada oferta, `clasificacion`, donde el productor dice el
idioma, el nivel y la materia del curso. La versión cambia porque el contrato es cerrado: un lector de la 6 rechaza
cualquier campo que no conoce, así que una entrega con el bloque no puede presentarse como 6. El productor emite la 7;
una 7 sin ningún bloque admite exactamente las mismas ofertas que la 6, y los lectores admiten las dos porque la entrega
publicada en `web/datos/catalogo-cursos/` es una 6.

El bloque lleva al menos uno de sus tres datos (`idioma`, `nivel`, `materia`), y cada uno es opcional: un dato ausente
es uno que su fuente todavía no clasifica en el productor, no un dato «por confirmar». Cada dato tiene estos campos,
todos presentes y sin ningún otro:

| Campo | Qué dice | Valores admitidos |
|---|---|---|
| `valores` (idioma y materia) o `valor` (nivel) | El dato. Un curso puede tener varios idiomas o materias, en orden y sin repetir; el nivel es uno solo. | Idioma: `ca`, `en`, `es`. Nivel: `inicial`, `intermedio`, `avanzado`. Materia: las del filtro de Cursos (`ia`, `digital`, `ofimatica`, `datos`, `seguridad`, `empresa`, `oficio`, `diseno`, `web`, `comunicacion`, `empleo`, `ciudadania`, `educacion`, `sistemas`). `null` si está por confirmar. |
| `estado` | Quién lo afirma. | `fuente` (lo publica la fuente oficial), `orientacion-faro` (lo deduce una regla de Faro) o `por-confirmar`. |
| `alcance` | A qué se refiere la evidencia. | `edicion`, `programa`, `norma-general` o `actividad`; `null` si está por confirmar. |
| `certeza` | Cuánto se puede confiar en el dato. | `alta`, `media` o `baja`; `null` si está por confirmar. |
| `regla` | La regla de Faro que lo decidió. | `{id, version, sha256}`: un identificador en minúsculas con guiones, una versión entera desde 1 y la huella del código de la regla. Solo en `orientacion-faro`, donde es obligatoria; `null` en los demás. |
| `evidencias` | Los documentos en que se apoya. | Lista de `{url, sha256, capturado_utc, localizador}`, en orden y sin repetir, con un máximo de 50. La URL es pública y de un dominio; ninguna captura es posterior al corte de la entrega. |
| `motivo_por_confirmar` | Por qué falta el dato. | Obligatorio en `por-confirmar` y `null` en los demás: `sin_captura` (sin evidencias), `fuente_no_publica` (al menos la captura que muestra que la fuente no lo publica) o `conflicto_evidencias` (al menos dos capturas que se contradicen). |

Reglas que se exigen: no hay valor sin evidencia ni regla; `fuente` exige al menos una evidencia; `por-confirmar` no
lleva valor, alcance, certeza ni regla; ningún campo admite texto libre. Los textos que lee la persona los pone la web a
partir de estos códigos, en castellano y en catalán.

La pieza común está en [clasificacion/contrato.py](clasificacion/contrato.py): `validar_bloque` valida el bloque tal
como viaja, y los tipos `Clasificacion`, `DatoClasificado`, `Evidencia` y `Regla` no se pueden construir si incumplen
el contrato. Cada fuente implementa `clasificar(oferta, evidencias)` en `fuentes/<fuente>/clasificacion.py`, con la
interfaz `Clasificador`.

### Cómo clasifica una fuente sus ofertas

La proyección compone las ofertas públicas y, antes de validar la entrega, `clasificacion/emision.py` pregunta por cada
oferta al clasificador de su proveedor. La tabla está en `clasificacion/registro.py`, con importaciones normales:

| Proveedor en la entrega (`proveedor_id`) | Fuente | Clasificador |
|---|---|---|
| `cibernarium` | Cibernàrium (Barcelona Activa) | `fuentes/barcelonactiva/clasificacion.py` |
| `cibervoluntarios` | Cibervoluntarios | `fuentes/cibervoluntarios/clasificacion.py` |
| `fundae:publicador:catalogo:1`, `fundae:publicador:catalogo:3` | FUNDAE | `fuentes/fundae/clasificacion.py` |
| `hp-life` | HP LIFE | `fuentes/hp_life/clasificacion.py` |
| `anthropic` | Anthropic Academy | `fuentes/claude_academy/clasificacion.py` |

El clasificador recibe la oferta tal como viaja, sin el bloque, y sus capturas: una `Evidencia` por cada referencia de
la oferta, con el localizador `#` (el documento entero). Si se apoya en una parte concreta de un documento, construye su
propia evidencia con el localizador de esa parte. Devuelve una `Clasificacion` con los datos que decide, o `None` si no
decide ninguno; entonces la oferta viaja sin bloque. El bloque se valida contra el corte de la entrega, y la revisión de
la entrega se calcula con los bloques ya puestos. Un resultado que no es una `Clasificacion` detiene la entrega. Un
proveedor que no está en la tabla viaja sin bloque, y la prueba de paridad exige que todos los proveedores del catálogo
publicado estén en ella.

Para que una fuente clasifique un dato, se cambia solo su `clasificacion.py` (y los módulos propios que lea), sin tocar
la proyección. Todo el código de la clasificación (`registro.CODIGO`) forma parte de la huella `codigo_proyeccion` de
la entrega.

### Paridad con lo que ve la persona

`python -m plataforma_datos.cursos.clasificacion.paridad [--fuente <proveedor>] [--comprobar]` aplica el clasificador de
cada fuente a sus ofertas del catálogo publicado y compara cada dato (idioma, nivel y materia), oferta a oferta, con la
foto de referencia de la web (`pruebas/fixtures/foto-clasificacion-20261118.utf8`). Cada comparación da `igual`,
`distinto` (con el valor de la foto y el del productor) o `sin-decidir` (la fuente no decide ese dato en el
productor). Solo lee.

Así se leen los orígenes de la foto en el contrato. Un dato es igual cuando coinciden el estado, el valor y, si el
origen lo fija, el alcance:

| Dato | Origen en la foto | Estado en el contrato | Alcance exigido |
|---|---|---|---|
| idioma | `edicion` | `fuente` | `edicion` |
| idioma | `programa` | `fuente` | `programa` |
| idioma | `norma-general` | `fuente` | `norma-general` |
| idioma | `faro`, `historial-cibernarium` | `orientacion-faro` | cualquiera |
| nivel | `fuente` | `fuente` | cualquiera |
| nivel | `faro` | `orientacion-faro` | cualquiera |
| materia | `revision-editorial`, `otra-orientacion-de-faro` | `orientacion-faro` | cualquiera |
| los tres | por confirmar (sin origen) | `por-confirmar` | — |

Un origen que no está en esta tabla detiene la comparación: antes hay que decidir cómo se lee. La salida de hoy, por
proveedor y dato, está en `pruebas/fixtures/paridad-clasificacion.json`: todo `sin-decidir`, ningún `distinto`. La
prueba `pruebas/test_clasificacion_emision.py` exige que la paridad coincida con ese archivo. El cambio de una fuente
actualiza solo su apartado: así se ve su avance, y ninguna otra fuente puede cambiar sin que la prueba falle.

Un dato que publica la fuente:

```json
{
  "idioma": {
    "valores": ["es"],
    "estado": "fuente",
    "alcance": "edicion",
    "certeza": "alta",
    "regla": null,
    "evidencias": [
      {
        "url": "https://www.cibervoluntarios.org/api/public/activity_catalogs",
        "sha256": "<64 cifras hexadecimales>",
        "capturado_utc": "2026-11-18T08:00:00Z",
        "localizador": "/hydra:member/0/language"
      }
    ],
    "motivo_por_confirmar": null
  }
}
```

Una orientación de Faro:

```json
{
  "nivel": {
    "valor": "intermedio",
    "estado": "orientacion-faro",
    "alcance": "programa",
    "certeza": "media",
    "regla": { "id": "nivel-objetivos-fundae", "version": 1, "sha256": "<64 cifras hexadecimales>" },
    "evidencias": [
      {
        "url": "https://agora.fundae.es/Oferta/RecuperarDifusionesRFO?codigoTitulacion=IFCD0112",
        "sha256": "<64 cifras hexadecimales>",
        "capturado_utc": "2026-11-18T08:00:00Z",
        "localizador": "/curso/objetivos"
      }
    ],
    "motivo_por_confirmar": null
  }
}
```

Un dato por confirmar:

```json
{
  "materia": {
    "valores": null,
    "estado": "por-confirmar",
    "alcance": null,
    "certeza": null,
    "regla": null,
    "evidencias": [],
    "motivo_por_confirmar": "sin_captura"
  }
}
```

Los ejemplos completos y los casos que se rechazan están en `pruebas/fixtures/clasificacion-catalogo-ejemplos.json`,
que leen las pruebas de Python y de TypeScript para que los dos lados exijan lo mismo.

## Hechos, desconocidos y referencias

Cada hecho conserva `valor`, `motivo`, `unidad`, `moneda` y `alcance`. Null no
significa false, español, gratis, sin requisitos o cerrado. Los motivos son
`conocido`, `no_consta_en_evidencia`, `no_interpretable`,
`sin_soporte_de_campo`, `texto_no_redistribuido`,
`declaraciones_contradictorias`. Un conflicto no elige otro alias por orden.
Un hecho fechado lleva `vigencia: {comprobado_el}`, la fecha de su propia captura,
que nunca es posterior al corte de proyección.

Los idiomas declarados siguen separados del material observado. No se deduce
idioma íntegro desde ficha, API o una muestra. Modalidad, sincronía, horas y
costes reutilizan los normalizadores y vocabularios existentes. Las lenguas se
comparan como conjuntos de literales; no se traducen códigos. Horas conservan
unidad h; una moneda ausente permanece null. Un certificado gratuito no hace
gratuita toda la formación. El alcance procede del origen explícito.

Acceso FUNDAE, marca comercial, niveles de entrada/salida y calendarios de
matrícula/formación/aula tienen campos explícitos. Mientras no exista una
proyección normalizada con soporte y derechos suficientes, quedan null con
`sin_soporte_de_campo`. No se crean clasificadores, periodos ni reglas de acceso.
Esto no borra los datos privados ni reemplaza los calendarios que ya interpretó
el evaluador para calcular su vencimiento. Los requisitos en prosa ajena no se
redistribuyen y null nunca significa ausencia de requisitos.

Las referencias solo contienen URL, SHA, fecha de referencia y su naturaleza.
El ID lógico opcional de naturalezas debe estar entre las referencias admitidas;
se valida su mapa acotado y cada vínculo por ID/URL/SHA/fecha. No exige el formato
completo de investigación V2. Si falta vínculo inequívoco, naturaleza desconocida;
las claves contradictorias no eligen el último valor. Ningún auxiliar hereda
recepción por pertenecer al mismo proveedor. Una fecha declarada histórica no
se etiqueta captura, ni un árbol derivado se presenta como original HTTP.
Estas referencias documentan la entidad, no todos sus campos individualmente.

## Origen y derechos por campo

La siguiente lista es el mapeo operativo revisado. No es una autorización genérica de contenidos ni una licencia creada por Faro. Las licencias de recursos HP LIFE, Cibervoluntarios y Claude Academy siguen desconocidas según sus `fuente.json`; la disponibilidad pública de HTML/API no concede redistribución de textos, vídeos o material didáctico. Los demás proveedores conservan los derechos declarados por sus productores y documentos de origen. Solo se entrega la identificación/enlace y los hechos estructurados enumerados; el resto permanece en el almacén privado. Una ampliación de campos exige revisión de su origen, alcance y derechos.

| Campo público | Entrada exacta admitida | Alcance y retención |
| --- | --- | --- |
| Identidad, proveedor, título y URL | Columnas propias de programas/proveedores; IDs relacionales de ediciones/variantes/anuncios | Nominación factual y enlace; no descripción ni contenido. |
| Idiomas declarados | `idiomas_publicados` HP, `idiomas` Academy, `idioma_literal` Ciber, `idioma_publicado` de programas, `idioma_fuente` de variantes FUNDAE, `idioma_ficha_principal` de ediciones y `hechos_ficha_principal.idioma_publicado_ficha` Cibernàrium (estos dos, releídos con la regla de `fuentes/barcelonactiva/idioma_ficha.py`) | Declaración de esa unidad; no lectura íntegra de materiales. Un literal más largo que `MAX_LITERAL` o que contiene «:» (el rótulo de otro campo de la ficha) queda `no_interpretable`. |
| Modalidad y sincronía | Campos estructurados homónimos de la entidad y `modalidad_normalizada` de variantes FUNDAE; normalizadores de fichas | No se heredan de otra edición, variante o título. |
| Horas | `horas_publicadas` de ficha normalizada, `hechos_ficha_principal.horas_publicadas_ficha`, o total reconocido por `normalizar_horas` | Duración publicada, no esfuerzo individual estimado. |
| Tipo de coste formativo | `coste_formacion_tipo` y `costes_publicados.formacion` | Clasificación exacta total/parcial; declaraciones del marco de HP/Ciber quedan `declaracion_general` solo con su proveedor explícito. Un diccionario de importe no se convierte en general por su forma; FUNDAE exige además el literal de alcance general ya revisado. |
| Importe de formación/certificado/prácticas | Objetos explícitos `importe`/`moneda` de `coste_formacion`, `coste_certificado`, `coste_practicas` o `coste_practica_publicado`; `matricula_eur` y `certificado_coste_eur` Cibernàrium | No se interpreta prosa ni se asigna moneda ausente. No implica derecho a plaza. |
| Certificado gratuito | `costes_publicados.certificado_finalizacion_gratuito_declarado` HP | Declaración general, distinta de formación y prácticas. |
| Registro previo | `requisitos_publicados.registro_previo_para_inscribirse` HP | Booleano explícito del marco, con alcance general cuando el origen es HP; no edad, acceso personal ni elegibilidad. |
| Otros requisitos | `requisitos_publicados` o `requisitos_conocimientos_titulacion`: prosa/objetos no cubiertos por el booleano anterior | Nulos con motivo; no se redistribuye texto extenso ni se afirma que no existan. |
| Referencias | `vinculos_evidencia`/`evidencias`, campos públicos de URL, fecha de referencia y SHA, relacionados con el soporte principal exacto cuando existe | Soporte por entidad, sin copiar documentos ni conceder licencia de sus cuerpos. |

El DTO conserva `licencia_contenidos: null` y `redistribuye_contenidos: false`. No agrega una autorización jurídica por proveedor. El linaje privado y los originales deben permanecer fuera de la respuesta pública; el frontend no recibe esos ficheros por este módulo.

## Condiciones de cada edición Cibernàrium

La proyección reextrae los hechos de la captura seleccionada y comprueba su
igualdad con la observación admitida. El control vincula actividad, edición,
cuerpo API, último intento de normas y última respuesta identificada de normas.
Las condiciones se indexan por tipo e identidad: una edición no hereda los hechos
de otro programa aunque coincida el texto de su identificador.

La matrícula acreditada permite solicitar la edición; no garantiza plaza,
admisión personal ni acceso al aula antes de su apertura. No se inventa un plazo
de inscripción para justificarla. Gratuidad de formación y registro previo tienen
el alcance de las normas generales y la fecha de su propia captura. Una consulta
nueva al API no renueva ni invalida esas declaraciones. Un fallo técnico conserva
la comprobación anterior con su fecha; una respuesta identificada que ya no
sostiene la condición la deja desconocida, sin rescatar otra respuesta favorable
del historial.

El contrato público conserva la fecha de cada hecho acreditado y sus referencias.
El tiempo transcurrido no anula un hecho: deja de afirmarse solo si una respuesta
identificada lo contradice o si vence un límite publicado de la oferta. No se
cambia la fecha de comprobación de la edición ni se afirma que el curso haya
cerrado. La vista de formación gratuita exige la gratuidad acreditada y suficiente
además de la matrícula.

## Conservación y límites

Solo se lee una SQLite V10 congelada y admitida. Un cambio de bytes, procedencia,
código o contrato obliga a otra admisión; no se salta la guarda por cadencia.
Las revisiones de paginación se validan por dominio del registro. Las decisiones,
observaciones y fechas anteriores se conservan en su historia nativa, sin otro
diario. La selección de retenciones privada describe esta preparación; no afirma
que una oferta se haya ocultado o reaparecido públicamente.

Repetir las mismas entradas y corte conserva bytes y mtime. La exportación usa
un temporal propio y reemplazo local atómico; un fallo conserva el destino
anterior. No se promete persistencia frente a pérdida de alimentación, porque
no se hace fsync de archivo/directorio. Los artefactos parciales de preparación
no pueden exportarse si sus huellas no concuerdan. Se rechazan hoja/padres con
symlinks y alias duros de entradas, incluidos informe admitido y laterales SQLite.
La exclusión operativa de otros escritores sigue siendo necesaria; no se afirma
protección de sistema operativo frente a carreras hostiles.

Límites: 32 MiB por proyección pública/privada, 128 MiB por mapa opcional de
naturalezas, 4 MiB por datos JSON de fila, 100.000 filas por colección y referencias,
100.000 ofertas públicas. La admisión mantiene además sus límites de instantánea y
procedencia. Las lecturas de preparados, informes y DTO son acotadas. No hay
nuevas dependencias. El catálogo y su consumidor se entregan de forma independiente
de Ocupaciones; ninguna de estas operaciones importa el selector antiguo.

## Calendarios por edición

`calendario_entrega.py` proyecta matrícula, formación y acceso al aula por separado.
Cada fecha exige una relación explícita con la edición seleccionada, soporte
localizado y la fecha de su propia comprobación. No se heredan fechas del programa. Las sesiones
son una lista exacta; un periodo general no acredita sesiones individuales. Los
valores conservan su precisión y zona declaradas. Un calendario contradictorio,
ilegible o sin fecha de comprobación propia conserva un motivo de desconocimiento;
el tiempo transcurrido no lo anula.
