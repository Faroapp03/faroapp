"""La porción diaria de enlaces: sus topes, el orden por lo que la persona ve, la muestra de fichas y la anomalía."""

import json
import math
import random
import tempfile
import unittest
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.fuentes.enlaces import lector, porcion
from plataforma_datos.cursos.fuentes.enlaces.candidatos import Candidato
from plataforma_datos.cursos.fuentes.enlaces.observaciones import (
    CURSOS,
    INCONCLUYENTE,
    NO_EXISTE,
    PROGRAMAS,
    WEBS,
    anotar,
    esta_visible_el_programa,
    estado_heredado,
    observacion,
)

# Un reparto como el real: casi todo en un dominio de programas, una parte en el de las fichas y unas webs sueltas.
PROGRAMAS_DEL_SEPE = [Candidato(f"https://sepe.example/p/{n:03d}.pdf", PROGRAMAS, f"P{n:03d}") for n in range(40)]
FICHAS_DEL_SOC = [Candidato(f"https://soc.example/c/{n:02d}", CURSOS, f"C{n:02d}") for n in range(9)]
WEBS_SUELTAS = [Candidato(f"https://web{n}.example/", WEBS, f"https://web{n}.example/") for n in range(3)]
TODOS = [*PROGRAMAS_DEL_SEPE, *FICHAS_DEL_SOC, *WEBS_SUELTAS]
# Siete consultas por ciclo, lo expuesto cada 2 días y lo enseñado cada 14 como mucho, todas las fichas, la anomalía de
# la configuración y, el domingo, 20 consultas en dos horas.
PORCION = porcion.Porcion(7, 3600.0, 2, 14, 100, 20, 50, 7, 20, 7200.0)
# Un domingo: los casos que no tratan de la pasada larga fijan sus topes al llamar al ciclo.
INICIO = datetime(2026, 11, 1, 4, tzinfo=UTC)


def _dia(ciclo: int) -> datetime:
    return INICIO + timedelta(days=ciclo)


def _vacio() -> dict:
    return {WEBS: {}, CURSOS: {}, PROGRAMAS: {}}


def _todo_visto_el_primer_dia() -> dict:
    estado = _vacio()
    for c in TODOS:
        estado[c.conjunto][c.url] = anotar(None, observacion(_dia(0).isoformat(), 200, c.url))
    return estado


def _ciclos(  # noqa: PLR0913 - Lo que varía entre los casos, con nombre.
    previo: dict,
    numero: int,
    codigo: Callable[[str, int], int | None],
    *,
    desde: int = 0,
    expuestos: frozenset[tuple[str, str]] = frozenset(),
    topes: porcion.Porcion = PORCION,
) -> tuple[dict, list[list[str]], list[dict]]:
    """Ejecuta varios ciclos seguidos, uno por día.

    Returns:
        El estado tras el último ciclo, las direcciones consultadas en cada uno y lo que dijo cada ciclo.
    """
    estado, consultadas, ciclos = previo, [], []
    for ciclo in range(desde, desde + numero):
        pedidas: list[str] = []

        def pedir(url: str, _conjunto: str, ciclo: int = ciclo, pedidas: list[str] = pedidas) -> dict:
            pedidas.append(url)
            respuesta = codigo(url, ciclo)
            motivo = "red" if respuesta is None else None
            return observacion(_dia(ciclo).isoformat(), respuesta, None if respuesta is None else url, motivo=motivo)

        estado, resumen = lector.comprobar_ciclo(
            TODOS,
            estado,
            pedir,
            max_consultas=topes.max_consultas,
            plazo_s=topes.plazo_s,
            expuestos_hoy=expuestos,
            hoy=_dia(ciclo),
            porcion=topes,
        )
        consultadas.append(pedidas)
        ciclos.append(resumen)
    return estado, consultadas, ciclos


def _orden(candidatos: list[Candidato], estado: dict, expuestos: frozenset = frozenset()) -> list[Candidato]:
    return porcion.orden_de_la_porcion(candidatos, estado, expuestos, _dia(30), PORCION).por_consultar


