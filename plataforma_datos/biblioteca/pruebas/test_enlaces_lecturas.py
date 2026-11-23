"""Observaciones técnicas de Biblioteca: ninguna respuesta HTTP acredita sola su identidad."""

import contextlib
import hashlib
import io
import json
import unittest
from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import contrato
from plataforma_datos.comun.pruebas.test_permisos_publicados import ModoDeLoPublicado

HTML = (
    b"<html><body><h1>Documento especifico</h1><p>" + b"Contenido legible del documento. " * 8 + b"</p></body></html>"
)
AHORA = datetime(2026, 10, 22, 12, tzinfo=UTC)
URL = "https://ejemplo.invalid/publicaciones/documento"


class PruebaContratoEnlaces(unittest.TestCase):
    """El estado distingue captura, identidad, legibilidad y tiempo de evaluación."""

    def captura(self, cuerpo: bytes = HTML, **cambios: object) -> contrato.Captura:
        """Crea una captura sintética con huella verificable.

        Returns:
            Captura inmutable; la fecha representa recepción completa, no ingestión.
        """
        campos = {
            "url": URL,
            "url_final": URL,
            "capturado_utc": AHORA.isoformat(),
            "cuerpo_sha256": hashlib.sha256(cuerpo).hexdigest(),
            "content_type": "text/html",
            "resultado": "respuesta",
            "codigo_http": None,
        }
        return contrato.Captura(**(campos | cambios))

    def identidad(self, captura: contrato.Captura) -> contrato.Identidad:
        """Declara revisión humana únicamente de los bytes de esta captura.

        Returns:
            Evidencia sintética ligada a URL y cuerpo, sin inferirla del título.
        """
        return contrato.Identidad(
            url=captura.url,
            url_final=captura.url_final,
            cuerpo_sha256=captura.cuerpo_sha256,
            revisado_utc=AHORA.isoformat(),
        )

    def evaluar(
        self, captura: contrato.Captura, cuerpo: bytes | None = HTML, identidad: contrato.Identidad | None = None
    ) -> dict[str, object]:
        """Evalúa con reloj fijo.

        Returns:
            Hechos técnicos y estado, nunca una decisión editorial.
        """
        return contrato.evaluar(captura, cuerpo, identidad, contrato.Contexto(AHORA, 7))

    def test_html_200_sin_identidad_no_es_verificado(self) -> None:
        """Un documento legible sin evidencia revisada permanece desconocido."""
        self.assertEqual(self.evaluar(self.captura())["estado"], "identidad_no_acreditada")

    def test_identidad_especifica_y_html_legible_confirman(self) -> None:
        """Solo la combinación de evidencia específica y contenido legible confirma."""
        captura = self.captura()
        self.assertEqual(self.evaluar(captura, identidad=self.identidad(captura))["estado"], "verificado")

    def test_login_o_redireccion_generica_no_confirman(self) -> None:
        """Incluso una huella revisada no convierte un acceso o portada en documento."""
        login = b'<html><body><input type="password">' + HTML + b"</body></html>"
        for cuerpo, final in ((HTML, "https://ejemplo.invalid/"), (login, URL)):
            with self.subTest(final=final):
                captura = self.captura(cuerpo, url_final=final)
                self.assertNotEqual(self.evaluar(captura, cuerpo, self.identidad(captura))["estado"], "verificado")

    def test_cambio_url_invalida_evidencia(self) -> None:
        """La evidencia de otra URL no hereda identidad aunque devuelva los mismos bytes."""
        anterior = self.captura()
        nueva = self.captura(url=URL + "-nueva", url_final=URL + "-nueva")
        self.assertEqual(self.evaluar(nueva, identidad=self.identidad(anterior))["estado"], "identidad_no_acreditada")

    def test_plazo_tecnico_no_reetiqueta_ni_renueva_la_captura(self) -> None:
        """Pasado el plazo sigue verificada con su fecha real; el plazo solo marca la revisión."""
        captura = self.captura()
        for dias in (7, 400):
            contexto = contrato.Contexto(AHORA + timedelta(days=dias), 7)
            resultado = contrato.evaluar(captura, HTML, self.identidad(captura), contexto)
            with self.subTest(dias=dias):
                self.assertEqual(resultado["estado"], "verificado")
                self.assertEqual(resultado["capturado_utc"], captura.capturado_utc)
                self.assertEqual(resultado["vence_utc"], (AHORA + timedelta(days=7)).isoformat())
        self.assertFalse(contrato.es_evidencia_concluyente("vencido"))

    def test_error_transitorio_no_es_retirada(self) -> None:
        """Un fallo conserva el hecho de fallo; nunca produce una baja editorial."""
        captura = self.captura(resultado="fallo_temporal", cuerpo_sha256=None, url_final=None, content_type="")
        resultado = self.evaluar(captura, None)
        self.assertEqual(resultado["estado"], "fallo_temporal")
        self.assertNotIn("retirada", resultado)

    def test_cabecera_pdf_no_acredita_texto_extraible(self) -> None:
        """La cabecera PDF no acredita lectura íntegra; exige revisión exacta adicional."""
        cuerpo = b"%PDF-1.7\ncontenido de fixture no es un PDF real\n%%EOF"
        captura = self.captura(cuerpo, content_type="application/pdf")
        self.assertNotEqual(self.evaluar(captura, cuerpo, self.identidad(captura))["estado"], "verificado")

    def test_cuerpo_alterado_o_fecha_futura_se_rechazan(self) -> None:
        """No se admite una captura que no puede corresponder a los bytes o al reloj."""
        for captura, cuerpo in (
            (self.captura(), b"alterado"),
            (self.captura(capturado_utc=(AHORA + timedelta(seconds=1)).isoformat()), HTML),
        ):
            with self.subTest(captura=captura), self.assertRaises(contrato.FormatoInesperado):
                self.evaluar(captura, cuerpo)


