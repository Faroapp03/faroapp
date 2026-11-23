# Muestra de los preparados de formación

Líneas copiadas sin cambiar de `var/actualizacion/preparados/formacion/` de la instalación de Faro, tal como los dejó la
preparación de la fuente `formacion` con los originales del 27/09/2026 (cursos del SOC y catálogo del SEPE) y la
correspondencia EURES:

- `soc-cursos.jsonl`: las líneas 1 y 2.
- `sepe-especialidades.jsonl`: las líneas 1 (ADGD093PO) y 4052 (SEAD0058).
- `esco-cosispe.jsonl`: las líneas 1 y 2.

Las pruebas de `test_enlaces_lector.py` montan con ellas la instalación como es: preparados y `validacion.json` de
`formacion`, sin `validados/formacion/formacion.json`, que la instalación no tiene.