class TopesDeLaConfiguracion(unittest.TestCase):
    """Los topes de la porción se declaran en la configuración de la fuente."""

    def test_el_lector_usa_los_topes_declarados(self) -> None:
        """Diez minutos, lo expuesto cada dos días como mucho, y el lector toma exactamente lo declarado."""
        declarado = json.loads(porcion.CONFIGURACION.read_text(encoding="utf-8"))
        self.assertEqual((declarado["plazo_minutos"], declarado["expuesto_max_dias"]), (10, 2))
        self.assertEqual((lector.MAX_CONSULTAS, lector.PLAZO_S), (declarado["max_consultas"], 600.0))
        self.assertEqual(lector.PORCION.fichas_por_ciclo, declarado["fichas_por_ciclo"])
        self.assertEqual((declarado["ensenado_max_dias"], declarado["minutos_dia_largo"]), (14, 40))
        self.assertEqual(lector.PLAZO_S_DIA_LARGO, 40 * 60.0)

    def test_una_configuracion_incompleta_o_sin_enteros_se_rechaza(self) -> None:
        """Un tope que falta, sobra, es cero, no es entero o un porcentaje de más de 100 detienen la lectura."""
        buena = json.loads(porcion.CONFIGURACION.read_text(encoding="utf-8"))
        malas = [
            {k: v for k, v in buena.items() if k != "fichas_por_ciclo"},
            {**buena, "plazo_minutos": 0},
            {**buena, "plazo_minutos": 10.5},
            {**buena, "max_consultas": True},
            {**buena, "version": 1},
            {**buena, "anomalia_porcentaje": 101},
            {**buena, "dia_largo": 8},
            {**buena, "plazo_s": 60},
        ]
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / "porcion_diaria.json"
            for mala in malas:
                with self.subTest(mala=mala):
                    ruta.write_text(json.dumps(mala), encoding="utf-8")
                    with self.assertRaises(FormatoInesperado):
                        porcion.leer_porcion(ruta)


