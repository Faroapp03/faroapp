"""Admisión efectiva y lectura de conjuntos validados; conserva las guardas de cada fuente."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    Json,
    carpetas,
    guardar_json,
    guardar_json_compacto,
    guardar_validacion,
    leer_json,
    ruta_del_conjunto,
)
from plataforma_datos.comun.nucleo import CORRECTO, Controles, ValidacionFallida, exigir


def _es_control(control: object) -> bool:
    """Si un elemento de `controles` tiene la forma `{control, resultado}`, los dos como texto.

    Returns:
        True si es un objeto con `control` y `resultado` de tipo texto.
    """
    return (
        isinstance(control, dict)
        and isinstance(control.get("control"), str)
        and isinstance(control.get("resultado"), str)
    )


def _exigir_controles_correctos(fuente: str, validacion: object) -> None:
    """Exige controles ejecutados `{control, resultado}`, todos correctos, y estado «Admitido»."""
    exigir(isinstance(validacion, dict), f"{fuente}: la validación no es un objeto JSON", ValidacionFallida)
    controles = validacion.get("controles")
    formato_conocido = (
        isinstance(controles, list) and bool(controles) and all(_es_control(control) for control in controles)
    )
    exigir(formato_conocido, f"{fuente}: validación sin controles {{control, resultado}}", ValidacionFallida)
    fallidos = [control["control"] for control in controles if control["resultado"] != CORRECTO]
    exigir(not fallidos, f"{fuente}: validación con errores: " + "; ".join(fallidos), ValidacionFallida)
    admitida = str(validacion.get("estado", "")).startswith("Admitido")
    exigir(admitida, f"{fuente}: no admitida", ValidacionFallida)


def _exigir_informe_coherente(fuente: str, informe: dict[str, Any], controles: Controles) -> None:
    """Impide guardar resultados o etiquetas distintos de los controles realmente ejecutados."""
    exigir(
        informe.get("controles") == controles.lista,
        f"{fuente}: el informe no corresponde a los controles ejecutados",
        ValidacionFallida,
    )
    exigir(
        str(informe.get("estado", "")).startswith("Admitido") == controles.admitido,
        f"{fuente}: el estado del informe no corresponde a sus controles",
        ValidacionFallida,
    )


def cerrar_validacion(  # noqa: PLR0913 - Destino de canal explícito sin cambiar los contratos de los lectores existentes.
    fuente: str,
    informe: dict[str, Any],
    controles: Controles,
    conjunto: Callable[[], Any] | None = None,
    compacto: bool = False,
    *,
    directorio: Path | None = None,
) -> None:
    """Final común de `validar`: guarda el informe, el conjunto si se admite, muestra los controles y exige que pasen.

    El conjunto solo se escribe si la fuente queda admitida: validados/ nunca guarda datos que no pasan sus controles.
    Por eso se recibe como una función, que solo se llama entonces. Va sangrado, o en una línea si es `compacto`.
    El conjunto se compone y se guarda antes que el informe: si falla, no queda un informe nuevo que admita el
    conjunto anterior.
    Un canal de una fuente puede declarar su directorio validado propio: no pisa
    el informe ni el conjunto de los otros canales de esa misma casa.
    """
    _exigir_informe_coherente(fuente, informe, controles)
    datos = conjunto() if conjunto is not None and controles.admitido else None
    _exigir_informe_coherente(fuente, informe, controles)
    if fuente == "empresas":
        from plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce import comprobar_admision

        comprobar_admision(informe, datos)
    if conjunto is not None and controles.admitido:
        guardar = guardar_json_compacto if compacto else guardar_json
        destino = ruta_del_conjunto(fuente) if directorio is None else directorio / (fuente + ".json")
        guardar(destino, datos)
    validacion = carpetas(fuente).validacion if directorio is None else directorio / "validacion.json"
    guardar_validacion(validacion, informe)
    controles.imprimir()
    controles.exigir(fuente)


def exigir_admitido(fuente: str, *, ruta: Path | None = None) -> dict[str, Any]:
    """Devuelve la validación de una fuente si está admitida; si no existe o tiene errores, lanza una excepción.

    Todas las fuentes escriben el mismo formato de `validacion.json`: un `estado` y la lista de `controles`
    `{control, resultado}`. Se admite si hay controles, todos son correctos y el estado empieza por «Admitido».

    Args:
        fuente: El nombre de la fuente, para el diagnóstico y la ruta por defecto.
        ruta: Informe explícito; None usa la carpeta validada habitual de la fuente.

    Returns:
        El informe de validación de la fuente.
    """
    informe = carpetas(fuente).validacion if ruta is None else ruta
    validacion = leer_json(informe)
    _exigir_controles_correctos(fuente, validacion)
    if fuente == "empresas":
        from plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce import comprobar_admision

        conjunto = informe.parent / "empresas.json"
        comprobar_admision(validacion, leer_json(conjunto) if conjunto.exists() else None)
    return validacion


def leer_validado(fuente: str) -> Json:
    """Lee el conjunto validado de otra fuente, solo si esa fuente está admitida.

    Returns:
        El conjunto validado de la fuente.
    """
    exigir_admitido(fuente)
    return leer_json(ruta_del_conjunto(fuente))
