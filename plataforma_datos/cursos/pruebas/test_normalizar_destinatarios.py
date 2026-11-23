"""Destinatarios sin inferencias, su huella pública y la firma del evaluador, solo sintéticos."""

import hashlib
import json
import unittest
from copy import deepcopy
from importlib.resources import files
from pathlib import Path

from plataforma_datos.comun import huella_json
from plataforma_datos.cursos import normalizar_destinatarios, registro_vigencia
from plataforma_datos.cursos.contrato_fichas import ErrorFicha, normalizar_datos_edicion
from plataforma_datos.cursos.normalizar_destinatarios import (
    VERSION,
    ErrorDestinatario,
    normalizar_categorias,
    normalizar_destinatario,
    sha256_json,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson


def configuracion(nombre: str) -> ObjetoJson:
    """Carga un recurso versionado para las pruebas.

    Returns:
        Objeto JSON empaquetado; el helper no participa en esta lectura.
    """
    recurso = files("plataforma_datos.cursos.esquemas").joinpath(nombre)
    return json.loads(recurso.read_text(encoding="utf-8"))


class DestinatariosPruebas(unittest.TestCase):
    """Comparación exacta, conservación e integridad de la procedencia."""

    def setUp(self) -> None:
        """Carga configuraciones independientes para cada prueba."""
        self.vocab = configuracion("destinatarios-v1-vocabulario.json")
        self.alias = configuracion("destinatarios-v1-alias.json")

    def normalizar(self, valor: ValorJson, *, estricto: bool = False) -> ObjetoJson | None:
        """Normaliza con las configuraciones empaquetadas.

        Returns:
            Destinatario normalizado independiente.
        """
        return normalizar_destinatario(valor, self.vocab, self.alias, estricto=estricto)

    def test_seis_sinonimos_exactos(self) -> None:
        """Todas las equivalencias publicadas mantienen su regla y destino."""
        for regla in self.alias["reglas"]:
            with self.subTest(origen=regla["origen"]):
                resultado = normalizar_categorias([regla["origen"]], self.vocab, self.alias)
                esperado = [] if regla["destino"] is None else [regla["destino"]]
                self.assertEqual(resultado["categorias"], esperado)
                self.assertEqual(resultado["reglas"][0]["regla"], regla["id"])

    def test_cada_codigo_canonico_es_identidad(self) -> None:
        """El vocabulario completo conserva identidad sin aplanar compuestos."""
        for elemento in self.vocab["valores"]:
            codigo = elemento["codigo"]
            resultado = self.normalizar({"categorias": [codigo]})
            self.assertEqual(resultado["categorias"], [codigo])
            self.assertEqual(resultado["normalizacion_categorias"]["reglas"][0]["regla"], "identidad-v1")

    def test_desconocidas_y_ausencia_no_son_publico_general(self) -> None:
        """Ausencia y etiquetas no reconocidas no fabrican público general."""
        for categorias in (None, [], ["no_consta"], ["nueva etiqueta"]):
            resultado = self.normalizar({"categorias": categorias})
            self.assertEqual(resultado["categorias"], [])
            self.assertEqual(resultado["normalizacion_categorias"]["original"]["categorias"], categorias)

    def test_unknown_conservado_y_estricto_rechaza(self) -> None:
        """Un código desconocido persiste con estado pendiente y traza."""
        original = {"categorias": ["trabajadores", "DESCONOCIDO", "DESCONOCIDO"]}
        resultado = self.normalizar(original)
        self.assertEqual(resultado["categorias"], ["personas_trabajadoras"])
        self.assertEqual(resultado["normalizacion_categorias"]["desconocidas"], ["DESCONOCIDO"])
        self.assertEqual(resultado["normalizacion_categorias"]["estado"], "pendiente_vocabulario")
        with self.assertRaises(ErrorDestinatario):
            self.normalizar(original, estricto=True)

    def test_sin_aproximacion(self) -> None:
        """Mayúsculas, espacios y acentos no activan alias aproximados."""
        for codigo in (" Trabajadores", "trabajadores ", "TRABAJADORES", "público_general"):
            resultado = self.normalizar({"categorias": [codigo]})
            self.assertEqual(resultado["categorias"], [])
            self.assertEqual(resultado["normalizacion_categorias"]["desconocidas"], [codigo])

    def test_dedupe_con_traza_de_cada_ocurrencia(self) -> None:
        """La salida elimina duplicados sin borrar las entradas originales."""
        resultado = self.normalizar({"categorias": ["trabajadores", "personas_trabajadoras", "familiares"]})
        self.assertEqual(resultado["categorias"], ["personas_trabajadoras", "familias"])
        self.assertEqual(
            [r["duplicado_salida"] for r in resultado["normalizacion_categorias"]["reglas"]], [False, True, False]
        )

    def test_compuestas_y_propuestas_no_se_reinterpretan(self) -> None:
        """Compuestos y propuestas conservan su código sin inferir exclusividad."""
        codigos = ["docentes_y_formadores", "profesionales_sanitarios_y_cuidados_propuesta"]
        resultado = self.normalizar({"categorias": codigos, "restriccion_exclusiva": None})
        self.assertEqual(resultado["categorias"], codigos)
        self.assertIsNone(resultado["restriccion_exclusiva"])

    def test_literal_recomendado_no_se_vuelve_requisito(self) -> None:
        """Literales, fechas, desconocidos y recomendaciones quedan idénticos."""
        original = {
            "texto_literal": "Recomendado para docentes; abierto a todas las personas.",
            "evidencia": {"url": "https://ejemplo.invalid/ficha", "recibido_utc": "2026-10-22T10:00:00Z"},
            "requisitos": None,
            "restriccion_exclusiva": None,
            "propuesta": {"etiqueta": "docentes", "fecha": None},
        }
        copia = deepcopy(original)
        resultado = self.normalizar(original)
        self.assertEqual(resultado["normalizacion_categorias"]["original"], original)
        self.assertEqual(resultado["categorias"], [])
        for campo in original:
            self.assertEqual(resultado[campo], original[campo])
        self.assertEqual(original, copia)
        resultado["evidencia"]["url"] = "otra"
        self.assertEqual(original, copia)

    def test_null_permanece_null(self) -> None:
        """La ausencia del objeto no se rellena con un destinatario general."""
        self.assertIsNone(self.normalizar(None))

    def test_idempotencia_sin_recursion(self) -> None:
        """Repetir mantiene el primer original y la representación canónica."""
        primero = self.normalizar({"categorias": ["trabajadores"], "desconocido": None})
        segundo = self.normalizar(primero)
        self.assertEqual(sha256_json(primero), sha256_json(segundo))
        self.assertNotIn("normalizacion_categorias", segundo["normalizacion_categorias"]["original"])

    def test_alias_mutado_misma_version_rechazado(self) -> None:
        """Regresión propuesta: la misma versión no admite cambiar trabajadores a público."""
        self.alias["reglas"][0]["destino"] = "publico_general"
        with self.assertRaisesRegex(ErrorDestinatario, "nueva versión"):
            self.normalizar({"categorias": ["trabajadores_general"]})

    def test_vocab_mutado_misma_version_rechazado(self) -> None:
        """Las definiciones y el estatus propuesto también quedan ligados a la versión."""
        self.vocab["valores"][0]["definicion"] = "otra definición"
        with self.assertRaises(ErrorDestinatario):
            self.normalizar(None)

    def test_cero_por_false_no_es_repeticion(self) -> None:
        """Regresión propuesta: igualdad Python no permite perder una modificación."""
        resultado = self.normalizar({"categorias": [], "dato": 0})
        resultado["dato"] = False
        with self.assertRaisesRegex(ErrorDestinatario, "alterado"):
            self.normalizar(resultado)

    def test_numero_entero_y_decimal_son_distintos(self) -> None:
        """La precondición usa representación JSON, no igualdad numérica Python."""
        self.assertNotEqual(sha256_json(0), sha256_json(False))
        self.assertNotEqual(sha256_json(1), sha256_json(1.0))

    def test_traza_alterada_rechazada(self) -> None:
        """No se regeneran silenciosamente trazas modificadas."""
        resultado = self.normalizar({"categorias": ["trabajadores"]})
        resultado["normalizacion_categorias"]["reglas"][0]["duplicado_salida"] = 0
        with self.assertRaises(ErrorDestinatario):
            self.normalizar(resultado)

    def test_procedencia_invalida_rechazada(self) -> None:
        """Versiones, originales ausentes y procedencia recursiva requieren intervención."""
        for previo in (
            None,
            {},
            {"version": "otra"},
            {"version": VERSION, "original": None},
            {"version": VERSION, "original": {"normalizacion_categorias": {}}},
        ):
            with self.subTest(previo=previo), self.assertRaises(ErrorDestinatario):
                self.normalizar({"normalizacion_categorias": previo})

    def test_tipos_invalidos_rechazados(self) -> None:
        """La extensión exige objetos y listas de cadenas, no coerción."""
        for valor in ([], False, "docentes", {"categorias": False}, {"categorias": [None]}):
            with self.subTest(valor=valor), self.assertRaises(ErrorDestinatario):
                self.normalizar(valor)

    def test_texto_literal_respeta_el_esquema_publicado(self) -> None:
        """Un literal booleano o numérico no debe salir como texto publicado."""
        for literal in (False, 0, [], {}):
            with self.subTest(literal=literal), self.assertRaises(ErrorDestinatario):
                self.normalizar({"texto_literal": literal})

    def test_json_no_finito_o_ajeno_rechazado(self) -> None:
        """No se firman objetos ajenos, claves numéricas ni valores no finitos."""
        for valor in (float("nan"), float("inf"), {1: "uno"}, ("tupla",)):
            with self.subTest(valor=repr(valor)), self.assertRaisesRegex(ErrorDestinatario, "^Valor JSON no canónico$"):
                sha256_json(valor)

    def test_huella_publica_identica_a_la_comun(self) -> None:
        """Para cualquier JSON canónico, la huella de este módulo es la de `comun.huella_json`."""
        for valor in (None, 0, False, 1.0, "ñ", [1, "a"], {"b": [True, None], "a": {"c": 0.5}}):
            with self.subTest(valor=repr(valor)):
                self.assertEqual(sha256_json(valor), huella_json.sha256_json(valor))

    def test_firma_del_evaluador_cubre_la_huella_json(self) -> None:
        """La huella que valida destinatarios entra en la firma del evaluador: cambiarla exige otra evaluación."""
        archivos = registro_vigencia.firma_evaluador()["archivos"]
        for modulo in (normalizar_destinatarios, huella_json):
            with self.subTest(modulo=modulo.__name__):
                self.assertEqual(
                    archivos.get(modulo.__name__.replace(".", "/") + ".py"),
                    hashlib.sha256(Path(modulo.__file__).read_bytes()).hexdigest(),
                )

    def test_destinatario_no_canonico_da_error_de_destinatario(self) -> None:
        """Un destinatario que no es JSON canónico se rechaza con el error de este contrato, no con el de la huella."""
        for valor in ({"categorias": [float("nan")]}, {"categorias": ("tupla",)}):
            with self.subTest(valor=repr(valor)), self.assertRaisesRegex(ErrorDestinatario, "no canónico"):
                self.normalizar(valor)

    def test_contrato_sin_opciones_conserva_comportamiento(self) -> None:
        """La extensión está desactivada por defecto incluso con destinatario inválido."""
        fuente = {"destinatario": "no estructurado", "modalidad": "online", "coste_formacion": None}
        normal = normalizar_datos_edicion(fuente)
        explicito = normalizar_datos_edicion(fuente, vocabulario_destinatarios=None, aliases_destinatarios=None)
        self.assertEqual(sha256_json(normal), sha256_json(explicito))
        self.assertNotIn("destinatario", normal)
        self.assertIsNone(normal["admisibilidad_persona"])

    def test_contrato_opciones_aditivas_y_validacion_real(self) -> None:
        """El contrato invoca el validador puro y preserva el resto del resultado."""
        fuente = {"destinatario": {"categorias": ["trabajadores"], "recomendado": True}, "modalidad": "online"}
        legado = normalizar_datos_edicion(fuente)
        extendido = normalizar_datos_edicion(
            fuente, vocabulario_destinatarios=self.vocab, aliases_destinatarios=self.alias
        )
        self.assertEqual(extendido.pop("destinatario"), self.normalizar(fuente["destinatario"]))
        self.assertEqual(sha256_json(extendido), sha256_json(legado))
        self.assertIsNone(extendido["plaza_confirmada_persona"])

    def test_contrato_exige_ambas_configuraciones(self) -> None:
        """No se carga una configuración implícita cuando falta su pareja."""
        with self.assertRaises(ErrorFicha):
            normalizar_datos_edicion({}, vocabulario_destinatarios=self.vocab)
        with self.assertRaises(ErrorFicha):
            normalizar_datos_edicion({}, aliases_destinatarios=self.alias)

    def test_contrato_rechaza_unknown_y_conserva_causa(self) -> None:
        """La conexión estricta no omite el error del helper."""
        with self.assertRaises(ErrorFicha) as contexto:
            normalizar_datos_edicion(
                {"destinatario": {"categorias": ["nuevo"]}},
                vocabulario_destinatarios=self.vocab,
                aliases_destinatarios=self.alias,
            )
        self.assertIsInstance(contexto.exception.__cause__, ErrorDestinatario)

    def test_esquema_y_configuracion_comparten_dominio(self) -> None:
        """El esquema publicado mantiene exactamente las categorías del helper."""
        esquema = configuracion("curso-destinatario-v1.json")
        categorias = esquema["properties"]["destinatario"]["properties"]["categorias"]
        self.assertEqual(set(categorias["items"]["enum"]), {v["codigo"] for v in self.vocab["valores"]})
        self.assertTrue(categorias["uniqueItems"])
        self.assertEqual(self.vocab["version"], VERSION)
        self.assertEqual(self.alias["version"], VERSION)


if __name__ == "__main__":
    unittest.main()
