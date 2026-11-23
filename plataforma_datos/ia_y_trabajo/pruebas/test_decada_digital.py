"""Artículo 4 de la Década Digital: extracción y validación autónomas."""

import unittest
from typing import Any
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector as decada_digital
from plataforma_datos.comun.nucleo import FormatoInesperado


class PruebaArticulo4(unittest.TestCase):
    """La lectura del artículo y su correspondencia con el original."""

    def test_el_marcado_con_mayor_que_en_un_atributo_no_entra_en_el_texto(self) -> None:
        """El cierre de una etiqueta respeta sus comillas, también dentro del propio artículo."""
        xhtml = '<p title="3 > 2">Artículo 4 Metas digitales</p><p title="3 > 2">1. a) un mínimo</p><p>Artículo 5</p>'
        self.assertEqual(decada_digital.articulo_4(xhtml), "Artículo 4 Metas digitales 1. a) un mínimo")

    def test_el_articulo_4_se_corta_antes_del_5(self) -> None:
        """La lectura del artículo 4 va de su título al artículo 5, sin marcas."""
        xhtml = "<p>Artículo 3</p><p>Artículo 4 Metas digitales</p><p>1. a) un  mínimo</p><p>Artículo 5</p>"
        self.assertEqual(decada_digital.articulo_4(xhtml), "Artículo 4 Metas digitales 1. a) un mínimo")

    def test_el_articulo_4_admite_entidades_de_espacio_y_una_mencion_anterior_del_5(self) -> None:
        """Un «&nbsp;» cuenta como espacio y una mención del artículo 5 en los considerandos no corta el 4."""
        xhtml = "<p>(ver Artículo 5)</p><p>Artículo&nbsp;4 Metas&#160;digitales</p><p>1. a)</p><p>Artículo 5</p>"
        self.assertEqual(decada_digital.articulo_4(xhtml), "Artículo 4 Metas digitales 1. a)")

    def test_un_articulo_preparado_que_no_es_el_del_original_no_se_admite(self) -> None:
        """Con un original nuevo y sin volver a preparar, el texto preparado desfasado hace fallar la validación."""
        original = "<p>Artículo 4 Metas digitales</p><p>1. a) otro texto</p><p>Artículo 5</p>"
        leidos: dict[object, Any] = {
            # El artículo validado lleva el texto de cada meta: solo falla que no sea el del original.
            decada_digital.ARTICULO: {"articulo_4": " ".join(meta.texto for meta in decada_digital.METAS)},
            decada_digital.PROCEDENCIA: {
                "archivos": [{"archivo": decada_digital.ARCHIVO, "descargado_utc": "2026-10-11T00:00:00+00:00"}]
            },
        }
        cerradas: list[bool] = []
        ruta = mock.Mock()
        ruta.read_text.return_value = original
        with (
            mock.patch.object(decada_digital, "leer_json", side_effect=leidos.__getitem__),
            mock.patch.object(decada_digital, "original", return_value=ruta),
            mock.patch.object(decada_digital, "controles_de_huella"),
            mock.patch.object(
                decada_digital,
                "cerrar_validacion",
                side_effect=lambda _f, _i, controles, _c: cerradas.append(controles.admitido),
            ),
        ):
            decada_digital.validar()
        self.assertEqual(cerradas, [False])


