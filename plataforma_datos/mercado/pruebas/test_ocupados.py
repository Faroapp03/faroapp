"""Pruebas del censo anual de ocupados (ocupados.py): códigos, umbral de cifras publicables y contraste con la Cambra.

Las reglas y los controles se prueban con datos mínimos y dobles, sin originales ni preparados operativos.
"""

import unittest
from typing import Any
from unittest import mock

import plataforma_datos.mercado.fuentes.ocupados.lector as ocupados
from plataforma_datos.comun.lugares import COMARCAS_DE_LA_ZONA
from plataforma_datos.comun.nucleo import CORRECTO, ERROR, Controles, FormatoInesperado, ValidacionFallida
from plataforma_datos.mercado.fuentes.ocupados.piezas.constantes_ocupados import (
    CATALUNA_IDESCAT,
    TABLA_69959,
    TABLA_69979,
)
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import TOTAL_OCUPACIONES


def _fila(territorio: str, cno11: str, anio: str, total: int | None) -> dict[str, Any]:
    """Compone una fila con las tres cifras.

    Args:
        territorio: El código del territorio.
        cno11: El grupo.
        anio: El año.
        total: El total (hombres y mujeres, la mitad cada uno); None si no se publica.

    Returns:
        La fila.
    """
    mitad = None if total is None else total // 2
    return {"territorio": territorio, "cno11": cno11, "anio": anio, "hombres": mitad, "mujeres": mitad, "total": total}


class DatosQueFaltan(unittest.TestCase):
    """Un total o un subgrupo ausentes detienen la validación con su motivo."""

    def test_total_de_cataluna(self) -> None:
        """Sin el total del año, ValidacionFallida en lugar de StopIteration."""
        with self.assertRaisesRegex(ValidacionFallida, "no trae el total de Cataluña de 2022"):
            ocupados._descuadre_suma([_fila(CATALUNA_IDESCAT, "111", "2022", 10)], "2022", "total")

    def test_subgrupo_sin_cifra_a_dos(self) -> None:
        """Un subgrupo de la 17980 que no está en la 17977, ValidacionFallida en lugar de KeyError."""
        with self.assertRaisesRegex(ValidacionFallida, "sin cifra en la 17977"):
            ocupados._controles_tres_y_dos_cifras(Controles(), [_fila(CATALUNA_IDESCAT, "111", "2022", 10)], [])


class ControlesQueFallan(unittest.TestCase):
    """Sin cifras que comparar, el control se registra como fallido."""

    def test_censo_2021_con_un_grupo_que_falta(self) -> None:
        """El grupo 112 del censo no está en la 17980: falla el contraste, no hay KeyError."""
        controles = Controles()
        cno3 = [_fila(CATALUNA_IDESCAT, "111", "2021", 30), _fila(CATALUNA_IDESCAT, "111", "2022", 30)]
        cataluna = {"ocupados_cno3": {"111": {"ocupados": 30}, "112": {"ocupados": 9}}}
        cambra = {"ocupaciones_cno3": {"111": {"hombres": 15, "mujeres": 15}, "112": {"hombres": 1, "mujeres": 1}}}
        ocupados._controles_contraste(controles, cno3, cataluna, cambra)
        self.assertEqual([control["resultado"] for control in controles.lista], [ERROR, ERROR])

    def test_ine_sin_cifras_comunes(self) -> None:
        """Sin ninguna cifra común con el INE, el control falla en lugar de lanzar ValueError."""
        controles = Controles()
        ine = [{**_fila("09", "11", "2022", 30), "tabla": tabla} for tabla in (TABLA_69959, TABLA_69979)]
        ocupados._controles_ine(controles, [], ine)
        self.assertEqual([control["resultado"] for control in controles.lista], [ERROR, ERROR])

    def test_comarca_sin_total(self) -> None:
        """Sin el total de una comarca, los municipios no se pueden comparar con ella: no se cumple."""
        cno2 = [_fila(municipio, TOTAL_OCUPACIONES, "2022", 10) for municipio in ocupados.MUNICIPIOS]
        comarca_de = dict.fromkeys(ocupados.MUNICIPIOS, next(iter(COMARCAS_DE_LA_ZONA)))
        self.assertFalse(ocupados._municipios_dentro_de_su_comarca(cno2, comarca_de))

    def test_un_control_correcto_sigue_correcto(self) -> None:
        """El contraste que cuadra se cumple."""
        controles = Controles()
        cno3 = [_fila(CATALUNA_IDESCAT, "111", "2021", 30), _fila(CATALUNA_IDESCAT, "111", "2022", 30)]
        cataluna = {"ocupados_cno3": {"111": {"ocupados": 30}}}
        cambra = {"ocupaciones_cno3": {"111": {"hombres": 15, "mujeres": 15}}}
        ocupados._controles_contraste(controles, cno3, cataluna, cambra)
        self.assertEqual([control["resultado"] for control in controles.lista], [CORRECTO, CORRECTO])


