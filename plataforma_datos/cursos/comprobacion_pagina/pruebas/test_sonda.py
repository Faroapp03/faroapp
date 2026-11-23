"""La sonda: su dirección es determinista y con la forma de una ficha real; su comparación no se deja engañar."""

import unittest
from urllib.parse import parse_qsl, urlsplit

from plataforma_datos.cursos.comprobacion_pagina.sonda import Huellas, es_igual_a_la_sonda, url_de_la_sonda

SEMILLA = "20261122"
HUELLA_A = "a" * 64
HUELLA_B = "b" * 64


def huellas(**cambios: object) -> Huellas:
    """Las huellas de una respuesta 200 con cuerpo y texto, con lo que se cambie.

    Returns:
        Las huellas de la respuesta.
    """
    datos = {
        "http": 200,
        "sha256_cuerpo": HUELLA_A,
        "huella_texto": HUELLA_A,
        "longitud_texto": 500,
        "longitud_cuerpo": 900,
    }
    return Huellas(**{**datos, **cambios})


class DireccionDeLaSondaPruebas(unittest.TestCase):
    """La dirección es una función de la ficha y de la semilla, y se parece a la de un curso real."""

    def test_es_determinista_y_depende_de_la_semilla(self) -> None:
        """La misma dirección y la misma semilla dan la misma sonda; otra semilla, otra sonda."""
        url = "https://cursos.ejemplo.test/ficha-actividad?activityId=40112"
        self.assertEqual(url_de_la_sonda(url, SEMILLA), url_de_la_sonda(url, SEMILLA))
        self.assertNotEqual(url_de_la_sonda(url, SEMILLA), url_de_la_sonda(url, "otra"))

    def test_identificador_numerico_en_la_consulta(self) -> None:
        """Se cambia el último parámetro por un número de la misma forma que empieza por 9 y no puede existir."""
        url = "https://cursos.ejemplo.test/ficha-actividad?activityId=40112"
        sonda = urlsplit(url_de_la_sonda(url, SEMILLA))
        ((clave, valor),) = parse_qsl(sonda.query)
        self.assertEqual((sonda.netloc, sonda.path, clave), ("cursos.ejemplo.test", "/ficha-actividad", "activityId"))
        self.assertRegex(valor, r"^9\d{8}$")

    def test_codigo_con_barras_en_la_consulta(self) -> None:
        """Un código con letras y cifras conserva su forma: las cifras cambian y lleva la marca ZZ."""
        url = "https://cursos.ejemplo.test/ficha.html?otro=1&codi=39%2FCIF%2F640%2F1757228"
        antes, despues = (
            dict(parse_qsl(urlsplit(url).query)),
            dict(parse_qsl(urlsplit(url_de_la_sonda(url, SEMILLA)).query)),
        )
        self.assertEqual(despues["otro"], antes["otro"])
        self.assertRegex(despues["codi"], r"^ZZ\d{2}/CIF/\d{3}/\d{7}$")

    def test_ultimo_segmento_del_camino(self) -> None:
        """Sin parámetros se cambia el último segmento: número, código en mayúsculas o nombre."""
        casos = [
            ("https://cursos.ejemplo.test/es/course/135", r"/es/course/9\d{8}"),
            ("https://cursos.ejemplo.test/ficha-curso/oferta/2/BL377Q", r"/ficha-curso/oferta/2/ZZ[A-Z0-9]{6}"),
            ("https://cursos.ejemplo.test/courses/curso-de-prueba/", r"/courses/no-existe-[a-z]{10}"),
        ]
        for url, camino in casos:
            with self.subTest(url=url):
                self.assertRegex(urlsplit(url_de_la_sonda(url, SEMILLA)).path, f"^{camino}$")

    def test_sin_fragmento_y_con_el_mismo_dominio(self) -> None:
        """El fragmento no llega al servidor y el dominio no cambia."""
        sonda = urlsplit(url_de_la_sonda("https://cursos.ejemplo.test/courses/uno#seccion", SEMILLA))
        self.assertEqual((sonda.netloc, sonda.fragment), ("cursos.ejemplo.test", ""))

    def test_identificador_largo_no_se_trunca(self) -> None:
        """Un identificador de más de 32 cifras da una sonda de su misma longitud."""
        largo = "1" * 40
        sonda = urlsplit(url_de_la_sonda(f"https://cursos.ejemplo.test/curso/{largo}", SEMILLA)).path
        self.assertEqual(len(sonda.rsplit("/", 1)[1]), 41)


class ComparacionConLaSondaPruebas(unittest.TestCase):
    """Una página es igual a la sonda solo si responde lo mismo, y lo vacío no se compara."""

    def test_igual_por_cuerpo_o_por_texto(self) -> None:
        """El mismo estado con el mismo cuerpo, o con el mismo texto visible, es igual."""
        self.assertTrue(es_igual_a_la_sonda(huellas(), huellas()))
        self.assertTrue(
            es_igual_a_la_sonda(huellas(huella_texto=HUELLA_B), huellas(huella_texto=HUELLA_B, sha256_cuerpo=HUELLA_B))
        )
        self.assertTrue(
            es_igual_a_la_sonda(huellas(sha256_cuerpo=HUELLA_B), huellas(sha256_cuerpo=HUELLA_B, huella_texto=HUELLA_B))
        )

    def test_distinta_si_cambia_el_estado_o_el_contenido(self) -> None:
        """Otro estado HTTP o otro cuerpo y otro texto no son la sonda."""
        self.assertFalse(es_igual_a_la_sonda(huellas(http=404), huellas()))
        distinta = huellas(sha256_cuerpo=HUELLA_B, huella_texto=HUELLA_B)
        self.assertFalse(es_igual_a_la_sonda(distinta, huellas()))

    def test_sin_sonda_nada_es_igual(self) -> None:
        """Si no hay sonda no se puede decir que la página sea igual a ella."""
        self.assertFalse(es_igual_a_la_sonda(huellas(), None))

    def test_dos_paginas_vacias_no_son_la_misma(self) -> None:
        """Un cuerpo vacío y un texto vacío no prueban nada."""
        vacia = huellas(longitud_texto=0, longitud_cuerpo=0)
        self.assertFalse(es_igual_a_la_sonda(vacia, vacia))


if __name__ == "__main__":
    unittest.main()
