"""Periodos propios de Eurostat y continuidad explícita de sus originales ya admitidos.

Una respuesta HTML, vacía o sin JSON es un fallo de consulta, nunca prueba de que falte un periodo. Puede conservarse
un original previo únicamente si sigue íntegro, cumple el contrato y reproduce los datos del conjunto admitido. Esa
continuidad guarda una prueba local separada, la URL y las fechas históricas; no acredita una descarga nueva.
"""

import json
from datetime import date
from typing import Any

from plataforma_datos.comun.dia_de_consulta import dia_de_consulta
from plataforma_datos.comun.estadisticas import etiquetas_jsonstat
from plataforma_datos.comun.nucleo import CORRECTO, Descarga, FormatoInesperado, exigir
from plataforma_datos.mercado.fuentes.empresas.piezas.cifras_empresas import (
    _celdas_eurostat,
    _fila_eurostat,
    cataluna_por_seccion,
    cifra_marcada,
)
from plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas import ANIOS_DE_CATALUNA
from plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce import recursos_registrados


class ConsultaEurostatFallida(FormatoInesperado):
    """La consulta no devolvió un documento JSON; el contrato estadístico no se ha interpretado."""


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado: dict[str, Any] = {}
    for clave, valor in pares:
        exigir(clave not in resultado, "empresas: Eurostat devuelve claves JSON repetidas")
        resultado[clave] = valor
    return resultado


def _constante(_valor: str) -> None:
    raise FormatoInesperado("empresas: Eurostat devuelve una constante JSON no finita")


def leer_respuesta(descarga: Descarga, url: str) -> dict[str, Any]:
    """Exige la URL de consulta y un JSON estricto antes de comprobar su contrato.

    Returns:
        El objeto JSON, todavía pendiente de validación estadística.

    Raises:
        ConsultaEurostatFallida: Si el servidor entrega una respuesta vacía o sin JSON.
        FormatoInesperado: Si cambia la URL, el JSON es ambiguo o el documento no es un objeto.
    """
    exigir(descarga.url_final == url, "empresas: Eurostat redirige fuera de la consulta prevista")
    if not descarga.datos or "json" not in descarga.content_type.lower():
        raise ConsultaEurostatFallida("empresas: Eurostat no entrega una respuesta JSON")
    try:
        tabla = json.loads(descarga.datos, object_pairs_hook=_pares, parse_constant=_constante)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ConsultaEurostatFallida("empresas: Eurostat entrega JSON ilegible") from error
    exigir(isinstance(tabla, dict), "empresas: el documento de Eurostat no es un objeto JSON")
    return tabla


def filas_publicadas(tabla: dict[str, Any], territorio: str) -> tuple[list[dict[str, Any]], list[int]]:
    """Selecciona el último periodo publicado, o la ventana regional que termina en él.

    Returns:
        Filas del periodo propio y años realmente publicados. Nunca usa el año del INE.
    """
    exigir(territorio in ("ES", "ES51"), "empresas: territorio de Eurostat no previsto")
    celdas = _celdas_eurostat(tabla, territorio, None)
    publicados = {int(celda.claves["time"]) for celda in celdas if celda.valor is not None}
    exigir(bool(publicados), "empresas: Eurostat no publica ningún periodo con cifras")
    ultimo = max(publicados)
    anios = [ultimo] if territorio == "ES" else list(range(ultimo - ANIOS_DE_CATALUNA + 1, ultimo + 1))
    exigir(set(anios) <= publicados, "empresas: ventana regional de Eurostat incompleta")
    etiquetas = etiquetas_jsonstat(tabla, "nace_r2")
    filas = [
        {"anio": int(celda.claves["time"]), **_fila_eurostat(celda, etiquetas)}
        for celda in celdas
        if int(celda.claves["time"]) in anios
    ]
    for fila in filas:
        cifra_marcada(fila)
    totales = {f["anio"]: cifra_marcada(f)["pct"] for f in filas if f["nace"] == "C10-S951_X_K"}
    exigir(
        set(totales) == set(anios) and all(v is not None for v in totales.values()),
        "empresas: el histórico de Eurostat no tiene el total firme de cada periodo utilizado",
    )
    return filas, anios


def fechas_del_original(tabla: dict[str, Any], registro: dict[str, Any]) -> dict[str, str]:
    """La actualización declarada y la consulta civil del original íntegro utilizado.

    Returns:
        Fechas con el formato operativo histórico, sin renovarlas al releer un original.

    Raises:
        FormatoInesperado: Si no puede interpretarse una fecha del original.
    """
    actualizado = tabla.get("updated")
    exigir(isinstance(actualizado, str), "empresas: Eurostat no da su fecha de actualización")
    try:
        fecha = date.fromisoformat(actualizado[:10]).isoformat()
        consulta = dia_de_consulta(registro["descargado_utc"])
    except (TypeError, ValueError, FormatoInesperado) as error:
        raise FormatoInesperado("empresas: Eurostat tiene fechas de actualización o consulta inválidas") from error
    return {"actualizado": fecha, "consulta": consulta}


