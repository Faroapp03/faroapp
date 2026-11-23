"""Pruebas de agencia.py: la lectura de las dos listas de la Agència FP.CAT y cuándo casa un certificado."""

import io
import unittest
from contextlib import redirect_stderr
from unittest import mock

import plataforma_datos.cursos.fuentes.agencia.lector as agencia
from plataforma_datos.comun.nucleo import FormatoInesperado


def certificado(codigo: str, nombre_ca: str, nivel: int, familia: str = "ADG") -> dict[str, object]:
    """Un certificado del catálogo con lo que mira el emparejamiento.

    Args:
        codigo: Código del certificado, con la forma real (cuatro letras y cuatro cifras).
        nombre_ca: Su nombre en catalán.
        nivel: Su nivel de cualificación (1 a 3).
        familia: Su familia profesional (solo la mira `no_disponibles`, no `casar`).

    Returns:
        El certificado como lo guarda el catálogo.
    """
    return {"codigo": codigo, "nombre_ca": nombre_ca, "nivel": nivel, "familia": familia}


class PruebaLectura(unittest.TestCase):
    """Filas partidas, cabeceras y números de página, el nivel ilegible y los códigos de la lista de no disponibles."""

    def test_filas_de_la_oferta(self) -> None:
        """Une los renglones partidos, salta cabecera y número de página y deja el nivel ilegible en None."""
        renglones = [
            "Data d'actualització: 12/09/2025",
            "FAMÍLIA PROFESSIONAL NOM AREA QUALIFICACIÓ PROFESSIONAL Nivell QP",
            "Sanitat Atenció sanitària Trasllat sanitari 2",
            "Electricitat i electrònica Instal·lacions elèctriques",
            "Gestió i supervisió del muntatge i manteniment de xarxes elèctriques de baixa tensió i enllumenat",
            "exterior",
            "3",
            "Administració i gestió Finances i assegurances Mediació d'assegurances ó",
            "1",
            "Data d'actualització: 12/09/2025",
            "Agrària Jardineria Activitats auxiliars en floristeria 1",
            "2",
        ]
        filas = agencia.filas_de_la_oferta(renglones)
        self.assertEqual([fila["nivel"] for fila in filas], [2, 3, None, 1])
        self.assertTrue(filas[1]["texto"].endswith("enllumenat exterior"))

    def test_cualificaciones_no_disponibles(self) -> None:
        """Normaliza el código, también con la errata «SA_2-628-3»."""
        lista = agencia.cualificaciones_no_disponibles(["SA_2-491_3 Tanatopràxia", "SA_2-628-3 Pròtesis dental", "x"])
        self.assertEqual([cualificacion["codigo"] for cualificacion in lista], ["SAN491_3", "SAN628_3"])
        self.assertEqual(lista[0], {"codigo": "SAN491_3", "nombre": "Tanatopràxia", "nivel": 3})


class PruebaOfertaIncompleta(unittest.TestCase):
    """Una fila cortada no puede desaparecer de una preparación aparentemente correcta."""

    def test_rechaza_fila_final_sin_nivel(self) -> None:
        """Da un motivo antes de guardar una oferta truncada aunque las filas completas ya sean suficientes."""
        renglones = ["Sanitat Atenció sanitària Trasllat sanitari 2", "Sanitat Atenció sanitària Fila cortada"]
        with self.assertRaisesRegex(FormatoInesperado, "agencia:.*sin nivel.*Fila cortada"):
            agencia.filas_de_la_oferta(renglones)

    def test_cli_incompleta_falla_antes_de_escribir(self) -> None:
        """Preparar devuelve un motivo legible y no escribe ninguna lista si la oferta queda cortada."""
        errores = io.StringIO()
        with (
            mock.patch.object(agencia, "_texto", return_value=["Sanitat Fila cortada"]),
            mock.patch.object(agencia, "original"),
            mock.patch.object(agencia, "guardar_jsonl") as guardar,
            redirect_stderr(errores),
        ):
            self.assertEqual(agencia.main(["preparar"]), 1)
        guardar.assert_not_called()
        self.assertEqual(errores.getvalue(), "Error: agencia: fila final sin nivel: Sanitat Fila cortada\n")


