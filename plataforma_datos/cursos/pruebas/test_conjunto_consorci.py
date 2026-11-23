"""Los controles de ediciones informan fechas defectuosas sin interrumpir la validación."""

import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.fuentes.consorci.conjunto as conjunto_consorci
import plataforma_datos.cursos.fuentes.consorci.lector as consorci
import plataforma_datos.cursos.pruebas.test_consorci as test_consorci
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import CORRECTO, ERROR, Carpetas, Controles
from plataforma_datos.cursos.fuentes.consorci.constantes import CURSOS, OFERTA, Preparados
from plataforma_datos.cursos.pruebas.test_oferta_emparejada import version
from plataforma_datos.orquestacion import admision


class PruebaFechasDeEdiciones(unittest.TestCase):
    """Fechas imposibles o ausentes se rechazan y conservan el resto de los controles."""

    def test_fechas_ausentes_o_imposibles_no_interrumpen_los_controles(self) -> None:
        """El lector representa una fecha imposible como None; no se compara ese valor con la copia."""
        for campo in ("inicio", "fin"):
            for valor in (None, "2026-02-30"):
                with self.subTest(campo=campo, valor=valor):
                    edicion = {
                        "id": "una",
                        "inicio": "2026-10-10",
                        "fin": "2026-10-20",
                        "horas": "30",
                        "a_distancia": True,
                        **{campo: valor},
                    }
                    controles = Controles()
                    conjunto_consorci._controles_de_ediciones(controles, [edicion], "2026-10-11")
                    self.assertEqual(len(controles.lista), 6)
                    self.assertEqual(controles.lista[1]["resultado"], ERROR)
                    self.assertFalse(controles.admitido)

    def test_validar_informa_fechas_imposibles_y_conserva_admision_previa(self) -> None:
        """La orden real guarda el informe de error y conserva el conjunto y el historial previos."""
        for campo in ("data_inici", "data_final"):
            with self.subTest(campo=campo), tempfile.TemporaryDirectory() as temporal:
                carpetas = Carpetas(*(Path(temporal) / nombre for nombre in ("original", "preparado", "validado")))
                carpetas.validado.mkdir()
                conjunto = carpetas.validado / "consorci.json"
                historial = carpetas.validado / "versiones-de-jdcj-za6r.json"
                for ruta in (conjunto, historial):
                    ruta.write_bytes(b"previo\n")
                indice = consorci.indice_de_cursos([test_consorci.CURSO])
                edicion, _ = consorci.edicion({**test_consorci.ACCION, campo: "2026-02-30T00:00:00"}, indice)
                prevista, _ = consorci.prevista(test_consorci.PREVISTA, indice, {})
                resumen = test_consorci.PruebaControles().resumen(union={}, union_de_las_previstas={}, descartes={})
                oferta = version([("oferta", "2026-10-06")], "2026-10-05")
                resumen["conjuntos"][CURSOS.identificador].update(con_fecha_o_en_programacion=2, oferta=oferta)
                resumen["conjuntos"][OFERTA.identificador]["oferta"] = oferta
                preparados = Preparados([edicion], [prevista], {}, resumen)

                def guardar_en_el_temporal(
                    ruta: Path, contenido: dict[str, object], *, esperada: Path = carpetas.validacion
                ) -> None:
                    """Exige la ruta de esta fixture antes de escribir el informe real."""
                    self.assertEqual(ruta, esperada)
                    entrada_salida.guardar_validacion(ruta, contenido)

                with (
                    mock.patch.object(consorci, "leer_preparados", return_value=preparados),
                    mock.patch.object(consorci, "cobertura_de_preparados", return_value={}),
                    mock.patch.object(consorci, "VERSIONES_DE_LOS_CURSOS", historial),
                    mock.patch.object(conjunto_consorci, "procedencia", return_value={"archivos": []}),
                    mock.patch.object(entrada_salida, "carpetas", return_value=carpetas),
                    mock.patch.object(admision, "carpetas", return_value=carpetas),
                    mock.patch.object(admision, "guardar_validacion", side_effect=guardar_en_el_temporal),
                    redirect_stdout(io.StringIO()),
                    redirect_stderr(io.StringIO()) as errores,
                ):
                    codigo = consorci.main(["validar"])
                self.assertEqual(codigo, 1)
                self.assertIn("cada edición tiene inicio y fin reales", errores.getvalue())
                informe = entrada_salida.leer_json(carpetas.validacion)
                self.assertEqual(informe["estado"], "Con errores")
                self.assertTrue(any(c["resultado"] == ERROR for c in informe["controles"]))
                self.assertEqual(conjunto.read_bytes(), b"previo\n")
                self.assertEqual(historial.read_bytes(), b"previo\n")

    def test_fechas_validas_conservan_textos_y_resultados(self) -> None:
        """Las seis comprobaciones nominales conservan su orden y su mensaje literal."""
        controles = Controles()
        conjunto_consorci._controles_de_ediciones(
            controles,
            [{"id": "una", "inicio": "2026-10-10", "fin": "2026-10-20", "horas": "30", "a_distancia": True}],
            "2026-10-11",
        )
        self.assertEqual(
            controles.lista,
            [
                {"control": texto, "resultado": CORRECTO}
                for texto in (
                    "cada edición tiene un identificador propio",
                    "cada edición tiene inicio y fin reales, y no termina antes de empezar",
                    "ninguna edición terminó antes de la copia (2026-10-11)",
                    "ninguna de las 1 ediciones empezadas el día de la copia (2026-10-11) se da por abierta",
                    "las horas de cada edición son un número entero positivo",
                    "cada edición presencial es de un municipio de Cataluña, con su comarca",
                )
            ],
        )


if __name__ == "__main__":
    unittest.main()
