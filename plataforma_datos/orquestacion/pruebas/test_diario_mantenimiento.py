"""Persistencia del diario, repetición de lecturas verificables y aislamiento del ensayo."""

import argparse
import contextlib
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from plataforma_datos.orquestacion import archivo_diario
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import movimientos_de_cursos as movimientos
from plataforma_datos.orquestacion import simular_mantenimiento as simulador
from plataforma_datos.orquestacion.almacen_de_ensayo import AlmacenDeEnsayo
from plataforma_datos.orquestacion.almacen_generaciones import (
    AlmacenGeneracionesInvalido,
    AlmacenGeneracionesNoDisponible,
)
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3Ausente
from plataforma_datos.orquestacion.movimientos_de_cursos import comparar
from plataforma_datos.orquestacion.salud_mantenimiento import diagnostico
from plataforma_datos.orquestacion.simular_mantenimiento import PermisoLocal


class DiarioPruebas(unittest.TestCase):
    """Ejecuta el protocolo sobre disco y recupera los mismos bytes dos veces."""

    def setUp(self) -> None:
        """Crea un almacén y un receptor de ensayo privados."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.carpeta = Path(tmp.name)
        conexion = sqlite3.connect(self.carpeta / "control.sqlite")
        self.addCleanup(conexion.close)
        self.almacen = AlmacenDeEnsayo(self.carpeta / "objetos", conexion)
        self.ruta = self.carpeta / "diario.jsonl"

    def test_repetir_intencion_recupera_el_cierre_y_detecta_otra_accion(self) -> None:
        """Dos invocaciones del operador conservan una sola ejecución para esa identidad."""
        revision = "a" * 40
        sello = self.carpeta / "sello.json"
        sello.write_text(json.dumps({"revisionCodigo": revision, "sha256Manifiesto": "c" * 64}))
        (self.carpeta / ("generacion-" + revision)).mkdir()
        args = argparse.Namespace(
            sello=sello,
            area=self.carpeta / "ensayos",
            generacion=None,
            modo="simular",
            accion="comprobar-programada",
            variante="oficial",
            intencion="feed1234-dace-4bac-a010-0123456789ab",
        )
        with (
            patch.object(simulador, "_checkout_limpio"),
            patch.object(simulador, "_simular", return_value={"resultado": "sin-pendientes"}) as motor,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            primero = simulador.ensayar(args)
            self.assertEqual(simulador.ensayar(args), primero)
            args.accion = "actualizar-datos"
            with self.assertRaises(ValueError):
                simulador.ensayar(args)
        motor.assert_called_once()

    def test_lectura_recuperada_archivo_repetido_y_error_sin_secretos(self) -> None:
        """El error transitorio se clasifica, una incoherencia se detiene y el archivo es íntegro."""
        leer = Mock(side_effect=[AlmacenGeneracionesNoDisponible("secreto"), "confirmado"])
        corrupto = Mock(side_effect=AlmacenGeneracionesInvalido("secreto"))
        consola = io.StringIO()
        with (
            diario.abrir(self.ruta, {"run": "123"}),
            contextlib.redirect_stderr(consola),
            patch.object(diario.time, "sleep") as pausa,
        ):
            self.assertEqual(diario.leer_con_reintento("referencia", leer), "confirmado")
            with self.assertRaises(AlmacenGeneracionesInvalido):
                diario.leer_con_reintento("descargar-base", corrupto)
        pausa.assert_called_once_with(2)
        corrupto.assert_called_once()
        texto = self.ruta.read_text()
        self.assertEqual(
            consola.getvalue().splitlines(), [diario.linea_de_consola(json.loads(x)) for x in texto.splitlines()]
        )
        self.assertNotIn("secreto", texto)
        self.assertEqual(
            [json.loads(x)["estado"] for x in texto.splitlines()],
            ["inicio", "reintento", "confirmado", "inicio", "error"],
        )
        for _ in range(2):
            archivo_diario.archivar(self.ruta, self.almacen, archivo_diario.Ejecucion("123", "1", "ejecutar"))
            self.assertEqual(archivo_diario.leer(self.almacen, "123", "1", "ejecutar"), texto)
        with self.assertRaises(FileNotFoundError):
            archivo_diario.leer(self.almacen, "124", "1", "ejecutar")

    def test_un_objeto_ausente_no_se_reintenta_y_lleva_su_propia_causa(self) -> None:
        """Un 404 es una respuesta del almacén: ni la lectura ni la conservación lo repiten, y no es «no disponible»."""
        for fase, repetir in (
            ("descargar-base", diario.leer_con_reintento),
            ("conservar-recibo", diario.conservar_con_reintento),
        ):
            with self.subTest(fase=fase):
                ausente = Mock(side_effect=AlmacenS3Ausente("El objeto pedido no existe en el almacén privado."))
                ruta = self.carpeta / f"{fase}.jsonl"
                with (
                    diario.abrir(ruta, {"run": "123"}, consola=False),
                    patch.object(diario.time, "sleep") as pausa,
                    self.assertRaises(AlmacenS3Ausente),
                ):
                    repetir(fase, ausente)
                ausente.assert_called_once()
                pausa.assert_not_called()
                eventos = [json.loads(linea) for linea in ruta.read_text().splitlines()]
                self.assertEqual(
                    [(e["estado"], e.get("causa")) for e in eventos], [("inicio", None), ("error", "objeto-ausente")]
                )

    def test_agotamiento_se_detiene_e_intencion_local_solo_permite_un_motor(self) -> None:
        """Agotar las lecturas no concede un permiso ni convierte un acuse incierto en una segunda ejecución."""
        leer = Mock(side_effect=AlmacenGeneracionesNoDisponible("sin almacen"))
        with patch.object(diario.time, "sleep"), self.assertRaises(AlmacenGeneracionesNoDisponible):
            diario.leer_con_reintento("referencia", leer)
        self.assertEqual(leer.call_count, len(diario.PAUSAS) + 1)
        cliente = PermisoLocal(self.carpeta)
        self.assertEqual(cliente.confirmar_inicio("id", 1, "accion"), "aplicado")
        self.assertEqual(PermisoLocal(self.carpeta).confirmar_inicio("id", 1, "accion"), "repetido")
        self.assertEqual(cliente.enviar_resultado(b"uno"), "aplicado")
        self.assertEqual(cliente.enviar_resultado(b"uno"), "repetido")
        with self.assertRaises(ValueError):
            cliente.enviar_resultado(b"otro")

    def test_movimientos_y_diagnostico_de_recuperacion(self) -> None:
        """Distingue altas, retiradas, filtros modificados y acuse perdido bajo la misma identidad."""
        with diario.abrir(self.ruta, {"run": "123"}, consola=False):
            antes = ["a"] * 5
            despues = ["b", *antes[1:]]
            comparar(
                {"alta-anterior": antes, "cambia": antes, "igual": antes},
                {"nueva": antes, "cambia": despues, "igual": antes},
            )
            with self.assertRaises(OSError), diario.paso("supervisor"), diario.paso("confirmar-resultado"):
                Mock(side_effect=OSError("error privado"))()
        eventos = self.ruta.read_text().splitlines()
        resumen = diagnostico(eventos)
        self.assertEqual((resumen["fase"], resumen["accion"]), ("confirmar-resultado", "reenviar-recibo-conservado"))
        movimientos = [json.loads(s) for s in eventos if json.loads(s)["fase"] == "curso-candidato"]
        self.assertEqual([e["estado"] for e in movimientos], ["retirada", "modificacion", "alta"])
        self.assertEqual(movimientos[1]["campos"], ["tema"])
        self.assertEqual(movimientos[1]["nueva"]["tema"], "b")
        with self.assertRaises(ValueError):
            diagnostico(eventos + [eventos[-1].replace("123", "124")])

    def test_el_diario_identifica_el_calendario_pendiente_de_una_fuente_validada(self) -> None:
        """El resumen permite localizar la edición sin exponer el contenido de la ficha."""
        informe = self.carpeta / "var/actualizacion/validados/formacion/validacion.json"
        informe.parent.mkdir(parents=True)
        informe.write_text(json.dumps({"calendarios_soc_por_confirmar": ["1234"]}))
        intento = self.carpeta / "var/actualizacion/ejecuciones/intentos/abc/intento.json"
        intento.parent.mkdir(parents=True)
        intento.write_text(
            json.dumps(
                {
                    "id": "abc",
                    "fuente": "formacion",
                    "etapa": "validar",
                    "estado": "terminado",
                    "codigo": 0,
                    "inicio_utc": "2026-11-20T10:00:00Z",
                    "fin_utc": "2026-11-20T10:00:01Z",
                }
            )
        )
        with diario.abrir(self.ruta, {"run": "123"}, consola=False):
            diario.registrar_intentos(self.carpeta)
        lineas = self.ruta.read_text().splitlines()
        self.assertEqual(json.loads(lineas[-1])["curso"], "1234")
        self.assertEqual(diagnostico(lineas)["calendariosSocPorConfirmar"], 1)

    def test_la_primera_comprobacion_sin_cambios_conserva_los_filtros_de_partida(self) -> None:
        """La primera jornada con cambios puede comparar contra la semilla después de varios días vacíos."""
        base = {"sha256Manifiesto": "c" * 64}
        inicial = {"revisionReserva": 0, "ultimaValidada": base, "baseOperativa": base}
        siguiente = {**inicial, "revisionReserva": 3}
        filas = {"edicion/42": ["web", "inicial", "ca,es", "en-linea", "a" * 64]}
        with (
            diario.abrir(self.ruta, {"run": "123"}, consola=False),
            patch.object(movimientos, "inventario", return_value=filas) as proyectar,
        ):
            self.assertEqual(movimientos.anterior(self.almacen, inicial, self.carpeta, {}), filas)
            self.assertEqual(movimientos.anterior(self.almacen, siguiente, self.carpeta, {}), filas)
        proyectar.assert_called_once_with(self.carpeta, {})

    def test_proyeccion_anterior_sobrevive_a_un_ciclo_sin_pendientes(self) -> None:
        """La comparación del siguiente ciclo lee exactamente los filtros guardados por el anterior."""
        base = {"sha256Manifiesto": "c" * 64}
        referencia = {"revisionReserva": 3, "ultimaValidada": base, "baseOperativa": base}
        filas = {"edicion/42": ["web", "inicial", "ca,es", "en-linea", "a" * 64]}
        with diario.abrir(self.ruta, {"run": "123"}, consola=False):
            self.assertIsNone(movimientos.anterior(self.almacen, referencia, self.carpeta, {}))
            for _ in range(2):
                movimientos.guardar(self.almacen, base, filas)
            self.assertEqual(movimientos.anterior(self.almacen, referencia, self.carpeta, {}), filas)

    def test_rechazo_de_identidad_se_conserva_al_cerrar_las_fases_exteriores(self) -> None:
        """El diagnóstico distingue el rechazo de credenciales de una confirmación perdida."""
        with (
            self.assertRaises(ValueError),
            diario.abrir(self.ruta, {"run": "123"}, consola=False),
            diario.paso("supervisor"),
            diario.paso("cliente-privado"),
            diario.paso("autenticacion-lectura"),
        ):
            diario.anotar("respuesta-http", "rechazada", servicio="autoridad", http=401)
            Mock(side_effect=ValueError("denegada"))()
        resultado = diagnostico(self.ruta.read_text().splitlines())
        self.assertEqual(resultado["fase"], "autenticacion-lectura")
        self.assertEqual(resultado["accion"], "revisar-identidad-del-runner")
        self.assertEqual(resultado["http"], 401)
