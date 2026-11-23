"""Originales que permiten reproducir los censos de materia admitidos de Cibernàrium."""

from pathlib import Path

from plataforma_datos.comun.entrada_salida import comprobar_huella
from plataforma_datos.orquestacion import indices_de_canales, originales_troceados
from plataforma_datos.orquestacion.archivos_de_generacion import _arbol, _camino, _exigir, _json, _propio

ARCHIVO = "var/actualizacion/validados/barcelonactiva/cibernarium/materia-censos"
ORIGINALES = "var/actualizacion/originales/barcelonactiva"


def referencias(raiz: Path) -> dict[str, str]:
    """Reúne los originales citados por los recibos de materia de esta generación.

    Returns:
        Rutas canónicas del canal general y del censo de IA con su huella SHA-256.
    """
    carpeta = raiz / ARCHIVO
    if not carpeta.exists() and not carpeta.is_symlink():
        return {}
    rutas = {}
    for recibo in _arbol(_camino(raiz, ARCHIVO)):
        _exigir(recibo.parent == carpeta and recibo.suffix == ".json")
        comprobar_huella(recibo, recibo.stem)
        documento = _json(recibo)
        _exigir(documento["version"] == 1 and documento["informe"]["estado"] == "Admitido")
        for campo, canal in (("documento", "cibernarium-ia"), ("documento_general", "cibernarium")):
            for nombre, sha in indices_de_canales.referencias(documento[campo]):
                _exigir(
                    nombre
                    in {
                        f"{sha}.body",
                        f"{sha}.json",
                        f"cuerpos/{sha}.body",
                        f"metadatos/{sha}.json",
                        f"recepciones/{sha}.json",
                    }
                )
                ruta = f"{ORIGINALES}/{canal}/{nombre}"
                _exigir(rutas.setdefault(ruta, sha) == sha)
    return rutas


def archivos(raiz: Path) -> set[str]:
    """Verifica los cuerpos lógicos de ambos canales.

    Returns:
        Rutas físicas de los originales y de los trozos que los componen.
    """
    seleccion = set()
    for ruta, sha in referencias(raiz).items():
        seleccion.update(originales_troceados.seleccionar(raiz, ruta, sha, _camino, _propio))
    return seleccion