class PruebaEntradas(unittest.TestCase):
    """Las entradas mal formadas se atribuyen a su archivo y no producen un conjunto."""

    def validar_con(self, preparado: object, archivos: object) -> tuple[dict[str, Any], dict[str, Any]]:
        """Ejecuta la validación solo con entradas sintéticas.

        Returns:
            El informe y el conjunto capturados, sin escribir archivos operativos.
        """
        articulo = "Artículo 4 Metas digitales " + " ".join(meta.texto for meta in decada_digital.METAS)
        ruta = mock.Mock()
        ruta.read_text.return_value = f"<p>{articulo}</p><p>Artículo 5</p>"
        leidos = {decada_digital.ARTICULO: preparado, decada_digital.PROCEDENCIA: {"archivos": archivos}}
        cerradas = []
        with (
            mock.patch.object(decada_digital, "leer_json", side_effect=leidos.__getitem__),
            mock.patch.object(decada_digital, "original", return_value=ruta),
            mock.patch.object(decada_digital, "controles_de_huella"),
            mock.patch.object(decada_digital, "ahora_utc", return_value="2026-10-15T00:00:00+00:00"),
            mock.patch.object(
                decada_digital,
                "cerrar_validacion",
                side_effect=lambda _f, informe, _controles, conjunto: cerradas.append((informe, conjunto())),
            ),
        ):
            decada_digital.validar()
        self.assertEqual(len(cerradas), 1)
        return cerradas[0]

    def preparado(self) -> dict[str, str]:
        """Prepara una entrada sintética con las metas literales.

        Returns:
            El artículo sintético con todas las metas y su puntuación literal.
        """
        return {"articulo_4": "Artículo 4 Metas digitales " + " ".join(meta.texto for meta in decada_digital.METAS)}

    def registro(self, consulta: object = "2026-10-11T00:00:00+00:00") -> dict[str, object]:
        """Declara la descarga de la decisión.

        Returns:
            El registro del original con la consulta indicada.
        """
        return {"archivo": decada_digital.ARCHIVO, "descargado_utc": consulta}

    def test_los_rotulos_ausentes_o_fuera_de_orden_se_explican(self) -> None:
        """No se fabrica un artículo cuando falta su título o no hay un artículo 5 posterior."""
        for xhtml, motivo in (
            ("<p>Artículo 3</p><p>Artículo 5</p>", "artículo 4"),
            ("<p>Artículo 4 Metas digitales</p><p>contenido</p>", "artículo 5 después del 4"),
            ("<p>Artículo 5</p><p>Artículo 4 Metas digitales</p>", "artículo 5 después del 4"),
        ):
            with self.subTest(xhtml=xhtml), self.assertRaisesRegex(FormatoInesperado, motivo):
                decada_digital.articulo_4(xhtml)

    def test_un_preparado_sin_texto_se_atribuye_a_su_archivo(self) -> None:
        """Un JSON de otra forma o un artículo que no es texto no llega a las comparaciones literales."""
        for preparado in (None, [], {}, {"articulo_4": None}, {"articulo_4": 4}, {"articulo_4": []}):
            with (
                self.subTest(preparado=preparado),
                self.assertRaisesRegex(FormatoInesperado, "articulo-4.json.*articulo_4"),
            ):
                self.validar_con(preparado, [self.registro()])

    def test_una_consulta_mal_formada_se_atribuye_al_original(self) -> None:
        """Se comprueba el instante completo, incluida su fecha civil y su tipo."""
        for consulta in (None, 20261011, "", "2026-02-30T00:00:00+00:00", "2026-10-11malformado", "20261011"):
            with (
                self.subTest(consulta=consulta),
                self.assertRaisesRegex(FormatoInesperado, decada_digital.ARCHIVO + ".*descargado_utc"),
            ):
                self.validar_con(self.preparado(), [self.registro(consulta)])

    def test_la_consulta_identifica_una_sola_entrada_del_original(self) -> None:
        """Una procedencia vacía, ajena o duplicada no se resuelve por la primera posición."""
        for archivos in (None, [], [None], [{"archivo": "otro.xhtml"}], [self.registro(), self.registro()]):
            with (
                self.subTest(archivos=archivos),
                self.assertRaisesRegex(FormatoInesperado, decada_digital.ARCHIVO + ".*(procedencia|entrada)"),
            ):
                self.validar_con(self.preparado(), archivos)

    def test_la_consulta_conserva_el_dia_civil_del_original(self) -> None:
        """Un huso horario no desplaza la fecha de consulta ni altera las metas o los controles."""
        informe, conjunto = self.validar_con(self.preparado(), [self.registro("2026-10-11T23:30:00-04:00")])
        self.assertEqual(informe["estado"], "Admitido")
        self.assertEqual(informe["cobertura"], {"metas": 4})
        self.assertTrue(all(control["resultado"] == "correcto" for control in informe["controles"]))
        self.assertEqual(conjunto["consultado"], "2026-10-11")
        self.assertEqual(conjunto["articulo_4"], self.preparado()["articulo_4"])


if __name__ == "__main__":
    unittest.main()
