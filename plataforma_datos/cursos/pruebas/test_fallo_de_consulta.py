"""Fallo de consulta: ensamblado común con la identidad y la validación de cada fuente, idénticos a la 12g.

Los ids literales salen de la comparación diferencial con el código anterior (mismos bytes y orden de claves): el
registro de vigencia deduplica por el `id`, así que no puede cambiar.
"""

import json
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.fallo_de_consulta import observacion_de_fallo
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion as ba_adquisicion
from plataforma_datos.cursos.fuentes.barcelonactiva import observaciones_actuales as cibernarium
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion as ci_adquisicion
from plataforma_datos.cursos.fuentes.cibervoluntarios import observaciones_vigencia as ciber
from plataforma_datos.cursos.fuentes.claude_academy import observaciones_vigencia as academy
from plataforma_datos.cursos.fuentes.hp_life import lector as hp_lector
from plataforma_datos.cursos.fuentes.hp_life import observaciones_vigencia as hp
from plataforma_datos.cursos.tipos_json import ObjetoJson

ID_CIBERNARIUM = "cibernarium-pagina-fallida-v1:5c5e7acb5947690e81de8e0913a32a1f9274da45363be94763a207f409335398"
ID_CIBER = "cibervoluntarios-pagina-fallida-v1:8111fa98bcc20bca76a439155eb5be33a653057d9c20b32480cca67018fafc5b"
ID_ACADEMY = (
    "academy-oferta-publicada-continua:4:fallo:7f76a88b60fa5526db9304145f37c648d37db2f9158b4b706c06f6de8c92865f"
)
ID_HP = "hp-life-intento-fallido-v1:0673897f02a6bfdc7c85980405dfa5e0708f4aa4b042b2d7f16f79a0aa3f3d4f"
SHA_INTENTO_HP = "416212c6fcefa84eead9db4492f13d50af407532ea94926c5030cd43bf306865"


def esperado(  # noqa: PLR0913, PLR0917 - Oráculo de la prueba, con cada campo explícito.
    id: str, inicio: str, fin: str, url: str, motivo: str, sha256: str, localizador: str
) -> str:
    """El fallo tal como lo escribía cada fuente antes de compartir el ensamblado, en JSON y con su orden de claves.

    Returns:
        El JSON esperado.
    """
    fallo: ObjetoJson = {
        "id": id,
        "tipo": "ficha",
        "intentado_el": inicio,
        "terminado_el": fin,
        "resultado": "fallo",
        "url_consultada": url,
        "detalle": {"motivo": motivo},
        "evidencias": [
            {
                "alcance": "diagnostico",
                "url": url,
                "capturado_utc": fin,
                "sha256": sha256,
                "localizador": {"tipo": "campo", "valor": localizador},
            }
        ],
    }
    return json.dumps(fallo, ensure_ascii=False)


