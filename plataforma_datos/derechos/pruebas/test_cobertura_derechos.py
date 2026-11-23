"""Los siete recursos seleccionados de derechos se comprueban completos sin prometer descubrimiento normativo."""

import copy
import hashlib
import io
import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock
from urllib.request import Request

import plataforma_datos.derechos.fuentes.derechos.lector as derechos
from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import OriginalCambiado
from plataforma_datos.comun.observacion_remota import VARIABLE_RECEPCION, contexto_descarga, identidad_recurso
from plataforma_datos.orquestacion import cobertura_derechos as cobertura

DIA = "2026-10-17"


def sha(contenido: bytes) -> str:
    """Identifica un cuerpo de la fixture.

    Returns:
        Su SHA256 hexadecimal.
    """
    return hashlib.sha256(contenido).hexdigest()


def consolidado(numeros: tuple[int, ...]) -> bytes:
    """Construye artículos legibles por el comparador real del BOE.

    Returns:
        HTML sintético con la fecha y los bloques citados por la selección.
    """
    bloques = "".join(
        f"<p>[Bloque {numero}: #a{numero}]</p><h5>Artículo {numero}. Título.</h5><p>Texto de {numero}.</p>"
        for numero in numeros
    )
    return f"<html><body><p>Última actualización publicada el 03/10/2026</p>{bloques}</body></html>".encode()


class Respuesta(io.BytesIO):
    """Respuesta HTTP sintética que atraviesa el lector y observador reales."""

    def __init__(self, url: str, datos: bytes) -> None:
        super().__init__(datos)
        self.url = url
        self.headers = {"Content-Length": str(len(datos)), "Content-Type": "application/octet-stream"}


