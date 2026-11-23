"""Consulta del corpus ACTIC declarado: tres disposiciones y dos páginas, sin certificar su selección."""

import copy
import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from http.client import HTTPResponse
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request

import plataforma_datos.cursos.fuentes.actic.cobertura as cobertura
import plataforma_datos.cursos.fuentes.actic.lector as actic
from plataforma_datos.comun import observacion_remota, red
from plataforma_datos.comun.nucleo import OriginalCambiado
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.comun.pruebas.test_observacion_remota import respuesta_http
from plataforma_datos.cursos.pruebas.test_actic import contenido_sintetico

FINALES = {
    actic.CONTENIDOS: "https://portaldogc.gencat.cat/utilsEADOP/PDF/9634/2142836.pdf",
    actic.NORMAS: "https://portaldogc.gencat.cat/utilsEADOP/PDF/9634/2142738.pdf",
    actic.MODIFICACION: "https://portaldogc.gencat.cat/utilsEADOP/PDF/9712/2162675.pdf",
}
INSTANTE = "2026-10-17T08:00:00Z"


def sha(contenido: bytes) -> str:
    """Identifica los bytes completos de una captura sintética.

    Returns:
        SHA256 hexadecimal del cuerpo.
    """
    return hashlib.sha256(contenido).hexdigest()


