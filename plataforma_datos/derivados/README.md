# Datos derivados

`fuentes/datos_globales/lector.py` compone y valida `datos-globales.json` desde los conjuntos admitidos por otras fuentes. No descarga datos. Conserva los identificadores, años, notas, denominadores, naturalezas y licencias de cada indicador; el agregado no concede una licencia común ni describe probabilidades personales.

La casa operativa sigue siendo `var/actualizacion/{preparados,validados}/datos-globales/`. `plataforma_datos/orquestacion/publicar_globales.py` conserva la comprobación y copia de los bytes admitidos al candidato público. El derivado no tiene una actualización propia: se recompone desde los conjuntos admitidos.

La unidad `fuentes/datos_globales/piezas/` contiene el catálogo de indicadores y los contratos del agregado. Otros productores importan estos módulos de contrato y metadatos; no importan el lector del derivado. La cita y licencia de CLDR pertenecen a `plataforma_datos.comun.fuentes.territorios.constantes`, sin dependencia inversa del tema común al agregado.

El descriptor conserva las dependencias y la política vigentes; su README se genera con `python -m plataforma_datos.contratos.fuentes --tema derivados`. El lector se invoca desde la raíz con `python -m plataforma_datos.derivados.fuentes.datos_globales.lector`. Las pruebas y su fixture mínima están en `pruebas/`.