class _MontadorProductor:
    """El productor real conserva observaciones sin modificar el catálogo ni hacer red."""

    def setUp(self) -> None:
        """Crea evidencia y entregas propias con reloj fijo."""
        import json
        import tempfile
        from pathlib import Path
        from unittest import mock

        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import lector
        from plataforma_datos.comun.nucleo import Carpetas

        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name)
        self.lector = lector
        self.json = json
        self.mock = mock
        self.carpetas = Carpetas(*(self.base / nombre for nombre in ("original", "preparado", "validado")))
        self.catalogo = self.base / "catalogo.json"
        self.catalogo.write_text(json.dumps({"lecturas": [{"id": "lectura", "enlace": URL}]}))
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(lector, "CATALOGO", self.catalogo).start()
        mock.patch.object(lector, "carpetas", return_value=self.carpetas).start()
        mock.patch.object(lector, "ahora", return_value=AHORA).start()

    def captura(self, fecha: datetime = AHORA, fallo: bool = False) -> contrato.Captura:
        """Construye recepción o fallo de un enlace específico.

        Returns:
            Hecho temporal independiente de cuándo se persista.
        """
        return contrato.Captura(
            url=URL,
            url_final=None if fallo else URL,
            capturado_utc=fecha.isoformat(),
            cuerpo_sha256=None if fallo else hashlib.sha256(HTML).hexdigest(),
            content_type="" if fallo else "text/html",
            resultado="fallo_temporal" if fallo else "respuesta",
            codigo_http=None,
        )

    def identidad(self) -> None:
        """Aporta una decisión revisada, no deducida de la captura por el robot."""
        self.carpetas.original.mkdir(parents=True, exist_ok=True)
        documento = {
            "version": 1,
            "decisiones": {
                "lectura:enlace": [
                    {
                        "url": URL,
                        "url_final": URL,
                        "cuerpo_sha256": hashlib.sha256(HTML).hexdigest(),
                        "revisado_utc": (AHORA - timedelta(days=2)).isoformat(),
                        "texto_sha256": None,
                    }
                ]
            },
        }
        (self.carpetas.original / "identidades.json").write_text(self.json.dumps(documento))

    def informe(self) -> dict[str, object]:
        """Prepara y lee el resultado real.

        Returns:
            Informe de los objetivos del catálogo temporal.
        """
        self.lector.preparar()
        return self.json.loads((self.carpetas.preparado / self.lector.ARCHIVO).read_bytes())


