"""Una fuente solo está admitida cuando constan controles realmente ejecutados."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import CON_ERRORES, Carpetas, Controles, ValidacionFallida
from plataforma_datos.orquestacion import admision
from plataforma_datos.orquestacion.exportacion.validados import paquete_validado


class AdmisionConControles(unittest.TestCase):
    """Ejercita el disco y las dos fronteras reales; las rutas pertenecen a la fixture."""

    def setUp(self) -> None:
        """Conjunto con orden y tipos conocidos; el informe se escribe por caso."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        raiz = Path(temporal.name)
        self.carpetas = Carpetas(raiz / "originales", raiz / "preparados", raiz / "validados")
        self.carpetas.validado.mkdir()
        self.conjunto = self.carpetas.validado / "oit.json"
        self.contenido = b'{"b":1,"a":0.0}'
        self.conjunto.write_bytes(self.contenido)
        for modulo in (entrada_salida, admision):
            parche = mock.patch.object(modulo, "carpetas", return_value=self.carpetas)
            parche.start()
            self.addCleanup(parche.stop)

    def informe(self, controles: object, estado: str = "Admitido") -> None:
        """Guarda el documento que lee exigir_admitido, sin sustituir su comprobación."""
        self.carpetas.validacion.write_text(json.dumps({"estado": estado, "controles": controles}), encoding="utf-8")

    def test_lectura_y_exportacion_rechazan_admision_vacia(self) -> None:
        """La mera etiqueta Admitido no acredita controles ni permite leer el conjunto."""
        self.informe([])
        for lector in (admision.leer_validado, paquete_validado):
            with self.subTest(lector=lector.__name__), self.assertRaisesRegex(ValidacionFallida, "sin controles"):
                lector("oit")
        self.assertEqual(self.conjunto.read_bytes(), self.contenido)

    def test_errores_y_formatos_anteriores_siguen_rechazados(self) -> None:
        """La corrección de vacío mantiene las guardas de resultado, forma y estado."""
        for controles, estado in (
            (None, "Admitido"),
            ({}, "Admitido"),
            ([{}], "Admitido"),
            ([{"control": 1, "resultado": "correcto"}], "Admitido"),
            ([{"control": "origen", "resultado": "ERROR"}], "Admitido"),
            ([{"control": "origen", "resultado": "correcto"}], "Con errores"),
        ):
            with self.subTest(controles=controles, estado=estado):
                self.informe(controles, estado)
                with self.assertRaises(ValidacionFallida):
                    paquete_validado("oit")

    def test_control_de_fixture_ejecutado_conserva_contenido_y_origen(self) -> None:
        """El control comprueba el archivo sintético; no pretende validar la fuente OIT."""
        controles = Controles()
        controles.comprobar(json.loads(self.conjunto.read_bytes()) == {"b": 1, "a": 0.0}, "contenido de fixture leído")
        self.informe(controles.lista)
        paquete = paquete_validado("oit")
        self.assertEqual(paquete.datos, {"b": 1, "a": 0.0})
        self.assertEqual(list(paquete.datos), ["b", "a"])
        self.assertEqual(paquete.origenes, [self.conjunto])
        self.assertEqual(self.conjunto.read_bytes(), self.contenido)

    def test_cierre_sin_controles_no_sustituye_la_ultima_buena(self) -> None:
        """Un productor sin controles falla antes de ejecutar su compositor de datos."""
        controles = Controles()
        informe = {"estado": controles.estado, "controles": controles.lista}
        componer = mock.Mock(return_value={"otro": True})
        with redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValidacionFallida, "sin controles"):
            admision.cerrar_validacion("oit", informe, controles, componer)
        componer.assert_not_called()
        self.assertEqual(self.conjunto.read_bytes(), self.contenido)
        self.assertEqual(json.loads(self.carpetas.validacion.read_bytes())["estado"], CON_ERRORES)

    def test_informe_divergente_no_sustituye_conjunto_ni_ultima_admision(self) -> None:
        """No se admite el resultado de otra lista ni una etiqueta incompatible con los controles ejecutados."""
        self.informe([{"control": "anterior", "resultado": "correcto"}])
        previo = self.carpetas.validacion.read_bytes()
        for cumple, lista, estado in (
            (True, [], "Admitido"),
            (True, [{"control": "otro", "resultado": "correcto"}], "Admitido"),
            (False, [{"control": "ejecutado", "resultado": "correcto"}], "Admitido"),
            (True, [{"control": "ejecutado", "resultado": "correcto"}], "Con errores"),
        ):
            with self.subTest(cumple=cumple, lista=lista, estado=estado):
                self.conjunto.write_bytes(self.contenido)
                self.carpetas.validacion.write_bytes(previo)
                controles = Controles()
                controles.comprobar(cumple, "ejecutado")
                informe = {"estado": estado, "controles": lista}
                componer = mock.Mock(return_value={"otro": True})
                with redirect_stdout(io.StringIO()), self.assertRaises(ValidacionFallida):
                    admision.cerrar_validacion("oit", informe, controles, componer)
                componer.assert_not_called()
                self.assertEqual(self.conjunto.read_bytes(), self.contenido)
                self.assertEqual(self.carpetas.validacion.read_bytes(), previo)

    def test_cambio_de_controles_al_componer_no_deja_etiqueta_admitida(self) -> None:
        """Si el compositor descubre un fallo, una etiqueta previa no se guarda como nueva admisión."""
        self.informe([{"control": "anterior", "resultado": "correcto"}])
        previo = self.carpetas.validacion.read_bytes()
        controles = Controles()
        controles.comprobar(True, "lectura de fixture")
        informe = {"estado": controles.estado, "controles": controles.lista}

        def componer() -> dict[str, bool]:
            controles.comprobar(False, "fallo durante composición")
            return {"otro": True}

        with redirect_stdout(io.StringIO()), self.assertRaises(ValidacionFallida):
            admision.cerrar_validacion("oit", informe, controles, componer)
        self.assertEqual(self.conjunto.read_bytes(), self.contenido)
        self.assertEqual(self.carpetas.validacion.read_bytes(), previo)

    def test_controles_vacios_no_estan_admitidos(self) -> None:
        """Ausencia no equivale a un resultado correcto; exigir conserva un error concreto."""
        controles = Controles()
        self.assertFalse(controles.admitido)
        self.assertEqual(controles.estado, CON_ERRORES)
        with self.assertRaisesRegex(ValidacionFallida, "sin controles"):
            controles.exigir("oit")


if __name__ == "__main__":
    unittest.main()
