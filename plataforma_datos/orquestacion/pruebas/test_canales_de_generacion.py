"""Cierre del índice de un canal histórico a partir de sus referencias selladas."""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.orquestacion.generacion_operativa import originales_de_la_fuente


class CanalesDeGeneracionPruebas(unittest.TestCase):
    """Protege el cierre autenticado del canal, incluso cuando el historial antiguo es incompleto."""

    def setUp(self) -> None:
        """Prepara un canal propio y una captura ajena a su procedencia."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.base = self.raiz / "var/actualizacion/originales/fundae"
        self.canal = self.base / "catalogos"
        self.canal.mkdir(parents=True)
        (self.canal / "recibo.json").write_bytes(b"prueba primaria")
        (self.canal / "privado-sin-enlace.json").write_bytes(b"no pertenece a la seleccion")
        self.vector = {"archivo": "recibo.json", "sha256": sha256(self.canal / "recibo.json")}

    def _enlazar(self, referencias: list[dict], adicionales: list[dict] | None = None) -> None:
        indice = self.canal / "procedencia.json"
        guardar_json(indice, {"historial": [], "censo": referencias})
        ref = {"archivo": "catalogos/procedencia.json", "sha256": sha256(indice)}
        guardar_json(self.base / "procedencia.json", {"canales_operativos": {"catalogos": [ref, *(adicionales or [])]}})

    def test_recibo_ausente_del_historial_seleccionado_por_su_indice_sellado(self) -> None:
        """La selección recorre el índice histórico y conserva únicamente sus pruebas declaradas."""
        self._enlazar([self.vector])
        fotos = originales_de_la_fuente(self.raiz, "fundae")
        prefijo = self.canal.relative_to(self.raiz).as_posix()
        self.assertIn(prefijo + "/recibo.json", fotos)
        self.assertNotIn(prefijo + "/privado-sin-enlace.json", fotos)
        (self.canal / "recibo.json").write_bytes(b"modificado")
        with self.assertRaises((ErrorFuente, ValueError)):
            originales_de_la_fuente(self.raiz, "fundae")

    def test_indices_contradictorios_o_con_ruta_ajena_no_autorizan_la_lectura(self) -> None:
        """Rechaza contradicciones entre niveles y dentro del mismo índice, así como escapes."""
        for refs, otras in (
            ([self.vector, {**self.vector, "sha256": "0" * 64}], []),
            ([self.vector], [{"archivo": "catalogos/recibo.json", "sha256": "0" * 64}]),
            ([{**self.vector, "archivo": "../recibo.json"}], []),
        ):
            with self.subTest(refs=refs, otras=otras):
                self._enlazar(refs, otras)
                with self.assertRaises((ValueError, ErrorFuente)):
                    originales_de_la_fuente(self.raiz, "fundae")

    def test_comprueba_el_sha_del_indice_antes_de_abrir_su_json(self) -> None:
        """Un reemplazo no atribuido se rechaza por la huella del padre aun si el JSON es ilegible."""
        self._enlazar([self.vector])
        (self.canal / "procedencia.json").write_bytes(b"otro contenido")
        with self.assertRaises(ErrorFuente):
            originales_de_la_fuente(self.raiz, "fundae")
