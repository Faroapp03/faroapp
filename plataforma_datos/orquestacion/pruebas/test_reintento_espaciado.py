"""Cuándo se vuelve a consultar una fuente: cadencia tras un éxito y espera escalonada tras un fallo o un corte.

Recorre las piezas reales: motor de actualización con ejecutor simulado, registro de comprobaciones, planificación,
selección de pendientes, estado.json y la instantánea del panel. Ninguna prueba usa la red.
"""

import contextlib
import hashlib
import io
import json
import os
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import contrato
from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import lector as enlaces
from plataforma_datos.biblioteca.pruebas.test_enlaces_lecturas import AHORA, HTML, URL
from plataforma_datos.comun.nucleo import ERRORES_CON_MOTIVO, Carpetas, FormatoInesperado
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion import seguimiento_de_comprobaciones as seguimiento
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.estado_de_la_actualizacion import leer_estado
from plataforma_datos.orquestacion.estado_panel import estado_panel
from plataforma_datos.orquestacion.modulos import MODULOS, carpetas
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS, planificar
from plataforma_datos.orquestacion.pruebas.ayudas import Corte
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import EjecutorDeModulos, publicado
from plataforma_datos.orquestacion.pruebas.test_candidato import preparar

ACREDITACION, ENLACES = "acreditacion", "enlaces_lecturas"
REMOTAS = tuple(dict.fromkeys(c.fuente for c in CONJUNTOS if c.operacion == "descargar"))


def conjuntos_de(fuente: str) -> tuple[str, ...]:
    """Conjuntos registrados de una fuente.

    Returns:
        Sus IDs en el orden del planificador.
    """
    return tuple(c.id for c in CONJUNTOS if c.fuente == fuente)


def ciclo_remoto(raiz: Path, instante: datetime, resultados: dict[str, str]) -> None:
    """Registra un ciclo con un intento remoto por fuente; «corte» deja la fila abierta como un proceso muerto."""
    ciclo = registro.iniciar_ciclo(raiz, instante, "programada")
    abiertas = False
    for fuente, resultado in resultados.items():
        registro.iniciar_fuente(raiz, ciclo, fuente, conjuntos_de(fuente), instante, remoto=True)
        if resultado == "corte":
            abiertas = True
            continue
        registro.terminar_fuente(raiz, ciclo, fuente, instante, resultado=resultado, evidencia=None)
    if not abiertas:
        registro.cerrar_ciclo(raiz, ciclo, instante, resultado="preparado", paquete_preparado=True)


def descargadas(ejecutor: EjecutorDeModulos) -> set[str]:
    """Fuentes cuya etapa de descarga llegó a ejecutarse.

    Returns:
        Los IDs de fuente descargados por el ejecutor simulado.
    """
    return {
        identificada[0]
        for orden in ejecutor.ordenes
        if (identificada := etapa_de_fuente(orden)) is not None and identificada[1] == "descargar"
    }


class PlanConEsperaEscalonada(unittest.TestCase):
    """La regla pura: nunca más tarde que la cadencia y cada fuente con su propia cuenta."""

    AHORA = datetime(2026, 10, 1, 9, tzinfo=UTC)

    def vencidas(self, dias: int, fallos: dict[str, int]) -> set[str]:
        """Planifica `dias` después de un intento de las dos fuentes semanales; el resto, recién consultado.

        Returns:
            Las fuentes semanales del caso que el plan permite descargar.
        """
        intentos = {c: self.AHORA for f in (ACREDITACION, ENLACES) for c in conjuntos_de(f)}
        por_conjunto = {c: n for f, n in fallos.items() for c in conjuntos_de(f)}
        otros = {c.id: self.AHORA + timedelta(days=dias) for c in CONJUNTOS if c.id not in intentos}
        plan = planificar(self.AHORA + timedelta(days=dias), {**intentos, **otros}, fallos_seguidos=por_conjunto)
        return set(plan.fuentes) & {ACREDITACION, ENLACES}

    def test_exito_espera_cadencia_y_fallos_escalonados_sin_superarla(self) -> None:
        """Siete días tras un éxito; 1, 2, 4 y 7 (no 8) días tras 1, 2, 3 y 4 fallos seguidos."""
        self.assertEqual(self.vencidas(6, {}), set())
        self.assertEqual(self.vencidas(7, {}), {ACREDITACION, ENLACES})
        for fallos, espera in ((1, 1), (2, 2), (3, 4), (4, 7), (9, 7)):
            with self.subTest(fallos=fallos):
                self.assertEqual(self.vencidas(espera - 1, {ACREDITACION: fallos}), set())
                self.assertIn(ACREDITACION, self.vencidas(espera, {ACREDITACION: fallos}))

    def test_fallo_de_una_fuente_no_mueve_otra(self) -> None:
        """El fallo de acreditación adelanta solo su consulta; Biblioteca conserva su cadencia."""
        self.assertEqual(self.vencidas(1, {ACREDITACION: 1}), {ACREDITACION})
        self.assertEqual(self.vencidas(7, {ACREDITACION: 1}), {ACREDITACION, ENLACES})


