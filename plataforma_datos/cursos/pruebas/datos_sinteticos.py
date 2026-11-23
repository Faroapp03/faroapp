"""Capturas mínimas sintéticas para las regresiones de fichas."""

import hashlib
import json
from pathlib import Path

from plataforma_datos.cursos.pruebas.test_normalizar_investigacion import captura


def _escribir(ruta: Path, contenido: object) -> None:
    """Guarda un documento de la fixture sin consultar fuentes externas."""
    ruta.write_text(json.dumps(contenido, ensure_ascii=False), encoding="utf-8")


def crear_captura_investigacion(raiz: Path) -> Path:
    """Crea seis fichas sintéticas con costes, plazos y desconocidos explícitos.

    Returns:
        Raíz de los documentos y cuerpos verificables de la fixture.
    """
    captura(raiz)
    otras = raiz / "fuentes-investigadas" / "otras-entidades"
    uni = raiz / "fuentes-investigadas" / "universidades"
    manifest = json.loads((otras / "manifest-capturas.json").read_text())
    casos = {
        "saps": {"url": "https://www.saps.gva.es/curso-sintetico", "titulo": "SAPS sintético"},
        "cyldigital": {"url": "https://www.cyldigital.es/curso-sintetico", "titulo": "CyL sintético"},
        "mentor": {
            "url": "https://www.aulamentor.es/curso-sintetico",
            "titulo": "Mentor sintético",
            "plazo_matricula": ["2026-10-13", "2026-10-26 23:59 (zona no especificada)"],
        },
        "upv": {
            "url_oficial_curso": "https://www.edx.org/learn/python/curso-sintetico",
            "titulo": "UPV sintético",
            "coste_formacion": [{"type": "audit", "price": 0}],
            "limite_gratuidad": "acceso temporal",
        },
    }
    for identidad, ficha in casos.items():
        carpeta = uni if identidad == "upv" else otras
        archivo = identidad + ".html"
        cuerpo = ("<h1>" + ficha["titulo"] + "</h1>").encode()
        (carpeta / archivo).write_bytes(cuerpo)
        prueba = {
            "url": ficha.get("url") or ficha["url_oficial_curso"],
            "utc": "2026-10-22T00:00:01+00:00",
            "archivo": archivo,
            "sha256": hashlib.sha256(cuerpo).hexdigest(),
        }
        if identidad == "upv":
            _escribir(uni / "upv.json", prueba)
        else:
            manifest.append(prueba)
    _escribir(otras / "manifest-capturas.json", manifest)
    _escribir(
        otras / "ampliacion-tecnologia.json",
        {"disponibles_saps": [casos["saps"]], "ediciones_regionales_condicionadas": [casos["cyldigital"]]},
    )
    _escribir(otras / "mentor-12-cursos.json", {"cursos": [casos["mentor"]]})
    _escribir(
        uni / "informe-tecnologia-andalucia-valencia.json",
        {"universidad_granada": [], "upv_cursos_tecnologia_audit_parcial": [casos["upv"]]},
    )
    return raiz
