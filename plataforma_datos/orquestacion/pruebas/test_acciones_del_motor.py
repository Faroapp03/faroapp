"""Las acciones del motor: la lista cerrada, su traducción a opciones y el plan que da cada una.

Las tres acciones que ya existían deben dar exactamente el mismo plan; «comprobar-vencidas» es la programada con su
propio modo en el registro de comprobaciones, y «actualizar-cursos» fuerza solo los cursos que se leen a diario.
"""

import io
import json
import os
import re
import tempfile
import typing
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import actualizar, candidato, comprobaciones_remotas, seleccion_por_tema
from plataforma_datos.orquestacion import almacen_trabajos as trabajos
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.estado_panel import EstadoPanelInvalido
from plataforma_datos.orquestacion.modulos import MODULOS, PAQUETE
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS, Plan, planificar
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import publicado
from plataforma_datos.orquestacion.pruebas.test_candidato import EjecutorCandidato, preparar

AHORA = datetime(2026, 11, 22, 4, 15, tzinfo=UTC)
SOLICITUD = "12345678-1234-4234-8234-123456789abc"
ESTADO_TRABAJOS = RAIZ / "src" / "administracion" / "estado-trabajos.js"
CURSOS_DIARIOS = (
    "formacion",
    "consorci",
    "citilab",
    "barcelonactiva",
    "fundae",
    "hp_life",
    "cibervoluntarios",
    "claude_academy",
    "enlaces",
)
# Lo que lee de la selección y se recompone sin descarga cuando ella publica una versión nueva.
CONSUMIDORES_DE_CURSOS = ("acreditacion", "nombres", "perfiles", "certificados2016")
CURSOS_NO_DIARIOS = ("agencia", "acreditacion", "abierta", "certificados2016", "actic", "memoria")
# Lo que el motor recibía de cada acción antes de admitir las dos nuevas, escrito a mano para compararlo.
OPCIONES_DE_ANTES = {
    "actualizar-datos": actualizar.Opciones(forzar_comprobaciones=True),
    "reintentar-pendientes": actualizar.Opciones(reintentar_pendientes=True),
    "comprobar-programada": actualizar.Opciones(programada=True),
}


def acciones_del_servidor() -> tuple[str, ...]:
    """Lee la lista cerrada ACCIONES_TRABAJO del contrato del servidor, sin ejecutarlo.

    Returns:
        Las acciones en el orden en que las declara el servidor.

    Raises:
        AssertionError: Si el servidor deja de declarar la lista donde esta prueba la busca.
    """
    texto = ESTADO_TRABAJOS.read_text(encoding="utf-8")
    bloque = re.search(r"export const ACCIONES_TRABAJO = Object\.freeze\((.*?)\);", texto, re.DOTALL)
    if bloque is None:
        raise AssertionError("El servidor no declara ACCIONES_TRABAJO donde lo busca esta prueba")
    return tuple(re.findall(r"'([a-z-]+)'", bloque.group(1).split("[", 1)[1]))


def plan_registrado(*, forzar: bool) -> Plan:
    """Un plan real del planificador: cada conjunto se intentó hace tres días, sin fallos.

    Returns:
        El plan programado (solo lo vencido) o el forzado, que recompone todos los módulos.
    """
    intentos = {conjunto.id: AHORA - timedelta(days=3) for conjunto in CONJUNTOS}
    recomponer = tuple(modulo.id for modulo in MODULOS) if forzar else ()
    return planificar(AHORA, intentos, forzar=forzar, recomponer=recomponer)


def seleccion_de_antes(opciones: actualizar.Opciones, plan: Plan) -> actualizar.Opciones:
    """La selección con plan tal como la calculaba el motor sin acotar el plan.

    Returns:
        Las opciones con los módulos del plan y sin descarga para las fuentes que el plan no consulta.
    """
    locales = tuple(fuente for fuente in FUENTES if fuente not in plan.fuentes)
    return opciones._replace(solo=plan.modulos, sin_descargar=tuple(dict.fromkeys((*opciones.sin_descargar, *locales))))


