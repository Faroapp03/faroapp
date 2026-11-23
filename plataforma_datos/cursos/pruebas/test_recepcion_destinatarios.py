"""Una ficha recibida conserva el contrato del destinatario que afirma normalizado."""

import json
import unittest
from copy import deepcopy
from importlib.resources import files

from plataforma_datos.cursos.contrato_fichas import (
    ErrorFicha,
    normalizar_datos_edicion,
    validar_datos_edicion,
    validar_lote_fichas,
)


class RecepcionDestinatarios(unittest.TestCase):
    """Protege la recepción pública, incluso si no pasa por el generador."""

    def setUp(self) -> None:
        """Prepara una ficha correcta y las reglas empaquetadas de esta versión."""
        recursos = files("plataforma_datos.cursos.esquemas")
        self.opciones = {
            "vocabulario_destinatarios": json.loads(
                recursos.joinpath("destinatarios-v1-vocabulario.json").read_text(encoding="utf-8")
            ),
            "aliases_destinatarios": json.loads(
                recursos.joinpath("destinatarios-v1-alias.json").read_text(encoding="utf-8")
            ),
        }
        self.ficha = normalizar_datos_edicion(
            {"destinatario": {"categorias": ["trabajadores"], "texto_literal": "Para trabajadores"}},
            **self.opciones,
        )

    def test_ficha_recibida_exige_reglas(self) -> None:
        """Una traza ya escrita no acredita su corrección sin contrastarla."""
        with self.assertRaises(ErrorFicha):
            validar_datos_edicion(self.ficha)

    def test_recepcion_correcta_no_modifica(self) -> None:
        """Validar comprueba y conserva la ficha; no la normaliza otra vez."""
        anterior = deepcopy(self.ficha)
        validar_datos_edicion(self.ficha, **self.opciones)
        self.assertEqual(self.ficha, anterior)

    def test_categoria_modificada_no_entra(self) -> None:
        """Regresión: cambiar trabajadores a público general se rechaza al recibir."""
        self.ficha["destinatario"]["categorias"] = ["publico_general"]
        anterior = deepcopy(self.ficha)
        with self.assertRaises(ErrorFicha):
            validar_datos_edicion(self.ficha, **self.opciones)
        self.assertEqual(self.ficha, anterior)

    def test_lote_modificado_no_entra(self) -> None:
        """La recepción de lotes conserva la misma barrera que la ficha individual."""
        self.ficha["destinatario"]["categorias"] = ["publico_general"]
        lote = {"programas": [], "ediciones": [{"datos": self.ficha}]}
        with self.assertRaises(ErrorFicha):
            validar_lote_fichas(lote, **self.opciones)

    def test_lote_correcto_exige_reglas_y_las_acepta(self) -> None:
        """El lote transmite explícitamente las reglas a su ficha."""
        lote = {"programas": [], "ediciones": [{"datos": self.ficha}]}
        with self.assertRaises(ErrorFicha):
            validar_lote_fichas(lote)
        validar_lote_fichas(lote, **self.opciones)

    def test_programa_modificado_no_entra(self) -> None:
        """El destinatario también se protege cuando se recibe en un programa."""
        self.ficha["destinatario"]["categorias"] = ["publico_general"]
        lote = {"programas": [{"datos": self.ficha, "etiquetas": []}], "ediciones": []}
        with self.assertRaises(ErrorFicha):
            validar_lote_fichas(lote, **self.opciones)

    def test_programa_correcto_exige_reglas_sin_forma_de_edicion(self) -> None:
        """Un programa conserva su contrato propio y valida la extensión común."""
        datos = {"destinatario": self.ficha["destinatario"]}
        lote = {"programas": [{"datos": datos, "etiquetas": []}], "ediciones": []}
        anterior = deepcopy(lote)
        with self.assertRaises(ErrorFicha):
            validar_lote_fichas(lote)
        validar_lote_fichas(lote, **self.opciones)
        self.assertEqual(lote, anterior)

    def test_no_se_completa_una_traza_ausente(self) -> None:
        """Recibir un objeto sin normalizar no autoriza repararlo en silencio."""
        self.ficha["destinatario"] = {"categorias": ["personas_trabajadoras"]}
        with self.assertRaises(ErrorFicha):
            validar_datos_edicion(self.ficha, **self.opciones)

    def test_numero_no_sustituye_booleano_en_traza(self) -> None:
        """El consumidor también distingue false de cero en una traza recibida."""
        self.ficha["destinatario"]["normalizacion_categorias"]["reglas"][0]["duplicado_salida"] = 0
        with self.assertRaises(ErrorFicha):
            validar_datos_edicion(self.ficha, **self.opciones)

    def test_una_sola_configuracion_no_basta(self) -> None:
        """No se completa implícitamente la pareja de reglas explícitas."""
        for clave, valor in self.opciones.items():
            with self.subTest(clave=clave), self.assertRaises(ErrorFicha):
                validar_datos_edicion(self.ficha, **{clave: valor})

    def test_legado_sin_campo_conservado(self) -> None:
        """Las fichas previas sin la extensión se validan como antes."""
        legado = normalizar_datos_edicion({})
        self.assertNotIn("destinatario", legado)
        validar_datos_edicion(legado)
        validar_lote_fichas({"programas": [], "ediciones": [{"datos": legado}]})

    def test_ausencia_de_destinatario_no_se_rellena(self) -> None:
        """Null explícito se conserva al generar y recibir con reglas válidas."""
        ficha = normalizar_datos_edicion({"destinatario": None}, **self.opciones)
        validar_datos_edicion(ficha, **self.opciones)
        self.assertIsNone(ficha["destinatario"])


if __name__ == "__main__":
    unittest.main()