class ReintentoDesdeElRegistro(unittest.TestCase):
    """Registro → planificación → selección, con el motor real y un ejecutor simulado."""

    def setUp(self) -> None:
        """Instalación temporal propia, sin pausas ni orden de aviso."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve()
        preparar(self.raiz)
        self.enterContext(mock.patch.object(actualizar.time, "sleep"))
        self.enterContext(mock.patch.dict(os.environ, {"FARO_AVISO": ""}))
        self.hoy = datetime.now(UTC).replace(microsecond=0)
        # Todas las fuentes remotas, consultadas con éxito hace una semana menos un día.
        self.antes = self.hoy - timedelta(days=6)
        ciclo_remoto(self.raiz, self.antes, dict.fromkeys(REMOTAS, "parcial"))

    def ejecutar(self, opciones: actualizar.Opciones, ejecutor: EjecutorDeModulos) -> actualizar.ResultadoActualizacion:
        """Ejecuta el motor real sin pausas.

        Returns:
            El resultado estructurado de la actualización.
        """
        with contextlib.redirect_stdout(io.StringIO()):
            return actualizar.actualizar_con_resultado(self.raiz, opciones._replace(pausa=0, reintento=0), ejecutor)

    def intento(self, fuente: str = ACREDITACION) -> datetime:
        """El último intento remoto registrado: la base de los plazos de cada caso.

        Returns:
            Su instante UTC.
        """
        fila = registro.leer_registro(self.raiz)["fuentes"][fuente]
        return datetime.fromisoformat(fila["ultimo_intento_remoto_utc"])

    def plan(self, dias: int) -> set[str]:
        """Las dos fuentes semanales del caso que el plan permite descargar `dias` después de la base.

        Returns:
            El subconjunto de {acreditacion, enlaces_lecturas} seleccionado.
        """
        fuentes = seguimiento.plan_desde_registro(self.raiz, self.base + timedelta(days=dias)).fuentes
        return set(fuentes) & {ACREDITACION, ENLACES}

    def test_fallo_real_de_acreditacion_se_reintenta_al_dia_siguiente_y_biblioteca_sigue_su_cadencia(self) -> None:
        """Un fallo de etapa vuelve a planificarse en un día, en dos tras el segundo; el éxito vuelve a siete."""
        primero = EjecutorDeModulos({ACREDITACION: "codigo"})
        resultado = self.ejecutar(actualizar.Opciones(solo=(ACREDITACION, ENLACES)), primero)
        self.assertEqual(resultado.resultados[ACREDITACION].veredicto, "ámbar")
        self.assertEqual(resultado.resultados[ENLACES].veredicto, "verde")
        self.base = self.intento(ENLACES)
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(documento["fuentes"][ACREDITACION]["resultado"], "fallo")
        self.assertEqual(documento["seguimiento_remoto"][ACREDITACION]["fallos_seguidos"], 1)
        self.assertEqual(documento["seguimiento_remoto"][ENLACES]["fallos_seguidos"], 0)
        self.assertEqual(self.plan(0), set())
        self.assertIn(ACREDITACION, self.plan(1))
        self.assertNotIn(ENLACES, self.plan(6))
        self.assertIn(ENLACES, self.plan(7))
        # El panel lee el mismo registro sin contradicción: el último intento remoto es el fallo.
        panel = estado_panel(self.raiz, datetime.now(UTC))
        fila = next(f for f in panel["seguimientoRemoto"] if f["fuente"] == ACREDITACION)
        self.assertEqual(fila["ultimoIntento"]["resultado"], "fallo")
        modulo = next(m for m in panel["modulos"] if m["id"] == ACREDITACION)
        self.assertEqual((modulo["veredicto"], modulo["fallos"]), ("ámbar", 1))
        # Segundo fallo al día siguiente: espera de dos días; luego un éxito devuelve la cadencia.
        segundo = self.base + timedelta(days=1)
        ciclo_remoto(self.raiz, segundo, {ACREDITACION: "fallo"})
        self.assertEqual(registro.leer_registro(self.raiz)["seguimiento_remoto"][ACREDITACION]["fallos_seguidos"], 2)
        self.assertNotIn(ACREDITACION, self.plan(2))
        self.assertIn(ACREDITACION, self.plan(3))
        ciclo_remoto(self.raiz, self.base + timedelta(days=3), {ACREDITACION: "parcial"})
        self.assertNotIn(ACREDITACION, self.plan(9))
        self.assertIn(ACREDITACION, self.plan(10))

    def test_corte_cuenta_como_fallo_y_la_recuperacion_es_coherente(self) -> None:
        """Un corte deja lo publicado intacto, su intento cuenta para el reintento y el ciclo siguiente lo cierra."""
        # Un corte conserva el área a propósito: se crea en una carpeta de la prueba para no dejarla en TMPDIR.
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.enterContext(mock.patch.object(tempfile, "tempdir", carpeta.name))
        vigente = publicado(self.raiz)
        estado_previo = leer_estado(self.raiz)

        class Cortado(EjecutorDeModulos):
            def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
                identificada = etapa_de_fuente(orden)
                if identificada == (ACREDITACION, "preparar"):
                    raise Corte("proceso detenido")
                return super().__call__(orden, area)

        with self.assertRaises(Corte):
            self.ejecutar(actualizar.Opciones(solo=(ACREDITACION,)), Cortado())
        self.assertEqual(publicado(self.raiz), vigente)
        self.assertEqual(leer_estado(self.raiz), estado_previo)
        self.base = self.intento()
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(documento["fuentes"][ACREDITACION]["resultado"], "en-curso")
        self.assertEqual(registro.fallos_remotos_seguidos(documento, ACREDITACION), 1)
        # Planificación y --pendientes ven el corte como un fallo: reintento al día siguiente, no a la semana.
        self.assertNotIn(ACREDITACION, self.plan(0))
        self.assertIn(ACREDITACION, self.plan(1))
        pendientes = actualizar._opciones_programadas(
            self.raiz, actualizar.Opciones(reintentar_pendientes=True), self.base + timedelta(days=1)
        )
        self.assertEqual(pendientes.solo, (ACREDITACION,))
        self.assertIsNone(
            actualizar._opciones_programadas(self.raiz, actualizar.Opciones(reintentar_pendientes=True), self.base)
        )
        # El ciclo siguiente recupera: marca «interrumpido», cuenta un fallo y vuelve a consultar con éxito.
        resultado = self.ejecutar(actualizar.Opciones(solo=(ACREDITACION,)), EjecutorDeModulos())
        self.assertEqual(resultado.resultados[ACREDITACION].veredicto, "verde")
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(documento["fuentes"][ACREDITACION]["resultado"], "parcial")
        self.assertEqual(documento["seguimiento_remoto"][ACREDITACION]["fallos_seguidos"], 0)
        self.assertEqual(list((self.raiz / actualizar.CARPETA_DE_INFORMES).glob("diario-*.json")), [])
        estado_panel(self.raiz, datetime.now(UTC))

    def test_recomposicion_local_no_toca_intento_ni_reintento(self) -> None:
        """Recomponer sin descargar no borra el ámbar ni mueve el reintento de estado.json ni el intento remoto."""
        self.ejecutar(actualizar.Opciones(solo=(ACREDITACION,)), EjecutorDeModulos({ACREDITACION: "codigo"}))
        estado = leer_estado(self.raiz)[ACREDITACION]
        self.assertEqual((estado["veredicto"], estado["fallos_seguidos"]), ("ámbar", 1))
        remoto = registro.leer_registro(self.raiz)["fuentes"][ACREDITACION]["ultimo_intento_remoto_utc"]
        self.base = self.intento()

        class SinCambios(EjecutorDeModulos):
            def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
                if etapa_de_fuente(orden) == (ACREDITACION, "preparar"):
                    self.ordenes.append(orden)
                    return actualizar.Resultado(0, "")
                return super().__call__(orden, area)

        local = SinCambios()
        resultado = self.ejecutar(
            actualizar.Opciones(solo=(ACREDITACION,), sin_descargar=tuple(actualizar.FUENTES)), local
        )
        self.assertEqual(descargadas(local), set())
        self.assertEqual(resultado.resultados[ACREDITACION].veredicto, "verde")
        self.assertEqual(leer_estado(self.raiz)[ACREDITACION], estado)
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(documento["fuentes"][ACREDITACION]["ultimo_intento_remoto_utc"], remoto)
        self.assertEqual(documento["seguimiento_remoto"][ACREDITACION]["fallos_seguidos"], 1)
        modulo = next(m for m in estado_panel(self.raiz, datetime.now(UTC))["modulos"] if m["id"] == ACREDITACION)
        self.assertEqual(modulo["proximoReintento"], estado["proximo_reintento_utc"].replace("+00:00", "Z"))
        self.assertIn(ACREDITACION, self.plan(1))

    def test_recomposicion_que_publica_registra_la_version_y_el_reintento_sigue_en_comprobaciones(self) -> None:
        """Una versión nueva publicada sin descarga consta en estado.json; la consulta fallida sigue pendiente."""
        self.ejecutar(actualizar.Opciones(solo=(ACREDITACION,)), EjecutorDeModulos({ACREDITACION: "codigo"}))
        self.base = self.intento()
        resultado = self.ejecutar(
            actualizar.Opciones(solo=(ACREDITACION,), sin_descargar=tuple(actualizar.FUENTES)), EjecutorDeModulos()
        )
        self.assertIsNotNone(resultado.resultados[ACREDITACION].publicado)
        self.assertEqual(leer_estado(self.raiz)[ACREDITACION]["veredicto"], "verde")
        self.assertIn(ACREDITACION, self.plan(1))
        self.assertEqual(
            seguimiento.reintentos_remotos_vencidos(self.raiz, self.base + timedelta(days=1)), (ACREDITACION,)
        )
        estado_panel(self.raiz, datetime.now(UTC))


class CapturasDeUnCicloFallido(unittest.TestCase):
    """Biblioteca y acreditación: lo publicado intacto, intento fallido registrado y capturas conservadas."""

    def setUp(self) -> None:
        """Instalación temporal propia, sin pausas ni orden de aviso."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve()
        preparar(self.raiz)
        self.enterContext(mock.patch.object(actualizar.time, "sleep"))
        self.enterContext(mock.patch.dict(os.environ, {"FARO_AVISO": ""}))

    def ejecutar(self, ejecutor: EjecutorDeModulos, *solo: str) -> actualizar.ResultadoActualizacion:
        """Ejecuta el motor real sobre la selección dada, sin pausas.

        Returns:
            El resultado estructurado de la actualización.
        """
        with contextlib.redirect_stdout(io.StringIO()):
            return actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=solo, pausa=0, reintento=0), ejecutor
            )

    def capturador(self, fallar: str) -> EjecutorDeModulos:
        """Descarga escribe capturas por huella; la etapa `fallar` termina con código 1.

        Returns:
            Ejecutor simulado de módulos con esa conducta para Biblioteca y acreditación.
        """

        class Capturador(EjecutorDeModulos):
            def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
                identificada = etapa_de_fuente(orden)
                if identificada is not None and identificada[0] in (ENLACES, ACREDITACION):
                    fuente, etapa = identificada
                    originales = area / f"var/actualizacion/originales/{fuente}"
                    if etapa == "descargar":
                        (originales / "capturas").mkdir(parents=True, exist_ok=True)
                        (originales / "capturas" / "a.json").write_text('{"captura": 1}', encoding="utf-8")
                        (originales / "cuerpos").mkdir(exist_ok=True)
                        (originales / "cuerpos" / "b").write_bytes(b"cuerpo")
                    if etapa == fallar:
                        self.ordenes.append(orden)
                        return actualizar.Resultado(1, "")
                return super().__call__(orden, area)

        return Capturador()

    def test_fallo_de_etapa_conserva_lo_publicado_registra_el_fallo_y_retiene_capturas_sin_duplicar(self) -> None:
        """Preparar (Biblioteca) o descargar (acreditación) fallan: nada se publica y la evidencia queda aparte."""
        vigente = publicado(self.raiz)
        for fuente, etapa in ((ENLACES, "preparar"), (ACREDITACION, "descargar")):
            with self.subTest(fuente=fuente):
                resultado = self.ejecutar(self.capturador(etapa), fuente)
                self.assertEqual(resultado.resultados[fuente].veredicto, "ámbar")
                self.assertEqual(publicado(self.raiz)[fuente], vigente[fuente])
                self.assertFalse((self.raiz / f"var/actualizacion/originales/{fuente}").exists())
                estado = leer_estado(self.raiz)[fuente]
                self.assertIn("capturas no admitidas conservadas", estado["motivo"])
                self.assertEqual(estado["fallos_seguidos"], 1)
                documento = registro.leer_registro(self.raiz)
                self.assertEqual(documento["fuentes"][fuente]["resultado"], "fallo")
                self.assertNotIn(fuente, documento["conjuntos"])
                carpeta = self.raiz / actualizar.CAPTURAS_NO_ADMITIDAS / fuente
                manifiestos = list((carpeta / "intentos").glob("*.json"))
                self.assertEqual(len(manifiestos), 1)
                manifiesto = json.loads(manifiestos[0].read_text(encoding="utf-8"))
                self.assertFalse(manifiesto["admitido"])
                self.assertEqual({a["ruta"] for a in manifiesto["archivos"]}, {"capturas/a.json", "cuerpos/b"})
                self.assertEqual(len(list((carpeta / "objetos").iterdir())), 2)
                # Repetir el mismo fallo no duplica los objetos ya conservados.
                self.ejecutar(self.capturador(etapa), fuente)
                self.assertEqual(len(list((carpeta / "objetos").iterdir())), 2)
                estado_panel(self.raiz, datetime.now(UTC))

    def temporales_propios(self) -> Path:
        """Desvía los temporales del motor a una carpeta de la prueba para observar qué queda en ella.

        Returns:
            La carpeta donde el motor crea su área y cualquier rescate.
        """
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.enterContext(mock.patch.object(tempfile, "tempdir", carpeta.name))
        return Path(carpeta.name)

    def test_capturas_que_no_se_pueden_conservar_se_rescatan_fuera_del_area(self) -> None:
        """Si la evidencia no se escribe, las capturas salen del área antes de restaurarla y la limpieza no las toca."""
        temporales = self.temporales_propios()
        vigente = publicado(self.raiz)
        salida = io.StringIO()
        fallo = OSError("disco lleno")
        with mock.patch.object(actualizar, "_guardar_si_falta", side_effect=fallo), contextlib.redirect_stdout(salida):
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=(ENLACES,), pausa=0, reintento=0), self.capturador("preparar")
            )
        self.assertEqual(resultado.resultados[ENLACES].veredicto, "ámbar")
        self.assertEqual(publicado(self.raiz)[ENLACES], vigente[ENLACES])
        motivo = leer_estado(self.raiz)[ENLACES]["motivo"]
        self.assertIn("no se pudieron conservar las capturas no admitidas: OSError", motivo)
        rescates = [ruta for ruta in temporales.iterdir() if ruta.name.startswith(f"faro-capturas-{ENLACES}-")]
        self.assertEqual(len(rescates), 1)
        self.assertIn(f"rescatadas en {rescates[0]}", motivo)
        self.assertIn(str(rescates[0]), salida.getvalue())
        self.assertEqual((rescates[0] / "originales" / "capturas" / "a.json").read_text(), '{"captura": 1}')
        self.assertEqual((rescates[0] / "originales" / "cuerpos" / "b").read_bytes(), b"cuerpo")
        # La limpieza final se lleva el área, no el rescate.
        self.assertEqual([ruta for ruta in temporales.iterdir() if ruta.name.startswith("faro-actualizacion-")], [])

    def test_tras_un_rescate_el_siguiente_intento_conserva_la_evidencia_y_lo_publicado(self) -> None:
        """Fallo de escritura → rescate; otro fallo → conservación normal; luego éxito. Nada se pierde."""
        temporales = self.temporales_propios()
        vigente = publicado(self.raiz)

        def huellas(carpeta: Path) -> dict[str, str]:
            return {
                ruta.relative_to(carpeta).as_posix(): hashlib.sha256(ruta.read_bytes()).hexdigest()
                for ruta in sorted(carpeta.rglob("*"))
                if ruta.is_file()
            }

        with mock.patch.object(actualizar, "_guardar_si_falta", side_effect=OSError("disco lleno")):
            primero = self.ejecutar(self.capturador("preparar"), ENLACES)
        self.assertEqual(primero.resultados[ENLACES].veredicto, "ámbar")
        self.assertEqual(publicado(self.raiz)[ENLACES], vigente[ENLACES])
        (rescate,) = [ruta for ruta in temporales.iterdir() if ruta.name.startswith(f"faro-capturas-{ENLACES}-")]
        rescatado = huellas(rescate)
        self.assertEqual(set(rescatado), {"originales/capturas/a.json", "originales/cuerpos/b"})
        self.assertEqual(leer_estado(self.raiz)[ENLACES]["fallos_seguidos"], 1)

        # Siguiente intento, ya con escritura: vuelve a fallar y su captura se conserva por la vía normal.
        segundo = self.ejecutar(self.capturador("preparar"), ENLACES)
        self.assertEqual(segundo.resultados[ENLACES].veredicto, "ámbar")
        self.assertEqual(publicado(self.raiz)[ENLACES], vigente[ENLACES])
        estado = leer_estado(self.raiz)[ENLACES]
        self.assertIn("capturas no admitidas conservadas", estado["motivo"])
        self.assertEqual(estado["fallos_seguidos"], 2)
        self.assertEqual(huellas(rescate), rescatado)

        # Un intento correcto publica y cierra la racha; el rescate sigue intacto.
        tercero = self.ejecutar(EjecutorDeModulos(), ENLACES)
        self.assertEqual(tercero.resultados[ENLACES].veredicto, "verde")
        self.assertEqual(leer_estado(self.raiz)[ENLACES]["fallos_seguidos"], 0)
        self.assertEqual(huellas(rescate), rescatado)
        self.assertEqual([ruta for ruta in temporales.iterdir() if ruta.name.startswith("faro-actualizacion-")], [])

    def test_capturas_sin_rescate_posible_detienen_y_conservan_el_area(self) -> None:
        """Si tampoco se pueden sacar del área, no se restaura: la ronda se detiene y el área guarda la única copia."""
        temporales = self.temporales_propios()
        vigente = publicado(self.raiz)
        with (
            mock.patch.object(actualizar, "_guardar_si_falta", side_effect=OSError("disco lleno")),
            mock.patch.object(actualizar.shutil, "move", side_effect=OSError("sin permiso")),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=(ENLACES,), pausa=0, reintento=0), self.capturador("preparar")
            )
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertEqual(publicado(self.raiz)[ENLACES], vigente[ENLACES])
        (area,) = (ruta / "repositorio" for ruta in temporales.iterdir() if ruta.name.startswith("faro-actualizacion-"))
        captura = area / f"var/actualizacion/originales/{ENLACES}/capturas/a.json"
        self.assertEqual(captura.read_text(), '{"captura": 1}')

    def test_limpieza_fallida_avisa_de_la_ruta_sin_cambiar_el_resultado(self) -> None:
        """Un área que no se deja borrar queda anunciada en la salida; el veredicto y el código son los mismos."""
        temporales = self.temporales_propios()
        esperado = self.ejecutar(self.capturador("ninguna"), ENLACES)
        borrar = actualizar.shutil.rmtree

        def borrar_salvo_el_area(ruta: Path, *args: object, **kwargs: object) -> None:
            if not Path(ruta).name.startswith("faro-actualizacion-"):
                borrar(ruta, *args, **kwargs)

        salida = io.StringIO()
        with mock.patch.object(actualizar.shutil, "rmtree", borrar_salvo_el_area), contextlib.redirect_stdout(salida):
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=(ENLACES,), pausa=0, reintento=0), self.capturador("ninguna")
            )
        self.assertEqual(resultado.codigo, esperado.codigo)
        self.assertEqual(resultado.resultados[ENLACES].veredicto, esperado.resultados[ENLACES].veredicto)
        (pendiente,) = (ruta for ruta in temporales.iterdir() if ruta.name.startswith("faro-actualizacion-"))
        self.assertIn(f"No se pudo borrar el área temporal {pendiente}", salida.getvalue())

    def test_recomposicion_sin_descarga_no_retiene_nada(self) -> None:
        """Sin descarga en el ciclo no hay capturas que conservar."""
        ejecutor = self.capturador("validar")
        with contextlib.redirect_stdout(io.StringIO()):
            actualizar.actualizar_con_resultado(
                self.raiz,
                actualizar.Opciones(solo=(ENLACES,), sin_descargar=(ENLACES,), pausa=0, reintento=0),
                ejecutor,
            )
        self.assertFalse((self.raiz / actualizar.CAPTURAS_NO_ADMITIDAS).exists())

    def test_las_capturas_retenidas_solo_son_evidencia(self) -> None:
        """Ningún módulo lee las capturas retenidas; su documentación no promete incorporarlas solas."""
        carpeta = Path(actualizar.__file__).parents[1]
        lectores = sorted(
            ruta.relative_to(carpeta).as_posix()
            for ruta in carpeta.rglob("*.py")
            if "pruebas" not in ruta.parts
            and ("CAPTURAS_NO_ADMITIDAS" in (texto := ruta.read_text(encoding="utf-8")) or "no-admitidas" in texto)
        )
        self.assertEqual(lectores, ["orquestacion/actualizar.py"])
        documentacion = " ".join(actualizar.retener_capturas.__doc__.split())
        self.assertNotIn("consulta posterior", documentacion)
        self.assertIn("evidencia conservada para auditar", documentacion)
        self.assertIn("a mano", documentacion)


