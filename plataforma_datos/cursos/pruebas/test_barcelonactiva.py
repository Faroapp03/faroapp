"""Pruebas de barcelonactiva.py: la lectura del catálogo y del Cibernàrium, el enlace por código y el contraste."""

import locale
import unittest

import plataforma_datos.cursos.fuentes.barcelonactiva.lector as barcelonactiva
from plataforma_datos.comun.nucleo import FormatoInesperado

UUID_1 = "9e4269d5-e10e-4f49-ac99-65c833f933a2"
UUID_2 = "a8d05b64-f60b-4dd9-91c2-e2e63d82f2f5"


def nodo(uuid: str, texto: str) -> str:
    """Un enlace del árbol del catálogo, como lo pinta la página.

    Args:
        uuid: Identificador de la ficha.
        texto: Lo que se lee en el enlace: código, guion y denominació.

    Returns:
        El HTML del enlace.
    """
    return f'<a href="?idFicha={uuid}" class="tree-node-label"><strong>{texto}</strong></a>'


class PruebaCatalogo(unittest.TestCase):
    """Fichas del árbol, un código con varias fichas y el contraste de nombres."""

    def test_fichas_del_catalogo(self) -> None:
        """Lee código, identificador y nombre; las entidades HTML se deshacen y lo que no es ficha no cuenta."""
        pagina = nodo(UUID_1, "1112.1 - Governador/a de banc central") + nodo(UUID_2, "2512.1.3 - Analista d&#39;IA")
        fichas = barcelonactiva.fichas_del_catalogo(pagina)
        self.assertEqual([ficha["codigo"] for ficha in fichas], ["1112.1", "2512.1.3"])
        self.assertEqual(fichas[1], {"codigo": "2512.1.3", "id": UUID_2, "nombre": "Analista d'IA"})

    def test_lo_que_no_es_ficha_no_cuenta(self) -> None:
        """Cada guarda por separado: un identificador que no es UUID, y un enlace sin código delante del texto."""
        sin_uuid = nodo("x", "1112.1 - Governador/a")
        sin_codigo = nodo(UUID_1, "Grup 1")
        self.assertEqual(barcelonactiva.fichas_del_catalogo(sin_uuid), [])
        self.assertEqual(barcelonactiva.fichas_del_catalogo(sin_codigo), [])

    def test_un_codigo_con_varias_fichas_no_se_enlaza(self) -> None:
        """Solo el código exacto con una sola ficha tiene enlace: el ambiguo se cuenta y se queda sin él."""
        fichas = [
            {"codigo": "1112.1", "id": UUID_1, "nombre": "A"},
            {"codigo": "1112.2", "id": UUID_1, "nombre": "B"},
            {"codigo": "1112.2", "id": UUID_2, "nombre": "C"},
        ]
        self.assertEqual(barcelonactiva.enlaces(fichas), ({"1112.1": UUID_1}, ["1112.2"]))

    def test_coinciden(self) -> None:
        """La forma base sin «/a» o una de las formas de Faro bastan; una palabra distinta, no."""
        self.assertTrue(barcelonactiva.coinciden("Soldador/a", "soldador/soldadora"))
        self.assertTrue(barcelonactiva.coinciden("Cònsol/a", "cònsol"))
        self.assertTrue(barcelonactiva.coinciden("Tècnic/a d’IA", "tècnic d'IA/tècnica d'IA"))
        self.assertFalse(barcelonactiva.coinciden("Director/a general", "primer executiu/primera executiva"))
        self.assertFalse(barcelonactiva.coinciden("Governador/a de banc central", "governador del Banc Central"))

    def test_contraste(self) -> None:
        """Lista los códigos distintos con los dos nombres, el de Faro y el de Barcelona Activa."""
        fichas = [
            {"codigo": "1", "id": UUID_1, "nombre": "Soldador/a"},
            {"codigo": "2", "id": UUID_2, "nombre": "Director/a general"},
        ]
        revision = barcelonactiva.contraste(fichas, {"1": "soldador/soldadora", "2": "primer executiu"})
        self.assertEqual((revision["comparados"], revision["coinciden"]), (2, 1))
        self.assertEqual(
            revision["distintos"],
            [{"codigo": "2", "faro": "primer executiu", "barcelona_activa": "Director/a general"}],
        )

    def test_contraste_compara_solo_los_codigos_que_faro_nombra(self) -> None:
        """Una ficha cuyo código Faro no nombra no entra ni en los comparados ni en los distintos."""
        fichas = [
            {"codigo": "1", "id": UUID_1, "nombre": "Soldador/a"},
            {"codigo": "9", "id": UUID_2, "nombre": "Sin equivalente"},
        ]
        revision = barcelonactiva.contraste(fichas, {"1": "soldador/soldadora"})
        self.assertEqual((revision["comparados"], revision["coinciden"], revision["distintos"]), (1, 1, []))