class PruebaProductorEnlaces(_MontadorProductor, unittest.TestCase):
    """El productor real se verifica sobre un árbol exclusivo por caso."""

    def test_sin_capturas_todo_desconocido_y_editorial_intacto(self) -> None:
        """La ausencia de observaciones no se convierte en cobertura."""
        antes = self.catalogo.read_bytes()
        informe = self.informe()
        self.assertEqual(informe["verificados"], 0)
        self.assertEqual(informe["objetivos"][0]["estado"], "sin_observacion")
        self.assertEqual(self.catalogo.read_bytes(), antes)

    def test_misma_captura_y_exportacion_son_idempotentes(self) -> None:
        """Repetir no altera bytes, mtimes ni fechas de la evidencia o entrega."""
        self.identidad()
        captura = self.captura()
        self.lector.conservar(captura, HTML)
        self.lector.preparar()
        self.lector.validar()
        destino = self.base / "entrega.json"
        self.lector.exportar(destino)
        antes = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.base.rglob("*") if p.is_file()}
        self.lector.conservar(captura, HTML)
        self.lector.preparar()
        self.lector.validar()
        self.lector.exportar(destino)
        despues = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.base.rglob("*") if p.is_file()}
        self.assertEqual(antes, despues)
        self.assertEqual(self.informe()["verificados"], 1)

    def test_antigua_llegada_tarde_no_gana_y_fallo_conserva_confirmacion(self) -> None:
        """La última captura real manda y un fallo no borra la confirmación anterior."""
        self.identidad()
        buena = self.captura(AHORA - timedelta(days=1))
        self.lector.conservar(buena, HTML)
        self.lector.conservar(self.captura(fallo=True), None)
        self.lector.conservar(self.captura(AHORA - timedelta(days=3), fallo=True), None)
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["estado"], "fallo_temporal")
        self.assertEqual(fila["ultimo_intento"]["capturado_utc"], AHORA.isoformat())
        self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], buena.capturado_utc)

    def test_revision_nueva_conserva_evidencia_y_confirmacion_anteriores(self) -> None:
        """Una identidad nueva no borra qué captura anterior se había confirmado."""
        self.identidad()
        anterior = self.captura(AHORA - timedelta(days=2))
        self.lector.conservar(anterior, HTML)
        nuevo_cuerpo = HTML + b" contenido nuevo"
        nueva = self.captura(AHORA - timedelta(days=1))
        nueva = replace(nueva, cuerpo_sha256=hashlib.sha256(nuevo_cuerpo).hexdigest())
        self.lector.conservar(nueva, nuevo_cuerpo)
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["estado"], "identidad_no_acreditada")
        self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], anterior.capturado_utc)
        self.assertEqual(fila["ultima_evidencia"]["capturado_utc"], anterior.capturado_utc)
        ruta = self.carpetas.original / "identidades.json"
        decisiones = self.json.loads(ruta.read_bytes())
        decisiones["decisiones"]["lectura:enlace"].append(
            {
                "url": URL,
                "url_final": URL,
                "cuerpo_sha256": nueva.cuerpo_sha256,
                "revisado_utc": AHORA.isoformat(),
                "texto_sha256": None,
            }
        )
        ruta.write_text(self.json.dumps(decisiones))
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["estado"], "verificado")
        self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], nueva.capturado_utc)
        self.assertEqual(len(decisiones["decisiones"]["lectura:enlace"]), 2)

    def test_primera_captura_sin_identidad_no_es_evidencia_contraria(self) -> None:
        """Una respuesta legible aún no acreditada solo añade un intento."""
        self.lector.conservar(self.captura(), HTML)
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["estado"], "identidad_no_acreditada")
        self.assertIsNone(fila["ultima_evidencia"])
        self.assertIsNone(fila["ultima_confirmacion"])

    def test_ausencia_se_conserva_tras_incertidumbre_y_fallo_hasta_confirmacion(self) -> None:
        """Ni un cuerpo no revisado ni una llegada antigua revocan un 404 posterior."""
        self.identidad()
        inicial = self.captura(AHORA - timedelta(days=4))
        ausente = replace(self.captura(AHORA - timedelta(days=3), fallo=True), resultado="http_error", codigo_http=404)
        cuerpo = HTML + b" sin revision de identidad"
        desconocida = replace(self.captura(AHORA - timedelta(days=2)), cuerpo_sha256=hashlib.sha256(cuerpo).hexdigest())
        self.lector.conservar(ausente, None)
        self.lector.conservar(desconocida, cuerpo)
        self.lector.conservar(inicial, HTML)
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["estado"], "identidad_no_acreditada")
        self.assertEqual(fila["ultima_evidencia"]["estado"], "http_no_encontrado")
        self.assertEqual(fila["ultima_evidencia"]["capturado_utc"], ausente.capturado_utc)
        self.lector.conservar(self.captura(AHORA - timedelta(days=1), fallo=True), None)
        self.assertEqual(self.informe()["objetivos"][0]["ultima_evidencia"], fila["ultima_evidencia"])
        self.lector.conservar(self.captura(), HTML)
        recuperada = self.informe()["objetivos"][0]
        self.assertEqual(recuperada["ultima_evidencia"]["estado"], "verificado")
        self.assertEqual(recuperada["ultima_evidencia"]["capturado_utc"], AHORA.isoformat())

    def test_url_nueva_no_hereda_confirmacion(self) -> None:
        """Cambiar el enlace requiere otra observación y otra identidad."""
        self.identidad()
        self.lector.conservar(self.captura(), HTML)
        self.catalogo.write_text(self.json.dumps({"lecturas": [{"id": "lectura", "enlace": URL + "-nuevo"}]}))
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["estado"], "sin_observacion")
        self.assertIsNone(fila["ultima_confirmacion"])

    def test_plazo_pasado_exporta_la_misma_admision_sin_rejuvenecer(self) -> None:
        """El reloj no invalida la entrega: sigue la confirmación con su fecha, sin otra consulta."""
        self.identidad()
        captura = self.captura()
        self.lector.conservar(captura, HTML)
        self.lector.preparar()
        self.lector.validar()
        validado = (self.carpetas.validado / self.lector.ARCHIVO).read_bytes()
        destino = self.base / "entrega.json"
        with self.mock.patch.object(self.lector, "ahora", return_value=AHORA + timedelta(days=30)):
            self.lector.exportar(destino)
        self.assertEqual(destino.read_bytes(), validado)
        fila = json.loads(validado)["objetivos"][0]
        self.assertEqual(fila["estado"], "verificado")
        self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], captura.capturado_utc)

    def test_contrato_o_validado_alterado_no_se_exportan(self) -> None:
        """La admisión no queda vigente si cambia un recurso realmente usado."""
        self.lector.preparar()
        self.lector.validar()
        destino = self.base / "entrega.json"
        destino.write_bytes(b"anterior")
        (self.carpetas.validado / self.lector.ARCHIVO).write_bytes(b"alterado")
        with self.assertRaises(self.lector.ValidacionFallida):
            self.lector.exportar(destino)
        self.assertEqual(destino.read_bytes(), b"anterior")

    def test_descarga_real_emite_recibo_vinculado_sin_red(self) -> None:
        """El transporte simulado observa los mismos bytes que el productor conserva."""
        from plataforma_datos.comun.nucleo import Descarga
        from plataforma_datos.comun.observacion_remota import contexto_descarga, observar

        def transporte(
            url: str,
            _cabeceras: dict[str, str],
            *,
            perfil: str,
            maximo_bytes: int,
            comprobar_cabeceras: Callable[[int, str, Mapping[str, str]], None],
        ) -> Descarga:
            self.assertEqual(maximo_bytes, self.lector.MAX_BYTES)
            self.assertEqual(perfil, "idioma-original")
            comprobar_cabeceras(200, url, {"Content-Type": "text/html"})
            observar(url, "GET", None, url, HTML)
            return Descarga(HTML, url, "text/html")

        ruta = self.base / "recepcion.json"
        configuracion = self.json.dumps({"ruta": str(ruta), "fuente": "enlaces_lecturas", "intento": "fixture"})
        with (
            self.mock.patch.dict("os.environ", {"FARO_RECEPCION_REMOTA": configuracion}),
            self.mock.patch.object(self.lector, "descargar_url", side_effect=transporte),
            contexto_descarga(),
        ):
            self.lector.descargar()
        recibo = self.json.loads(ruta.read_bytes())
        self.assertEqual(len(recibo["peticiones"]), 1)
        self.assertEqual(recibo["peticiones"][0]["original_sha256"], hashlib.sha256(HTML).hexdigest())


