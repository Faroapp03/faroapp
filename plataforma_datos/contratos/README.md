# Contratos de fuentes

`fuente.json` describe la identidad, significado, recursos, canales y operación de
una fuente. `fuentes.py` lo valida y devuelve estructuras inmutables; el esquema
publicado es `fuente.schema.json` (versión 1). El lector comprueba además las
referencias cruzadas, los IDs repetidos y la identidad de archivo y módulo.
No importa código indicado por JSON ni consulta red, reloj o configuración del hogar.

Los once descriptores iniciales están en `plataforma_datos/cursos/fuentes/`.
Los candidatos de ampliación no adquieren una operación activa por tener un lector.
Una licencia desconocida se conserva como `null` y se muestra como desconocida.
La licencia del código se consulta en `LICENSE`; no concede derechos sobre datos externos.

## Conexión con el ejecutor

```python
from plataforma_datos.contratos.fuentes import cargar_fuente, comprobar_lector

descriptor = cargar_fuente(identificador, tema="cursos")
comprobar_lector(
    descriptor,
    identificador=identificador,
    modulo=lector_importado.__name__,
    casa=lector_importado.FUENTE,
)
```

El ejecutor conserva su registro de imports estáticos y su orden de dependencias.
`descriptor.actualizacion` tiene los cinco campos de la política existente:
`politica`, `red`, `frecuencia`, `renovar_dias`, `originales`.
`descriptor.conjuntos` contiene los seis campos de cada comprobación:
`id`, `fuente`, `clase`, `alcance`, `operacion`, `intervalo_dias`.
`descriptor.dependencias` conserva el orden de las entradas del módulo.
Las clases son `PoliticaActualizacion` y `ConjuntoComprobacion`, ambas tuplas con nombre.
Al conectar un registro se retiran sus declaraciones duplicadas; los imports estáticos
siguen decidiendo qué código puede ejecutarse. La identidad de una casa puede ser
distinta al ID, como `memoria-fpcat` para `memoria`.

La entrada de actualización comprueba el registro antes de crear el cerrojo, el
ciclo o el área. Si la ficha y el productor discrepan, termina en rojo sin ejecutar
órdenes. Los originales, cuando existen, pertenecen a la casa del lector. Se
comprueban también la unicidad de los conjuntos y la correspondencia entre la
cadencia declarada y la realmente consumida por el planificador.

`cargar_descriptores(ids, tema="cursos")` conserva el orden recibido y rechaza fuentes
repetidas y conjuntos con IDs globales repetidos. Sin IDs descubre los `fuente.json`
del tema, en orden alfabético solo para documentación e inventario. Ese descubrimiento
no modifica el orden operativo. Un inventario de fuentes vacío no da una comprobación correcta. Una lectura candidata pura sí exige conjuntos vacíos y no acredita ninguna comprobación remota.
`validar_descriptor(objeto)` permite validar una entrada en memoria sin leer archivos.

La política textual `mensual` no se convierte en una cadencia de treinta días.
El intervalo de consulta, la frecuencia de publicación y la renovación manual son
conceptos distintos. Formación mantiene dos conjuntos: oferta SOC remota diaria y
catálogos locales por edición. Las revisiones manuales no se vuelven automáticas.

## Documentación generada

```sh
python -m plataforma_datos.contratos.fuentes
python -m plataforma_datos.contratos.fuentes --comprobar
python -m plataforma_datos.contratos.fuentes --fuente formacion --comprobar
python -m unittest plataforma_datos.contratos.pruebas.test_fuentes
```

`generar_readme(descriptor)` es una función pura. La CLI valida todos los descriptores
antes de generar; `--comprobar` no escribe. Devuelve 1 ante documentación ausente o
distinta y 2 ante entrada inválida o fallo de lectura/escritura. Las rutas se resuelven
desde el paquete; IDs con escapes y enlaces hacia fuera del paquete se rechazan.

El descriptor conserva declaraciones y referencias de los lectores. No acredita por
sí solo licencia externa vigente, captura completa, disponibilidad de una plaza o
programador instalado. Los controles de contenido, contratos de dominio y admisión
siguen siendo responsabilidad de sus lectores y del ejecutor.

## Lecturas candidatas y productores externos

La modalidad se deriva de cuatro formas excluyentes; no hay otro permiso configurable de activación:

| Modalidad | actualizacion | casa_datos | conjuntos | dependencias | produccion_local |
| --- | --- | --- | --- | --- | --- |
| operativa | política existente | casa real | al menos uno, fuente=ID | entradas del módulo | null |
| lectura-candidata | null | null | vacíos | vacías | null |
| productor-externo | null | casa real | fuente=null, externa/productor-externo/revision, sin intervalo | entradas reales del productor | null |
| productor-local | null | null | vacíos | vacías | órdenes locales declaradas |

`DescriptorFuente.modalidad` expone esa distinción. Las formas parciales se rechazan: null no permite omitir la política de una fuente activa ni inventar una descarga para un lector puro. Los IDs de casas no nulas son únicos en cada carga; el registro contrasta además todos los productores estáticos, incluidos los externos. Dos null de lectores puros no representan una casa compartida.

Claude Academy y HP LIFE son fuentes operativas: sus fichas declaran casa, política de actualización y conjuntos. Sus lectores conservan los controles de recepción y no convierten un fallo en disponibilidad o licencia acreditada. La documentación se genera desde cada ficha; `contrato-lectura.md` describe además las funciones de lectura.

`ia_nacional` y `encuestas_isco4` conservan sus casas reales y sus comprobaciones externas con fuente=null. No tienen política ni cadencia de consulta en el registro principal; las frecuencias de sus encuestas no se convierten en intervalos automáticos. La segunda conserva como entradas reales `oit` y `clasificaciones`. Sus CLI existentes preparar/validar sí se documentan, sin activarlas.

En `orquestacion.modulos`, `PRODUCTORES_EXTERNOS` y `PRODUCTORES_LOCALES` son listas de imports estáticos separadas de FUENTES/MODULOS y del candidato operativo Chrome. Verifican identidad, modalidad, casas, separación de activos y comprobaciones externas. La modalidad de lectura candidata se conserva en el contrato de fichas y en la lectura de estados históricos; no hay lectores pasivos inscritos en el registro de ejecución. Una ficha de ID arbitrario sigue fallando; el JSON no importa código ni añade operaciones. Añadir metadata no admite conjuntos, confirma publicaciones, comprueba acceso remoto ni instala tareas.
