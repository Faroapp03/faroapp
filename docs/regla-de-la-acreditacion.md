# Operación de las relaciones de acreditación

La [norma fijada](acreditacion/norma-fijada.md) conserva exactamente el documento que respalda las relaciones
admitidas. Su huella SHA-256 es `a141f1b2c9ff92acc6b19845549c79a92a2ead02ea2d403040a64bbd779d56c8`.
Las decisiones, cifras, citas y fechas de esa norma no cambian al trasladar el archivo.

Esta guía describe las rutas y herramientas de la instalación actual. No sustituye la norma, no constituye
una revisión humana nueva y no autoriza a renovar las listas por un cambio de rutas.

## Entradas y lectores vigentes

| Función | Ruta desde la raíz de Faro |
| --- | --- |
| Relaciones admitidas | `var/actualizacion/revisiones/acreditacion/admitidas.tsv` |
| Relaciones descartadas | `var/actualizacion/revisiones/acreditacion/descartadas.tsv` |
| Lectura estricta de las listas y su procedencia | `plataforma_datos/cursos/fuentes/acreditacion/piezas/revision.py` |
| Propuesta determinista de relaciones | `plataforma_datos/cursos/fuentes/acreditacion/relaciones.py` |
| Ubicación y huella de la norma aplicable | `plataforma_datos/cursos/fuentes/acreditacion/piezas/constantes.py` |

Las referencias `datos/revisiones/acreditacion/`, `cadena_de_datos/fuentes/admitidas.py` y
`cadena_de_datos/fuentes/relaciones.py` que aparecen dentro de la norma fijada son citas de ese documento;
no son rutas ni órdenes que deban ejecutarse en la instalación actual. Las rutas operativas son las de la tabla.

El programa que escribió las listas a partir de los cuatro juicios de revisión no forma parte de la entrega.
La cadena utiliza las listas admitidas y descartadas suministradas, con su cita, decisión, fecha, identificador
y huella de regla; no produce una revisión nueva ni inventa juicios ausentes.

## Integridad

`REGLA_DE_LA_REVISION` señala el archivo normativo, y `HUELLA_DE_LA_REGLA` mantiene la misma huella.
La comprobación de integridad lee sus bytes completos. El lector de listas exige en cada fila admitida
los doce primeros caracteres de esa huella y conserva las validaciones de cabecera, cita, decisión, fecha e identificador.
Una lista con otra regla se rechaza; no se admite una firma nueva por la corrección de esta guía.

Las instrucciones de actualización y conservación de entradas operativas están en la
[guía de comprobaciones periódicas](comprobaciones-periodicas.md). Los originales, licencias y listas no se
modifican para hacer coincidir rutas de documentación.
