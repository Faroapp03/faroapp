"""Contraste de la oferta FPCAT (7vig-4syr) con la versión de jdcj-za6r que estaba en vigor cuando se actualizó.

Las filas del Consorci en 7vig-4syr reproducen los cursos con fecha de jdcj-za6r, pero los dos conjuntos se actualizan
en momentos distintos: jdcj-za6r cada día; 7vig-4syr cuando cambia. Solo son comparables con la versión de jdcj-za6r en
vigor cuando se actualizó 7vig-4syr: una versión estaba en vigor en un instante si se había actualizado antes y se
descargó después. Las candidatas son la de la copia y las versiones admitidas que guarda el historial.

- Con pareja, las dos ofertas, como multiconjuntos de (código de la oferta, fecha de inicio), deben ser idénticas, sin
  tolerancia: cualquier diferencia es una contradicción. Si hay más de una candidata posible, deben serlo con todas, de
  modo que un emparejamiento dudoso solo puede rechazar.
- Sin pareja, el contraste es «no comparable»: no es un control superado ni un fallo, y se anota el desfase.

Cada versión es `{actualizado, descargado_utc, con_fecha, huella}`. `actualizado` es el instante ISO de la última
actualización de sus filas (rowsUpdatedAt) o, si solo se conoce el día, AAAA-MM-DD: entonces cuenta desde el primer
instante de ese día, lo que amplía las parejas posibles y, por la regla anterior, solo puede endurecer el contraste.
"""

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Any

IDENTICA = "idéntica"
DISTINTA = "distinta"
NO_COMPARABLE = "no comparable"


def huella_de_la_oferta(pares: list[tuple[str, str]]) -> str:
    """SHA-256 del multiconjunto de pares (oferta, fecha de inicio): la lista ordenada, en JSON compacto UTF-8.

    Returns:
        La huella, en hexadecimal.
    """
    canonico = json.dumps(sorted(list(par) for par in pares), ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def version_de_la_oferta(pares: list[tuple[str, str]], actualizado: str, descargado_utc: str) -> dict[str, Any]:
    """Una versión de la oferta: cuándo se actualizó y se descargó, cuántas ediciones tiene y la huella de todas.

    Returns:
        La versión, con las fechas, la cuenta de ediciones y la huella.
    """
    return {
        "actualizado": actualizado,
        "descargado_utc": descargado_utc,
        "con_fecha": len(pares),
        "huella": huella_de_la_oferta(pares),
    }


def _instante(valor: str) -> datetime:
    """Un instante ISO con zona; un día AAAA-MM-DD, su primer instante en UTC.

    Returns:
        El instante, con zona horaria UTC si el valor era solo un día.

    Raises:
        ValueError: Si el instante no tiene zona horaria.
    """
    if len(valor) == len("AAAA-MM-DD"):
        return datetime.combine(date.fromisoformat(valor), datetime.min.time(), tzinfo=UTC)
    instante = datetime.fromisoformat(valor)
    if instante.tzinfo is None:
        raise ValueError(f"instante sin zona horaria: {valor}")
    return instante


def en_vigor(version: dict[str, Any], instante: str) -> bool:
    """Si la versión pudo estar en vigor en `instante`: actualizada antes (o entonces) y descargada después.

    Returns:
        True si la versión pudo estar en vigor en ese instante.
    """
    momento = _instante(instante)
    return _instante(version["actualizado"]) <= momento <= _instante(version["descargado_utc"])


def contrastar(oferta: dict[str, Any], cursos: dict[str, Any], historial: list[dict[str, Any]]) -> dict[str, Any]:
    """El contraste de la oferta con su pareja: idéntica, distinta o no comparable (con el desfase en días).

    Returns:
        El contraste, con su estado y, si no es comparable, el desfase en días.
    """
    parejas = [version for version in (cursos, *historial) if en_vigor(version, oferta["actualizado"])]
    if not parejas:
        desfase = (_instante(cursos["actualizado"]).date() - _instante(oferta["actualizado"]).date()).days
        return {
            "resultado": NO_COMPARABLE,
            "oferta_actualizada": oferta["actualizado"],
            "cursos_actualizados": cursos["actualizado"],
            "desfase_dias": desfase,
        }
    identica = all(version["huella"] == oferta["huella"] for version in parejas)
    return {
        "resultado": IDENTICA if identica else DISTINTA,
        "oferta_actualizada": oferta["actualizado"],
        "con_fecha": oferta["con_fecha"],
        "comparada_con": sorted({version["actualizado"] for version in parejas}),
    }


def historial_con(historial: list[dict[str, Any]], version: dict[str, Any]) -> list[dict[str, Any]]:
    """El historial con una versión admitida más, por fecha; si ya estaba, conserva su última descarga admitida.

    La misma huella y actualización observadas después amplían la vigencia conocida solo hasta esa descarga.
    No se infiere vigencia más allá de una observación admitida ni se cambian las entradas recibidas.

    Returns:
        El historial con la versión añadida o su descarga posterior, sin duplicar huella y actualización.
    """
    for numero, previa in enumerate(historial):
        if previa["huella"] == version["huella"] and previa["actualizado"] == version["actualizado"]:
            if _instante(version["descargado_utc"]) > _instante(previa["descargado_utc"]):
                actualizado = {**previa, "descargado_utc": version["descargado_utc"]}
                return [*historial[:numero], actualizado, *historial[numero + 1 :]]
            return historial
    return sorted([*historial, version], key=lambda previa: _instante(previa["actualizado"]))
