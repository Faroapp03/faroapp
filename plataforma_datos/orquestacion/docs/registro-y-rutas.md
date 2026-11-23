# Registro y rutas conservadas

## Formato del registro de ejecuciones

`ejecuciones/estado.json` declara la versión 5. El lector y las actualizaciones
solo aceptan ese contrato; no convierten formatos anteriores al consultarlos.
La migración explícita conserva los hechos, fallos, reintentos y fechas y registra
la huella de la entrada. Incorporar un módulo sin observaciones lo deja sin intento:
ni restaurar el almacén ni volver a admitirlo acreditan una consulta remota.
Un módulo perdido, una versión desconocida o campos ajenos se rechazan.

## Rutas históricas conservadas

Los comentarios de los motores y la regla de acreditación conservan sus rutas
históricas para mantener intactos sus recursos firmados. Las piezas comunes viven
en `plataforma_datos/comun`; ejecución y admisión, en este paquete. Los auxiliares
`notas_cno11` y `grupos_competencias_esco` pertenecen a las casas de Clasificaciones
y ESCO; la composición local de comarcas y temarios está en Cursos, `hoja_de_ruta`.
`grupos_competencias_esco` es la herramienta manual que calcula los grupos de competencias del motor desde la base
ESCO validada; con `--comprobar` dice, sin escribir, si el archivo vigente coincide.
