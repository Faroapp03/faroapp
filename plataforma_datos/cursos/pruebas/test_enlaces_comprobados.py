"""La comprobación de enlaces de la formación: qué se oculta, qué se conserva y cómo corta un ciclo."""

import io
import unittest
from datetime import UTC, datetime
from email.message import Message
from unittest import mock
from urllib.error import HTTPError, URLError

from plataforma_datos.comun import red
from plataforma_datos.cursos.fuentes.enlaces import consulta, lector
from plataforma_datos.cursos.fuentes.enlaces.candidatos import Candidato, candidatos, direccion_del_programa
from plataforma_datos.cursos.fuentes.enlaces.observaciones import (
    CURSOS,
    INCONCLUYENTE,
    NO_EXISTE,
    OTRO_CONTENIDO,
    PROGRAMAS,
    RESPONDE,
    WEBS,
    anotar,
    esta_oculto,
    esta_visible_el_programa,
    estado_heredado,
    observacion,
    orden_de_consulta,
)

WEB = "https://entidad.example/formacion"
FICHA = "https://soc.example/ficha?codigo=1"
ANTES = "2026-11-01T08:00:00+00:00"
DESPUES = "2026-11-02T08:00:00+00:00"
PDF = b"%PDF-1.7 programa"


def _web(instante: str, codigo: int | None, **resto: object) -> dict:
    return observacion(instante, codigo, None if codigo is None else WEB, **resto)  # type: ignore[arg-type]


class Respuesta(io.BytesIO):
    """Una respuesta en memoria: no abre sockets."""

    def __init__(self, contenido: bytes, url: str, status: int = 200) -> None:
        super().__init__(contenido)
        self.headers = {"Content-Type": "application/pdf"}
        self.url = url
        self.status = status


def _error_http(url: str, codigo: int) -> HTTPError:
    return HTTPError(url, codigo, "respuesta", Message(), io.BytesIO(b""))


class ReglaDeOcultacion(unittest.TestCase):
    """Un 404 o un 410 observados ocultan; lo demás no cambia nada."""

    def test_un_404_oculta_y_un_200_posterior_lo_recupera(self) -> None:
        """El enlace vuelve a enseñarse en cuanto una observación posterior lo acredita."""
        oculto = anotar(None, _web(ANTES, 404))
        self.assertTrue(esta_oculto(oculto))
        recuperado = anotar(oculto, _web(DESPUES, 200))
        self.assertFalse(esta_oculto(recuperado))
        self.assertEqual(recuperado["concluyente"]["codigo_http"], 200)

    def test_un_410_tambien_oculta(self) -> None:
        """Las dos respuestas de ausencia de cursos/vigencia.py ocultan."""
        self.assertTrue(esta_oculto(anotar(None, _web(ANTES, 410))))

    def test_un_fallo_de_red_un_5xx_o_un_plazo_no_ocultan(self) -> None:
        """Una consulta inconcluyente conserva lo anterior y cuenta el fallo sin cambiar lo que se ve."""
        sano = anotar(None, _web(ANTES, 200))
        for observada in (
            _web(DESPUES, None, motivo="red"),
            _web(DESPUES, None, motivo="plazo"),
            _web(DESPUES, 503),
            _web(DESPUES, 500),
            _web(DESPUES, 403),
            _web(DESPUES, 429),
        ):
            estado = anotar(sano, observada)
            self.assertEqual(observada["resultado"], INCONCLUYENTE)
            self.assertFalse(esta_oculto(estado), observada)
            self.assertEqual(estado["concluyente"], sano["concluyente"])
            self.assertEqual(estado["fallos_seguidos"], 1)

    def test_un_fallo_no_recupera_un_enlace_oculto_ni_acumula_ocultacion(self) -> None:
        """Quien estaba oculto con evidencia sigue oculto con fallos; muchos fallos no ocultan a quien responde."""
        oculto = anotar(None, _web(ANTES, 404))
        self.assertTrue(esta_oculto(anotar(oculto, _web(DESPUES, 503))))
        estado = anotar(None, _web(ANTES, 200))
        for _ in range(50):
            estado = anotar(estado, _web(DESPUES, None, motivo="red"))
        self.assertFalse(esta_oculto(estado))
        self.assertEqual(estado["fallos_seguidos"], 50)

    def test_sin_observacion_no_se_oculta(self) -> None:
        """Lo nunca observado no se oculta."""
        self.assertFalse(esta_oculto(None))

    def test_un_404_tras_una_redireccion_a_otro_origen_no_oculta(self) -> None:
        """El destino ya no es el enlace pedido: la observación se anota sin concluir y no cambia lo que se ve."""
        sano = anotar(None, _web(ANTES, 200))
        otro = observacion(DESPUES, 404, "https://otro.example/", otro_origen=True)
        self.assertEqual((otro["resultado"], otro["motivo"]), (INCONCLUYENTE, "otro-origen"))
        self.assertFalse(esta_oculto(anotar(sano, otro)))
        self.assertTrue(esta_oculto(anotar(sano, observacion(DESPUES, 404, WEB))))

    def test_un_programa_se_enlaza_solo_con_un_pdf_que_responde(self) -> None:
        """Un 200 que no es un PDF y un 404 retiran el enlace; un fallo lo conserva; el heredado lo mantiene."""
        pdf = observacion(ANTES, 200, "https://sepe.example/a.pdf", es_pdf=True, huella="a" * 64)
        self.assertEqual(pdf["resultado"], RESPONDE)
        enlazado = anotar(None, pdf)
        self.assertTrue(esta_visible_el_programa(enlazado))
        self.assertTrue(esta_visible_el_programa(anotar(enlazado, _web(DESPUES, 503))))
        html = observacion(DESPUES, 200, "https://sepe.example/a.pdf", es_pdf=False)
        self.assertEqual(html["resultado"], OTRO_CONTENIDO)
        self.assertFalse(esta_visible_el_programa(anotar(enlazado, html)))
        self.assertFalse(esta_visible_el_programa(anotar(enlazado, _web(DESPUES, 404))))
        self.assertFalse(esta_visible_el_programa(None))
        self.assertTrue(esta_visible_el_programa(estado_heredado(ANTES)))
        self.assertFalse(esta_visible_el_programa(anotar(estado_heredado(ANTES), _web(DESPUES, 410))))


