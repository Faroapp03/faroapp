"""El ciclo contrasta las retiradas de cada fuente con su página o su API y con la medida del error, y deja su modo."""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.activacion_de_la_retirada import CRITERIO
from plataforma_datos.cursos.aplicacion_de_la_retirada import regla_activa, retiradas_por_la_regla
from plataforma_datos.cursos.comprobacion_api.pruebas import ejemplos as api
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.comprobacion_pagina.pruebas import ejemplos as ej
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.decisiones_retirada import guardar_registro as guardar_decisiones
from plataforma_datos.cursos.estado_de_la_retirada import carpeta_del_estado, guardar_registro, ultimo_registro
from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas
from plataforma_datos.cursos.lecturas.contrato_lectura import bytes_de
from plataforma_datos.cursos.pruebas.ejemplos_retirada import CURSO
from plataforma_datos.cursos.pruebas.test_error_de_retirada import lecturas_de, registros_de
from plataforma_datos.orquestacion.activacion_en_el_ciclo import Transporte, TransporteSinDatos, actualizar_fuente

ACADEMY = ("claude_academy", "claude_academy:curso")
FORMACION = "formacion"
CITILAB = ("citilab", "citilab:formacio")
FICHAS = {CURSO: Ficha(url=ej.URL_CURSO, titulo=ej.TITULO)}


def grabado(estado_http: int, datos: dict[str, Respuesta] | None = None) -> Transporte:
    """Un transporte que responde a la ficha del curso con ese estado y a la sonda con la ficha genérica.

    `datos` son las respuestas de las API por su dirección; sin ellas, el transporte no pide ninguna API.

    Returns:
        El transporte, con un reloj quieto y la hora de las pruebas.
    """

    def pedir(url: str, _hasta: float) -> Respuesta:
        if url == ej.URL_CURSO:
            return ej.respuesta(http=estado_http)
        return ej.sonda(url=url, url_final=url)

    if datos is None:
        return Transporte(pedir=pedir, reloj=lambda: 0.0, instante=lambda: ej.HORA)
    return Transporte(pedir=pedir, reloj=lambda: 0.0, instante=lambda: ej.HORA, pedir_datos=lambda u, _h: datos[u])


def retirada_como(registros: list[dict], curso: str) -> list[dict]:
    """Los mismos registros de decisiones, con el curso retirado bajo otro identificador de la fuente.

    Returns:
        Los registros.
    """
    return [{**r, "decisiones": [{**d, "curso": curso} for d in r["decisiones"]]} for r in registros]


def preparar(raiz: Path, lecturas: list[dict], registros: list[dict]) -> None:
    """Deja las lecturas y sus registros de decisiones en el almacén de la instalación."""
    for lectura in lecturas:
        carpeta = carpeta_de_lecturas(raiz, lectura["fuente"])
        carpeta.mkdir(parents=True, exist_ok=True)
        (carpeta / f"{lectura['lectura_id']}.json").write_bytes(bytes_de(lectura))
    for registro in registros:
        guardar_decisiones(raiz, registro)


def activa_con(raiz: Path, fuente: str, aplicadas: list[str]) -> None:
    """Guarda el estado de una fuente activa cuyas decisiones de esas lecturas ya se aplicaron."""
    guardar_registro(
        raiz,
        {
            "version": 1,
            "fuente": fuente,
            "numero": 1,
            "ciclo": sha256_json(sorted(aplicadas)),
            "lecturas": sorted(aplicadas),
            "observado_utc": "2026-11-13T05:00:00Z",
            "en_el_ciclo": "activa",
            "estado": "activa",
            "cambio": None,
            "ultimo_cambio": {"cambio": "activada", "decisiones": 30, "observado_utc": "2026-11-12T05:00:00Z"},
            "confirmadas": 30,
            "ciclos": 7,
            "aplicadas": sorted(aplicadas),
            "consulta": {"confirman": 0, "contradicen": 0, "no_se_sabe": 0, "sin_comprobar": 0, "motivo": None},
            "comprobaciones": [],
            "aplicada_contradicha": False,
            "salud_con_historia": True,
            "criterio": CRITERIO.a_json(),
        },
    )


class Instalacion(unittest.TestCase):
    """Cada caso trabaja en una instalación temporal propia."""

    def setUp(self) -> None:
        """Crea la instalación."""
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.raiz = Path(carpeta.name)