class PruebaCoberturaDerechos(unittest.TestCase):
    """Cada vínculo, el inventario cerrado y la extracción del CRL son requisitos independientes."""

    def setUp(self) -> None:
        """Prepara una captura independiente, sin usar la copia operativa del producto."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.carpeta = self.raiz / "var/actualizacion/originales/derechos"
        self.carpeta.mkdir(parents=True)
        self.procedencia = {"copia": DIA, "archivos": []}
        self.evidencia = {"version": 2, "fuente": "derechos", "peticiones": []}
        for archivo in derechos.archivos_de_la_copia(DIA):
            url = archivo["url"]
            contenido = url.encode()
            if archivo["archivo"].startswith("estatuto-consolidado"):
                contenido = consolidado((64,))
            elif archivo["archivo"].startswith("lopdgdd-consolidada"):
                contenido = consolidado((87, 88, 89, 90))
            (self.carpeta / archivo["archivo"]).write_bytes(contenido)
            self.procedencia["archivos"].append(
                {
                    **{clave: archivo[clave] for clave in ("archivo", "nivel", "titulo", "url", "licencia")},
                    "url_final": url,
                    "bytes": len(contenido),
                    "sha256": sha(contenido),
                    "descargado_utc": "2026-10-07T00:00:00Z",
                }
            )
            self.evidencia["peticiones"].append(
                {
                    "recurso_sha256": identidad_recurso(url),
                    "url_final_sha256": sha(url.encode()),
                    "respuesta_sha256": sha(contenido),
                    "bytes": len(contenido),
                    "original_sha256": sha(contenido),
                    "original_bytes": len(contenido),
                }
            )
        pdf = next(registro for registro in self.procedencia["archivos"] if registro["url"] == derechos.CRL_ES)
        extraccion = b'[{"pagina":1,"texto":"Texto de prueba"}]'
        nombre = derechos.nombre_del_original(derechos.EXTRACCION, DIA, "json")
        (self.carpeta / nombre).write_bytes(extraccion)
        self.procedencia["archivos"].append(
            {
                "archivo": nombre,
                "nivel": "extracción",
                "origen": pdf["archivo"],
                "sha256_de_origen": pdf["sha256"],
                "bytes": len(extraccion),
                "sha256": sha(extraccion),
            }
        )
        self.guardar()

    def guardar(self) -> None:
        """Escribe solo la procedencia temporal de la fixture."""
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")

    def test_completa_no_modifica_originales_ni_fechas(self) -> None:
        """Consultar de nuevo los mismos bytes no renueva los metadatos de la captura."""
        antes = {ruta.name: ruta.read_bytes() for ruta in self.carpeta.iterdir()}
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
        self.assertEqual({ruta.name: ruta.read_bytes() for ruta in self.carpeta.iterdir()}, antes)

    def test_cada_recurso_es_necesario_con_su_vinculo_exacto(self) -> None:
        """La falta de un recurso, vínculo, URL final o método no acredita el conjunto seleccionado."""
        for indice in range(len(self.evidencia["peticiones"])):
            for campo in (None, "recurso_sha256", "original_sha256", "url_final_sha256"):
                caso = copy.deepcopy(self.evidencia)
                if campo is None:
                    caso["peticiones"].pop(indice)
                else:
                    caso["peticiones"][indice][campo] = "0" * 64
                with self.subTest(indice=indice, campo=campo):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_duplicados_extras_versiones_y_tipos_no_cubren(self) -> None:
        """Ni duplicar ni añadir consultas ni cambiar método se equipara a los siete GET sin cuerpo."""
        for variante in ("duplicada", "extra", "post", "cuerpo", "version", "tamano"):
            caso = copy.deepcopy(self.evidencia)
            if variante == "duplicada":
                caso["peticiones"][-1] = caso["peticiones"][0]
            elif variante == "extra":
                caso["peticiones"].append(caso["peticiones"][0])
            elif variante in ("post", "cuerpo"):
                url = derechos.ESTATUTO.api
                caso["peticiones"][0]["recurso_sha256"] = identidad_recurso(
                    url, "POST" if variante == "post" else "GET", b""
                )
            elif variante == "version":
                caso["version"] = True
            else:
                caso["peticiones"][0]["original_bytes"] = True
            with self.subTest(variante=variante):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_la_extraccion_local_necesita_bytes_y_pdf_de_origen(self) -> None:
        """Una extracción ajena o alterada no se convierte en otra consulta remota."""
        original = copy.deepcopy(self.procedencia)
        for campo, valor in (("sha256_de_origen", "0" * 64), ("bytes", True), ("origen", "../otro.pdf")):
            self.procedencia = copy.deepcopy(original)
            self.procedencia["archivos"][-1][campo] = valor
            self.guardar()
            with self.subTest(campo=campo):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        self.procedencia = original
        self.guardar()
        nombre = self.procedencia["archivos"][-1]["archivo"]
        (self.carpeta / nombre).write_bytes(b"otra extraccion")
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_la_equivalencia_solo_se_admite_en_los_dos_consolidados(self) -> None:
        """Los XML, PDF y convenios conservan igualdad exacta entre HTTP y original."""
        for indice, archivo in enumerate(derechos.archivos_de_la_copia(DIA)):
            caso = copy.deepcopy(self.evidencia)
            caso["peticiones"][indice].update(respuesta_sha256="f" * 64, bytes=123)
            with self.subTest(archivo=archivo["archivo"]):
                self.assertEqual(cobertura.comprobada(self.raiz, caso), archivo.get("equivalentes") is not None)

    def test_originales_y_extraccion_admiten_su_fecha_historica(self) -> None:
        """Los archivos que no cambiaron pueden ser anteriores al día de la copia."""
        for registro in self.procedencia["archivos"]:
            anterior = registro["archivo"]
            registro["archivo"] = anterior.replace(DIA, "2026-10-07")
            (self.carpeta / anterior).rename(self.carpeta / registro["archivo"])
        self.guardar()
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
        self.procedencia["copia"] = "2026-10-06"
        self.guardar()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_inventario_duplicado_ruta_ajena_y_enlaces_no_se_admiten(self) -> None:
        """La lectura cerrada no sigue enlaces ni ignora registros repetidos."""
        self.procedencia["archivos"].append(self.procedencia["archivos"][0])
        self.guardar()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        self.procedencia["archivos"].pop()
        self.guardar()
        ruta = self.carpeta / self.procedencia["archivos"][0]["archivo"]
        otro = self.raiz / "ajeno"
        ruta.rename(otro)
        ruta.symlink_to(otro)
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_transporte_real_distingue_plantilla_y_pasaje_citado(self) -> None:
        """El lector y comparador reales permiten plantilla y detienen cambios en artículos seleccionados."""
        anteriores = {
            registro["url"]: self.carpeta / registro["archivo"] for registro in self.procedencia["archivos"][:-1]
        }
        cuerpos = {url: ruta.read_bytes() for url, ruta in anteriores.items()}
        recibo = self.raiz / "recepcion.json"
        configuracion = json.dumps({"ruta": str(recibo), "fuente": "derechos", "intento": "prueba"})

        def abrir(peticion: Request, timeout: float) -> Respuesta:
            """Devuelve otra plantilla del Estatuto sin alterar su artículo citado.

            Returns:
                Respuesta que usa la identidad genérica validada y atraviesa el lector real.
            """
            self.assertEqual(peticion.get_header("User-agent"), red.agente_de_usuario())
            datos = cuerpos[peticion.full_url]
            if peticion.full_url == derechos.NORMAS[derechos.tecnologia.ESTATUTO].url:
                datos = datos.replace(b"<body>", b"<body><!-- otra visita -->")
            return Respuesta(peticion.full_url, datos)

        with (
            mock.patch.dict(os.environ, {VARIABLE_RECEPCION: configuracion}),
            mock.patch.object(derechos, "ORIGINAL", self.carpeta),
            mock.patch.object(derechos, "PROCEDENCIA", self.carpeta / "procedencia.json"),
            mock.patch.object(red, "abrir_peticion", side_effect=abrir),
            mock.patch.object(derechos.time, "sleep"),
            contexto_descarga(),
        ):
            derechos.descargar(hoy=date.fromisoformat(DIA))
        evidencia = json.loads(recibo.read_text())
        self.assertTrue(cobertura.comprobada(self.raiz, evidencia))
        self.assertNotEqual(
            evidencia["peticiones"][2]["respuesta_sha256"], evidencia["peticiones"][2]["original_sha256"]
        )
        url = derechos.NORMAS[derechos.tecnologia.ESTATUTO].url
        cuerpos[url] = cuerpos[url].replace(b"Texto de 64", b"Cambio de 64")
        antes = (self.carpeta / "procedencia.json").read_bytes()
        with (
            mock.patch.object(derechos, "ORIGINAL", self.carpeta),
            mock.patch.object(derechos, "PROCEDENCIA", self.carpeta / "procedencia.json"),
            mock.patch.object(red, "abrir_peticion", side_effect=abrir),
            mock.patch.object(derechos.time, "sleep"),
            self.assertRaises(OriginalCambiado),
        ):
            derechos.descargar(hoy=date.fromisoformat(DIA))
        self.assertEqual((self.carpeta / "procedencia.json").read_bytes(), antes)


if __name__ == "__main__":
    unittest.main()
