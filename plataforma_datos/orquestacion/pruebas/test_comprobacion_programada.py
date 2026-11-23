"""El motor consume la planificación bajo cerrojo y solo acredita consultas vinculadas a sus datos admitidos."""

import contextlib
import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import observacion_remota as observacion
from plataforma_datos.cursos.fuentes.formacion.lector import URL_OFERTA_SOC
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion import seguimiento_de_comprobaciones as seguimiento
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.modulos import MODULOS, Modulo
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS, Plan
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import EjecutorDeModulos
from plataforma_datos.orquestacion.pruebas.test_candidato import preparar

AHORA = datetime(2026, 10, 17, 12, tzinfo=UTC)
CUERPO = b"captura sintetica"


def evidencia_soc() -> dict:
    """Una observación sintética con identidad y huella concretas para probar su vinculación.

    Returns:
        Recepción del recurso SOC, sin contenido, direcciones ni credenciales persistidas.
    """
    instante = AHORA.isoformat()
    return {
        "version": 1,
        "fuente": "formacion",
        "intento": "intento-sintetico",
        "comienzo_utc": instante,
        "fin_utc": instante,
        "peticiones": [
            {
                "recurso_sha256": observacion.identidad_recurso(URL_OFERTA_SOC),
                "url_final_sha256": hashlib.sha256(URL_OFERTA_SOC.encode()).hexdigest(),
                "respuesta_sha256": hashlib.sha256(CUERPO).hexdigest(),
                "bytes": len(CUERPO),
                "completado_utc": instante,
            }
        ],
    }


def escribir_copia_soc(raiz: Path) -> None:
    """Conserva solo el original sintético y su procedencia; la prueba no sustituye la validación del catálogo."""
    carpeta = raiz / "var/actualizacion/originales/formacion"
    carpeta.mkdir(parents=True)
    nombre = "soc-cursos-2026-10-17.json"
    (carpeta / nombre).write_bytes(CUERPO)
    (carpeta / "procedencia.json").write_text(
        json.dumps(
            {
                "archivos": [
                    {
                        "archivo": nombre,
                        "sha256": hashlib.sha256(CUERPO).hexdigest(),
                        "comprobado_remoto_utc": AHORA.isoformat(),
                    }
                ]
            }
        )
    )


