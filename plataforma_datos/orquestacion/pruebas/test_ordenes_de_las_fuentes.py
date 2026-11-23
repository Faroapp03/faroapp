"""Contrato entre la actualización y los lectores: cada fuente admite la orden exacta con que se la invoca.

Recorre las órdenes reales (actualizar.ordenes_de_la_fuente), su reconocimiento estricto (etapa_de_fuente) y el `main`
real de cada lector hasta su etapa, con las etapas sustituidas para no salir a la red ni tocar datos. Una orden que
el lector no admite es un error propio de la orquestación: no abre consulta remota, no cuenta como fallo del proveedor
y consta en el informe y en el panel.
"""

import contextlib
import importlib
import io
import json
import os
import sys
import tempfile
import unittest
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from plataforma_datos.comun.nucleo import ETAPAS
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.orquestacion import actualizar, ordenes, reconstruir
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion import seguimiento_de_comprobaciones as seguimiento
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.estado_de_la_actualizacion import leer_estado, pendientes
from plataforma_datos.orquestacion.estado_panel import estado_panel
from plataforma_datos.orquestacion.modulos import MODULOS
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import ACEPTAR_CAMBIO, FUENTES, parametros_de_etapa
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import EjecutorDeModulos, publicado
from plataforma_datos.orquestacion.pruebas.test_candidato import preparar
from plataforma_datos.orquestacion.pruebas.test_reintento_espaciado import REMOTAS, ciclo_remoto

SEGMENTO = (
    "hp_life",
    "claude_academy",
    "cibervoluntarios",
    "barcelonactiva",
    "fundae",
    "enlaces_lecturas",
    "acreditacion",
)
# Estas tres delegan sus etapas en la operación común de catálogos; las demás las definen en su lector.
CON_OPERACION_COMUN = frozenset({"hp_life", "claude_academy", "cibervoluntarios"})
# Cibernàrium y FUNDAE definen su descarga en el lector, pero la delegan con la aceptación en la operación común:
# se intercepta allí para comprobar que el lector la entrega tal cual.
DESCARGA_EN_OPERACION_COMUN = CON_OPERACION_COMUN | {"barcelonactiva", "fundae"}
ACREDITACION, ENLACES, FUNDAE = "acreditacion", "enlaces_lecturas", "fundae"


@contextlib.contextmanager
def reloj_en(instante: datetime) -> Iterator[None]:
    """El motor cree que es `instante`: comienzo, selección de pendientes y registro de comprobaciones.

    Yields:
        Nada; el reloj vuelve a ser el real al salir.
    """

    class Reloj(datetime):
        @classmethod
        def now(cls, tz: object = None) -> datetime:
            return instante

    with mock.patch.object(actualizar, "datetime", Reloj):
        yield


def etapas_de(ejecutor: EjecutorDeModulos, fuente: str) -> list[str]:
    """Etapas de la fuente que llegaron a ejecutarse, con o sin orden canónica.

    Returns:
        Las etapas, en el orden en que se ejecutaron.
    """
    modulo = dict(actualizar.FUENTES_EN_ORDEN)[fuente].__name__
    return [orden[3] for orden in ejecutor.ordenes if len(orden) > 3 and orden[2] == modulo]  # noqa: PLR2004


def main_que_rechaza(fuente: str, etapa: str) -> Callable[[list[str]], int]:
    """El `main` real de la fuente, salvo que su intérprete rechaza `etapa` como lo haría argparse.

    Returns:
        El `main` sustituto.
    """
    real = lector_de(fuente).main

    def principal(argumentos: list[str]) -> int:
        if argumentos and argumentos[0] == etapa:
            print(f"lector.py: error: argument accion: invalid choice: '{etapa}'", file=sys.stderr)
            raise SystemExit(2)
        return real(argumentos)

    return principal


def lector_de(fuente: str) -> object:
    """El módulo que ejecuta la actualización para la fuente.

    Returns:
        El lector registrado en FUENTES_EN_ORDEN.
    """
    return importlib.import_module(dict(actualizar.FUENTES_EN_ORDEN)[fuente].__name__)