def seleccion(opciones: actualizar.Opciones, *, pendiente: bool = False) -> actualizar.Opciones | None:
    """La selección que calcula el motor con el plan real del registro de prueba.

    Args:
        opciones: Las opciones de la acción.
        pendiente: Si el registro pide recomponer todos los módulos tras un ciclo sin paquete preparado.

    Returns:
        Las opciones seleccionadas, o None si no hay trabajo.
    """
    with (
        mock.patch.object(
            actualizar, "plan_desde_registro", side_effect=lambda _r, _a, forzar=False: plan_registrado(forzar=forzar)
        ),
        mock.patch.object(seleccion_por_tema, "leer_registro", return_value={"reconstruccion_pendiente": pendiente}),
        redirect_stdout(io.StringIO()),
    ):
        return actualizar._opciones_programadas(Path(), opciones, AHORA)


def etapas_ejecutadas(ejecutor: EjecutorCandidato) -> dict[str, set[str]]:
    """Las etapas de cada fuente que ha pedido el motor.

    Returns:
        Por fuente, el conjunto de etapas ejecutadas.
    """
    etapas: dict[str, set[str]] = {}
    for orden in ejecutor.ordenes:
        if (etapa := etapa_de_fuente(orden)) is not None:
            etapas.setdefault(etapa[0], set()).add(etapa[1])
    return etapas


def admitido_por_el_almacen(recibo: dict) -> dict:
    """Pasa el recibo, completado como lo hace el ejecutor operativo, por el lector del almacén.

    Returns:
        El recibo leído por el almacén.
    """
    cuerpo = {**recibo, "solicitudId": SOLICITUD, "revisionReserva": 1}
    return trabajos._recibo(json.dumps(cuerpo, ensure_ascii=False, separators=(",", ":")).encode())


class ListaCerradaDeAcciones(unittest.TestCase):
    """El motor, el servidor y la línea de órdenes admiten las mismas acciones, y nada más."""

    def test_coincide_con_el_servidor(self) -> None:
        """La lista del motor y la del servidor son la misma, en el mismo orden."""
        self.assertEqual(trabajos.ACCIONES, acciones_del_servidor())
        self.assertEqual(typing.get_args(candidato.Accion.__value__), trabajos.ACCIONES)

    def test_una_accion_desconocida_se_rechaza(self) -> None:
        """Una acción fuera de la lista no llega al motor ni a un recibo admitido."""
        with mock.patch.object(actualizar, "actualizar_con_resultado") as motor:
            with self.assertRaises(EstadoPanelInvalido):
                candidato.ejecutar_candidato(Path(), "actualizar-todo")  # type: ignore[arg-type]
            with self.assertRaises(SystemExit), mock.patch("sys.stderr"):
                candidato.main(["actualizar-todo", "raiz", "--recibo", "recibo.json"])
        motor.assert_not_called()
        recibo = {**candidato._recibo("comprobar-programada", "sin-pendientes", None), "accion": "actualizar-todo"}
        with self.assertRaises(trabajos.AlmacenTrabajoInvalido):
            admitido_por_el_almacen(recibo)