class EnSombra(Instalacion):
    """En sombra, la página de cada retirada suma o reinicia la evidencia, y nada más."""

    def test_una_pagina_que_confirma_suma_evidencia(self) -> None:
        """La regla retira con dos ausencias sanas y la página da 404: una decisión comprobada, en sombra."""
        lecturas = lecturas_de("1100", ACADEMY)
        preparar(self.raiz, lecturas, registros_de(lecturas, desde=3))
        notas = actualizar_fuente(
            self.raiz, ACADEMY[0], [lecturas[3]], fichas=FICHAS, transporte=grabado(404), hasta=60.0
        )
        registro = ultimo_registro(self.raiz, ACADEMY[0])
        self.assertEqual((registro["estado"], registro["confirmadas"], registro["ciclos"]), ("sombra", 1, 1))
        self.assertEqual(len(registro["comprobaciones"]), 1)
        self.assertEqual([(n.estado, n.confirman) for n in notas], [("comprobada", 1)])
        self.assertEqual(retiradas_por_la_regla(self.raiz, ACADEMY[0]), frozenset())

    def test_una_pagina_que_sigue_viva_deja_la_cuenta_a_cero(self) -> None:
        """La página de la retirada sigue abierta: la cuenta vuelve a cero y la fuente sigue en sombra."""
        lecturas = lecturas_de("1100", ACADEMY)
        preparar(self.raiz, lecturas, registros_de(lecturas, desde=3))
        ficha = ej.pagina(f"<h1>{ej.TITULO}</h1><p>{ej.RELLENO}</p><a>Start course</a>", cabecera=ej.TITULO)
        abierta = Transporte(
            pedir=lambda url, _h: ej.respuesta(ficha) if url == ej.URL_CURSO else ej.sonda(url=url, url_final=url),
            reloj=lambda: 0.0,
            instante=lambda: ej.HORA,
        )
        notas = actualizar_fuente(self.raiz, ACADEMY[0], [lecturas[3]], fichas=FICHAS, transporte=abierta, hasta=60.0)
        self.assertEqual((notas[0].estado, notas[0].confirman, notas[0].contradicen), ("comprobada", 0, 1))
        self.assertEqual(ultimo_registro(self.raiz, ACADEMY[0])["confirmadas"], 0)

    def test_el_mismo_ciclo_no_se_cuenta_dos_veces(self) -> None:
        """Repetir el paso con las mismas lecturas no deja otro registro ni otra nota."""
        lecturas = lecturas_de("1100", ACADEMY)
        preparar(self.raiz, lecturas, registros_de(lecturas, desde=3))
        actualizar_fuente(self.raiz, ACADEMY[0], [lecturas[3]], fichas=FICHAS, transporte=grabado(404), hasta=60.0)
        self.assertEqual(
            actualizar_fuente(self.raiz, ACADEMY[0], [lecturas[3]], fichas=FICHAS, transporte=grabado(404), hasta=60.0),
            [],
        )
        self.assertEqual(len(list(carpeta_del_estado(self.raiz, ACADEMY[0]).iterdir())), 1)


class Activa(Instalacion):
    """Con la regla activa, una retirada aplicada que reaparece la devuelve a sombra, solo en su fuente."""

    def test_un_curso_retirado_que_reaparece_la_devuelve_a_sombra_y_no_toca_otra_fuente(self) -> None:
        """El curso retirado con la regla activa vuelve en la lectura sana siguiente: vuelta a sombra, con su aviso."""
        lecturas = lecturas_de("11001")
        preparar(self.raiz, lecturas, registros_de(lecturas, desde=3))
        activa_con(self.raiz, FORMACION, [lecturas[3]["lectura_id"]])
        otra = lecturas_de("1100", ACADEMY)
        preparar(self.raiz, otra, registros_de(otra, desde=3))
        activa_con(self.raiz, ACADEMY[0], [otra[3]["lectura_id"]])
        estado_de_la_otra = ultimo_registro(self.raiz, ACADEMY[0])
        notas = actualizar_fuente(self.raiz, FORMACION, [lecturas[4]], fichas={}, transporte=grabado(404), hasta=60.0)
        registro = ultimo_registro(self.raiz, FORMACION)
        self.assertEqual(
            (registro["numero"], registro["estado"], registro["cambio"], registro["aplicada_contradicha"]),
            (2, "sombra", "vuelta-a-sombra", True),
        )
        cambio = {"cambio": "vuelta-a-sombra", "decisiones": 30, "observado_utc": lecturas[4]["observado_utc"]}
        self.assertEqual(registro["ultimo_cambio"], cambio)
        self.assertEqual([n.estado for n in notas], ["comprobada", "vuelta-a-sombra"])
        self.assertFalse(regla_activa(self.raiz, FORMACION))
        self.assertEqual(ultimo_registro(self.raiz, ACADEMY[0]), estado_de_la_otra)
        self.assertTrue(regla_activa(self.raiz, ACADEMY[0]))
        self.assertEqual(retiradas_por_la_regla(self.raiz, ACADEMY[0]), {CURSO})

    def test_sin_reaparicion_sigue_activa_y_vigila_tambien_lo_nuevo(self) -> None:
        """El curso sigue ausente: la regla sigue activa y las decisiones de este ciclo pasan a vigilarse."""
        lecturas = lecturas_de("11000")
        preparar(self.raiz, lecturas, registros_de(lecturas, desde=3))
        activa_con(self.raiz, FORMACION, [lecturas[3]["lectura_id"]])
        sin_el_curso = grabado(404, {api.soc().url: api.soc()})
        notas = actualizar_fuente(self.raiz, FORMACION, [lecturas[4]], fichas={}, transporte=sin_el_curso, hasta=60.0)
        registro = ultimo_registro(self.raiz, FORMACION)
        esperadas = sorted(lectura["lectura_id"] for lectura in lecturas[3:])
        self.assertEqual((registro["estado"], registro["cambio"], registro["aplicadas"]), ("activa", None, esperadas))
        self.assertEqual([(n.estado, n.confirman, n.motivo) for n in notas], [("comprobada", 1, None)])


