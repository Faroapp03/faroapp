"""Pruebas del contraste de la oferta FPCAT (7vig-4syr) con la versión de jdcj-za6r en vigor cuando se actualizó."""

import unittest
from typing import Any

import plataforma_datos.cursos.fuentes.consorci.conjunto as conjunto_consorci
import plataforma_datos.cursos.fuentes.consorci.constantes as constantes_consorci
import plataforma_datos.cursos.fuentes.consorci.lector as consorci
from plataforma_datos.comun.nucleo import CORRECTO, ERROR, Controles
from plataforma_datos.cursos.fuentes.consorci.oferta_emparejada import (
    DISTINTA,
    IDENTICA,
    NO_COMPARABLE,
    contrastar,
    en_vigor,
    historial_con,
    huella_de_la_oferta,
    version_de_la_oferta,
)

# Cifras y huellas de copias reales. 7vig-4syr tiene una sola versión en las tres (actualizada el 05/10 a las 15:03:05
# UTC), cuya oferta del Consorci es idéntica a la de jdcj-za6r del 05/10. De la copia del 06/10 solo se conoce el día de
# actualización de jdcj-za6r; la descarga de la copia del 11/10 es la hora de sus archivos.
HUELLA_05 = "bf5827a493455836895ef5dda24afd085670113070a5a44580bc5e5ff6c16545"
OFERTA_REAL = {"actualizado": "2026-10-05T15:03:05+00:00", "con_fecha": 671, "huella": HUELLA_05}
CURSOS_06 = {
    "actualizado": "2026-10-05",
    "descargado_utc": "2026-10-05T22:01:29.852349+00:00",
    "con_fecha": 671,
    "huella": HUELLA_05,
}
CURSOS_07 = {
    "actualizado": "2026-10-07T00:15:17+00:00",
    "descargado_utc": "2026-10-07T03:52:34.629424+00:00",
    "con_fecha": 654,
    "huella": "61e4c27faaff8e20961ee94dc25e3c0564e4db4c75668a94c428d7604bce5716",
}
CURSOS_11 = {
    "actualizado": "2026-10-11T00:15:31+00:00",
    "descargado_utc": "2026-10-11T19:32:06+00:00",
    "con_fecha": 599,
    "huella": "9440077fbabfd39896db88aa363e96d451d96cb2b15a09a3cbc5a8dc6724d345",
}
HISTORIAL = [CURSOS_06]


def curso(oferta: str, inicio: str) -> dict[str, str]:
    """Una fila con su código de oferta y su fecha de inicio tal como la publica jdcj-za6r (dd/mm/aaaa).

    Args:
        oferta: El código de la oferta.
        inicio: La fecha de inicio, dd/mm/aaaa.

    Returns:
        La fila con las dos columnas.
    """
    return {"codi_oferta_curs_centre": oferta, "data_inici_oferta_curs_centre": inicio}


def version(
    pares: list[tuple[str, str]], actualizado: str, descargado: str = "2026-10-05T22:00:00+00:00"
) -> dict[str, Any]:
    """Una versión sintética de la oferta.

    Args:
        pares: Pares (código de oferta, fecha de inicio).
        actualizado: La fecha de actualización de la versión.
        descargado: El momento de la descarga.

    Returns:
        La versión sintética de la oferta.
    """
    return version_de_la_oferta(pares, actualizado, descargado)


class PruebaCopiasReales(unittest.TestCase):
    """Copias reales: la del 06/10 tiene pareja en la copia; las del 07/10 y del 11/10, en el historial o ninguna."""

    def test_copia_del_06_identica_con_su_propia_version(self) -> None:
        """La versión de jdcj-za6r de la copia pudo estar en vigor a las 15:03 del 05/10: 671 = 671."""
        contraste = contrastar(OFERTA_REAL, CURSOS_06, [])
        self.assertEqual(contraste["resultado"], IDENTICA)
        self.assertEqual(contraste["comparada_con"], ["2026-10-05"])

    def test_copias_del_07_y_del_11_con_el_historial(self) -> None:
        """Su jdcj-za6r es posterior a 7vig-4syr: la pareja es la versión admitida del 05/10, idéntica."""
        for cursos in (CURSOS_07, CURSOS_11):
            with self.subTest(cursos=cursos["actualizado"]):
                self.assertNotEqual(cursos["con_fecha"], OFERTA_REAL["con_fecha"])
                contraste = contrastar(OFERTA_REAL, cursos, HISTORIAL)
                self.assertEqual(contraste["resultado"], IDENTICA)
                self.assertEqual(contraste["comparada_con"], ["2026-10-05"])

    def test_copias_del_07_y_del_11_sin_pareja(self) -> None:
        """Sin el historial no hay pareja: «no comparable», con el desfase en días, ni verde ni rojo."""
        for cursos, dias in ((CURSOS_07, 2), (CURSOS_11, 6)):
            with self.subTest(dias=dias):
                contraste = contrastar(OFERTA_REAL, cursos, [])
                self.assertEqual(contraste["resultado"], NO_COMPARABLE)
                self.assertEqual(contraste["desfase_dias"], dias)