class AccionesExistentes(unittest.TestCase):
    """Las tres acciones que ya existían dan las mismas opciones, el mismo plan y el mismo modo de ciclo."""

    def test_mismas_opciones(self) -> None:
        """La traducción de cada acción existente es idéntica a la de antes, también con el paquete pendiente."""
        for accion, antes in OPCIONES_DE_ANTES.items():
            with self.subTest(accion=accion):
                self.assertEqual(candidato.opciones_de_la_accion(accion), antes)
        self.assertEqual(
            candidato.opciones_de_la_accion("comprobar-programada", revisar_paquete_pendiente=True),
            actualizar.Opciones(programada=True, revisar_paquete_pendiente=True),
        )

    def test_mismo_plan(self) -> None:
        """Con el mismo registro, el plan de la programada y el de la búsqueda forzada no cambian."""
        for accion, forzar in (("comprobar-programada", False), ("actualizar-datos", True)):
            with self.subTest(accion=accion):
                opciones = candidato.opciones_de_la_accion(accion)
                self.assertEqual(seleccion(opciones), seleccion_de_antes(opciones, plan_registrado(forzar=forzar)))

    def test_mismo_plan_de_los_reintentos(self) -> None:
        """Los reintentos siguen eligiendo por sus vencimientos y nunca pasan por el plan del registro."""
        opciones = candidato.opciones_de_la_accion("reintentar-pendientes")
        with (
            mock.patch.object(actualizar, "reintentos_remotos_vencidos", return_value=("formacion",)),
            mock.patch.object(actualizar, "pendientes", return_value=("memoria", "formacion")),
            mock.patch.object(actualizar, "plan_desde_registro", side_effect=AssertionError("no se planifica")),
        ):
            elegidas = actualizar._opciones_programadas(Path(), opciones, AHORA)
        sin_consulta = tuple(fuente for fuente in ("memoria",) if FUENTES[fuente].red)
        self.assertEqual(elegidas, opciones._replace(solo=("formacion", "memoria"), sin_descargar=sin_consulta))

    def test_mismo_modo_del_ciclo(self) -> None:
        """El ciclo se anota como antes: «programada» solo para la programada y «manual» para las demás."""
        for accion, antes in OPCIONES_DE_ANTES.items():
            with self.subTest(accion=accion):
                modo = "programada" if antes.programada else "manual"
                self.assertEqual(seleccion_por_tema.modo_del_ciclo(candidato.opciones_de_la_accion(accion)), modo)

    def test_la_programada_no_admite_otra_seleccion(self) -> None:
        """La programada decide sola qué ha vencido; la búsqueda forzada se acota solo a módulos que existen."""
        for opciones in (
            actualizar.Opciones(solo=("formacion",), programada=True),
            actualizar.Opciones(solo=(), forzar_comprobaciones=True),
            actualizar.Opciones(solo=("inexistente",), forzar_comprobaciones=True),
            actualizar.Opciones(a_demanda=True),
            actualizar.Opciones(a_demanda=True, forzar_comprobaciones=True),
            actualizar.Opciones(a_demanda=1, programada=True),  # type: ignore[arg-type]
        ):
            with self.subTest(opciones=opciones), self.assertRaises(ValueError):
                actualizar.actualizar_con_resultado(Path(tempfile.gettempdir()), opciones, mock.Mock())


class ComprobarVencidas(unittest.TestCase):
    """«comprobar-vencidas» selecciona lo mismo que la programada y se anota con su propio nombre."""

    def test_mismo_plan_que_la_programada(self) -> None:
        """Las opciones solo difieren en a_demanda, y la selección es la misma."""
        vencidas = candidato.opciones_de_la_accion("comprobar-vencidas")
        programada = candidato.opciones_de_la_accion("comprobar-programada")
        self.assertEqual(vencidas, programada._replace(a_demanda=True))
        self.assertEqual(seleccion(vencidas), seleccion(programada)._replace(a_demanda=True))
        self.assertEqual(seleccion_por_tema.modo_del_ciclo(vencidas), "vencidas")

    def test_sin_trabajo_da_un_recibo_admitido(self) -> None:
        """Sin nada vencido termina sin pendientes, con su propio nombre, y el almacén lo admite."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal) / "repositorio"
            preparar(raiz)
            with (
                mock.patch.object(actualizar, "plan_desde_registro", return_value=Plan((), (), ())),
                mock.patch.dict(os.environ, {"FARO_AVISO": ""}),
            ):
                recibo = candidato.ejecutar_candidato(raiz, "comprobar-vencidas", EjecutorCandidato())
            self.assertEqual((recibo["accion"], recibo["resultado"]), ("comprobar-vencidas", "sin-pendientes"))
            self.assertEqual(admitido_por_el_almacen(recibo)["accion"], "comprobar-vencidas")

    def test_el_registro_anota_el_ciclo_como_vencidas(self) -> None:
        """El ciclo del registro de comprobaciones dice «vencidas», no «programada»."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal) / "repositorio"
            preparar(raiz)
            plan = Plan(("citilab",), ("citilab",), ())
            with (
                mock.patch.object(actualizar, "plan_desde_registro", return_value=plan),
                mock.patch.object(actualizar.time, "sleep"),
                mock.patch.dict(os.environ, {"FARO_AVISO": ""}),
            ):
                recibo = candidato.ejecutar_candidato(raiz, "comprobar-vencidas", EjecutorCandidato())
            self.assertEqual(recibo["resultado"], "validado")
            self.assertEqual(admitido_por_el_almacen(recibo)["accion"], "comprobar-vencidas")
            self.assertEqual(comprobaciones_remotas.leer_registro(raiz)["ultimo_ciclo"]["modo"], "vencidas")


