"""La política propia no finge una URL remota ni una fecha de captura."""

import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest import mock

from plataforma_datos.cursos import politicas_vigencia
from plataforma_datos.cursos.pruebas.test_vigencia import AHORA, OFERTA, ficha, politica
from plataforma_datos.cursos.vigencia import ErrorVigencia, evaluar_vigencia


class PruebaPoliticaInterna(unittest.TestCase):
    """El canal interno está limitado a política; nunca sustituye evidencias de la fuente."""

    def test_referencia_interna_tipificada_sin_http_fingido(self) -> None:
        """Una política Faro tiene ID, versión, huella y campo; no es una captura del proveedor."""
        criterio = politica()
        criterio["evidencias"] = [
            {
                "alcance": "politica",
                "tipo": "interna-faro",
                "documento_id": "faro:vigencia:fuente-sintetica",
                "version": criterio["version"],
                "sha256": "b" * 64,
                "localizador": {"tipo": "campo", "valor": "/criterios"},
            }
        ]
        resultado = evaluar_vigencia(OFERTA, [ficha()], criterio, ahora=AHORA)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertNotIn("url", resultado["trazabilidad"]["evidencias"][0])
        self.assertNotIn("capturado_utc", resultado["trazabilidad"]["evidencias"][0])

    def test_recurso_real_cotejado_y_ttl_no_derivado_de_cadencia(self) -> None:
        """24 horas es decisión propia de Faro; la carga no crea fecha de aprobación ni captura remota."""
        politica_real = politicas_vigencia.leer_politica("barcelonactiva", "1")
        ruta, esperada = politicas_vigencia.POLITICAS[("barcelonactiva", "1")]
        recurso = politicas_vigencia.RAIZ_POLITICAS / ruta
        self.assertEqual(hashlib.sha256(recurso.read_bytes()).hexdigest(), esperada)
        self.assertEqual(politica_real["evidencias"][0]["sha256"], esperada)
        self.assertEqual(politica_real["ttl_ficha_segundos"], 86400)
        self.assertFalse(politica_real["requiere_catalogo"])
        self.assertIsNone(politica_real["zona_fechas_dia"])
        self.assertIsNone(json.loads(recurso.read_text())["revision_equipo_faro"]["fecha"])
        politica_real["ttl_ficha_segundos"] = 1
        self.assertEqual(politicas_vigencia.leer_politica("barcelonactiva", "1")["ttl_ficha_segundos"], 86400)

    def test_politica_no_se_aplica_a_otra_fuente_ni_version(self) -> None:
        """No hay alternativa desde un proveedor desconocido a la política de Barcelona."""
        for fuente, version in (("otra", "1"), ("barcelonactiva", "4"), ("hp_life", "4")):
            with self.subTest(fuente=fuente), self.assertRaises(ErrorVigencia):
                politicas_vigencia.leer_politica(fuente, version)

    def test_recurso_alterado_no_se_admite_por_conservar_id_o_version(self) -> None:
        """La huella pincha también el TTL y los metadatos de revisión, no solo el nombre de fichero."""
        relativa, _sha = politicas_vigencia.POLITICAS[("barcelonactiva", "1")]
        with tempfile.TemporaryDirectory() as nombre:
            raiz = Path(nombre)
            destino = raiz / relativa
            destino.parent.mkdir(parents=True)
            original = (politicas_vigencia.RAIZ_POLITICAS / relativa).read_bytes()
            destino.write_bytes(original.replace(b"86400", b"99999"))
            with (
                mock.patch.object(politicas_vigencia, "RAIZ_POLITICAS", raiz),
                self.assertRaisesRegex(ErrorVigencia, "huella"),
            ):
                politicas_vigencia.leer_politica("barcelonactiva", "1")

    def test_estado_de_revision_se_valida_contra_la_lista_cerrada(self) -> None:
        """Toda política registrada carga; un estado inventado, ausente, con fecha, campos de más o sin alcance, no."""
        for fuente, version in politicas_vigencia.POLITICAS:
            with self.subTest(fuente=fuente, version=version):
                politicas_vigencia.leer_politica(fuente, version)
        relativa, _sha = politicas_vigencia.POLITICAS[("hp_life", "2")]
        original = json.loads((politicas_vigencia.RAIZ_POLITICAS / relativa).read_bytes())
        for nombre, revision in (
            ("inventado", {**original["revision_equipo_faro"], "estado": "criterio-activado"}),
            ("con fecha", {**original["revision_equipo_faro"], "fecha": "2026-11-14"}),
            ("ausente", None),
            ("campo de más", {**original["revision_equipo_faro"], "activada_el": None}),
            ("alcance vacío", {**original["revision_equipo_faro"], "alcance": "  "}),
        ):
            with self.subTest(caso=nombre), tempfile.TemporaryDirectory() as carpeta:
                documento = {k: v for k, v in original.items() if k != "revision_equipo_faro"}
                if revision is not None:
                    documento["revision_equipo_faro"] = revision
                contenido = json.dumps(documento, ensure_ascii=False).encode()
                destino = Path(carpeta) / relativa
                destino.parent.mkdir(parents=True)
                destino.write_bytes(contenido)
                registro = {("hp_life", "2"): (relativa, hashlib.sha256(contenido).hexdigest())}
                with (
                    mock.patch.object(politicas_vigencia, "RAIZ_POLITICAS", Path(carpeta)),
                    mock.patch.dict(politicas_vigencia.POLITICAS, registro),
                    self.assertRaisesRegex(ErrorVigencia, "estado de revisión"),
                ):
                    politicas_vigencia.leer_politica("hp_life", "2")

    def test_referencia_interna_no_puede_acreditar_identidad_remota(self) -> None:
        """La variante interna solo pertenece a la política, sin abrir el contrato de observaciones."""
        criterio = politicas_vigencia.leer_politica("barcelonactiva", "1")
        observacion = ficha()
        observacion["evidencias"] = deepcopy(criterio["evidencias"])
        with self.assertRaises(ErrorVigencia):
            evaluar_vigencia(OFERTA, [observacion], politica(), ahora=AHORA)

    def test_referencia_interna_con_fuente_version_hash_o_campo_incoherentes_falla(self) -> None:
        """No se aceptan referencias parciales o de otro documento y no se les inventa fecha."""
        criterio = politica()
        referencia = {
            "alcance": "politica",
            "tipo": "interna-faro",
            "documento_id": "faro:vigencia:fuente-sintetica",
            "version": criterio["version"],
            "sha256": "b" * 64,
            "localizador": {"tipo": "campo", "valor": "/criterios"},
        }
        cambios = (
            ("documento_id", "faro:vigencia:otra"),
            ("version", "otra"),
            ("sha256", "b" * 63),
            ("localizador", None),
            ("capturado_utc", AHORA),
            ("url", "https://example.org/falsa-politica"),
        )
        for campo, valor in cambios:
            with self.subTest(campo=campo), self.assertRaises(ErrorVigencia):
                evaluar_vigencia(
                    OFERTA, [ficha()], {**criterio, "evidencias": [{**referencia, campo: valor}]}, ahora=AHORA
                )
