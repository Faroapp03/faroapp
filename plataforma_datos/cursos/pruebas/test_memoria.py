"""Pruebas de memoria.py: las tres cifras de la Memòria del Sistema FPCAT solo valen junto a su rótulo."""

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.fuentes.memoria.lector as memoria
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import ERROR, Carpetas, FormatoInesperado, ValidacionFallida
from plataforma_datos.orquestacion import admision

# Los renglones de la página 9, como los da pdf.py (recortados).
PAGINA = [
    "PROCEDIMENT ORDINARI - 2022-2025",
    "18.307",
    "PENDENTS",
    "344",
    "PUNTS D’INFORMACIÓ",
    "I ORIENTACIÓ DEL",
    "SERVEI D’ACREDITACIÓ",
    "19.961",
    "PERSONES HAN ACREDITAT",
    "MÍNIM UNA QUALIFICACIÓ",
    "PROFESSIONAL SENCERA",
]


class PruebaCifras(unittest.TestCase):
    """Cifras con su rótulo partido en renglones, el periodo y una cifra cambiada."""

    def test_lee_las_tres_cifras(self) -> None:
        """Cada cifra, como entero, cuando su rótulo la sigue aunque vaya partido."""
        self.assertEqual(
            memoria.cifras_de_la_pagina(PAGINA),
            {"personas_con_cualificacion_entera": 19961, "solicitudes_pendientes": 18307, "puntos_de_orientacion": 344},
        )

    def test_una_cifra_cambiada_detiene_la_lectura(self) -> None:
        """Si la edición nueva da otra cifra, no se toma la vieja: se detiene."""
        with self.assertRaises(FormatoInesperado):
            memoria.cifras_de_la_pagina([renglon.replace("19.961", "20.100") for renglon in PAGINA])

    def test_otro_periodo_detiene_la_lectura(self) -> None:
        """La página tiene que hablar del periodo 2022-2025."""
        with self.assertRaises(FormatoInesperado):
            memoria.cifras_de_la_pagina([PAGINA[0].replace("2022-2025", "2023-2026"), *PAGINA[1:]])

    def test_un_rotulo_cambiado_o_quitado_detiene_la_lectura(self) -> None:
        """Cada cifra solo vale junto a su rótulo: sin él, o con otro, se detiene."""
        for cifra, rotulo in (("18.307", "PENDENTS"), ("19.961", "PERSONES HAN ACREDITAT")):
            with self.subTest(cifra=cifra), self.assertRaises(FormatoInesperado):
                memoria.cifras_de_la_pagina([renglon.replace(rotulo, "ALTRES") for renglon in PAGINA])


class PruebaAdmision(unittest.TestCase):
    """La validación nunca publica un booleano como recuento de personas o puntos."""

    def test_preparado_no_objeto_se_rechaza_con_motivo(self) -> None:
        """Una raíz JSON dañada no llega a tratarse como un diccionario de cifras."""
        for cifras in ([], None, 7, "texto", True):
            with self.subTest(cifras=cifras), tempfile.TemporaryDirectory() as temporal:
                preparado = Path(temporal) / "cifras.json"
                preparado.write_text(json.dumps(cifras), encoding="utf-8")
                procedencia = Path(temporal) / "procedencia.json"
                procedencia.write_text('{"archivos":[]}', encoding="utf-8")
                with (
                    mock.patch.object(memoria, "CIFRAS", preparado),
                    mock.patch.object(memoria, "PROCEDENCIA", procedencia),
                    self.assertRaisesRegex(FormatoInesperado, "objeto"),
                ):
                    memoria.validar()

    def test_cifras_invalidas_impiden_publicar_el_conjunto(self) -> None:
        """El informe registra el rechazo y no se crea un conjunto admitido."""
        for valor in (True, False, 0, -1, 1.5, "344", None):
            with self.subTest(valor=valor), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal)
                carpetas = Carpetas(raiz / "original", raiz / "preparado", raiz / "validado")
                carpetas.original.mkdir()
                carpetas.preparado.mkdir()
                contenido = b"original de prueba"
                (carpetas.original / "original.pdf").write_bytes(contenido)
                procedencia = carpetas.original / "procedencia.json"
                procedencia.write_text(
                    json.dumps(
                        {"archivos": [{"archivo": "original.pdf", "sha256": hashlib.sha256(contenido).hexdigest()}]}
                    ),
                    encoding="utf-8",
                )
                cifras = memoria.cifras_de_la_pagina(PAGINA)
                cifras["puntos_de_orientacion"] = valor
                preparado = carpetas.preparado / "cifras.json"
                preparado.write_text(json.dumps(cifras), encoding="utf-8")
                with (
                    mock.patch.object(memoria, "CIFRAS", preparado),
                    mock.patch.object(memoria, "ORIGINAL", carpetas.original),
                    mock.patch.object(memoria, "PROCEDENCIA", procedencia),
                    mock.patch.object(entrada_salida, "carpetas", return_value=carpetas),
                    mock.patch.object(admision, "carpetas", return_value=carpetas),
                    contextlib.redirect_stdout(io.StringIO()),
                    self.assertRaises(ValidacionFallida),
                ):
                    memoria.validar()
                self.assertFalse((carpetas.validado / "memoria-fpcat.json").exists())
                informe = json.loads(carpetas.validacion.read_text(encoding="utf-8"))
                self.assertEqual(informe["controles"][-1]["resultado"], ERROR)


if __name__ == "__main__":
    unittest.main()
