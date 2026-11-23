"""Conservación de intentos técnicos reales, separada de admisión y publicación."""

import json
import os
import subprocess
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import observacion_remota as observacion
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import actualizar, comprobaciones_remotas, ejecucion_observada
from plataforma_datos.orquestacion.modulos import Modulo
from plataforma_datos.orquestacion.pruebas.test_comprobacion_programada import evidencia_soc
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import Seguimiento

AHORA = datetime(2026, 10, 17, 12, tzinfo=UTC)
DIARIO = "var/actualizacion/ejecuciones/intentos"


class PruebaDiarioDeIntentos(unittest.TestCase):
    """Cada nueva ejecución deja identidad propia; el diario no confirma datos remotos."""

    def setUp(self) -> None:
        """Toda escritura se hace sobre SQLite ausente y archivos sintéticos propios."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.ciclo = comprobaciones_remotas.iniciar_ciclo(self.raiz, AHORA, "manual")
        self.orden = actualizar.ordenes_de_la_fuente("formacion")[0]

    def registros(self) -> list[dict]:
        """Devuelve únicamente los intentos de esta prueba.

        Returns:
            Documentos técnicos, sin interpretar su existencia como comprobación.
        """
        return [json.loads(p.read_text()) for p in sorted((self.raiz / DIARIO).glob("*/intento.json"))]

    def test_hijo_no_cero_conserva_recibo_valido_sin_acreditar_exito(self) -> None:
        """Un recibo completado antes del fallo del hijo conserva sus propios instantes."""

        def ejecutar(orden: list[str], _area: Path, _plazo: int, entorno: dict) -> subprocess.CompletedProcess:
            with mock.patch.dict(os.environ, entorno, clear=True), observacion.contexto_descarga():
                observacion.observar("https://example.org/curso", "GET", None, "https://example.org/curso", b"curso")
            return subprocess.CompletedProcess(orden, 1, "fallo posterior al recibo", "")

        with mock.patch.object(actualizar, "ejecutar_con_plazo", ejecutar):
            resultado = actualizar.ejecutar_orden(self.orden.orden, self.raiz)
        self.assertEqual(resultado.codigo, 1)
        self.assertIsNotNone(resultado.evidencia)
        self.assertEqual(len(resultado.evidencia["peticiones"]), 1)

    def test_retry_conserva_los_dos_intentos_y_sus_recibos(self) -> None:
        """El resumen del paso puede quedar verde; la primera ejecución no desaparece."""
        recibos = []
        for numero in range(2):
            recibo = evidencia_soc()
            recibo["intento"] = f"captura-{numero}"
            recibos.append(recibo)
        ejecutor = mock.Mock(
            side_effect=[actualizar.Resultado(1, "", recibos[0]), actualizar.Resultado(0, "", recibos[1])]
        )
        seguimiento = Seguimiento(self.raiz, self.ciclo, ejecutor, lambda: AHORA)
        with mock.patch.object(actualizar.time, "sleep"):
            pasos = actualizar.ejecutar_pasos(self.raiz, seguimiento.ejecutar, [self.orden], actualizar.Opciones())
        filas = self.registros()
        self.assertEqual(len(filas), 2)
        self.assertEqual(sorted(f["codigo"] for f in filas), [0, 1])
        self.assertEqual({f["recibo"]["intento"] for f in filas}, {"captura-0", "captura-1"})
        self.assertEqual({f["ciclo"] for f in filas}, {self.ciclo})
        self.assertEqual({f["fuente"] for f in filas}, {"formacion"})
        self.assertEqual({f["etapa"] for f in filas}, {"descargar"})
        self.assertTrue(pasos[0].en_verde)
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz)["conjuntos"], {})

    def test_inicio_precede_ejecucion_y_excepcion_no_se_convierte_en_exito(self) -> None:
        """El inicio ya es durable cuando corre el hijo; una excepción conserva su causa sin el texto privado."""

        def ejecutar(_orden: list[str], _area: Path) -> actualizar.Resultado:
            pendiente = self.registros()[0]
            self.assertEqual(pendiente["estado"], "en-curso")
            self.assertIsNone(pendiente["fin_utc"])
            self.assertIsNone(pendiente["codigo"])
            raise RuntimeError("mensaje privado que no debe copiarse")

        seguimiento = Seguimiento(self.raiz, self.ciclo, ejecutar, lambda: AHORA)
        with self.assertRaisesRegex(RuntimeError, "mensaje privado"):
            seguimiento.ejecutar(self.orden.orden, self.raiz)
        fila = self.registros()[0]
        self.assertEqual(fila["estado"], "excepcion")
        self.assertEqual(fila["tipo_error"], "RuntimeError")
        self.assertIsNone(fila["codigo"])
        self.assertIsNone(fila["recibo"])
        self.assertNotIn("mensaje privado", json.dumps(fila))
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz)["conjuntos"], {})

    def test_fallo_del_diario_antes_de_ejecutar_impide_orden(self) -> None:
        """No se pierde silenciosamente la evidencia de un nuevo intento al fallar el almacenamiento."""
        ejecutar = mock.Mock()
        seguimiento = Seguimiento(self.raiz, self.ciclo, ejecutar, lambda: AHORA)
        with (
            mock.patch.object(ejecucion_observada, "escribir_atomico", side_effect=OSError("disco sintético")),
            self.assertRaisesRegex(OSError, "disco sintético"),
        ):
            seguimiento.ejecutar(self.orden.orden, self.raiz)
        ejecutar.assert_not_called()
        self.assertEqual(self.registros(), [])

    def test_fallo_al_registrar_excepcion_no_oculta_causa_original(self) -> None:
        """La excepción del ejecutor conserva prioridad y encadena la del diario."""
        ejecutar = mock.Mock(side_effect=RuntimeError("causa original"))
        escribir = ejecucion_observada.escribir_atomico
        llamadas = 0

        def guardar(ruta: Path, contenido: str) -> None:
            nonlocal llamadas
            llamadas += 1
            if llamadas > 1:
                raise OSError("fallo de cierre del diario")
            escribir(ruta, contenido)

        seguimiento = Seguimiento(self.raiz, self.ciclo, ejecutar, lambda: AHORA)
        with (
            mock.patch.object(ejecucion_observada, "escribir_atomico", guardar),
            self.assertRaisesRegex(RuntimeError, "causa original") as capturada,
        ):
            seguimiento.ejecutar(self.orden.orden, self.raiz)
        self.assertIsInstance(capturada.exception.__cause__, OSError)
        self.assertEqual(self.registros()[0]["estado"], "en-curso")
        self.assertIsNone(self.registros()[0]["fin_utc"])

    def test_fallo_con_recibo_no_renueva_comprobacion(self) -> None:
        """Conservar la recepción del fallo no transforma su resultado en disponibilidad ni admisión."""
        evidencia = evidencia_soc()
        seguimiento = Seguimiento(
            self.raiz, self.ciclo, mock.Mock(return_value=actualizar.Resultado(1, "", evidencia)), lambda: AHORA
        )
        seguimiento.ejecutar(self.orden.orden, self.raiz)
        seguimiento.terminar_modulo(Modulo("formacion", ("formacion",)), actualizar.ResultadoDelModulo("ámbar"))
        documento = comprobaciones_remotas.leer_registro(self.raiz)
        self.assertEqual(documento["conjuntos"], {})
        self.assertEqual(documento["fuentes"]["formacion"]["resultado"], "fallo")
        self.assertEqual(self.registros()[0]["recibo"], evidencia)
        self.assertEqual(self.registros()[0]["recibo"]["comienzo_utc"], AHORA.isoformat())

    def test_recibo_invalido_se_rechaza_y_no_se_conserva_como_validado(self) -> None:
        """Un cuerpo ajeno al contrato no entra en el diario ni acredita petición alguna."""
        evidencia = {**evidencia_soc(), "url_privada": "no debe persistirse"}
        seguimiento = Seguimiento(
            self.raiz, self.ciclo, mock.Mock(return_value=actualizar.Resultado(0, "", evidencia)), lambda: AHORA
        )
        with self.assertRaises(FormatoInesperado):
            seguimiento.ejecutar(self.orden.orden, self.raiz)
        fila = self.registros()[0]
        self.assertEqual(fila["estado"], "excepcion")
        self.assertIsNone(fila["recibo"])
        self.assertNotIn("url_privada", json.dumps(fila))

    def test_mismo_reloj_otro_intento_no_sobrescribe_historia(self) -> None:
        """Una nueva ejecución se conserva aunque no cambien ni reloj ni contenido remoto."""
        seguimiento = Seguimiento(
            self.raiz, self.ciclo, mock.Mock(return_value=actualizar.Resultado(1, "")), lambda: AHORA
        )
        with mock.patch.object(ejecucion_observada, "datetime") as fecha:
            fecha.now.return_value = AHORA
            for _numero in range(3):
                seguimiento.ejecutar(self.orden.orden, self.raiz)
        filas = self.registros()
        self.assertEqual(len(filas), 3)
        self.assertEqual(len({f["id"] for f in filas}), 3)
        self.assertTrue(all(f["inicio_utc"] == AHORA.isoformat() for f in filas))
        self.assertTrue(all(f["codigo"] == 1 and f["estado"] == "terminado" for f in filas))

    def test_cota_de_archivo_falla_visible_antes_del_envio(self) -> None:
        """El diario no se continúa sin persistencia ni crece con un registro individual ilimitado."""
        ejecutar = mock.Mock()
        seguimiento = Seguimiento(self.raiz, self.ciclo, ejecutar, lambda: AHORA)
        with mock.patch.object(ejecucion_observada, "MAX_INTENTO_BYTES", 1), self.assertRaises(FormatoInesperado):
            seguimiento.ejecutar(self.orden.orden, self.raiz)
        ejecutar.assert_not_called()
        self.assertEqual(self.registros(), [])

    def test_recibo_emitido_antes_de_timeout_se_conserva_sin_exito(self) -> None:
        """Un hijo puede completar la llamada de retorno observada y atascarse después; no se borra el recibo previo."""

        def ejecutar(orden: list[str], _area: Path, _plazo: int, entorno: dict) -> subprocess.CompletedProcess:
            with mock.patch.dict(os.environ, entorno, clear=True), observacion.contexto_descarga():
                observacion.observar("https://example.org/curso", "GET", None, "https://example.org/curso", b"curso")
            raise subprocess.TimeoutExpired(orden, 1)

        with mock.patch.object(actualizar, "ejecutar_con_plazo", ejecutar):
            resultado = actualizar.ejecutar_orden(self.orden.orden, self.raiz)
        self.assertEqual(resultado.codigo, actualizar.CODIGO_TIEMPO_AGOTADO)
        self.assertIsNotNone(resultado.evidencia)

    def test_fallo_transitorio_al_cerrar_conserva_codigo_y_recibo_observados(self) -> None:
        """El registro de la excepción no vuelve al inicio si ya se obtuvo el resultado real del hijo."""
        evidencia = evidencia_soc()
        ejecutar = mock.Mock(return_value=actualizar.Resultado(0, "", evidencia))
        escribir = ejecucion_observada.escribir_atomico
        llamadas = 0

        def guardar(ruta: Path, contenido: str) -> None:
            nonlocal llamadas
            llamadas += 1
            escritura_del_resultado = 2  # la primera reserva el inicio
            if llamadas == escritura_del_resultado:
                raise OSError("fallo transitorio de cierre")
            escribir(ruta, contenido)

        seguimiento = Seguimiento(self.raiz, self.ciclo, ejecutar, lambda: AHORA)
        with (
            mock.patch.object(ejecucion_observada, "escribir_atomico", guardar),
            self.assertRaisesRegex(OSError, "fallo transitorio"),
        ):
            seguimiento.ejecutar(self.orden.orden, self.raiz)
        fila = self.registros()[0]
        self.assertEqual(fila["estado"], "excepcion")
        self.assertEqual(fila["tipo_error"], "OSError")
        self.assertEqual(fila["codigo"], 0)
        self.assertEqual(fila["recibo"], evidencia)
        self.assertIsNotNone(fila["recibo_sha256"])
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz)["conjuntos"], {})
