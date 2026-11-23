"""La regla de retirada de una fuente se activa sola al reunir la evidencia, no antes, y vuelve sola a sombra."""

import unittest

from plataforma_datos.cursos.activacion_de_la_retirada import (
    ACTIVA,
    ACTIVADA,
    CRITERIO,
    SOMBRA,
    VUELTA_A_SOMBRA,
    Ciclo,
    Estado,
    siguiente,
)
from plataforma_datos.cursos.intervalo_de_jeffreys import intervalo_de_jeffreys


def ciclos(reparto: list[int], *, contradicen: dict[int, int] | None = None, salud: bool = True) -> Estado:
    """Pasa una fuente en sombra por un ciclo por cada número del reparto, con esas confirmaciones.

    Returns:
        El estado tras el último ciclo.
    """
    contradicen = contradicen or {}
    estado = Estado()
    for posicion, confirman in enumerate(reparto):
        ciclo = Ciclo(
            ciclo=f"{posicion:064x}",
            confirman=confirman,
            contradicen=contradicen.get(posicion, 0),
            aplicada_contradicha=False,
            salud_con_historia=salud,
        )
        estado = siguiente(estado, ciclo)
    return estado


def activa() -> Estado:
    """Una fuente recién activada con 30 decisiones en 7 ciclos.

    Returns:
        Su estado.
    """
    return ciclos([5, 5, 4, 4, 4, 4, 4])


class Activacion(unittest.TestCase):
    """Se activa al cumplir el criterio y ni un caso antes."""

    def test_con_30_decisiones_en_7_ciclos_se_activa_sola(self) -> None:
        """30 comprobadas sin error en 7 ciclos, con la salud calibrada: activa, con el cambio y la cifra."""
        estado = activa()
        self.assertEqual((estado.estado, estado.cambio, estado.confirmadas, estado.ciclos), (ACTIVA, ACTIVADA, 30, 7))

    def test_con_29_decisiones_no(self) -> None:
        """Una decisión menos y sigue en sombra."""
        self.assertEqual(ciclos([5, 4, 4, 4, 4, 4, 4]).estado, SOMBRA)

    def test_con_30_decisiones_en_6_ciclos_no(self) -> None:
        """Toda la evidencia en seis ciclos no basta: hace falta un séptimo con alguna confirmación."""
        self.assertEqual(ciclos([5, 5, 5, 5, 5, 5]).estado, SOMBRA)
        self.assertEqual(ciclos([5, 5, 5, 5, 5, 5, 0]).estado, SOMBRA, "un ciclo sin confirmaciones no cuenta")
        self.assertEqual(ciclos([5, 5, 5, 5, 5, 5, 1]).estado, ACTIVA)

    def test_con_una_contradicha_no(self) -> None:
        """Una sola retirada que la página contradice deja la cuenta a cero y no se activa."""
        estado = ciclos([5, 5, 4, 4, 4, 4, 4], contradicen={3: 1})
        self.assertEqual((estado.estado, estado.confirmadas, estado.ciclos), (SOMBRA, 12, 3))

    def test_sin_salud_calibrada_no(self) -> None:
        """Sin historia suficiente en la salud de la fuente, la evidencia no basta."""
        self.assertEqual(ciclos([5, 5, 4, 4, 4, 4, 4], salud=False).estado, SOMBRA)

    def test_un_ciclo_ya_contado_no_suma(self) -> None:
        """Repetir el mismo ciclo no cambia nada."""
        estado = ciclos([5])
        repetido = Ciclo(
            ciclo=estado.ultimo_ciclo, confirman=5, contradicen=0, aplicada_contradicha=False, salud_con_historia=True
        )
        self.assertIs(siguiente(estado, repetido), estado)

    def test_las_cifras_se_declaran_en_un_solo_sitio_con_su_porque(self) -> None:
        """30 y 7; 30 es el menor número de casos sin error con una cota de Jeffreys por debajo del 8 %."""
        self.assertEqual((CRITERIO.decisiones_minimas, CRITERIO.ciclos_minimos), (30, 7))
        self.assertLess(intervalo_de_jeffreys(0, 30)[1], 0.08)
        self.assertGreaterEqual(intervalo_de_jeffreys(0, 29)[1], 0.08)


class VueltaASombra(unittest.TestCase):
    """Con la regla activa, el primer error la devuelve a sombra y la cuenta empieza de nuevo."""

    def siguiente_con(self, *, contradicen: int = 0, aplicada_contradicha: bool = False) -> Estado:
        """El estado de una fuente activa tras un ciclo con ese error.

        Returns:
            El estado siguiente.
        """
        ciclo = Ciclo(
            ciclo="f" * 64,
            confirman=3,
            contradicen=contradicen,
            aplicada_contradicha=aplicada_contradicha,
            salud_con_historia=True,
        )
        return siguiente(activa(), ciclo)

    def test_un_curso_retirado_que_reaparece_la_devuelve_a_sombra(self) -> None:
        """La medida del error ve una retirada aplicada en una lectura sana posterior: vuelve a sombra."""
        estado = self.siguiente_con(aplicada_contradicha=True)
        self.assertEqual(
            (estado.estado, estado.cambio, estado.confirmadas, estado.ciclos), (SOMBRA, VUELTA_A_SOMBRA, 0, 0)
        )

    def test_una_pagina_que_sigue_viva_la_devuelve_a_sombra(self) -> None:
        """La página de una retirada aplicada sigue abierta: vuelve a sombra."""
        self.assertEqual(self.siguiente_con(contradicen=1).cambio, VUELTA_A_SOMBRA)

    def test_sin_errores_sigue_activa_y_sin_aviso(self) -> None:
        """Un ciclo sin errores la deja activa y no repite el aviso de la activación."""
        estado = self.siguiente_con()
        self.assertEqual((estado.estado, estado.cambio, estado.confirmadas), (ACTIVA, None, 33))


if __name__ == "__main__":
    unittest.main()