class OrdenDeLaPorcion(unittest.TestCase):
    """Qué va antes en la porción de un ciclo, siempre igual para las mismas observaciones."""

    def test_el_orden_es_determinista_aunque_cambie_el_orden_de_los_candidatos(self) -> None:
        """Barajar los candidatos no cambia la porción."""
        estado, _, _ = _ciclos(_vacio(), 3, lambda url, _ciclo: 503 if url.endswith("7.pdf") else 200)
        expuestos = frozenset({(PROGRAMAS, PROGRAMAS_DEL_SEPE[5].url)})
        esperado = _orden(TODOS, estado, expuestos)
        for semilla in range(5):
            barajados = list(TODOS)
            random.Random(semilla).shuffle(barajados)
            self.assertEqual(_orden(barajados, estado, expuestos), esperado)

    def test_un_enlace_que_falla_se_comprueba_antes_que_uno_sano_mas_antiguo(self) -> None:
        """Un corte en la última consulta adelanta el enlace; si vuelve a fallar, espera su turno como los demás."""
        sano, fallido = PROGRAMAS_DEL_SEPE[0], PROGRAMAS_DEL_SEPE[1]
        estado = _vacio()
        estado[PROGRAMAS][sano.url] = anotar(None, observacion(_dia(0).isoformat(), 200, sano.url))
        estado[PROGRAMAS][fallido.url] = anotar(None, observacion(_dia(1).isoformat(), None, None, motivo="red"))
        self.assertEqual(_orden([sano, fallido], estado), [fallido, sano])
        segundo = observacion(_dia(2).isoformat(), 503, None)
        estado[PROGRAMAS][fallido.url] = anotar(estado[PROGRAMAS][fallido.url], segundo)
        self.assertEqual(_orden([sano, fallido], estado), [sano, fallido])

    def test_lo_expuesto_vencido_va_antes_que_lo_no_expuesto_mas_antiguo(self) -> None:
        """Un programa que la persona ve junto a un curso pasa delante de otro más antiguo que no se enseña."""
        antiguo, expuesto = PROGRAMAS_DEL_SEPE[0], PROGRAMAS_DEL_SEPE[1]
        estado = _vacio()
        estado[PROGRAMAS][antiguo.url] = anotar(None, observacion(_dia(0).isoformat(), 200, antiguo.url))
        estado[PROGRAMAS][expuesto.url] = anotar(None, observacion(_dia(5).isoformat(), 200, expuesto.url))
        marcados = frozenset({(PROGRAMAS, expuesto.url)})
        self.assertEqual(_orden([antiguo, expuesto], estado, marcados), [expuesto, antiguo])
        # Comprobado hace menos de su antigüedad máxima, vuelve a su turno por antigüedad.
        estado[PROGRAMAS][expuesto.url] = anotar(None, observacion(_dia(29).isoformat(), 200, expuesto.url))
        self.assertEqual(_orden([antiguo, expuesto], estado, marcados), [antiguo, expuesto])

    def test_lo_nunca_consultado_que_no_se_ensena_no_adelanta_a_lo_expuesto(self) -> None:
        """Miles de programas sin consultar no retrasan lo que se ve: van tras lo expuesto, al frente del resto."""
        nuevo, expuesto_nuevo, expuesto_viejo, sano = PROGRAMAS_DEL_SEPE[:4]
        estado = _vacio()
        estado[PROGRAMAS][expuesto_viejo.url] = anotar(None, observacion(_dia(1).isoformat(), 200, expuesto_viejo.url))
        estado[PROGRAMAS][sano.url] = anotar(None, observacion(_dia(0).isoformat(), 200, sano.url))
        marcados = frozenset({(PROGRAMAS, expuesto_nuevo.url), (PROGRAMAS, expuesto_viejo.url)})
        orden = _orden([nuevo, expuesto_nuevo, expuesto_viejo, sano], estado, marcados)
        # El programa sano se enlaza sin curso al lado y lleva 30 días: es enseñado vencido, antes que lo nunca visto.
        self.assertEqual(orden, [expuesto_nuevo, expuesto_viejo, sano, nuevo])

    def test_lo_ensenado_sin_curso_va_tras_lo_expuesto_y_antes_que_el_resto(self) -> None:
        """Un programa enlazado sin curso al lado y vencido pasa delante del resto, pero detrás de lo expuesto."""
        expuesto, ensenado, oculto = PROGRAMAS_DEL_SEPE[:3]
        estado = _vacio()
        estado[PROGRAMAS][expuesto.url] = anotar(None, observacion(_dia(10).isoformat(), 200, expuesto.url))
        estado[PROGRAMAS][ensenado.url] = anotar(None, observacion(_dia(10).isoformat(), 200, ensenado.url))
        estado[PROGRAMAS][oculto.url] = anotar(None, observacion(_dia(0).isoformat(), 404, oculto.url))
        marcados = frozenset({(PROGRAMAS, expuesto.url)})
        self.assertEqual(_orden([oculto, ensenado, expuesto], estado, marcados), [expuesto, ensenado, oculto])
        # Comprobado hace menos de 14 días, el enseñado vuelve a su turno por antigüedad.
        estado[PROGRAMAS][ensenado.url] = anotar(None, observacion(_dia(20).isoformat(), 200, ensenado.url))
        self.assertEqual(_orden([oculto, ensenado, expuesto], estado, marcados), [expuesto, oculto, ensenado])


class PasadaLarga(unittest.TestCase):
    """El día de la semana declarado, la porción admite su tope largo; el resto de días, el corto."""

    def _consultas(self, hoy: datetime) -> tuple[int, dict]:
        pedidas: list[str] = []

        def pedir(url: str, _conjunto: str) -> dict:
            pedidas.append(url)
            return observacion(hoy.isoformat(), 200, url)

        _, ciclo = lector.comprobar_ciclo(TODOS, _vacio(), pedir, hoy=hoy, porcion=PORCION)
        return len(pedidas), ciclo

    def test_el_domingo_se_admite_el_tope_largo_y_el_lunes_el_corto(self) -> None:
        """La fecha del ciclo, no el reloj, decide: 20 consultas el domingo, 7 el lunes, siempre igual."""
        domingo, lunes = _dia(0), _dia(1)
        self.assertEqual(porcion.topes_del_dia(PORCION, domingo), (20, 7200.0))
        self.assertEqual(porcion.topes_del_dia(PORCION, lunes), (7, 3600.0))
        for _ in range(2):
            consultas, ciclo = self._consultas(domingo)
            self.assertEqual((consultas, ciclo["dia_largo"], ciclo["corte"]), (20, True, lector.TOPE))
            consultas, ciclo = self._consultas(lunes)
            self.assertEqual((consultas, ciclo["dia_largo"], ciclo["corte"]), (7, False, lector.TOPE))


