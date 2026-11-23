"""Paridad de la clasificación: lo que decide el productor frente a lo que hoy ve la persona en Cursos.

Aplica el clasificador de cada fuente a sus ofertas del catálogo publicado y compara cada dato (idioma, nivel y
materia), oferta a oferta, con la foto de referencia de la web (`pruebas/fixtures/foto-clasificacion-20261118.utf8`).
Cada comparación es `igual`, `distinto` (con los dos valores) o `sin-decidir` (la fuente no decide ese dato en el
productor). Solo lee: no escribe el catálogo ni la foto.

Uso: `python -m plataforma_datos.cursos.clasificacion.paridad [--fuente <proveedor>] [--comprobar]`.
"""

import argparse
import json
import sys
from pathlib import Path

from plataforma_datos.cursos import contrato_entrega_catalogo as contrato
from plataforma_datos.cursos.clasificacion.contrato import campo_de_valor
from plataforma_datos.cursos.clasificacion.emision import clasificar_oferta
from plataforma_datos.cursos.exigencias_entrega_catalogo import exigir
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

RAIZ = Path(__file__).resolve().parents[3]
CATALOGO = RAIZ / "web/datos/catalogo-cursos"
FOTO = RAIZ / "pruebas/fixtures/foto-clasificacion-20261118.utf8"
REFERENCIA = RAIZ / "pruebas/fixtures/paridad-clasificacion.json"
DATOS = ("idioma", "nivel", "materia")
RESULTADOS = ("igual", "distinto", "sin-decidir")
# Cómo se lee el origen que anota la foto en el contrato: el estado que le corresponde y, cuando el origen lo fija,
# el alcance. El idioma de la edición, del programa o de la norma general es de la fuente con ese alcance; el que
# deduce Faro (`faro`) o el historial de ediciones de Cibernàrium son orientación de Faro. En el nivel, `fuente` es
# el que publica la fuente y `faro` el que deduce una regla. Toda la materia que muestra la web (revisión editorial u
# otra regla) es orientación de Faro. Lo que la foto deja por confirmar no tiene origen.
CORRESPONDENCIA = {
    ("idioma", "edicion"): ("fuente", "edicion"),
    ("idioma", "programa"): ("fuente", "programa"),
    ("idioma", "norma-general"): ("fuente", "norma-general"),
    ("idioma", "faro"): ("orientacion-faro", None),
    ("idioma", "historial-cibernarium"): ("orientacion-faro", None),
    ("nivel", "fuente"): ("fuente", None),
    ("nivel", "faro"): ("orientacion-faro", None),
    ("materia", "revision-editorial"): ("orientacion-faro", None),
    ("materia", "otra-orientacion-de-faro"): ("orientacion-faro", None),
    **{(dato, None): ("por-confirmar", None) for dato in DATOS},
}


def clave_de(oferta: ObjetoJson) -> str:
    """La clave de la unidad en la foto: `["tipo","id"]` en JSON compacto.

    Returns:
        La clave de la oferta.
    """
    unidad = oferta["unidad"]
    return json.dumps([unidad["tipo"], unidad["id"]], ensure_ascii=False, separators=(",", ":"))


def _valor_de_la_foto(nombre: str, dato: ObjetoJson) -> ValorJson:
    if nombre == "nivel":
        return None if dato["valor"] is None else dato["valor"]["nivel"]
    return sorted(dato["valor"]) or None


