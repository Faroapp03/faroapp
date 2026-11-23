"""Originales de las ediciones FUNDAE que deben acompañar a la salida admitida, incluso tras una consulta parcial."""

import re
from pathlib import Path

from plataforma_datos.cursos.fuentes.fundae import salida
from plataforma_datos.orquestacion import indices_de_canales, originales_troceados
from plataforma_datos.orquestacion.archivos_de_generacion import _camino, _exigir, _json, _propio

INFORME = "var/actualizacion/validados/fundae/validacion.json"
BASE = "var/actualizacion/originales/fundae"
HUELLA = re.compile(r"[0-9a-f]{64}")


def referencias(raiz: Path) -> dict[str, str]:
    """Lee las referencias de la última validación.

    Returns:
        Rutas de cuerpos y recibos con su SHA-256.
    """
    if not (raiz / INFORME).exists() and not (raiz / INFORME).is_symlink():
        return {}
    informe = _json(_camino(raiz, INFORME))
    pruebas = informe.get("evidencias", {})
    _exigir(isinstance(pruebas, dict))
    if "cobertura" in informe and "ediciones" in informe["cobertura"]:
        _exigir(len(pruebas) == informe["cobertura"]["ediciones"])
    conjunto = "var/actualizacion/validados/fundae/fundae.json"
    if (raiz / conjunto).exists():
        publicadas = _json(_camino(raiz, conjunto)).get("ediciones")
        if publicadas is not None:
            _exigir(isinstance(publicadas, list) and {fila["id"] for fila in publicadas} == set(pruebas))
    rutas = {}
    for edicion, consultas in pruebas.items():
        _exigir(salida.con_evidencia(pruebas, edicion) and set(consultas) == set(salida.FICHAS))
        for nombre, ficha in consultas.items():
            canal = "catalogos" if nombre == "indice" else "ediciones"
            for campo, carpeta, extension in (("cuerpo", "cuerpos", "body"), ("recibo", "recepciones", "json")):
                referencia = ficha[campo]
                huella = referencia.get("sha256")
                _exigir(isinstance(huella, str) and HUELLA.fullmatch(huella) is not None)
                relativa = f"{carpeta}/{huella}.{extension}"
                _exigir(referencia.get("archivo") == relativa)
                rutas[f"{BASE}/{canal}/{relativa}"] = huella
    return rutas


def archivos(raiz: Path) -> set[str]:
    """Conserva la prueba de cada edición y la consulta parcial que puede reanudarse al día siguiente.

    Returns:
        Rutas físicas de los originales, el índice de consulta y sus trozos.
    """
    seleccion = set()
    rutas = referencias(raiz)
    indice = f"{BASE}/ediciones/procedencia.json"
    if (raiz / indice).exists() or (raiz / indice).is_symlink():
        consulta = _json(_camino(raiz, indice))
        _exigir(consulta["fuente_id"] == "fundae" and consulta["schema_version"] == 1)
        seleccion.add(indice)
        for canal, parte in (("catalogos", consulta["indice"]), ("ediciones", consulta["especialidades"])):
            for nombre, huella in indices_de_canales.referencias(parte):
                _exigir(nombre in {f"cuerpos/{huella}.body", f"metadatos/{huella}.json", f"recepciones/{huella}.json"})
                ruta = f"{BASE}/{canal}/{nombre}"
                _exigir(rutas.setdefault(ruta, huella) == huella)
    for ruta, huella in rutas.items():
        seleccion.update(originales_troceados.seleccionar(raiz, ruta, huella, _camino, _propio))
    return seleccion
