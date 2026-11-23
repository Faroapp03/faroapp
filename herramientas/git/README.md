# Juntas sin código nuevo

`npm run juntas:comprobar` ejecuta `comprobar-juntas.ts`. Sin parámetros comprueba todas las juntas alcanzables desde
`HEAD`, desde todas las raíces del repositorio, incluidas las ramas secundarias integradas. Un Git nuevo no necesita
un commit de origen de otro repositorio ni una excepción de configuración.

Una línea añadida (`++`) o retirada (`--`) respecto de todos los padres por `git show --cc` hace fallar la guarda. Las
huellas no son una excepción: resolver eligiendo el contenido de un padre, guardar la junta y regenerar después en su
propio commit. Cualquier adaptación de código también se guarda aparte. No se excluyen páginas enteras por llevar
huellas. Se conservan los límites de diez segundos y veinte MiB por operación Git.

Un operador que necesite excluir explícitamente un historial anterior puede usar:

```sh
npm run juntas:comprobar -- --corte <OID-completo-del-commit>
```

El corte debe ser un identificador completo de commit (40 o 64 caracteres hexadecimales), existente y ancestro de
`HEAD`. No se aceptan nombres de ramas, etiquetas anotadas ni otros objetos. Se excluye ese commit y todo lo alcanzable
desde él; el resto de juntas de `HEAD` se comprueba. La opción no acredita el historial excluido ni lo reescribe.
No hay corte histórico embebido ni variable de entorno que lo aplique silenciosamente. La CLI admite solo una opción
`--corte` con su valor separado; argumentos desconocidos, duplicados o incompletos se rechazan.

El historial incompleto se rechaza; por ello el trabajo de calidad de GitHub recupera todos los padres del commit del
evento y ejecuta la orden sin parámetros antes de comprobar y construir el producto. La falta de Git, de repositorio
o de un commit alcanzable no produce un resultado positivo de esta guarda.

`npm run verificar` comprueba código y datos también en candidatas operativas extraídas sin `.git`; no certifica su
historial. No se convierte la falta de Git en un resultado positivo de `juntas:comprobar`.
