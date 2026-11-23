"""Pruebas de la cadena completa (reconstruir.py): su orden y las piezas del exportador del paquete.

Las dependencias entre fuentes no se escriben a mano: salen de lo que cada módulo lee de verdad (las validaciones y
los conjuntos que pide por su nombre y las fuentes que importa, también a través de sus módulos de ayuda).
"""

import ast
import importlib
import re
import unittest
from pathlib import Path
from types import ModuleType

import plataforma_datos.comun.fuentes.nombres.lector as nombres
import plataforma_datos.cursos.fuentes.consorci.lector as consorci
import plataforma_datos.cursos.fuentes.formacion.exportacion as formacion
import plataforma_datos.mercado.fuentes.censo.lector as censo
import plataforma_datos.ocupaciones.fuentes.clasificaciones.lector as clasificaciones
from plataforma_datos.comun.nucleo import DATOS, RAIZ
from plataforma_datos.comun.nucleo import PAQUETE as PAQUETE_PUBLICO
from plataforma_datos.orquestacion import modulos, reconstruir

PAQUETE = "plataforma_datos.orquestacion.fuentes"
# Funciones con que un módulo lee lo que otra fuente valida, por el nombre de esa fuente («mundo-eurostat» es
# mundo_eurostat en ORDEN).
LECTORAS = frozenset({"leer_validado", "ruta_del_conjunto", "procedencia", "exigir_admitido"})
# Originales que una persona renueva y que ningún módulo produce: se leen por su nombre (la exportación de la
# formación cita la fecha del catálogo del SEPE) y no tienen puesto en el orden.
ORIGINALES_SIN_MODULO = frozenset({"sepe"})


def importados(arbol: ast.Module) -> set[str]:
    """Lista módulos Python de fuentes y auxiliares de las casas registradas.

    Returns:
        Rutas importables de módulos propios, sin confundir funciones con módulos.
    """
    encontrados: set[str] = set()
    familias = (
        "plataforma_datos.comun",
        "plataforma_datos.orquestacion",
        "plataforma_datos.cursos.fuentes",
        "plataforma_datos.ocupaciones.fuentes",
        "plataforma_datos.mercado.fuentes",
        "plataforma_datos.ia_y_trabajo.fuentes",
        "plataforma_datos.derechos.fuentes",
        "plataforma_datos.biblioteca.fuentes",
        "plataforma_datos.comun.fuentes",
        "plataforma_datos.derivados.fuentes",
    )
    for nodo in ast.walk(arbol):
        candidatos: list[str] = []
        if isinstance(nodo, ast.Import):
            candidatos = [alias.name for alias in nodo.names]
        elif isinstance(nodo, ast.ImportFrom) and nodo.module:
            candidatos = [nodo.module, *(f"{nodo.module}.{alias.name}" for alias in nodo.names)]
        for candidato in candidatos:
            if not any(candidato.startswith(familia + ".") for familia in familias):
                continue
            if (RAIZ / (candidato.replace(".", "/") + ".py")).is_file():
                encontrados.add(candidato)
    return encontrados


def leidas_por_nombre(arbol: ast.Module) -> set[str]:
    """Lista las fuentes que un módulo lee por su nombre literal con una de las LECTORAS.

    Args:
        arbol: árbol sintáctico del módulo.

    Returns:
        Nombres de las fuentes leídas, con guion bajo en lugar de guion.
    """
    leidas: set[str] = set()
    for nodo in ast.walk(arbol):
        if not (isinstance(nodo, ast.Call) and nodo.args and isinstance(nodo.args[0], ast.Constant)):
            continue
        funcion = nodo.func.id if isinstance(nodo.func, ast.Name) else getattr(nodo.func, "attr", None)
        if funcion in LECTORAS and isinstance(nodo.args[0].value, str):
            leidas.add(nodo.args[0].value.replace("-", "_"))
    return leidas


def arbol_de(modulo: ModuleType) -> ast.Module:
    """Lee el árbol sintáctico de un módulo desde su archivo.

    Args:
        modulo: módulo importado, con su `__file__`.

    Returns:
        Árbol sintáctico del módulo.
    """
    return ast.parse(Path(modulo.__file__ or "").read_text(encoding="utf-8"))


def dependencias(modulo: ModuleType) -> set[str]:
    """Descubre dependencias reales también a través de auxiliares de las casas trasladadas.

    Returns:
        Fuentes leídas por nombre o importadas desde módulos Python del registro.
    """
    registradas = {adaptador.__name__: nombre for nombre, adaptador in reconstruir.FUENTES_EN_ORDEN}
    pendientes = [modulo]
    visitados: set[str] = set()
    leidas: set[str] = set()
    while pendientes:
        actual = pendientes.pop()
        if actual.__name__ in visitados:
            continue
        visitados.add(actual.__name__)
        arbol = arbol_de(actual)
        leidas |= leidas_por_nombre(arbol)
        for importado in importados(arbol):
            if importado in registradas:
                leidas.add(registradas[importado])
            elif importado not in visitados:
                pendientes.append(importlib.import_module(importado))
    return leidas


