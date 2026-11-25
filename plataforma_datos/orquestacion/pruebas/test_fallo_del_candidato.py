"""El error de un candidato rechazado sin estado, y la excepción que lo detuvo, constan en el diario y en su resumen.

Ciclo del 24/11/2026: el candidato salió «rechazado» con el estado vacío y nada decía si fue
`actualizacion_no_completada` o `candidato_no_verificable`, ni qué excepción saltó ni dónde. Aquí el candidato real se
detiene sin red, por una excepción y sin ella, y se leen el diario y el resumen que compone el supervisor.
"""

import json
import tempfile
import unittest
from json import JSONDecodeError
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar, candidato, resumen_diario
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import fallo_del_candidato as fallo
from plataforma_datos.orquestacion.estado_panel import EstadoPanelInvalido

IDENTIDAD = {"operacion": "ejecutar", "run": "45363604143", "intento": "1"}
PRIVADO = "/datos/privados de alguien 12345678"


class FalloDelCandidato(unittest.TestCase):
    """Un candidato vacío, sin red, que se detiene antes de empezar el ciclo."""

    def setUp(self) -> None:
        """Una carpeta propia del candidato y otra para el diario."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve() / "candidato"
        self.raiz.mkdir()
        self.ruta = Path(temporal.name).resolve() / "diario.jsonl"

    def candidato(self, **registro: object) -> dict:
        """Ejecuta el candidato real con la comprobación del registro sustituida.

        Returns:
            Su recibo.
        """
        with mock.patch.object(actualizar, "comprobar_registro", **registro):
            return candidato.ejecutar_candidato(self.raiz, "actualizar-datos")

    def supervisor(self, recibo: dict) -> tuple[list[dict], dict]:
        """Anota lo que anota el supervisor tras el motor y compone el resumen archivado.

        Returns:
            Los eventos del candidato en el diario y la retención del candidato en el resumen.
        """
        with diario.abrir(self.ruta, IDENTIDAD, consola=False):
            diario.registrar_intentos(self.raiz)
            diario.registrar_recibo(recibo)
        lineas = self.ruta.read_text(encoding="utf-8").splitlines()
        resumen = json.loads(resumen_diario.componer(lineas, *IDENTIDAD.values()))
        eventos = [json.loads(linea) for linea in lineas]
        return [e for e in eventos if e["fase"] == "candidato"], resumen["retenciones"]["candidato"]

    def test_una_excepcion_deja_su_clase_y_su_funcion_y_nunca_su_mensaje(self) -> None:
        """El candidato no verificable dice qué clase de excepción saltó y en qué función del motor."""
        recibo = self.candidato(side_effect=ValueError(PRIVADO))
        self.assertEqual((recibo["resultado"], recibo["estado"]), ("rechazado", None))
        self.assertEqual(recibo["error"], "candidato_no_verificable")
        eventos, retencion = self.supervisor(recibo)
        esperado = {"clase": "ValueError", "funcion": "actualizar.actualizar_con_resultado"}
        self.assertEqual(
            [(e["estado"], e.get("clase"), e.get("funcion")) for e in eventos][0], ("excepcion", *esperado.values())
        )
        self.assertEqual(eventos[-1]["error"], "candidato_no_verificable")
        self.assertEqual(retencion, {"error": "candidato_no_verificable", **esperado})
        for texto in ((self.raiz / fallo.ARCHIVO).read_text(encoding="utf-8"), self.ruta.read_text(encoding="utf-8")):
            self.assertNotIn("alguien", texto)
            self.assertNotIn("12345678", texto)

    def test_sin_excepcion_solo_consta_el_error_del_recibo(self) -> None:
        """Una actualización que no se completa no deja excepción: el resumen da solo su error."""
        recibo = self.candidato(return_value=["registro incoherente"])
        self.assertEqual(recibo["error"], "actualizacion_no_completada")
        self.assertFalse((self.raiz / fallo.ARCHIVO).exists())
        eventos, retencion = self.supervisor(recibo)
        self.assertEqual([e["estado"] for e in eventos], ["resultado"])
        self.assertEqual(retencion, {"error": "actualizacion_no_completada", "clase": None, "funcion": None})

    def test_un_archivo_fuera_de_su_forma_se_anota_como_problema(self) -> None:
        """Una función que no es un nombre del motor no llega al diario: se anota que el archivo es ilegible."""
        (self.raiz / fallo.ARCHIVO).parent.mkdir(parents=True)
        (self.raiz / fallo.ARCHIVO).write_text(json.dumps({"clase": "ValueError", "funcion": PRIVADO}))
        with self.assertRaises(ValueError):
            fallo.leer(self.raiz)
        with diario.abrir(self.ruta, IDENTIDAD, consola=False):
            diario.registrar_intentos(self.raiz)
        evento = json.loads(self.ruta.read_text(encoding="utf-8").splitlines()[-1])
        self.assertEqual(
            (evento["fase"], evento["estado"], evento["motivo"]), ("candidato", "problema", "fallo-ilegible")
        )
        self.assertNotIn("alguien", self.ruta.read_text(encoding="utf-8"))


class ClaseYFuncion(unittest.TestCase):
    """Las dos listas cerradas con que se nombra una excepción."""

    def test_la_clase_es_la_mas_concreta_de_la_lista_en_su_jerarquia(self) -> None:
        """Una clase propia se nombra por su base de la lista; una ajena del todo, como «otra»."""

        class Rara(KeyError):
            pass

        casos = (
            (EstadoPanelInvalido("x"), "EstadoPanelInvalido"),
            (JSONDecodeError("x", "{", 0), "JSONDecodeError"),
            (Rara(), "KeyError"),
            (RuntimeError(), "otra"),
        )
        for error, nombre in casos:
            with self.subTest(nombre=nombre):
                self.assertEqual(fallo.clase(error), nombre)

    def test_la_funcion_es_la_que_comprobaba_y_no_su_ayudante(self) -> None:
        """Si salta en `_exigir`, la función es la del motor que lo llamó; fuera del motor, «otra»."""
        sin_informe = actualizar.ResultadoActualizacion(1, None, None, {})
        # Se captura a mano: assertRaises guarda la excepción sin su traza.
        try:
            candidato._informe(Path(), sin_informe)
        except EstadoPanelInvalido as error:
            self.assertEqual(fallo.funcion(error), "candidato.informe")
        else:
            self.fail("_informe aceptó un intento sin informe")
        self.assertEqual(fallo.funcion(ValueError()), "otra")


if __name__ == "__main__":
    unittest.main()