def main_sin_descarga(argumentos: list[str]) -> int:
    """Un lector con la interfaz común sin descarga, como barcelonactiva y fundae antes del arreglo.

    Returns:
        El código de la interfaz común; sus etapas no hacen nada.
    """
    return ordenes.principal_fuente("lector sintético", dict.fromkeys(ETAPAS, lambda: None), argumentos)


def ordenes_emitidas(fuente: str) -> set[tuple[str, ...]]:
    """Argumentos con que la orquestación puede invocar el lector, capturados de sus emisores reales.

    Actualización completa y sin descarga (ordenes_de_la_fuente), revalidación de lo publicado (actualizar.revalidar)
    y reconstrucción con y sin `--descargar` (reconstruir.reconstruir, que descarga sin aceptar cambios).

    Returns:
        Cada orden, sin el intérprete ni el módulo: la etapa y sus parámetros.
    """
    emitidas = {
        tuple(orden.orden[3:])
        for sin_descargar in ((), (fuente,))
        for orden in actualizar.ordenes_de_la_fuente(fuente, sin_descargar)
    }

    def ejecutor(orden: list[str], _area: Path) -> actualizar.Resultado:
        emitidas.add(tuple(orden[3:]))
        return actualizar.Resultado(0, "")

    modulo = next(modulo for modulo in MODULOS if fuente in modulo.fuentes)
    with mock.patch.object(actualizar, "_restaurar_o_detener"):
        actualizar.revalidar(Path("area-sin-uso"), modulo._replace(fuentes=(fuente,)), ejecutor, (), Path("raiz"))

    def principal(argumentos: list[str]) -> int:
        emitidas.add(tuple(argumentos))
        return 0

    registrado = ((fuente, SimpleNamespace(main=principal)),)
    with mock.patch.object(reconstruir, "FUENTES_EN_ORDEN", registrado), contextlib.redirect_stdout(io.StringIO()):
        for descargar in (True, False):
            reconstruir.reconstruir(descargar=descargar, paquete=False)
    return emitidas