class RespuestasConOtraForma(unittest.TestCase):
    """Las respuestas del Idescat se comprueban antes de leerlas."""

    def test_fecha_de_actualizacion(self) -> None:
        """AAAA-MM-DD pasa a DD/MM/AAAA; con hora u otro formato, FormatoInesperado."""
        contexto = {"actualizado_idescat": "2024-05-02", "fuente_idescat": "Idescat"}
        self.assertIn("actualizado el 02/05/2024.", ocupados._fuentes(contexto)["idescat"])
        for fecha in ("2024-05-02T10:00", "02/05/2024"):
            with self.subTest(fecha=fecha), self.assertRaises(FormatoInesperado):
                ocupados._fuentes({**contexto, "actualizado_idescat": fecha})

    def test_nomenclator(self) -> None:
        """Sin fitxes.v o con un municipio sin id, FormatoInesperado en lugar de KeyError."""
        for respuesta in ({}, {"fitxes": {"v": [{"id": "11"}]}}, {"fitxes": {"v": [{"id": "11", "v": [{}]}]}}):
            with (
                self.subTest(respuesta=respuesta),
                mock.patch.object(ocupados, "leer_json", return_value=respuesta),
                mock.patch.object(ocupados, "original"),
                self.assertRaises(FormatoInesperado),
            ):
                ocupados._comarcas_del_nomenclator()

    def test_tabla_sin_fecha(self) -> None:
        """Una tabla sin updated se rechaza con su motivo."""
        with (
            mock.patch.object(ocupados, "leer_json", return_value={"source": "Idescat"}),
            mock.patch.object(ocupados, "original"),
            self.assertRaisesRegex(FormatoInesperado, "sin fecha de actualización"),
        ):
            ocupados._contexto()


class PruebaCifrasOcupados(unittest.TestCase):
    """Códigos oficiales y frontera de publicación con filas sintéticas."""

    def test_codigos_del_idescat_e_ine(self) -> None:
        """El Idescat antepone la letra del grupo principal; el total y «no consta» tienen nombre propio."""
        self.assertEqual(ocupados._codigo_idescat("E430"), "430")
        self.assertEqual(ocupados._codigo_idescat("_U"), ocupados.CODIGO_NO_CONSTA)
        self.assertEqual(ocupados._codigo_ine("No consta"), ocupados.CODIGO_NO_CONSTA)
        self.assertEqual(ocupados._codigo_ine("Total"), ocupados.TOTAL_OCUPACIONES)

    def test_umbral_de_cifras_publicables(self) -> None:
        """Por debajo de 100 personas, o sin cifra publicada, no hay dato; desde 100, con su % de mujeres."""
        self.assertIsNone(ocupados.cifras_publicables({"total": 99, "mujeres": 50}))
        self.assertIsNone(ocupados.cifras_publicables({"total": None, "mujeres": None}))
        self.assertEqual(
            ocupados.cifras_publicables({"total": 100, "mujeres": 72}), {"ocupados": 100, "pct_mujeres": 72.0}
        )


if __name__ == "__main__":
    unittest.main()