class PruebaRecepcionDelMotor(unittest.TestCase):
    """Cada descarga recibe una identidad propia y ninguna orden hereda una recepción ajena."""

    def test_recibo_real_de_callback_y_reintentos_aislados(self) -> None:
        """La misma orden dos veces produce receptores distintos; un texto de salida no aporta pruebas."""
        receptores = []

        def ejecutar(orden: list[str], _area: Path, _plazo: int, entorno: dict) -> subprocess.CompletedProcess:
            receptores.append(json.loads(entorno[observacion.VARIABLE_RECEPCION]))
            with mock.patch.dict(os.environ, entorno, clear=True), observacion.contexto_descarga():
                observacion.observar(URL_OFERTA_SOC, "GET", None, URL_OFERTA_SOC, CUERPO)
            return subprocess.CompletedProcess(orden, 0, "comprobado", "")

        orden = actualizar.ordenes_de_la_fuente("formacion")[0].orden
        with tempfile.TemporaryDirectory() as temporal, mock.patch.object(actualizar, "ejecutar_con_plazo", ejecutar):
            for _intento in range(2):
                resultado = actualizar.ejecutar_orden(orden, Path(temporal))
                self.assertEqual(resultado.codigo, 0)
                self.assertEqual(
                    resultado.evidencia["peticiones"][0]["respuesta_sha256"], hashlib.sha256(CUERPO).hexdigest()
                )
        self.assertNotEqual(receptores[0]["intento"], receptores[1]["intento"])
        self.assertNotEqual(receptores[0]["ruta"], receptores[1]["ruta"])
        self.assertTrue(all(not Path(receptor["ruta"]).parent.exists() for receptor in receptores))

    def test_env_ajeno_y_orden_no_canonica_no_reciben_receptor(self) -> None:
        """Ni una variable ambiental ni argumentos añadidos pueden fabricar el protocolo privado."""
        ordenes = (
            [actualizar.PYTHON, "-c", "pass"],
            [actualizar.PYTHON, "-m", "plataforma_datos.cursos.fuentes.formacion.lector", "descargar", "--depurar"],
        )
        for orden in ordenes:
            with (
                self.subTest(orden=orden),
                tempfile.TemporaryDirectory() as temporal,
                mock.patch.dict(os.environ, {observacion.VARIABLE_RECEPCION: "ajena"}),
                mock.patch.object(actualizar, "ejecutar_con_plazo") as ejecutar,
            ):
                ejecutar.return_value = subprocess.CompletedProcess(orden, 0, "", "")
                self.assertIsNone(actualizar.ejecutar_orden(orden, Path(temporal)).evidencia)
                self.assertNotIn(observacion.VARIABLE_RECEPCION, ejecutar.call_args.args[3])

    def test_fallo_timeout_y_falta_de_recibo_no_acreditan_consulta(self) -> None:
        """Una orden sin recibo, fallida o interrumpida no conserva observaciones de otro intento."""
        orden = actualizar.ordenes_de_la_fuente("formacion")[0].orden
        for codigo in (0, 1):
            with (
                tempfile.TemporaryDirectory() as temporal,
                mock.patch.object(actualizar, "ejecutar_con_plazo") as ejecutar,
            ):
                ejecutar.return_value = subprocess.CompletedProcess(orden, codigo, "actualizado", "")
                self.assertIsNone(actualizar.ejecutar_orden(orden, Path(temporal)).evidencia)
        with tempfile.TemporaryDirectory() as temporal, mock.patch.object(actualizar, "ejecutar_con_plazo") as ejecutar:
            ejecutar.side_effect = subprocess.TimeoutExpired(orden, 1)
            resultado = actualizar.ejecutar_orden(orden, Path(temporal))
            self.assertEqual(resultado.codigo, actualizar.CODIGO_TIEMPO_AGOTADO)
            self.assertIsNone(resultado.evidencia)


