"""Filas, series, comarcas, provincias y metodología preparadas desde los originales del visor."""

import re
from collections.abc import Iterable
from math import isfinite
from typing import Any

import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
from plataforma_datos.comun.entrada_salida import original
from plataforma_datos.comun.lugares import COMARCAS_DE_LA_ZONA as COMARCAS
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.comun.periodos import mes_anterior, mes_de, mes_iso
from plataforma_datos.comun.textos_y_cifras import texto_plano
from plataforma_datos.mercado.fuentes.cataluna.piezas.captura_cataluna import contenido_visor
from plataforma_datos.mercado.fuentes.observatori.piezas.constantes_observatori import (
    ADITIVOS,
    CAMPOS,
    CLAVE_DE_LA_METODOLOGIA,
    DECIMALES_PREPARADO,
    DEFINICIONES,
    FUENTE,
    PROVINCIAS,
)


def _por_ocupacion(filas: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Filas de una serie agrupadas por ocupación y ordenadas por mes.

    Returns:
        {ocupación: sus filas ordenadas por mes}.
    """
    grupos: dict[str, list[dict[str, Any]]] = {}
    for fila in filas:
        grupos.setdefault(fila["c_grup_primari"], []).append(fila)
    return {codigo: sorted(serie, key=lambda fila: fila["c_mes"]) for codigo, serie in sorted(grupos.items())}


def nombre_del_original(fichero: str, periodo: str) -> str:
    """Nombre con que se guarda un fichero del visor: el del Observatori y el mes final de sus datos (AAAA-MM).

    Returns:
        El nombre del archivo.
    """
    return f"observatori-{fichero}-{periodo}.json"


def estable[T](valor: T) -> T:
    """Un número del visor con `DECIMALES_PREPARADO` decimales si es fraccionario; lo demás, tal cual.

    Returns:
        El número redondeado si es fraccionario; cualquier otro valor, sin cambios.
    """
    return round(valor, DECIMALES_PREPARADO) if isinstance(valor, float) else valor


def _cifra_finita(valor: object) -> bool:
    """Si una cifra puede usarse sin desbordar los cálculos del visor.

    Returns:
        True para nulos o números finitos representables por isfinite.
    """
    if valor is None:
        return True
    if type(valor) not in (int, float):
        return False
    try:
        return isfinite(valor)
    except OverflowError:
        # isfinite convierte los enteros a float; un entero JSON desmesurado puede desbordar esa conversión.
        return False


def filas_de_datos(contenido: object, fichero: str) -> list[dict[str, Any]]:
    """Exige las columnas y los tipos que se leen de cada fichero del visor.

    Returns:
        Filas no vacías con identificadores, meses y cifras finitas o nulas.
    """
    filas = contenido.get("items") if isinstance(contenido, dict) else None
    exigir(isinstance(filas, list) and bool(filas), f"{fichero}: items no es una lista con filas")
    campos_series = {
        "C_P5_EVOL_1": ("eo_cont_mes", "eo_per_cont_mes", "eo_dno_mes"),
        "C_P5_EVOL_2": ("eo_var_cont_mm_12m", "eo_var_cont_mm_12m_cat"),
        "C_P5_EVOL_3": ("eo_var_dno_mm_12m", "eo_var_dno_mm_12m_cat"),
    }
    cifras = campos_series.get(fichero, tuple(CAMPOS.values()))
    for numero, fila in enumerate(filas, start=1):
        exigir(isinstance(fila, dict), f"{fichero}: fila {numero} no es un objeto")
        exigir(set(cifras) <= fila.keys(), f"{fichero}: faltan columnas en fila {numero}")
        exigir(
            all(_cifra_finita(fila[campo]) for campo in cifras),
            f"{fichero}: cifra no finita o no numérica en fila {numero}",
        )
        mes = fila.get("c_mes")
        exigir(
            type(mes) is int and re.fullmatch(r"[0-9]{4}(?:0[1-9]|1[0-2])", str(mes)) is not None,
            f"{fichero}: mes c_mes inválido en fila {numero}",
        )
        if fichero != "C_P2_MES_TOT_CAT":
            codigo = fila.get("c_grup_primari")
            exigir(
                isinstance(codigo, str) and re.fullmatch(r"[0-9]{4}", codigo) is not None,
                f"{fichero}: ocupación inválida en fila {numero}",
            )
        if fichero == "C_P8_IND_COMARQUES":
            exigir(
                isinstance(fila.get("c_comarca_42"), str) and isinstance(fila.get("d_comarca"), str),
                f"{fichero}: comarca sin código o nombre en fila {numero}",
            )
    return filas


def filas_del_original(fichero: str) -> list[dict[str, Any]]:
    """Filas comprobadas de un fichero del visor guardado por esta fuente, del periodo vigente.

    Returns:
        Las filas del archivo que son del periodo vigente.
    """
    ruta = original(FUENTE, nombre_del_original(fichero, cataluna.periodo_archivado()))
    contenido = contenido_visor(ruta.read_bytes(), fichero)
    return filas_de_datos(contenido, fichero)


def _series_con_calendario(fichero: str) -> dict[str, list[dict[str, Any]]]:
    """Exige un calendario común, consecutivo y sin meses repetidos por ocupación.

    Returns:
        Las filas agrupadas, con el mismo calendario en todas las ocupaciones.
    """
    grupos = _por_ocupacion(filas_del_original(fichero))
    exigir(bool(grupos), f"{fichero}: serie sin filas")
    primera = next(iter(grupos.values()))
    meses = [fila["c_mes"] for fila in primera]
    calendario = [mes_de(mes_anterior(mes_iso(meses[-1]), atras)) for atras in range(len(meses) - 1, -1, -1)]
    exigir(
        all([fila["c_mes"] for fila in serie] == calendario for serie in grupos.values()),
        f"{fichero}: calendario distinto, incompleto o con meses repetidos",
    )
    return grupos


def indicadores(fila: dict[str, Any]) -> dict[str, Any]:
    """Los indicadores de una fila del visor con su nombre en castellano.

    Returns:
        {nombre en castellano: valor} de los indicadores de la fila.
    """
    return {campo: estable(fila[codigo]) for campo, codigo in CAMPOS.items()}


def valores_distintos_por_mes(series: dict[str, list[dict[str, Any]]], campo: str) -> int:
    """Cuántos valores distintos de un campo de Cataluña hay en un mismo mes entre las ocupaciones (debe ser 1).

    Returns:
        El número de valores distintos; 1 si el campo es el mismo para todas.
    """
    por_mes: dict[int, set[Any]] = {}
    for serie in series.values():
        for fila in serie:
            por_mes.setdefault(fila["c_mes"], set()).add(fila[campo])
    exigir(bool(por_mes), f"serie sin meses para {campo}")
    return max(len(valores) for valores in por_mes.values())


def preparar_series() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Las series de cada ocupación (13 meses de recuentos y 49 de variaciones) y la de toda Cataluña.

    Returns:
        Las series por ocupación y la serie de toda Cataluña.
    """
    mensual = _series_con_calendario("C_P5_EVOL_1")
    contratos = _series_con_calendario("C_P5_EVOL_2")
    demandantes = _series_con_calendario("C_P5_EVOL_3")

    exigir(
        [fila["c_mes"] for fila in next(iter(contratos.values()))]
        == [fila["c_mes"] for fila in next(iter(demandantes.values()))],
        "C_P5_EVOL_2/C_P5_EVOL_3: calendario distinto entre contratos y demandantes",
    )

    def columna(serie: list[dict[str, Any]], campo: str) -> list[Any]:
        """Los valores de un campo a lo largo de una serie, con `DECIMALES_PREPARADO` decimales.

        Returns:
            Los valores del campo, en el orden de la serie.
        """
        return [estable(fila[campo]) for fila in serie]

    filas = [
        {
            "cno11": codigo,
            "contratos_mes": columna(mensual.get(codigo, []), "eo_cont_mes"),
            "personas_contratadas_mes": columna(mensual.get(codigo, []), "eo_per_cont_mes"),
            "demandantes_no_ocupados_mes": columna(mensual.get(codigo, []), "eo_dno_mes"),
            "variacion_contratos_mm12": columna(contratos.get(codigo, []), "eo_var_cont_mm_12m"),
            "variacion_demandantes_mm12": columna(demandantes.get(codigo, []), "eo_var_dno_mm_12m"),
        }
        for codigo in sorted({*mensual, *contratos, *demandantes})
    ]
    de_contratos, de_demandantes = next(iter(contratos.values())), next(iter(demandantes.values()))
    resumen = {
        "meses_mensuales": [mes_iso(fila["c_mes"]) for fila in next(iter(mensual.values()))],
        "meses_de_variacion": [mes_iso(fila["c_mes"]) for fila in de_contratos],
        "variacion_contratos_mm12": columna(de_contratos, "eo_var_cont_mm_12m_cat"),
        "variacion_demandantes_mm12": columna(de_demandantes, "eo_var_dno_mm_12m_cat"),
        "valores_de_cataluna_por_mes": {
            "contratos": valores_distintos_por_mes(contratos, "eo_var_cont_mm_12m_cat"),
            "demandantes": valores_distintos_por_mes(demandantes, "eo_var_dno_mm_12m_cat"),
        },
    }
    return filas, resumen


def preparar_comarcas() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Las filas de las comarcas que se guardan y, de todas, las sumas de lo que es aditivo, por ocupación.

    Returns:
        Las filas de comarca que se guardan y las sumas aditivas por ocupación.
    """
    filas, sumas = [], {}
    for fila in filas_del_original("C_P8_IND_COMARQUES"):
        valores = indicadores(fila)
        suma = sumas.setdefault(fila["c_grup_primari"], {"cno11": fila["c_grup_primari"], "comarcas": 0})
        suma["comarcas"] += 1
        for campo in ADITIVOS:
            suma[campo] = estable(suma.get(campo, 0) + (valores[campo] or 0))
        if fila["c_comarca_42"] in COMARCAS:
            filas.append({"comarca": fila["c_comarca_42"], "cno11": fila["c_grup_primari"], **valores})
    filas.sort(key=lambda fila: (fila["comarca"], fila["cno11"]))
    return filas, [sumas[codigo] for codigo in sorted(sumas)]


def provincia_de_cada_comarca(tabla: dict[str, Any]) -> dict[str, str]:
    """Código de comarca del Observatori (el mismo del Idescat) → su provincia principal.

    Returns:
        {código de comarca: provincia}.
    """
    return {codigo: comarca["provincia"] for codigo, comarca in tabla["comarcas"].items()}


def contratos_por_provincia(filas: Iterable[dict[str, Any]], provincia_de: dict[str, str]) -> list[dict[str, Any]]:
    """Contratos de 12 meses de cada ocupación sumados por provincia.

    Una comarca que no esté en la tabla no se asigna: la suma de las provincias deja de dar la de Cataluña y la
    validación lo detiene.

    Returns:
        Una fila por ocupación y provincia con sus contratos de 12 meses.
    """
    sumas: dict[str, dict[str, int]] = {}
    for fila in filas:
        provincias = sumas.setdefault(fila["c_grup_primari"], dict.fromkeys(PROVINCIAS, 0))
        provincia = provincia_de.get(fila["c_comarca_42"])
        if provincia is not None:
            exigir(provincia in provincias, f"provincia {provincia!r} no prevista para comarca {fila['c_comarca_42']}")
            provincias[provincia] += fila[CAMPOS["contratos"]] or 0
    return [{"cno11": codigo, "contratos": sumas[codigo]} for codigo in sorted(sumas)]


def metodologia(textos: dict[str, Any]) -> dict[str, Any]:
    """La metodología del visor en texto plano y, de cada definición de Faro, si su frase sigue en ella.

    Returns:
        El texto de la metodología y, por definición, si su frase aparece.
    """
    seccion = textos
    for clave in CLAVE_DE_LA_METODOLOGIA:
        seccion = seccion.get(clave, {})
    texto = " ".join(texto_plano(valor) for valor in seccion.values() if isinstance(valor, str))
    return {"texto": texto, "definiciones": {campo: frase in texto for campo, frase in DEFINICIONES.items()}}
