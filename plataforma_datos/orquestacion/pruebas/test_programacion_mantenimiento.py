"""La acción remota programada consume las cadencias reales y conserva resultados sin red."""

import json
import tempfile
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import activacion, actualizar, candidato, comprobaciones_remotas, ejecutor_operativo
from plataforma_datos.orquestacion import almacen_trabajos as trabajos
from plataforma_datos.orquestacion.almacen_trabajos import leer_referencia, recuperar_trabajo
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS
from plataforma_datos.orquestacion.pruebas import test_candidato as casos_candidato
from plataforma_datos.orquestacion.pruebas import test_candidato_comprobaciones as casos_diario
from plataforma_datos.orquestacion.pruebas import test_cliente_mantenimiento as casos_cliente
from plataforma_datos.orquestacion.pruebas import test_ejecutar_mantenimiento as casos_cli
from plataforma_datos.orquestacion.pruebas import test_ejecutor_operativo as casos_ejecutor
from plataforma_datos.orquestacion.sustitucion import cerrojo, huellas_del_arbol


class ProgramacionMantenimientoTest(unittest.TestCase):
    """Solo los procesos externos usan dobles; selección, diario y conservación son reales."""

    def preparar_candidato(self) -> Path:
        """Monta una raíz sintética portable.

        Returns:
            Raíz propia sin datos publicados ni secretos.
        """
        raiz = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="Programada Año "))).resolve()
        casos_candidato.preparar(raiz)
        self.enterContext(mock.patch.object(actualizar.time, "sleep"))
        return raiz

    def registrar_recientes(self, raiz: Path, *, excluir: str | None = None) -> None:
        """Deja las fuentes seleccionadas en la fecha UTC actual, sin inventar éxito remoto."""
        anterior = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        with cerrojo(raiz):
            ciclo = comprobaciones_remotas.iniciar_ciclo(raiz, anterior, "manual")
            for fuente in dict.fromkeys(c.fuente for c in CONJUNTOS if c.operacion == "descargar"):
                if fuente == excluir:
                    continue
                conjuntos = tuple(c.id for c in CONJUNTOS if c.fuente == fuente)
                comprobaciones_remotas.iniciar_fuente(raiz, ciclo, fuente, conjuntos, anterior, remoto=True)
                comprobaciones_remotas.terminar_fuente(
                    raiz, ciclo, fuente, anterior, resultado="parcial", evidencia=None
                )
            comprobaciones_remotas.cerrar_ciclo(raiz, ciclo, anterior, resultado="preparado", paquete_preparado=True)

    def test_noop_real_no_muta_diario_estado_ni_paquete(self) -> None:
        """El plan vacío devuelve un recibo v4 sin inventar catálogo ni iniciar ciclo, órdenes o informes."""
        raiz = self.preparar_candidato()
        self.registrar_recientes(raiz)
        antes = huellas_del_arbol(raiz)
        ejecutor = mock.Mock()
        with mock.patch.object(comprobaciones_remotas, "iniciar_ciclo") as iniciar:
            recibo = candidato.ejecutar_candidato(raiz, "comprobar-programada", ejecutor)
        self.assertEqual(recibo["version"], trabajos.VERSION_RECIBO_CONSERVADOS)
        self.assertEqual(recibo["conservados"], trabajos.conservados_del_estado(recibo["estado"]))
        self.assertIsNone(recibo["catalogo"])
        self.assertEqual(recibo["resultado"], "sin-pendientes")
        self.assertIsNone(recibo["veredicto"])
        self.assertIsNone(recibo["huellaPaquete"])
        self.assertIsNone(recibo["error"])
        self.assertIsNotNone(recibo["estado"])
        self.assertEqual(huellas_del_arbol(raiz), antes)
        ejecutor.assert_not_called()
        iniciar.assert_not_called()

    def test_seleccion_real_solo_descarga_fuente_vencida(self) -> None:
        """La acción llega al motor con programada=True y fuerza=False, usando su plan vigente."""
        raiz = self.preparar_candidato()
        self.registrar_recientes(raiz, excluir="formacion")
        ejecutor = casos_candidato.EjecutorCandidato()
        with mock.patch.object(
            actualizar, "actualizar_con_resultado", wraps=actualizar.actualizar_con_resultado
        ) as motor:
            recibo = candidato.ejecutar_candidato(raiz, "comprobar-programada", ejecutor)
        self.assertEqual(motor.call_args.args[1], actualizar.Opciones(programada=True))
        self.assertEqual(recibo["version"], trabajos.VERSION_RECIBO_CONSERVADOS)
        self.assertEqual(recibo["veredicto"], "verde")
        self.assertEqual(recibo["conservados"], trabajos.conservados_del_estado(recibo["estado"]))
        self.assertIsNone(recibo["catalogo"])
        self.assertEqual(recibo["resultado"], "validado")
        descargadas = {
            etapa[0]
            for orden in ejecutor.ordenes
            if (etapa := etapa_de_fuente(orden)) is not None and etapa[1] == "descargar"
        }
        self.assertEqual(descargadas, {"formacion"})
        self.assertEqual(comprobaciones_remotas.leer_registro(raiz)["ultimo_ciclo"]["modo"], "programada")

    def test_noop_exige_forma_exacta_y_no_absorbe_cerrojo_o_fallos(self) -> None:
        """Código cero sin informe solo significa ausencia para la forma vacía y el modo programado."""
        raiz = self.preparar_candidato()
        cero = actualizar.ResultadoActualizacion(0, None, None, {})
        variantes = (
            cero._replace(codigo=1),
            cero._replace(codigo=3),
            cero._replace(codigo=False),
            cero._replace(codigo=0.0),
            cero._replace(comienzo=datetime.now(UTC)),
            cero._replace(informe=raiz / "informe.md"),
            cero._replace(resultados={"paquete": actualizar.ResultadoDelModulo("verde")}),
            cero._replace(resultados=[]),
        )
        for intento in variantes:
            with (
                self.subTest(intento=intento),
                mock.patch.object(actualizar, "actualizar_con_resultado", return_value=intento),
            ):
                recibo = candidato.ejecutar_candidato(raiz, "comprobar-programada", mock.Mock())
                self.assertEqual(recibo["resultado"], "rechazado")
                self.assertEqual(recibo["error"], "actualizacion_no_completada")
        for error in (OSError("red"), ValueError("registro inválido")):
            with (
                self.subTest(error=type(error)),
                mock.patch.object(actualizar, "actualizar_con_resultado", side_effect=error),
            ):
                self.assertEqual(candidato.ejecutar_candidato(raiz, "comprobar-programada")["resultado"], "rechazado")
        with mock.patch.object(actualizar, "actualizar_con_resultado", return_value=cero):
            self.assertEqual(candidato.ejecutar_candidato(raiz, "actualizar-datos")["resultado"], "rechazado")
        with cerrojo(raiz):
            self.assertEqual(candidato.ejecutar_candidato(raiz, "comprobar-programada")["resultado"], "rechazado")

    def caso_ejecutor(self) -> casos_ejecutor.PruebaEjecutorOperativo:
        """Reutiliza el almacén real y procesos interceptados de la composición existente.

        Returns:
            Caso aislado con acción programada y recibos v2.
        """
        caso = casos_ejecutor.PruebaEjecutorOperativo(methodName="runTest")
        self.addCleanup(caso.doCleanups)
        caso.setUp()
        caso.config = replace(caso.config, accion="comprobar-programada")
        caso.version_recibo = 2
        return caso

    def test_noop_conserva_base_reenvia_exacto_y_omite_activacion(self) -> None:
        """Un resultado vacío conserva solo recibo/índice, sin exportación ni consulta de activación."""
        caso = self.caso_ejecutor()
        caso.resultado = "sin-pendientes"
        with mock.patch.object(ejecutor_operativo, "exportar_generacion") as exportar:
            caso.ejecutar()
        exportar.assert_not_called()
        self.assertEqual(caso.exportaciones, [])
        referencia = leer_referencia(caso.almacen)
        self.assertEqual(referencia["baseOperativa"], caso.base)
        self.assertEqual(referencia["ultimaValidada"], caso.base)
        indice, recibo = recuperar_trabajo(caso.config.solicitud_id, 1, "123", caso.almacen)
        self.assertEqual(indice["version"], 2)
        self.assertEqual(json.loads(recibo)["version"], 2)
        self.assertIsNone(indice["artefacto"])
        antes = dict(caso.almacen.objetos)
        caso.ejecutar(reanudar=True)
        self.assertEqual(caso.cliente.recibos, [recibo, recibo])
        self.assertEqual(caso.almacen.objetos, antes)
        self.assertEqual(len(caso.cliente.inicios), 1)
        self.assertEqual(len(caso.motores), 1)
        configuracion_cf = caso.raiz / "entidad.json"
        configuracion_cf.write_text("{}")
        configuracion_cursos = caso.raiz / "cursos.json"
        configuracion_cursos.write_text("{}")
        configuracion = activacion.ConfiguracionActivacion(
            ejecucion=caso.config,
            configuracion_cloudflare=configuracion_cf,
            configuracion_cloudflare_cursos=configuracion_cursos,
            origen_publico="https://publico.example",
        )
        cliente = mock.Mock()
        # El noop solo lee la activación, por si hay una abandonada que reintentar; nunca reserva ni da un paso.
        vacia = {"estado": "leido", "activacion": {"version": 1, "revision": 0, "ultimaActivacion": None}}
        cliente.activacion.side_effect = lambda operacion, *_: (
            vacia if operacion == "leer" else self.fail("El noop no debe escribir en la autoridad de activación")
        )
        with mock.patch.object(activacion.AdaptadorVersiones, "operar") as operar:
            for reconciliar in (False, True):
                self.assertEqual(
                    activacion.activar_trabajo(configuracion, cliente, caso.almacen, reconciliar=reconciliar)["fase"],
                    "omitida",
                )
        operar.assert_not_called()
        self.assertEqual([c.args for c in cliente.activacion.call_args_list], [("leer",), ("leer",)])

    def test_rechazo_no_exportable_programado_no_bloquea_el_siguiente(self) -> None:
        """El rechazo sin generación deja la base como estaba y la comprobación siguiente arranca sola."""
        caso = self.caso_ejecutor()
        caso.resultado = "rechazado"
        with mock.patch.object(ejecutor_operativo, "exportar_generacion", side_effect=ValueError("no exportable")):
            caso.ejecutar()
        referencia = leer_referencia(caso.almacen)
        self.assertFalse(referencia["bloqueoOperativo"])
        self.assertEqual(referencia["baseOperativa"], caso.base)
        caso.config = replace(caso.config, revision_reserva=2, run_id="124")
        caso.ejecutar()
        self.assertEqual(len(caso.motores), 2)

    def test_programada_conserva_diario_validado_y_rechazado(self) -> None:
        """Las generaciones reales mantienen el diario y la cadencia tras un acuse perdido."""
        for resultado in ("validado", "rechazado"):
            with self.subTest(resultado=resultado):
                comprobacion = casos_diario.PruebaCandidatoComprobaciones(methodName="runTest")
                self.addCleanup(comprobacion.doCleanups)
                comprobacion.comprobar_continuidad(resultado, accion="comprobar-programada")

    def test_cli_conserva_dispatch_intento_uno_y_cliente_confirma_oidc(self) -> None:
        """La acción interna usa el contexto confiable anterior y un JWT nuevo para confirmar el inicio."""
        cli = casos_cli.EjecutarMantenimientoTest(methodName="runTest")
        self.addCleanup(cli.doCleanups)
        cli.setUp()
        entorno = cli.entorno | {"FARO_ACCION": "comprobar-programada"}
        with mock.patch.object(casos_cli.cli, "_checkout_limpio"):
            config = casos_cli.cli.configuracion_ejecucion(cli.checkout, cli.trabajo, entorno)
            self.assertEqual(config.accion, "comprobar-programada")
            self.assertFalse(config.revisar_paquete_pendiente)
            pendiente = entorno | {"FARO_REVISAR_PAQUETE_PENDIENTE": "si"}
            self.assertTrue(
                casos_cli.cli.configuracion_ejecucion(cli.checkout, cli.trabajo, pendiente).revisar_paquete_pendiente
            )
            with self.assertRaises(ValueError):
                casos_cli.cli.configuracion_ejecucion(
                    cli.checkout, cli.trabajo, pendiente | {"FARO_ACCION": "actualizar-datos"}
                )
            for cambio in ({"GITHUB_EVENT_NAME": "schedule"}, {"GITHUB_RUN_ATTEMPT": "2"}):
                with self.assertRaises(ValueError):
                    casos_cli.cli.configuracion_ejecucion(cli.checkout, cli.trabajo, entorno | cambio)
        cliente = casos_cliente.PruebaClienteMantenimiento(methodName="runTest")
        self.addCleanup(cliente.doCleanups)
        cliente.setUp()
        cliente.exito()
        self.assertEqual(cliente.instancia.confirmar_inicio(casos_cliente.ID, 1, "comprobar-programada"), "aplicado")
        self.assertEqual(len(cliente.peticiones), 2)
        self.assertEqual(json.loads(cliente.peticiones[1]["body"])["accion"], "comprobar-programada")


if __name__ == "__main__":
    unittest.main()