def comprobar_continuidad(tabla: dict[str, Any], prueba: dict[str, Any], regional: bool) -> list[int]:
    """Vincula un original previo con las cifras y la validación que realmente lo admitieron.

    Returns:
        Sus periodos propios, después de verificar la admisión y la reproducción del conjunto anterior.
    """
    validacion, publicado = prueba["validacion"], prueba["publicado"]
    # La prueba acredita una admisión histórica; el candidato actual se recalcula con sus contratos actuales.
    # No admite pruebas de 2026 sin inventario ni convierte sus antiguas huellas en una admisión vigente.
    recursos_registrados(validacion)
    controles = validacion.get("controles")
    exigir(
        isinstance(controles, list)
        and bool(controles)
        and all(c.get("resultado") == CORRECTO for c in controles)
        and str(validacion.get("estado", "")).startswith("Admitido")
        and validacion.get("cobertura", {}).get("edicion") == prueba["edicion"],
        "empresas: la continuidad de Eurostat no tiene una admisión previa válida",
    )
    registro, actualizacion = prueba["registro"], prueba["actualizacion"]
    exigir(
        any(c.get("control") == f"huella de {registro['archivo']}" for c in controles),
        "empresas: el original de Eurostat no figura en los controles admitidos",
    )
    fechas = fechas_del_original(tabla, registro)
    exigir(
        all(actualizacion.get(k) == v for k, v in fechas.items()),
        "empresas: las fechas históricas no coinciden con el original de Eurostat",
    )
    filas, anios = filas_publicadas(tabla, "ES51" if regional else "ES")
    exigir(
        publicado["vigencia"]["periodo"] == str(anios[-1])
        and publicado["vigencia"]["publicado"] == fechas["actualizado"]
        and publicado["vigencia"]["fuente"].endswith(f"consultada el {fechas['consulta']}"),
        "empresas: el conjunto anterior no acredita el periodo o las fechas de Eurostat",
    )
    if regional:
        reconstruido = cataluna_por_seccion(filas, actualizacion)
        exigir(
            publicado["actividades"] == reconstruido["actividades"] and publicado["anios"] == anios,
            "empresas: el original regional no reproduce las cifras del conjunto admitido",
        )
    else:
        firmes = {f["nace"]: cifra_marcada(f)["pct"] for f in filas}
        agregados = publicado["agregados"]
        exigir(
            bool(agregados) and all(firmes.get(c) == d["pct"] and d["pct"] is not None for c, d in agregados.items()),
            "empresas: el original nacional no reproduce las cifras del conjunto admitido",
        )
    return anios


def periodos_del_original(tabla: dict[str, Any], territorio: str) -> list[int]:
    """Los años que contienen cifras en el cuerpo utilizado, antes de seleccionar la ventana de presentación.

    Returns:
        Periodos con alguna cifra publicada, sin atribuirlos a otra consulta o edición.
    """
    return sorted({int(c.claves["time"]) for c in _celdas_eurostat(tabla, territorio, None) if c.valor is not None})


def contraste_pendiente(edicion: dict[str, Any], campo: str) -> dict[str, Any]:
    """Separa la consulta fallida, los periodos observados y la incompatibilidad metodológica.

    Returns:
        Un contraste no comparable y la disponibilidad que realmente se ha comprobado.
    """
    actualizacion = edicion.get(campo) or {}
    anio = actualizacion.get("anio")
    publicados = actualizacion.get("anios_disponibles", actualizacion.get("anios", [anio] if anio else []))
    consulta = actualizacion.get("consulta_actual")
    disponibilidad = "no_comprobada"
    if consulta and consulta.get("estado") == "correcta":
        disponibilidad = (
            "periodo_ine_publicado" if edicion["anio"] in publicados else "periodo_ine_no_observado_en_original"
        )
    return {
        "estado": "no_comparable",
        "disponibilidad": disponibilidad,
        "ultimo_periodo_admitido": str(anio) if anio is not None else None,
        "periodos_observados_en_original": publicados,
        "periodo_ine": f"{edicion['anio']}-T1",
        "periodo_eurostat": str(anio) if anio is not None else None,
        "consulta_actual": consulta,
        "motivos": [
            "INE utiliza CNAE-2025 y Eurostat NACE Rev. 2; las agrupaciones no son equivalentes.",
            "INE expresa D.1 sobre empresas con Internet; Eurostat PC_ENT sobre todas las empresas del ámbito.",
            *(["Los periodos utilizados son distintos."] if anio != edicion["anio"] else []),
        ],
    }
