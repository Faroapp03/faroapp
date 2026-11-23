"""La exposición a la IA generativa CALCULADA en `datos-globales.json`: el bloque `calculados` («calculado»).

Una cifra calculada es una cuenta ponderada de Faro sobre los microdatos de la encuesta oficial de empleo de un país,
con los gradientes de exposición por ocupación de la OIT (WP140): ni la mide una estadística oficial ni la estima un
modelo. Las cifras salen del conjunto validado de `encuestas-isco4` (`ia_y_trabajo/fuentes/encuestas_isco4/lector.py`);
aquí se define lo que se dice de cada indicador y de cada encuesta: método del intervalo, licencia, cita y dirección.
Cada cifra va con su intervalo de confianza del 95 %; si solo hay cotas (una parte del empleo sin correspondencia a 4
dígitos con ISCO-08), el valor es null y van las cotas con su motivo y esa parte del empleo, en porcentaje. Python
estándar.
"""

import re
from collections.abc import Mapping
from types import MappingProxyType
from typing import Any, NamedTuple

from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    CALCULADO,
    COBERTURA_MUNDO,
    MOTIVO_SIN_CORRESPONDENCIA,
    UNIDAD_PORCENTAJE,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_calculado import problemas_del_valor_calculado
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.constantes import (
    CITA_CASEN,
    CITA_DANE,
    CITA_IBGE,
    CITA_INE,
    URL_ANDA,
    URL_DANE,
    URL_IBGE,
    URL_PORTAL_CASEN,
)
from plataforma_datos.ocupaciones.fuentes.oit.piezas.constantes_oit import AVISO_ADAPTACION, CITA, DOI_WP140


class Encuesta(NamedTuple):
    """Lo que se publica de la encuesta de un país: método del intervalo, licencia, cita y dirección."""

    metodo: str
    licencia: str
    cita: str
    url: str


_ENCUESTAS = {
    "BRA": Encuesta(
        "replicas_bootstrap",
        "IBGE: microdatos públicos de su servidor de descargas, citando al IBGE como fuente.",
        CITA_IBGE,
        URL_IBGE,
    ),
    "CHL": Encuesta(
        "linealizacion_taylor",
        "Creative Commons Atribución 4.0 (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/deed.es), licencia "
        "de la Casen 2022 en el portal de datos abiertos del Ministerio de Desarrollo Social y Familia.",
        CITA_CASEN,
        URL_PORTAL_CASEN,
    ),
    "COL": Encuesta(
        "linealizacion_taylor_aproximada",
        "DANE: uso autorizado con la cita textual de la fuente; los microdatos no se redistribuyen, solo se publican "
        "cifras agregadas.",
        CITA_DANE,
        URL_DANE.removesuffix("/download"),
    ),
    "URY": Encuesta(
        "linealizacion_taylor_aproximada",
        "INE (Uruguay), términos de su catálogo de microdatos: solo se publica información agregada, citando la "
        "fuente.",
        CITA_INE,
        URL_ANDA.removesuffix("/download"),
    ),
}
ENCUESTAS: Mapping[str, Encuesta] = MappingProxyType(_ENCUESTAS)
# Cómo empieza la descripción del error de muestreo de `encuestas-isco4` con cada método: si no casan, se detiene.
_SENAL_DEL_METODO = {
    "replicas_bootstrap": re.compile(r"\d+ pesos replicados bootstrap"),
    "linealizacion_taylor": re.compile(r"linealización de Taylor"),
    "linealizacion_taylor_aproximada": re.compile(r"APROXIMADO: linealización de Taylor"),
}


def _indicador(id_: str, nombre: tuple[str, str], cuales: tuple[str, str]) -> dict[str, object]:
    """Un indicador calculado, con su definición en lenguaje llano: exposición de ocupaciones, no uso ni predicción.

    Returns:
        El indicador con su id, sus textos en castellano y catalán y su definición.
    """
    return {
        "id": id_,
        "nombre": {"es": nombre[0], "ca": nombre[1]},
        "definicion": {
            "es": f"Porcentaje de las personas ocupadas cuya ocupación está {cuales[0]} del índice de exposición a la "
            "IA generativa de la OIT, sobre las personas ocupadas con ocupación declarada (sin las fuerzas armadas). "
            "Lo calcula Faro con los microdatos de la encuesta oficial de empleo del país. Mide cuánto se exponen las "
            "ocupaciones por sus tareas: no es el uso de la IA ni una predicción de empleos perdidos o creados.",
            "ca": f"Percentatge de les persones ocupades amb una ocupació {cuales[1]} de l'índex d'exposició a la IA "
            "generativa de l'OIT, sobre les persones ocupades amb ocupació declarada (sense les forces armades). El "
            "calcula Faro amb les microdades de l'enquesta oficial d'ocupació del país. Mesura quant s'exposen les "
            "ocupacions per les seves tasques: no és l'ús de la IA ni una predicció de llocs de treball perduts o "
            "creats.",
        },
        "unidad": UNIDAD_PORCENTAJE,
        "naturaleza": CALCULADO,
        "fuente": "OIT, gradientes de exposición por ocupación (WP140), y la encuesta oficial de empleo de cada país",
        "tabla": "WP140, tabla A1 (gradiente de cada grupo primario ISCO-08)",
        "licencia": f"OIT, WP140: CC BY 4.0, citando: {CITA} {AVISO_ADAPTACION} Las cifras por país las calcula Faro "
        "con los microdatos de cada encuesta, con su licencia y su cita.",
        "url": DOI_WP140,
        # Los países codifican la ocupación de modo distinto y sus años e intervalos no son iguales: no se comparan.
        "comparable": False,
        "cobertura": COBERTURA_MUNDO,
    }


