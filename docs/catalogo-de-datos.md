# Inventario de metadatos de Faro

`plataforma_datos/orquestacion/catalogo_de_datos.py` reúne metadatos de los registros operativos existentes.
Permite seguir una fuente hasta sus conjuntos, archivos y consumidores identificados, y detectar
huecos antes de completar su actualización. No configura una segunda cadena ni modifica datos.

## Consulta

Desde una copia de Faro con su entorno instalado:

```sh
npm run datos:catalogo
```

Para consumir JSON sin los mensajes de npm:

```sh
.venv/bin/python -B -m plataforma_datos.orquestacion.catalogo_de_datos
```

La salida (versión 2) contiene `version`, `nodos`, `relaciones`, `sin_exportacion_individual`, `limites` e `incidencias`. No crea archivos,
no hace peticiones de red ni ejecuta productores. El código de salida cero significa que pudo
construir el inventario; las incidencias se consultan dentro del JSON, no mediante ese código.
Si falta un registro obligatorio o cambia su forma, falla explícitamente.

`--raiz` permite observar los archivos de otra carpeta. Los registros Python siguen siendo los
del código ejecutado: para auditar otra versión de Faro hay que ejecutar el módulo desde esa
versión. Las rutas emitidas son relativas; no se incluyen contenidos de originales, modelos,
registros de uso, credenciales o respuestas de personas.

## Qué conserva

| Entidad | Metadatos y evidencia |
| --- | --- |
| Fuente | Adaptador, política y dependencias de los registros operativos. |
| Conjunto | ID, clase original, operación, alcance e intervalo declarado. |
| Recurso o derivado | Ruta, existencia, productor declarado, procedencia y huellas del manifiesto. |
| Biblioteca | ID, tipo, títulos, fuente, enlace, consulta, licencia, fecha, idiomas y formato registrados. |
| Relación | Entrada, salida, localizador de la declaración y carácter declarado u observado. |

Los temas de fuentes se clasifican editorialmente: Cursos, Ocupaciones, IA y trabajo,
Mercado, Derechos y Biblioteca; `comun` reúne las fuentes compartidas y `derivados` los
productores de datos calculados. Los identificadores de `dominio` coinciden con las carpetas
del diseño. El [mapa de la plataforma](../plataforma_datos/README.md) describe sus responsabilidades.
Una fuente no puede pertenecer a dos temas; una fuente desconocida sigue sin clasificar.
La clasificación no modifica el paquete público ni las decisiones de los motores.

`sin_exportacion_individual` identifica conjuntos que no se entregan como archivo propio.
No significa «datos sin uso»: por ejemplo, EAES alimenta Mercado sin un archivo `datos/eaes.json`.
Las relaciones conservan ese consumo indirecto.

Un derivado conserva los dominios de sus
orígenes y puede tener varios. Las entradas cuyo dominio se desconoce quedan explícitas en
`clasificacion_dominio.origenes_sin_dominio`. Este inventario no clasifica competencias de cursos.

La pertenencia de un archivo a una carpeta de fuente acredita una propiedad declarada; no prueba
que el adaptador regenere cada archivo. La copia de modelos o vectores admitidos se distingue de
su entrenamiento. La relación editorial lectura → índice acredita que la Biblioteca la incluye,
no que Faro produzca el documento externo.

## Incidencias y límites

- `referencia-rota`: una relación o productor apunta a un ID que no existe.
- `id-duplicado`: el objeto recibido repite un ID; construir desde registros duplicados falla.
- `archivo-ausente`: el recurso registrado no está en la raíz observada.
- `ciclo-o-dependencia-bloqueada`: un ciclo impide ordenar parte del grafo; incluye descendientes bloqueados.
- `sin-productor`: una entrada consumida no tiene productor acreditado en este inventario. Su
  cobertura distingue documentación editorial, entradas externas, recursos admitidos y huecos.

`sin-productor` no significa automáticamente error u obsolescencia. Una lectura externa puede
ser legítimamente editorial. Las entradas fijadas de Métodos, sin consulta periódica, son un hueco de automatización
distinto del origen de un modelo entrenado fuera de la aplicación.

Las huellas se transcriben del manifiesto: no se recalculan los originales. La existencia de una
cadencia no acredita un programador instalado. Tampoco se certifican vigencia, ejecución real,
actualización del servidor ni uso efectivo en una sesión. Los consumidores se limitan a las
tablas e importaciones leídas: no es un análisis exhaustivo de todas las llamadas del producto.

## Verificación

Las pruebas están en `plataforma_datos/orquestacion/pruebas/test_catalogo_de_datos.py`, dentro del descubrimiento
normal de Python. Cubren procedencia conectada, metadatos conservados, duplicados, referencias,
ciclos, entradas externas y consultas sin escrituras desde una ruta con espacios y caracteres Unicode.


## Criterio de clasificación

La casa de cada fuente corresponde a su contenido principal, no a su formato ni al
consumidor que la consulta. `textos` contiene las tareas de la OIT en castellano y
pertenece a Ocupaciones; `cambra` contiene un estudio de exposición a la IA por sexo
y pertenece a IA y trabajo. Que otra área consuma esas fuentes no crea un segundo
adaptador ni cambia su propiedad. La Biblioteca conserva sus lecturas editoriales:
no se confunde con todos los archivos que contienen texto. El productor `lecturas`
de `plataforma_datos/biblioteca/` prepara y valida su catálogo editorial, y el
exportador común entrega sus 75 registros conservando sus fechas. Esta conexión
acredita procedencia local; no acredita por sí sola una comprobación remota. El productor
`enlaces_lecturas` está registrado en la orquestación y alimenta `datos/observaciones-lecturas.json`.
El generador de Biblioteca y su consumidor web usan esa proyección: distinguen el último intento
de la última comprobación válida y conservan las fechas reales. La falta de observaciones
significa que no se sabe, sin cerrar las lecturas. Que el productor esté conectado no demuestra
que la tarea periódica esté instalada o que una consulta remota concreta haya terminado.

El registro impide propietarios duplicados y las pruebas conservan estas dos
clasificaciones. La asignación requiere revisar qué mide cada fuente;
esta comprobación no interpreta por sí sola el significado de una fuente nueva.