class PruebaCibernarium(unittest.TestCase):
    """Las formaciones: fechas, modalidad y lo que no se guarda."""

    @staticmethod
    def fila() -> dict[str, str]:
        """Una actividad como la publica el Cibernàrium, nueva en cada llamada.

        Returns:
            La actividad, con los campos que se guardan y los que no.
        """
        return {
            "activityId": "1596468",
            "title": "Creativitat  amb Notion",
            "beginDateTime": "Thu Oct 08 10:00:00 CEST 2026",
            "endDateTime": "Thu Nov 05 12:00:00 CET 2026",
            "formationType": "PRESENCIAL",
            "description": "No se guarda.",
            "registrationDesc": "Places disponibles: 11.",
        }

    def test_actividad(self) -> None:
        """Solo título, días, modalidad e identificador: ni descripción ni plazas."""
        self.assertEqual(
            barcelonactiva.actividad(self.fila()),
            {
                "id": "1596468",
                "titulo": "Creativitat amb Notion",
                "inicio": "2026-10-08",
                "fin": "2026-11-05",
                "modalidad": "presencial",
            },
        )

    def test_modalidad_o_fecha_inesperadas(self) -> None:
        """Una modalidad que no se conoce detiene la lectura."""
        with self.assertRaises(FormatoInesperado):
            barcelonactiva.actividad({**self.fila(), "formationType": "HIBRIDA"})

    def test_fecha_con_otra_forma(self) -> None:
        """Una fecha que no tiene las seis partes del Cibernàrium detiene la lectura."""
        with self.assertRaises(FormatoInesperado):
            barcelonactiva.fecha("2026-10-08")


class PruebaEntradasDefectuosas(unittest.TestCase):
    """El borde JSON rechaza entradas defectuosas con un motivo de fuente."""

    def test_identificador_solo_admite_digitos_ascii(self) -> None:
        """El consumidor concatena el identificador: no pueden llegar parámetros, rutas ni números no enteros."""
        for identificador in ("1&otro=2", "../1", "", "١٢", True, 1.5, None):
            with self.subTest(identificador=identificador), self.assertRaisesRegex(FormatoInesperado, "activityId"):
                barcelonactiva.actividad({**PruebaCibernarium.fila(), "activityId": identificador})

    def test_campos_ausentes_o_de_otro_tipo_tienen_motivo(self) -> None:
        """Cada campo consumido se comprueba antes de indexarlo, convertirlo o tratarlo como texto."""
        for campo in ("activityId", "title", "beginDateTime", "endDateTime", "formationType"):
            for caso in ("ausente", "tipo"):
                fila = PruebaCibernarium.fila()
                if caso == "ausente":
                    del fila[campo]
                else:
                    fila[campo] = []
                with self.subTest(campo=campo, caso=caso), self.assertRaises(FormatoInesperado):
                    barcelonactiva.actividad(fila)
        with self.assertRaises(FormatoInesperado):
            barcelonactiva.actividad([])

    def test_fecha_imposible_tiene_motivo(self) -> None:
        """Un día inexistente se expresa como error de fuente, sin ValueError fuera de la interfaz."""
        with self.assertRaisesRegex(FormatoInesperado, "fecha.*Cibernàrium"):
            barcelonactiva.fecha("Thu Feb 30 10:00:00 CET 2026")

    def test_fecha_no_ignora_hora_ni_zona_defectuosas(self) -> None:
        """La forma de fecha de la captura no admite partes arbitrarias que el lector descartaría."""
        for valor in ("Thu Oct 08 99:00:00 CEST 2026", "Thu Oct 08 10:00:00 XXX 2026"):
            with self.subTest(valor=valor), self.assertRaises(FormatoInesperado):
                barcelonactiva.fecha(valor)

    def test_fechas_independientes_del_idioma_y_sin_conversion_de_dia(self) -> None:
        """Los meses ingleses y CET/CEST conservan la fecha civil con configuración C explícita."""
        anterior = locale.setlocale(locale.LC_TIME)
        self.addCleanup(locale.setlocale, locale.LC_TIME, anterior)
        locale.setlocale(locale.LC_TIME, "C")
        for valor, esperado in (
            ("Tue Dec 01 00:00:00 CET 2026", "2026-12-01"),
            ("Sun Mar 29 23:59:00 CEST 2026", "2026-03-29"),
        ):
            with self.subTest(valor=valor):
                self.assertEqual(barcelonactiva.fecha(valor), esperado)


if __name__ == "__main__":
    unittest.main()
