"""Historial conservado y selección previa a la extracción, sin límite vitalicio."""

import hashlib
import json
import unittest
from collections.abc import Iterator
from dataclasses import asdict, replace
from datetime import timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import contrato
from plataforma_datos.biblioteca.pruebas.test_enlaces_lecturas import (
    AHORA,
    HTML,
    URL,
    _MontadorProductor,
    pdf_textual,
)

CAPTURAS_GRANDES = 10_001


class PruebaHistorialEnlaces(_MontadorProductor, unittest.TestCase):
    """Recorre evidencias verificadas y extrae solo candidatos, en temporales propios."""

    def _pdf_revisado(self) -> bytes:
        """Conserva tres fechas del mismo cuerpo y su revisión textual específica.

        Returns:
            PDF propio, con tres capturas y un solo archivo de contenido.
        """
        cuerpo = pdf_textual()
        texto = contrato.extraer(cuerpo)
        self.assertEqual(texto["estado"], "legible_texto_extraido")
        captura = replace(
            self.captura(), cuerpo_sha256=hashlib.sha256(cuerpo).hexdigest(), content_type="application/pdf"
        )
        for dias in (2, 1, 0):
            self.lector.conservar(replace(captura, capturado_utc=(AHORA - timedelta(days=dias)).isoformat()), cuerpo)
        identidad = contrato.Identidad(
            url=URL,
            url_final=URL,
            cuerpo_sha256=captura.cuerpo_sha256,
            revisado_utc=AHORA.isoformat(),
            texto_sha256=texto["texto_sha256"],
        )
        self._decisiones([identidad])
        return cuerpo

    def _decisiones(self, identidades: list[contrato.Identidad]) -> None:
        """Escribe únicamente decisiones sintéticas explícitas para el objetivo de prueba."""
        self.carpetas.original.mkdir(parents=True, exist_ok=True)
        documento = {"version": 1, "decisiones": {"lectura:enlace": [asdict(valor) for valor in identidades]}}
        (self.carpetas.original / "identidades.json").write_text(json.dumps(documento))

    def test_tres_capturas_del_mismo_pdf_se_extraen_una_vez_por_operacion(self) -> None:
        """Las fechas conservadas no obligan a volver a parsear cada repetición."""
        self._pdf_revisado()
        etapas = (
            self.lector.preparar,
            self.lector.validar,
            lambda: self.lector.exportar(self.base / "entrega.json"),
        )
        for etapa in etapas:
            with self.subTest(etapa=etapa), mock.patch.object(contrato, "extraer", wraps=contrato.extraer) as extraer:
                etapa()
                self.assertEqual(extraer.call_count, 1)
        self.assertEqual(len(list((self.carpetas.original / "capturas").glob("*.json"))), 3)
        self.assertEqual(len(list((self.carpetas.original / "cuerpos").iterdir())), 1)

    def test_inventario_virtual_superior_a_diez_mil_no_limita_la_vida_de_la_fuente(self) -> None:
        """Simula metadatos válidos sin fabricar diez mil PDF ni archivos de captura."""
        captura = self.captura()
        self.lector.conservar(captura, HTML)
        capturas = self.carpetas.original / "capturas"
        leer_real, sha_real = self.lector._leer, self.lector.sha256

        def leer(ruta: Path) -> dict[str, object]:
            """Proporciona los registros virtuales; otros recursos se leen realmente.

            Returns:
                Captura del instante correspondiente o documento real.
            """
            if ruta.parent == capturas:
                return asdict(
                    replace(captura, capturado_utc=(AHORA - timedelta(seconds=int(ruta.stem, 16))).isoformat())
                )
            return leer_real(ruta)

        def sha(ruta: Path) -> str:
            """Sustituye solo la comprobación de los nombres del inventario virtual.

            Returns:
                Nombre de captura simulado o huella real del recurso.
            """
            return ruta.stem if ruta.parent == capturas else sha_real(ruta)

        def rutas(ruta: Path, patron: str) -> Iterator[Path]:
            """Enumera el inventario virtual sin materializar sus registros.

            Returns:
                Generador de rutas virtuales para la única consulta de capturas.
            """
            self.assertEqual((ruta, patron), (capturas, "*.json"))
            return (capturas / f"{indice:064x}.json" for indice in range(CAPTURAS_GRANDES))

        with (
            mock.patch.object(self.lector, "_leer", side_effect=leer),
            mock.patch.object(self.lector, "sha256", side_effect=sha),
            mock.patch.object(Path, "glob", autospec=True, side_effect=rutas),
            mock.patch.object(self.lector, "_contexto", return_value=contrato.Contexto(AHORA, 7)),
        ):
            informe = self.informe()
        self.assertEqual(informe["objetivos"][0]["ultimo_intento"]["capturado_utc"], AHORA.isoformat())
        self.assertEqual(informe["verificados"], 0)

    def test_un_cuerpo_antiguo_alterado_se_rechaza_aunque_no_sea_candidato(self) -> None:
        """Seleccionar después de verificar nunca oculta corrupción del archivo histórico."""
        antigua = self.captura(AHORA - timedelta(days=1))
        self.lector.conservar(antigua, HTML)
        nuevo = HTML + b" cuerpo nuevo"
        reciente = replace(self.captura(), cuerpo_sha256=hashlib.sha256(nuevo).hexdigest())
        self.lector.conservar(reciente, nuevo)
        (self.carpetas.original / "cuerpos" / antigua.cuerpo_sha256).write_bytes(b"alterado")
        with self.assertRaises(self.lector.FormatoInesperado):
            self.lector.preparar()

    def test_instantes_equivalentes_con_hechos_distintos_siguen_siendo_conflictivos(self) -> None:
        """Z y +00:00 no esquivan el control de simultaneidad UTC."""
        self.lector.conservar(self.captura(), HTML)
        self.lector.conservar(
            replace(self.captura(fallo=True), capturado_utc=AHORA.isoformat().replace("+00:00", "Z")), None
        )
        with self.assertRaisesRegex(self.lector.FormatoInesperado, "simultáneas"):
            self.lector.preparar()

    def test_confirmacion_anterior_se_busca_sin_parsear_cuerpos_sin_revision(self) -> None:
        """Una captura nueva sin pin conserva la confirmación anterior con su fecha real."""
        self._pdf_revisado()
        nuevo = pdf_textual(texto=b"Documento distinto sin revision especifica.")
        reciente = replace(
            self.captura(),
            cuerpo_sha256=hashlib.sha256(nuevo).hexdigest(),
            content_type="application/pdf",
            capturado_utc=(AHORA + timedelta(seconds=1)).isoformat(),
        )
        with mock.patch.object(self.lector, "ahora", return_value=AHORA + timedelta(seconds=1)):
            self.lector.conservar(reciente, nuevo)
            with mock.patch.object(contrato, "extraer", wraps=contrato.extraer) as extraer:
                fila = self.informe()["objetivos"][0]
        self.assertEqual(extraer.call_count, 2)
        self.assertEqual(fila["estado"], "identidad_no_acreditada")
        self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], AHORA.isoformat())

    def test_cuerpo_compartido_reutiliza_mime_normalizado_sin_compartir_identidad(self) -> None:
        """Dos objetivos comparten extracción, pero solo el revisado acredita identidad."""
        cuerpo = self._pdf_revisado()
        otra_url = URL + "-otro"
        captura = replace(
            self.captura(),
            url=otra_url,
            url_final=otra_url,
            cuerpo_sha256=hashlib.sha256(cuerpo).hexdigest(),
            content_type="Application/PDF ; charset=binary",
        )
        self.lector.conservar(captura, cuerpo)
        self.catalogo.write_text(
            json.dumps({"lecturas": [{"id": "lectura", "enlace": URL}, {"id": "otra", "enlace": otra_url}]})
        )
        with mock.patch.object(contrato, "extraer", wraps=contrato.extraer) as extraer:
            filas = self.informe()["objetivos"]
        self.assertEqual(extraer.call_count, 1)
        self.assertEqual([fila["estado"] for fila in filas], ["verificado", "identidad_no_acreditada"])

    def test_reutilizacion_no_sobrevive_a_la_operacion(self) -> None:
        """Un fallo temporal del extractor no se reutiliza en una preparación posterior."""
        self._pdf_revisado()
        with mock.patch.object(contrato, "extraer", return_value={"estado": "pdf_plazo_excedido"}):
            self.assertEqual(self.informe()["objetivos"][0]["estado"], "pdf_plazo_excedido")
        with mock.patch.object(contrato, "extraer", wraps=contrato.extraer) as extraer:
            self.assertEqual(self.informe()["objetivos"][0]["estado"], "verificado")
        self.assertEqual(extraer.call_count, 1)

    def test_indice_se_cierra_y_elimina_ante_exito_error_e_interrupcion(self) -> None:
        """Nunca incorpora el índice a originales ni deja conexiones propias abiertas."""
        import sqlite3
        import tempfile
        from contextlib import nullcontext

        self.lector.conservar(self.captura(), HTML)
        directorio_real = tempfile.TemporaryDirectory
        conectar_real = sqlite3.connect
        anotar_real = self.lector._anotar
        for fallo in (None, self.lector.FormatoInesperado, KeyboardInterrupt):
            directorios: list[Path] = []
            conexiones: list[sqlite3.Connection] = []

            def directorio(*, prefix: str, registro: list[Path] = directorios) -> tempfile.TemporaryDirectory[str]:
                """Registra únicamente el temporal creado por el índice.

                Returns:
                    Directorio temporal real, bajo responsabilidad del productor.
                """
                resultado = directorio_real(prefix=prefix)
                registro.append(Path(resultado.name))
                return resultado

            def conectar(ruta: Path, registro: list[sqlite3.Connection] = conexiones) -> sqlite3.Connection:
                """Registra la conexión real del índice.

                Returns:
                    Conexión temporal cuyo cierre se comprueba después.
                """
                resultado = conectar_real(ruta)
                registro.append(resultado)
                return resultado

            with (
                self.subTest(fallo=fallo),
                mock.patch.object(self.lector.tempfile, "TemporaryDirectory", side_effect=directorio),
                mock.patch.object(self.lector.sqlite3, "connect", side_effect=conectar),
                mock.patch.object(self.lector, "_anotar", side_effect=anotar_real if fallo is None else fallo),
                nullcontext() if fallo is None else self.assertRaises(fallo),
            ):
                self.lector._crear()
            self.assertEqual(len(directorios), 1)
            self.assertFalse(directorios[0].exists())
            self.assertEqual(len(conexiones), 1)
            with self.assertRaises(sqlite3.ProgrammingError):
                conexiones[0].execute("SELECT 1")
        self.assertFalse(list(self.carpetas.original.rglob("*.sqlite3")))