class ConsultaDeUnEnlace(unittest.TestCase):
    """La observación lleva el código, la fecha y el destino, con las guardas de red comunes."""

    def setUp(self) -> None:
        """Sin esperas reales entre consultas."""
        pausa = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa.start()
        self.addCleanup(pausa.stop)
        self.reloj = lambda: datetime(2026, 11, 2, 8, 0, 0, 123456, tzinfo=UTC)

    def _consultar(self, conjunto: str, resultado: object, url: str = WEB) -> dict:
        with mock.patch.object(red, "abrir_peticion", side_effect=[resultado]) as abrir:
            observada = consulta.consultar(url, conjunto, self.reloj)
        peticion = abrir.call_args.args[0]
        self.assertEqual(peticion.get_header("User-agent"), red.agente_de_usuario())
        return observada

    def test_un_404_guarda_codigo_fecha_y_destino(self) -> None:
        """Un 404 es una respuesta: se anota con su código, su fecha y su destino."""
        observada = self._consultar(WEBS, _error_http(WEB, 404))
        self.assertEqual(observada["codigo_http"], 404)
        self.assertEqual(observada["observado_el"], DESPUES)
        self.assertEqual(observada["url_final"], WEB)
        self.assertEqual(observada["resultado"], NO_EXISTE)

    def test_un_200_con_redireccion_a_otro_origen_lo_anota(self) -> None:
        """El destino final y el cambio de origen quedan dichos."""
        observada = self._consultar(WEBS, Respuesta(b"<html>", "https://otro.example/nueva"))
        self.assertEqual(observada["codigo_http"], 200)
        self.assertEqual(observada["url_final"], "https://otro.example/nueva")
        self.assertTrue(observada["otro_origen"])
        self.assertEqual(observada["resultado"], RESPONDE)

    def test_un_pdf_guarda_su_huella(self) -> None:
        """Un programa que responde como un PDF guarda la huella de sus bytes."""
        url = direccion_del_programa("ADGD093PO")
        observada = self._consultar(PROGRAMAS, Respuesta(PDF, url), url)
        self.assertEqual(observada["resultado"], RESPONDE)
        self.assertEqual(len(observada["huella"]), 64)
        html = self._consultar(PROGRAMAS, Respuesta(b"<html>", url), url)
        self.assertEqual(html["resultado"], OTRO_CONTENIDO)
        self.assertIsNone(html["huella"])

    def test_una_web_de_mas_de_256_kib_que_responde_200_guarda_su_codigo_y_su_destino(self) -> None:
        """El código y el destino se leyeron antes de pasar el límite: bastan para una web o una ficha."""
        grande = Respuesta(b"x" * (consulta.MAX_BYTES_DE_UNA_WEB + 1), WEB)
        observada = self._consultar(WEBS, grande)
        self.assertEqual(
            (observada["resultado"], observada["codigo_http"], observada["url_final"]), (RESPONDE, 200, WEB)
        )
        ficha = self._consultar(CURSOS, Respuesta(b"x" * (consulta.MAX_BYTES_DE_UNA_WEB + 1), FICHA), FICHA)
        self.assertEqual((ficha["resultado"], ficha["codigo_http"]), (RESPONDE, 200))

    def test_un_programa_que_pasa_de_su_limite_sigue_inconcluyente(self) -> None:
        """Un programa necesita el PDF entero para su huella: sin él no concluye."""
        url = direccion_del_programa("ADGD093PO")
        with mock.patch.object(consulta, "MAX_BYTES_DE_UN_PDF", 8):
            observada = self._consultar(PROGRAMAS, Respuesta(PDF, url), url)
        self.assertEqual((observada["resultado"], observada["motivo"]), (INCONCLUYENTE, "limite"))

    def test_un_corte_de_red_y_un_plazo_son_inconcluyentes_con_su_motivo(self) -> None:
        """Ni un corte ni un plazo agotado son una respuesta: se anotan sin código."""
        corte = self._consultar(WEBS, URLError("sin red"))
        self.assertEqual((corte["resultado"], corte["motivo"], corte["codigo_http"]), (INCONCLUYENTE, "red", None))
        plazo = self._consultar(WEBS, TimeoutError())
        self.assertEqual((plazo["resultado"], plazo["motivo"]), (INCONCLUYENTE, "plazo"))
        servidor = self._consultar(WEBS, _error_http(WEB, 503))
        self.assertEqual(
            (servidor["resultado"], servidor["motivo"], servidor["codigo_http"]), (INCONCLUYENTE, "servidor", 503)
        )


