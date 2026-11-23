"""Regresiones ante filas incompletas de la oferta Consorci."""

import io
import unittest
from contextlib import redirect_stderr
from unittest import mock

import plataforma_datos.cursos.fuentes.consorci.constantes as constantes_consorci
import plataforma_datos.cursos.fuentes.consorci.lector as consorci
from plataforma_datos.comun.nucleo import FormatoInesperado


class PruebaInicioAusente(unittest.TestCase):
    """Una fila incompleta falla con contexto y conserva los preparados previos."""

    def test_campo_ausente_no_se_cuenta_como_programada(self) -> None:
        """La fila sin inicio se rechaza con conjunto, posición y campo, sin inventar una fecha."""
        cursos = [
            {"codicurs": "X", "data_inici_oferta_curs_centre": constantes_consorci.EN_PROGRAMACION},
            {"codicurs": "Y"},
        ]
        with self.assertRaisesRegex(FormatoInesperado, r"jdcj-za6r: fila 2 sin data_inici_oferta_curs_centre"):
            consorci.programadas_sin_fecha(cursos)

    def test_preparar_da_motivo_sin_sustituir_preparados(self) -> None:
        """La orden explica la ausencia y no escribe ninguno de los cuatro preparados."""
        cursos = [{"codicurs": "X", "nom_del_curs": "Curso de prueba"}]
        filas = {conjunto.identificador: [] for conjunto in constantes_consorci.CONJUNTOS}
        filas[constantes_consorci.CURSOS.identificador] = cursos
        copia = consorci.Copia("2026-10-11", filas, {})
        errores = io.StringIO()
        with (
            mock.patch.object(consorci, "leer_copia", return_value=copia),
            mock.patch.object(consorci, "guardar_json") as guardar_json,
            mock.patch.object(consorci, "guardar_jsonl") as guardar_jsonl,
            redirect_stderr(errores),
        ):
            resultado = consorci.main(["preparar"])
        self.assertEqual(resultado, 1)
        self.assertEqual(errores.getvalue(), "Error: jdcj-za6r: fila 1 sin data_inici_oferta_curs_centre\n")
        guardar_json.assert_not_called()
        guardar_jsonl.assert_not_called()


if __name__ == "__main__":
    unittest.main()