class VueltaCompleta(unittest.TestCase):
    """Con la porción diaria, lo expuesto se renueva a tiempo y todo se comprueba en un número acotado de ciclos."""

    def test_sin_fallos_cualquier_tramo_de_n_entre_la_porcion_ciclos_los_ve_todos(self) -> None:
        """Con 52 enlaces y 7 por ciclo, cualquier tramo de 8 ciclos seguidos consulta todos los enlaces."""
        vuelta = math.ceil(len(TODOS) / PORCION.max_consultas)
        _, consultadas, _ = _ciclos(_vacio(), 3 * vuelta, lambda _url, _ciclo: 200)
        for inicio in range(2 * vuelta + 1):
            with self.subTest(inicio=inicio):
                vistas = {url for ciclo in consultadas[inicio : inicio + vuelta] for url in ciclo}
                self.assertEqual(vistas, {c.url for c in TODOS})

    def test_con_un_dominio_siempre_caido_ningun_enlace_espera_mas_del_doble(self) -> None:
        """Los programas fallan siempre: sus reintentos no acaparan la porción y todo se vuelve a ver en 16 ciclos."""
        vuelta = math.ceil(len(TODOS) / PORCION.max_consultas)
        estado, _, _ = _ciclos(_vacio(), vuelta, lambda _url, _ciclo: 200)
        _, consultadas, _ = _ciclos(estado, 2 * vuelta, lambda url, _ciclo: 503 if "sepe" in url else 200, desde=vuelta)
        self.assertEqual({url for ciclo in consultadas for url in ciclo}, {c.url for c in TODOS})

    def test_lo_expuesto_nunca_pasa_de_su_antiguedad_maxima_si_cabe_en_la_porcion(self) -> None:
        """Seis expuestos y siete consultas por ciclo: cada día todos tienen una consulta de hace dos días o menos."""
        expuestos = frozenset((PROGRAMAS, c.url) for c in PROGRAMAS_DEL_SEPE[30:36])
        estado, consultadas, ciclos = _ciclos(
            _todo_visto_el_primer_dia(), 20, lambda _url, _ciclo: 200, desde=1, expuestos=expuestos
        )
        self.assertTrue(all(ciclo["expuestos_vencidos"] == 0 for ciclo in ciclos))
        for _, url in expuestos:
            self.assertGreaterEqual(datetime.fromisoformat(estado[PROGRAMAS][url]["ultima"]["observado_el"]), _dia(18))
        # Lo que no se enseña sigue rotando: en 20 ciclos se ha visto todo.
        self.assertEqual({url for ciclo in consultadas for url in ciclo}, {c.url for c in TODOS})

    def test_si_lo_expuesto_no_cabe_se_dice_y_se_reparte_por_antiguedad(self) -> None:
        """Diez expuestos vencidos y siete consultas: entran los siete más antiguos y el ciclo cuenta los otros tres."""
        previo = _todo_visto_el_primer_dia()
        elegidos = PROGRAMAS_DEL_SEPE[20:30]
        for posicion, c in enumerate(reversed(elegidos)):
            previo[PROGRAMAS][c.url] = anotar(None, observacion(_dia(posicion).isoformat(), 200, c.url))
        expuestos = frozenset((PROGRAMAS, c.url) for c in elegidos)
        _, consultadas, ciclos = _ciclos(previo, 1, lambda _url, _ciclo: 200, desde=12, expuestos=expuestos)
        self.assertEqual(consultadas[0], [c.url for c in reversed(elegidos)][:7])
        self.assertEqual((ciclos[0]["expuestos"], ciclos[0]["expuestos_vencidos"]), (10, 3))

    def test_lo_ensenado_nunca_pasa_de_14_dias_si_cabe_en_la_porcion(self) -> None:
        """Seis programas enlazados sin curso al lado: en 40 ciclos ninguno pasa de 14 días sin comprobarse."""
        previo = _todo_visto_el_primer_dia()
        for c in PROGRAMAS_DEL_SEPE[6:]:
            previo[PROGRAMAS][c.url] = anotar(None, observacion(_dia(0).isoformat(), 404, c.url))
        estado, _, ciclos = _ciclos(
            previo, 40, lambda url, _ciclo: 200 if url < PROGRAMAS_DEL_SEPE[6].url else 404, desde=1
        )
        self.assertEqual({(c["ensenados"], c["ensenados_vencidos"]) for c in ciclos}, {(6, 0)})
        for c in PROGRAMAS_DEL_SEPE[:6]:
            self.assertGreaterEqual(
                datetime.fromisoformat(estado[PROGRAMAS][c.url]["ultima"]["observado_el"]), _dia(26)
            )


