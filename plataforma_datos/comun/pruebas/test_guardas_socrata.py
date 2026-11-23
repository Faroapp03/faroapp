"""Rechazo contextual de metadatos malformados y equivalencia sin pérdida del instante."""

import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

import plataforma_datos.cursos.fuentes.consorci.oferta_emparejada as oferta_emparejada
from plataforma_datos.comun import red, socrata
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado, ReglaDeCambio
from plataforma_datos.orquestacion.ordenes import con_motivo

CONJUNTO = socrata.Conjunto("abcd-1234", "Conjunto de prueba", "Licencia")
METADATOS = {
    "rowsUpdatedAt": 1791712800,
    "columns": [
        {"fieldName": "id", "cachedContents": {"non_null": "2", "null": "0"}},
        {"fieldName": "origen", "cachedContents": {"top": [{"item": "CFCC", "count": "2"}]}},
    ],
}


def cuerpo(contenido: object) -> bytes:
    """Serializa una respuesta sintética de la API.

    Returns:
        Los bytes JSON de la respuesta.
    """
    return json.dumps(contenido).encode()


class PruebaEsquemaSocrata(unittest.TestCase):
    """El parser transforma solo estructuras y números esperados, con el archivo como contexto."""

    def test_formas_incompletas_y_tipos_se_rechazan_con_motivo(self) -> None:
        """La estructura no cae con KeyError, IndexError ni conversiones sin contexto."""
        casos = [
            None,
            [],
            {},
            {**METADATOS, "columns": []},
            {**METADATOS, "columns": {}},
            {**METADATOS, "columns": [None]},
            {**METADATOS, "columns": [{}]},
        ]
        for campo, valor in (("cachedContents", None), ("cachedContents", {}), ("fieldName", None)):
            caso = copy.deepcopy(METADATOS)
            caso["columns"][0][campo] = valor
            casos.append(caso)
        for contenido in casos:
            with self.subTest(contenido=contenido), self.assertRaises(FormatoInesperado):
                socrata.metadatos(contenido)

    def test_recuentos_no_enteros_negativos_o_booleanos_se_rechazan(self) -> None:
        """Un recuento nunca se redondea ni interpreta un booleano como número de filas."""
        for campo in ("non_null", "null"):
            for valor in (None, True, -1, 1.9, "1.9", "-1", [], {}):
                caso = copy.deepcopy(METADATOS)
                caso["columns"][0]["cachedContents"][campo] = valor
                with self.subTest(campo=campo, valor=valor), self.assertRaises(FormatoInesperado):
                    socrata.metadatos(caso)

    def test_origen_incompleto_o_con_recuentos_invalidos(self) -> None:
        """El reparto por origen exige una lista de nombres y recuentos naturales."""
        for top in (
            None,
            {},
            [None],
            [{}],
            [{"item": [], "count": "2"}],
            [{"item": "CFCC", "count": True}],
            [{"item": "CFCC", "count": "-2"}],
        ):
            caso = copy.deepcopy(METADATOS)
            caso["columns"][1]["cachedContents"]["top"] = top
            with self.subTest(top=top), self.assertRaises(FormatoInesperado):
                socrata.metadatos(caso)

    def test_timestamp_invalido_se_rechaza_con_motivo(self) -> None:
        """El instante rowsUpdatedAt no acepta texto, booleanos, nulos ni instantes fuera de rango."""
        for valor in (None, True, "1791712800", [], {}, float("nan"), 10**100):
            with self.subTest(valor=valor), self.assertRaises(FormatoInesperado):
                socrata.actualizado_utc({**METADATOS, "rowsUpdatedAt": valor})

    def test_aceptar_cambio_no_convierte_esquema_invalido_en_equivalente(self) -> None:
        """Una comparación malformada aborta antes de sustituir el original, incluso aceptando el cambio."""
        archivo = socrata.archivos_de_la_copia((CONJUNTO,), "2026-10-11")[1]
        regla = socrata.equivalencia(archivo)
        for aceptar in (False, True):
            with self.subTest(aceptar=aceptar), tempfile.TemporaryDirectory() as temporal:
                destino = Path(temporal) / archivo["archivo"]
                previo = cuerpo(METADATOS)
                destino.write_bytes(previo)
                with self.assertRaisesRegex(FormatoInesperado, archivo["archivo"]):
                    red.conservar_o_sustituir(
                        destino,
                        Descarga(cuerpo({}), archivo["url"], "application/json"),
                        ReglaDeCambio(regla, None, aceptar),
                    )
                self.assertEqual(destino.read_bytes(), previo)

    def test_primera_copia_cruda_no_es_admitida_por_el_lector(self) -> None:
        """Guardar un original no lo admite: lectura defectuosa termina con el motivo común de la CLI."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            datos = carpeta / socrata.nombre_de_datos(CONJUNTO, "2026-10-11")
            metadatos = carpeta / socrata.nombre_de_metadatos(CONJUNTO, "2026-10-11")
            red.conservar_o_sustituir(datos, Descarga(b"[]", "https://fuente.example", "application/json"))
            red.conservar_o_sustituir(metadatos, Descarga(b"{}", "https://fuente.example", "application/json"))
            error = io.StringIO()
            with (
                patch.object(socrata, "original", side_effect=lambda _fuente, nombre: carpeta / nombre),
                redirect_stderr(error),
            ):
                codigo = con_motivo(lambda: socrata.leer_copia("consorci", (CONJUNTO,), "2026-10-11"))
            self.assertEqual(codigo, 1)
            self.assertIn(metadatos.name, error.getvalue())
            self.assertNotIn("Traceback", error.getvalue())
            self.assertEqual(metadatos.read_bytes(), b"{}")

    def test_json_invalido_conserva_el_tratamiento_comun(self) -> None:
        """El JSON roto ya da error con motivo y nunca se acepta como equivalencia falsa."""
        with self.assertRaises(json.JSONDecodeError):
            socrata._mismos_metadatos(cuerpo(METADATOS), b"<html>Error</html>")

    def test_cambio_de_instante_en_el_mismo_dia_no_es_equivalente(self) -> None:
        """Igual día y recuentos no justifican conservar un instante que usa el emparejamiento."""
        posterior = {**METADATOS, "rowsUpdatedAt": METADATOS["rowsUpdatedAt"] + 60}
        self.assertEqual(socrata.metadatos(METADATOS), socrata.metadatos(posterior))
        self.assertNotEqual(socrata.actualizado_utc(METADATOS), socrata.actualizado_utc(posterior))
        pares = [("oferta", "2026-10-12")]
        anterior = socrata.actualizado_utc(METADATOS)
        actual = socrata.actualizado_utc(posterior)
        cursos = oferta_emparejada.version_de_la_oferta(pares, anterior, actual)
        despues = oferta_emparejada.version_de_la_oferta(pares, actual, actual)
        self.assertTrue(oferta_emparejada.en_vigor(cursos, anterior))
        self.assertFalse(oferta_emparejada.en_vigor(despues, anterior))
        self.assertFalse(socrata._mismos_metadatos(cuerpo(METADATOS), cuerpo(posterior)))

    def test_visitas_distintas_no_cambian_la_copia(self) -> None:
        """Los campos ajenos a fecha exacta y recuentos siguen siendo equivalentes."""
        self.assertTrue(socrata._mismos_metadatos(cuerpo(METADATOS), cuerpo({**METADATOS, "viewCount": 90})))
        self.assertEqual(socrata.metadatos(METADATOS)["filas_segun_metadatos"], 2)


if __name__ == "__main__":
    unittest.main()
