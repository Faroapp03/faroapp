"""Índices y presencia FUNDAE sintéticos: no son ofertas ni consultas remotas reales."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import recibos_compartidos, vigencia
from plataforma_datos.cursos.fuentes.fundae import adquisicion as fuente
from plataforma_datos.cursos.fuentes.fundae import censo_digitalizate
from plataforma_datos.cursos.pruebas.test_fundae_ediciones import conservar
from plataforma_datos.cursos.pruebas.test_vigencia import politica
from plataforma_datos.cursos.recepciones_catalogo import json_bytes


class CatalogosFundaePruebas(unittest.TestCase):
    """Ejercita el recibo compartido y el evaluador real, sin red ni var operativo."""

    def setUp(self) -> None:
        """Prepara entidades y recibos sintéticos identificados."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.raiz = Path(self.temporal.name)
        self.digital = {
            "id": "fundae:1:21",
            "proveedor_id": "fundae:publicador:catalogo:1",
            "url": "https://example.org/curso",
            "datos": {"id_recurso_fuente": 21},
        }
        self.ausente = {**self.digital, "id": "fundae:1:22", "datos": {"id_recurso_fuente": 22}}
        self.subvencionada = {
            "id": "fundae:oferta:programa:IFCT1",
            "proveedor_id": "fundae:publicador:catalogo:3",
            "url": "https://experienciafundae.es/ficha-curso/oferta/2/IFCT1",
            "datos": {"codigo_especialidad": "IFCT1"},
        }
        self.conocidos = {
            "schema_version": 1,
            "fuente_id": "fundae",
            "programas": [self.digital, self.ausente, self.subvencionada],
            "variantes": [],
            "anuncios": [],
        }
        self.datos = {
            "catalogos": [{"idCatalogo": 1}, {"idCatalogo": 3}],
            "digitalizate": {
                "respuesta": [
                    {
                        "idRecursoFormativoBuscador": 1,
                        "idRecursoFormativo": 21,
                        "idCatalogo": 1,
                        "inscripcionAbierta": True,
                    }
                ]
            },
            "subvencionada": {
                "respuesta": [
                    {
                        "idRecursoFormativoBuscador": 2,
                        "codigoTitulacion": "IFCT1",
                        "idModalidad": 2,
                        "idCatalogo": 3,
                        "inscripcionAbierta": True,
                    }
                ]
            },
        }
        self.documento = {
            "schema_version": 1,
            "fuente_id": "fundae",
            "capturas": [],
            "auxiliares": {n: self.captura(n, d) for n, d in self.datos.items()},
        }

    def captura(  # noqa: PLR0913 - Recepción sintética con su intervalo explícito.
        self,
        nombre: str,
        dato: object,
        *,
        http: int | None = 200,
        cuerpo: bool = True,
        inicio: str = "2026-10-23T10:00:00Z",
        fin: str = "2026-10-23T10:00:01Z",
    ) -> dict:
        """Conserva cuerpo y recibo compartido de una recepción sintética.

        Returns:
            Referencias compartidas con sus huellas exactas.
        """
        raw = json_bytes(dato)
        sha = hashlib.sha256(raw).hexdigest()
        (self.raiz / (sha + ".body")).write_bytes(raw)
        meta = {
            "url": fuente.URLS[nombre],
            "url_final": fuente.URLS[nombre],
            "http": http,
            "completo": cuerpo,
            "inicio_utc": inicio,
            "fin_utc": fin,
            "bytes": len(raw) if cuerpo else 0,
            "cuerpo_sha256": sha if cuerpo else None,
        }
        estable, evento = recibos_compartidos.separar(
            json_bytes(meta), campos_evento=frozenset({"inicio_utc", "fin_utc"})
        )
        refs = {}
        for k, b in (("metadatos", estable), ("recibo", evento)):
            h = hashlib.sha256(b).hexdigest()
            archivo = h + ".json"
            (self.raiz / archivo).write_bytes(b)
            refs[k] = {"archivo": archivo, "sha256": h}
        return {
            "id": None,
            "cuerpo": {"archivo": sha + ".body", "sha256": sha} if cuerpo else None,
            **refs,
            "intento": refs["recibo"],
        }

    def calcular(self) -> dict:
        """Reproduce la lectura productiva de los índices propios.

        Returns:
            Conjunto sintético validado por los módulos productivos.
        """
        return fuente.calcular(self.raiz, self.documento, self.conocidos)

    def test_presencia_no_es_disponibilidad_y_ausencia_no_es_baja(self) -> None:
        """Una presencia en agregador deja la oferta sin confirmar; ausencia parcial no retira."""
        resultado = self.calcular()
        observaciones = {f["id"]: f["observacion"] for f in resultado["observaciones_catalogo"]}
        self.assertIs(observaciones[self.digital["id"]]["detalle"]["presente"], True)
        self.assertIsNone(observaciones[self.ausente["id"]]["detalle"]["presente"])
        self.assertFalse(resultado["censo_completo"])
        for programa in self.conocidos["programas"]:
            observacion = observaciones[programa["id"]]
            p = {**politica(), "fuente_id": "fundae"}
            oferta = {"id": programa["id"], "fuente_id": "fundae", "url": programa["url"]}
            estado = vigencia.evaluar_vigencia(oferta, [observacion], p, ahora="2026-10-23T10:01:00Z")
            self.assertEqual(estado["estado"], "sin-confirmar")
            self.assertEqual(observacion["tipo"], "catalogo")
            self.assertFalse(observacion["detalle"]["lectura_completa"])

    def test_fallo_remoto_aislado_no_bloquea_otro_catalogo(self) -> None:
        """El canal correcto conserva sus observaciones aunque falle el otro."""
        for http in (403, 429, 503, None):
            with self.subTest(http=http):
                self.documento["auxiliares"]["digitalizate"] = self.captura(
                    "digitalizate", {}, http=http, cuerpo=http is not None
                )
                r = self.calcular()
                self.assertEqual([x["canal"] for x in r["fallos"]], ["digitalizate"])
                # El índice caído registra el fallo de sus unidades; no se lee como ausencia.
                resultados = {x["id"]: x["observacion"]["resultado"] for x in r["observaciones_catalogo"]}
                self.assertEqual(resultados.pop(self.subvencionada["id"]), "correcta")
                self.assertTrue(resultados)
                self.assertEqual(set(resultados.values()), {"fallo"})
                self.assertEqual(r["consulta_parcial"]["canales_fallidos"], ["digitalizate"])

    def test_captura_alterada_no_se_disfraza_de_error_remoto(self) -> None:
        """La corrupción local sigue siendo error y no una consulta HTTP fallida."""
        cap = self.documento["auxiliares"]["digitalizate"]
        (self.raiz / cap["cuerpo"]["archivo"]).write_bytes(b"{}")
        with self.assertRaises(FormatoInesperado):
            self.calcular()

    def test_catalogo_ajeno_vacio_y_duplicado_rechazados(self) -> None:
        """No admite otro catálogo, identidades duplicadas o censo vacío."""
        original = copy.deepcopy(self.documento)
        for filas in (
            [],
            [{"idCatalogo": 3, "idRecursoFormativoBuscador": 1, "idRecursoFormativo": 21}],
            self.datos["digitalizate"]["respuesta"] * 2,
        ):
            self.documento = copy.deepcopy(original)
            self.documento["auxiliares"]["digitalizate"] = self.captura("digitalizate", {"respuesta": filas})
            with self.subTest(filas=filas), self.assertRaises(FormatoInesperado):
                self.calcular()

    def test_repetir_no_cambia_fechas_identidad_ni_entrada(self) -> None:
        """La recepción conservada no se rejuvenece al reproducirla."""
        entradas = copy.deepcopy((self.documento, self.conocidos))
        a, b = self.calcular(), self.calcular()
        self.assertEqual(a, b)
        self.assertEqual((self.documento, self.conocidos), entradas)
        self.assertEqual(a["observaciones_catalogo"][0]["observacion"]["terminado_el"], "2026-10-23T10:00:01Z")

    def test_descarga_tres_get_con_transporte_comun_y_guarda_intentos(self) -> None:
        """Consulta los tres índices y las dos listas de proveedores de Digitalízate, en serie y con perfil central."""

        def responder(url: str, *_args: object, **_kw: object) -> dict:
            if url == censo_digitalizate.EMPRESAS:
                # La lista activa cae: no se pide ninguna ficha y el censo queda sin lista.
                return conservar(self.raiz, url, [], 503, "2026-10-23T10:00:01Z")
            if url == censo_digitalizate.EMPRESAS_BAJA:
                return conservar(self.raiz, url, [], 200, "2026-10-23T10:00:02Z")
            return self.documento["auxiliares"][next(n for n, u in fuente.URLS.items() if u == url)]

        with patch.object(fuente.comun, "recibir_url", side_effect=responder) as recibir:
            fuente.descargar(self.conocidos, self.raiz, {})
        self.assertEqual(
            [c.args[0] for c in recibir.call_args_list],
            [*fuente.URLS.values(), censo_digitalizate.EMPRESAS, censo_digitalizate.EMPRESAS_BAJA],
        )
        self.assertTrue(all(c.kwargs == {"perfil": "datos"} for c in recibir.call_args_list))
        guardado = json.loads((self.raiz / "procedencia.json").read_bytes())
        self.assertEqual(set(guardado["auxiliares"]), set(fuente.URLS))
        self.assertFalse(guardado["censo_completo"])

    def test_error_local_conserva_intentos_y_se_propaga(self) -> None:
        """Un fallo inesperado conserva la procedencia parcial y no se oculta."""
        with (
            patch.object(
                fuente.comun,
                "recibir_url",
                side_effect=[self.documento["auxiliares"]["catalogos"], OSError("fallo local sintético")],
            ),
            self.assertRaises(OSError),
        ):
            fuente.descargar(self.conocidos, self.raiz, {})
        guardado = json.loads((self.raiz / "procedencia.json").read_bytes())
        self.assertEqual(set(guardado["auxiliares"]), {"catalogos"})


if __name__ == "__main__":
    unittest.main()