class BibliotecaConfirmacionFalloRecuperacion(unittest.TestCase):
    """Lector real de enlaces dentro del motor: una confirmación sobrevive a un ciclo fallido y se vuelve a publicar."""

    def setUp(self) -> None:
        """Instalación temporal propia, sin pausas ni orden de aviso."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve()
        preparar(self.raiz)
        self.enterContext(mock.patch.object(actualizar.time, "sleep"))
        self.enterContext(mock.patch.dict(os.environ, {"FARO_AVISO": ""}))
        catalogo = self.raiz / "catalogo-sintetico.json"
        catalogo.write_text(json.dumps({"lecturas": [{"id": "lectura", "enlace": URL}]}), encoding="utf-8")
        self.enterContext(mock.patch.object(enlaces, "CATALOGO", catalogo))
        self.rutas = carpetas(next(m for m in MODULOS if m.id == ENLACES))
        original = self.raiz / self.rutas[0]
        original.mkdir(parents=True)
        (self.raiz / self.rutas[1]).mkdir(parents=True)
        identidad = {
            "url": URL,
            "url_final": URL,
            "cuerpo_sha256": contrato.hashlib.sha256(HTML).hexdigest(),
            "revisado_utc": (AHORA - timedelta(days=2)).isoformat(),
            "texto_sha256": None,
        }
        documento = {"version": 1, "decisiones": {"lectura:enlace": [identidad]}}
        (original / "identidades.json").write_text(json.dumps(documento), encoding="utf-8")

    def ciclo(self, reloj: datetime, *, respuesta: bool, preparar_falla: bool) -> actualizar.ResultadoActualizacion:
        """Un ciclo real del motor; solo la red se sustituye por una captura sintética con fecha `reloj`.

        Returns:
            El resultado estructurado de la actualización.
        """
        rutas = self.rutas
        resto = EjecutorDeModulos()

        def ejecutar(orden: list[str], area: Path) -> actualizar.Resultado:
            identificada = etapa_de_fuente(orden)
            if identificada is None or identificada[0] != ENLACES:
                return resto(orden, area)
            etapa = identificada[1]
            propias = Carpetas(*(area / ruta for ruta in rutas))
            with (
                mock.patch.object(enlaces, "carpetas", return_value=propias),
                mock.patch.object(enlaces, "ahora", return_value=reloj),
            ):
                try:
                    if etapa == "descargar":
                        captura = contrato.Captura(
                            url=URL,
                            url_final=URL if respuesta else None,
                            capturado_utc=reloj.isoformat(),
                            cuerpo_sha256=contrato.hashlib.sha256(HTML).hexdigest() if respuesta else None,
                            content_type="text/html" if respuesta else "",
                            resultado="respuesta" if respuesta else "fallo_temporal",
                            codigo_http=None,
                        )
                        enlaces.conservar(captura, HTML if respuesta else None)
                    elif etapa == "preparar":
                        if preparar_falla:
                            raise FormatoInesperado("preparación interrumpida")
                        enlaces.preparar()
                    else:
                        enlaces.validar()
                except ERRORES_CON_MOTIVO as error:
                    return actualizar.Resultado(1, str(error))
            return actualizar.Resultado(0, "")

        with contextlib.redirect_stdout(io.StringIO()):
            return actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(solo=(ENLACES,), pausa=0, reintento=0), ejecutar
            )

    def publicada(self) -> dict:
        """Lee el objetivo único de las observaciones publicadas.

        Returns:
            Su fila con último intento y última confirmación.
        """
        ruta = self.raiz / self.rutas[2] / enlaces.ARCHIVO
        return json.loads(ruta.read_text(encoding="utf-8"))["objetivos"][0]

    def test_confirmacion_fallo_y_recuperacion_conservan_la_fecha_confirmada(self) -> None:
        """Confirmada en T1; T2 falla al preparar (se retiene); T3 no responde y aún publica la confirmación de T1."""
        t1, t2, t3 = AHORA, AHORA + timedelta(hours=1), AHORA + timedelta(hours=2)
        self.assertEqual(self.ciclo(t1, respuesta=True, preparar_falla=False).resultados[ENLACES].veredicto, "verde")
        self.assertEqual(self.publicada()["ultima_confirmacion"]["capturado_utc"], t1.isoformat())
        antes = {
            p.relative_to(self.raiz): p.read_bytes() for p in (self.raiz / self.rutas[0]).rglob("*") if p.is_file()
        }

        fallido = self.ciclo(t2, respuesta=True, preparar_falla=True)
        self.assertEqual(fallido.resultados[ENLACES].veredicto, "ámbar")
        self.assertEqual(self.publicada()["ultima_confirmacion"]["capturado_utc"], t1.isoformat())
        despues = {
            p.relative_to(self.raiz): p.read_bytes() for p in (self.raiz / self.rutas[0]).rglob("*") if p.is_file()
        }
        self.assertEqual(despues, antes)
        manifiesto = next((self.raiz / actualizar.CAPTURAS_NO_ADMITIDAS / ENLACES / "intentos").glob("*.json"))
        retenidas = json.loads(manifiesto.read_text(encoding="utf-8"))["archivos"]
        self.assertTrue(any(a["ruta"].startswith("capturas/") for a in retenidas))
        self.assertFalse(any(a["ruta"].startswith("cuerpos/") for a in retenidas))  # mismo cuerpo ya publicado
        documento = registro.leer_registro(self.raiz)
        self.assertEqual(documento["fuentes"][ENLACES]["resultado"], "fallo")
        self.assertEqual(documento["seguimiento_remoto"][ENLACES]["fallos_seguidos"], 1)

        recuperado = self.ciclo(t3, respuesta=False, preparar_falla=False)
        self.assertEqual(recuperado.resultados[ENLACES].veredicto, "verde")
        fila = self.publicada()
        self.assertEqual(fila["ultimo_intento"]["capturado_utc"], t3.isoformat())
        self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], t1.isoformat())
        self.assertEqual(registro.leer_registro(self.raiz)["seguimiento_remoto"][ENLACES]["fallos_seguidos"], 0)
        modulo = next(m for m in estado_panel(self.raiz, datetime.now(UTC))["modulos"] if m["id"] == ENLACES)
        self.assertEqual((modulo["veredicto"], modulo["fallos"]), ("verde", 0))


class ConsultaParcialNoEsCompleta(unittest.TestCase):
    """Seguimiento real: una cobertura completa con unidades sin respuesta queda «parcial», nunca «comprobada»."""

    def resultado(self, marca: dict | None) -> tuple[str, dict]:
        """Registra un intento de hp_life con recepción íntegra y el conjunto admitido dado.

        Returns:
            El resultado de la fuente y las comprobaciones por conjunto.
        """
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            ahora = datetime(2026, 10, 20, 10, tzinfo=UTC)
            evidencia = {
                "version": 2,
                "fuente": "hp_life",
                "intento": "recepcion-sintetica",
                "comienzo_utc": ahora.isoformat(),
                "fin_utc": ahora.isoformat(),
                "peticiones": [
                    {
                        "recurso_sha256": "a" * 64,
                        "url_final_sha256": "b" * 64,
                        "respuesta_sha256": "c" * 64,
                        "bytes": 42,
                        "completado_utc": ahora.isoformat(),
                        "original_sha256": "c" * 64,
                        "original_bytes": 42,
                    }
                ],
            }
            ciclo = registro.iniciar_ciclo(raiz, ahora, "programada")

            def ejecutar(orden: list[str], _area: Path) -> actualizar.Resultado:
                return actualizar.Resultado(0, "", evidencia if etapa_de_fuente(orden)[1] == "descargar" else None)

            observador = seguimiento.Seguimiento(raiz, ciclo, ejecutar, lambda: ahora)
            with (
                mock.patch.dict(seguimiento.COBERTURAS_COMPLETAS, {"hp_life": lambda _raiz, _evidencia: True}),
                mock.patch.object(operacion_fuente, "leer_validado", return_value=marca),
            ):
                for orden in actualizar.ordenes_de_la_fuente("hp_life"):
                    observador.ejecutar(orden.orden, raiz)
                observador.terminar_modulo(
                    next(m for m in MODULOS if m.id == "hp_life"), actualizar.ResultadoDelModulo("verde")
                )
            documento = registro.leer_registro(raiz)
            return documento["fuentes"]["hp_life"]["resultado"], documento["conjuntos"]

    def test_unidades_sin_respuesta_dejan_la_consulta_parcial(self) -> None:
        """Con la marca de consulta parcial no se acredita ningún conjunto; sin ella, la cobertura completa sí."""
        self.assertEqual(self.resultado({"consulta_parcial": None})[0], "comprobada")
        parcial = {"consulta_parcial": {"unidades_fallidas": ["u1"], "unidades_esperadas": 3}}
        resultado, conjuntos = self.resultado(parcial)
        self.assertEqual(resultado, "parcial")
        self.assertEqual(conjuntos, {})


if __name__ == "__main__":
    unittest.main()
