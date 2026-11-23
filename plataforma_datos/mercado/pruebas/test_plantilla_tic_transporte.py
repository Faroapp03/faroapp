"""Cobertura de 20 respuestas simuladas: plantilla TIC no hereda la consulta de otra tabla."""

import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from http.client import HTTPResponse
from pathlib import Path
from unittest import mock
from urllib.request import Request

from plataforma_datos.comun import observacion_remota as observacion
from plataforma_datos.comun import red
from plataforma_datos.comun.pruebas.test_observacion_remota import respuesta_http
from plataforma_datos.mercado.fuentes.empresas import lector
from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine, contrato_eticce, plantilla_tic
from plataforma_datos.mercado.pruebas import ayuda_calendario
from plataforma_datos.mercado.pruebas.test_periodos_empresas import tabla_eurostat
from plataforma_datos.mercado.pruebas.test_plantilla_tic import contrato_propio, series_propias
from plataforma_datos.orquestacion import cobertura_empresas

RECURSOS_COMPLETOS = 20
AGENTE = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
)


def series_regionales() -> list[dict]:
    """Conserva dos literales propios en una estructura regional independiente.

    Returns:
        Las dos series de Cataluña, con agrupación y territorio explícitos.
    """
    series = series_propias()
    for serie in series:
        serie["Nombre"] = serie["Nombre"].replace("Total Empresas,", "Cataluña,", 1)
        serie["MetaData"][0] = {"T3_Variable": "Comunidades y ciudades autónomas", "Nombre": "Cataluña"}
        serie["MetaData"][2] = {"T3_Variable": "Agrupación de actividad", "Nombre": "Total Empresas"}
    return series


def cuerpos_propios() -> tuple[dict[str, bytes], dict]:
    """Construye un índice, capítulos y tablas sintéticas completos, sin leer capturas externas.

    Returns:
        Respuestas por URL exacta y contrato sintético para las cuatro filas TIC.
    """
    titulos = [
        "Las TIC en las empresas (2025 o primer trimestre de2026) por agrupación de actividad",
        "Las TIC en las empresas (2025 o primer trimestre de2026)",
        "Las TIC en las empresas con10 o más empleados (2025 o primer trimestre de2026) por sectores de actividad",
        "Errores de muestreo",
    ]
    titulos = [t.replace("de2026", "de 2026").replace("con10", "con 10") for t in titulos]
    indice = "".join(f'<a href="/capitulo?capsel={i}">{t}</a>' for i, t in enumerate(titulos))
    _, direcciones = lector.capitulos(indice)
    cuerpos = {lector.RESULTADOS: indice.encode()}
    tablas = {}
    plantilla = {"sectores": "82386", "comunidades": "82408"}
    for numero, (parte, url) in enumerate(direcciones.items(), start=100):
        tablas[parte] = str(numero)
        texto = f'<a href="/jaxi/Tabla.htm?tpx={numero}">{lector.CAPITULOS[parte][1]}</a>'
        if parte in plantilla:
            texto += f'<a href="/jaxi/Tabla.htm?tpx={plantilla[parte]}">Especialistas TIC</a>'
        cuerpos[url] = texto.encode()
    edicion = {"anio": 2026, "nombre": "2025–1T2026", "tablas": tablas}
    for descriptor in lector.archivos_del_ine(edicion):
        cuerpos[descriptor["url"]] = json.dumps(series_propias()).encode()
    for parte in tablas:
        cuerpos[lector.archivo_de_notas(parte, edicion)["url"]] = b"notas D.1 propias"
    for regional in (False, True):
        tabla = tabla_eurostat("ES51", (2023, 2024, 2025)) if regional else tabla_eurostat()
        cuerpos[lector.archivo_de_eurostat_disponible(regional)["url"]] = json.dumps(tabla).encode()
    cuerpos[calendario_ine.URL] = ayuda_calendario.CUERPO
    contrato = contrato_propio()
    contrato["partes"]["comunidades"] = {
        **contrato["partes"]["sectores"],
        "tabla": "82408",
        "sha256_definicion": plantilla_tic.firma(series_regionales()),
    }
    return cuerpos, contrato


