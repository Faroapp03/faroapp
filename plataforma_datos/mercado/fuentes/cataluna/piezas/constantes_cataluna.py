"""Procedencia, archivos y reglas declaradas de cataluna; las etapas viven en `mercado/fuentes/cataluna/lector.py`."""

import re

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.periodos import MESES_CA, MESES_ES
from plataforma_datos.mercado.fuentes.censo.piezas.constantes_censo import CATALUNA

FUENTE = "cataluna"
ORIGINAL, PREPARADO, _ = carpetas(FUENTE)
# Lo que escribe preparar y lee validar: el censo a 3 y 2 cifras, la contratación a 4 y el contexto de Cataluña.
CENSO = {nivel: PREPARADO / f"ocupados-cno{nivel}.jsonl" for nivel in ("3", "2")}
CONTRATACION = PREPARADO / "contratacion-cno4.jsonl"
CONTEXTO = PREPARADO / "contexto.json"
# Los tres ficheros del visor que se usan: los totales de Cataluña, la contratación por ocupación de 4 cifras y la
# parte de mujeres en los contratos de cada ocupación.
TABLA_TOTALES = "C_P1_IND_PRINCIPALS_TOT_CAT"
TABLA_CONTRATACION = "C_P2_MES_IND"
TABLA_MUJERES = "C_P3_PC1_SEXE"
SEXO_MUJER_OBSERVATORI = "Dona"
# Cada copia del Observatori se guarda como observatori-<fichero>-<AAAA-MM>.json, con el mes final de sus 12 meses. El
# patrón reconoce las copias de la contratación en la procedencia y captura su mes; sale de la misma plantilla.
OBSERVATORI = "observatori-{}-{}.json"
PATRON_OBSERVATORI = re.compile(OBSERVATORI.replace(".", r"\.").format(TABLA_CONTRATACION, r"(\d{4}-\d{2})"))
VISOR = "https://treballperocupacions.observatoritreball.gencat.cat/treballperocupacions/assets/datas"
# El Observatori escribe el periodo en catalán («juny de 2026»); el informe lo dice en castellano.
MESES = dict(zip(MESES_CA, MESES_ES, strict=True))
# La fecha de la consulta es la de la copia registrada del censo (su procedencia no la guarda): cambia con esa copia.
CITA_CENSO = (
    "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es (Censo de Población 2021, ocupados de 16 "
    "y más años; consulta del 27/09/2026). CC BY 4.0."
)
CITA_OBSERVATORI = (
    "Font: Observatori del Treball i Model Productiu, Generalitat de Catalunya. Treball per ocupacions: dades a "
    "{periodo} (actualització del {actualizacion})."
)
CITA_OBSERVATORI_SIN_FECHA = (
    "Font: Observatori del Treball i Model Productiu, Generalitat de Catalunya. Treball per ocupacions: "
    "dades a {periodo}."
)
# La fecha de actualización que da el Observatori en su página consta en la procedencia de cada copia («version»).
PATRON_ACTUALIZACION = re.compile(r"actualització del (\d{2}/\d{2}/\d{4})")
# Cataluña como la nombra la API del Censo 2021 (la misma variable de residencia que usa
# `mercado/fuentes/censo/lector.py`).
TERRITORIO = CATALUNA
CAMPOS_PORCENTAJE_CENSO = ("pct_mujeres", "pct_menores_30", "pct_55_o_mas")
CAMPOS_CENSO = ("ocupados", *CAMPOS_PORCENTAJE_CENSO)
CAMPOS_CONTRATACION = (
    "personas_contratadas",
    "personas_contratadas_anterior",
    "variacion_pct",
    "pct_indefinidos",
    "pct_mujeres_contratos",
)
EDAD_JOVEN = 30  # años; personas menores de este límite.
EDAD_MAYOR = 55  # años; personas desde este límite, incluido.
# Una variación entre dos años solo se muestra si hay al menos estas personas contratadas en los dos: con menos, un
# puñado de contratos cambia mucho el porcentaje y la cifra no significa nada.
MIN_VARIACION = 100
# El INE ajusta cada cifra del censo en ±3 personas por confidencialidad: los totales a 3 y a 2 cifras difieren poco.
TOLERANCIA_TOTALES_CENSO = 0.001  # fracción del total (0,1 %).
# Contraste con la Taula 4 de la Cambra (censo 2022 frente a 2021). Un código o un territorio equivocados desviarían
# también los grupos grandes; en los pequeños, un año de diferencia entre censos ya mueve mucho la cifra (agentes de
# encuestas: 689 en 2022 y 1.239 en 2021). Por eso la diferencia relativa solo se exige en los grupos grandes.
GRUPO_GRANDE = 10_000  # personas ocupadas.
MAX_DIFERENCIA_OCUPADOS = 0.15  # fracción de personas ocupadas (15 %).
MAX_DIFERENCIA_PUNTOS_MUJERES = 3
# El Observatori publica unas 480 ocupaciones de 4 cifras; menos indicaría un archivo incompleto.
MIN_OCUPACIONES_OBSERVATORI = 470
# Una persona contratada en dos ocupaciones cuenta en las dos: la suma por ocupaciones supera el total de Cataluña,
# pero no en más de un 35 %.
MAX_EXCESO_SUMA_OCUPACIONES = 1.35
# La cifra de la Taula 13 de la Cambra (septiembre de 2025) ha de caer entre las de los dos años de 12 meses de la copia
# vigente del Observatori, con este margen: es la misma medida en otra ventana de 12 meses.
MARGEN_TAULA13 = 0.10
