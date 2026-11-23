"""La equivalencia observada conserva el vínculo íntegro del original y nunca se concede por defecto."""

import copy
import hashlib
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.orquestacion.cobertura_originales import original_equivalente, original_vinculado


class PruebaOriginalVinculado(unittest.TestCase):
    """Distingue bytes idénticos y equivalencia explícita sin relajar identidad, tamaño ni huellas."""

    def setUp(self) -> None:
        """Prepara un original conservado y una respuesta con distinta plantilla."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name)
        self.contenido = b"<p>Texto del recurso</p>"
        respuesta = b'<p class="nueva">Texto del recurso</p>'
        self.esperado = {"archivo": "pagina.html", "url": "https://oficial.example/pagina"}
        (self.carpeta / "pagina.html").write_bytes(self.contenido)
        self.registro = {
            **self.esperado,
            "url_final": self.esperado["url"],
            "bytes": len(self.contenido),
            "sha256": hashlib.sha256(self.contenido).hexdigest(),
        }
        self.peticion = {
            "url_final_sha256": hashlib.sha256(self.esperado["url"].encode()).hexdigest(),
            "bytes": len(respuesta),
            "respuesta_sha256": hashlib.sha256(respuesta).hexdigest(),
            "original_bytes": len(self.contenido),
            "original_sha256": self.registro["sha256"],
        }

    def test_la_equivalencia_no_se_infiere_de_un_original_vinculado(self) -> None:
        """Los consumidores existentes siguen exigiendo igualdad exacta con el cuerpo recibido."""
        with self.assertRaises(ValueError):
            original_vinculado(self.carpeta, self.esperado, self.registro, self.peticion)

    def test_equivalencia_explicita_conserva_original_sin_escribir(self) -> None:
        """Solo un consumidor con política de equivalencia puede aceptar un cuerpo distinto vinculado."""
        resultado = original_equivalente(self.carpeta, self.esperado, self.registro, self.peticion)
        self.assertEqual(resultado, self.contenido)
        self.assertEqual((self.carpeta / "pagina.html").read_bytes(), self.contenido)

    def test_equivalencia_no_perdona_vinculo_ausente_o_defectuoso(self) -> None:
        """Una equivalencia no sustituye una respuesta real ni su relación con el original conservado."""
        for campo, valor in (
            ("original_sha256", None),
            ("original_sha256", "0" * 64),
            ("original_bytes", None),
            ("original_bytes", True),
            ("original_bytes", len(self.contenido) + 1),
            ("url_final_sha256", "0" * 64),
            ("respuesta_sha256", None),
            ("bytes", 0),
            ("bytes", True),
        ):
            with self.subTest(campo=campo, valor=valor):
                peticion = copy.deepcopy(self.peticion)
                peticion[campo] = valor
                with self.assertRaises(ValueError):
                    original_equivalente(self.carpeta, self.esperado, self.registro, peticion)

    def test_equivalencia_no_admite_un_archivo_cambiado(self) -> None:
        """El contenido conservado se relee; declarar una huella no equivale a poseer esos bytes."""
        (self.carpeta / "pagina.html").write_bytes(b"contenido ajeno")
        with self.assertRaises(ValueError):
            original_equivalente(self.carpeta, self.esperado, self.registro, self.peticion)


if __name__ == "__main__":
    unittest.main()
