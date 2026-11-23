"""Rutas, procedencia, límites y esquema de la captura ESCO vigente."""

from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Final

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ARCHIVO_DE_VALIDACION

FUENTE: Final[str] = "esco"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
ARCHIVO: Final = ORIGINAL / "biblioteca-api.zip"
PROCEDENCIA: Final = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
INFORME: Final = VALIDADO / ARCHIVO_DE_VALIDACION
BASE: Final = VALIDADO / "biblioteca-esco.sqlite"
PREPARADOS: Final[Mapping[str, Path]] = {
    "ocupaciones": PREPARADO / "ocupaciones.jsonl",
    "competencias": PREPARADO / "competencias.jsonl",
    "relaciones": PREPARADO / "relaciones-ocupacion-competencia.jsonl",
}

API: Final[str] = "https://ec.europa.eu/esco/api/search"
VERSION: Final[str] = "v1.2.1"
IDIOMA: Final[str] = "es"
CABECERAS_API: Final[Mapping[str, str]] = MappingProxyType({"Accept": "application/json"})
URL_AVISO_LEGAL: Final[str] = "https://commission.europa.eu/legal-notice_en"
URL_DOCUMENTACION_API: Final[str] = "https://ec.europa.eu/esco/api/doc/esco_api_doc.html"
ATRIBUCION_CAPTURA: Final[str] = (
    "© Unión Europea. Datos ESCO; selección de campos e índices locales realizados por Faro."
)
# FTS5: URI sin indexar, título, denominaciones alternativas y descripción, en el orden del esquema.
PESOS_BM25: Final = (0, 10, 7, 1)
# Tamaño de cada petición y límites operativos: paginación acotada, reintentos y tres solicitudes simultáneas.
POR_PAGINA: Final[int] = 100
INTENTOS: Final[int] = 4
HILOS: Final[int] = 3
# Plazo máximo de cada petición, en segundos.
SEGUNDOS_API: Final[int] = 90
TIPOS_API: Final[Mapping[str, str]] = {"ocupaciones": "occupation", "competencias": "skill"}
PREFIJO_URI: Final[str] = "http://data.europa.eu/esco/{}/"
RELACION_ESENCIAL: Final[str] = "esencial"
RELACION_OPCIONAL: Final[str] = "opcional"
RELACIONES_OCUPACION: Final = [("hasEssentialSkill", RELACION_ESENCIAL), ("hasOptionalSkill", RELACION_OPCIONAL)]
RELACIONES_COMPETENCIA: Final = [
    ("isEssentialForOccupation", RELACION_ESENCIAL),
    ("isOptionalForOccupation", RELACION_OPCIONAL),
]