class PruebaReconstruir(unittest.TestCase):
    """Orden de la cadena completa."""

    def test_las_dependencias_se_descubren(self) -> None:
        """El descubrimiento ve las dependencias por nombre, por importación y a través de un módulo de ayuda."""
        self.assertLessEqual({"oit"}, dependencias(clasificaciones))
        self.assertLessEqual({"ocupados", "cataluna"}, dependencias(censo))
        self.assertLessEqual({"formacion"}, dependencias(consorci))
        self.assertLessEqual({"catalan"}, dependencias(nombres))

    def test_orden_respeta_dependencias(self) -> None:
        """Cada fuente va después de todas las fuentes cuya validación, conjunto o módulo lee."""
        orden = list(reconstruir.ORDEN)
        for fuente, modulo in reconstruir.FUENTES_EN_ORDEN:
            for previa in sorted(dependencias(modulo) - {fuente} - ORIGINALES_SIN_MODULO):
                with self.subTest(fuente=fuente, previa=previa):
                    self.assertIn(previa, orden, f"{fuente} lee {previa}, que no está en ORDEN")
                    self.assertLess(orden.index(previa), orden.index(fuente), f"{previa} antes que {fuente}")

    def test_la_lista_documentada_es_orden(self) -> None:
        """La lista numerada de reconstruir.py dice ORDEN, sin huecos, y acaba en el exportador."""
        numeradas = re.findall(r"^\s*(\d+)\. (\S+)", reconstruir.__doc__ or "", re.MULTILINE)
        self.assertEqual([int(numero) for numero, _ in numeradas], list(range(1, len(numeradas) + 1)))
        self.assertEqual(
            [nombre for _, nombre in numeradas],
            [*reconstruir.ORDEN, "plataforma_datos/orquestacion/exportar_paquete.py"],
        )

    def test_cada_nombre_del_orden_es_el_de_su_modulo(self) -> None:
        """Cada fuente de ORDEN se ejecuta con el módulo de su mismo nombre."""
        for nombre, modulo in reconstruir.FUENTES_EN_ORDEN:
            if modulo.__name__.startswith("plataforma_datos.cursos.fuentes."):
                esperado = f"plataforma_datos.cursos.fuentes.{nombre}.lector"
            elif modulo.__name__.startswith("plataforma_datos.ocupaciones.fuentes."):
                esperado = f"plataforma_datos.ocupaciones.fuentes.{nombre}.lector"
            elif modulo.__name__.startswith("plataforma_datos.mercado.fuentes."):
                esperado = f"plataforma_datos.mercado.fuentes.{nombre}.lector"
            elif modulo.__name__.startswith("plataforma_datos.ia_y_trabajo.fuentes."):
                esperado = f"plataforma_datos.ia_y_trabajo.fuentes.{nombre}.lector"
            elif modulo.__name__.startswith("plataforma_datos.biblioteca.fuentes."):
                esperado = f"plataforma_datos.biblioteca.fuentes.{nombre}.lector"
            elif modulo.__name__.startswith("plataforma_datos.derechos.fuentes."):
                esperado = f"plataforma_datos.derechos.fuentes.{nombre}.lector"
            elif modulo.__name__.startswith("plataforma_datos.comun.fuentes."):
                esperado = f"plataforma_datos.comun.fuentes.{nombre}.lector"
            elif modulo.__name__.startswith("plataforma_datos.derivados.fuentes."):
                esperado = f"plataforma_datos.derivados.fuentes.{nombre}.lector"
            else:
                esperado = f"plataforma_datos.orquestacion.fuentes.{nombre}"
            self.assertEqual(modulo.__name__, esperado)

    def test_catalan_solo_se_valida(self) -> None:
        """La traducción con IA no se rehace al reconstruir: catalan solo se valida, también con --descargar."""
        self.assertEqual(reconstruir.etapas(True, "catalan"), ("validar",))
        self.assertEqual(set(reconstruir.SOLO_VALIDAR) - set(reconstruir.ORDEN), set())

    def test_etapas(self) -> None:
        """Sin --descargar no se toca la red."""
        self.assertEqual(reconstruir.etapas(False), ("preparar", "validar"))
        self.assertEqual(reconstruir.etapas(True), ("descargar", "preparar", "validar"))


class PruebaExportador(unittest.TestCase):
    """Piezas del exportador del paquete."""

    @classmethod
    def setUpClass(cls) -> None:
        """Usa el compositor propietario de las fechas de las citas."""
        cls.exportador = formacion

    def test_fecha_es(self) -> None:
        """Las fechas de las citas van en formato día/mes/año."""
        self.assertEqual(self.exportador._fecha_es("2026-09-27"), "27/09/2026")


class PruebaRutasDelRegistro(unittest.TestCase):
    """Los módulos operan fuera del paquete público y las entradas externas mantienen esa separación."""

    def test_carpetas_de_fuentes_en_el_area_operativa(self) -> None:
        """Toda carpeta que se sustituye de una fuente pertenece al área de actualización, no al paquete."""
        operativos = DATOS.relative_to(RAIZ)
        publico = PAQUETE_PUBLICO.relative_to(RAIZ)
        for modulo in modulos.MODULOS:
            for carpeta in modulos.carpetas(modulo):
                with self.subTest(modulo=modulo.id, carpeta=carpeta):
                    self.assertTrue(Path(carpeta).is_relative_to(operativos))
                    self.assertFalse(Path(carpeta).is_relative_to(publico))

    def test_entradas_externas_y_destino_del_paquete(self) -> None:
        """Las entradas aportadas no se publican con el paquete; el destino público se declara aparte."""
        operativos = DATOS.relative_to(RAIZ)
        self.assertEqual(
            modulos.ENTRADAS_EXTERNAS,
            tuple(
                str(operativos / ruta)
                for ruta in (
                    "revisiones",
                    "originales/sepe",
                    "preparados/catalan",
                    "validados/ia-nacional",
                    "validados/encuestas-isco4",
                )
            ),
        )
        self.assertEqual(modulos.CARPETA_DEL_PAQUETE, PAQUETE_PUBLICO.relative_to(RAIZ).as_posix())


if __name__ == "__main__":
    unittest.main()
