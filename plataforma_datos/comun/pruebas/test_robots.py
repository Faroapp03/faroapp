"""Reglas robots.txt y pausa compartida de las descargas de acreditación."""

import subprocess
import sys
import unittest
from pathlib import Path

import plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes as constantes
from plataforma_datos.comun import red, robots
from plataforma_datos.comun.red import AGENTE

# Lo que se deja tardar a un robots.txt hostil: con retroceso, el mismo caso no acabaría en horas.
TIEMPO_HOSTIL_S = 10


class PruebaRobots(unittest.TestCase):
    """Lo que deja leer un robots.txt, con comodines, la regla más larga y el grupo de cada agente."""

    ROBOTS = """
User-agent: *
Disallow: /buscar/act.php?*lang=ca
Disallow: /boe/dias/2008/09/04/
Allow: /boe/dias/2008/09/04/pdfs/permitido.pdf
Disallow: /fin$
Disallow:

User-agent: OtroBuscador
Disallow: /
"""

    def test_comodines_y_regla_mas_larga(self) -> None:
        """Un «*» es cualquier texto, la consulta cuenta, la regla más larga manda y «$» obliga a terminar."""
        permitido = robots.permitido
        self.assertTrue(permitido(self.ROBOTS, "https://www.boe.es/buscar/act.php?id=BOE-A-2011-9930"))
        self.assertFalse(permitido(self.ROBOTS, "https://www.boe.es/buscar/act.php?id=BOE-A-1&lang=ca"))
        self.assertFalse(permitido(self.ROBOTS, "https://www.boe.es/boe/dias/2008/09/04/pdfs/A35840-35915.pdf"))
        self.assertTrue(permitido(self.ROBOTS, "https://www.boe.es/boe/dias/2008/09/04/pdfs/permitido.pdf"))
        self.assertTrue(permitido(self.ROBOTS, "https://www.boe.es/eli/es/rd/2008/08/01/1373/dof/spa/pdf"))
        self.assertFalse(permitido(self.ROBOTS, "https://www.boe.es/fin"))
        self.assertTrue(permitido(self.ROBOTS, "https://www.boe.es/fin/de/verdad"))

    def test_grupo_del_agente(self) -> None:
        """Un agente con su propio grupo sigue ese grupo; el agente común, sin grupo propio, el de «*»."""
        self.assertFalse(robots.permitido(self.ROBOTS, "https://www.boe.es/eli/", agente="otrobuscador"))
        self.assertFalse(robots.permitido(self.ROBOTS, "https://www.boe.es/eli/", agente="OtroBuscador/2.0 (+x)"))
        self.assertTrue(robots.permitido(self.ROBOTS, "https://www.boe.es/eli/"))
        self.assertFalse(robots.permitido("User-agent: *\nDisallow: /", "https://fp.gencat.cat/ca/"))
        self.assertTrue(robots.permitido("", "https://fp.gencat.cat/ca/"), "sin robots.txt, todo se permite")

    def test_mismo_nombre_que_se_envia(self) -> None:
        """Por defecto se busca el grupo del agente que envían las descargas, por su nombre de producto."""
        nombre = robots.nombre_de_producto(AGENTE)
        propio = f"User-agent: *\nDisallow: /\n\nUser-agent: {nombre}\nDisallow: /privado/\n"
        self.assertTrue(robots.permitido(propio, "https://ejemplo.org/publico"))
        self.assertFalse(robots.permitido(propio, "https://ejemplo.org/privado/a"))
        self.assertEqual(robots.nombre_de_producto(" EjemploBot/2.0 (+https://ejemplo.org)"), "ejemplobot")

    def test_ejemplos_de_la_rfc(self) -> None:
        """Los ejemplos de coincidencia del apartado 5.2 de la RFC 9309, con «*» y «$»."""
        casos = {
            "/fish": (
                ["/fish", "/fish.html", "/fish/salmon.html", "/fishheads", "/fish.php?id=x"],
                ["/Fish.asp", "/catfish"],
            ),
            "/fish*": (["/fish", "/fish.html", "/fishheads/yummy.html"], ["/Fish.asp", "/catfish"]),
            "/fish/": (["/fish/", "/fish/?id=x", "/fish/salmon.htm"], ["/fish", "/fish.html", "/Fish/Salmon.asp"]),
            "/*.php": (
                ["/index.php", "/folder/filename.php?p", "/folder/any.php.file.html", "/filename.php/"],
                ["/", "/windows.PHP"],
            ),
            "/*.php$": (
                ["/filename.php", "/folder/filename.php"],
                ["/filename.php?p", "/filename.php/", "/filename.php5"],
            ),
            "/fish*.php": (["/fish.php", "/fishheads/catfish.php?p"], ["/Fish.PHP"]),
            "/a*b*c$": (["/abc", "/axxbyyc", "/abcbc"], ["/abcd", "/acb", "/ab"]),
        }
        for patron, (coinciden, no_coinciden) in casos.items():
            robots_txt = f"User-agent: *\nDisallow: {patron}\n"
            for ruta in coinciden:
                with self.subTest(patron=patron, ruta=ruta):
                    self.assertFalse(robots.permitido(robots_txt, f"https://ejemplo.org{ruta}"))
            for ruta in no_coinciden:
                with self.subTest(patron=patron, ruta=ruta):
                    self.assertTrue(robots.permitido(robots_txt, f"https://ejemplo.org{ruta}"))

    def test_codificacion_por_ciento(self) -> None:
        """Ruta y regla se comparan normalizadas (RFC 9309, 2.2.2): un mismo octeto se escribe siempre igual."""
        self.assertEqual(robots.normalizar("/foo/bar/%62%61%7A"), "/foo/bar/baz")
        self.assertEqual(robots.normalizar("/foo/bar/ツ"), "/foo/bar/%E3%83%84")
        self.assertEqual(robots.normalizar("/a?b=https%3a%2f%2fc"), "/a?b=https%3A%2F%2Fc")
        self.assertFalse(robots.permitido("User-agent: *\nDisallow: /foo/bar/%62%61%7A", "https://e.org/foo/bar/baz"))
        self.assertFalse(robots.permitido("User-agent: *\nDisallow: /privado", "https://e.org/%70rivado/x"))
        self.assertFalse(robots.permitido("User-agent: *\nDisallow: /año", "https://e.org/a%c3%b1o"))
        self.assertFalse(robots.permitido("User-agent: *\nDisallow: /a%3a", "https://e.org/a%3A"))
        self.assertTrue(
            robots.permitido("User-agent: *\nDisallow: /a%3A", "https://e.org/a:"), "lo reservado no se descodifica"
        )
        self.assertTrue(
            robots.permitido("User-agent: *\nDisallow: /a%2A", "https://e.org/ab"), "«%2A» no es un comodín"
        )

    def test_patron_hostil_en_tiempo_acotado(self) -> None:
        """Un robots.txt con muchos «*» y una ruta larga se resuelven en poco tiempo, sin retroceso (CWE-1333)."""
        programa = (
            "from plataforma_datos.comun import robots\n"
            "regla = 'User-agent: *\\nDisallow: /' + 'a*' * 60 + 'b$\\nAllow: /' + 'a*' * 60 + 'c\\n'\n"
            "assert robots.permitido(regla, 'https://e.org/' + 'a' * 200_000)\n"
            "assert not robots.permitido(regla, 'https://e.org/' + 'a' * 200_000 + 'b')\n"
        )
        raiz = Path(__file__).resolve().parents[3]
        try:
            resultado = subprocess.run(
                [sys.executable, "-c", programa], cwd=raiz, capture_output=True, text=True, timeout=TIEMPO_HOSTIL_S
            )
        except subprocess.TimeoutExpired:
            self.fail(f"el robots.txt hostil no se resolvió en {TIEMPO_HOSTIL_S} s")
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


class PruebaPausa(unittest.TestCase):
    """La pausa entre peticiones tiene una sola definición."""

    def test_la_acreditacion_usa_la_pausa_comun_de_red(self) -> None:
        """La constante de la acreditación es la de red.py, no una copia."""
        self.assertEqual(constantes.PAUSA_ENTRE_PETICIONES_S, red.PAUSA_ENTRE_PETICIONES_S)
        self.assertNotIn("PAUSA_ENTRE_PETICIONES_S =", Path(constantes.__file__).read_text(encoding="utf-8"))