class PruebaCasar(unittest.TestCase):
    """Solo casa lo seguro: nombre al final de una sola fila, en límite de palabra, con su nivel y uno a uno."""

    @staticmethod
    def filas() -> list[dict[str, object]]:
        """Las filas de la oferta de la prueba, nuevas en cada llamada para que ninguna prueba altere a otra.

        Returns:
            Cuatro filas: una de sanidad, una de administración y dos de jardinería (dos nombres que acaban igual).
        """
        return [
            {"texto": "Sanitat Atenció sanitària Trasllat sanitari", "nivel": 2},
            {"texto": "Administració i gestió Administració i auditoria Gestió comptable i auditoria", "nivel": 2},
            {"texto": "Agrària Jardineria Activitats de floristeria", "nivel": 2},
            {"texto": "Agrària Jardineria Activitats auxiliars en floristeria", "nivel": 1},
        ]

    def test_casa_con_nombre_y_nivel(self) -> None:
        """Nombre al final de una sola fila y el mismo nivel: en la oferta."""
        seguros = agencia.casar([certificado("SANT0208", "Trasllat sanitari", 2)], self.filas())
        self.assertEqual(list(seguros), ["SANT0208"])

    def test_nivel_distinto_queda_sin_comprobar(self) -> None:
        """La oferta da «Gestió comptable i auditoria 2» y el certificado es de nivel 3: no se afirma nada."""
        self.assertEqual(agencia.casar([certificado("ADGD0108", "Gestió comptable i auditoria", 3)], self.filas()), {})

    def test_dos_filas_posibles_quedan_sin_comprobar(self) -> None:
        """«floristeria» acaba dos filas: dos candidatas, ninguna es segura."""
        self.assertEqual(agencia.casar([certificado("AGAJ0108", "floristeria", 2)], self.filas()), {})

    def test_nombre_sin_limite_de_palabra_queda_sin_comprobar(self) -> None:
        """«rasllat sanitari» acaba la fila pero no empieza en límite de palabra: no se afirma nada."""
        self.assertEqual(agencia.casar([certificado("SANT0209", "rasllat sanitari", 2)], self.filas()), {})

    def test_dos_certificados_en_una_fila_quedan_sin_comprobar(self) -> None:
        """Una fila con dos certificados: ninguno es seguro."""
        dos = [certificado("SANT0301", "Trasllat sanitari", 2), certificado("SANT0302", "Trasllat sanitari", 2)]
        self.assertEqual(agencia.casar(dos, self.filas()), {}, "una fila con dos certificados: ninguno es seguro")

    def test_no_disponibles_por_nombre_y_nivel_en_sanidad(self) -> None:
        """Solo dentro de la familia Sanidad, por nombre y nivel."""
        lista = [{"codigo": "SAN491_3", "nombre": "Tanatopràxia", "nivel": 3}]
        certificados = [
            certificado("SANP0108", "Tanatopràxia", 3, "SAN"),
            certificado("SANT0208", "Trasllat sanitari", 2, "SAN"),
            certificado("OTRO", "Tanatopràxia", 3, "ADG"),  # otra familia: no cuenta
        ]
        self.assertEqual(agencia.no_disponibles(certificados, lista), {"SANP0108": "SAN491_3"})


class PruebaClave(unittest.TestCase):
    """La normalización de nombres que dice su docstring."""

    def test_clave_junta_las_dos_formas_de_la_ele_geminada(self) -> None:
        """«l·l» y «l.l» dan «ll», y el apóstrofo curvo y el recto dan el mismo nombre."""
        self.assertEqual(agencia.clave("Col·lectiva"), agencia.clave("Col.lectiva"))
        self.assertEqual(agencia.clave("L’aigua"), agencia.clave("L'aigua"))
        self.assertEqual(agencia.FECHA_GUIA, "2024-08")


if __name__ == "__main__":
    unittest.main()
