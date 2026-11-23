# Ocupaciones

Fuentes de ocupaciones, tareas y correspondencias oficiales. Cada lector tiene
una sola implementación en `fuentes/<id>/lector.py`, su ficha operativa y un
README generado. La cadena común conserva el orden de dependencias, la admisión
y la exportación; los archivos operativos siguen en `var/actualizacion/`.

| Fuente | Contenido | Dependencias |
| --- | --- | --- |
| [ESCO](fuentes/esco/README.md) | Ocupaciones, competencias, relaciones y biblioteca SQLite de la versión admitida. | Ninguna. |
| [OIT](fuentes/oit/README.md) | Tareas ISCO-08 y exposición a IA generativa del estudio publicado. | Ninguna. |
| [Clasificaciones](fuentes/clasificaciones/README.md) | CNO-11, CIUO-08 y correspondencia oficial. | OIT validada. |
| [Textos](fuentes/textos/README.md) | Redacciones y traducciones propias sobre las tareas oficiales. | OIT validada y capturas de autoría. |

Los auxiliares ESCO viven junto a su lector, en `piezas/`. `fuentes/esco/piezas/consultas.py` ofrece
consulta local de solo lectura; `exportacion/` compone ESCO y textos para el
paquete. Los archivos del motor, sus modelos y su sello permanecen en el motor.
IA y trabajo consume la exposición desde la entrega, sin repetir el lector OIT.

```sh
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.lector preparar
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.lector validar
.venv/bin/python -m plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas buscar recepcionista
.venv/bin/python -m plataforma_datos.contratos.fuentes --tema ocupaciones --comprobar
```

Preparar y validar usan las entradas conservadas y no consultan la red. Las
políticas de actualización mantienen el alcance anterior: ESCO está fijada por
versión; OIT y clasificaciones consultan una edición conocida; textos requiere
capturas de autoría. La actualización no descubre versiones nuevas ni admite
cambios de significado sin sus controles. Una descarga fallida no acredita una
retirada.

Las pruebas propias están en `pruebas/`. La guarda común contrasta los descriptores
con los lectores y con una referencia operativa fijada
(`plataforma_datos/contratos/pruebas/operacion-ocupaciones-v1.json`).