class PruebaSeguimientoDelMotor(unittest.TestCase):
    """La evidencia HTTP necesita alcance y admisión del módulo; no convierte catálogos locales en remotos."""

    def test_soc_admitida_renueva_solo_oferta_despues_de_publicar(self) -> None:
        """La última comprobación sobrevive al fallo del paquete, con reconstrucción pendiente."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            escribir_copia_soc(raiz)
            ciclo = registro.iniciar_ciclo(raiz, AHORA, "manual")

            def ejecutar(orden: list[str], _area: Path) -> actualizar.Resultado:
                evidencia = evidencia_soc() if etapa_de_fuente(orden)[1] == "descargar" else None
                return actualizar.Resultado(0, "", evidencia)

            observador = seguimiento.Seguimiento(raiz, ciclo, ejecutar, lambda: AHORA)
            for orden in actualizar.ordenes_de_la_fuente("formacion"):
                observador.ejecutar(orden.orden, raiz)
            self.assertEqual(registro.leer_registro(raiz)["conjuntos"], {})
            observador.terminar_modulo(Modulo("formacion", ("formacion",)), actualizar.ResultadoDelModulo("verde"))
            registro.cerrar_ciclo(raiz, ciclo, AHORA, resultado="fallo", paquete_preparado=False)
            documento = registro.leer_registro(raiz)
            self.assertEqual(set(documento["conjuntos"]), {"soc-oferta"})
            self.assertEqual(documento["fuentes"]["formacion"]["resultado"], "parcial")
            self.assertTrue(documento["reconstruccion_pendiente"])

    def test_recibo_ajeno_bytes_distintos_o_modulo_rechazado_no_renuevan(self) -> None:
        """Ni una petición de licencia, ni un original distinto, ni una publicación rechazada acreditan la oferta."""
        for variante in ("licencia", "bytes", "rechazado", "sin-recibo", "validacion-local"):
            with self.subTest(variante=variante), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal)
                escribir_copia_soc(raiz)
                evidencia = evidencia_soc()
                if variante == "licencia":
                    evidencia["peticiones"][0]["recurso_sha256"] = observacion.identidad_recurso(
                        "https://example.org/licencia"
                    )
                if variante == "bytes":
                    (raiz / "var/actualizacion/originales/formacion/soc-cursos-2026-10-17.json").write_bytes(b"otro")
                ciclo = registro.iniciar_ciclo(raiz, AHORA, "manual")

                def ejecutar(
                    orden: list[str], _area: Path, captura: dict = evidencia, caso: str = variante
                ) -> actualizar.Resultado:
                    recibo = captura if etapa_de_fuente(orden)[1] == "descargar" and caso != "sin-recibo" else None
                    return actualizar.Resultado(0, "", recibo)

                observador = seguimiento.Seguimiento(raiz, ciclo, ejecutar, lambda: AHORA)
                sin_descargar = ("formacion",) if variante == "validacion-local" else ()
                for orden in actualizar.ordenes_de_la_fuente("formacion", sin_descargar):
                    observador.ejecutar(orden.orden, raiz)
                veredicto = "ámbar" if variante == "rechazado" else "verde"
                observador.terminar_modulo(
                    Modulo("formacion", ("formacion",)), actualizar.ResultadoDelModulo(veredicto)
                )
                self.assertEqual(registro.leer_registro(raiz)["conjuntos"], {})

    def test_reconstruccion_local_no_aplaza_consulta_y_corte_recompone_dependientes(self) -> None:
        """La consulta anterior mantiene su cadencia y el ciclo abierto obliga a reconstruir sin red adicional."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            ciclo = registro.iniciar_ciclo(raiz, AHORA, "manual")
            for fuente in dict.fromkeys(conjunto.fuente for conjunto in CONJUNTOS if conjunto.operacion == "descargar"):
                conjuntos = tuple(conjunto.id for conjunto in CONJUNTOS if conjunto.fuente == fuente)
                registro.iniciar_fuente(raiz, ciclo, fuente, conjuntos, AHORA, remoto=True)
                registro.terminar_fuente(raiz, ciclo, fuente, AHORA, resultado="parcial", evidencia=None)
            registro.cerrar_ciclo(raiz, ciclo, AHORA, resultado="preparado", paquete_preparado=True)
            posterior = AHORA + timedelta(hours=1)
            nuevo = registro.iniciar_ciclo(raiz, posterior, "manual")
            registro.iniciar_fuente(raiz, nuevo, "consorci", ("consorci",), posterior)
            plan = seguimiento.plan_desde_registro(raiz, posterior)
            self.assertEqual(plan.fuentes, ())
            self.assertEqual(plan.modulos, tuple(modulo.id for modulo in MODULOS))
            registro.terminar_fuente(raiz, nuevo, "consorci", posterior, resultado="local", evidencia=None)
            registro.cerrar_ciclo(raiz, nuevo, posterior, resultado="preparado", paquete_preparado=True)
            self.assertEqual(seguimiento.plan_desde_registro(raiz, posterior).modulos, ())
            self.assertEqual(
                seguimiento.plan_desde_registro(raiz, AHORA + timedelta(days=1)).fuentes,
                (
                    "formacion",
                    "consorci",
                    "citilab",
                    "barcelonactiva",
                    "fundae",
                    "hp_life",
                    "cibervoluntarios",
                    "claude_academy",
                    "enlaces",
                ),
            )


