"""Los avisos OIT se conservan enteros; su ausencia no cuenta como coincidencia válida."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.oit.lector as oit
from plataforma_datos.comun.nucleo import CORRECTO, ERROR, Controles


class PruebaAvisosOit(unittest.TestCase):
    """Comprueba avisos y validación con documentos sintéticos, sin originales ni red."""

    def setUp(self) -> None:
        """Carpeta propia con política sintética que cumple las frases declaradas."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.original = Path(temporal.name)
        parche = mock.patch.object(oit, "ORIGINAL", self.original)
        parche.start()
        self.addCleanup(parche.stop)
        (self.original / oit.POLITICA).write_text(" ".join(oit.FRASES_POLITICA), encoding="utf-8")

    def test_avisos_enteros_y_extraccion_literal(self) -> None:
        """Ambos avisos incluyen el cierre y se extraen completos, sin modificar sus caracteres."""
        cierre = "The ILO disclaims all responsibility for its content and accuracy. Responsibility rests solely "
        for tipo, aviso in (("adaptation", oit.AVISO_ADAPTACION), ("translation", oit.AVISO_TRADUCCION)):
            with self.subTest(tipo=tipo):
                self.assertTrue(aviso.endswith(f"{cierre}with the author(s) of the {tipo}."))
                self.assertEqual(oit._aviso_del_documento(f"<p>{aviso}</p>", tipo), aviso)

    def test_aviso_cortado_no_se_extrae(self) -> None:
        """Un aviso sin sus dos últimas frases no se admite como literal completo."""
        for tipo, aviso in (("adaptation", oit.AVISO_ADAPTACION), ("translation", oit.AVISO_TRADUCCION)):
            with self.subTest(tipo=tipo):
                cortado = aviso.split(" The ILO disclaims")[0]
                self.assertEqual(oit._aviso_del_documento(f"<p>{cortado}</p>", tipo), "")

    def test_validacion_rechaza_aviso_ausente_o_cortado(self) -> None:
        """Dos extracciones vacías iguales nunca demuestran que el documento contiene sus avisos."""
        adaptacion = oit.AVISO_ADAPTACION
        traduccion = oit.AVISO_TRADUCCION
        variantes = (
            ("", ""),
            (adaptacion, ""),
            ("", traduccion),
            (adaptacion.split(" The ILO disclaims")[0], traduccion),
            (adaptacion, traduccion.split(" The ILO disclaims")[0]),
        )
        for a, t in variantes:
            with self.subTest(adaptacion=a, traduccion=t):
                documento = f"<p>{a}</p><p>{t}</p>"
                (self.original / oit.DOCUMENTO).write_text(documento, encoding="utf-8")
                procedencia = {
                    "aviso_adaptacion": oit._aviso_del_documento(documento, "adaptation"),
                    "aviso_traduccion": oit._aviso_del_documento(documento, "translation"),
                }
                controles = Controles()
                oit._comprobar_licencia(controles, procedencia)
                self.assertEqual([c["resultado"] for c in controles.lista], [CORRECTO, ERROR])

    def test_validacion_admite_ambos_avisos_completos(self) -> None:
        """Los dos avisos literales completos siguen pasando los mismos controles."""
        documento = f"<p>{oit.AVISO_ADAPTACION}</p><p>{oit.AVISO_TRADUCCION}</p>"
        (self.original / oit.DOCUMENTO).write_text(documento, encoding="utf-8")
        controles = Controles()
        oit._comprobar_licencia(
            controles, {"aviso_adaptacion": oit.AVISO_ADAPTACION, "aviso_traduccion": oit.AVISO_TRADUCCION}
        )
        self.assertEqual([c["resultado"] for c in controles.lista], [CORRECTO, CORRECTO])


if __name__ == "__main__":
    unittest.main()
