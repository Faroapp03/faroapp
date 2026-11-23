"""Pruebas de la actualización por módulos: un fallo en un módulo nunca se propaga a otro.

Cada prueba monta un repositorio mínimo con una versión publicada de cada módulo del registro (modulos.py) y un
ejecutor simulado: «preparar» escribe la versión nueva del módulo en el área y «validar» anota lo que lee de sus
entradas y puede fallar con un código, una excepción o un tiempo agotado. Así se comprueba, sin red ni datos, que los
demás módulos publican byte a byte lo mismo, que las entradas salen siempre de lo publicado y que un corte en cualquier
operación de disco deja cada módulo entero.
"""

import json
import os
import shutil
import tempfile
import unittest
from collections.abc import Callable, Iterator, Mapping
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import actualizar, modulos, sustitucion
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.pruebas.ayudas import Corte
from plataforma_datos.orquestacion.pruebas.ayudas import corte_en as corte_comun
from plataforma_datos.orquestacion.pruebas.test_actualizar import PAQUETE_VIGENTE, escribir_paquete

VALIDADOS = {
    fuente: modulos.carpetas(modulos.Modulo(fuente, (fuente,)))[2]
    for registrado in modulos.MODULOS
    for fuente in registrado.fuentes
}
PAQUETE_NUEVO = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}
# Rondas de tich que fallan antes de que vuelva a ir bien (reintentos a 1, 2 y 4 días).
RONDAS_CON_FALLO = 3
# Una orden de una fuente trae python, -m, módulo y etapa: cuatro elementos como mínimo.
ORDEN_MINIMA_DE_UNA_FUENTE = 4
FALLOS = ("codigo", "excepcion", "tiempo")


class EjecutorDeModulos:
    """Simula las órdenes: «preparar» escribe la versión nueva, «validar» anota sus entradas y falla si se le dice."""

    def __init__(self, fallos: dict[str, str] | None = None) -> None:
        self.fallos = fallos or {}
        self.leido: dict[str, dict[str, str]] = {}
        self.ordenes: list[list[str]] = []

    def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """Responde como la orden real, con la versión nueva «nuevo <fuente>».

        Returns:
            El resultado de la orden: código 0, o el que pida el fallo simulado.

        Raises:
            FormatoInesperado: Si la fuente está configurada con un fallo de tipo «excepcion».
            RecuperacionIncompleta: Si lo está con un fallo de tipo «recuperacion» (el área no se restauró).
        """
        self.ordenes.append(orden)
        if "plataforma_datos.orquestacion.exportar_paquete" in orden:
            escribir_paquete(area / "datos", PAQUETE_NUEVO)
        if len(orden) < ORDEN_MINIMA_DE_UNA_FUENTE:
            return actualizar.Resultado(0, "")
        por_modulo = {adaptador.__name__: nombre for nombre, adaptador in actualizar.FUENTES_EN_ORDEN}
        fuente, etapa = por_modulo.get(orden[2]), orden[3]
        if fuente is None:
            return actualizar.Resultado(0, "")
        if etapa == "preparar":
            (area / VALIDADOS[fuente] / "v.json").write_text(f"nuevo {fuente}", encoding="utf-8")
        if etapa != "validar":
            return actualizar.Resultado(0, "")
        entradas = next(modulo.entradas for modulo in modulos.MODULOS if fuente in modulo.fuentes)
        self.leido[fuente] = {
            entrada: (area / VALIDADOS[entrada] / "v.json").read_text(encoding="utf-8") for entrada in entradas
        }
        tipo = self.fallos.get(fuente)
        if tipo == "excepcion":
            raise FormatoInesperado("fallo simulado")
        if tipo == "recuperacion":
            raise sustitucion.RecuperacionIncompleta("área sin restaurar (simulado)")
        return actualizar.Resultado({"codigo": 1, "tiempo": actualizar.CODIGO_TIEMPO_AGOTADO}.get(tipo or "", 0), "")


