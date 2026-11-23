"""Exposición a la IA generativa CALCULADA con microdatos de encuestas con la ocupación en ISCO-08 a 4 dígitos.

La parte del empleo con ocupación declarada que está en grupos primarios ISCO-08 con gradiente 1–4 («alguna») o 4
(«alta») de la OIT (`medidas_de_exposicion`), con sus cotas y su error de muestreo (`encuestas_diseno`). No hay
modelo: solo cuentas ponderadas. Si lo acotado pasa del 5 % del empleo y las cotas no
coinciden, solo se dan las cotas. Las fuerzas armadas (subgrupos 01–03, sin nota de la OIT) y las personas sin
ocupación declarada quedan fuera del denominador y se informa su peso.

- Chile: Ministerio de Desarrollo Social y Familia, Encuesta Casen 2022 (versión del 18/03/2024). Ocupados
  (`activ` = 1), ocupación `oficio4_08` («Oficio (4 dígitos) CIUO 08»), factor de expansión regional `expr`. Los
  códigos son los de la CIUO-08 salvo en algunos subgrupos, donde la Casen abre grupos propios (p. ej. 2241
  «Dentistas», 3611 «Técnicos en educación parvularia»; anexo 1 del libro de códigos) y el Ministerio no publica una
  correspondencia: como Brasil y Noruega, identidad de código solo en los subgrupos cuyo conjunto de grupos primarios
  en el anexo es exactamente el de ISCO-08; en los demás, cotas sobre los grupos ISCO-08 del subgrupo. Error de
  muestreo por linealización de Taylor del cociente con los estratos (`varstrat`) y conglomerados (`varunit`) de
  varianza que publica la base: con reposición en la primera etapa, como
  `svyset varunit [pw = expr], strata(varstrat)`. El total de ocupados se coteja
  con el publicado por el Ministerio (9.190.261 en 2022).
- Colombia: DANE, Gran Encuesta Integrada de Hogares (GEIH) 2024, los 12 meses. Ocupados (archivo «Ocupados»),
  ocupación `OFICIO_C8` (CIUO-08 A.C., la adaptación oficial del DANE, a 4 dígitos), factor `FEX_C18`; la cifra anual
  usa los 12 meses con `FEX_C18`/12, como el DANE. La CIUO-08 A.C. tiene los grupos primarios de ISCO-08 salvo en los
  subgrupos 73, 83 y 96, donde abre grupos propios (documento oficial con su huella): esos subgrupos se acotan. Los
  microdatos públicos no traen estrato ni UPM: el error de muestreo es una APROXIMACIÓN por linealización con
  departamento × clase (cabecera/resto) como estratos y la vivienda de cada mes como conglomerado, que no recoge el
  conglomerado de segmentos del diseño y por eso lo infravalora. El total de ocupados se coteja con el publicado
  (23.036 miles en 2024).
- Uruguay: INE, Encuesta Continua de Hogares (ECH) 2023, los 12 archivos mensuales (todos los grupos de rotación
  del mes). Ocupados (`POBPCOAC` = 2), ocupación `f71_2` (código de 4 cifras de la CIUO-08: el INE codifica con la
  estructura de grupos primarios de la CIUO-08, nota explicativa CIUO_08 de 2013 con su huella; las fuerzas armadas
  vienen sin el cero inicial), ponderador mensual `W`; la cifra anual usa los 12 meses con `W`/12, que es la media
  de las 12 estimaciones mensuales con que el INE da el año. Los microdatos públicos no traen UPM y los pesos
  replicados bootstrap pasan de 150 MB por archivo: el error de muestreo es una APROXIMACIÓN por linealización con
  `ESTRED13` como estratos y el hogar (`ID`, el mismo en los meses del panel) como conglomerado, que no recoge el
  conglomerado de la UPM y por eso lo infravalora. El total de ocupados se coteja con la media de los 12 totales
  mensuales publicados (boletines técnicos de 2023, cuadro 2, en miles con un decimal). Los archivos del INE se
  obtienen aceptando sus términos (licencia en `LICENCIA_INE`): no se descargan con código y solo se publican cifras
  agregadas.
- Brasil: IBGE, PNAD Contínua trimestral (`encuestas_pnadc`): ocupados (`VD4002` = 1), ocupación `V4010` (COD),
  peso `V1028` y error de muestreo con los 200 pesos replicados bootstrap del IBGE. El total de ocupados se coteja con
  el publicado por el IBGE para el trimestre.

Python estándar. Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.lector
    {descargar,preparar,validar,todo}
[--aceptar-cambio]
"""