class PruebaCoberturaActic(unittest.TestCase):
    """Las consultas completas y vinculadas se distinguen de copias locales o parciales."""

    def setUp(self) -> None:
        """Construye originales y recibo independientes de las capturas operativas y de la red."""
        pausa_red = patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.carpeta = self.raiz / "var/actualizacion/originales/actic"
        self.carpeta.mkdir(parents=True)
        self.procedencia = {"archivos": []}
        self.evidencia = {
            "version": 2,
            "fuente": "actic",
            "intento": "normativa_94",
            "comienzo_utc": INSTANTE,
            "fin_utc": "2026-10-17T08:02:00Z",
            "peticiones": [],
        }
        for archivo in actic.ARCHIVOS:
            nombre, url = archivo["archivo"], archivo["url"]
            contenido = contenido_sintetico(nombre)
            final = FINALES.get(nombre, url)
            (self.carpeta / nombre).write_bytes(contenido)
            self.procedencia["archivos"].append(
                {
                    **copy.deepcopy(archivo),
                    "url_final": final,
                    "bytes": len(contenido),
                    "sha256": sha(contenido),
                    "descargado_utc": "2026-10-07T08:00:00Z",
                }
            )
            self.evidencia["peticiones"].append(
                {
                    "recurso_sha256": identidad_recurso(url),
                    "url_final_sha256": sha(final.encode()),
                    "respuesta_sha256": sha(contenido),
                    "bytes": len(contenido),
                    "original_sha256": sha(contenido),
                    "original_bytes": len(contenido),
                    "completado_utc": INSTANTE,
                }
            )
        self.guardar()

    def guardar(self) -> None:
        """Guarda únicamente la procedencia del temporal propio."""
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")

    def test_consulta_completa_no_reescribe_originales_ni_fechas(self) -> None:
        """Los cinco cuerpos exactos acreditan su consulta y dejan intacta la evidencia conservada."""
        antes = {ruta.name: ruta.read_bytes() for ruta in self.carpeta.iterdir()}
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
        self.assertEqual({ruta.name: ruta.read_bytes() for ruta in self.carpeta.iterdir()}, antes)
        for indice, archivo in enumerate(actic.ARCHIVOS):
            self.procedencia["archivos"][indice]["url_final"] = archivo["url"]
            self.evidencia["peticiones"][indice]["url_final_sha256"] = sha(archivo["url"].encode())
        self.guardar()
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))

    def test_cada_recurso_y_cada_vinculo_son_necesarios(self) -> None:
        """Ni cuatro recursos ni un cuerpo anterior permiten acreditar el corpus completo."""
        for indice in range(len(actic.ARCHIVOS)):
            for campo in (None, "recurso_sha256", "url_final_sha256", "respuesta_sha256", "original_sha256"):
                caso = copy.deepcopy(self.evidencia)
                if campo is None:
                    caso["peticiones"].pop(indice)
                else:
                    # HTML puede tener respuesta distinta tras equivalencia; una huella mal formada nunca vale.
                    caso["peticiones"][indice][campo] = "invalida" if campo == "respuesta_sha256" else "0" * 64
                with self.subTest(indice=indice, campo=campo):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_otra_identidad_metodo_o_inventario_no_es_la_consulta(self) -> None:
        """Los recibos de otra fuente, v1, duplicados, extras y POST no se equiparan a cinco GET."""
        for cambio in ("fuente", "version", "bool", "duplicado", "extra", "post", "tamano"):
            caso = copy.deepcopy(self.evidencia)
            if cambio == "fuente":
                caso["fuente"] = "derechos"
            elif cambio in ("version", "bool"):
                caso["version"] = True if cambio == "bool" else 1
            elif cambio == "duplicado":
                caso["peticiones"][-1] = caso["peticiones"][0]
            elif cambio == "extra":
                caso["peticiones"].append(caso["peticiones"][0])
            elif cambio == "post":
                caso["peticiones"][0]["recurso_sha256"] = identidad_recurso(actic.ARCHIVOS[0]["url"], "POST")
            else:
                caso["peticiones"][0]["original_bytes"] = True
            with self.subTest(cambio=cambio):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_los_pdf_no_admiten_equivalencia_de_respuesta(self) -> None:
        """La excepción de las plantillas HTML no se extiende a ninguna de las tres disposiciones."""
        for indice, archivo in enumerate(actic.ARCHIVOS):
            if archivo["archivo"].endswith(".pdf"):
                caso = copy.deepcopy(self.evidencia)
                caso["peticiones"][indice]["respuesta_sha256"] = "0" * 64
                with self.subTest(archivo=archivo["archivo"]):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_inventario_local_completo_y_metadatos_de_la_disposicion(self) -> None:
        """No se pierde la identidad por indexar duplicados ni se acepta una norma sustituida."""
        original = copy.deepcopy(self.procedencia)
        for cambio in ("omitido", "duplicado", "extra", "norma", "norma-en-pagina", "url"):
            self.procedencia = copy.deepcopy(original)
            registros = self.procedencia["archivos"]
            if cambio == "omitido":
                registros.pop()
            elif cambio in ("duplicado", "extra"):
                copia = copy.deepcopy(registros[0])
                if cambio == "extra":
                    copia["archivo"] = "otra-disposicion.pdf"
                registros.append(copia)
            elif cambio == "norma":
                registros[0]["norma"]["cve"] = "otra-disposicion"
            elif cambio == "norma-en-pagina":
                registros[-1]["norma"] = None
            else:
                registros[0]["url"] = actic.ARCHIVOS[1]["url"]
            self.guardar()
            with self.subTest(cambio=cambio):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_redireccion_ajena_o_a_otro_pdf_del_dogc_no_es_la_disposicion(self) -> None:
        """La coincidencia del host oficial no autoriza otro documento ni una sucesora."""
        for final in ("https://example.test/orden.pdf", FINALES[actic.NORMAS]):
            self.procedencia["archivos"][0]["url_final"] = final
            self.evidencia["peticiones"][0]["url_final_sha256"] = sha(final.encode())
            self.guardar()
            with self.subTest(final=final):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def abrir(self, peticion: Request, timeout: float) -> HTTPResponse:
        """Sirve los recursos oficiales desde memoria, con cambio de plantilla solo en las páginas.

        Returns:
            Respuesta HTTP real con cuerpo completo y URL final declarada.
        """
        self.assertGreater(timeout, 0)
        self.assertEqual(peticion.get_header("User-agent"), red.agente_de_usuario())
        archivo = next(archivo for archivo in actic.ARCHIVOS if archivo["url"] == peticion.full_url)
        nombre = archivo["archivo"]
        contenido = (self.carpeta / nombre).read_bytes()
        if nombre.endswith(".html"):
            contenido = contenido.replace(b"<body>", b"<body><script>var fecha=2;</script>")
        if self.cambiar_texto and nombre == actic.PROCEDIMIENTO:
            contenido = contenido.replace(b"La tramitaci", b"Otra tramitaci")
        tipo = b"text/html" if nombre.endswith(".html") else b"application/pdf"
        cabeceras = b"Content-Type: " + tipo + b"\r\nContent-Length: " + str(len(contenido)).encode() + b"\r\n"
        respuesta = respuesta_http(cabeceras, contenido)
        respuesta.url = FINALES.get(nombre, archivo["url"])
        return respuesta

    def descargar_observada(self, ruta: Path) -> None:
        """Ejecuta conservación, comparación HTML y observación v2 reales sobre la fixture propia."""
        configuracion = json.dumps({"ruta": str(ruta), "fuente": "actic", "intento": "plantilla94"})
        with (
            patch.object(actic, "ORIGINAL", self.carpeta),
            patch.object(actic, "PROCEDENCIA", self.carpeta / "procedencia.json"),
            patch.object(red, "abrir_peticion", side_effect=self.abrir),
            patch.dict(os.environ, {observacion_remota.VARIABLE_RECEPCION: configuracion}),
            redirect_stdout(io.StringIO()),
            observacion_remota.contexto_descarga(),
        ):
            actic.descargar()

    def test_plantilla_equivalente_del_transporte_acredita_sin_cambiar_datos(self) -> None:
        """El recibo real vincula ambas páginas equivalentes y mantiene los PDF y las fechas anteriores."""
        self.cambiar_texto = False
        antes = {archivo["archivo"]: (self.carpeta / archivo["archivo"]).read_bytes() for archivo in actic.ARCHIVOS}
        conjunto_antes = actic.conjunto(self.procedencia)
        ruta = self.raiz / "recepcion.json"
        self.descargar_observada(ruta)
        evidencia = observacion_remota.leer_recepcion(ruta, "actic", "plantilla94")
        self.assertIsNotNone(evidencia)
        self.assertTrue(cobertura.comprobada(self.raiz, evidencia))
        despues = json.loads((self.carpeta / "procedencia.json").read_bytes())
        self.assertEqual(actic.conjunto(despues), conjunto_antes)
        self.assertEqual(
            {archivo["archivo"]: (self.carpeta / archivo["archivo"]).read_bytes() for archivo in actic.ARCHIVOS}, antes
        )
        if evidencia is not None:
            for archivo, peticion in zip(actic.ARCHIVOS, evidencia["peticiones"], strict=True):
                self.assertEqual(
                    peticion["respuesta_sha256"] == peticion["original_sha256"], archivo["archivo"].endswith(".pdf")
                )

    def test_texto_distinto_se_detiene_sin_recibo_ni_reescritura(self) -> None:
        """Tener los mismos nombres y URLs no autoriza automáticamente nuevos hechos del portal."""
        self.cambiar_texto = True
        antes = {ruta.name: ruta.read_bytes() for ruta in self.carpeta.iterdir()}
        ruta = self.raiz / "recepcion-rechazada.json"
        with self.assertRaisesRegex(OriginalCambiado, "actic-procediment.html"):
            self.descargar_observada(ruta)
        self.assertFalse(ruta.exists())
        self.assertEqual({ruta.name: ruta.read_bytes() for ruta in self.carpeta.iterdir()}, antes)

    def test_original_faltante_alterado_o_enlazado_no_se_acredita(self) -> None:
        """Se aplica la lectura común acotada sobre los originales usados, sin seguir enlaces."""
        ruta = self.carpeta / actic.CONTENIDOS
        contenido = ruta.read_bytes()
        ruta.write_bytes(contenido + b"alterado")
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        ruta.unlink()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        otra = self.raiz / "otra.pdf"
        otra.write_bytes(contenido)
        ruta.symlink_to(otra)
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_integracion_exige_admision_y_tres_etapas(self) -> None:
        """El seguimiento conserva la distinción entre reconstrucción, consulta parcial y módulo admitido."""
        from plataforma_datos.orquestacion.pruebas.test_seguimiento_catalogos import PruebaSeguimientoCatalogos
        from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import COBERTURAS_COMPLETAS

        control = PruebaSeguimientoCatalogos()
        for variante in ("completo", "rechazado", "parcial", "local", "etapa-fallida"):
            with self.subTest(variante=variante), patch.dict(COBERTURAS_COMPLETAS, {"actic": cobertura.comprobada}):
                self.setUp()
                control.comprobar("actic", variante, self.raiz, copy.deepcopy(self.evidencia))


if __name__ == "__main__":
    unittest.main()
