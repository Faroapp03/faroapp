"""Paridad con el censo de verdad: el veredicto del producto es el mismo que el del censo sobre las páginas reales.

Los cuerpos de las páginas son de terceros y no están en el repositorio. La prueba los lee del expediente de la
coordinación, que se indica con la variable de entorno `FARO_CENSO_DE_VERDAD` (la carpeta `censo-de-verdad` con sus
subcarpetas `censo` y `piloto`); si no está, se omite y dice por qué. Con `python -m` imprime la tabla de acuerdo
por fuente y veredicto.

El censo guarda `cerrado` para tres cosas distintas; el producto las separa: un 404 o 410 y una respuesta igual a la de
lo inexistente son `no_existe`, y solo la señal literal de cierre es `cerrado`.
"""

import collections
import gzip
import json
import os
import unittest
from pathlib import Path
from urllib.parse import urlsplit

from plataforma_datos.cursos.comprobacion_pagina.respuesta import Curso, Respuesta
from plataforma_datos.cursos.comprobacion_pagina.veredicto import comprobar_pagina

VARIABLE = "FARO_CENSO_DE_VERDAD"
CARPETAS = ("censo", "piloto")
HORA = "2026-11-22T02:00:00Z"
# Los nombres de proveedor del censo, en los nombres de fuente del producto. El SOC se publica con la fuente
# `formacion`, que no tiene reconocedor: su página nunca decide.
FUENTE_DEL_PRODUCTO = {
    "cibernarium": "barcelonactiva",
    "anthropic": "claude_academy",
    "hp-life": "hp_life",
    "cibervoluntarios": "cibervoluntarios",
    "fundae": "fundae",
    "soc": "formacion",
}
MOTIVO_DEL_CENSO_CON_SENAL = "señal literal de cierre"


def _jsonl(ruta: Path) -> list[dict]:
    return [json.loads(linea) for linea in ruta.read_text(encoding="utf-8").splitlines() if linea.strip()]


def _cuerpo(carpeta: Path, proveedor: str, huella: str | None) -> bytes:
    ruta = carpeta / "cuerpos" / proveedor / f"{huella}.html.gz"
    return gzip.open(ruta).read() if huella and ruta.exists() else b""


def _respuesta(carpeta: Path, lectura: dict) -> Respuesta:
    return Respuesta(
        url=lectura["url_pedida"],
        http=lectura.get("estado"),
        url_final=lectura.get("url_final"),
        saltos=lectura.get("saltos") or 0,
        tipo=lectura.get("tipo"),
        cuerpo=_cuerpo(carpeta, lectura["proveedor"], lectura.get("huella")),
    )


def _veredicto_esperado(censo: dict) -> str:
    if censo["veredicto"] == "cerrado" and not censo["motivo"].startswith(MOTIVO_DEL_CENSO_CON_SENAL):
        return "no_existe"
    return censo["veredicto"]


def comparar(raiz: Path) -> list[tuple[str, str, str, str, str]]:
    """Recalcula el veredicto de cada curso con página del censo y lo pone junto al del censo.

    Returns:
        Una fila por curso: carpeta, proveedor, veredicto del censo (con `no_existe` separado), el del producto
        y el identificador del curso.
    """
    filas = []
    for nombre in CARPETAS:
        carpeta = raiz / nombre
        ultimas = {(f["proveedor"], f["id"]): f for f in _jsonl(carpeta / "lecturas.jsonl")}
        sondas = {s["dominio"]: s for s in _jsonl(carpeta / "sondas.jsonl")}
        veredictos = {(v["proveedor"], v["id"]): v for v in _jsonl(carpeta / "veredictos.jsonl")}
        for clave, lectura in ultimas.items():
            if not lectura.get("url_pedida"):
                continue
            sonda = sondas.get(urlsplit(lectura["url_pedida"]).netloc.lower())
            curso = Curso(id=lectura["id"], fuente=FUENTE_DEL_PRODUCTO[lectura["proveedor"]], titulo=lectura["titulo"])
            comprobacion = comprobar_pagina(
                curso,
                _respuesta(carpeta, lectura),
                None if sonda is None else _respuesta(carpeta, sonda),
                pedido_utc=HORA,
            )
            esperado = _veredicto_esperado(veredictos[clave])
            filas.append((nombre, lectura["proveedor"], esperado, comprobacion.veredicto, lectura["id"]))
    return filas


def tabla_de_acuerdo(filas: list[tuple[str, str, str, str, str]]) -> list[str]:
    """La tabla de acuerdo por proveedor y veredicto del censo.

    Returns:
        Líneas de una tabla Markdown: proveedor, veredicto del censo, veredicto del producto y cuántos casos.
    """
    cuenta = collections.Counter((proveedor, esperado, obtenido) for _, proveedor, esperado, obtenido, _ in filas)
    lineas = ["| Proveedor | Veredicto del censo | Veredicto del producto | Casos | Acuerdo |", "|---|---|---|---|---|"]
    lineas += [
        f"| {proveedor} | {esperado} | {obtenido} | {casos} | {'sí' if esperado == obtenido else 'NO'} |"
        for (proveedor, esperado, obtenido), casos in sorted(cuenta.items())
    ]
    return lineas


def _raiz() -> Path | None:
    valor = os.environ.get(VARIABLE)
    return Path(valor) if valor and (Path(valor) / "censo" / "lecturas.jsonl").exists() else None


@unittest.skipUnless(_raiz(), f"los cuerpos del censo de verdad no están: indica su carpeta en {VARIABLE}")
class ParidadConElCensoPruebas(unittest.TestCase):
    """El veredicto de cada página real coincide con el del censo."""

    def test_mismo_veredicto_que_el_censo_en_cada_curso(self) -> None:
        """Ningún curso cambia de veredicto respecto al censo, salvo la separación de `no_existe`."""
        filas = comparar(_raiz())
        self.assertGreater(len(filas), 300)
        distintos = [fila for fila in filas if fila[2] != fila[3]]
        self.assertEqual(distintos, [], "\n".join(tabla_de_acuerdo(filas)))

    def test_hay_casos_de_cada_veredicto_posible_en_las_paginas_reales(self) -> None:
        """La comparación cubre páginas disponibles, cerradas, que no existen y dudosas."""
        veredictos = {fila[3] for fila in comparar(_raiz())}
        self.assertTrue({"disponible", "cerrado", "no_existe", "dudoso"} <= veredictos)


if __name__ == "__main__":
    if _raiz() is None:
        raise SystemExit(f"Indica la carpeta del censo de verdad en {VARIABLE}")
    print("\n".join(tabla_de_acuerdo(comparar(_raiz()))))