class FalloDeConsulta(unittest.TestCase):
    """Cada fuente produce exactamente el fallo de antes, con su id, su localizador y sus rechazos."""

    def test_ensamblado_comun(self) -> None:
        """El fallo lleva el intervalo real, la URL consultada y el recibo como diagnóstico, en este orden de claves."""
        fallo = observacion_de_fallo(
            id="m:1", intentado_el="i", terminado_el="t", url="u", motivo="m", sha256="s", localizador="/http"
        )
        self.assertEqual(json.dumps(fallo, ensure_ascii=False), esperado("m:1", "i", "t", "u", "m", "s", "/http"))

    def test_cibernarium_conserva_id_y_localizador(self) -> None:
        """Cibernàrium: id por JSON canónico; `/error` solo si el intento registra un error no vacío."""
        url = ba_adquisicion.url_pagina(0)
        intento = {"url": url, "inicio_utc": "2026-10-28T10:00:00Z", "fin_utc": "2026-10-28T10:00:05Z"}
        oferta = {"fuente_id": "barcelonactiva", "id": "cibernarium-edicion:123"}
        for error, localizador in ((None, "/http"), ("timeout", "/error"), ("", "/http")):
            con_error = intento if error is None else {**intento, "error": error}
            with self.subTest(error=error):
                self.assertEqual(
                    json.dumps(cibernarium.construir_fallo(con_error, "a" * 64, oferta=oferta), ensure_ascii=False),
                    esperado(
                        ID_CIBERNARIUM,
                        intento["inicio_utc"],
                        intento["fin_utc"],
                        url,
                        "pagina_del_censo_sin_respuesta_valida",
                        "a" * 64,
                        localizador,
                    ),
                )
        with self.assertRaisesRegex(FormatoInesperado, "ajena a Cibernàrium"):
            cibernarium.construir_fallo(intento, "a" * 64, oferta={**oferta, "fuente_id": "otra"})
        with self.assertRaisesRegex(FormatoInesperado, "sin intervalo exacto"):
            cibernarium.construir_fallo({**intento, "url": "https://ajena.example/?x=1"}, "a" * 64, oferta=oferta)

    def test_cibervoluntarios_conserva_id(self) -> None:
        """Cibervoluntarios: id por método, unidad y recibo unidos por saltos de línea."""
        url = ci_adquisicion.API + "?page=2"
        intento = {"url": url, "inicio_utc": "2026-10-28T11:00:00Z", "fin_utc": "2026-10-28T11:00:09.5Z"}
        oferta = {"fuente_id": "cibervoluntarios", "id": "cibervoluntarios:42"}
        self.assertEqual(
            json.dumps(ciber.construir_observacion_fallo(intento, "b" * 64, oferta=oferta), ensure_ascii=False),
            esperado(
                ID_CIBER,
                intento["inicio_utc"],
                intento["fin_utc"],
                url,
                "pagina_del_censo_sin_respuesta_valida",
                "b" * 64,
                "/http",
            ),
        )
        with self.assertRaisesRegex(FormatoInesperado, "ajeno al censo Ciber"):
            ciber.construir_observacion_fallo({**intento, "url": "https://ajena.example/?x"}, "b" * 64, oferta=oferta)

    def test_academy_conserva_id(self) -> None:
        """Claude Academy: id con «:fallo:» y localizador `/http`."""
        url = "https://anthropic.skilljar.com/curso-ñ"
        meta = {"url": url, "inicio_utc": "2026-10-28T12:00:00Z", "fin_utc": "2026-10-28T12:00:01Z"}
        fila = {"id": "academy:1", "recibo": {"sha256": "c" * 64}}
        with mock.patch.object(academy.comun, "leer_recibo", return_value=meta):
            fallo = academy.construir_fallo(Path("no-se-lee"), fila, url)
        self.assertEqual(
            json.dumps(fallo, ensure_ascii=False),
            esperado(
                ID_ACADEMY,
                meta["inicio_utc"],
                meta["fin_utc"],
                url,
                "consulta_academy_sin_respuesta_valida",
                "c" * 64,
                "/http",
            ),
        )

    def test_hp_life_conserva_id(self) -> None:
        """HP LIFE: id por la huella del intento conservado y localizador `/error`."""
        url = "https://www.life-global.org/es/course/1"
        dato = {
            "schema_version": 1,
            "resultado": "fallo",
            "id": "hp-1",
            "url": url,
            "inicio_utc": "2026-10-28T13:00:00Z",
            "fin_utc": "2026-10-28T13:00:30Z",
        }
        intento = json.dumps(dato, ensure_ascii=False).encode()
        fallo = hp.construir_observacion_fallo(intento, oferta={"fuente_id": "hp_life", "id": "hp-1", "url": url})
        self.assertEqual(
            json.dumps(fallo, ensure_ascii=False),
            esperado(
                ID_HP, dato["inicio_utc"], dato["fin_utc"], url, "consulta_hp_sin_respuesta", SHA_INTENTO_HP, "/error"
            ),
        )
        with self.assertRaisesRegex(hp_lector.ErrorFichaHpLife, "ajeno a la unidad"):
            hp.construir_observacion_fallo(
                b'{"schema_version": 1}', oferta={"fuente_id": "hp_life", "id": "x", "url": "u"}
            )


if __name__ == "__main__":
    unittest.main()
