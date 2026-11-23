"""La cobertura de ocupados se deriva solo de los cuatro metadatos HTTP vinculados."""

import copy
import io
import json
import os
import tempfile
import unittest
from http.client import HTTPResponse
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request

import plataforma_datos.mercado.fuentes.ocupados.lector as ocupados
from plataforma_datos.comun import observacion_remota, red
from plataforma_datos.orquestacion import cobertura_series as cobertura
from plataforma_datos.orquestacion.pruebas import test_cobertura_series
from plataforma_datos.orquestacion.pruebas.test_cobertura_series import (
    archivos_ocupados,
    cuerpos_ocupados,
    sha,
)


class PruebaCoberturaOcupados(unittest.TestCase):
    """Metadatos íntegros antes de planificar; recursos exactos después de planificar."""

    def setUp(self) -> None:
        """Reutiliza la copia aislada del coordinador, sin capturas operativas."""
        copia = test_cobertura_series.PruebaCoberturaSeries()
        copia.setUp()
        self.addCleanup(copia.doCleanups)
        self.raiz = copia.raiz
        _, self.carpeta, self.procedencia, self.evidencia = next(c for c in copia.casos if c[0] == "ocupados")
        self.recursos = archivos_ocupados(cuerpos_ocupados())

    def guardar(self) -> None:
        """Conserva el doble de procedencia sin modificar los originales."""
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia))

    def sustituir(self, nombre: str, contenido: bytes) -> None:
        """Simula un cuerpo HTTP diferente pero íntegro, vinculado con sus bytes reales."""
        registro = next(r for r in self.procedencia["archivos"] if r["archivo"] == nombre)
        peticion = next(
            p
            for p in self.evidencia["peticiones"]
            if p["recurso_sha256"] == observacion_remota.identidad_recurso(registro["url"])
        )
        (self.carpeta / nombre).write_bytes(contenido)
        registro.update(sha256=sha(contenido), bytes=len(contenido))
        peticion.update(
            respuesta_sha256=sha(contenido),
            original_sha256=sha(contenido),
            bytes=len(contenido),
            original_bytes=len(contenido),
        )
        self.guardar()

    def test_marcador_ausente_booleano_o_version_desconocida_no_acredita(self) -> None:
        """La versión nueva no se infiere del número de recursos ni confunde True con 1."""
        for valor in (None, True, False, 0, 2, "1", 1.0):
            self.procedencia["idescat_partes"] = valor
            self.guardar()
            with self.subTest(valor=valor):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_cuatro_metadatos_vinculados_antes_de_planificar(self) -> None:
        """Ni un mapa válido del disco se usa si falta la identidad HTTP de un metadato."""
        for meta in ocupados.METADATOS_IDESCAT:
            original = copy.deepcopy(self.evidencia)
            identidad = observacion_remota.identidad_recurso(meta["url"])
            self.evidencia["peticiones"] = [p for p in original["peticiones"] if p["recurso_sha256"] != identidad]
            with self.subTest(archivo=meta["archivo"]), mock.patch.object(ocupados, "planificar_partes") as plan:
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
                plan.assert_not_called()
            self.evidencia = original

    def test_mapa_local_alterado_no_se_lee_para_planificar(self) -> None:
        """El calendario del archivo tiene que seguir siendo el cuerpo completo observado."""
        for meta in ocupados.METADATOS_IDESCAT:
            ruta = self.carpeta / meta["archivo"]
            original = ruta.read_bytes()
            ruta.write_bytes(original + b" ")
            with self.subTest(archivo=meta["archivo"]), mock.patch.object(ocupados, "planificar_partes") as plan:
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
                plan.assert_not_called()
            ruta.write_bytes(original)

    def test_metadatos_ambiguos_o_sin_year_aunque_http_sea_integro_no_acreditan(self) -> None:
        """Una recepción exacta no convierte un documento inválido en plan fiable."""
        meta = ocupados.METADATOS_IDESCAT[0]
        original = (self.carpeta / meta["archivo"]).read_bytes()
        sin_year = json.loads(original)
        sin_year["dimension"].pop("YEAR")
        for contenido in (b'{"dimension":{},"dimension":{}}', b'{"x":NaN}', b"[]", json.dumps(sin_year).encode()):
            self.sustituir(meta["archivo"], contenido)
            with self.subTest(contenido=contenido[:80]):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
            self.sustituir(meta["archivo"], original)

    def test_plan_recalculado_no_acepta_partes_de_otro_calendario(self) -> None:
        """Metadatos íntegros de cinco años no acreditan las partes conservadas de tres años."""
        nuevos = cuerpos_ocupados(("2021", "2022", "2023", "2024", "2025"))
        for meta in ocupados.METADATOS_IDESCAT:
            self.sustituir(meta["archivo"], nuevos[meta["url"]])
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_original_mixto_o_partes_duplicadas_no_sustituyen_http_independientes(self) -> None:
        """No cabe un agregado legacy ni dos recibos de una parte en el inventario exacto."""
        partes = self.recursos[len(ocupados.METADATOS_IDESCAT) : -len(ocupados.ARCHIVOS_AUXILIARES)]
        for parte in partes:
            caso = copy.deepcopy(self.evidencia)
            identidad = observacion_remota.identidad_recurso(parte["url"])
            peticion = next(p for p in caso["peticiones"] if p["recurso_sha256"] == identidad)
            legado = next(a for a in ocupados.ARCHIVOS if a["url"] == parte["url"].split("&YEAR=", 1)[0])
            peticion["recurso_sha256"] = observacion_remota.identidad_recurso(legado["url"])
            with self.subTest(archivo=parte["archivo"]):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))
        caso = copy.deepcopy(self.evidencia)
        caso["peticiones"][-1] = copy.deepcopy(caso["peticiones"][-2])
        self.assertFalse(cobertura.comprobada(self.raiz, caso))


