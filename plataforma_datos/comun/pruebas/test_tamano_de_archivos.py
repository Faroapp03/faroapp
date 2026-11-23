"""Guardia del tamaño de los archivos de código propio.

La convención fija un umbral de líneas de código por archivo y una lista nominal de excepciones, cada una con su techo
y su motivo. La lista vive en `scripts/tamano-de-archivos.json`.

- TypeScript y JavaScript los mide Biome (`style/noExcessiveLinesPerFile` en `biome.json`), que cuenta las líneas donde
  hay código, sin blancos ni comentarios. Esta prueba no los vuelve a medir: comprueba que `biome.json` declara el mismo
  umbral, las mismas exclusiones y los mismos techos que la lista.
- Python lo mide esta prueba, porque Ruff no tiene una regla de longitud de módulo. Usa el mismo criterio que Biome:
  cuenta las líneas donde empieza un elemento de código; no cuenta blancos, comentarios ni el interior de las cadenas
  de varias líneas.

Un archivo nuevo no supera el umbral y una excepción no crece por encima de su techo sin revisar la lista. Una excepción
cuyo archivo desaparece hace fallar esta prueba; en Python también la que baja del umbral. En TS/JS esta prueba solo lo
detecta cuando incluso las líneas no vacías bajan del umbral: si bajan solo las de código, retirarla es una revisión
manual, como bajar el techo de un archivo que se reduce sin bajar del umbral.
"""

import io
import json
import tokenize
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
LISTA = RAIZ / "scripts" / "tamano-de-archivos.json"
BIOME = RAIZ / "biome.json"
REGLA_BIOME = "noExcessiveLinesPerFile"

# Carpetas de la raíz que no contienen código propio: dependencias, datos, estado local y artefactos construidos.
CARPETAS_AJENAS_EN_LA_RAIZ = frozenset({".venv", "node_modules", "datos", "var", "dist", "web"})
# Las pruebas no tienen techo por archivo: se agrupan por el comportamiento que acreditan.
CARPETAS_SIN_TECHO = frozenset({"pruebas", "__pycache__", ".git"})

TOKENS_SIN_CODIGO = frozenset(
    {
        tokenize.COMMENT,
        tokenize.NL,
        tokenize.NEWLINE,
        tokenize.INDENT,
        tokenize.DEDENT,
        tokenize.ENCODING,
        tokenize.ENDMARKER,
    }
)


def contar_lineas_de_codigo(fuente: bytes) -> int:
    """Cuenta las líneas de un texto Python donde empieza algún elemento de código.

    Returns:
        El número de líneas distintas en las que empieza un token que no es comentario, salto ni sangría.
    """
    tokens = tokenize.tokenize(io.BytesIO(fuente).readline)
    return len({token.start[0] for token in tokens if token.type not in TOKENS_SIN_CODIGO})


def lineas_de_codigo(archivo: Path) -> int:
    """Cuenta las líneas de código de un módulo Python con el criterio de Biome.

    Returns:
        Las líneas de código del archivo.
    """
    return contar_lineas_de_codigo(archivo.read_bytes())


def lineas_no_vacias(archivo: Path) -> int:
    """Cuenta las líneas físicas con algún carácter visible; siempre es igual o mayor que las de código.

    Returns:
        El número de líneas que no están en blanco.
    """
    return sum(1 for linea in archivo.read_text(encoding="utf-8").splitlines() if linea.strip())


def modulos_python_propios() -> list[Path]:
    """Recorre el producto y devuelve los módulos Python propios, sin pruebas ni dependencias.

    Returns:
        Las rutas de los módulos, ordenadas.
    """
    modulos = []
    for carpeta, subcarpetas, archivos in RAIZ.walk():
        ajenas = CARPETAS_AJENAS_EN_LA_RAIZ if carpeta == RAIZ else frozenset()
        subcarpetas[:] = [nombre for nombre in subcarpetas if nombre not in ajenas | CARPETAS_SIN_TECHO]
        modulos += [
            carpeta / nombre for nombre in archivos if nombre.endswith(".py") and not nombre.startswith("test_")
        ]
    return sorted(modulos)


def leer_lista() -> dict:
    """Lee la lista de excepciones.

    Returns:
        El contenido de `scripts/tamano-de-archivos.json`.
    """
    return json.loads(LISTA.read_text(encoding="utf-8"))