class PruebaSeleccionIntegrada(unittest.TestCase):
    """El motor comparte lock y política con las ejecuciones manuales, sin tocar recibos públicos."""

    def test_programada_llega_a_paquete_sin_descargar_fuentes_vigentes(self) -> None:
        """La selección resuelta ejecuta el paquete real y conserva el modo y las consultas recientes."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            preparar(raiz)
            anterior = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
            ciclo = registro.iniciar_ciclo(raiz, anterior, "manual")
            fuentes = dict.fromkeys(conjunto.fuente for conjunto in CONJUNTOS if conjunto.operacion == "descargar")
            for fuente in fuentes:
                if fuente == "formacion":
                    continue
                conjuntos = tuple(conjunto.id for conjunto in CONJUNTOS if conjunto.fuente == fuente)
                registro.iniciar_fuente(raiz, ciclo, fuente, conjuntos, anterior, remoto=True)
                registro.terminar_fuente(raiz, ciclo, fuente, anterior, resultado="parcial", evidencia=None)
            registro.cerrar_ciclo(raiz, ciclo, anterior, resultado="preparado", paquete_preparado=True)
            previas = registro.leer_registro(raiz)["fuentes"]
            ejecutor = EjecutorDeModulos()
            with contextlib.redirect_stdout(io.StringIO()):
                resultado = actualizar.actualizar_con_resultado(
                    raiz, actualizar.Opciones(programada=True, pausa=0, reintento=0), ejecutor
                )
            self.assertEqual(resultado.codigo, 0)
            self.assertEqual(resultado.resultados["paquete"].veredicto, "verde")
            self.assertTrue(resultado.informe.is_file())
            descargadas = {
                identificada[0]
                for orden in ejecutor.ordenes
                if (identificada := etapa_de_fuente(orden)) is not None and identificada[1] == "descargar"
            }
            self.assertEqual(descargadas, {"formacion"})
            posterior = registro.leer_registro(raiz)
            self.assertEqual(posterior["ultimo_ciclo"]["modo"], "programada")
            self.assertTrue(posterior["ultimo_ciclo"]["paquete_preparado"])
            for fuente, fila in previas.items():
                self.assertEqual(
                    posterior["fuentes"][fuente]["ultimo_intento_remoto_utc"], fila["ultimo_intento_remoto_utc"]
                )

    def test_sin_trabajo_no_ejecuta_no_registra_y_planifica_bajo_cerrojo(self) -> None:
        """Una consulta al plan no fabrica fecha nueva ni paquete y comparte la exclusión mutua del motor."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            eventos = []

            @contextlib.contextmanager
            def cerrojo(_raiz: Path) -> Iterator[None]:
                eventos.append("cerrojo")
                yield

            def planificar(_raiz: Path, _opciones: actualizar.Opciones, _ahora: datetime) -> None:
                eventos.append("plan")

            with (
                mock.patch.object(actualizar.sustitucion, "cerrojo", cerrojo),
                mock.patch.object(actualizar, "_opciones_programadas", planificar),
                mock.patch.object(actualizar, "_actualizar") as ejecutar,
            ):
                resultado = actualizar.actualizar_con_resultado(raiz, actualizar.Opciones(programada=True))
            self.assertEqual(eventos, ["cerrojo", "plan"])
            self.assertEqual(resultado, actualizar.ResultadoActualizacion(0, None, None, {}))
            ejecutar.assert_not_called()
            self.assertEqual(list(raiz.iterdir()), [])

    def test_plan_solo_permite_descargar_fuentes_elegidas(self) -> None:
        """Un módulo añadido para reconstruir no recibe permiso implícito de red."""
        plan = Plan(("formacion",), ("formacion", "consorci"), ())
        with mock.patch.object(actualizar, "plan_desde_registro", return_value=plan):
            opciones = actualizar._opciones_programadas(Path(), actualizar.Opciones(programada=True), AHORA)
        self.assertEqual(opciones.solo, plan.modulos)
        self.assertNotIn("formacion", opciones.sin_descargar)
        self.assertIn("consorci", opciones.sin_descargar)

    def test_cli_nueva_usa_motor_existente_y_modos_excluyentes(self) -> None:
        """Buscar ahora y comprobación programada son selecciones del mismo motor; no se mezclan con reintentos."""
        for argumento, campo in (("--programada", "programada"), ("--buscar-actualizaciones", "forzar_comprobaciones")):
            with mock.patch.object(actualizar, "actualizar", return_value=0) as ejecutar:
                self.assertEqual(actualizar.main([argumento]), 0)
                self.assertTrue(getattr(ejecutar.call_args.args[1], campo))
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            actualizar.main(["--programada", "--pendientes"])


if __name__ == "__main__":
    unittest.main()