class ContratoDeLasOrdenes(unittest.TestCase):
    """Construcción, reconocimiento y admisión de las órdenes salen de una sola fuente de verdad."""

    def sustituir_etapas(self, fuente: str, pila: contextlib.ExitStack) -> list[tuple[str, tuple]]:
        """Sustituye las tres etapas reales de la fuente por registradores, sin red ni disco, mientras dure `pila`.

        Returns:
            Las llamadas recibidas, como (etapa, argumentos).
        """
        llamadas: list[tuple[str, tuple]] = []
        for etapa in ETAPAS:
            comun = fuente in CON_OPERACION_COMUN or (
                etapa == actualizar.ETAPA_DE_DESCARGA and fuente in DESCARGA_EN_OPERACION_COMUN
            )
            destino = operacion_fuente if comun else lector_de(fuente)
            self.assertTrue(callable(getattr(destino, etapa)), f"{fuente}: falta la etapa {etapa}")

            def registrar(*argumentos: object, etapa: str = etapa, **opciones: object) -> None:
                llamadas.append((etapa, (*argumentos, *opciones.values())))

            pila.enter_context(mock.patch.object(destino, etapa, registrar))
        return llamadas

    def test_las_siete_fuentes_admiten_sus_tres_etapas_hasta_el_main_real(self) -> None:
        """La orden que arma la actualización, la que reconoce el seguimiento y la que acepta el lector coinciden."""
        for fuente in SEGMENTO:
            construidas = actualizar.ordenes_de_la_fuente(fuente)
            self.assertEqual([orden.etapa for orden in construidas], list(ETAPAS))
            for orden in construidas:
                with self.subTest(fuente=fuente, etapa=orden.etapa), contextlib.ExitStack() as pila:
                    parametros = parametros_de_etapa(fuente, orden.etapa)
                    self.assertEqual(tuple(orden.orden[4:]), parametros)
                    self.assertEqual(etapa_de_fuente(orden.orden), (fuente, orden.etapa))
                    llamadas = self.sustituir_etapas(fuente, pila)
                    actualizar.exigir_orden_admitida(orden)
                    self.assertEqual(llamadas, [], "la comprobación previa no ejecuta ninguna etapa")
                    codigo = lector_de(fuente).main(list(orden.orden[3:]))
                    self.assertEqual(codigo, 0, f"{fuente} no admite «{' '.join(orden.orden[3:])}»")
                    self.assertEqual([etapa for etapa, _ in llamadas], [orden.etapa])
                    if orden.etapa == actualizar.ETAPA_DE_DESCARGA:
                        # La aceptación llega a la descarga tal como la pide la orden, sin perderse ni inventarse.
                        self.assertIs(llamadas[0][1][-1], ACEPTAR_CAMBIO in parametros)

    def test_las_siete_admiten_cada_orden_que_puede_emitir_la_orquestacion(self) -> None:
        """También la descarga sin aceptación de la reconstrucción y la validación de la revalidación, hasta el main."""
        posibles = {("descargar", ACEPTAR_CAMBIO), ("descargar",), ("preparar",), ("validar",)}
        for fuente in SEGMENTO:
            emitidas = ordenes_emitidas(fuente)
            # Si un emisor cambiara sus órdenes, la prueba debe revisarse en lugar de dejar una sin cubrir.
            self.assertEqual(emitidas, posibles, fuente)
            for argumentos in sorted(emitidas):
                with self.subTest(fuente=fuente, orden=argumentos), contextlib.ExitStack() as pila:
                    llamadas = self.sustituir_etapas(fuente, pila)
                    self.assertIsNone(ordenes.motivo_de_rechazo(lector_de(fuente).main, argumentos))
                    self.assertEqual(llamadas, [], "la comprobación previa no ejecuta ninguna etapa")
                    self.assertEqual(lector_de(fuente).main(list(argumentos)), 0)
                    self.assertEqual([etapa for etapa, _ in llamadas], [argumentos[0]])
                    if argumentos[0] == actualizar.ETAPA_DE_DESCARGA:
                        # La reconstrucción nunca acepta un original cambiado; la actualización, solo si lo pide.
                        self.assertIs(llamadas[0][1][-1], ACEPTAR_CAMBIO in argumentos)

    def test_las_renovables_del_segmento_reciben_la_aceptacion(self) -> None:
        """Las siete son de política renovable: su descarga lleva `--aceptar-cambio` y nada más."""
        for fuente in SEGMENTO:
            with self.subTest(fuente=fuente):
                self.assertEqual(parametros_de_etapa(fuente, "descargar"), (ACEPTAR_CAMBIO,))
                self.assertEqual(parametros_de_etapa(fuente, "preparar"), ())
                self.assertEqual(parametros_de_etapa(fuente, "validar"), ())

    def test_todas_las_fuentes_registradas_comprueban_su_orden_sin_ejecutar_nada(self) -> None:
        """La comprobación previa interpreta la orden de cada lector registrado y nunca llega a una etapa."""
        with mock.patch.object(ordenes, "ejecutar", side_effect=AssertionError("la comprobación ejecutó una etapa")):
            for fuente, _lector in actualizar.FUENTES_EN_ORDEN:
                for orden in actualizar.ordenes_de_la_fuente(fuente):
                    with self.subTest(fuente=fuente, etapa=orden.etapa):
                        self.assertEqual(etapa_de_fuente(orden.orden), (fuente, orden.etapa))
                        actualizar.exigir_orden_admitida(orden)

    def test_el_reconocimiento_es_estricto_con_los_parametros(self) -> None:
        """Sin la aceptación, o con ella fuera de la descarga, la orden no es una etapa canónica."""
        modulo = dict(actualizar.FUENTES_EN_ORDEN)["fundae"].__name__
        self.assertIsNone(etapa_de_fuente([actualizar.PYTHON, "-m", modulo, "descargar"]))
        self.assertIsNone(etapa_de_fuente([actualizar.PYTHON, "-m", modulo, "preparar", ACEPTAR_CAMBIO]))
        self.assertEqual(
            etapa_de_fuente([actualizar.PYTHON, "-m", modulo, "descargar", ACEPTAR_CAMBIO]), ("fundae", "descargar")
        )

    def test_un_lector_sin_la_opcion_rechaza_la_orden_antes_de_ejecutarla(self) -> None:
        """La interfaz sin descarga (el defecto de barcelonactiva y fundae) se detecta sin abrir ningún proceso."""
        self.assertIn(ACEPTAR_CAMBIO, ordenes.motivo_de_rechazo(main_sin_descarga, ["descargar", ACEPTAR_CAMBIO]))
        self.assertIsNone(ordenes.motivo_de_rechazo(main_sin_descarga, ["preparar"]))
        for fuente in ("barcelonactiva", "fundae"):
            orden = actualizar.ordenes_de_la_fuente(fuente)[0]
            with (
                self.subTest(fuente=fuente),
                mock.patch.object(lector_de(fuente), "main", main_sin_descarga),
                self.assertRaisesRegex(actualizar.OrdenNoAdmitida, "unrecognized arguments: --aceptar-cambio"),
            ):
                actualizar.exigir_orden_admitida(orden)
        # Un lector de la interfaz común que no respetara la comprobación tampoco llegaría a ejecutar una etapa.
        ejecutadas: list[str] = []

        def main_que_ignora(_argumentos: list[str]) -> int:
            return ordenes.ejecutar("descargar", {"descargar": lambda: ejecutadas.append("descargar")})

        self.assertIn("no respeta", ordenes.motivo_de_rechazo(main_que_ignora, ["descargar"]))
        self.assertEqual(ejecutadas, [])
        ajena = actualizar.Orden("fundae · descargar", [actualizar.PYTHON, "-m", "otro.modulo", "descargar"], "fundae")
        with self.assertRaisesRegex(actualizar.OrdenNoAdmitida, "lector registrado"):
            actualizar.exigir_orden_admitida(ajena)

    def test_una_orden_admitida_pero_no_canonica_no_se_ejecuta(self) -> None:
        """El lector admite `--depurar`, pero esa orden no es la de su etapa: el seguimiento no la reconocería."""
        for fuente in (FUNDAE, ACREDITACION):
            canonica = actualizar.ordenes_de_la_fuente(fuente)[1]
            depurada = canonica._replace(orden=[*canonica.orden, "--depurar"])
            with self.subTest(fuente=fuente):
                self.assertIsNone(ordenes.motivo_de_rechazo(lector_de(fuente).main, depurada.orden[3:]))
                self.assertIsNone(etapa_de_fuente(depurada.orden))
                with self.assertRaisesRegex(actualizar.OrdenNoAdmitida, "no es la orden de su etapa"):
                    actualizar.exigir_orden_admitida(depurada)
                otra_etapa = canonica._replace(etapa=actualizar.ETAPA_DE_DESCARGA)
                with self.assertRaisesRegex(actualizar.OrdenNoAdmitida, "no es la orden de su etapa"):
                    actualizar.exigir_orden_admitida(otra_etapa)


