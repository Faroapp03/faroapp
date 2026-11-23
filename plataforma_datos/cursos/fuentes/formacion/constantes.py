"""Metadatos, límites y tablas de la fuente de formación, definidos junto a su motivo y usados por su cadena."""

from collections.abc import Mapping
from pathlib import Path
from typing import Final

from plataforma_datos.comun.entrada_salida import carpetas

FUENTE: Final[str] = "formacion"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
# Cada clave nombra la fuente oficial que se lee; el archivo, lo que contiene. La tabla EURES relaciona ocupaciones
# ESCO con códigos CO-SISPE: por eso su preparado se llama «esco-cosispe».
PREPARADOS: Final[Mapping[str, Path]] = {
    "eures": PREPARADO / "esco-cosispe.jsonl",
    "especialidades": PREPARADO / "sepe-especialidades.jsonl",
    "soc": PREPARADO / "soc-especialidades.jsonl",
    "cursos": PREPARADO / "soc-cursos.jsonl",
    "digcomp": PREPARADO / "digcomp-3.0.json",
    "registro_aprendizaje": PREPARADO / "registro-aprendizaje.json",
}
SEPE: Final[str] = "sepe"
# Nombre fechado de la copia de cursos que selecciona la preparación; la fecha usa ISO 8601.
PATRON_CURSOS: Final[str] = r"soc-cursos-([0-9]{4}-[0-9]{2}-[0-9]{2})\.json"
RELACIONES: Final[Mapping[str, str]] = {
    "exactMatch": "exacta",
    "closeMatch": "cercana",
    "broadMatch": "amplia",
    "narrowMatch": "estrecha",
}
FICHA_CURSO: Final[str] = (
    "https://serveiocupacio.gencat.cat/ca/persones/vull-formar-me/cercadors-formacio-especialitats/cercador-integrat/"
    "fitxa-curs.html?codi_curso_seleccionado="
)
FICHA_SEPE: Final[str] = "https://sede.sepe.gob.es/es/portaltrabaja/resources/pdf/especialidades/"
# Primera celda de la cabecera: permite omitir el preámbulo de la hoja EURES.
INICIO_TABLA_EURES: Final[str] = "Classification 1 URI"
# Columnas de la tabla EURES y de la hoja del SEPE que lee la preparación: sin una de ellas, el original no es el que
# se espera y la lectura se para con su motivo.
COLUMNAS_EURES: Final = (
    INICIO_TABLA_EURES,
    "Classification 2 ID",
    "Classification 2 PrefLabel",
    "Mapping relation",
)
COLUMNAS_SEPE: Final = (
    "CÓDIGO",
    "DENOMINACIÓN",
    "VERSIÓN",
    "FAMILIA PROFESIONAL",
    "ÁREA PROFESIONAL",
    "NIVEL DE CUALIFICACIÓN",
    "MODALIDAD DE IMPARTICIÓN",
    "DURACIÓN TOTAL",
)
# Índice desde cero de la tercera hoja del libro del catálogo SEPE.
HOJA_SEPE: Final[int] = 2
# Recuentos exactos exigidos a las copias conservadas; su procedencia está en originales/sepe y originales/formacion.
ESPECIALIDADES_SEPE: Final[int] = 7565  # «7.565 especialidades»
ESPECIALIDADES_SEPE_CON_OCUPACIONES: Final[int] = 4677  # «4.677 tienen ocupaciones relacionadas»
ESPECIALIDADES_SOC: Final[int] = 2882  # «8.731 filas, 2.882 especialidades»
# Umbrales mínimos: por debajo, la cadena perdería cobertura de forma visible y habría que revisar la fuente.
MIN_OCUPACIONES_EURES: Final[int] = 2900  # mínimo de ocupaciones con correspondencia EURES; no es un recuento exacto
MIN_CURSOS_IDENTIFICADOS: Final[float] = 0.9  # fracción de cursos del SOC cuya especialidad se reconoce por el nombre
MIN_COMPETENCIAS_DIGCOMP: Final[int] = 21  # DigComp 3.0: 21 competencias
MIN_RESULTADOS_DIGCOMP: Final[int] = 500  # mínimo de resultados de aprendizaje, distinto del recuento de la copia
# Tipos de resultado del suplemento oficial de DigComp 3.0, distintos del @type del nodo JSON-LD.
TIPOS_RESULTADO_DIGCOMP: Final = {"Knowledge", "Skill", "Attitude"}
# A quién se dirige cada tipo de curso del SOC (campo «tipus» del original), con los valores que entiende el motor
# (compartido/contratos/tipos-formacion.ts, DestinatariosCurso). La «Formació ocupacional» es la formación para el
# empleo que el SOC ofrece «per a persones aturades» (serveiocupacio.gencat.cat, «Vull formar-me»); en la oferta FPCAT
# de la Generalitat (Dades Obertes de Catalunya, conjunto 7vig-4syr) sus ediciones son para «Demandant d'ocupació no
# ocupat».
# Un tipo que no esté aquí no dice a quién se dirige: no se supone.
DESTINATARIOS_POR_TIPO: Final[Mapping[str, str]] = {"Formació ocupacional": "en-busqueda-de-empleo"}
# Con más días, la copia de los cursos puede haber quedado atrás: el SOC actualiza su oferta cada hora. Es el mismo
# umbral con el que avisa el informe (motores/cursos/src/vigencia-cursos.ts, MAX_DIAS_COPIA_CURSOS); una prueba de la
# cadena compara los dos valores.
MAX_DIAS_COPIA_CURSOS: Final[int] = 30