def pdf_textual(paginas: int = 1, texto: bytes = b"Publicacion especifica con contenido textual integro.") -> bytes:
    """Construye PDF pequeño válido propio, sin descargar ni redistribuir documentos.

    Returns:
        PDF con objetos y tabla de referencias exactos.
    """
    contenido = b"BT /F1 12 Tf 20 200 Td (" + texto + b") Tj ET"
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count "
        + str(paginas).encode()
        + b" /Kids ["
        + b" ".join(str(5 + n).encode() + b" 0 R" for n in range(paginas))
        + b"] >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(contenido)).encode() + b" >>\nstream\n" + contenido + b"\nendstream",
    ]
    objetos += [
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] "
        b"/Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"
    ] * paginas
    salida = b"%PDF-1.7\n"
    offsets = [0]
    for numero, objeto in enumerate(objetos, 1):
        offsets.append(len(salida))
        salida += str(numero).encode() + b" 0 obj\n" + objeto + b"\nendobj\n"
    inicio = len(salida)
    salida += b"xref\n0 " + str(len(offsets)).encode() + b"\n0000000000 65535 f \n"
    salida += b"".join(f"{offset:010} 00000 n \n".encode() for offset in offsets[1:])
    return (
        salida
        + b"trailer\n<< /Size "
        + str(len(offsets)).encode()
        + b" /Root 1 0 R >>\nstartxref\n"
        + str(inicio).encode()
        + b"\n%%EOF\n"
    )