# La licencia y la cita que pide el aviso legal de la Comisión Europea (https://commission.europa.eu/legal-notice_en) y
# la frase de atribución de ESCO: «This service uses the ESCO classification of the European Commission».
LICENCIA: Final[str] = (
    "© Unión Europea. Reutilización autorizada según la Decisión 2011/833/UE de la Comisión y su aviso legal "
    f"({URL_AVISO_LEGAL}), citando la fuente e indicando las modificaciones."
)
CITA: Final[str] = (
    f"This service uses the ESCO classification of the European Commission. ESCO {VERSION}; selección de campos e "
    "índices locales realizados por Faro."
)
META_FIJA: Final[Mapping[str, str]] = {
    "fuente": "ESCO · Comisión Europea",
    "licencia": LICENCIA,
    "cita": CITA,
    "finalidad": "Ocupaciones, descripciones, denominaciones alternativas, capacidades/conocimientos y relaciones para "
    "recuperación local.",
}
LIMITES_CAPTURA: Final = [
    "Captura completa de ocupaciones y capacidades/conocimientos activos devueltos por search; no es una copia "
    "integral de todas las taxonomías de ESCO.",
    "La versión se solicita explícitamente; las respuestas no contienen campo de versión.",
    "El preparado usa español; los originales conservan los idiomas y metadatos que devuelve la API.",
    "ESCO no mide exposición a la IA ni representa tareas confirmadas de la persona.",
]
# Controles de la lectura de la captura (`registros_origen`): si uno falla, la validación se detiene antes de escribir
# nada, así que llegar a registrarlos significa que se han cumplido.
CONTROLES_CAPTURA: Final = [
    "Cobertura total de ocupaciones y capacidades/conocimientos activos de search",
    "Huellas de cada respuesta y archivo ZIP",
    "URI y códigos únicos; etiquetas en español",
    "Jerarquías entre ocupaciones y entre capacidades resueltas",
    "Relaciones ocupación-capacidad y relaciones inversas coincidentes",
]
CONTROL_PREPARADOS: Final[str] = (
    "Claves foráneas e integridad SQLite; correspondencia íntegra de campos con los originales"
)
CONTROL_CONSULTAS: Final[str] = (
    "Consulta local directa, inversa, con sinónimos y descripciones, y resistente a entradas maliciosas"
)
ESTADO_ADMITIDO: Final[str] = "Admitido para búsqueda textual, consulta de fichas y relaciones ESCO en español."
# Fecha fija de cada página dentro del ZIP (la mínima del formato): así dos capturas con las mismas páginas dan el
# mismo archivo byte a byte, con independencia de cuándo y dónde se descargaron.
FECHA_ZIP: Final = (1980, 1, 1, 0, 0, 0)
PERMISOS_ZIP: Final = 0o644 << 16  # lectura y escritura para su dueño y lectura para el resto, en los bits altos (Unix)
SISTEMA_ZIP_UNIX: Final[int] = 3  # fija el sistema de origen: Python pondría 0 en Windows y 3 en los demás
# Nivel fijo de DEFLATE; la igualdad de bytes presupone también la misma implementación de zlib.
NIVEL_COMPRESION_ZIP: Final[int] = 6
VERIFICACION_CORRECTA: Final[str] = (
    "Correcta: fuente, preparados, SQLite y consultas directas, inversas y por denominaciones alternativas."
)
# Consultas de la verificación: ocupaciones frecuentes que deben encontrarse y una que no existe.
CONSULTAS_CONOCIDAS: Final = ("recepcionista", "enfermería", "programador")
CONSULTA_INEXISTENTE: Final[str] = "zzzznofaro"
CONSULTA_MALICIOSA: Final[str] = '" OR 1=1; --'
# Resultados que pide la verificación al buscar una denominación alternativa: más que fichas de un tipo tiene ESCO
# (3.039 ocupaciones y 13.939 competencias en la versión capturada), para que la ficha buscada no quede fuera por el
# límite de la búsqueda.
MAX_RESULTADOS_DE_LA_VERIFICACION: Final[int] = 20000
# Lo que escribe el informe cuando la base supera `PRAGMA integrity_check` y no tiene claves foráneas rotas.
INTEGRIDAD_CORRECTA: Final[str] = "ok"

ESQUEMA: Final[str] = (
    "\n"
    "PRAGMA foreign_keys=ON;\n"
    "CREATE TABLE ocupaciones(uri TEXT PRIMARY KEY,titulo_es TEXT NOT NULL,"
    "codigo_esco TEXT UNIQUE NOT NULL,descripcion_es TEXT NOT NULL,"
    "alternativos_json TEXT NOT NULL,registro_json TEXT NOT NULL);\n"
    "CREATE TABLE competencias(uri TEXT PRIMARY KEY,titulo_es TEXT NOT NULL,tipo TEXT NOT NULL,"
    "descripcion_es TEXT NOT NULL,alternativos_json TEXT NOT NULL,"
    "registro_json TEXT NOT NULL);\n"
    "CREATE TABLE relaciones(ocupacion_uri TEXT NOT NULL REFERENCES ocupaciones(uri),"
    "competencia_uri TEXT NOT NULL REFERENCES competencias(uri),"
    f"tipo TEXT CHECK(tipo IN ('{RELACION_ESENCIAL}','{RELACION_OPCIONAL}')) NOT NULL,registro_json TEXT NOT NULL,"
    "PRIMARY KEY(ocupacion_uri,competencia_uri,tipo));\n"
    "CREATE INDEX relaciones_por_competencia ON relaciones(competencia_uri,tipo);\n"
    "CREATE VIRTUAL TABLE busqueda_ocupaciones USING fts5(uri UNINDEXED,titulo_es,alternativos,"
    "descripcion_es,tokenize='unicode61 remove_diacritics 2');\n"
    "CREATE VIRTUAL TABLE busqueda_competencias USING fts5(uri UNINDEXED,titulo_es,"
    "alternativos,descripcion_es,tokenize='unicode61 remove_diacritics 2');\n"
    "CREATE TABLE procedencia(clave TEXT PRIMARY KEY,valor TEXT NOT NULL);\n"
)
