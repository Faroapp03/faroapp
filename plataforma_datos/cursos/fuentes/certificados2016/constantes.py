"""Metadatos, límites, columnas y patrones de la fuente certificados2016, definidos junto a su motivo."""

import re

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA

FUENTE = "certificados2016"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CELDAS = {"España": "celdas-espana.jsonl", "Cataluña": "celdas-cataluna.jsonl"}
# La tabla extraída, una fila por celda de certificado: lo que escribe preparar y lee validar.
TABLA = PREPARADO / "tabla.tsv"
NUMERO_COLUMNAS_CELDAS = 4  # CNO-11, nombre de ocupación, certificado y unidades.
COLUMNAS = ("cno4", "ocupacion", "certificado", "certificado_nombre", "unidades", "pagina", "fila", "ambito")
NOMBRE_FUENTE = "SEPE · Observatorio de las Ocupaciones: certificados por ocupación del informe de necesidades de 2016"
LIMITES = (
    "Lo acordó en 2016 una mesa del SEPE, el INCUAL, Fundae y la Subdirección General de Políticas Activas de Empleo "
    "para las ocupaciones con mejores perspectivas de 2015–2016; Faro no lo ha comprobado una a una. Solo certificados "
    "vigentes y, si la tabla nombra unidades, solo las que siguen en el certificado. Una ocupación ESCO recibe las "
    "relaciones solo si tiene un único grupo CNO-11 de 4 cifras."
)

CNO4 = re.compile(r"(\d{4})\b")
# El informe trae erratas que se leen tal como están impresas: «TODOS LAS UC» o «TODAS UC» por «TODAS LAS UC»,
# unidades con tres o cinco cifras («UC556_3», «UC16364_3») o sin nivel («UC0841_»), y dos códigos de certificado
# con una letra de menos (CORRECCIONES, comprobados por el nombre impreso al lado).
CERTIFICADO = re.compile(r"\b([A-Z]{3,4}\d{4}M?)\b")  # la «M» final es de un código del catálogo (AGAO0308M)
TODAS = re.compile(r"TOD[AO]S (LAS )?UC")
UNIDAD = re.compile(r"\bUC\d{3,5}_\d?")
CORRECCIONES = {"FCD0112": "IFCD0112", "SCB0211": "SSCB0211"}
# El valor de «unidades» de una fila cuando el certificado se relaciona con todas sus unidades.
TODAS_LAS_UNIDADES = "todas"