import csv
import io
import sys
import zipfile
from collections.abc import Iterable, Iterator, Mapping, Sequence
from itertools import pairwise
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.hojas import filas_xlsx
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales, registros_previos
from plataforma_datos.comun.stata import leer_dta
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_comun import es_numero
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.constantes import (
    CITA_CASEN,
    CITA_DANE,
    CITA_INE,
    URL_ANDA,
    URL_DANE,
    URL_PORTAL_CASEN,
)
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.diseno import (
    CIFRAS_DEL_GRUPO_PRIMARIO,
    TOPE_SIN_CORRESPONDENCIA,
    Estructura,
    Persona,
    exposicion_por_diseno,
    isco4_oficial,
    subgrupos_comparables,
)
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.medidas_de_exposicion import MEDIDAS, gradientes
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.pnadc import (
    ARCHIVOS_IBGE,
    CITA_IBGE,
    LICENCIA_IBGE,
    pais_brasil,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "encuestas-isco4"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CALCULADA = PREPARADO / "calculada.json"

# Un código fuera de la estructura publicada es un error de codificación: cuenta como ocupación no declarada. Si pesa
# más del 0,1 % del empleo, lo que falla es la lectura o la estructura, no unas pocas fichas.
TOPE_CODIGO_INVALIDO = 0.001
# Grupos primarios mínimos que debe traer el anexo 1 del libro de códigos de Casen (ISCO-08 tiene 436).
GRUPOS_MINIMOS_CASEN = 400
# Tope de un porcentaje: los límites de un intervalo van de 0 a 100.
PORCENTAJE_MAXIMO = 100
# Los límites de una medida, de menor a mayor: el intervalo al 95 % envuelve a las cotas mínima y máxima.
ESCALERA = ("desde_95", "cota_minima", "cota_maxima", "hasta_95")
# El productor reúne estas cuatro encuestas, cada una con su población y método.
PAISES_DE_LAS_ENCUESTAS = ("CHL", "COL", "URY", "BRA")
# Cada total publicado viene acompañado por su unidad de redondeo.
COMPONENTES_DEL_TOTAL_PUBLICADO = 2

CASEN_DATOS = "casen-2022-stata.zip"
CASEN_LIBRO = "casen-2022-libro-de-codigos.xlsx"
URL_CASEN = "https://observatorio.ministeriodesarrollosocial.gob.cl/storage/docs/casen/2022"
LICENCIA_CASEN = (
    "Ministerio de Desarrollo Social y Familia (Chile): Creative Commons Attribution 4.0 "
    "(https://creativecommons.org/licenses/by/4.0/deed.es), licencia del conjunto "
    "«base-de-datos-casen-2022-historicas» en su portal de datos abiertos "
    f"({URL_PORTAL_CASEN}); se cita como "
    f"«{CITA_CASEN}»."
)
HOJA_ANEXO_CASEN = 19  # «Anexo 1: Códigos Clasificación Internacional Uniforme de Ocupaciones, CIUO 08»
# Ocupados publicados y su unidad de redondeo: el total ponderado de la base tiene que caer a media unidad.
OCUPADOS_CASEN_2022 = (9_190_261, 1)  # «Casen 2022: Resultados de Trabajo» (12/10/2023), cuadro de ocupados
OCUPADOS_GEIH_2024 = (23_036_000, 1000)  # DANE, boletín técnico GEIH diciembre 2024: «23.036 miles de personas»
ARCHIVOS: list[ArchivoDescargable] = [
    {
        "archivo": CASEN_DATOS,
        "nivel": "oficial",
        "titulo": "Ministerio de Desarrollo Social y Familia, Base de datos Casen 2022, Stata (versión del 18/03/2024)",
        "url": f"{URL_CASEN}/Base%20de%20datos%20Casen%202022%20STATA_18%20marzo%202024.dta.zip",
        "licencia": LICENCIA_CASEN,
    },
    {
        "archivo": CASEN_LIBRO,
        "nivel": "oficial",
        "titulo": "Ministerio de Desarrollo Social y Familia, Libro de códigos de la base de datos Casen 2022 "
        "(18/03/2024), con el anexo 1 de los códigos CIUO-08",
        "url": f"{URL_CASEN}/Libro_de_codigos_Base_de_datos_Casen_2022(18marzo2024).xlsx",
        "licencia": LICENCIA_CASEN,
    },
]

LICENCIA_DANE = (
    "DANE (Colombia), condiciones del catálogo de microdatos (GEIH 2024): «Se autoriza el uso de la información "
    f'contenida en esta portal, siempre y cuando se haga la siguiente cita textual: "{CITA_DANE}". Queda en cambio '
    "prohibida la copia o reproducción de "
    "los datos en cualquier medio electrónico […] que permita la disponibilidad de esta información a múltiples "
    "usuarios sin el previo visto bueno del DANE por medio escrito.» Los microdatos no se redistribuyen: solo se "
    "publican cifras agregadas."
)
# Mes → identificador de descarga del catálogo 819 (GEIH 2024).
MESES_GEIH = {
    "01": 23313,
    "02": 23362,
    "03": 23596,
    "04": 23496,
    "05": 23598,
    "06": 23625,
    "07": 23631,
    "08": 23651,
    "09": 23671,
    "10": 23677,
    "11": 23729,
    "12": 23794,
}
CIUO08AC = "dane-ciuo-08-ac.pdf"
URL_CIUO08AC = "https://www.dane.gov.co/files/sen/nomenclatura/ciuo/CIUO_08_AC_2015_07_21.pdf"
# Subgrupos en los que la CIUO-08 A.C. (estructura del documento oficial) no tiene los mismos grupos primarios que
# ISCO-08: 73 (abre 7331–7399 y no tiene 7317), 83 (8323, 8324) y 96 (9625, 9626).
NO_COMPARABLES_COL = ("73", "83", "96")
CAMPOS_GEIH = ("MES", "DIRECTORIO", "DPTO", "CLASE", "FEX_C18", "OFICIO_C8")
ARCHIVOS_DANE: list[ArchivoDescargable] = [
    *(
        {
            "archivo": f"geih-2024-{mes}.zip",
            "nivel": "oficial",
            "titulo": f"DANE, Gran Encuesta Integrada de Hogares (GEIH) 2024, microdatos del mes {mes}",
            "url": f"{URL_DANE}/{identificador}",
            "licencia": LICENCIA_DANE,
        }
        for mes, identificador in MESES_GEIH.items()
    ),
    {
        "archivo": CIUO08AC,
        "nivel": "oficial",
        "titulo": "DANE, Clasificación Internacional Uniforme de Ocupaciones adaptada para Colombia (CIUO-08 A.C.)",
        "url": URL_CIUO08AC,
        "licencia": LICENCIA_DANE,
    },
]

LICENCIA_INE = (
    "INE (Uruguay), términos y condiciones del catálogo de microdatos (ANDA) para la ECH 2023, que una persona acepta "
    "antes de descargar (quién y cuándo constan en `terminos_aceptados`): los datos no se redistribuyen ni se venden "
    "sin el consentimiento escrito del INE; se usan solo para investigación científica y estadística y exclusivamente "
    "para presentar información agregada; no se intenta reidentificar a los encuestados ni vincular estos datos con "
    f"otros que pudieran identificarlos; las publicaciones citan la fuente («{CITA_INE}») y se envía al INE "
    "una copia electrónica de los informes y publicaciones basados en los datos; el INE no responde del uso ni de las "
    "interpretaciones (Ley 16.616, artículos 15 y 16). Los microdatos no entran en el repositorio: solo se publican "
    "cifras agregadas."
)
# Mes → identificador de descarga del catálogo 735 (ECH 2023, archivo mensual con todos los grupos de rotación).
MESES_ECH = {f"{mes:02d}": 1279 + mes for mes in range(1, 13)}
ARCHIVOS_ECH: list[ArchivoDescargable] = [
    {
        "archivo": f"ine-ech-2023-{mes}.csv",
        "nivel": "oficial",
        "titulo": f"INE, Encuesta Continua de Hogares (ECH) 2023, microdatos del mes {mes}",
        "url": f"{URL_ANDA}/{identificador}",
        "licencia": LICENCIA_INE,
    }
    for mes, identificador in MESES_ECH.items()
]
NOTA_CIUO08_INE: ArchivoDescargable = {
    "archivo": "ine-nota-ciuo-08.pdf",
    "nivel": "oficial",
    "titulo": "INE, Nota explicativa CIUO_08 (agosto de 2013): la ocupación se codifica con la estructura CIUO-08",
    "url": "https://www5.ine.gub.uy/documents/Clasificadores/Clasificador%20Internacional%20Uniforme%20de%20"
    "Ocupaciones/NOTA%20EXPLICATIVA%20CIUO_08.pdf",
    "licencia": "INE (Uruguay), documento público; se cita como «Fuente: INE».",
}
CAMPOS_ECH = ("ID", "mes", "ESTRED13", "POBPCOAC", "f71_2", "W")
OCUPADO_ECH = "2"  # `POBPCOAC` = 2: «Ocupados» (Diccionario de variables ECH 2023)
# Ocupados de cada mes de 2023 en centenas de personas: INE, boletines técnicos «Actividad, Empleo y Desempleo» de
# enero a diciembre de 2023, cuadro 2 («Totales (en miles)», con un decimal).
OCUPADOS_ECH_2023_POR_MES = (16771, 16785, 16723, 16789, 16867, 17006, 17127, 17032, 17123, 17136, 17108, 17238)
# La cifra anual es la media de los 12 meses; cada mes está redondeado a la centena, así que la media también cae a
# media centena del valor sin redondear.
OCUPADOS_ECH_2023 = (round(100 * sum(OCUPADOS_ECH_2023_POR_MES) / len(OCUPADOS_ECH_2023_POR_MES)), 100)


def codigo_casen(valor: float | str | None) -> str | None:
    """`oficio4_08` → código de 4 cifras; los negativos (-99 no responde, -88 no sabe, -66 glosa) → None.

    Returns:
        El código de 4 cifras, o `None` si el valor es negativo.

    Raises:
        FormatoInesperado: Si un código declarado no es un entero finito.
    """
    if valor is None:
        return None
    motivo = "Casen: oficio4_08 no es un código entero finito"
    exigir(not isinstance(valor, bool), motivo)
    try:
        numero = float(valor)
        exigir(es_numero(numero), motivo)
        if numero < 0:
            return None
        exigir(numero.is_integer(), motivo)
        return f"{int(valor):04d}"
    except (ValueError, OverflowError) as error:
        raise FormatoInesperado(motivo) from error


def personas_casen(filas: Iterable[dict[str, float | str | None]]) -> Iterator[Persona]:
    """Cada persona de la base Casen con su ocupación, factor `expr` y unidad de diseño.

    Yields:
        Cada persona de la base, en el orden del archivo.
    """
    for fila in filas:
        ocupada = fila["activ"] == 1
        yield Persona(
            ocupada,
            codigo_casen(fila["oficio4_08"]) if ocupada else None,
            float(fila["expr"] or 0),
            str(int(fila["varstrat"] or 0)),
            str(int(fila["varunit"] or 0)),
        )


def estructura_casen(filas: list[dict[str, str]]) -> set[str]:
    """Los grupos primarios del anexo 1 del libro de códigos (columna C; las fuerzas armadas vienen con 3 cifras).

    Returns:
        Los códigos de 4 cifras de los grupos primarios (y 3 cifras de fuerzas armadas).
    """
    exigir(
        any("Anexo 1" in fila.get("C", "") and "CIUO 08" in fila.get("C", "") for fila in filas[:3]),
        "Casen: la hoja no es el anexo 1 de códigos CIUO 08",
    )
    codigos = {fila["C"].strip().zfill(4) for fila in filas if fila.get("C", "").strip().isdigit()}
    exigir(len(codigos) > GRUPOS_MINIMOS_CASEN, f"Casen: el anexo 1 trae solo {len(codigos)} grupos primarios")
    return codigos


def leer_casen(estructura: Estructura) -> tuple[dict[str, Any], set[str]]:
    """Lee la base del zip sin descomprimirla en disco; devuelve las cifras y los códigos de ocupación hallados.

    Returns:
        Las cifras de Chile y el conjunto de códigos de ocupación hallados.
    """
    with zipfile.ZipFile(original(FUENTE, CASEN_DATOS)) as datos:
        nombres = [
            nombre
            for nombre in datos.namelist()
            if nombre.lower().endswith(".dta") and not nombre.startswith("__MACOSX/")
        ]
        exigir(len(nombres) == 1, f"Casen: se esperaba un solo .dta en el zip y hay {nombres}")
        codigos: set[str] = set()

        def con_registro(filas: Iterable[dict[str, float | str | None]]) -> Iterator[Persona]:
            for persona in personas_casen(filas):
                if persona.ocupada and persona.codigo is not None:
                    codigos.add(persona.codigo)
                yield persona

        with datos.open(nombres[0]) as binario:
            filas = leer_dta(binario, ("activ", "oficio4_08", "expr", "varstrat", "varunit"))
            return exposicion_por_diseno(con_registro(filas), estructura), codigos


def _ocupados_geih(mes: zipfile.ZipFile) -> bytes:
    """El CSV «Ocupados» de un mes (algunos meses lo traen dentro de un CSV.zip anidado).

    Returns:
        El contenido del CSV «Ocupados» del mes, en bytes.
    """
    nombres = [nombre for nombre in mes.namelist() if nombre.rsplit("/", 1)[-1].lower() == "ocupados.csv"]
    if not nombres:
        anidados = [nombre for nombre in mes.namelist() if nombre.rsplit("/", 1)[-1].lower() == "csv.zip"]
        exigir(len(anidados) == 1, f"GEIH: no se encuentra el archivo Ocupados ni un CSV.zip ({mes.namelist()[:5]})")
        with zipfile.ZipFile(io.BytesIO(mes.read(anidados[0]))) as interno:
            return _ocupados_geih(interno)
    exigir(len(nombres) == 1, f"GEIH: se esperaba un solo archivo Ocupados y hay {nombres}")
    return mes.read(nombres[0])


def codigos_col_validos(isco4: set[str]) -> set[str]:
    """Los códigos posibles de la CIUO-08 A.C.: los de ISCO-08 fuera de 73, 83 y 96, y cualquiera en esos tres.

    En esos subgrupos la adaptación abre grupos propios y su estructura completa solo se publica en PDF.

    Returns:
        Los códigos de 4 cifras admitidos para Colombia.
    """
    propios = {f"{subgrupo}{resto:02d}" for subgrupo in NO_COMPARABLES_COL for resto in range(100)}
    return {codigo for codigo in isco4 if codigo[:2] not in NO_COMPARABLES_COL} | propios


def _peso(texto: str, contexto: str) -> float:
    """Lee el peso sin cambiarlo, con la ubicación de un error de formato.

    Returns:
        El peso numérico finito.

    Raises:
        FormatoInesperado: Si el campo no es un número finito.
    """
    try:
        peso = float(texto)
    except ValueError as error:
        raise FormatoInesperado(f"{contexto}: peso no numérico") from error
    exigir(es_numero(peso), f"{contexto}: peso no finito")
    return peso


def personas_geih(texto: str, mes: str) -> Iterator[Persona]:
    """Cada persona ocupada de un mes, con `FEX_C18`/12 y la unidad aproximada (departamento × clase; vivienda).

    Yields:
        Cada persona ocupada del mes, en el orden del archivo.
    """
    lineas = iter(texto.splitlines())
    cabecera = next(lineas, "").split(";")
    faltan = [campo for campo in CAMPOS_GEIH if campo not in cabecera]
    exigir(not faltan, f"GEIH, mes {mes}, fila 1: el archivo Ocupados no trae {faltan}")
    columna = {
        nombre: cabecera.index(nombre) for nombre in ("MES", "DIRECTORIO", "DPTO", "CLASE", "FEX_C18", "OFICIO_C8")
    }
    for numero_fila, linea in enumerate(lineas, 2):
        contexto = f"GEIH, mes {mes}, fila {numero_fila}"
        campos = linea.split(";")
        exigir(len(campos) > max(columna.values()), f"{contexto}: faltan campos requeridos")
        exigir(campos[columna["MES"]].zfill(2) == mes, f"{contexto}: el mes no coincide")
        codigo = campos[columna["OFICIO_C8"]].strip()
        yield Persona(
            True,
            codigo if len(codigo) == CIFRAS_DEL_GRUPO_PRIMARIO and codigo.isdigit() else None,
            _peso(campos[columna["FEX_C18"]], contexto) / len(MESES_GEIH),
            f"{campos[columna['DPTO']]}-{campos[columna['CLASE']]}",
            f"{mes}-{campos[columna['DIRECTORIO']]}",
        )


def leer_geih(estructura: Estructura) -> tuple[dict[str, Any], set[str]]:
    """Los 12 meses, uno tras otro, sin descomprimirlos en disco; las cifras y los códigos hallados.

    Returns:
        Las cifras de Colombia y el conjunto de códigos de ocupación hallados.
    """
    codigos: set[str] = set()

    def todas() -> Iterator[Persona]:
        for mes in MESES_GEIH:
            with zipfile.ZipFile(original(FUENTE, f"geih-2024-{mes}.zip")) as datos:
                texto = _ocupados_geih(datos).decode("latin-1")
            for persona in personas_geih(texto, mes):
                if persona.codigo is not None:
                    codigos.add(persona.codigo)
                yield persona

    return exposicion_por_diseno(todas(), estructura), codigos


def codigo_ech(valor: str) -> str | None:
    """`f71_2` → código de 4 cifras (las fuerzas armadas vienen sin el cero inicial); 0 o vacío → None.

    Returns:
        El código de 4 cifras, o `None` si es 0 o vacío.
    """
    return valor.zfill(4) if valor.isdigit() and int(valor) > 0 else None


def personas_ech(texto: str, mes: str) -> Iterator[Persona]:
    """Cada persona de un mes, con `W`/12 y la unidad aproximada (`ESTRED13`; hogar `ID`).

    Yields:
        Cada persona del mes, en el orden del archivo.
    """
    filas = csv.DictReader(io.StringIO(texto))
    faltan = [campo for campo in CAMPOS_ECH if campo not in (filas.fieldnames or [])]
    exigir(not faltan, f"ECH, mes {mes}, fila 1: el archivo no trae {faltan}")
    for numero_fila, fila in enumerate(filas, 2):
        contexto = f"ECH, mes {mes}, fila {numero_fila}"
        exigir(all(isinstance(fila.get(campo), str) for campo in CAMPOS_ECH), f"{contexto}: faltan campos requeridos")
        exigir(fila["mes"].zfill(2) == mes, f"{contexto}: el mes no coincide")
        ocupada = fila["POBPCOAC"] == OCUPADO_ECH
        yield Persona(
            ocupada,
            codigo_ech(fila["f71_2"]) if ocupada else None,
            _peso(fila["W"], contexto) / len(MESES_ECH),
            fila["ESTRED13"],
            fila["ID"],
        )


def leer_ech(estructura: Estructura) -> tuple[dict[str, Any], set[str], list[int]]:
    """Los 12 meses, uno tras otro: las cifras, los códigos hallados y el total ponderado de ocupados de cada mes.

    Returns:
        Las cifras de Uruguay, los códigos hallados y los ocupados ponderados de cada mes.
    """
    codigos: set[str] = set()
    por_mes = dict.fromkeys(MESES_ECH, 0.0)

    def todas() -> Iterator[Persona]:
        for mes in MESES_ECH:
            texto = original(FUENTE, f"ine-ech-2023-{mes}.csv").read_text(encoding="utf-8")
            for persona in personas_ech(texto, mes):
                if persona.ocupada:
                    por_mes[mes] += persona.peso
                    codigos.update([persona.codigo] if persona.codigo else [])
                yield persona

    cifras = exposicion_por_diseno(todas(), estructura)
    return cifras, codigos, [round(total * len(MESES_ECH)) for total in por_mes.values()]


def guardar_procedencia(archivos: Sequence[Mapping[str, object]]) -> None:
    """Escribe la procedencia de los originales: fuentes, cita, licencias y una entrada por archivo."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "Ministerio de Desarrollo Social y Familia (Chile), DANE (Colombia), INE (Uruguay) e IBGE "
            "(Brasil)",
            "cita": "Ministerio de Desarrollo Social y Familia, Encuesta de Caracterización Socioeconómica Nacional "
            f"(Casen) 2022, base de datos del 18/03/2024. {CITA_DANE} (GEIH 2024). {CITA_INE}. {CITA_IBGE}, "
            "microdados trimestrais; IBGE, Classificação de Ocupações para Pesquisas Domiciliares.",
            "licencia": f"Chile: {LICENCIA_CASEN} Colombia: {LICENCIA_DANE} Uruguay: {LICENCIA_INE} Brasil: "
            f"{LICENCIA_IBGE}",
            "archivos": list(archivos),
        },
    )


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga Casen 2022, la GEIH 2024, la CIUO-08 A.C., la nota CIUO_08 del INE y la PNAD Contínua; conserva la ECH.

    Los 12 meses de la ECH 2023 se obtienen del ANDA del INE aceptando sus términos (`LICENCIA_INE`), que decide una
    persona: no se bajan con código; su entrada de procedencia se conserva y su huella se comprueba al leerlos.
    """
    previos = registros_previos(PROCEDENCIA)
    ech = [previos[archivo["archivo"]] for archivo in ARCHIVOS_ECH if archivo["archivo"] in previos]
    exigir(
        len(ech) == len(ARCHIVOS_ECH),
        "ECH 2023: los meses se bajan del ANDA del INE tras aceptar sus términos y se registran con su huella",
    )
    nuevos = descargar_originales(
        [*ARCHIVOS, *ARCHIVOS_DANE, NOTA_CIUO08_INE, *ARCHIVOS_IBGE], ORIGINAL, aceptar_cambio
    )
    guardar_procedencia([*nuevos, *ech])


def preparar() -> None:
    """Calcula las cifras de cada país y las guarda en `calculada.json`."""
    grad = gradientes(leer_validado("oit")["ocupaciones"])
    isco4 = isco4_oficial()
    anexo = estructura_casen(filas_xlsx(original(FUENTE, CASEN_LIBRO), HOJA_ANEXO_CASEN))
    comparables = subgrupos_comparables(anexo, isco4)
    chile, codigos = leer_casen(Estructura(grad, isco4, comparables, anexo, {}))
    comparables_col = {isco[:2]: isco[:2] not in NO_COMPARABLES_COL for isco in isco4}
    colombia, codigos_col = leer_geih(Estructura(grad, isco4, comparables_col, codigos_col_validos(isco4), {}))
    uruguay, codigos_ury, por_mes = leer_ech(Estructura(grad, isco4, dict.fromkeys(comparables_col, True), isco4, {}))
    guardar_json(
        CALCULADA,
        {
            "CHL": {
                "anio": 2022,
                "fuente": "Ministerio de Desarrollo Social y Familia, Encuesta Casen 2022 (base del 18/03/2024)",
                "clasificacion": "`oficio4_08`, CIUO-08 a 4 dígitos con grupos propios en algunos subgrupos",
                "correspondencia": "identidad de código en los subgrupos con los mismos grupos primarios que ISCO-08; "
                "en los demás, cotas sobre los grupos ISCO-08 del subgrupo",
                "poblacion": "personas ocupadas (`activ` = 1), factor de expansión regional `expr`",
                "error_de_muestreo": "linealización de Taylor del cociente con `varstrat` y `varunit` (con reposición "
                "en la UPM; los estratos con una sola UPM no aportan varianza)",
                "ocupados_publicados": OCUPADOS_CASEN_2022,
                "subgrupos_no_comparables": sorted(subgrupo for subgrupo, si in comparables.items() if not si),
                "codigos_fuera_de_la_estructura": sorted(codigos - anexo),
                **chile,
            },
            "COL": {
                "anio": 2024,
                "fuente": "DANE, Gran Encuesta Integrada de Hogares (GEIH) 2024, 12 meses",
                "clasificacion": "`OFICIO_C8`, CIUO-08 A.C. (adaptación oficial del DANE) a 4 dígitos",
                "correspondencia": "identidad de código salvo en los subgrupos 73, 83 y 96 (grupos propios de la "
                "CIUO-08 A.C.), acotados sobre los grupos ISCO-08 del subgrupo",
                "poblacion": "personas ocupadas (archivo «Ocupados»), `FEX_C18`/12 en cada mes",
                "error_de_muestreo": "APROXIMADO: linealización de Taylor con departamento × clase como estratos y la "
                "vivienda de cada mes como conglomerado; los microdatos públicos no traen estrato ni UPM, así que no "
                "recoge el conglomerado de segmentos y lo infravalora",
                "ocupados_publicados": OCUPADOS_GEIH_2024,
                "subgrupos_no_comparables": list(NO_COMPARABLES_COL),
                "codigos_fuera_de_la_estructura": sorted(codigos_col - codigos_col_validos(isco4)),
                **colombia,
            },
            "URY": {
                "anio": 2023,
                "fuente": "INE, Encuesta Continua de Hogares (ECH) 2023, 12 meses",
                "clasificacion": "`f71_2`, código de 4 cifras de la CIUO-08 (estructura de grupos primarios de la "
                "CIUO-08, nota explicativa CIUO_08 del INE)",
                "correspondencia": "identidad de código en todos los subgrupos",
                "poblacion": "personas ocupadas (`POBPCOAC` = 2), ponderador mensual `W`/12 en cada mes",
                "error_de_muestreo": "APROXIMADO: linealización de Taylor con `ESTRED13` como estratos y el hogar "
                "(`ID`, el mismo en los meses del panel) como conglomerado; los microdatos públicos no traen UPM, así "
                "que no recoge el conglomerado de la UPM y lo infravalora",
                "ocupados_publicados": OCUPADOS_ECH_2023,
                "ocupados_publicados_por_mes": [100 * total for total in OCUPADOS_ECH_2023_POR_MES],
                "ocupados_por_mes": por_mes,
                "subgrupos_no_comparables": [],
                "codigos_fuera_de_la_estructura": sorted(codigos_ury - isco4),
                **uruguay,
            },
            "BRA": pais_brasil(grad, isco4, lambda nombre: original(FUENTE, nombre)),
        },
    )


def _exigir_cifras(pais: dict[str, Any], ruta: str) -> None:
    """Comprueba los campos numéricos antes de comparar la cifra con sus cotas."""
    for medida in MEDIDAS:
        fila = pais.get(medida)
        donde = f"{ruta}.{medida}"
        exigir(isinstance(fila, dict), f"{donde}: se espera un objeto")
        for limite in ESCALERA:
            exigir(es_numero(fila.get(limite)), f"{donde}.{limite}: se espera un número finito")
        exigir("valor" in fila, f"{donde}.valor: falta el campo")
        valor = fila["valor"]
        exigir(
            valor is None or (es_numero(valor) and fila["cota_minima"] <= valor <= fila["cota_maxima"]),
            f"{donde}.valor: se espera null o una cifra numérica dentro de sus cotas",
        )


def _exigir_pais(pais: object, ruta: str) -> None:
    """Exige la estructura que utilizan los controles y el catálogo, sin convertir valores."""
    exigir(isinstance(pais, dict), f"{ruta}: se espera un objeto")
    for campo in ("fuente", "error_de_muestreo"):
        exigir(isinstance(pais.get(campo), str), f"{ruta}.{campo}: se espera texto")
    anio = pais.get("anio")
    exigir(isinstance(anio, int) and not isinstance(anio, bool), f"{ruta}.anio: se espera un entero")
    exigir(es_numero(pais.get("empleo")), f"{ruta}.empleo: se espera un número finito")
    publicado = pais.get("ocupados_publicados")
    exigir(
        isinstance(publicado, (list, tuple))
        and len(publicado) == COMPONENTES_DEL_TOTAL_PUBLICADO
        and all(es_numero(numero) for numero in publicado)
        and publicado[1] > 0,
        f"{ruta}.ocupados_publicados: se esperan el total y su unidad positiva de redondeo",
    )
    fuera = pais.get("codigos_fuera_de_la_estructura")
    exigir(
        isinstance(fuera, list) and all(isinstance(codigo, str) for codigo in fuera),
        f"{ruta}.codigos_fuera_de_la_estructura: se espera una lista de códigos",
    )
    for campo in ("parte_codigo_invalido", "parte_sin_correspondencia"):
        parte = pais.get(campo)
        exigir(es_numero(parte) and 0 <= parte <= 1, f"{ruta}.{campo}: se espera una proporción entre 0 y 1")
    muestra = pais.get("muestra")
    exigir(isinstance(muestra, dict), f"{ruta}.muestra: se espera un objeto")
    exigir(isinstance(muestra.get("regla_nchs_n_30"), bool), f"{ruta}.muestra.regla_nchs_n_30: se espera un booleano")
    _exigir_cifras(pais, ruta)


def validar() -> None:
    """Huellas, total de ocupados frente al publicado, códigos ISCO-08, cifras dentro de sus cotas y regla n ≥ 30."""
    preparado, procedencia = leer_json(CALCULADA), leer_json(PROCEDENCIA)
    exigir(
        isinstance(preparado, dict) and set(preparado) == set(PAISES_DE_LAS_ENCUESTAS),
        f"{FUENTE}: se esperan los países {', '.join(PAISES_DE_LAS_ENCUESTAS)}",
    )
    for iso3, pais in preparado.items():
        _exigir_pais(pais, f"{FUENTE}.{iso3}")
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    for iso3, pais in preparado.items():
        publicado, unidad = pais["ocupados_publicados"] or (None, None)
        controles.comprobar(
            publicado is not None and abs(pais["empleo"] - publicado) <= unidad / 2,
            f"{iso3}: el total ponderado de ocupados ({pais['empleo']}) cuadra con el publicado ({publicado}, en "
            f"unidades de {unidad})",
        )
        fuera = pais["codigos_fuera_de_la_estructura"]
        controles.comprobar(
            pais["parte_codigo_invalido"] <= TOPE_CODIGO_INVALIDO,
            f"{iso3}: los códigos fuera de la estructura publicada {fuera[:5]} pesan "
            f"{100 * pais['parte_codigo_invalido']:.4f} % del empleo (≤ {100 * TOPE_CODIGO_INVALIDO} %)",
        )
        controles.comprobar(pais["muestra"]["regla_nchs_n_30"], f"{iso3}: n ≥ 30 en la cifra nacional (NCHS)")
        for medida in MEDIDAS:
            fila = pais[medida]
            dentro = all(
                menor <= mayor
                for menor, mayor in pairwise((0, *(fila[limite] for limite in ESCALERA), PORCENTAJE_MAXIMO))
            )
            controles.comprobar(dentro, f"{iso3}: «{medida}» dentro de sus cotas y de su intervalo")
            controles.comprobar(
                (fila["valor"] is None)
                == (
                    pais["parte_sin_correspondencia"] > TOPE_SIN_CORRESPONDENCIA
                    and fila["cota_minima"] != fila["cota_maxima"]
                ),
                f"{iso3}: «{medida}» da cifra puntual solo con ≤ 5 % del empleo acotado o con cotas iguales",
            )
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {iso3: {"anio": pais["anio"], "fuente": pais["fuente"]} for iso3, pais in preparado.items()},
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: preparado)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida: 0 si todo va bien.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