class PruebaTransporteOcupadosPorPartes(unittest.TestCase):
    """La fuente real conserva cada respuesta y produce su recepción v2 mediante el transporte común."""

    def setUp(self) -> None:
        """Inyecta el turno virtual para que la frontera HTTP simulada nunca duerma realmente."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)

    def descargar(self, raiz: Path, *, fallo: str | None = None) -> tuple[dict | None, list[Request]]:
        """Ejecuta una captura de cinco años con la última parte municipal separada.

        Returns:
            Recepción, si terminó, y peticiones observadas por el doble HTTP.
        """
        cuerpos = cuerpos_ocupados(("2021", "2022", "2023", "2024", "2025"))
        recursos = archivos_ocupados(cuerpos)
        municipal = next(a for a in reversed(recursos) if "municipios-2025-2025" in a["archivo"])
        carpeta = raiz / "var/actualizacion/originales/ocupados"
        recibo = raiz / "recepcion.json"
        peticiones = []

        def abrir(peticion: Request, **_opciones: object) -> HTTPResponse:
            peticiones.append(peticion)
            datos = cuerpos[peticion.full_url]
            es_ultima = peticion.full_url == municipal["url"]
            if es_ultima and fallo == "416":
                raise HTTPError(peticion.full_url, 416, "Range Not Satisfiable", {}, None)
            if es_ultima and fallo == "year":
                documento = json.loads(datos)
                documento["dimension"]["YEAR"]["category"]["index"] = ["2024"]
                datos = json.dumps(documento).encode()
            longitud = len(datos) + int(es_ultima and fallo == "truncado")
            conexion = mock.Mock()
            conexion.makefile.return_value = io.BytesIO(
                f"HTTP/1.1 200 OK\r\nContent-Length: {longitud}\r\n\r\n".encode() + datos
            )
            respuesta = HTTPResponse(conexion)
            respuesta.begin()
            respuesta.url = peticion.full_url
            return respuesta

        configuracion = {
            observacion_remota.VARIABLE_RECEPCION: json.dumps(
                {"ruta": str(recibo), "fuente": "ocupados", "intento": "actual_91"}
            )
        }
        with (
            mock.patch.dict(os.environ, configuracion),
            mock.patch.object(red, "abrir_peticion", side_effect=abrir),
            mock.patch.object(ocupados, "ORIGINAL", carpeta),
            mock.patch.object(ocupados, "PROCEDENCIA", carpeta / "procedencia.json"),
            observacion_remota.contexto_descarga(),
        ):
            ocupados.descargar()
        return observacion_remota.leer_recepcion(recibo, "ocupados", "actual_91"), peticiones

    def test_cinco_anios_son_doce_respuestas_exactas_sin_original_agregado(self) -> None:
        """La segunda parte municipal queda vinculada y no rejuvenece ni modifica capturas antiguas."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            carpeta = raiz / "var/actualizacion/originales/ocupados"
            carpeta.mkdir(parents=True)
            antiguo = carpeta / ocupados.TABLA_17977["municipio"]
            antiguo.write_bytes(b"captura anterior preservada")
            evidencia, peticiones = self.descargar(raiz)
            self.assertIsNotNone(evidencia)
            self.assertEqual(len(peticiones), 12)
            self.assertEqual(len(evidencia["peticiones"]), 12)
            self.assertTrue(
                all(
                    p.get_header("User-agent") == red.agente_de_usuario() and p.get_method() == "GET"
                    for p in peticiones
                )
            )
            self.assertTrue(cobertura.comprobada(raiz, evidencia))
            self.assertEqual(antiguo.read_bytes(), b"captura anterior preservada")
            procedencia = json.loads((carpeta / "procedencia.json").read_bytes())
            self.assertEqual(procedencia["idescat_partes"], 1)
            self.assertNotIn(antiguo.name, {a["archivo"] for a in procedencia["archivos"]})
            for indice in range(len(evidencia["peticiones"])):
                omitida = copy.deepcopy(evidencia)
                omitida["peticiones"].pop(indice)
                with self.subTest(omitida=indice):
                    self.assertFalse(cobertura.comprobada(raiz, omitida))

    def test_ultima_parte_truncada_o_http_416_no_emite_recibo_completo(self) -> None:
        """Las respuestas anteriores no compensan el fallo de la última parte municipal."""
        for fallo, error in (("truncado", red.FormatoInesperado), ("416", HTTPError)):
            with self.subTest(fallo=fallo), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal)
                with self.assertRaises(error):
                    self.descargar(raiz, fallo=fallo)
                self.assertFalse((raiz / "recepcion.json").exists())
                self.assertFalse((raiz / "var/actualizacion/originales/ocupados/procedencia.json").exists())

    def test_year_recortado_no_se_admite_como_parte_completa(self) -> None:
        """El HTTP íntegro puede contener otro año y su fuente debe rechazarlo antes de emitir la recepción."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            with self.assertRaises(red.FormatoInesperado):
                self.descargar(raiz, fallo="year")
            self.assertFalse((raiz / "recepcion.json").exists())


if __name__ == "__main__":
    unittest.main()