class CicloDeComprobacion(unittest.TestCase):
    """Un ciclo consulta lo más atrasado, corta limpio en su tope y lo dice."""

    def setUp(self) -> None:
        """Cinco webs por comprobar."""
        self.candidatos = [
            Candidato(f"https://entidad{n}.example/", WEBS, f"https://entidad{n}.example/") for n in range(5)
        ]
        self.pedidas: list[str] = []

    def _pedir(self, url: str, _conjunto: str) -> dict:
        self.pedidas.append(url)
        return _web(DESPUES, 200)

    @staticmethod
    def _vacio() -> dict:
        return {WEBS: {}, CURSOS: {}, PROGRAMAS: {}}

    def test_el_tope_de_consultas_corta_y_lo_dice(self) -> None:
        """Con tope 3 se consultan tres enlaces; los otros dos esperan y el ciclo lo declara."""
        estado, ciclo = lector.comprobar_ciclo(self.candidatos, self._vacio(), self._pedir, max_consultas=3)
        self.assertEqual(len(self.pedidas), 3)
        self.assertEqual((ciclo["consultadas"], ciclo["sin_consultar"], ciclo["corte"]), (3, 2, lector.TOPE))
        self.assertEqual(len(estado[WEBS]), 3)

    def test_el_ciclo_siguiente_empieza_por_lo_no_consultado(self) -> None:
        """Lo nunca consultado va antes que lo consultado: tras dos ciclos de tope 3 se han visto los cinco."""
        estado, _ = lector.comprobar_ciclo(self.candidatos, self._vacio(), self._pedir, max_consultas=3)
        self.pedidas.clear()
        estado, ciclo = lector.comprobar_ciclo(self.candidatos, estado, self._pedir, max_consultas=3)
        self.assertEqual(len(estado[WEBS]), 5)
        self.assertEqual(len(set(self.pedidas)), 3)
        self.assertEqual(ciclo["sin_consultar"], 2)

    def test_el_plazo_corta_el_ciclo_y_lo_dice(self) -> None:
        """Agotado el tiempo, el ciclo para y declara su motivo."""
        tiempos = iter([0.0, 0.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0])
        _, ciclo = lector.comprobar_ciclo(
            self.candidatos, self._vacio(), self._pedir, max_consultas=10, plazo_s=5, reloj=lambda: next(tiempos)
        )
        self.assertEqual((ciclo["consultadas"], ciclo["corte"]), (1, lector.PLAZO))

    def test_un_enlace_que_ya_no_se_enseña_deja_de_guardarse(self) -> None:
        """Las observaciones de lo que Faro ya no enseña se retiran."""
        previo = self._vacio()
        previo[WEBS]["https://retirada.example/"] = anotar(None, _web(ANTES, 404))
        estado, _ = lector.comprobar_ciclo(self.candidatos, previo, self._pedir)
        self.assertNotIn("https://retirada.example/", estado[WEBS])

    def test_orden_de_consulta(self) -> None:
        """Primero lo nunca consultado, luego lo más antiguo, y a igualdad las webs antes que los programas."""
        antiguo, reciente = anotar(None, _web(ANTES, 200)), anotar(None, _web(DESPUES, 200))
        claves = sorted(
            [
                orden_de_consulta("b", reciente, WEBS),
                orden_de_consulta("a", antiguo, WEBS),
                orden_de_consulta("z", None, PROGRAMAS),
                orden_de_consulta("y", None, WEBS),
            ]
        )
        self.assertEqual([c[3] for c in claves], ["y", "z", "a", "b"])