def comparar_dato(nombre: str, visto: ObjetoJson, decidido: ObjetoJson | None) -> tuple[str, ObjetoJson | None]:
    """Compara un dato de la foto con el que decide el productor.

    Returns:
        El resultado (`igual`, `distinto` o `sin-decidir`) y, si es distinto, los dos valores.
    """
    clave = (nombre, visto["origen"] if visto["estado"] != "por-confirmar" else None)
    exigir(clave in CORRESPONDENCIA, "Origen de la foto sin correspondencia en el contrato: " + repr(clave))
    if decidido is None:
        return "sin-decidir", None
    estado, alcance = CORRESPONDENCIA[clave]
    valor = _valor_de_la_foto(nombre, visto)
    igual = (
        decidido["estado"] == estado
        and (alcance is None or decidido["alcance"] == alcance)
        and decidido[campo_de_valor(nombre)] == valor
    )
    if igual:
        return "igual", None
    return "distinto", {
        "foto": {"estado": visto["estado"], "origen": visto["origen"], "valor": valor},
        "productor": {
            "estado": decidido["estado"],
            "alcance": decidido["alcance"],
            "valor": decidido[campo_de_valor(nombre)],
        },
    }


def paridad(catalogo: ObjetoJson, foto: ObjetoJson) -> ObjetoJson:
    """Compara cada fuente del catálogo con la foto, dato a dato y oferta a oferta.

    Returns:
        Por proveedor, los recuentos de cada dato y la lista de los datos distintos con sus dos valores.
    """
    vistas = {u["clave"]: u for u in foto["unidades"]["cursos"]}
    ofertas = {clave_de(o): o for o in catalogo["ofertas"]}
    exigir(set(ofertas) == set(vistas), "El catálogo y la foto no tienen las mismas unidades")
    salida = {}
    for clave in sorted(ofertas):
        oferta, vista = ofertas[clave], vistas[clave]
        exigir(oferta["proveedor_id"] == vista["fuente"], "Unidad de otra fuente en la foto: " + clave)
        fuente = salida.setdefault(
            oferta["proveedor_id"],
            {"recuentos": {d: dict.fromkeys(RESULTADOS, 0) for d in DATOS}, "distintos": []},
        )
        bloque = clasificar_oferta(oferta, catalogo["corte_proyeccion_utc"]) or {}
        for nombre in DATOS:
            resultado, valores = comparar_dato(nombre, vista["datos"][nombre], bloque.get(nombre))
            fuente["recuentos"][nombre][resultado] += 1
            if valores is not None:
                fuente["distintos"].append({"clave": clave, "dato": nombre, **valores})
    return salida


def catalogo_publicado() -> ObjetoJson:
    """Lee y valida la única entrega publicada en el árbol.

    Returns:
        La entrega pública.
    """
    (ruta,) = sorted(CATALOGO.glob("*.json"))
    catalogo = json.loads(ruta.read_text(encoding="utf-8"))
    contrato.validar_publico(catalogo)
    return catalogo


def paridad_de_hoy() -> ObjetoJson:
    """La paridad del catálogo publicado frente a la foto de referencia.

    Returns:
        La paridad por proveedor.
    """
    return paridad(catalogo_publicado(), json.loads(FOTO.read_text(encoding="utf-8")))


def texto(dato: ValorJson) -> str:
    """El JSON de la paridad tal como se guarda en su referencia.

    Returns:
        JSON con sangría de dos espacios y salto de línea final.
    """
    return json.dumps(dato, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main(argumentos: list[str] | None = None) -> int:
    """Muestra la paridad (de una fuente o de todas) o la compara con su referencia.

    Returns:
        0 si se muestra o coincide con la referencia; 1 si la paridad de hoy es distinta de la referencia.
    """
    lector = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    lector.add_argument("--fuente", help="proveedor del catálogo, por ejemplo fundae:publicador:catalogo:3")
    lector.add_argument("--comprobar", action="store_true", help="compara con su referencia en pruebas/fixtures")
    opciones = lector.parse_args(argumentos)
    hoy = paridad_de_hoy()
    if opciones.comprobar:
        return 0 if texto(hoy) == REFERENCIA.read_text(encoding="utf-8") else 1
    if opciones.fuente is not None:
        exigir(opciones.fuente in hoy, "Fuente sin ofertas en el catálogo publicado: " + opciones.fuente)
        hoy = {opciones.fuente: hoy[opciones.fuente]}
    sys.stdout.write(texto(hoy))
    return 0


if __name__ == "__main__":
    sys.exit(main())