def regla_en_biome() -> tuple[dict, dict[str, int], set[str]]:
    """Extrae de `biome.json` la regla general, los techos por archivo y las rutas excluidas.

    Returns:
        La configuración general de la regla, los techos por archivo y los patrones donde la regla está apagada.
    """
    configuracion = json.loads(BIOME.read_text(encoding="utf-8"))
    general = configuracion["linter"]["rules"]["style"][REGLA_BIOME]
    techos: dict[str, int] = {}
    apagadas: set[str] = set()
    for ajuste in configuracion.get("overrides", []):
        regla = ajuste.get("linter", {}).get("rules", {}).get("style", {}).get(REGLA_BIOME)
        if regla is None:
            continue
        if regla.get("level") == "off":
            apagadas.update(ajuste["includes"])
        else:
            (ruta,) = ajuste["includes"]
            techos[ruta] = regla["options"]["maxLines"]
    return general, techos, apagadas


class TamanoDeArchivos(unittest.TestCase):
    """El código propio respeta el umbral o el techo de su excepción."""

    def setUp(self) -> None:
        """Carga la lista y separa las excepciones por lenguaje."""
        self.lista = leer_lista()
        self.umbral = self.lista["umbral"]
        excepciones = self.lista["excepciones"]
        self.python = {ruta: datos for ruta, datos in excepciones.items() if ruta.endswith(".py")}
        self.biome = {ruta: datos for ruta, datos in excepciones.items() if not ruta.endswith(".py")}

    def test_ningun_modulo_python_supera_el_umbral_ni_su_techo(self) -> None:
        """Un módulo nuevo cabe en el umbral; uno de la lista, en su techo."""
        excesos = []
        for modulo in modulos_python_propios():
            ruta = modulo.relative_to(RAIZ).as_posix()
            limite = self.python.get(ruta, {}).get("techo", self.umbral)
            lineas = lineas_de_codigo(modulo)
            if lineas > limite:
                excesos.append(f"{ruta}: {lineas} líneas de código; el límite es {limite}")
        self.assertEqual(excesos, [], "Divide el módulo por responsabilidades o revisa su entrada en la lista")

    def test_cada_excepcion_sigue_siendo_necesaria_y_tiene_motivo(self) -> None:
        """Una excepción sale de la lista cuando su archivo desaparece o baja del umbral."""
        motivos = self.lista["motivos"]
        sobrantes = []
        for ruta, datos in self.lista["excepciones"].items():
            archivo = RAIZ / ruta
            self.assertIn(datos["motivo"], motivos, ruta)
            self.assertGreater(datos["techo"], self.umbral, ruta)
            if not archivo.is_file():
                sobrantes.append(f"{ruta}: ya no existe")
                continue
            # En TS/JS, si ni siquiera las líneas no vacías superan el umbral, las de código tampoco.
            medida = lineas_de_codigo(archivo) if ruta.endswith(".py") else lineas_no_vacias(archivo)
            if medida <= self.umbral:
                sobrantes.append(f"{ruta}: {medida} líneas, ya cabe en el umbral")
        self.assertEqual(sobrantes, [], "Quita estas entradas de la lista (y de biome.json si son TS/JS)")

    def test_biome_aplica_el_mismo_umbral_exclusiones_y_techos(self) -> None:
        """`biome.json` no se separa de la lista: mismo umbral, mismas exclusiones y un techo por excepción."""
        general, techos, apagadas = regla_en_biome()
        self.assertEqual(general["level"], "error")
        self.assertEqual(general["options"], {"maxLines": self.umbral, "skipBlankLines": True})
        self.assertEqual(techos, {ruta: datos["techo"] for ruta, datos in self.biome.items()})
        self.assertEqual(apagadas, set(self.lista["fuera_de_la_medida"]))

    def test_la_medida_python_no_cuenta_blancos_comentarios_ni_cadenas_largas(self) -> None:
        """El contador sigue el criterio de Biome en un ejemplo pequeño."""
        texto = '# comentario\n\nVALOR = 1  # al final\nTEXTO = """uno\ndos\ntres"""\n\n\nif VALOR:\n    pass\n'
        self.assertEqual(contar_lineas_de_codigo(texto.encode()), 4)
