"""El motor conoce su hora límite: no empieza lo que ya no cabe, para en orden y lo dice con su causa y su paso."""

import contextlib
import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar, candidato, medidas_del_ciclo
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import hora_limite_del_motor as hora
from plataforma_datos.orquestacion.modulos import MODULOS, PAQUETE
from plataforma_datos.orquestacion.pruebas.test_candidato import EjecutorCandidato, preparar

AHORA = 1_800_000_000.0


class HoraLimitePruebas(unittest.TestCase):
    """Lo que queda se compara con lo medido para el paquete, con su margen."""

    def setUp(self) -> None:
        """Una raíz vacía donde anotar la parada."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)

    def _queda(self, paso: str, segundos_que_quedan: float, **entorno: str) -> bool:
        limite = {hora.VARIABLE: str(int(AHORA + segundos_que_quedan))}
        with contextlib.redirect_stdout(io.StringIO()):
            return hora.queda_tiempo(self.raiz, paso, entorno=entorno or limite, reloj=lambda: AHORA)

    def test_sin_hora_limite_siempre_queda_tiempo(self) -> None:
        """Un ensayo o una ejecución en el Mac no tienen hora límite y no anotan nada."""
        self.assertTrue(hora.queda_tiempo(self.raiz, "formacion", entorno={}))
        self.assertIsNone(hora.leer_parada(self.raiz))

    def test_lo_necesario_es_el_paquete_medido_en_el_runner_lento_con_su_margen(self) -> None:
        """Con lo justo para el paquete en el runner lento y su margen empieza; con un segundo menos, no."""
        self.assertEqual(hora.NECESARIO_S, round(medidas_del_ciclo.PAQUETE_EN_EL_RUNNER_LENTO_S * hora.MARGEN))
        self.assertTrue(self._queda("formacion", hora.NECESARIO_S))
        self.assertFalse(self._queda("formacion", hora.NECESARIO_S - 1))

    def test_la_primera_parada_es_la_que_se_conserva(self) -> None:
        """El módulo que no empezó es la parada; el paquete, que tampoco empieza después, no la sustituye."""
        self.assertFalse(self._queda("formacion", 600))
        self.assertFalse(self._queda(PAQUETE, 590))
        self.assertEqual(
            hora.leer_parada(self.raiz),
            {"causa": "plazo-insuficiente", "paso": "formacion", "quedanSegundos": 600, "necesariosSegundos": 6584},
        )

    def test_una_hora_limite_o_una_parada_sin_su_forma_no_se_admiten(self) -> None:
        """La variable la escribe el supervisor con cifras; la parada, el motor con su forma cerrada."""
        with self.assertRaises(ValueError):
            hora.hora_limite({hora.VARIABLE: "mañana"})
        (self.raiz / hora.ARCHIVO).parent.mkdir(parents=True)
        (self.raiz / hora.ARCHIVO).write_text(json.dumps({"causa": "plazo-insuficiente", "paso": "/tmp"}))
        with self.assertRaises(ValueError):
            hora.leer_parada(self.raiz)


class CicloQueNoCabePruebas(unittest.TestCase):
    """Un ciclo sin tiempo para el paquete no descarga, no ejecuta el paquete y sale rechazado."""

    def setUp(self) -> None:
        """Un candidato como el de las pruebas del candidato, sin pausas reales."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve() / "candidato"
        preparar(self.raiz)
        for parche in (mock.patch.object(actualizar.time, "sleep"), mock.patch.dict(os.environ, {"FARO_AVISO": ""})):
            parche.start()
            self.addCleanup(parche.stop)

    def test_sin_tiempo_el_motor_para_en_orden_y_lo_dice(self) -> None:
        """El recibo sale rechazado, ninguna fuente descarga, el paquete queda en ámbar y la parada nombra su paso."""
        ejecutor = EjecutorCandidato()
        with mock.patch.dict(os.environ, {hora.VARIABLE: str(int(time.time()) + 60)}):
            recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", ejecutor)
        self.assertEqual((recibo["resultado"], recibo["error"]), ("rechazado", "actualizacion_no_admitida"))
        self.assertFalse([orden for orden in ejecutor.ordenes if "descargar" in orden])
        self.assertNotIn(list(actualizar.COMPROBAR_LOS_DATOS), ejecutor.ordenes)
        modulos = {modulo["id"]: modulo for modulo in recibo["estado"]["modulos"]}
        self.assertEqual(modulos[PAQUETE]["veredicto"], "ámbar")
        parada = hora.leer_parada(self.raiz)
        self.assertEqual(parada["causa"], "plazo-insuficiente")
        self.assertIn(parada["paso"], {modulo.id for modulo in MODULOS})

    def test_el_supervisor_copia_la_parada_a_su_diario_y_a_la_consola(self) -> None:
        """La parada llega al diario privado entera y a la consola con su fase, su causa y su paso."""
        with contextlib.redirect_stdout(io.StringIO()):
            hora.queda_tiempo(self.raiz, "formacion", entorno={hora.VARIABLE: str(int(time.time()))})
        ruta = self.raiz.parent / "diario.jsonl"
        consola = io.StringIO()
        with diario.abrir(ruta, {"run": "1"}), contextlib.redirect_stderr(consola):
            diario.registrar_intentos(self.raiz)
        (evento,) = [json.loads(linea) for linea in ruta.read_text().splitlines() if "parada-del-motor" in linea]
        self.assertEqual(
            (evento["estado"], evento["causa"], evento["paso"]), ("parado", "plazo-insuficiente", "formacion")
        )
        self.assertIn(
            '{"fase":"parada-del-motor","estado":"parado","causa":"plazo-insuficiente","paso":"formacion"}',
            consola.getvalue().splitlines(),
        )


if __name__ == "__main__":
    unittest.main()
