"""Entrada real de mantenimiento: identidad del runner y cierre de los clientes privados."""

import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from plataforma_datos.orquestacion import ejecutar_mantenimiento as cli
from plataforma_datos.orquestacion import ejecutor_operativo


class EjecutarMantenimientoTest(unittest.TestCase):
    """Prueba la composición de la CLI sin abrir servicios ni utilizar claves reales."""

    def setUp(self) -> None:
        """Crea rutas portables y un contexto de runner completamente sintético."""
        self.raiz = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="mantenimiento Año "))).resolve()
        self.checkout = self.raiz / "código"
        self.checkout.mkdir()
        self.enterContext(patch.object(cli, "RAIZ", self.checkout))
        self.trabajo = self.raiz / "ejecuciones"
        self.trabajo.mkdir()
        self.entorno = {
            "GITHUB_ACTIONS": "true",
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_WORKSPACE": str(self.checkout),
            "GITHUB_SHA": "a" * 40,
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1",
            "FARO_SOLICITUD_ID": "11111111-1111-4111-8111-111111111111",
            "FARO_REVISION_RESERVA": "2",
            "FARO_ACCION": "actualizar-datos",
            "FARO_CLOUDFLARE_VARIANTE": "oficial",
            "FARO_ACTUALIZACION_ORIGEN": "https://administracion.example",
            "ACTIONS_ID_TOKEN_REQUEST_URL": "https://oidc.example/token?api-version=2.0",
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "secreto-sintetico",
        }

    def test_correlacion_de_evento_se_conserva_sin_configuracion_implicita(self) -> None:
        """La configuración del núcleo conserva exactamente la identidad del despacho."""
        with patch.object(cli, "_checkout_limpio") as comprobar:
            config = cli.configuracion_ejecucion(self.checkout, self.trabajo, self.entorno)
        self.assertEqual(config.revision_codigo, self.entorno["GITHUB_SHA"])
        self.assertEqual(config.solicitud_id, self.entorno["FARO_SOLICITUD_ID"])
        self.assertEqual(config.revision_reserva, 2)
        self.assertEqual(config.run_id, "123")
        self.assertEqual(config.variante_cloudflare, "oficial")
        comprobar.assert_called_once_with(self.checkout, "a" * 40)

    def test_reanudacion_de_entradas_explicita_y_solo_para_actualizar_datos(self) -> None:
        """El workflow puede pedir reanudación; el supervisor conserva cerrados los demás modos."""
        with patch.object(cli, "_checkout_limpio"):
            self.assertFalse(cli.configuracion_ejecucion(self.checkout, self.trabajo, self.entorno).reanudar_entradas)
            opciones = self.entorno | {"FARO_REANUDAR_ENTRADAS": "si", "FARO_ACCION": "actualizar-datos"}
            self.assertTrue(cli.configuracion_ejecucion(self.checkout, self.trabajo, opciones).reanudar_entradas)
            for campo in (
                {"FARO_REANUDAR_ENTRADAS": "invalido"},
                {"FARO_ACCION": "comprobar-programada"},
                {"FARO_FUENTES_EN_PARALELO": "si"},
            ):
                with self.subTest(campo=campo), self.assertRaises(ValueError):
                    cli.configuracion_ejecucion(self.checkout, self.trabajo, opciones | campo)

    def test_la_raiz_del_ciclo_es_el_candidato_que_crea_el_ejecutor(self) -> None:
        """La instalación donde quedan las lecturas es la misma que el ejecutor prepara para el motor."""
        with patch.object(cli, "_checkout_limpio"):
            config = cli.configuracion_ejecucion(self.checkout, self.trabajo, self.entorno)
        directorio = ejecutor_operativo._directorio_job(config)
        self.assertEqual(cli.raiz_del_ciclo(config), directorio / "candidato")

    def test_diario_solo_autoriza_reenviar_el_recibo_si_se_perdio_su_acuse(self) -> None:
        """Un fallo anterior al recibo nunca autoriza un segundo arranque del motor."""
        for fase, codigo in (("confirmar-resultado", 0), ("restaurar-base", 1)):
            registro = self.trabajo / (fase + ".jsonl")

            def cortar(*_args: object, fase: str = fase) -> None:
                with cli.diario.paso(fase):
                    Mock(side_effect=cli.ErrorMantenimiento("respuesta perdida"))()

            with (
                self.subTest(fase=fase),
                patch.dict(os.environ, self.entorno, clear=True),
                patch.object(cli, "_checkout_limpio"),
                patch.object(cli, "configuracion_privada"),
                patch.object(cli, "AlmacenS3"),
                patch.object(cli, "ClienteMantenimientoGitHub"),
                patch.object(cli.archivo_diario, "archivar") as archivar,
                patch.object(cli, "_operar", side_effect=cortar) as operar,
                patch.object(cli, "ejecutar_trabajo", return_value={"resultado": "validado"}) as reanudar,
                contextlib.redirect_stdout(io.StringIO()),
                contextlib.redirect_stderr(io.StringIO()),
            ):
                self.assertEqual(
                    cli.main(["ejecutar", str(self.checkout), str(self.trabajo), "--registro", str(registro)]), codigo
                )
                operar.assert_called_once()
                # El diario se archiva con la instalación del ciclo, para que el resumen lleve su parte de salud.
                archivar.assert_called_once_with(
                    registro,
                    cli.AlmacenS3.return_value.__enter__.return_value,
                    cli.archivo_diario.Ejecucion("123", "1", "ejecutar"),
                    self.trabajo / "run-123-1" / "candidato",
                )
                if codigo == 0:
                    self.assertEqual(reanudar.call_args.kwargs, {"reanudar": True})
                else:
                    reanudar.assert_not_called()

    def test_eventos_identidades_y_revisiones_ajenos_se_rechazan_antes_de_red(self) -> None:
        """Un evento ajeno o una reserva mal formada no llega a los clientes privados."""
        casos = {
            "GITHUB_ACTIONS": ["false", ""],
            "GITHUB_EVENT_NAME": ["push", "pull_request", ""],
            "GITHUB_WORKSPACE": [str(self.raiz), ""],
            "GITHUB_SHA": ["main", "A" * 40],
            "GITHUB_RUN_ID": ["0", "01", ""],
            "GITHUB_RUN_ATTEMPT": ["2", ""],
            "FARO_SOLICITUD_ID": ["no-es-uuid"],
            "FARO_REVISION_RESERVA": ["0", "01", "9007199254740992", "1.0"],
            "FARO_ACCION": ["desplegar"],
            "FARO_CLOUDFLARE_VARIANTE": ["", "unificado", "Oficial"],
        }
        for clave, valores in casos.items():
            for valor in valores:
                with (
                    self.subTest(clave=clave, valor=valor),
                    patch.object(cli, "_checkout_limpio"),
                    self.assertRaises((OSError, ValueError)),
                ):
                    cli.configuracion_ejecucion(self.checkout, self.trabajo, {**self.entorno, clave: valor})

    def test_git_real_exige_revision_y_archivos_versionados_intactos(self) -> None:
        """El commit declarado no basta si los archivos que se ejecutarán han cambiado."""
        entorno = {
            "PATH": os.defpath,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_AUTHOR_NAME": "Equipo Faro",
            "GIT_AUTHOR_EMAIL": "equipo@example.test",
            "GIT_COMMITTER_NAME": "Equipo Faro",
            "GIT_COMMITTER_EMAIL": "equipo@example.test",
        }

        def git(*argumentos: str) -> str:
            return subprocess.run(
                ["git", "-C", str(self.checkout), *argumentos],
                env=entorno,
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            ).stdout.strip()

        git("init", "--quiet")
        archivo = self.checkout / "codigo.txt"
        archivo.write_text("versión autorizada\n")
        git("add", "codigo.txt")
        git("commit", "--quiet", "-m", "Caso sintético")
        revision = git("rev-parse", "HEAD")
        cli._checkout_limpio(self.checkout, revision)
        with self.assertRaises(ValueError):
            cli._checkout_limpio(self.checkout, "b" * 40)
        archivo.write_text("cambio no autorizado\n")
        with self.assertRaises(subprocess.CalledProcessError):
            cli._checkout_limpio(self.checkout, revision)

    def test_controlador_de_otra_copia_no_ejecuta_el_checkout(self) -> None:
        """Declarar un checkout válido no autoriza un supervisor cargado de otra instalación."""
        with patch.object(cli, "RAIZ", self.raiz), self.assertRaises(ValueError):
            cli.configuracion_ejecucion(self.checkout, self.trabajo, self.entorno)

    def test_cli_reanuda_por_identidad_y_cierra_clientes_sin_filtrar_secretos(self) -> None:
        """Reanudar selecciona la rama sin motor y publica solo el resumen permitido."""
        salida = io.StringIO()
        error = io.StringIO()
        resumen = {"version": 1, "estado": "repetido"}
        with (
            patch.dict(os.environ, self.entorno, clear=True),
            patch.object(cli, "_checkout_limpio"),
            patch.object(cli, "configuracion_privada", return_value=Mock()),
            patch.object(cli, "AlmacenS3") as almacen,
            patch.object(cli, "ClienteMantenimientoGitHub") as cliente,
            patch.object(cli, "ejecutar_trabajo", return_value=resumen) as ejecutar,
            contextlib.redirect_stdout(salida),
            contextlib.redirect_stderr(error),
        ):
            codigo = cli.main(["reanudar", str(self.checkout), str(self.trabajo)])
        self.assertEqual(codigo, 0)
        self.assertEqual(json.loads(salida.getvalue()), resumen)
        self.assertEqual(error.getvalue(), "")
        self.assertTrue(ejecutar.call_args.kwargs["reanudar"])
        cliente.return_value.__exit__.assert_called_once()
        almacen.return_value.__exit__.assert_called_once()

    def test_variante_no_declarada_se_explica_sin_abrir_conexiones(self) -> None:
        """Sin variante no hay valor por omisión: la orden lo dice y no crea clientes ni almacén."""
        entorno = {k: v for k, v in self.entorno.items() if k != "FARO_CLOUDFLARE_VARIANTE"}
        for variante in (None, "", "unificado"):
            salida, error = io.StringIO(), io.StringIO()
            with (
                self.subTest(variante=variante),
                patch.dict(
                    os.environ,
                    entorno if variante is None else entorno | {"FARO_CLOUDFLARE_VARIANTE": variante},
                    clear=True,
                ),
                patch.object(cli, "_checkout_limpio") as comprobar,
                patch.object(cli, "AlmacenS3") as almacen,
                patch.object(cli, "ClienteMantenimientoGitHub") as cliente,
                contextlib.redirect_stdout(salida),
                contextlib.redirect_stderr(error),
            ):
                codigo = cli.main(["ejecutar", str(self.checkout), str(self.trabajo)])
            self.assertEqual(codigo, 1)
            self.assertEqual(salida.getvalue(), "")
            self.assertEqual(error.getvalue(), cli.ERROR_VARIANTE + "\n")
            comprobar.assert_not_called()
            cliente.assert_not_called()
            almacen.assert_not_called()

    def test_error_ambiguo_no_se_reintenta_y_cierra_los_recursos(self) -> None:
        """El error permanece genérico incluso cuando su causa contiene un secreto."""
        salida = io.StringIO()
        error = io.StringIO()
        with (
            patch.dict(os.environ, self.entorno, clear=True),
            patch.object(cli, "_checkout_limpio"),
            patch.object(cli, "configuracion_privada", return_value=Mock()),
            patch.object(cli, "AlmacenS3") as almacen,
            patch.object(cli, "ClienteMantenimientoGitHub") as cliente,
            patch.object(cli, "ejecutar_trabajo", side_effect=ValueError("secreto-sintetico")) as ejecutar,
            contextlib.redirect_stdout(salida),
            contextlib.redirect_stderr(error),
        ):
            codigo = cli.main(["ejecutar", str(self.checkout), str(self.trabajo)])
        self.assertEqual(codigo, 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertEqual(error.getvalue(), cli.ERROR_GENERICO + "\n")
        ejecutar.assert_called_once()
        cliente.return_value.__exit__.assert_called_once()
        almacen.return_value.__exit__.assert_called_once()

    def test_cli_activacion_separada_y_reconciliacion_sin_motor(self) -> None:
        """La composición real selecciona el consumidor privado y sus argumentos explícitos."""
        configuracion = self.raiz / "entidad.json"
        configuracion.write_text("{}")
        cursos = self.raiz / "cursos.json"
        cursos.write_text("{}")
        for accion in ("activar", "reconciliar"):
            with (
                patch.dict(os.environ, self.entorno, clear=True),
                patch.object(cli, "_checkout_limpio"),
                patch.object(cli, "configuracion_privada", return_value=Mock()),
                patch.object(cli, "AlmacenS3"),
                patch.object(cli, "ClienteMantenimientoGitHub"),
                patch.object(cli, "ejecutar_trabajo") as motor,
                patch.object(cli, "activar_trabajo", return_value={"fase": "confirmada"}) as activar,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                codigo = cli.main(
                    [
                        accion,
                        str(self.checkout),
                        str(self.trabajo),
                        "--configuracion-cloudflare",
                        str(configuracion),
                        "--configuracion-cloudflare-cursos",
                        str(cursos),
                        "--origen-publico",
                        "https://publico.test",
                    ]
                )
            self.assertEqual(codigo, 0)
            self.assertEqual(activar.call_args.kwargs["reconciliar"], accion == "reconciliar")
            self.assertEqual(activar.call_args.args[0].ejecucion.run_id, "123")
            self.assertEqual(activar.call_args.args[0].configuracion_cloudflare_cursos, cursos)
            motor.assert_not_called()

    def test_abandonar_ya_no_es_una_orden(self) -> None:
        """El cierre se pide desde el panel y lo cumple la ejecución que despacha; no hay orden para abandonar."""
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            cli.main(["abandonar", str(self.checkout), str(self.trabajo)])

    def test_recuperacion_conserva_intento_actual_real_y_omite_motor(self) -> None:
        """Solo el comando explícito admite intento posterior; no falsifica intento 1."""
        configuracion = self.raiz / "entidad.json"
        configuracion.write_text("{}")
        cursos = self.raiz / "cursos.json"
        cursos.write_text("{}")
        for intento in ("2", "3"):
            with (
                patch.dict(os.environ, {**self.entorno, "GITHUB_RUN_ATTEMPT": intento}, clear=True),
                patch.object(cli, "_checkout_limpio"),
                patch.object(cli, "configuracion_privada", return_value=Mock()),
                patch.object(cli, "AlmacenS3"),
                patch.object(cli, "ClienteMantenimientoGitHub"),
                patch.object(cli, "ejecutar_trabajo") as motor,
                patch.object(cli, "activar_trabajo", return_value={"fase": "confirmada"}) as activar,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                codigo = cli.main(
                    [
                        "recuperar",
                        str(self.checkout),
                        str(self.trabajo),
                        "--configuracion-cloudflare",
                        str(configuracion),
                        "--configuracion-cloudflare-cursos",
                        str(cursos),
                        "--origen-publico",
                        "https://publico.test",
                    ]
                )
            self.assertEqual(codigo, 0)
            config = activar.call_args.args[0].ejecucion
            self.assertEqual(config.run_attempt, intento)
            self.assertTrue(config.recuperacion_activacion)
            self.assertTrue(activar.call_args.kwargs["recuperar"])
            motor.assert_not_called()
        with patch.object(cli, "_checkout_limpio"), self.assertRaises(ValueError):
            cli.configuracion_ejecucion(self.checkout, self.trabajo, self.entorno, recuperacion=True)

    def test_inicializacion_es_explicita_y_conserva_generacion_antes_de_referenciar(self) -> None:
        """El bootstrap no publica una referencia antes de conservar su contenido."""
        orden = []
        with (
            patch.object(cli, "configuracion_privada", return_value=Mock()),
            patch.object(cli, "AlmacenS3"),
            patch.object(cli, "guardar_generacion", side_effect=lambda *a: orden.append("generacion")),
            patch.object(cli, "inicializar_referencia", side_effect=lambda *a: orden.append("referencia") or {}),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            codigo = cli.main(
                ["inicializar", str(self.raiz), "--revision-generacion", "a" * 40, "--sha256-manifiesto", "b" * 64]
            )
        self.assertEqual(codigo, 0)
        self.assertEqual(orden, ["generacion", "referencia"])


if __name__ == "__main__":
    unittest.main()