class PruebaTransportePlantilla(unittest.TestCase):
    """Cada dato y nota queda vinculado antes del GET siguiente; todas las respuestas son necesarias."""

    def test_veinte_cuerpos_vinculados_y_cuatro_nuevos_obligatorios(self) -> None:
        """El verificador real rechaza la omisión o cambio de cualquiera de los cuatro recursos TIC."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            hogar = raiz / "hogar"
            hogar.mkdir()
            (hogar / ".curlrc").write_text(f'user-agent = "{AGENTE}"\n', encoding="utf-8")
            cuerpos, contrato = cuerpos_propios()
            with mock.patch.object(plantilla_tic, "contrato", return_value=contrato):
                edicion = {
                    "anio": 2026,
                    "nombre": "2025–1T2026",
                    "plantilla_tic": plantilla_tic.metadatos(
                        "2025–1T2026", {"sectores": "82386", "comunidades": "82408"}
                    ),
                }
                for parte, descriptor, notas in zip(
                    sorted(edicion["plantilla_tic"]["tablas"]),
                    plantilla_tic.archivos(edicion),
                    plantilla_tic.archivos(edicion, notas=True),
                    strict=True,
                ):
                    cuerpos[descriptor["url"]] = json.dumps(
                        series_regionales() if parte == "comunidades" else series_propias()
                    ).encode()
                    cuerpos[notas["url"]] = b'<ul id="capaListadoNotas"><li>Bases: empresas y personal TIC</li></ul>'
                evidencia = self.descargar(raiz, hogar, cuerpos)
                self.assertEqual(len(evidencia["peticiones"]), RECURSOS_COMPLETOS)
                self.assertTrue(all(p["respuesta_sha256"] == p["original_sha256"] for p in evidencia["peticiones"]))
                with (
                    mock.patch.object(contrato_eticce, "definicion_conocida", return_value=True),
                    mock.patch.object(contrato_eticce, "comprobar_notas"),
                ):
                    self.assertTrue(cobertura_empresas.comprobada(raiz, evidencia))
                    for i in range(len(evidencia["peticiones"])):
                        alterada = copy.deepcopy(evidencia)
                        alterada["peticiones"].pop(i)
                        with self.subTest(omitida=i):
                            self.assertFalse(cobertura_empresas.comprobada(raiz, alterada))

    def descargar(self, raiz: Path, hogar: Path, cuerpos: dict[str, bytes]) -> dict:
        """Ejecuta el transporte real sobre respuestas propias, sin pausa ni red reales.

        Returns:
            Recibo v2 emitido por el observador real de las respuestas simuladas.
        """

        def abrir(peticion: Request, timeout: float) -> HTTPResponse:
            self.assertEqual(peticion.get_header("User-agent"), AGENTE)
            cuerpo = cuerpos[peticion.full_url]
            tipo = (
                ayuda_calendario.CABECERA
                if peticion.full_url == calendario_ine.URL
                else "Content-Type: application/json\r\n"
            )
            respuesta = respuesta_http(f"Content-Length: {len(cuerpo)}\r\n{tipo}".encode(), cuerpo)
            respuesta.url = peticion.full_url.replace("/js/", "/jsCache/", 1)
            return respuesta

        carpeta = raiz / "var/actualizacion/originales/empresas"
        recibo = raiz / "recibo.json"
        config = json.dumps({"ruta": str(recibo), "fuente": "empresas", "intento": "plantilla"})
        with (
            mock.patch.multiple(lector, ORIGINAL=carpeta, PROCEDENCIA=carpeta / "procedencia.json"),
            mock.patch.object(red, "abrir_peticion", side_effect=abrir),
            mock.patch("time.sleep"),
            mock.patch.object(Path, "home", return_value=hogar),
            mock.patch.object(contrato_eticce, "definicion_conocida", return_value=True),
            mock.patch.object(contrato_eticce, "comprobar_notas"),
            mock.patch.dict(os.environ, {observacion.VARIABLE_RECEPCION: config}),
            observacion.contexto_descarga(),
            redirect_stdout(io.StringIO()),
        ):
            lector.descargar(True)
        return observacion.leer_recepcion(recibo, "empresas", "plantilla")


if __name__ == "__main__":
    unittest.main()