class PruebaPDFEnlaces(unittest.TestCase):
    """Prueba el parser real en proceso limitado y sus fallos explícitos."""

    def test_texto_extraido_es_distinto_de_revision_visual_e_identidad(self) -> None:
        """Una extracción completa no acredita identidad sin evidencia específica revisada."""
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.pdf import extraer

        cuerpo = pdf_textual()
        extraido = extraer(cuerpo)
        self.assertEqual(extraido["estado"], "legible_texto_extraido")
        self.assertIs(extraido["revision_visual"], False)
        captura = contrato.Captura(
            url=URL,
            url_final=URL,
            capturado_utc=AHORA.isoformat(),
            cuerpo_sha256=hashlib.sha256(cuerpo).hexdigest(),
            content_type="application/pdf",
            resultado="respuesta",
            codigo_http=None,
        )
        contexto = contrato.Contexto(AHORA, 7)
        self.assertEqual(contrato.evaluar(captura, cuerpo, None, contexto)["estado"], "identidad_no_acreditada")
        identidad = contrato.Identidad(
            url=URL,
            url_final=URL,
            cuerpo_sha256=captura.cuerpo_sha256,
            revisado_utc=AHORA.isoformat(),
            texto_sha256=extraido["texto_sha256"],
        )
        self.assertEqual(contrato.evaluar(captura, cuerpo, identidad, contexto)["estado"], "verificado")

    def test_mime_equivalente_exige_la_misma_huella_de_texto(self) -> None:
        """Mayúsculas y espacios MIME nunca eliminan la comprobación de identidad PDF."""
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.pdf import extraer

        cuerpo = pdf_textual()
        huella = hashlib.sha256(cuerpo).hexdigest()
        texto = extraer(cuerpo)["texto_sha256"]
        for tipo in ("application/pdf", "Application/PDF", "application/pdf ; charset=binary"):
            captura = contrato.Captura(
                url=URL,
                url_final=URL,
                capturado_utc=AHORA.isoformat(),
                cuerpo_sha256=huella,
                content_type=tipo,
                resultado="respuesta",
                codigo_http=None,
            )
            for declarada in (None, "0" * 64, texto):
                with self.subTest(tipo=tipo, texto=declarada):
                    identidad = contrato.Identidad(
                        url=URL,
                        url_final=URL,
                        cuerpo_sha256=huella,
                        revisado_utc=AHORA.isoformat(),
                        texto_sha256=declarada,
                    )
                    resultado = contrato.evaluar(captura, cuerpo, identidad, contrato.Contexto(AHORA, 7))
                    esperado = "verificado" if declarada == texto else "identidad_no_acreditada"
                    self.assertEqual(resultado["estado"], esperado)

    def test_truncado_sin_texto_o_paginas_excesivas_no_son_legibles(self) -> None:
        """No publica un extracto parcial como documento íntegro."""
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.pdf import extraer

        casos = (
            (pdf_textual()[:-50], "pdf_extraccion_fallida"),
            (pdf_textual(texto=b""), "pdf_sin_texto_extraible"),
            (pdf_textual(paginas=21), "pdf_limite_paginas"),
        )
        for cuerpo, esperado in casos:
            with self.subTest(esperado=esperado):
                self.assertEqual(extraer(cuerpo)["estado"], esperado)

    def test_plazo_excedido_y_tamano_excesivo_no_confirman(self) -> None:
        """El proceso agotado no produce un supuesto texto ni una confirmación."""
        from unittest import mock

        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import pdf

        with mock.patch.object(pdf, "PLAZO_S", 0):
            self.assertEqual(pdf.extraer(pdf_textual())["estado"], "pdf_plazo_excedido")
        self.assertEqual(pdf.extraer(b"x" * (pdf.MAX_BYTES + 1))["estado"], "pdf_limite_bytes")