class PorApi(Instalacion):
    """En las fuentes cuya página no decide, la API de la fuente suma o reinicia la evidencia como la página."""

    def test_la_api_que_confirma_suma_evidencia_y_el_registro_dice_su_origen(self) -> None:
        """El curso del SOC ya no está en la oferta oficial: una decisión comprobada por API, en sombra."""
        lecturas = lecturas_de("1100")
        preparar(self.raiz, lecturas, registros_de(lecturas, desde=3))
        transporte = grabado(404, {api.soc().url: api.soc()})
        notas = actualizar_fuente(self.raiz, FORMACION, [lecturas[3]], fichas={}, transporte=transporte, hasta=60.0)
        registro = ultimo_registro(self.raiz, FORMACION)
        self.assertEqual((registro["estado"], registro["confirmadas"], registro["ciclos"]), ("sombra", 1, 1))
        (comprobacion,) = registro["comprobaciones"]
        self.assertEqual((comprobacion["regla"]["id"], comprobacion["url"]), ("comprobacion-api", api.soc().url))
        self.assertEqual([(n.estado, n.confirman, n.motivo) for n in notas], [("comprobada", 1, None)])

    def test_la_api_que_lo_sigue_ofertando_deja_la_cuenta_a_cero(self) -> None:
        """El curso sigue abierto en la oferta oficial: contradice la retirada y la cuenta vuelve a cero."""
        lecturas = lecturas_de("1100")
        preparar(self.raiz, lecturas, retirada_como(registros_de(lecturas, desde=3), api.CURSO_SOC))
        transporte = grabado(404, {api.soc().url: api.soc()})
        notas = actualizar_fuente(self.raiz, FORMACION, [lecturas[3]], fichas={}, transporte=transporte, hasta=60.0)
        self.assertEqual((notas[0].confirman, notas[0].contradicen), (0, 1))
        self.assertEqual(ultimo_registro(self.raiz, FORMACION)["confirmadas"], 0)

    def test_citilab_bloqueado_no_cuenta_y_no_toca_otra_fuente(self) -> None:
        """La API de Citilab responde la página antirrobots: no se sabe, no se rodea y el SOC sigue a lo suyo."""
        soc = lecturas_de("1100")
        preparar(self.raiz, soc, registros_de(soc, desde=3))
        actualizar_fuente(
            self.raiz, FORMACION, [soc[3]], fichas={}, transporte=grabado(404, {api.soc().url: api.soc()}), hasta=60.0
        )
        estado_del_soc = ultimo_registro(self.raiz, FORMACION)
        citilab = lecturas_de("1100", CITILAB)
        preparar(self.raiz, citilab, retirada_como(registros_de(citilab, desde=3), api.FICHA_CITILAB))
        bloqueada = grabado(404, {api.comprobacion_antirrobots().url: api.comprobacion_antirrobots(403)})
        notas = actualizar_fuente(self.raiz, CITILAB[0], [citilab[3]], fichas={}, transporte=bloqueada, hasta=60.0)
        self.assertEqual([(n.estado, n.no_se_sabe, n.confirman) for n in notas], [("comprobada", 1, 0)])
        registro = ultimo_registro(self.raiz, CITILAB[0])
        self.assertEqual(
            (registro["confirmadas"], registro["comprobaciones"][0]["motivo"]), (0, "pagina_de_comprobacion")
        )
        self.assertEqual(ultimo_registro(self.raiz, FORMACION), estado_del_soc)

    def test_un_transporte_sin_api_no_sale_a_la_red(self) -> None:
        """Un transporte grabado que solo responde páginas falla al pedirle una API, en lugar de salir a la red."""
        lecturas = lecturas_de("1100")
        preparar(self.raiz, lecturas, registros_de(lecturas, desde=3))
        with self.assertRaises(TransporteSinDatos):
            actualizar_fuente(self.raiz, FORMACION, [lecturas[3]], fichas={}, transporte=grabado(404), hasta=60.0)
        self.assertIsNone(ultimo_registro(self.raiz, FORMACION))


if __name__ == "__main__":
    unittest.main()