# Por indicador, la medida de `encuestas-isco4` (medidas_de_exposicion.MEDIDAS) de la que sale.
INDICADORES_CALCULADOS: Mapping[str, tuple[str, dict[str, object]]] = MappingProxyType(
    {
        "exposicion-alta": (
            "alta",
            _indicador(
                "exposicion-alta",
                (
                    "Personas ocupadas con exposición alta a la IA generativa",
                    "Persones ocupades amb exposició alta a la IA generativa",
                ),
                ("en el gradiente 4, el de exposición más alta,", "del gradient 4, el d'exposició més alta,"),
            ),
        ),
        "exposicion-alguna": (
            "alguna",
            _indicador(
                "exposicion-alguna",
                (
                    "Personas ocupadas con alguna exposición a la IA generativa",
                    "Persones ocupades amb alguna exposició a la IA generativa",
                ),
                ("en alguno de los gradientes 1 a 4", "d'algun dels gradients 1 a 4"),
            ),
        ),
    }
)


def _campo(objeto: object, clave: str, ruta: str) -> object:
    """Lee un campo requerido del agregado, con su ruta en el diagnóstico.

    Returns:
        El campo sin modificar su valor.
    """
    exigir(isinstance(objeto, dict), f"{ruta}: se espera un objeto JSON")
    exigir(clave in objeto, f"{ruta}.{clave}: falta el campo")
    return objeto[clave]


def _valor(iso3: str, pais: dict[str, Any], medida: str, nombre: dict[str, str]) -> dict[str, Any]:
    """La cifra calculada de un país: valor (o null), intervalo, cotas (o null), año, encuesta, licencia y cita.

    Returns:
        La cifra del país con su intervalo, cotas, año, encuesta, licencia y cita.
    """
    ruta = f"encuestas-isco4.{iso3}"
    ruta_fila = f"{ruta}.{medida}"
    encuesta, fila = ENCUESTAS[iso3], _campo(pais, medida, ruta)
    error = _campo(pais, "error_de_muestreo", ruta)
    exigir(isinstance(error, str), f"{ruta}.error_de_muestreo: se espera texto")
    exigir(
        bool(_SENAL_DEL_METODO[encuesta.metodo].match(error)),
        f"datos globales: el método «{encuesta.metodo}» de {iso3} no es el que describe «encuestas-isco4»",
    )
    cotas = None
    valor = _campo(fila, "valor", ruta_fila)
    if valor is None:
        parte = _campo(pais, "parte_sin_correspondencia", ruta)
        exigir(
            isinstance(parte, int | float) and not isinstance(parte, bool) and 0 <= parte <= 1,
            f"{ruta}.parte_sin_correspondencia: se espera una proporción entre 0 y 1",
        )
        cotas = {
            "inferior": _campo(fila, "cota_minima", ruta_fila),
            "superior": _campo(fila, "cota_maxima", ruta_fila),
            "motivo": MOTIVO_SIN_CORRESPONDENCIA,
            "parte_sin_correspondencia": round(100 * parte, 3),
        }
    resultado = {
        "territorio": iso3,
        "nombre": nombre,
        "valor": valor,
        "intervalo": {
            "desde": _campo(fila, "desde_95", ruta_fila),
            "hasta": _campo(fila, "hasta_95", ruta_fila),
            "metodo": encuesta.metodo,
        },
        "cotas": cotas,
        "anio": _campo(pais, "anio", ruta),
        "encuesta": _campo(pais, "fuente", ruta),
        "licencia": encuesta.licencia,
        "cita": encuesta.cita,
        "url": encuesta.url,
    }
    problemas = problemas_del_valor_calculado(ruta_fila, resultado)
    exigir(not problemas, "; ".join(problemas))
    return resultado


def calculados(encuestas: dict[str, Any], paises: dict[str, Any]) -> list[dict[str, Any]]:
    """El bloque `calculados`: cada indicador con la cifra de cada país de `encuestas-isco4`, por orden de código.

    Args:
        encuestas: El conjunto validado de `encuestas-isco4`, por código ISO 3166-1 alfa-3.
        paises: Los países de la fuente `territorios`, con su alfa-3 y su nombre en castellano y en catalán.

    Returns:
        Un elemento por indicador calculado, con sus valores.
    """
    exigir(isinstance(encuestas, dict), "encuestas-isco4: se espera un objeto JSON")
    exigir(
        set(encuestas) == set(ENCUESTAS),
        f"datos globales: «encuestas-isco4» trae {sorted(encuestas)}; se publican {sorted(ENCUESTAS)}",
    )
    exigir(isinstance(paises, dict), "territorios.paises: se espera un objeto JSON")
    nombres = {}
    for codigo, pais in paises.items():
        ruta = f"territorios.paises.{codigo}"
        iso3 = _campo(pais, "iso3", ruta)
        exigir(isinstance(iso3, str), f"{ruta}.iso3: se espera texto")
        nombre = {lengua: _campo(pais, lengua, ruta) for lengua in ("es", "ca")}
        exigir(all(isinstance(texto, str) and texto for texto in nombre.values()), f"{ruta}: nombres es/ca no vacíos")
        nombres[iso3] = nombre
    for iso3 in ENCUESTAS:
        exigir(iso3 in nombres, f"territorios: falta el nombre de {iso3}")
    return [
        {
            **indicador,
            "valores": [_valor(iso3, encuestas[iso3], medida, nombres[iso3]) for iso3 in sorted(encuestas)],
        }
        for medida, indicador in INDICADORES_CALCULADOS.values()
    ]