class _MontadorCobertura(_MontadorProductor):
    """Contrasta recepción, admisión y contratos mediante los validadores reales."""

    def setUp(self) -> None:
        """Sitúa código/evidencia en una raíz portable propia, con copia mínima."""
        import shutil

        super().setUp()
        self.casa = self.base / "plataforma_datos/biblioteca/fuentes/enlaces_lecturas"
        shutil.copytree(self.lector.CASA, self.casa, ignore=shutil.ignore_patterns("__pycache__"))
        self.catalogo = self.casa.parent / "lecturas/catalogo.json"
        self.catalogo.parent.mkdir()
        self.catalogo.write_text(self.json.dumps({"lecturas": [{"id": "lectura", "enlace": URL}]}))
        from plataforma_datos.comun.nucleo import Carpetas

        self.carpetas = Carpetas(
            *(
                self.base / "var/actualizacion" / etapa / "enlaces_lecturas"
                for etapa in ("originales", "preparados", "validados")
            )
        )
        self.mock.patch.object(self.lector, "CASA", self.casa).start()
        self.mock.patch.object(self.lector, "CONTRATO", self.casa / "contrato.json").start()
        self.mock.patch.object(self.lector, "CATALOGO", self.catalogo).start()
        self.mock.patch.object(self.lector, "carpetas", return_value=self.carpetas).start()

    def recibo(self) -> dict[str, object]:
        """Crea una recepción exacta de la respuesta conservada.

        Returns:
            Contrato de recepción v2 acotado al recurso esperado.
        """
        from plataforma_datos.comun.observacion_remota import identidad_recurso

        return {
            "version": 2,
            "fuente": "enlaces_lecturas",
            "fin_utc": AHORA.isoformat(),
            "peticiones": [
                {
                    "recurso_sha256": identidad_recurso(URL),
                    "url_final_sha256": hashlib.sha256(URL.encode()).hexdigest(),
                    "respuesta_sha256": hashlib.sha256(HTML).hexdigest(),
                    "original_sha256": hashlib.sha256(HTML).hexdigest(),
                    "bytes": len(HTML),
                    "original_bytes": len(HTML),
                    "completado_utc": AHORA.isoformat(),
                }
            ],
        }