class PruebaRegla(unittest.TestCase):
    """Identidad sin tolerancia con la pareja, límites de la vigencia y formato."""

    PARES = [("A1", "2026-10-20"), ("B2", "2026-11-03"), ("B2", "2026-11-03")]

    def test_contradiccion_real(self) -> None:
        """Con pareja, falta una oferta, una fecha cambia con el mismo recuento o 7vig-4syr no trae filas: falla."""
        cursos = version(self.PARES, "2026-10-05T00:15:00+00:00")
        cambios = {
            "falta una": self.PARES[:2],
            "fecha cambiada": [("A1", "2026-10-21"), *self.PARES[1:]],
            "una repetida menos": [*self.PARES[:2], ("C3", "2026-11-03")],
            "sin filas del Consorci": [],
        }
        for que, pares in cambios.items():
            with self.subTest(que=que):
                oferta = version(pares, "2026-10-05T15:03:05+00:00")
                self.assertEqual(contrastar(oferta, cursos, [])["resultado"], DISTINTA)
        oferta = version(list(reversed(self.PARES)), "2026-10-05T15:03:05+00:00")
        self.assertEqual(contrastar(oferta, cursos, [])["resultado"], IDENTICA)

    def test_limites_de_la_vigencia(self) -> None:
        """En vigor desde su actualización hasta su descarga, incluidas; un día sin hora cuenta desde las 00:00."""
        cursos = version(self.PARES, "2026-10-05T00:15:00+00:00", "2026-10-05T22:01:29+00:00")
        casos = {
            "2026-10-05T00:15:00+00:00": True,
            "2026-10-05T22:01:29+00:00": True,
            "2026-10-05T22:01:29.000001+00:00": False,
            "2026-10-05T00:14:59+00:00": False,
            "2026-10-05T02:14:59+02:00": False,
        }
        for instante, esperado in casos.items():
            with self.subTest(instante=instante):
                self.assertEqual(en_vigor(cursos, instante), esperado)
        self.assertTrue(en_vigor({**cursos, "actualizado": "2026-10-05"}, "2026-10-05T00:00:00+00:00"))
        with self.assertRaises(ValueError):
            en_vigor(cursos, "2026-10-05T15:03:05")

    def test_varias_parejas_posibles(self) -> None:
        """Si dos versiones pudieron estar en vigor, la oferta debe ser idéntica a las dos: lo dudoso solo rechaza."""
        oferta = version(self.PARES, "2026-10-05T15:03:05+00:00")
        igual = version(self.PARES, "2026-10-05")
        otra = version(self.PARES[:2], "2026-10-05T10:00:00+00:00", "2026-10-05T16:00:00+00:00")
        self.assertEqual(contrastar(oferta, igual, [])["resultado"], IDENTICA)
        self.assertEqual(contrastar(oferta, igual, [otra])["resultado"], DISTINTA)

    def test_pares_de_cada_conjunto(self) -> None:
        """jdcj-za6r: solo cursos con fecha; 7vig-4syr: todas sus filas, y una fecha ilegible nunca coincide."""
        cursos = [curso("A1", "20/10/2026"), curso("B2", "En programació")]
        fpcat = [{"codi_oferta_curs_centre": "A1", "data_inici_oferta_curs_centre": "2026-10-20T00:00:00.000"}]
        self.assertEqual(consorci.pares_de_la_oferta(cursos), [("A1", "2026-10-20")])
        self.assertEqual(consorci.pares_de_la_fpcat(fpcat), [("A1", "2026-10-20")])
        ilegible = [{"codi_oferta_curs_centre": "A1", "data_inici_oferta_curs_centre": "20-10-2026"}]
        self.assertNotEqual(
            huella_de_la_oferta(consorci.pares_de_la_fpcat(ilegible)),
            huella_de_la_oferta(consorci.pares_de_la_oferta(cursos)),
        )

    def test_historial_sin_repetidas(self) -> None:
        """Una versión admitida entra una vez, en orden de actualización."""
        nueva = version(self.PARES, "2026-10-07T00:15:17+00:00")
        historial = historial_con(HISTORIAL, nueva)
        self.assertEqual(historial, [CURSOS_06, nueva])
        self.assertEqual(historial_con(historial, nueva), historial)

    def test_historial_conserva_la_ultima_observacion_admitida(self) -> None:
        """Reobservar una versión amplía su vigencia conocida y conserva el contraste en copias posteriores."""
        previa = version(self.PARES, "2026-10-05T00:15:00+00:00")
        reobservada = {**previa, "descargado_utc": "2026-10-06T22:00:00+00:00"}
        historial = historial_con([previa], reobservada)
        self.assertEqual(historial, [reobservada])
        self.assertEqual(historial_con(historial, previa), historial, "una observación anterior no recorta la vigencia")
        self.assertEqual(previa["descargado_utc"], "2026-10-05T22:00:00+00:00", "no cambia la versión recibida")
        posterior = version(self.PARES, "2026-10-07T00:15:00+00:00", "2026-10-07T22:00:00+00:00")
        for pares, esperado in ((self.PARES, IDENTICA), (self.PARES[:2], DISTINTA)):
            with self.subTest(resultado=esperado):
                oferta = version(pares, "2026-10-06T12:00:00+00:00")
                self.assertEqual(contrastar(oferta, posterior, historial)["resultado"], esperado)

    def test_historial_compara_descargas_por_instante(self) -> None:
        """Las zonas se comparan por instante: una representación distinta no sustituye una descarga igual."""
        previa = version(self.PARES, "2026-10-05T00:15:00+00:00", "2026-10-06T22:00:00+00:00")
        for descarga in ("2026-10-06T23:00:00+01:00", "2026-10-07T01:00:00+04:00"):
            with self.subTest(descarga=descarga):
                self.assertEqual(historial_con([previa], {**previa, "descargado_utc": descarga}), [previa])
        posterior = "2026-10-06T20:30:00-02:00"
        self.assertEqual(
            historial_con([previa], {**previa, "descargado_utc": posterior}),
            [{**previa, "descargado_utc": posterior}],
        )