def montar(raiz: Path) -> None:
    """La versión publicada de cada módulo («publicado <fuente>») y el paquete vigente."""
    for fuente, carpeta in VALIDADOS.items():
        (raiz / carpeta).mkdir(parents=True)
        (raiz / carpeta / "v.json").write_text(f"publicado {fuente}", encoding="utf-8")
    escribir_paquete(raiz / "datos", PAQUETE_VIGENTE)


def publicado(raiz: Path) -> dict[str, str]:
    """La huella de lo publicado por cada módulo y por el paquete.

    Returns:
        La huella de cada módulo y del paquete.
    """
    huellas = {modulo.id: actualizar.huella(raiz, modulos.carpetas(modulo)) for modulo in modulos.MODULOS}
    return {**huellas, modulos.PAQUETE: actualizar.huella(raiz, (modulos.CARPETA_DEL_PAQUETE,))}


def restos(raiz: Path) -> list[str]:
    """Copias intermedias o diarios que no deberían quedar (el temporal de un estado cortado se sobrescribe luego).

    Returns:
        Las rutas relativas de los restos hallados; vacía si no queda ninguno.
    """
    return sorted(
        ruta.name
        for ruta in raiz.rglob("*")
        if ruta.name.endswith((".nuevo", ".anterior")) or ruta.name.startswith(("diario-", ".diario-"))
    )