class ConjuntoDelPaquete(unittest.TestCase):
    """Lo que enseña el paquete y las cifras del panel salen de las observaciones."""

    def setUp(self) -> None:
        """Los candidatos de un Consorci y una formación mínimos."""
        consorci = {
            "ediciones": [{"web": WEB}, {"web": None}, {"web": ""}],
            "entidades": {"a": {"web": WEB}, "b": {"web": "https://rota.example/"}},
        }
        formacion = {
            "cursos": [{"id": "25/1", "enlace": FICHA}],
            "especialidades": {"ADGD093PO": {}, "SEAD 0058": {}},
        }
        self.candidatos = candidatos(consorci, formacion)

    def test_los_candidatos_son_los_tres_conjuntos_sin_repetir(self) -> None:
        """Dos webs, una ficha y dos programas; la web repetida cuenta una vez y el código con espacio se escapa."""
        por_conjunto = {c: [x.url for x in self.candidatos if x.conjunto == c] for c in (WEBS, CURSOS, PROGRAMAS)}
        self.assertEqual(len(por_conjunto[WEBS]), 2)
        self.assertEqual(por_conjunto[CURSOS], [FICHA])
        self.assertIn(direccion_del_programa("SEAD 0058"), por_conjunto[PROGRAMAS])
        self.assertTrue(direccion_del_programa("SEAD 0058").endswith("SEAD%200058.pdf"))

    def test_las_cifras_y_lo_oculto_salen_de_las_observaciones(self) -> None:
        """Una web con 404 se oculta con su evidencia; una con 503 no; los programas se enlazan por su PDF."""
        estado = {WEBS: {}, CURSOS: {}, PROGRAMAS: {}}
        estado[WEBS][WEB] = anotar(None, _web(ANTES, 200))
        estado[WEBS]["https://rota.example/"] = anotar(None, observacion(ANTES, 404, "https://rota.example/"))
        estado[CURSOS][FICHA] = anotar(None, observacion(ANTES, 503, FICHA))
        adg = direccion_del_programa("ADGD093PO")
        estado[PROGRAMAS][adg] = anotar(None, observacion(ANTES, 200, adg, es_pdf=True, huella="b" * 64))
        estado[PROGRAMAS][direccion_del_programa("SEAD 0058")] = estado_heredado("2026-10-06T00:00:00+00:00")
        paquete = lector.conjunto_del_paquete(self.candidatos, estado)
        self.assertEqual(paquete["programas"]["codigos"], ["ADGD093PO", "SEAD 0058"])
        self.assertEqual(paquete["programas"]["comprobado"], "2026-10-06")
        self.assertEqual(
            paquete["webs"]["ocultas"],
            [
                {
                    "url": "https://rota.example/",
                    "codigo_http": 404,
                    "observado_el": ANTES,
                    "url_final": "https://rota.example/",
                }
            ],
        )
        self.assertEqual(paquete["cursos"]["ocultos"], [])
        self.assertEqual(lector.cifras(self.candidatos, estado), {"comprobados": 3, "ocultos": 1, "sin_comprobar": 2})


if __name__ == "__main__":
    unittest.main()