class PruebaCoberturaEnlaces(_MontadorCobertura, unittest.TestCase):
    """Contrasta la cobertura con la admisión y recepción reales."""

    def test_cobertura_no_acepta_recibo_sin_identidad(self) -> None:
        """Una captura real sin identidad continúa parcial, aunque la admisión sea íntegra."""
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import cobertura

        self.lector.conservar(self.captura(), HTML)
        self.lector.preparar()
        self.lector.validar()
        self.assertFalse(cobertura.comprobada(self.base, self.recibo()))

    def test_cobertura_exige_contrato_actual_y_recibo_exacto(self) -> None:
        """El contrato alterado o bytes ajenos invalidan la certificación remota conservada."""
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import cobertura

        self.identidad()
        self.lector.conservar(self.captura(), HTML)
        self.lector.preparar()
        self.lector.validar()
        with self.mock.patch.object(cobertura, "datetime") as reloj:
            reloj.now.return_value = AHORA
            self.assertTrue(cobertura.comprobada(self.base, self.recibo()))
            cambiado = self.recibo()
            cambiado["peticiones"][0]["respuesta_sha256"] = "0" * 64
            self.assertFalse(cobertura.comprobada(self.base, cambiado))
            (self.casa / "contrato.json").write_text('{"version":2,"validez_dias":2}')
            self.assertFalse(cobertura.comprobada(self.base, self.recibo()))

    def test_recibo_malformado_no_comprueba_y_un_defecto_interno_no_se_oculta(self) -> None:
        """Un recibo con otra forma es «no comprobada»; un error de programación se propaga en lugar de ocultarse."""
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import cobertura

        self.identidad()
        self.lector.conservar(self.captura(), HTML)
        self.lector.preparar()
        self.lector.validar()
        sin_campo = self.recibo()
        del sin_campo["peticiones"][0]["completado_utc"]
        malformados = (
            [],
            {"version": 2, "fuente": "enlaces_lecturas"},
            {**self.recibo(), "peticiones": None},
            {**self.recibo(), "peticiones": [None]},
            {**self.recibo(), "peticiones": [{}]},
            {**self.recibo(), "fin_utc": 5},
            sin_campo,
        )
        with self.mock.patch.object(cobertura, "datetime") as reloj:
            reloj.now.return_value = AHORA
            self.assertTrue(cobertura.comprobada(self.base, self.recibo()))
            for recibo in malformados:
                with self.subTest(recibo=recibo):
                    self.assertFalse(cobertura.comprobada(self.base, recibo))
            defecto = AttributeError("defecto interno")
            with (
                self.mock.patch.object(cobertura, "identidad_recurso", side_effect=defecto),
                self.assertRaises(AttributeError),
            ):
                cobertura.comprobada(self.base, self.recibo())


class PruebaDiagnosticoPDF(unittest.TestCase):
    """El hijo aislado que lee el PDF dice qué clase de error lo detuvo, sin rutas ni contenido."""

    def test_un_fallo_inesperado_lleva_su_tipo(self) -> None:
        """Un error del lector de PDF queda como extracción fallida con el nombre de su clase."""
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import pdf

        salida = io.StringIO()
        entrada = mock.Mock()
        entrada.buffer.read.return_value = b"%PDF-1.7"
        with (
            mock.patch.object(pdf, "_limites", return_value="prueba"),
            mock.patch.object(pdf, "_extraer", side_effect=RuntimeError("/ruta/privada/documento.pdf")),
            mock.patch.object(pdf.sys, "stdin", entrada),
            contextlib.redirect_stdout(salida),
        ):
            self.assertEqual(pdf.main(), 0)
        resultado = json.loads(salida.getvalue())
        self.assertEqual(resultado, {"estado": "pdf_extraccion_fallida", "tipo_error": "RuntimeError"})
        self.assertNotIn("ruta", salida.getvalue())