class Base(unittest.TestCase):
    """Un repositorio mínimo con todos los módulos publicados."""

    def setUp(self) -> None:
        """Monta el repositorio y su área en una carpeta temporal."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.temporal = Path(temporal.name).resolve()
        self.raiz, self.area = self.temporal / "repositorio", self.temporal / "area"
        montar(self.raiz)
        self.antes = publicado(self.raiz)

    def actualizar(self, ejecutor: EjecutorDeModulos, **opciones: object) -> int:
        """Una actualización sin pausas ni salida.

        Returns:
            El código de salida de la actualización.
        """
        shutil.rmtree(self.area, ignore_errors=True)
        argumentos = actualizar.Opciones(area=self.area, pausa=0, reintento=0, **opciones)
        with mock.patch("builtins.print"), mock.patch.dict(os.environ, {estado.VARIABLE_DEL_AVISO: ""}):
            return actualizar.actualizar(self.raiz, argumentos, ejecutor)

    def estado(self) -> dict[str, Any]:
        """Estado persistido en la carpeta operativa de ejecuciones.

        Returns:
            El contenido de estado.json.
        """
        return json.loads((self.raiz / CARPETA_DE_INFORMES / estado.ARCHIVO).read_text(encoding="utf-8"))


class Aislamiento(Base):
    """Un módulo que falla conserva su versión; los demás publican lo mismo que si no hubiera fallado."""

    def test_un_fallo_en_cada_modulo_no_cambia_a_los_demas(self) -> None:
        """Para cada módulo y cada clase de fallo: él queda como estaba, los demás byte a byte como en verde."""
        self.assertEqual(self.actualizar(EjecutorDeModulos()), 0)
        verde = publicado(self.raiz)
        self.assertEqual(self.estado()["actualizacion"]["veredicto"], "verde")
        for numero, modulo in enumerate(modulos.MODULOS):
            fuente, tipo = modulo.fuentes[-1], FALLOS[numero % len(FALLOS)]
            with self.subTest(modulo=modulo.id, fallo=tipo):
                shutil.rmtree(self.raiz)
                montar(self.raiz)
                dependientes = [otro.id for otro in modulos.MODULOS if modulo.id in otro.entradas]
                with mock.patch.object(actualizar, "revalidar", return_value=True):
                    self.assertEqual(self.actualizar(EjecutorDeModulos({fuente: tipo})), actualizar.CODIGO_AMBAR)
                despues = publicado(self.raiz)
                self.assertEqual(despues[modulo.id], self.antes[modulo.id])
                otros = {clave: valor for clave, valor in despues.items() if clave != modulo.id}
                self.assertEqual(otros, {clave: valor for clave, valor in verde.items() if clave != modulo.id})
                registro = self.estado()["modulos"]
                self.assertEqual(registro[modulo.id]["veredicto"], estado.AMBAR)
                self.assertEqual(
                    {registro[dependiente]["veredicto"] for dependiente in dependientes},
                    {estado.VERDE} if dependientes else set(),
                )
                self.assertEqual(restos(self.raiz), [])

    def test_las_entradas_salen_de_lo_publicado(self) -> None:
        """Si clasificaciones falla, quien la lee ve su versión publicada, no la del área; si publica, la nueva."""
        ejecutor = EjecutorDeModulos({"clasificaciones": "codigo"})
        with mock.patch.object(actualizar, "revalidar", return_value=True):
            self.actualizar(ejecutor)
        self.assertEqual(ejecutor.leido["cambra"]["clasificaciones"], "publicado clasificaciones")
        self.assertEqual(ejecutor.leido["clasificaciones"]["oit"], "nuevo oit")
        verde = EjecutorDeModulos()
        self.actualizar(verde)
        self.assertEqual(verde.leido["cambra"]["clasificaciones"], "nuevo clasificaciones")

    def test_todo_o_nada_dentro_de_un_modulo(self) -> None:
        """Un módulo de dos fuentes: si falla la segunda, no se publica tampoco la primera."""
        pareja = modulos.Modulo("pareja", ("sectores", "empresas"), (modulos.CLASIFICACIONES, modulos.CATALUNA))
        registro = tuple(otro for otro in modulos.MODULOS if otro.id not in pareja.fuentes) + (pareja,)
        with ExitStack() as pila:
            pila.enter_context(mock.patch.object(actualizar, "MODULOS", registro))
            pila.enter_context(mock.patch.object(estado, "IDS", (*(otro.id for otro in registro), modulos.PAQUETE)))
            pila.enter_context(mock.patch.object(actualizar, "revalidar", return_value=True))
            self.assertEqual(self.actualizar(EjecutorDeModulos({"empresas": "codigo"})), actualizar.CODIGO_AMBAR)
            self.assertEqual(self.estado()["modulos"]["pareja"]["veredicto"], estado.AMBAR)
        for fuente in pareja.fuentes:
            self.assertEqual((self.raiz / VALIDADOS[fuente] / "v.json").read_text(), f"publicado {fuente}")

    def test_todas_las_carpetas_de_un_modulo_o_ninguna(self) -> None:
        """Si el disco falla al publicar la segunda carpeta del Consorci, ninguna de sus carpetas cambia."""
        consorci = next(modulo for modulo in modulos.MODULOS if modulo.id == "consorci")
        for carpeta in modulos.carpetas(consorci)[:2]:
            (self.raiz / carpeta).mkdir(parents=True)
            (self.raiz / carpeta / "lista.json").write_text("publicada", encoding="utf-8")
        self.antes = publicado(self.raiz)
        renombrar, segunda = Path.rename, self.raiz / modulos.carpetas(consorci)[1]

        def falla_en_la_segunda(ruta: Path, destino: Path) -> Path:
            if ruta == segunda:
                raise OSError("disco lleno (simulado)")
            return renombrar(ruta, destino)

        with mock.patch.object(Path, "rename", falla_en_la_segunda):
            self.assertEqual(self.actualizar(EjecutorDeModulos()), actualizar.CODIGO_AMBAR)
        self.assertEqual(publicado(self.raiz)["consorci"], self.antes["consorci"])
        self.assertIn("disco lleno", self.estado()["modulos"]["consorci"]["motivo"])
        self.assertEqual(restos(self.raiz), [])


class Rojo(Base):
    """El rojo: un módulo que no puede quedar en un estado coherente."""

    def test_area_que_no_vuelve_a_lo_publicado(self) -> None:
        """Si el área de un módulo que falla no se puede restaurar, se para: lo publicado sigue entero; código 1."""
        restaurar = actualizar.restaurar

        def falla_en_tich(raiz: Path, area: Path, rutas: tuple[str, ...]) -> None:
            if VALIDADOS["tich"] in rutas:
                raise OSError("sin permiso (simulado)")
            restaurar(raiz, area, rutas)

        ejecutor = EjecutorDeModulos({"tich": "codigo"})
        with mock.patch.object(actualizar, "restaurar", falla_en_tich):
            self.assertEqual(self.actualizar(ejecutor), 1)
        registro = self.estado()["modulos"]
        self.assertEqual(registro["tich"]["veredicto"], estado.ROJO)
        self.assertIsNone(registro["salarios"]["veredicto"])
        self.assertFalse(any("fuentes.salarios.lector" in " ".join(orden) for orden in ejecutor.ordenes))
        self.assertEqual(publicado(self.raiz)["tich"], self.antes["tich"])
        self.assertEqual(publicado(self.raiz)[modulos.PAQUETE], self.antes[modulos.PAQUETE])

    def test_version_conservada_que_ya_no_valida(self) -> None:
        """Cambra falla y clasificaciones publica otra versión con la que la de cambra no valida: rojo en cambra."""
        ejecutor = EjecutorDeModulos({"cambra": "codigo"})
        self.assertEqual(self.actualizar(ejecutor), 1)
        registro = self.estado()["modulos"]
        self.assertEqual(registro["cambra"]["veredicto"], estado.ROJO)
        self.assertEqual(registro["cataluna"]["veredicto"], estado.ROJO)
        self.assertNotIn("cataluna", ejecutor.leido)
        fuentes_ejecutadas = [etapa_de_fuente(orden) for orden in ejecutor.ordenes]
        self.assertTrue(all(fuente is None or fuente[0] != "cataluna" for fuente in fuentes_ejecutadas))
        self.assertEqual(registro["citilab"]["veredicto"], estado.VERDE)
        self.assertEqual(publicado(self.raiz)["cambra"], self.antes["cambra"])
        self.assertEqual(publicado(self.raiz)[modulos.PAQUETE], self.antes[modulos.PAQUETE])

    def test_el_rojo_de_la_comprobacion_de_enlaces_no_impide_publicar_el_paquete(self) -> None:
        """Enlaces falla: queda en rojo en el estado, el resto sigue en verde y el paquete se publica."""
        self.assertIn("enlaces", modulos.MODULOS_DE_APOYO)
        self.assertEqual(self.actualizar(EjecutorDeModulos({"enlaces": "excepcion"})), actualizar.CODIGO_AMBAR)
        registro = self.estado()
        self.assertEqual(registro["modulos"]["enlaces"]["veredicto"], estado.ROJO)
        self.assertEqual(registro["modulos"]["cambra"]["veredicto"], estado.VERDE)
        self.assertEqual(registro["modulos"][modulos.PAQUETE]["veredicto"], estado.VERDE)
        self.assertNotEqual(publicado(self.raiz)[modulos.PAQUETE], self.antes[modulos.PAQUETE])
        self.assertEqual(publicado(self.raiz)["enlaces"], self.antes["enlaces"])

    def test_el_rojo_de_otro_modulo_sigue_bloqueando_el_paquete(self) -> None:
        """Un módulo que no es de apoyo en rojo sigue sin dejar exportar, aunque enlaces también falle."""
        ejecutor = EjecutorDeModulos({"enlaces": "excepcion", "cambra": "codigo"})
        self.assertEqual(self.actualizar(ejecutor), 1)
        self.assertEqual(publicado(self.raiz)[modulos.PAQUETE], self.antes[modulos.PAQUETE])

    def test_una_ronda_interrumpida_por_enlaces_no_exporta_y_deja_el_ciclo_en_rojo(self) -> None:
        """Si el área no se restaura, ni el rojo de un módulo de apoyo deja exportar desde ella."""
        self.assertEqual(self.actualizar(EjecutorDeModulos({"enlaces": "recuperacion"})), actualizar.CODIGO_ROJO)
        registro = self.estado()
        self.assertEqual(registro["modulos"]["enlaces"]["veredicto"], estado.ROJO)
        self.assertEqual(registro["modulos"][modulos.PAQUETE]["veredicto"], estado.ROJO)
        self.assertIn("la ronda se interrumpió", registro["modulos"][modulos.PAQUETE]["motivo"])
        self.assertEqual(registro["actualizacion"]["veredicto"], estado.ROJO)
        self.assertEqual(publicado(self.raiz)[modulos.PAQUETE], self.antes[modulos.PAQUETE])

    def test_el_rojo_anterior_de_enlaces_en_un_ciclo_que_no_lo_ejecuta_no_sale_verde(self) -> None:
        """Con --solo de otros módulos, el ciclo sale ámbar y nombra a enlaces entre los que conservan su versión."""
        self.assertEqual(self.actualizar(EjecutorDeModulos({"enlaces": "excepcion"})), actualizar.CODIGO_AMBAR)
        self.assertEqual(self.actualizar(EjecutorDeModulos(), solo=("oit", "textos")), actualizar.CODIGO_AMBAR)
        registro = self.estado()
        self.assertIn("enlaces", registro["actualizacion"]["veredicto"])
        self.assertEqual(registro["modulos"]["enlaces"]["veredicto"], estado.ROJO)
        self.assertEqual(registro["modulos"]["oit"]["veredicto"], estado.VERDE)

    def test_un_fallo_sin_entradas_nuevas_es_ambar(self) -> None:
        """Si sus entradas no han cambiado, un módulo que falla queda en ámbar, nunca en rojo."""
        self.assertEqual(self.actualizar(EjecutorDeModulos({"oit": "excepcion"}), solo=("oit", "textos")), 3)
        self.assertEqual(self.estado()["modulos"]["oit"]["veredicto"], estado.AMBAR)


class ReintentosYAvisos(Base):
    """El estado de cada módulo, sus reintentos a 1, 2, 4 y 8 días y el aviso al cambiar de veredicto."""

    def test_esperas(self) -> None:
        """Las esperas crecen 1, 2, 4 y 8 días, y se quedan en 8."""
        self.assertEqual([estado.espera(fallos).days for fallos in range(1, 7)], [1, 2, 4, 8, 8, 8])

    def test_reintentos_y_avisos(self) -> None:
        """Tres fallos seguidos de tich: reintento a 1, 2 y 4 días; un aviso al pasar a ámbar y otro al volver."""
        avisos: list[str] = []
        comienzos = [datetime(2026, 10, dia, 5, tzinfo=UTC) for dia in (10, 11, 13, 17)]
        for numero, comienzo in enumerate(comienzos):
            fallos = {"tich": "codigo"} if numero < RONDAS_CON_FALLO else {}
            with ExitStack() as pila:
                pila.enter_context(mock.patch.object(actualizar, "datetime")).now.return_value = comienzo
                pila.enter_context(mock.patch.object(actualizar, "registrar_estado", self.registrar(avisos)))
                pila.enter_context(mock.patch.object(actualizar, "revalidar", return_value=True))
                self.actualizar(EjecutorDeModulos(fallos), solo=("tich",) if numero else None)
            tich = self.estado()["modulos"]["tich"]
            if numero < RONDAS_CON_FALLO:
                esperado = comienzo + timedelta(days=(1, 2, 4)[numero])
                self.assertEqual(tich["proximo_reintento_utc"], esperado.isoformat(timespec="seconds"))
                self.assertEqual(estado.pendientes(self.raiz, esperado), ("tich",))
                self.assertEqual(estado.pendientes(self.raiz, esperado - timedelta(seconds=1)), ())
        self.assertEqual(tich["fallos_seguidos"], 0)
        self.assertIsNone(tich["proximo_reintento_utc"])
        self.assertEqual(tich["ultima_version_buena"]["publicada_utc"], comienzos[-1].isoformat(timespec="seconds"))
        self.assertEqual([aviso.split(" · ")[1:3] for aviso in avisos], [["tich", "ámbar"], ["tich", "verde"]])

    def registrar(
        self, avisos: list[str]
    ) -> Callable[[Path, Mapping[str, estado.ResultadoDelModulo], estado.Intento], Path]:
        """registrar_estado con el aviso que anota en `avisos`.

        Returns:
            Una función que registra el estado y anota los avisos en `avisos`.
        """

        def registrar(
            raiz: Path,
            resultados: Mapping[str, estado.ResultadoDelModulo],
            intento: estado.Intento,
            *,
            recompuestos: frozenset[str] = frozenset(),
        ) -> Path:
            return estado.registrar_estado(
                raiz, resultados, intento, lambda _raiz, mensaje: avisos.append(mensaje), recompuestos=recompuestos
            )

        return registrar

    def test_aviso_por_defecto_y_gancho(self) -> None:
        """Por defecto, una línea en avisos.log; con FARO_AVISO, además la orden con el aviso como argumento."""
        (self.raiz / CARPETA_DE_INFORMES).mkdir(parents=True)
        estado.avisar(self.raiz, "uno")
        guion = self.temporal / "aviso.sh"
        guion.write_text(f'#!/bin/sh\nprintf "%s" "$1" > "{self.temporal}/recibido"\n', encoding="utf-8")
        guion.chmod(0o700)
        with mock.patch.dict(os.environ, {estado.VARIABLE_DEL_AVISO: str(guion)}):
            estado.avisar(self.raiz, "dos")
        with mock.patch.dict(os.environ, {estado.VARIABLE_DEL_AVISO: str(self.temporal / "no-existe")}):
            estado.avisar(self.raiz, "tres")
        lineas = (self.raiz / CARPETA_DE_INFORMES / estado.ARCHIVO_DE_AVISOS).read_text().splitlines()
        self.assertEqual(lineas[:2], ["uno", "dos"])
        self.assertTrue(lineas[2].startswith("tres (la orden de aviso falló"))
        self.assertEqual((self.temporal / "recibido").read_text(), "dos")

    def test_estado_se_escribe_entero_o_nada(self) -> None:
        """Un corte al escribir estado.json deja el anterior byte a byte y sin temporales que lean otros."""
        self.actualizar(EjecutorDeModulos({"tich": "codigo"}))
        ruta = self.raiz / CARPETA_DE_INFORMES / estado.ARCHIVO
        antes = ruta.read_bytes()
        sustituir = Path.replace

        def corte_en_el_estado(ruta: Path, destino: Path) -> Path:
            if destino == ruta_del_estado:
                raise Corte("corte")
            return sustituir(ruta, destino)

        ruta_del_estado = ruta
        with mock.patch.object(Path, "replace", corte_en_el_estado), self.assertRaises(Corte):
            self.actualizar(EjecutorDeModulos())
        self.assertEqual(ruta.read_bytes(), antes)
        json.loads(antes)


@contextmanager
def corte_en(numero: int) -> Iterator[list[str]]:
    """Corta el proceso antes de la operación de disco `numero` (renombrar, sustituir un archivo o copiar).

    Args:
        numero: La operación, contada desde 1, que no llega a hacerse.

    Yields:
        Las operaciones de disco hechas antes del corte, en orden.
    """
    with corte_comun(
        numero,
        ((Path, "rename", "renombrar"), (Path, "replace", "sustituir"), (sustitucion.shutil, "copytree", "copiar")),
    ) as hechas:
        yield hechas


class Interrupcion(Base):
    """Un corte en cualquier operación de disco deja cada módulo con su versión anterior o con la nueva, entera."""

    def test_corte_en_cada_operacion(self) -> None:
        """Tras el corte y la recuperación al empezar la siguiente, cada módulo está entero y sin restos."""
        fallos, solo = {"oit": "codigo", "esco": "excepcion"}, ("esco", "oit", "clasificaciones", "formacion", "tich")
        self.actualizar(EjecutorDeModulos(fallos), solo=solo)
        despues = publicado(self.raiz)
        numero, completa = 0, False
        while not completa:
            numero += 1
            shutil.rmtree(self.raiz)
            montar(self.raiz)
            with self.subTest(corte=numero), corte_en(numero) as hechas:
                try:
                    self.actualizar(EjecutorDeModulos(fallos), solo=solo)
                    completa = True
                except Corte:
                    pass
            if completa:
                break
            with mock.patch("builtins.print"):
                actualizar.recuperar_todo(self.raiz)
            ahora = publicado(self.raiz)
            for modulo, huella in ahora.items():
                self.assertIn(huella, {self.antes[modulo], despues[modulo]}, f"{modulo}, corte {numero}: {hechas[-3:]}")
            self.assertEqual(restos(self.raiz), [])
        self.assertGreater(numero, 3 * len(solo))


class Registro(unittest.TestCase):
    """El registro de módulos es coherente con la cadena."""

    def test_registro_coherente(self) -> None:
        """Cada fuente en un solo módulo; cada entrada, un módulo anterior; el Consorci, un solo módulo."""
        self.assertEqual(modulos.comprobar_registro(), [])
        (consorci,) = [modulo for modulo in modulos.MODULOS if "consorci" in modulo.fuentes]
        self.assertEqual(consorci.fuentes, ("consorci",))

    def test_registro_con_fallos(self) -> None:
        """Una entrada posterior o una fuente que falta se detectan."""
        malo = (modulos.Modulo("oit", ("oit",), ("esco", "textos")), *modulos.MODULOS[2:])
        with mock.patch.object(modulos, "MODULOS", malo):
            fallos = modulos.comprobar_registro()
        self.assertIn("oit lee textos, que no es un módulo anterior", fallos)
        self.assertIn("cada fuente de reconstruir.py debe estar en un solo módulo", fallos)

    def test_la_tabla_documentada_es_la_del_registro(self) -> None:
        """La tabla «Módulos de actualización» de la guía dice lo mismo que el registro, fila por fila."""
        texto = (Path(modulos.__file__).parent / "docs" / "actualizacion.md").read_text(encoding="utf-8")
        tabla = texto.split("<!-- tabla de módulos:")[1].split("\n\n")[0].splitlines()[3:]
        esperada = [
            f"| `{modulo.id}` | " + (", ".join(f"`{entrada}`" for entrada in modulo.entradas) or "—") + " |"
            for modulo in modulos.MODULOS
        ]
        self.assertEqual(tabla[:-1], esperada)
        self.assertTrue(tabla[-1].startswith(f"| `{modulos.PAQUETE}` |"))

    def test_listas_de_la_procedencia(self) -> None:
        """Las listas de un módulo son los originales que declara su procedencia."""
        with tempfile.TemporaryDirectory() as temporal:
            consorci = next(modulo for modulo in modulos.MODULOS if modulo.id == "consorci")
            carpeta = Path(temporal) / modulos.carpetas(consorci)[0]
            carpeta.mkdir(parents=True)
            archivos = [{"archivo": "jdcj-za6r.json"}, {"archivo": "7vig-4syr.json"}]
            (carpeta / "procedencia.json").write_text(json.dumps({"archivos": archivos}), encoding="utf-8")
            self.assertEqual(modulos.listas(Path(temporal), consorci), ["jdcj-za6r.json", "7vig-4syr.json"])


if __name__ == "__main__":
    unittest.main()