class MuestraDeFichas(unittest.TestCase):
    """De las fichas del SOC solo se pide una muestra rotatoria por ciclo."""

    def test_cada_ciclo_pide_su_muestra_y_en_tres_ciclos_se_ven_las_nueve(self) -> None:
        """Con tres fichas por ciclo, seis esperan a otro ciclo y no cuentan como pendientes de la porción."""
        topes = PORCION._replace(max_consultas=100, fichas_por_ciclo=3)
        _, consultadas, ciclos = _ciclos(_todo_visto_el_primer_dia(), 3, lambda _url, _ciclo: 200, desde=1, topes=topes)
        fichas = [[url for url in ciclo if "soc.example" in url] for ciclo in consultadas]
        self.assertEqual([len(f) for f in fichas], [3, 3, 3])
        self.assertEqual({url for f in fichas for url in f}, {c.url for c in FICHAS_DEL_SOC})
        self.assertEqual({c["fichas_fuera_de_la_muestra"] for c in ciclos}, {6})
        self.assertEqual({(c["sin_consultar"], c["corte"]) for c in ciclos}, {(0, None)})


class AnomaliaDeDominio(unittest.TestCase):
    """Cientos de 404 de golpe en un dominio son una señal del dominio, no cientos de enlaces retirados."""

    PROGRAMAS_ENLAZADOS = [Candidato(f"https://sepe.example/q/{n:03d}.pdf", PROGRAMAS, f"Q{n:03d}") for n in range(263)]

    def _ciclo(self, previo: dict, codigo: Callable[[str], int]) -> tuple[dict, dict]:
        def pedir(url: str, _conjunto: str) -> dict:
            return observacion(_dia(14).isoformat(), codigo(url), url)

        return lector.comprobar_ciclo(
            self.PROGRAMAS_ENLAZADOS, previo, pedir, max_consultas=1000, hoy=_dia(14), porcion=PORCION
        )

    def _heredados(self) -> dict:
        previo = _vacio()
        for c in self.PROGRAMAS_ENLAZADOS:
            previo[PROGRAMAS][c.url] = estado_heredado("2026-10-06T00:00:00+00:00")
        return previo

    def test_el_15_11_los_263_programas_que_se_ensenaban_siguen_enlazados(self) -> None:
        """Los 263 programas heredados dan 404 en la misma porción: ninguno deja de enlazarse y el ciclo lo anota."""
        estado, ciclo = self._ciclo(self._heredados(), lambda _url: 404)
        self.assertEqual(ciclo["dominios_con_anomalia"], ["sepe.example"])
        for c in self.PROGRAMAS_ENLAZADOS:
            self.assertTrue(esta_visible_el_programa(estado[PROGRAMAS][c.url]))
            ultima = estado[PROGRAMAS][c.url]["ultima"]
            self.assertEqual((ultima["resultado"], ultima["codigo_http"]), (INCONCLUYENTE, 404))
            self.assertEqual(ultima["motivo"], "anomalia-de-dominio")

    def test_unos_pocos_404_entre_muchos_que_responden_si_retiran_su_enlace(self) -> None:
        """Con 30 de 263 en 404 (un 11 %), cada 404 es del enlace y su programa deja de enlazarse."""
        caidos = {c.url for c in self.PROGRAMAS_ENLAZADOS[:30]}
        estado, ciclo = self._ciclo(self._heredados(), lambda url: 404 if url in caidos else 200)
        self.assertEqual(ciclo["dominios_con_anomalia"], [])
        self.assertEqual(sum(not esta_visible_el_programa(e) for e in estado[PROGRAMAS].values()), 30)

    def test_los_404_de_lo_que_nunca_se_enseno_no_cuentan_como_anomalia(self) -> None:
        """Programas sin consultar que dan 404: no retiran nada de lo que se ve y quedan como no existentes."""
        estado, ciclo = self._ciclo(_vacio(), lambda _url: 404)
        self.assertEqual(ciclo["dominios_con_anomalia"], [])
        self.assertTrue(all(e["concluyente"]["resultado"] == NO_EXISTE for e in estado[PROGRAMAS].values()))


if __name__ == "__main__":
    unittest.main()