class PruebaSupervisionPDF(unittest.TestCase):
    """Ejercita terminación/recolección por RSS con un hijo pequeño, sin agotar memoria."""

    def test_rss_excesivo_o_desconocido_mata_y_recolecta_solo_su_hijo(self) -> None:
        """No sustituye una consulta de memoria fallida por cero."""
        import subprocess
        from unittest import mock

        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import pdf

        real = subprocess.Popen
        for memoria, esperado in (
            (None, "pdf_memoria_no_verificable"),
            (pdf.MEMORIA_BYTES + 1, "pdf_memoria_excedida"),
        ):
            hijos: list[subprocess.Popen[bytes]] = []

            def crear(
                *args: object, registro: list[subprocess.Popen[bytes]] = hijos, **kwargs: object
            ) -> subprocess.Popen[bytes]:
                """Registra únicamente el proceso que acaba de crear el productor.

                Returns:
                    Hijo real propio, con su PID verificable.
                """
                hijo = real(*args, **kwargs)
                registro.append(hijo)
                return hijo

            with (
                self.subTest(memoria=memoria),
                mock.patch.object(pdf.sys, "platform", "darwin"),
                mock.patch.object(pdf.subprocess, "Popen", side_effect=crear),
                mock.patch.object(pdf, "_rss_bytes", return_value=memoria) as consultar,
            ):
                resultado = pdf.extraer(pdf_textual())
            self.assertEqual(resultado["estado"], esperado)
            self.assertEqual(len(hijos), 1)
            consultar.assert_called_with(hijos[0].pid)
            self.assertIsNotNone(hijos[0].poll())
            self.assertLess(hijos[0].returncode, 0)

    def test_pdf_cifrado_permanece_sin_lectura(self) -> None:
        """No intenta claves ni afirma identidad de un PDF cifrado."""
        import io

        from pypdf import PdfWriter

        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.pdf import extraer

        documento = PdfWriter()
        documento.add_blank_page(width=200, height=200)
        documento.encrypt("fixture-local")
        salida = io.BytesIO()
        documento.write(salida)
        self.assertEqual(extraer(salida.getvalue())["estado"], "pdf_cifrado")


class PruebaRespaldoEnlaces(_MontadorCobertura, unittest.TestCase):
    """Usa el comprobador común de originales sobre respaldo y copia restaurada."""

    def test_inventario_real_respalda_y_restaura_con_integridad(self) -> None:
        """La proyección local no acredita red; toda evidencia se conserva y un cuerpo alterado se rechaza."""
        import shutil

        from plataforma_datos.comun.nucleo import HuellaIncorrecta
        from plataforma_datos.orquestacion import generacion_operativa as generacion

        self.identidad()
        self.lector.conservar(self.captura(), HTML)
        self.lector.preparar()
        self.lector.validar()
        inventario = self.json.loads((self.carpetas.original / "procedencia.json").read_bytes())
        self.assertNotIn("fecha", inventario)
        proyecciones = list((self.carpetas.original / "objetivos").glob("*.json"))
        self.assertIs(self.json.loads(proyecciones[0].read_bytes())["consulta_remota"], False)
        originales = generacion.originales_de_la_fuente(self.base, "enlaces_lecturas")
        esperados = {str(p.relative_to(self.base)) for p in self.carpetas.original.rglob("*") if p.is_file()}
        self.assertEqual(originales, esperados)
        restaurada = self.base / "restaurada"
        for nombre in originales:
            destino = restaurada / nombre
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.base / nombre, destino)
        self.assertEqual(generacion.originales_de_la_fuente(restaurada, "enlaces_lecturas"), originales)
        cuerpo = restaurada / next(nombre for nombre in originales if "/cuerpos/" in nombre)
        cuerpo.write_bytes(b"alterado")
        with self.assertRaises(HuellaIncorrecta):
            generacion.originales_de_la_fuente(restaurada, "enlaces_lecturas")


class ModoDeLasObservacionesDeEnlaces(ModoDeLoPublicado, unittest.TestCase):
    """Las observaciones de enlaces quedan legibles por otro usuario: 0666 menos la umask."""

    def escritores(self) -> dict[str, Callable[[Path, bytes], None]]:
        """Escritores propios del paquete cuya salida lee otro servicio.

        Returns:
            Cada escritor real por su nombre, con la firma (ruta, bytes).
        """
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import lector

        return {"enlaces_lecturas": lector._guardar}
