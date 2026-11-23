"""Un paso que falla deja en el diario su causa y su detalle saneado: ningún fallo del ciclo queda a ciegas."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.almacen_generaciones import AlmacenGeneracionesInvalido
from plataforma_datos.orquestacion.detalle_del_error import mensaje_saneado
from plataforma_datos.orquestacion.formas_del_diario import MAX_MENSAJE, es_detalle_de_error, tipo_de_error
from plataforma_datos.orquestacion.procesos import ejecutar_con_plazo

DETALLE = ("tipo", "origen", "pasoDeOrigen", "lugares", "mensaje", "plazoSegundos")
PRIVADO = (
    "Al leer /home/runner/work/_temp/privado/recibo.json con clave=abc y 'Nombre Apellido' para ana@ejemplo.org, "
    "documento 12345678Z y credencial ghp0abcdefghijklmnopqrstuvwxyz1234"
)


class ErrorDeCatálogo(KeyError):
    """Una excepción cuyo nombre no cabe en la forma cerrada del diario."""


class ErroresEnElDiario(unittest.TestCase):
    """Cada línea de error lleva causa, tipo, paso de origen y lugares; el mensaje, solo si nadie lo esperaba."""

    def setUp(self) -> None:
        """Abre un diario privado en una carpeta propia."""
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.raiz = Path(carpeta.name)
        self.ruta = self.raiz / "diario.jsonl"

    def _errores(self) -> list[dict]:
        lineas = [json.loads(linea) for linea in self.ruta.read_text().splitlines()]
        errores = [linea for linea in lineas if linea["estado"] == "error"]
        for linea in errores:
            self.assertTrue(es_detalle_de_error({k: linea[k] for k in DETALLE if k in linea}), linea)
        return errores

    def test_un_proceso_que_se_pasa_de_su_plazo_queda_anotado_como_plazo_agotado(self) -> None:
        """Un proceso real detenido por su plazo: los dos pasos lo dicen, con el más interno como origen y sin rutas."""
        dormir = [sys.executable, "-c", "import time; time.sleep(30)"]
        with (
            self.assertRaises(subprocess.TimeoutExpired),
            diario.abrir(self.ruta, {"run": "1"}, consola=False),
            diario.paso("supervisor"),
            diario.paso("motor"),
        ):
            ejecutar_con_plazo(dormir, self.raiz, 1, {"PATH": os.environ.get("PATH", "")})
        errores = self._errores()
        self.assertEqual(
            [(x["fase"], x["causa"], x["tipo"], x["pasoDeOrigen"], x["plazoSegundos"]) for x in errores],
            [
                ("motor", "plazo-agotado", "TimeoutExpired", "motor", 1),
                ("supervisor", "plazo-agotado", "TimeoutExpired", "motor", 1),
            ],
        )
        self.assertTrue(errores[0]["lugares"][-1].startswith("plataforma_datos.orquestacion.procesos:"))
        self.assertNotIn("mensaje", errores[0])
        self.assertNotIn(sys.executable, self.ruta.read_text())

    def test_un_fallo_no_previsto_deja_su_tipo_su_lugar_y_su_mensaje_saneado(self) -> None:
        """La causa por omisión lleva el texto de la excepción, sin rutas, claves, citas, correos ni cifras largas."""
        with (
            self.assertRaises(ValueError),
            diario.abrir(self.ruta, {"run": "1"}, consola=False),
            diario.paso("motor"),
        ):
            Mock(side_effect=ValueError(PRIVADO))()
        (error,) = self._errores()
        self.assertEqual(
            (error["causa"], error["tipo"], error["pasoDeOrigen"]), ("comprobacion-fallida", "ValueError", "motor")
        )
        self.assertEqual([lugar.rsplit(":", 1)[0] for lugar in error["lugares"]], [__name__])
        self.assertEqual(error["mensaje"], "Al leer … con … y … para … documento … y credencial …")
        for privado in ("/home", "clave", "Apellido", "ejemplo", "12345678", "ghp0"):
            self.assertNotIn(privado, self.ruta.read_text())

    def test_un_fallo_esperado_tiene_su_causa_y_no_copia_su_mensaje(self) -> None:
        """Un fallo con causa propia puede llevar datos del almacén en su texto: el diario no lo copia."""
        with (
            self.assertRaises(AlmacenGeneracionesInvalido),
            diario.abrir(self.ruta, {"run": "1"}, consola=False),
            diario.paso("descargar-base"),
        ):
            Mock(side_effect=AlmacenGeneracionesInvalido("secreto"))()
        (error,) = self._errores()
        self.assertEqual((error["causa"], error["tipo"]), ("integridad-generacion", "AlmacenGeneracionesInvalido"))
        self.assertNotIn("secreto", self.ruta.read_text())


class FormaCerradaDelDetalle(unittest.TestCase):
    """La forma del detalle admite solo sus campos, con su forma; el saneado siempre cabe en ella."""

    def test_un_mensaje_largo_se_acota(self) -> None:
        """Un texto enorme queda en `MAX_MENSAJE` caracteres y sigue en la forma."""
        mensaje = mensaje_saneado(ValueError("palabra " * 500))
        self.assertEqual(len(mensaje or ""), MAX_MENSAJE)
        self.assertTrue(
            es_detalle_de_error({"tipo": "ValueError", "pasoDeOrigen": "motor", "lugares": [], "mensaje": mensaje})
        )

    def test_un_mensaje_sin_nada_publicable_no_se_anota(self) -> None:
        """Un texto que solo tenía datos citados se queda en nada, y nada se anota."""
        self.assertIsNone(mensaje_saneado(KeyError("Nombre Apellido")))
        self.assertIsNone(mensaje_saneado(ValueError("")))

    def test_rechaza_campos_ajenos_rutas_y_tipos_fuera_de_forma(self) -> None:
        """Una ruta, una comilla, un campo de más o uno que falta dejan el detalle fuera de su forma."""
        bueno = {
            "tipo": "ValueError",
            "pasoDeOrigen": "motor",
            "lugares": ["plataforma_datos.orquestacion.candidato:12"],
        }
        self.assertTrue(es_detalle_de_error(bueno))
        for malo in (
            {**bueno, "traza": "x"},
            {**bueno, "lugares": ["/home/runner/candidato.py:12"]},
            {**bueno, "mensaje": "abre '/home'"},
            {**bueno, "tipo": "ErrorDeCatálogo"},
            {"tipo": "ValueError", "lugares": []},
        ):
            self.assertFalse(es_detalle_de_error(malo), malo)

    def test_un_nombre_de_clase_fuera_de_forma_se_nombra_por_su_base(self) -> None:
        """Una clase con tilde se nombra por la más cercana de sus bases con la forma del diario."""
        self.assertEqual(tipo_de_error(ErrorDeCatálogo("x")), "KeyError")


if __name__ == "__main__":
    unittest.main()
