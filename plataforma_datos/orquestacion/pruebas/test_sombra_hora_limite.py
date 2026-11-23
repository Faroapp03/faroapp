"""La consulta de páginas de la sombra no empieza una petición que la hora límite del motor cortaría."""

import contextlib
import hashlib
import io
import json
import unittest
from pathlib import Path

from plataforma_datos.cursos.altas_en_sombra import ALTAS
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import PARAMETROS
from plataforma_datos.cursos.comprobacion_pagina.pruebas import ejemplos as ej
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.pruebas.test_lectura_cibernarium import Instalacion, actividad
from plataforma_datos.cursos.publicar_catalogo import RUTA_REFERENCIA
from plataforma_datos.orquestacion.activacion_en_el_ciclo import Transporte
from plataforma_datos.orquestacion.hora_limite_del_motor import VARIABLE, segundos_hasta_la_hora_limite
from plataforma_datos.orquestacion.notas_de_la_sombra import Nota
from plataforma_datos.orquestacion.sombra_del_ciclo import (
    RESERVA_DE_LA_CONSULTA_S,
    decidir_en_sombra,
    fin_de_la_consulta,
    foto,
)

PASADO = "Sat Nov 14 12:00:00 CET 2026"
HOY = "2026-11-15T05:00:10Z"
SOLO_EDICIONES = (ALTAS[0],)


def servir_con_paginas(raiz: Path, ids: list[int]) -> None:
    """Sirve un catálogo de cursos con esas ediciones de Cibernàrium, cada una con su página y su título."""
    ofertas = [
        {"unidad": {"id": f"cibernarium-edicion:{i}"}, "url": f"{ej.URL_CURSO}{i}", "titulo_programa": ej.TITULO}
        for i in ids
    ]
    cuerpo = json.dumps({"ofertas": ofertas}).encode()
    huella = hashlib.sha256(cuerpo).hexdigest()
    ruta = f"datos/catalogo-cursos/{huella}.json"
    (raiz / "web" / ruta).parent.mkdir(parents=True, exist_ok=True)
    (raiz / "web" / ruta).write_bytes(cuerpo)
    (raiz / "web" / RUTA_REFERENCIA).parent.mkdir(parents=True, exist_ok=True)
    referencia = f"export const REFERENCIA = Object.freeze({{\n  ruta: '{ruta}',\n  sha256: '{huella}',\n}});\n"
    (raiz / "web" / RUTA_REFERENCIA).write_text(referencia)


class FinDeLaConsulta(unittest.TestCase):
    """El final de la consulta es su tope, salvo que la hora límite del motor no deje su reserva."""

    def test_sin_hora_limite_o_con_tiempo_de_sobra_es_su_tope(self) -> None:
        """Sin hora límite, o lejos de ella, la consulta dura su tope."""
        self.assertEqual(fin_de_la_consulta(100.0, None), 100.0 + PARAMETROS.tope_s)
        self.assertEqual(fin_de_la_consulta(100.0, 3600.0), 100.0 + PARAMETROS.tope_s)

    def test_cerca_de_la_hora_limite_deja_su_reserva(self) -> None:
        """Cerca de la hora límite acaba antes; si ya no cabe su reserva, acaba antes de empezar."""
        quedan = RESERVA_DE_LA_CONSULTA_S + 10.0
        self.assertEqual(fin_de_la_consulta(100.0, quedan), 110.0)
        self.assertLessEqual(fin_de_la_consulta(100.0, RESERVA_DE_LA_CONSULTA_S - 1.0), 100.0)
        self.assertGreater(RESERVA_DE_LA_CONSULTA_S, PARAMETROS.tope_s)

    def test_los_segundos_hasta_la_hora_limite_salen_del_entorno(self) -> None:
        """La hora límite es la que fija el supervisor en el entorno del motor."""
        self.assertIsNone(segundos_hasta_la_hora_limite({}, reloj=lambda: 0.0))
        self.assertEqual(segundos_hasta_la_hora_limite({VARIABLE: "1000"}, reloj=lambda: 940.0), 60.0)


class LaSombraRespetaLaHoraLimite(unittest.TestCase):
    """Con una retirada de Cibernàrium que consultar, la hora límite decide si se pide su página."""

    def decidir(self, quedan: float | None) -> tuple[list[str], list[Nota]]:
        """Un ciclo cuyo fin publicado ya pasado retira una edición servida con página.

        Returns:
            Las direcciones pedidas y las notas de la fuente.
        """
        sitio = Instalacion(self)
        servir_con_paginas(sitio.raiz, [1, 2])
        antes = foto(sitio.raiz, SOLO_EDICIONES)
        sitio.ciclo([actividad(1), actividad(2, fin=PASADO)], HOY)
        pedidas: list[str] = []

        def pedir(url: str, _hasta: float) -> Respuesta:
            pedidas.append(url)
            return ej.sonda(url=url, url_final=url)

        transporte = Transporte(pedir=pedir, reloj=lambda: 0.0, instante=lambda: ej.HORA)
        with contextlib.redirect_stdout(io.StringIO()):
            notas = decidir_en_sombra(sitio.raiz, antes, SOLO_EDICIONES, transporte, hora_limite=lambda: quedan)
        return pedidas, [n for n in notas if n.fuente == "barcelonactiva"]

    def test_sin_hora_limite_se_pide_la_pagina(self) -> None:
        """Sin hora límite, la consulta pide la página de la retirada."""
        pedidas, notas = self.decidir(None)
        self.assertTrue(pedidas)
        self.assertEqual([n.estado for n in notas][:1], ["comprobada"])
        self.assertIsNone(notas[0].motivo)

    def test_sin_tiempo_antes_de_la_hora_limite_no_se_pide_nada_y_se_anota(self) -> None:
        """Si la hora límite del motor está a menos de la reserva, no empieza ninguna petición: «sin-tiempo»."""
        pedidas, notas = self.decidir(RESERVA_DE_LA_CONSULTA_S - 1.0)
        self.assertEqual(pedidas, [])
        self.assertEqual((notas[0].estado, notas[0].motivo, notas[0].sin_comprobar), ("comprobada", "sin-tiempo", 1))


if __name__ == "__main__":
    unittest.main()
