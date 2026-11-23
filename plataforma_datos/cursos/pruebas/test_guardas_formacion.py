"""Regresiones de lecturas defectuosas en originales de formación."""

import re
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.fuentes.formacion.lector as formacion
import plataforma_datos.cursos.pruebas.test_formacion as test_formacion
from plataforma_datos.comun.nucleo import FormatoInesperado, HuellaIncorrecta
from plataforma_datos.cursos.fuentes.formacion.marco_digcomp import digcomp


class PruebaGuardasFormacion(unittest.TestCase):
    """Una fila incompleta o un identificador especial conserva un contrato explícito."""

    def test_eures_no_descarta_una_fila_truncada(self) -> None:
        """Una fila truncada falla con su número, incluso si no se reconoce la ocupación."""
        cabecera = ",".join(formacion.COLUMNAS_EURES)
        for fila in ["http://esco/1,12345678", "desconocida,12345678"]:
            with self.subTest(fila=fila), self.assertRaisesRegex(FormatoInesperado, "fila 2.*columnas"):
                test_formacion.PruebaLecturaDeLosOriginales()._eures(f"{cabecera}\n{fila}\n")

    def test_eures_conserva_las_lineas_vacias(self) -> None:
        """Las líneas vacías no son relaciones truncadas."""
        cabecera = ",".join(formacion.COLUMNAS_EURES)
        self.assertEqual(test_formacion.PruebaLecturaDeLosOriginales()._eures(f"{cabecera}\n\n"), [])

    def test_identificador_de_curso_es_un_solo_parametro(self) -> None:
        """Un identificador que altera la interpretación del enlace se rechaza, sin normalizarlo."""
        for caracter in "&?#%+\\\x00\n\x7f\x85":
            with self.subTest(caracter=repr(caracter)), self.assertRaisesRegex(FormatoInesperado, "identificador SOC"):
                formacion._curso({**test_formacion.CURSO_DEL_SOC, "identificador_curs": "25/curso" + caracter}, {})

    def test_codigo_sepe_es_un_solo_segmento(self) -> None:
        """Un código que altera el enlace se rechaza antes de normalizar la celda del XLSX."""
        for caracter in "/&?#%+\\\x00\n\x7f\x85":
            fila = dict.fromkeys(formacion.COLUMNAS_SEPE, "") | {"CÓDIGO": "CURSO" + caracter}
            with (
                self.subTest(caracter=repr(caracter)),
                mock.patch.object(formacion, "procedencia", return_value={"archivo": "sepe.xlsx"}),
                mock.patch.object(formacion, "original", return_value=Path("sepe.xlsx")),
                mock.patch.object(formacion, "leer_xlsx", return_value=[fila]),
                self.assertRaisesRegex(FormatoInesperado, "código SEPE"),
            ):
                formacion._sepe()

    def test_enlaces_actuales_conservan_espacios_parentesis_y_barras(self) -> None:
        """Las formas de los identificadores actuales conservan sus bytes en los enlaces."""
        fila = dict.fromkeys(formacion.COLUMNAS_SEPE, "") | {"CÓDIGO": "CTRD0018 (FCOI0018)"}
        with (
            mock.patch.object(formacion, "procedencia", return_value={"archivo": "sepe.xlsx"}),
            mock.patch.object(formacion, "original", return_value=Path("sepe.xlsx")),
            mock.patch.object(formacion, "leer_xlsx", return_value=[fila]),
        ):
            ficha = formacion._sepe()[0]["ficha"]
        self.assertEqual(
            ficha,
            "https://sede.sepe.gob.es/es/portaltrabaja/resources/pdf/especialidades/CTRD0018 (FCOI0018).pdf",
        )
        curso = formacion._curso(
            {**test_formacion.CURSO_DEL_SOC, "identificador_curs": "26/FPOIES_23_24 NOVA FP/816/0198643/001"}, {}
        )
        self.assertEqual(
            curso["enlace"],
            "https://serveiocupacio.gencat.cat/ca/persones/vull-formar-me/cercadors-formacio-especialitats/"
            "cercador-integrat/fitxa-curs.html?codi_curso_seleccionado="
            "26%2FFPOIES_23_24 NOVA FP%2F816%2F0198643%2F001",
        )

    def test_cosispe_del_sepe_solo_tiene_cifras_ascii(self) -> None:
        """Los códigos Unicode no se convierten en códigos oficiales de la CNO."""
        fila = dict.fromkeys(formacion.COLUMNAS_SEPE, "") | {
            "OCUPACIONES RELACIONADAS": "١٢٣٤ - Otro, 12345678 - Oficio"
        }
        with (
            mock.patch.object(formacion, "procedencia", return_value={"archivo": "sepe.xlsx"}),
            mock.patch.object(formacion, "original", return_value=Path("sepe.xlsx")),
            mock.patch.object(formacion, "leer_xlsx", return_value=[fila]),
        ):
            self.assertEqual(formacion._sepe()[0]["ocupaciones"], ["12345678"])

    def test_nombre_fechado_del_original_solo_acepta_ascii(self) -> None:
        """Una fecha Unicode no puede seleccionarse como copia válida de los cursos."""
        self.assertIsNone(re.fullmatch(formacion.PATRON_CURSOS, "soc-cursos-٢٠٢٦-09-27.json"))

    def test_digcomp_con_lista_de_tipos_jsonld(self) -> None:
        """Cada tipo JSON-LD se interpreta por separado, sin mezclar área y competencia."""
        marco = digcomp(
            [
                {"@type": ["CompetenceArea", "Competence"], "identifier": "1.1"},
                {"@type": ["Thing", "LearningOutcome"], "identifier": "LO1"},
            ]
        )
        self.assertEqual([competencia["id"] for competencia in marco["competencias"]], ["1.1"])
        self.assertEqual([resultado["id"] for resultado in marco["resultados"]], ["LO1"])

    def test_validar_no_admite_originales_alterados(self) -> None:
        """Validar vuelve a comprobar ambas procedencias antes de guardar una admisión."""
        for fuente in [formacion.FUENTE, formacion.SEPE]:
            with self.subTest(fuente=fuente):

                def comprobar(nombre: str, alterada: str = fuente) -> list[Path]:
                    """Simula una huella incorrecta en una de las dos procedencias.

                    Returns:
                        Las rutas vacías de la otra procedencia.

                    Raises:
                        HuellaIncorrecta: Si se comprueba la procedencia alterada.
                    """
                    if nombre == alterada:
                        raise HuellaIncorrecta("original alterado")
                    return []

                with (
                    mock.patch.object(formacion, "comprobar_originales", side_effect=comprobar, create=True),
                    mock.patch.object(formacion, "ocupaciones_esco", return_value={}),
                    mock.patch.object(formacion, "leer_jsonl", return_value=[]),
                    mock.patch.object(formacion, "leer_json", return_value={}),
                    mock.patch.object(formacion, "controles_de_la_cadena"),
                    mock.patch.object(formacion, "cobertura_de_la_cadena"),
                    mock.patch.object(formacion, "guardar_validacion") as guardar,
                    mock.patch.object(formacion, "_avisar_de_copia_antigua"),
                    self.assertRaisesRegex(HuellaIncorrecta, "original alterado"),
                ):
                    formacion.validar()
                guardar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