class RechazoLocalDePuntaAPunta(unittest.TestCase):
    """Motor real con ejecutor simulado → registro → planificación → pendientes → informe → panel."""

    def setUp(self) -> None:
        """Instalación temporal con todas las fuentes remotas consultadas hace seis días."""
        temporal = tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR"))
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve()
        preparar(self.raiz)
        self.enterContext(mock.patch.object(actualizar.time, "sleep"))
        self.enterContext(mock.patch.dict(os.environ, {"FARO_AVISO": ""}))
        self.hoy = datetime.now(UTC).replace(microsecond=0)
        self.antes = self.hoy - timedelta(days=6)
        ciclo_remoto(self.raiz, self.antes, dict.fromkeys(REMOTAS, "parcial"))

    def ejecutor_fiel(self, base: EjecutorDeModulos) -> Callable[[list[str], Path], actualizar.Resultado]:
        """Como un proceso real: un lector que rechaza sus argumentos termina con el código 2 de argparse.

        Returns:
            El ejecutor, que delega en `base` las órdenes que el lector admite.
        """

        def ejecutar(orden: list[str], area: Path) -> actualizar.Resultado:
            identificada = etapa_de_fuente(orden)
            if identificada is not None and identificada[0] == ACREDITACION:
                errores = io.StringIO()
                try:
                    with contextlib.redirect_stderr(errores):
                        lector_de(ACREDITACION).main(list(orden[3:]))
                except SystemExit as salida:
                    base.ordenes.append(orden)
                    return actualizar.Resultado(salida.code, errores.getvalue())
            return base(orden, area)

        return ejecutar

    def test_orden_no_admitida_es_error_interno_y_no_consulta_remota(self) -> None:
        """La acreditación con la interfaz sin descarga: rojo interno, sin intento remoto, fallo ni reintento remoto."""
        antes = registro.leer_registro(self.raiz)
        base = EjecutorDeModulos()
        with (
            mock.patch.object(lector_de(ACREDITACION), "main", main_sin_descarga),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            resultado = actualizar.actualizar_con_resultado(
                self.raiz,
                actualizar.Opciones(solo=(ACREDITACION, ENLACES), pausa=0, reintento=0),
                self.ejecutor_fiel(base),
            )
        acreditacion = resultado.resultados[ACREDITACION]
        self.assertEqual(acreditacion.veredicto, actualizar.ROJO)
        self.assertIn("error interno de orquestación: OrdenNoAdmitida", acreditacion.motivo)
        self.assertIn(ACEPTAR_CAMBIO, acreditacion.motivo)
        self.assertEqual(resultado.resultados[ENLACES].veredicto, actualizar.VERDE)
        # Nada de la acreditación llegó a ejecutarse: ni la descarga ni su reintento.
        self.assertFalse([o for o in base.ordenes if (etapa_de_fuente(o) or ("",))[0] == ACREDITACION])

        # Registro de comprobaciones: la acreditación conserva su última consulta real y no suma fallos.
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(documento["fuentes"][ACREDITACION], antes["fuentes"][ACREDITACION])
        self.assertEqual(documento["seguimiento_remoto"][ACREDITACION], antes["seguimiento_remoto"][ACREDITACION])
        self.assertEqual(documento["seguimiento_remoto"][ACREDITACION]["fallos_seguidos"], 0)
        self.assertEqual(documento["fuentes"][ENLACES]["ciclo"], documento["ultimo_ciclo"]["id"])

        # Planificación: sin reintento escalonado; vuelve con su cadencia semanal desde la última consulta real.
        ahora = datetime.now(UTC)
        manana = ahora + timedelta(days=1)
        self.assertNotIn(ACREDITACION, seguimiento.reintentos_remotos_vencidos(self.raiz, manana))
        self.assertNotIn(ACREDITACION, seguimiento.plan_desde_registro(self.raiz, ahora).fuentes)
        self.assertIn(ACREDITACION, seguimiento.plan_desde_registro(self.raiz, manana).fuentes)

        # Estado: el módulo queda en rojo por error interno, como cualquier error de la orquestación, y
        # `--pendientes` lo vuelve a intentar con el reintento del módulo, no con el de una consulta fallida.
        estado = leer_estado(self.raiz)[ACREDITACION]
        self.assertEqual(estado["veredicto"], actualizar.ROJO)
        self.assertIn("OrdenNoAdmitida", estado["motivo"])
        self.assertIn(ACREDITACION, pendientes(self.raiz, manana))

        # Informe: el paso de orquestación consta con su diagnóstico en el Markdown y en el JSON.
        markdown = resultado.informe.read_text(encoding="utf-8")
        self.assertIn(f"### Lo que falló: Error de orquestación · {ACREDITACION}", markdown)
        self.assertIn("OrdenNoAdmitida", markdown)
        self.assertIn("unrecognized arguments: --aceptar-cambio", markdown)
        datos = json.loads(resultado.informe.with_suffix(".json").read_text(encoding="utf-8"))
        paso = next(p for p in datos["pasos"] if p["nombre"] == f"Error de orquestación · {ACREDITACION}")
        self.assertIn("OrdenNoAdmitida", paso["diagnostico"])
        self.assertNotIn(str(self.raiz), markdown + json.dumps(datos, ensure_ascii=False))

        # Panel: el módulo en rojo; la consulta remota sigue siendo la última real, sin un fallo que no ocurrió.
        self.assertTrue(FUENTES[ACREDITACION].red)
        panel = estado_panel(self.raiz, datetime.now(UTC))
        modulo = next(m for m in panel["modulos"] if m["id"] == ACREDITACION)
        self.assertEqual(modulo["veredicto"], actualizar.ROJO)
        fila = next(f for f in panel["seguimientoRemoto"] if f["fuente"] == ACREDITACION)
        self.assertEqual(fila["ultimoIntento"]["resultado"], "parcial")
        self.assertEqual(fila["ultimoIntento"]["inicioEn"], antes["fuentes"][ACREDITACION]["inicio_utc"])

    def reintentar_pendientes(self, instante: datetime) -> tuple[actualizar.ResultadoActualizacion, EjecutorDeModulos]:
        """Ejecuta `--pendientes` como si fuera `instante`, con el motor real y el ejecutor simulado.

        Returns:
            El resultado de la actualización y el ejecutor, con las órdenes que llegaron a ejecutarse.
        """
        base = EjecutorDeModulos()
        with reloj_en(instante), contextlib.redirect_stdout(io.StringIO()):
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(reintentar_pendientes=True, pausa=0, reintento=0), base
            )
        return resultado, base

    def comprobar_reintento_local(self, instante: datetime, consulta: dict) -> None:
        """`--pendientes` recompone la acreditación sin descargarla y sin tocar su consulta remota."""
        self.assertIn(ACREDITACION, pendientes(self.raiz, instante))
        self.assertNotIn(ACREDITACION, seguimiento.reintentos_remotos_vencidos(self.raiz, instante))
        resultado, base = self.reintentar_pendientes(instante)
        self.assertEqual(etapas_de(base, ACREDITACION), ["preparar", "validar"])
        self.assertEqual(resultado.resultados[ACREDITACION].veredicto, actualizar.VERDE)
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(documento["fuentes"][ACREDITACION]["ultimo_intento_remoto_utc"], consulta["ultimo"])
        self.assertEqual(documento["seguimiento_remoto"][ACREDITACION], consulta["seguimiento"])
        estado = leer_estado(self.raiz)[ACREDITACION]
        self.assertEqual((estado["veredicto"], estado["fallos_seguidos"]), (actualizar.VERDE, 0))
        datos = json.loads(resultado.informe.with_suffix(".json").read_text(encoding="utf-8"))
        self.assertIn(ACREDITACION, json.dumps(datos, ensure_ascii=False))
        panel = estado_panel(self.raiz, instante)
        modulo = next(m for m in panel["modulos"] if m["id"] == ACREDITACION)
        self.assertEqual(modulo["veredicto"], actualizar.VERDE)
        fila = next(f for f in panel["seguimientoRemoto"] if f["fuente"] == ACREDITACION)
        self.assertEqual(fila["ultimoIntento"]["inicioEn"], consulta["inicio"])

    def consulta_de(self, fuente: str) -> dict:
        """La última consulta remota registrada de la fuente.

        Returns:
            Su instante, su seguimiento y su inicio.
        """
        documento = registro.leer_registro(self.raiz)
        return {
            "ultimo": documento["fuentes"][fuente]["ultimo_intento_remoto_utc"],
            "seguimiento": documento["seguimiento_remoto"][fuente],
            "inicio": documento["fuentes"][fuente]["inicio_utc"],
        }

    def test_pendientes_reintenta_el_rechazo_en_local_sin_adelantar_la_consulta(self) -> None:
        """Tras una orden no admitida, `--pendientes` no descarga la fuente fuera de su cadencia."""
        consulta = self.consulta_de(ACREDITACION)
        with (
            mock.patch.object(lector_de(ACREDITACION), "main", main_sin_descarga),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            rechazo = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=(ACREDITACION,), pausa=0, reintento=0), EjecutorDeModulos()
            )
        self.assertIn("OrdenNoAdmitida", rechazo.resultados[ACREDITACION].motivo)
        self.comprobar_reintento_local(rechazo.comienzo + timedelta(days=1), consulta)

    def test_pendientes_reintenta_el_rojo_de_una_recomposicion_sin_consultar(self) -> None:
        """Un rojo de recomposición sin descarga tampoco concede una descarga con `--pendientes`."""
        consulta = self.consulta_de(ACREDITACION)

        class Averiado(EjecutorDeModulos):
            def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
                if etapa_de_fuente(orden) == (ACREDITACION, "preparar"):
                    raise RuntimeError("fallo interno simulado")
                return super().__call__(orden, area)

        opciones = actualizar.Opciones(solo=(ACREDITACION,), sin_descargar=(ACREDITACION,), pausa=0, reintento=0)
        with contextlib.redirect_stdout(io.StringIO()):
            rojo = actualizar.actualizar_con_resultado(self.raiz, opciones, Averiado())
        self.assertEqual(rojo.resultados[ACREDITACION].veredicto, actualizar.ROJO)
        self.assertEqual(leer_estado(self.raiz)[ACREDITACION]["fallos_seguidos"], 1)
        self.comprobar_reintento_local(rojo.comienzo + timedelta(days=1), consulta)

    def test_un_fallo_remoto_si_se_reintenta_con_descarga(self) -> None:
        """El registro de comprobaciones sigue concediendo la descarga tras un intento remoto fallido."""
        base = EjecutorDeModulos({ACREDITACION: "codigo"})
        with contextlib.redirect_stdout(io.StringIO()):
            fallido = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=(ACREDITACION,), pausa=0, reintento=0), base
            )
        self.assertEqual(etapas_de(base, ACREDITACION)[0], actualizar.ETAPA_DE_DESCARGA)
        manana = fallido.comienzo + timedelta(days=1)
        self.assertIn(ACREDITACION, seguimiento.reintentos_remotos_vencidos(self.raiz, manana))
        resultado, reintento = self.reintentar_pendientes(manana)
        self.assertEqual(etapas_de(reintento, ACREDITACION), list(ETAPAS))
        self.assertEqual(resultado.resultados[ACREDITACION].veredicto, actualizar.VERDE)
        self.assertEqual(registro.leer_registro(self.raiz)["seguimiento_remoto"][ACREDITACION]["fallos_seguidos"], 0)

    def test_el_modulo_se_comprueba_entero_antes_de_descargar_un_catalogo(self) -> None:
        """Si FUNDAE no admite su «preparar», su descarga de catálogo no llega a ejecutarse ni a publicarse."""
        vigente = publicado(self.raiz)
        consulta = self.consulta_de(FUNDAE)
        base = EjecutorDeModulos()
        with (
            mock.patch.object(lector_de(FUNDAE), "main", main_que_rechaza(FUNDAE, "preparar")),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=(FUNDAE,), pausa=0, reintento=0), base
            )
        self.assertIn(FUNDAE, actualizar.FUENTES_CON_CATALOGO)
        fundae = resultado.resultados[FUNDAE]
        self.assertEqual(fundae.veredicto, actualizar.ROJO)
        self.assertIn("OrdenNoAdmitida", fundae.motivo)
        self.assertIn("fundae · preparar", fundae.motivo)
        self.assertEqual(etapas_de(base, FUNDAE), [])
        self.assertEqual(publicado(self.raiz)[FUNDAE], vigente[FUNDAE])
        self.assertEqual(self.consulta_de(FUNDAE), consulta)

    def test_una_orden_no_canonica_no_se_ejecuta_sin_registro(self) -> None:
        """Una etapa con parámetros que el lector admite pero que no son los suyos queda en rojo sin ejecutarse."""
        consulta = self.consulta_de(FUNDAE)
        construir = actualizar.parametros_de_etapa

        def con_depuracion(fuente: str, etapa: str) -> tuple[str, ...]:
            return (
                (*construir(fuente, etapa), "--depurar")
                if fuente == FUNDAE and etapa == "validar"
                else (construir(fuente, etapa))
            )

        base = EjecutorDeModulos()
        with (
            mock.patch.object(actualizar, "parametros_de_etapa", con_depuracion),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=(FUNDAE,), pausa=0, reintento=0), base
            )
        fundae = resultado.resultados[FUNDAE]
        self.assertEqual(fundae.veredicto, actualizar.ROJO)
        self.assertIn("no es la orden de su etapa", fundae.motivo)
        self.assertEqual(etapas_de(base, FUNDAE), [])
        self.assertEqual(self.consulta_de(FUNDAE), consulta)
        modulo = next(m for m in estado_panel(self.raiz, datetime.now(UTC))["modulos"] if m["id"] == FUNDAE)
        self.assertEqual(modulo["veredicto"], actualizar.ROJO)


if __name__ == "__main__":
    unittest.main()