class ActualizarCursos(unittest.TestCase):
    """«actualizar-cursos» fuerza las fuentes de cursos diarias; lo demás conserva su versión publicada."""

    def test_seleccion_de_las_fichas(self) -> None:
        """Entran los cursos de cadencia diaria; quedan fuera los demás cursos y los otros temas."""
        self.assertEqual(seleccion_por_tema.modulos_de_cursos_diarios(), CURSOS_DIARIOS)
        self.assertEqual(seleccion_por_tema.MODULOS_DE_CURSOS_DIARIOS, CURSOS_DIARIOS)
        for fuera in (*CURSOS_NO_DIARIOS, "esco", "cataluna", "lecturas", "datos_globales"):
            self.assertNotIn(fuera, CURSOS_DIARIOS)

    def test_plan_acotado(self) -> None:
        """La búsqueda forzada solo consulta y recompone la selección; sin selección el plan no cambia."""
        forzado = plan_registrado(forzar=True)
        self.assertIs(seleccion_por_tema.acotar_plan(Path(), forzado, None), forzado)
        elegidas = seleccion(candidato.opciones_de_la_accion("actualizar-cursos"))
        self.assertIsNotNone(elegidas)
        self.assertEqual(elegidas.solo, CURSOS_DIARIOS)
        consultadas = [fuente for fuente in FUENTES if fuente not in elegidas.sin_descargar]
        self.assertEqual(consultadas, [f for f in forzado.fuentes if f in CURSOS_DIARIOS])
        self.assertEqual(seleccion_por_tema.modo_del_ciclo(elegidas), "manual")

    def test_recomposicion_pendiente(self) -> None:
        """Con una recomposición pendiente se recomponen todos los módulos, pero solo se descargan los cursos."""
        elegidas = seleccion(candidato.opciones_de_la_accion("actualizar-cursos"), pendiente=True)
        self.assertIsNotNone(elegidas)
        self.assertEqual(elegidas.solo, plan_registrado(forzar=True).modulos)
        consultadas = {fuente for fuente in FUENTES if fuente not in elegidas.sin_descargar}
        self.assertLessEqual(consultadas, set(CURSOS_DIARIOS))
        self.assertTrue(consultadas)

    def test_ciclo_parcial_admitido(self) -> None:
        """Descarga solo los cursos diarios, recompone sus consumidores, conserva lo demás y pasa la admisión."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal) / "repositorio"
            preparar(raiz)
            antes = publicado(raiz)
            ejecutor = EjecutorCandidato()
            with mock.patch.object(actualizar.time, "sleep"), mock.patch.dict(os.environ, {"FARO_AVISO": ""}):
                recibo = candidato.ejecutar_candidato(raiz, "actualizar-cursos", ejecutor)
            despues = publicado(raiz)
            self.assertEqual(
                (recibo["accion"], recibo["resultado"], recibo["veredicto"]), ("actualizar-cursos", "validado", "verde")
            )
            self.assertEqual(admitido_por_el_almacen(recibo)["huellaPaquete"], recibo["huellaPaquete"])
            etapas = etapas_ejecutadas(ejecutor)
            ejecutados = {modulo.id for modulo in MODULOS if set(modulo.fuentes) & set(etapas)}
            self.assertEqual(ejecutados, {*CURSOS_DIARIOS, *CONSUMIDORES_DE_CURSOS})
            descargadas = {fuente for fuente, hechas in etapas.items() if "descargar" in hechas}
            self.assertLessEqual(descargadas, set(CURSOS_DIARIOS))
            self.assertFalse(descargadas & set(CONSUMIDORES_DE_CURSOS))
            for modulo in MODULOS:
                with self.subTest(modulo=modulo.id):
                    cambia = despues[modulo.id] != antes[modulo.id]
                    self.assertEqual(cambia, modulo.id in ejecutados)
            self.assertNotEqual(despues[PAQUETE], antes[PAQUETE])


if __name__ == "__main__":
    unittest.main()
