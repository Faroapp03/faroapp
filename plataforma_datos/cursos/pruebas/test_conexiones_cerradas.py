"""Guardia: cada conexión SQLite del catálogo de Cursos se cierra siempre, también si hay un error.

Se admiten tres formas: `with closing(sqlite3.connect(...))`; una conexión asignada a un nombre que la misma función
cierra en un `finally`; y una función que devuelve la conexión abierta, cuando todos sus llamadores del paquete la
cierran en un `finally`.
"""

import ast
import unittest
from pathlib import Path

CURSOS = Path(__file__).resolve().parents[1]
Funcion = ast.FunctionDef | ast.AsyncFunctionDef


def _modulos() -> list[Path]:
    return sorted(ruta for ruta in CURSOS.rglob("*.py") if "pruebas" not in ruta.relative_to(CURSOS).parts)


def _es_llamada(nodo: ast.AST, nombre: str) -> bool:
    funcion = getattr(nodo, "func", None)
    return isinstance(nodo, ast.Call) and (
        (isinstance(funcion, ast.Name) and funcion.id == nombre)
        or (isinstance(funcion, ast.Attribute) and funcion.attr == nombre)
    )


def _es_conexion(nodo: ast.AST) -> bool:
    funcion = getattr(nodo, "func", None)
    return _es_llamada(nodo, "connect") and isinstance(funcion.value, ast.Name) and funcion.value.id == "sqlite3"


def _cierra_en_finally(funcion: Funcion, nombre: str) -> bool:
    return any(
        _es_llamada(llamada, "close") and getattr(llamada.func.value, "id", None) == nombre
        for nodo in ast.walk(funcion)
        if isinstance(nodo, ast.Try)
        for sentencia in nodo.finalbody
        for llamada in ast.walk(sentencia)
    )


def _devuelve(funcion: Funcion, nombre: str) -> bool:
    return any(isinstance(n, ast.Return) and getattr(n.value, "id", None) == nombre for n in ast.walk(funcion))


def _asignaciones(funcion: Funcion, es_apertura: object) -> list[tuple[ast.Assign, str]]:
    return [
        (nodo, nodo.targets[0].id if isinstance(nodo.targets[0], ast.Name) else "")
        for nodo in ast.walk(funcion)
        if isinstance(nodo, ast.Assign) and es_apertura(nodo.value)
    ]


def _funciones(arbol: ast.AST) -> list[Funcion]:
    return [nodo for nodo in ast.walk(arbol) if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef))]


def _sueltas(arbol: ast.AST) -> list[str]:
    """Aperturas que ni se asignan a un nombre ni se envuelven en closing().

    Returns:
        Los lugares de esas aperturas.
    """
    envueltas = {
        id(argumento) for nodo in ast.walk(arbol) if _es_llamada(nodo, "closing") for argumento in nodo.args
    } | {id(nodo.value) for nodo in ast.walk(arbol) if isinstance(nodo, ast.Assign)}
    return [f"sin asignar ni closing:{n.lineno}" for n in ast.walk(arbol) if _es_conexion(n) and id(n) not in envueltas]


def analizar(fuente: str) -> tuple[list[str], set[str]]:
    """Revisa las aperturas de un módulo.

    Returns:
        Las aperturas que pueden quedar abiertas y los nombres de las funciones que devuelven una conexión abierta.
    """
    arbol = ast.parse(fuente)
    sin_cierre = _sueltas(arbol)
    fabricas: set[str] = set()
    for funcion in _funciones(arbol):
        for nodo, nombre in _asignaciones(funcion, _es_conexion):
            if _devuelve(funcion, nombre):
                fabricas.add(funcion.name)
            elif not _cierra_en_finally(funcion, nombre):
                sin_cierre.append(f"{funcion.name}:{nodo.lineno}")
    return sin_cierre, fabricas


class ConexionesCerradasPruebas(unittest.TestCase):
    """Comprueba el código del paquete, no una base: no abre ni crea archivos."""

    def test_cada_conexion_se_cierra_siempre(self) -> None:
        """Ninguna conexión del paquete, directa o por una función que la devuelve, puede quedar abierta."""
        fuentes = {ruta: ruta.read_text(encoding="utf-8") for ruta in _modulos()}
        problemas: list[str] = []
        fabricas: set[str] = set()
        for ruta, fuente in fuentes.items():
            sin_cierre, propias = analizar(fuente)
            problemas += [f"{ruta.relative_to(CURSOS)}: {lugar}" for lugar in sin_cierre]
            fabricas |= propias
        for ruta, fuente in fuentes.items():
            for funcion in _funciones(ast.parse(fuente)):
                for nodo, nombre in _asignaciones(funcion, lambda v: any(_es_llamada(v, f) for f in fabricas)):
                    if not _cierra_en_finally(funcion, nombre):
                        problemas.append(f"{ruta.relative_to(CURSOS)}: {funcion.name}:{nodo.lineno} (fábrica)")
        self.assertEqual(problemas, [], "Conexiones SQLite que pueden quedar abiertas")

    def test_la_guardia_detecta_una_conexion_sin_cerrar(self) -> None:
        """La guardia rechaza una conexión asignada sin cierre y un with sin closing()."""
        asignada = "import sqlite3\ndef f(r):\n    c = sqlite3.connect(r)\n    return c.execute('x')\n"
        self.assertEqual(analizar(asignada)[0], ["f:3"])
        con_with = "import sqlite3\ndef f(r):\n    with sqlite3.connect(r) as c:\n        c.execute('x')\n"
        self.assertEqual(analizar(con_with)[0], ["sin asignar ni closing:3"])


if __name__ == "__main__":
    unittest.main()
