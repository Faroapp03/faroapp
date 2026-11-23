"""La proyección de derechos conserva citas y origen, y excluye evidencia que no utiliza el informe."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.derechos.fuentes.derechos.exportacion as derechos
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import Carpetas, Controles, FormatoInesperado, ValidacionFallida
from plataforma_datos.orquestacion import admision
from plataforma_datos.orquestacion.exportacion import comun


class PruebaExportacionDerechos(unittest.TestCase):
    """El contrato del paquete es selectivo y exige admisión real antes de leer el conjunto."""

    def test_solo_las_citas_del_validado_se_exportan_con_su_orden_y_origen(self) -> None:
        """Se conservan bytes de la proyección sangrada sin arrastrar recomendaciones ni cláusulas."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            carpetas = Carpetas(raiz / "original", raiz / "preparado", raiz / "validado")
            carpetas.validado.mkdir()
            citas = [{"id": "dos", "fragmentos": ["Àrbol", "Texto"]}, {"id": "uno", "fragmentos": ["Final"]}]
            tecnica = [{"id": "tecnica", "fragmentos": ["Cita"]}]
            conjunto = {
                "copia": "2026-10-07",
                "vigencias": {},
                "citas": citas,
                "tecnologia": {"citas": tecnica, "recomendaciones": {"puntos": ["Solo evidencia"]}},
                "clausulas_sectoriales": {"registros": ["No publicar"]},
            }
            origen = carpetas.validado / "derechos.json"
            origen.write_text(json.dumps(conjunto, ensure_ascii=False), encoding="utf-8")
            controles = Controles()
            controles.comprobar(json.loads(origen.read_bytes()) == conjunto, "JSON de la fixture de citas conservado")
            carpetas.validacion.write_text(
                json.dumps({"estado": controles.estado, "controles": controles.lista}), encoding="utf-8"
            )
            with (
                mock.patch.object(entrada_salida, "carpetas", return_value=carpetas),
                mock.patch.object(admision, "carpetas", return_value=carpetas),
            ):
                paquete = derechos.paquete_derechos()
            esperado = {"citas": citas, "tecnologia": {"citas": tecnica}}
            self.assertEqual(paquete.datos, esperado)
            self.assertEqual(paquete.origenes, [origen])
            destino = raiz / "paquete"
            comun.escribir("derechos.json", paquete, destino, formato="sangrado")
            self.assertEqual(
                (destino / "derechos.json").read_bytes(),
                (json.dumps(esperado, ensure_ascii=False, indent=2) + "\n").encode(),
            )

    def test_la_fuente_debe_estar_admitida_antes_de_leer_sus_citas(self) -> None:
        """La proyección no evita el control de admisión del lector común."""
        with (
            mock.patch.object(admision, "exigir_admitido", side_effect=ValidacionFallida("no admitida")),
            mock.patch.object(admision, "leer_json") as leer,
            self.assertRaises(ValidacionFallida),
        ):
            derechos.paquete_derechos()
        leer.assert_not_called()

    def test_un_conjunto_incompleto_no_se_convierte_en_un_paquete_vacio(self) -> None:
        """La ausencia o forma ajena de una lista conserva un motivo de fuente."""
        for conjunto in ([], {}, {"citas": [], "tecnologia": None}, {"citas": None, "tecnologia": {"citas": []}}):
            with (
                self.subTest(conjunto=conjunto),
                mock.patch.object(derechos, "leer_validado", return_value=conjunto),
                self.assertRaisesRegex(FormatoInesperado, "derechos"),
            ):
                derechos.paquete_derechos()


if __name__ == "__main__":
    unittest.main()
