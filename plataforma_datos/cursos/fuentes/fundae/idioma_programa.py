"""Datos lingüísticos del programa FUNDAE, sin afirmar el idioma de sus ediciones."""

import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


def preparar_registro(ofertas: list[dict], cuerpos: Path) -> list[dict]:
    """Lee solo la respuesta exacta referenciada por la edición.

    Returns:
        Declaraciones de programa enlazadas a URL, SHA y código.
    """
    resultado = []
    for oferta in ofertas:
        if oferta.get("proveedor_id") != "fundae:publicador:catalogo:3":
            continue
        programa = oferta["unidad"]["programa_id"]
        codigo = programa.removeprefix("fundae:oferta:programa:")
        for referencia in oferta["referencias"]:
            url = referencia["url"]
            partes = urlsplit(url)
            if partes.netloc != "agora.fundae.es" or partes.path != "/Oferta/RecuperarDifusionesRFO":
                continue
            if parse_qs(partes.query).get("codigoTitulacion") != [codigo]:
                continue
            ruta = cuerpos / (referencia["sha256"] + ".body")
            if not ruta.is_file():
                continue
            cuerpo = ruta.read_bytes()
            if hashlib.sha256(cuerpo).hexdigest() != referencia["sha256"]:
                continue
            try:
                curso = json.loads(cuerpo).get("curso", {})
            except (ValueError, UnicodeDecodeError):
                continue
            if (
                curso.get("codigoTitulacion") != codigo
                or curso.get("denominacion") != oferta["titulo_programa"]
                or curso.get("idIdioma") != 1
                or curso.get("descripcionIdioma") != "Español"
            ):
                continue
            resultado.append(
                {
                    "unidad": oferta["unidad"],
                    "titulo": oferta["titulo_programa"],
                    "codigo": codigo,
                    "idioma": "es",
                    "evidencia": {
                        "url": url,
                        "sha256": referencia["sha256"],
                        "capturadoEl": referencia["fecha_referencia"],
                        "localizador": "/curso/descripcionIdioma",
                    },
                }
            )
            break
    return sorted(resultado, key=lambda x: x["unidad"]["id"])


def escribir_registro(ofertas: list[dict], cuerpos: Path, destino: Path) -> None:
    """Guarda una proyección reproducible sin reescribir bytes idénticos."""
    contenido = (
        json.dumps({"version": 1, "registros": preparar_registro(ofertas, cuerpos)}, ensure_ascii=False, indent=2)
        + "\n"
    )
    if not destino.exists() or destino.read_text(encoding="utf-8") != contenido:
        destino.write_text(contenido, encoding="utf-8")


def main() -> None:
    """Regenera el índice con una entrega admitida y las respuestas conservadas del ciclo."""
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogo", required=True, type=Path)
    parser.add_argument("--cuerpos", required=True, type=Path)
    parser.add_argument("--salida", required=True, type=Path)
    argumentos = parser.parse_args()
    entrega = json.loads(argumentos.catalogo.read_text(encoding="utf-8"))
    escribir_registro(entrega["ofertas"], argumentos.cuerpos, argumentos.salida)


if __name__ == "__main__":
    main()


def aplicar_a_colecciones(colecciones: dict, referencias_indexadas: dict) -> int:  # noqa: C901, PLR0912
    """Vincula declaraciones de programa a respuestas FUNDAE admitidas por edición.

    Returns:
        Cantidad de ediciones con declaración programática enlazada.
    """
    programas = {p["id"]: p for p in colecciones["unidades"] if p["proveedor_id"] == "fundae:publicador:catalogo:3"}
    cambios = 0
    for edicion in colecciones["ediciones"]:
        programa = programas.get(edicion["programa_id"])
        if programa is None or not edicion["id"].startswith("fundae:edicion:"):
            continue
        codigo = programa["id"].removeprefix("fundae:oferta:programa:")
        resultados = []
        contradictorio = False
        for ref in edicion.get("referencias", []):
            partes = urlsplit(ref["url"])
            if (
                partes.netloc != "agora.fundae.es"
                or partes.path != "/Oferta/RecuperarDifusionesRFO"
                or parse_qs(partes.query).get("codigoTitulacion") != [codigo]
            ):
                continue
            fichero = referencias_indexadas.get(ref["sha256"])
            if fichero is None:
                continue
            cuerpo = fichero.ruta.read_bytes()
            if hashlib.sha256(cuerpo).hexdigest() != ref["sha256"]:
                continue
            try:
                fuente = json.loads(cuerpo).get("curso", {})
            except (ValueError, UnicodeDecodeError):
                continue
            if fuente.get("codigoTitulacion") != codigo or fuente.get("denominacion") != programa["titulo"]:
                continue
            if fuente.get("idIdioma") != 1 or fuente.get("descripcionIdioma") != "Español":
                contradictorio = True
            else:
                resultados.append({"valores": ["es"], "url": ref["url"], "sha256": ref["sha256"]})
        nuevo = resultados[0] if resultados and not contradictorio else None
        if edicion.get("idioma_programa") != nuevo:
            if nuevo is None:
                edicion.pop("idioma_programa", None)
            else:
                edicion["idioma_programa"] = nuevo
            cambios += 1
    return cambios