class PruebaControles(unittest.TestCase):
    """Lo que el contraste deja en la lista de controles de `validacion.json`."""

    def controles(self, cursos: dict[str, Any], **cambios: int) -> tuple[list[dict[str, str]], dict[str, Any]]:
        """Los controles del contraste y su resultado, con el historial real y los recuentos indicados.

        Args:
            cursos: El contraste de los cursos.
            **cambios: Los recuentos del resumen que sustituyen a los de base.

        Returns:
            La lista de controles y el resultado del contraste.
        """
        resumen = {
            "conjuntos": {
                constantes_consorci.CURSOS.identificador: {
                    "filas": 4471,
                    "con_fecha_o_en_programacion": 4471,
                    "oferta": cursos,
                    **cambios,
                },
                constantes_consorci.OFERTA.identificador: {"oferta": OFERTA_REAL},
            }
        }
        preparados = constantes_consorci.Preparados([], [], {}, resumen, tuple(HISTORIAL))
        controles = Controles()
        contraste = conjunto_consorci._controles_del_contraste(controles, preparados)
        return controles.lista, contraste

    def test_formato_siempre_y_contraste_con_pareja(self) -> None:
        """El formato de las fechas se evalúa siempre; la identidad con su pareja, como un control más."""
        lista, contraste = self.controles(CURSOS_11)
        self.assertEqual([control["resultado"] for control in lista], [CORRECTO, CORRECTO])
        self.assertIn("(2026-10-05)", lista[1]["control"])
        self.assertEqual(contraste["resultado"], IDENTICA)
        lista, _ = self.controles(CURSOS_11, con_fecha_o_en_programacion=4470)
        self.assertEqual([control["resultado"] for control in lista], [ERROR, CORRECTO])

    def test_no_comparable_no_es_un_control(self) -> None:
        """Sin pareja solo queda el control del formato; el contraste vuelve «no comparable» con su desfase."""
        resumen = {
            "conjuntos": {
                constantes_consorci.CURSOS.identificador: {
                    "filas": 1,
                    "con_fecha_o_en_programacion": 1,
                    "oferta": CURSOS_11,
                },
                constantes_consorci.OFERTA.identificador: {"oferta": OFERTA_REAL},
            }
        }
        controles = Controles()
        contraste = conjunto_consorci._controles_del_contraste(
            controles, constantes_consorci.Preparados([], [], {}, resumen)
        )
        self.assertEqual(len(controles.lista), 1)
        self.assertEqual((contraste["resultado"], contraste["desfase_dias"]), (NO_COMPARABLE, 6))


if __name__ == "__main__":
    unittest.main()
