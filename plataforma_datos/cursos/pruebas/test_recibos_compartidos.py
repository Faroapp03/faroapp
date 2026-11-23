"""Contenido/encabezados únicos y cada consulta real conservada como evento propio."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import almacen_catalogo, operacion_fuente, recibos_compartidos
from plataforma_datos.cursos.recepciones_catalogo import RespuestaCatalogo

URL = "https://academy.example/curso"


class RecibosCompartidosPruebas(unittest.TestCase):
    """No accede a red; conserva bytes simulados con el escritor productivo atómico."""

    def setUp(self) -> None:
        """Crea área privada con ruta Unicode."""
        temporal = tempfile.TemporaryDirectory(prefix="recibos Año ñ ")
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)

    def recibir(self, minuto: int, *, error: str | None = None) -> dict:
        """Representa un intento distinto, con causa y fecha explícitas.

        Returns:
            Referencias inmutables de la respuesta simulada.
        """
        respuesta = RespuestaCatalogo(
            url=URL,
            inicio_utc=f"2026-10-23T10:{minuto:02d}:00Z",
            fin_utc=f"2026-10-23T10:{minuto:02d}:01Z",
            cuerpo=b"mismo cuerpo" if error is None else None,
            url_final=URL,
            http=200 if error is None else 503,
            completo=error is None,
            content_type="text/html",
            error=error,
        )
        with patch.object(operacion_fuente, "consultar", return_value=respuesta):
            return operacion_fuente.recibir_url(URL, self.area, "curso", perfil="pagina")

    def test_treinta_consultas_una_copia_estable_y_replay_sin_escritura(self) -> None:
        """Conserva treinta fechas/resultados, cuerpo y metadatos una sola vez."""
        capturas = [self.recibir(n) for n in range(30)]
        self.assertEqual(len(list((self.area / "cuerpos").glob("*.body"))), 1)
        self.assertEqual(len(list((self.area / "metadatos").glob("*.json"))), 1)
        self.assertEqual(len(list((self.area / "recepciones").glob("*.json"))), 30)
        for n, captura in enumerate(capturas):
            dato = operacion_fuente.leer_recibo(self.area, captura)
            self.assertEqual(dato["fin_utc"], f"2026-10-23T10:{n:02d}:01Z")
            self.assertEqual(dato["cuerpo_sha256"], hashlib.sha256(b"mismo cuerpo").hexdigest())
        antes = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.area.rglob("*") if p.is_file()}
        self.assertEqual(self.recibir(29), capturas[-1])
        self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in antes}, antes)

    def test_fallos_nuevos_conservan_causa_y_sus_fechas(self) -> None:
        """No transforma ausencia de cuerpo ni denegación en disponibilidad o cierre."""
        primera = self.recibir(0)
        errores = [self.recibir(n, error="HTTP 503: lectura interrumpida") for n in (1, 2)]
        self.assertEqual(len(list((self.area / "metadatos").glob("*.json"))), 2)
        self.assertEqual(operacion_fuente.leer_recibo(self.area, primera)["http"], 200)
        for n, captura in enumerate(errores, 1):
            self.assertIsNone(captura["cuerpo"])
            dato = operacion_fuente.leer_recibo(self.area, captura)
            self.assertEqual(dato["error"], "HTTP 503: lectura interrumpida")
            self.assertEqual(dato["fin_utc"], f"2026-10-23T10:{n:02d}:01Z")

    def test_documentos_compartidos_reconstruyen_todos_los_campos_e_inventario(self) -> None:
        """Las dos admisiones comparten código y guardas, sin perder sus entradas distintas."""
        pruebas = {}
        for n in range(2):
            dato = {"codigo": {"a": "a" * 64}, "controles": [{"real": True}], "corte": str(n), "resultado": {"id": n}}
            contenido = recibos_compartidos.canonico(dato)
            ref = almacen_catalogo.archivar_documento(
                contenido, self.area, pruebas, campos_evento=frozenset({"corte", "resultado"})
            )
            self.assertEqual(almacen_catalogo.leer_documento(self.area, ref), dato)
        self.assertEqual(len(list((self.area / "evidencias/metadatos").glob("*.json"))), 1)
        self.assertEqual(len(list((self.area / "evidencias/eventos").glob("*.json"))), 2)
        self.assertEqual(len(pruebas), 3)

    def test_lector_autonomo_rechaza_sha_invalido_antes_de_construir_ruta(self) -> None:
        """No necesita pasar antes por solicitud para acotar rutas de metadatos."""
        pruebas = {}
        ref = almacen_catalogo.archivar_documento(b'{"a":1}\n', self.area, pruebas, campos_evento=frozenset())
        archivo = self.area / ref["archivo"]
        original = json.loads(archivo.read_bytes())
        for sha in ("../ajeno", "A" * 64, "f" * 63, 42, None):
            with self.subTest(sha=sha):
                archivo.write_bytes(recibos_compartidos.canonico({**original, "metadatos_sha256": sha}))
                alterada = {**ref, "sha256": hashlib.sha256(archivo.read_bytes()).hexdigest()}
                with self.assertRaisesRegex(ValueError, "Referencia de metadatos incompatible"):
                    almacen_catalogo.leer_documento(self.area, alterada)

    def test_sin_metadatos_o_con_campo_repetido_no_reconstruye(self) -> None:
        """El evento exige su referencia exacta; bytes presentes no bastan."""
        captura = self.recibir(0)
        ausente = {k: v for k, v in captura.items() if k != "metadatos"}
        with self.assertRaises(FormatoInesperado):
            operacion_fuente.leer_recibo(self.area, ausente)
        meta = self.area / captura["metadatos"]["archivo"]
        meta.write_text("{}")
        with self.assertRaises(FormatoInesperado):
            operacion_fuente.leer_recibo(self.area, captura)
        with self.assertRaises(ValueError):
            recibos_compartidos.leer_json(b'{"a":1,"a":2}')
        evento, estables = recibos_compartidos.separar(b'{"a":1}\n', campos_evento=frozenset())
        roto = json.loads(estables)
        roto["datos"] = {"a": 2}
        with self.assertRaises(ValueError):
            recibos_compartidos.reconstruir(recibos_compartidos.canonico(roto), evento)


if __name__ == "__main__":
    unittest.main()
