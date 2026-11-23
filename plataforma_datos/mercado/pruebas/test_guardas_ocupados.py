"""Fronteras sintéticas de la pertenencia comarcal y la fecha publicada por ocupados."""

import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

import plataforma_datos.mercado.fuentes.ocupados.lector as ocupados
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import ERROR, Controles, FormatoInesperado, ValidacionFallida


def _totales() -> list[dict[str, Any]]:
    """Compone totales completos para aislar la pertenencia de cada municipio.

    Returns:
        Una fila por territorio y año, con cifras dentro del total comarcal.
    """
    return [
        {
            "territorio": territorio,
            "cno11": ocupados.TOTAL_OCUPACIONES,
            "anio": anio,
            "hombres": 0,
            "mujeres": 0,
            "total": 0,
        }
        for territorio in (*ocupados.COMARCAS_DE_LA_ZONA, *ocupados.MUNICIPIOS)
        for anio in ocupados.ANIOS
    ]


class PruebaGuardasOcupados(unittest.TestCase):
    """Entradas defectuosas dan un error de contrato o un control fallido."""

    def test_comarca_ausente_o_desconocida_no_se_admite(self) -> None:
        """Ningún municipio sin pertenencia conocida se excluye silenciosamente de las sumas."""
        comarca = next(iter(ocupados.COMARCAS_DE_LA_ZONA))
        conocidas = dict.fromkeys(ocupados.MUNICIPIOS, comarca)
        self.assertTrue(ocupados._municipios_dentro_de_su_comarca(_totales(), conocidas))
        for relacion in ({}, {**conocidas, ocupados.MUNICIPIOS[0]: "99"}, {**conocidas, ocupados.MUNICIPIOS[0]: None}):
            with self.subTest(relacion=relacion):
                self.assertFalse(ocupados._municipios_dentro_de_su_comarca(_totales(), relacion))

    def test_controles_territoriales_registran_comarca_ausente(self) -> None:
        """El consumidor registra ambas comprobaciones fallidas sin lanzar KeyError."""
        controles = Controles()
        ocupados._controles_territorios(controles, _totales(), {"comarca_de": {}})
        self.assertEqual([control["resultado"] for control in controles.lista][::2], [ERROR, ERROR])

    def test_validar_contexto_incompleto_falla_y_conserva_conjunto(self) -> None:
        """El flujo completo rechaza la pertenencia ausente con motivo y conserva el canónico previo."""
        contexto = {
            "actualizado_idescat": "2024-05-02",
            "fuente_idescat": "Idescat",
            "nombres": {codigo: codigo for codigo in (*ocupados.COMARCAS_DE_LA_ZONA, *ocupados.MUNICIPIOS)},
            "comarca_de": {},
        }
        with tempfile.TemporaryDirectory() as temporal:
            canonico = Path(temporal) / "ocupados.json"
            previo = b'{"anterior":true}'
            canonico.write_bytes(previo)
            for relacion in ({}, dict.fromkeys(ocupados.MUNICIPIOS, "99")):
                with (
                    self.subTest(relacion=relacion),
                    mock.patch.object(entrada_salida, "ruta_del_conjunto", return_value=canonico),
                    mock.patch.object(entrada_salida, "guardar_validacion"),
                    mock.patch.object(ocupados, "leer_validado", return_value={"cno11": {}}),
                    mock.patch.object(ocupados, "leer_jsonl", return_value=_totales()),
                    mock.patch.object(ocupados, "leer_json", return_value={**contexto, "comarca_de": relacion}),
                    mock.patch.object(ocupados, "controles_de_huella"),
                    mock.patch.object(ocupados, "_comprobar_cobertura"),
                    mock.patch.object(ocupados, "_controles_17980"),
                    mock.patch.object(ocupados, "_controles_tres_y_dos_cifras"),
                    mock.patch.object(ocupados, "_controles_contraste"),
                    mock.patch.object(ocupados, "_controles_ine"),
                    self.assertRaisesRegex(ValidacionFallida, "pertenencia comarcal.*080018"),
                ):
                    ocupados.validar()
                self.assertEqual(canonico.read_bytes(), previo)

    def test_fecha_exige_anio_mes_dia_separados_y_calendario_valido(self) -> None:
        """Las fechas compactas y de semana ISO se rechazan aunque fromisoformat las entienda."""
        contexto = {"fuente_idescat": "Idescat"}
        for fecha in ("20240502", "2024-W18-4", "2024-02-30", "2024-00-02", None):
            with self.subTest(fecha=fecha), self.assertRaisesRegex(FormatoInesperado, "fecha de actualización"):
                ocupados._fuentes({**contexto, "actualizado_idescat": fecha})
        self.assertIn(
            "actualizado el 29/02/2024.",
            ocupados._fuentes({**contexto, "actualizado_idescat": "2024-02-29"})["idescat"],
        )


if __name__ == "__main__":
    unittest.main()
