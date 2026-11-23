"""Regresiones de controles de formación ante preparados defectuosos, sin originales ni red."""

import unittest
from typing import Any

import plataforma_datos.cursos.fuentes.formacion.controles as formacion
from plataforma_datos.comun.nucleo import Controles, ValidacionFallida


def curso(**cambios: object) -> dict[str, Any]:
    """Compone un curso preparado válido con los campos que comprueban los controles.

    Args:
        **cambios: Campos que sustituye el caso defectuoso.

    Returns:
        Un curso sintético sin datos de contacto.
    """
    return {
        "id": "curso",
        "inicio": "2026-10-15",
        "fin": "2026-10-16",
        "horas": "40",
        "destinatarios": None,
        "enlace": formacion.FICHA_CURSO + "curso",
        "especialidades": ["E1"],
        **cambios,
    }


class PruebaControlesFormacion(unittest.TestCase):
    """Los fallos de preparados se registran y permiten cerrar la validación con motivo."""

    def test_soc_sin_cursos_registra_cobertura_fallida(self) -> None:
        """Una oferta vacía falla su cobertura y conserva los controles posteriores de DigComp."""
        preparados = formacion.Preparados([], [], [], [], {"competencias": [], "resultados": []})
        controles = formacion.controles({}, preparados)
        self.assertIn("0 de 0 cursos con su especialidad identificada por el nombre", controles.fallidos)
        self.assertEqual(
            controles.lista[-1]["control"],
            "DigComp 3.0: cada resultado conserva su tipo de conocimiento, capacidad o actitud",
        )
        with self.assertRaisesRegex(ValidacionFallida, "0 de 0 cursos"):
            controles.exigir("formacion")

    def test_fechas_de_otro_tipo_no_interrumpen_los_controles(self) -> None:
        """Tras rechazar fechas no textuales se registran el orden y todos los campos posteriores."""
        for campo in ("inicio", "fin"):
            for valor in (1, True, ["2026-10-15"], {"dia": 15}):
                with self.subTest(campo=campo, valor=valor):
                    controles = Controles()
                    formacion._controles_cursos(controles, [curso(**{campo: valor})])
                    self.assertEqual(
                        [fila["resultado"] for fila in controles.lista],
                        ["ERROR", "ERROR", "correcto", "correcto", "correcto"],
                    )

    def test_digcomp_sin_identidad_no_enlaza_por_ausencia(self) -> None:
        """Una competencia sin id no justifica un resultado que tampoco conserva su competencia."""
        for competencia in ({"id": None}, {}):
            for resultado in ({"tipo": "Knowledge"}, {"competencia": None, "tipo": "Knowledge"}):
                with self.subTest(competencia=competencia, resultado=resultado):
                    marco = {
                        "competencias": [competencia] * formacion.MIN_COMPETENCIAS_DIGCOMP,
                        "resultados": [resultado] * formacion.MIN_RESULTADOS_DIGCOMP,
                    }
                    controles = Controles()
                    formacion._controles_digcomp(controles, marco)
                    self.assertEqual(
                        [fila["resultado"] for fila in controles.lista], ["correcto", "correcto", "ERROR", "correcto"]
                    )

    def test_horas_rechazan_digitos_unicode(self) -> None:
        """Una cifra ASCII inicial no permite colar dígitos de otro alfabeto en las horas."""
        for horas in ("4٣", "4３"):
            with self.subTest(horas=horas):
                controles = Controles()
                formacion._controles_cursos(controles, [curso(horas=horas)])
                self.assertEqual(controles.lista[2]["resultado"], "ERROR")

    def test_eures_rechaza_codigos_con_digitos_unicode(self) -> None:
        """Los códigos oficiales de cuatro u ocho cifras usan dígitos ASCII."""
        for codigo in ("٣١٤٣", "３１４３１０１２", "3143101٣"):
            with self.subTest(codigo=codigo):
                preparados = formacion.Preparados([{"esco": "esco", "cosispe": codigo}], [], [], [], {})
                controles = Controles()
                formacion._controles_eures_y_sepe(controles, {}, preparados)
                self.assertEqual(controles.lista[1]["resultado"], "ERROR")


if __name__ == "__main__":
    unittest.main()
