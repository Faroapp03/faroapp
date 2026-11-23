"""Vínculo de las series abiertas con respuestas y originales sintéticos, sin red real."""

import copy
import hashlib
import io
import json
import os
import tempfile
import unittest
from http.client import HTTPResponse
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

import plataforma_datos.mercado.fuentes.ocupados.lector as ocupados
from plataforma_datos.comun import observacion_remota, red
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.mercado.pruebas.test_ocupados_actualizable import series_ine, tabla
from plataforma_datos.orquestacion import cobertura_series as cobertura

INSTANTE = "2026-10-17T08:00:00Z"


def sha(datos: bytes) -> str:
    """Calcula la huella de una entrada de prueba.

    Returns:
        SHA-256 hexadecimal.
    """
    return hashlib.sha256(datos).hexdigest()


def cuerpos_ocupados(anios: tuple[str, ...] = ("2021", "2022", "2023")) -> dict[str, bytes]:
    """Cuerpos HTTP independientes para metadatos, partes y controles, sin originales operativos.

    Returns:
        URL exacta → cuerpo completo. Cinco años requieren dos partes municipales.
    """
    documentos = {}
    metadatos = {}
    for descriptor, dimension, territorios in zip(
        ocupados.METADATOS_IDESCAT,
        ("CAT", "CAT", "COM", "MUN"),
        (["TOTAL"], ["TOTAL"], list(ocupados.COMARCAS_DE_LA_ZONA), sorted(ocupados.MUNICIPIOS)),
        strict=True,
    ):
        contenido = tabla(anios)
        contenido["id"][1] = dimension
        contenido["dimension"].pop("CAT")
        contenido["dimension"][dimension] = {"category": {"index": territorios}}
        contenido["size"][1] = len(territorios)
        grupos = (
            [f"A{codigo:03}" for codigo in range(100, 270)]
            if dimension == "CAT" and "17980" in descriptor["archivo"]
            else [f"A{codigo:02}" for codigo in range(62)]
        )
        grupos += ["TOTAL", "_U"]
        contenido["dimension"]["OCC_2011"]["category"]["index"] = grupos
        contenido["size"][2] = len(grupos)
        contenido["value"] = []
        metadatos[descriptor["archivo"]] = contenido
        documentos[descriptor["url"]] = contenido
    for descriptor in ocupados.planificar_partes(metadatos):
        original = next(
            metadatos[meta["archivo"]]
            for meta in ocupados.METADATOS_IDESCAT
            if descriptor["url"].split("&YEAR=", 1)[0] == meta["url"].replace("?", "/data?", 1)
        )
        contenido = copy.deepcopy(original)
        seleccion = parse_qs(urlsplit(descriptor["url"]).query)["YEAR"][0].split(",")
        contenido["dimension"]["YEAR"]["category"]["index"] = seleccion
        contenido["size"][0] = len(seleccion)
        contenido["value"] = [150] * (len(seleccion) * contenido["size"][1] * contenido["size"][2] * 3)
        # La API simplifica la fuente cuando toda la parte pertenece al censo anual.
        if "2021" not in seleccion:
            fuente = "Idescat, a partir del Censo de población anual del INE."
            contenido["source"] = fuente
            contenido["extension"]["source"] = [fuente]
        else:
            fuentes = [
                "2021: Idescat, a partir del Censo de población y viviendas del INE.",
                f"2022-{seleccion[-1]}: Idescat, a partir del Censo de población anual del INE.",
            ]
            contenido["source"] = " ".join(fuentes)
            contenido["extension"]["source"] = fuentes
        documentos[descriptor["url"]] = contenido
    documentos[ocupados.ARCHIVOS_AUXILIARES[0]["url"]] = {
        "fitxes": {
            "v": [
                {"id": "11", "v": [{"id": codigo} for codigo in ocupados.MUNICIPIOS[:20]]},
                {"id": "13", "v": [{"id": codigo} for codigo in ocupados.MUNICIPIOS[20:]]},
            ]
        }
    }
    documentos[ocupados.ARCHIVOS_AUXILIARES[1]["url"]] = series_ine()
    ciudades = []
    for codigo in ocupados.CIUDADES_INE:
        series = series_ine()
        for serie in series:
            serie["MetaData"][0] = {"T3_Variable": "Municipios", "Nombre": codigo, "Codigo": codigo}
        ciudades.extend(series)
    documentos[ocupados.ARCHIVOS_AUXILIARES[2]["url"]] = ciudades
    return {url: json.dumps(documento).encode() for url, documento in documentos.items()}


def archivos_ocupados(cuerpos: dict[str, bytes]) -> list[dict]:
    """Recursos del plan con sus cuatro metadatos y tres auxiliares.

    Returns:
        Descriptores en el orden de la descarga.
    """
    metadatos = {meta["archivo"]: json.loads(cuerpos[meta["url"]]) for meta in ocupados.METADATOS_IDESCAT}
    return [*ocupados.METADATOS_IDESCAT, *ocupados.planificar_partes(metadatos), *ocupados.ARCHIVOS_AUXILIARES]


class PruebaCoberturaSeries(unittest.TestCase):
    """Todas las consultas y todos los originales son necesarios, aunque las etapas locales den cero."""

    def setUp(self) -> None:
        """Construye una copia independiente de cada serie, sin usar originales del producto."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.casos = []
        for fuente, modulo in cobertura.SERIES.items():
            carpeta = self.raiz / "var/actualizacion/originales" / modulo.FUENTE
            carpeta.mkdir(parents=True)
            registros, peticiones = [], []
            cuerpos = cuerpos_ocupados() if modulo is ocupados else {}
            recursos = archivos_ocupados(cuerpos) if modulo is ocupados else modulo.ARCHIVOS
            for numero, archivo in enumerate(recursos):
                datos = cuerpos.get(archivo["url"], f"cuerpo sintético completo {fuente} {numero}\n".encode())
                (carpeta / archivo["archivo"]).write_bytes(datos)
                registros.append(
                    {
                        **archivo,
                        "url_final": archivo["url"],
                        "sha256": sha(datos),
                        "bytes": len(datos),
                        "descargado_utc": "2026-10-06T08:00:00Z",
                    }
                )
                peticiones.append(
                    {
                        "recurso_sha256": observacion_remota.identidad_recurso(archivo["url"]),
                        "url_final_sha256": sha(archivo["url"].encode()),
                        "respuesta_sha256": sha(datos),
                        "bytes": len(datos),
                        "original_sha256": sha(datos),
                        "original_bytes": len(datos),
                        "completado_utc": INSTANTE,
                    }
                )
            evidencia = {
                "version": 2,
                "fuente": fuente,
                "intento": "actual_89",
                "comienzo_utc": INSTANTE,
                "fin_utc": INSTANTE,
                "peticiones": peticiones,
            }
            procedencia = {"archivos": registros, **({"idescat_partes": 1} if modulo is ocupados else {})}
            self.guardar(carpeta, procedencia)
            self.casos.append((fuente, carpeta, procedencia, evidencia))

    def guardar(self, carpeta: Path, procedencia: dict) -> None:
        """Escribe la procedencia sintética sin cambiar la recepción."""
        (carpeta / "procedencia.json").write_text(json.dumps(procedencia), encoding="utf-8")

    def test_recursos_exactos_y_mismos_originales_sin_renovar_fechas(self) -> None:
        """El orden y las fechas de conservación anteriores no cambian la consulta recién acreditada."""
        for fuente, carpeta, _procedencia, evidencia in self.casos:
            previo = (carpeta / "procedencia.json").read_bytes()
            evidencia["peticiones"].reverse()
            with self.subTest(fuente=fuente):
                self.assertTrue(cobertura.comprobada(self.raiz, evidencia))
                self.assertEqual((carpeta / "procedencia.json").read_bytes(), previo)

    def test_ocupados_legado_no_acredita_nueva_consulta(self) -> None:
        """La compatibilidad local de siete originales no acredita la descarga nueva por partes."""
        _, carpeta, _, evidencia = next(caso for caso in self.casos if caso[0] == "ocupados")
        registros, peticiones = [], []
        for archivo in ocupados.ARCHIVOS:
            datos = f"captura histórica de {archivo['archivo']}".encode()
            (carpeta / archivo["archivo"]).write_bytes(datos)
            registros.append({**archivo, "url_final": archivo["url"], "sha256": sha(datos), "bytes": len(datos)})
            peticiones.append(
                {
                    "recurso_sha256": observacion_remota.identidad_recurso(archivo["url"]),
                    "url_final_sha256": sha(archivo["url"].encode()),
                    "respuesta_sha256": sha(datos),
                    "bytes": len(datos),
                    "original_sha256": sha(datos),
                    "original_bytes": len(datos),
                    "completado_utc": INSTANTE,
                }
            )
        self.guardar(carpeta, {"archivos": registros})
        self.assertFalse(cobertura.comprobada(self.raiz, {**evidencia, "peticiones": peticiones}))

    def test_ocupados_exige_sus_siete_recursos_oficiales(self) -> None:
        """Incluye las cuatro tablas, el nomenclátor y los dos controles; el alcance territorial es fijo."""
        self.assertIn("ocupados", cobertura.SERIES)
        archivos = cobertura.SERIES["ocupados"].ARCHIVOS
        self.assertEqual(
            {archivo["archivo"] for archivo in archivos},
            {
                "idescat-17980-cataluna.json",
                "idescat-17977-cataluna.json",
                "idescat-17977-comarcas.json",
                "idescat-17977-municipios.json",
                "idescat-comarcas-municipios.json",
                "ine-69959-cataluna.json",
                "ine-69979-ciudades.json",
            },
        )
        self.assertEqual(len(archivos), 7)
        for archivo in archivos:
            filtros = parse_qs(urlsplit(archivo["url"]).query)
            with self.subTest(archivo=archivo["archivo"]):
                # YEAR y _LAST_ restringen el calendario de Taules; date y nult, el de Tempus.
                self.assertTrue({"YEAR", "_LAST_", "date", "nult"}.isdisjoint(filtros))
                if archivo["archivo"] == "idescat-17977-comarcas.json":
                    self.assertEqual(filtros["COM"], ["11,13"])
                elif archivo["archivo"] == "idescat-17977-municipios.json":
                    self.assertEqual(len(filtros["MUN"][0].split(",")), 25)
                elif archivo["archivo"] == "ine-69959-cataluna.json":
                    self.assertEqual(filtros, {"tv": ["70:9005"], "tip": ["AM"]})
                elif archivo["archivo"] == "ine-69979-ciudades.json":
                    self.assertEqual(len(filtros["tv"]), 9)
                    self.assertEqual(filtros["tip"], ["AM"])

    def test_las_consultas_no_fijan_anio_superior(self) -> None:
        """La identidad vigilada es la consulta abierta oficial, sin fecha final ni selección de un año."""
        for fuente, modulo in cobertura.SERIES.items():
            for archivo in modulo.ARCHIVOS:
                filtros = parse_qs(urlsplit(archivo["url"]).query)
                with self.subTest(fuente=fuente, archivo=archivo["archivo"]):
                    self.assertTrue({"time", "timePeriod", "untilTimePeriod", "timeto"}.isdisjoint(filtros))

    def test_cero_http_v1_y_puente_ausente_no_acreditan(self) -> None:
        """El código de salida de la descarga no sustituye una recepción vinculada del intento."""
        for fuente, _carpeta, _procedencia, original in self.casos:
            legado = copy.deepcopy(original)
            legado["version"] = 1
            for peticion in legado["peticiones"]:
                peticion.pop("original_sha256")
                peticion.pop("original_bytes")
            sin_puente = copy.deepcopy(original)
            sin_puente["peticiones"][0].update(original_sha256=None, original_bytes=None)
            for caso in (legado, {**original, "peticiones": []}, sin_puente):
                with self.subTest(fuente=fuente, caso=caso):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_recursos_omitidos_extra_duplicados_y_ajenos(self) -> None:
        """La cardinalidad sola no acredita haber leído el inventario oficial exacto."""
        for fuente, _carpeta, _procedencia, original in self.casos:
            for indice in range(len(original["peticiones"])):
                caso = copy.deepcopy(original)
                caso["peticiones"].pop(indice)
                with self.subTest(fuente=fuente, omitido=indice):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))
            for cambio in ("extra", "duplicado", "ajeno"):
                caso = copy.deepcopy(original)
                if cambio == "extra":
                    caso["peticiones"].append(copy.deepcopy(caso["peticiones"][0]))
                elif cambio == "duplicado" and len(caso["peticiones"]) > 1:
                    caso["peticiones"][-1] = copy.deepcopy(caso["peticiones"][0])
                else:
                    caso["peticiones"][0]["recurso_sha256"] = "0" * 64
                with self.subTest(fuente=fuente, cambio=cambio):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_identidad_final_hash_y_tamanos_no_admiten_equivalencias(self) -> None:
        """Todo el cuerpo observado tiene que ser exactamente el original conservado, incluso en ILOSTAT."""
        for fuente, _carpeta, _procedencia, original in self.casos:
            for indice in range(len(original["peticiones"])):
                for campo, valor in (
                    ("url_final_sha256", "0" * 64),
                    ("respuesta_sha256", "0" * 64),
                    ("original_sha256", "0" * 64),
                    ("bytes", 1),
                    ("original_bytes", 1),
                ):
                    caso = copy.deepcopy(original)
                    caso["peticiones"][indice][campo] = valor
                    with self.subTest(fuente=fuente, recurso=indice, campo=campo):
                        self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_otro_metodo_cuerpo_o_filtro_no_es_el_recurso(self) -> None:
        """Cada GET exacto se distingue de un POST, de un cuerpo vacío y de un calendario recortado."""
        for fuente, modulo in cobertura.SERIES.items():
            evidencia = next(caso[3] for caso in self.casos if caso[0] == fuente)
            for indice, archivo in enumerate(modulo.ARCHIVOS):
                url = archivo["url"]
                variantes = (
                    observacion_remota.identidad_recurso(url, "POST"),
                    observacion_remota.identidad_recurso(url, cuerpo=b""),
                    observacion_remota.identidad_recurso(url + "&YEAR=2023"),
                )
                for identidad in variantes:
                    caso = copy.deepcopy(evidencia)
                    caso["peticiones"][indice]["recurso_sha256"] = identidad
                    with self.subTest(fuente=fuente, recurso=indice, identidad=identidad):
                        self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_procedencia_exacta_sin_duplicados_rutas_ajenas_ni_hash_falso(self) -> None:
        """Ninguna entrada añadida, omitida, mal identificada o repetida puede esconder un original ajeno."""
        for fuente, carpeta, original, evidencia in self.casos:
            for indice in range(len(original["archivos"])):
                for cambio in ("omitido", "extra", "duplicado", "ruta", "url", "url_final", "sha256", "bytes"):
                    caso = copy.deepcopy(original)
                    if cambio == "omitido":
                        caso["archivos"].pop(indice)
                    elif cambio in ("extra", "duplicado"):
                        if cambio == "duplicado" and len(caso["archivos"]) > 1:
                            caso["archivos"][-1] = copy.deepcopy(caso["archivos"][0])
                        else:
                            caso["archivos"].append(copy.deepcopy(caso["archivos"][0]))
                    else:
                        campo = "archivo" if cambio == "ruta" else cambio
                        caso["archivos"][indice][campo] = 1 if campo == "bytes" else "ajeno"
                    self.guardar(carpeta, caso)
                    with self.subTest(fuente=fuente, recurso=indice, cambio=cambio):
                        self.assertFalse(cobertura.comprobada(self.raiz, evidencia))
            self.guardar(carpeta, original)

    def test_original_ausente_modificado_symlink_y_hardlink(self) -> None:
        """Una huella remota válida no permite seguir enlaces ni usar otra copia local."""
        for fuente, carpeta, procedencia, evidencia in self.casos:
            for registro in procedencia["archivos"]:
                ruta = carpeta / registro["archivo"]
                contenido = ruta.read_bytes()
                ajeno = self.raiz / f"ajeno-{fuente}"
                ajeno.write_bytes(contenido)
                for cambio in ("ausente", "alterado", "symlink", "hardlink"):
                    ruta.unlink(missing_ok=True)
                    if cambio == "alterado":
                        ruta.write_bytes(contenido + b" ")
                    elif cambio == "symlink":
                        ruta.symlink_to(ajeno)
                    elif cambio == "hardlink":
                        os.link(ajeno, ruta)
                    with self.subTest(fuente=fuente, archivo=registro["archivo"], cambio=cambio):
                        self.assertFalse(cobertura.comprobada(self.raiz, evidencia))
                ruta.unlink()
                ruta.write_bytes(contenido)

    def test_carpeta_y_procedencia_enlazadas_o_json_ambiguo(self) -> None:
        """También se rechazan los enlaces anteriores al nombre de original y procedencias ambiguas."""
        for fuente, carpeta, procedencia, evidencia in self.casos:
            movida = carpeta.with_name(carpeta.name + "-real")
            carpeta.rename(movida)
            carpeta.symlink_to(movida, target_is_directory=True)
            with self.subTest(fuente=fuente, cambio="carpeta"):
                self.assertFalse(cobertura.comprobada(self.raiz, evidencia))
            carpeta.unlink()
            movida.rename(carpeta)
            ruta = carpeta / "procedencia.json"
            ajena = self.raiz / f"procedencia-{fuente}.json"
            ruta.rename(ajena)
            ruta.symlink_to(ajena)
            with self.subTest(fuente=fuente, cambio="procedencia"):
                self.assertFalse(cobertura.comprobada(self.raiz, evidencia))
            ruta.unlink()
            for contenido in (b'{"archivos":[],"archivos":[]}', b"{", b"[]", b'{"archivos":NaN}'):
                ruta.write_bytes(contenido)
                with self.subTest(fuente=fuente, contenido=contenido):
                    self.assertFalse(cobertura.comprobada(self.raiz, evidencia))
            self.guardar(carpeta, procedencia)

    def test_fuente_desconocida_y_original_fuera_de_cota(self) -> None:
        """No se acreditan otras series ni se leen cuerpos mayores que el límite del transporte."""
        self.assertFalse(cobertura.comprobada(self.raiz, {"version": 2, "fuente": "ajena"}))
        with mock.patch.object(cobertura, "MAX_DESCARGA_BYTES", 1):
            for fuente, _carpeta, _procedencia, evidencia in self.casos:
                with self.subTest(fuente=fuente):
                    self.assertFalse(cobertura.comprobada(self.raiz, evidencia))


class PruebaTransporteDeSeries(unittest.TestCase):
    """Las fuentes producen el recibo v2 por el transporte común, sin red ni validación ficticia."""

    def setUp(self) -> None:
        """Inyecta el turno virtual para que la frontera HTTP simulada nunca duerma realmente."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)

    def test_todos_los_recursos_vinculados_con_datareader(self) -> None:
        """Observa cuerpos HTTP completos y los coteja con los originales que acaba de conservar la descarga."""
        cuerpos = cuerpos_ocupados()
        for fuente, modulo in cobertura.SERIES.items():
            with self.subTest(fuente=fuente), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal)
                carpeta = raiz / "var/actualizacion/originales" / modulo.FUENTE
                recibo = raiz / "recepcion.json"
                peticiones = []

                def abrir(
                    peticion: Request, _peticiones: list[Request] = peticiones, **_opciones: object
                ) -> HTTPResponse:
                    _peticiones.append(peticion)
                    datos = cuerpos.get(peticion.full_url, json.dumps({"recurso": peticion.full_url}).encode())
                    conexion = mock.Mock()
                    conexion.makefile.return_value = io.BytesIO(
                        f"HTTP/1.1 200 OK\r\nContent-Length: {len(datos)}\r\n\r\n".encode() + datos
                    )
                    respuesta = HTTPResponse(conexion)
                    respuesta.begin()
                    respuesta.url = peticion.full_url
                    return respuesta

                configuracion = {
                    observacion_remota.VARIABLE_RECEPCION: json.dumps(
                        {"ruta": str(recibo), "fuente": fuente, "intento": "actual_89"}
                    )
                }
                with (
                    mock.patch.dict(os.environ, configuracion),
                    mock.patch.object(red, "abrir_peticion", side_effect=abrir),
                    mock.patch.object(modulo, "ORIGINAL", carpeta),
                    mock.patch.object(modulo, "PROCEDENCIA", carpeta / "procedencia.json"),
                    observacion_remota.contexto_descarga(),
                ):
                    modulo.descargar()
                evidencia = observacion_remota.leer_recepcion(recibo, fuente, "actual_89")
                esperados = archivos_ocupados(cuerpos) if modulo is ocupados else modulo.ARCHIVOS
                self.assertEqual([peticion.full_url for peticion in peticiones], [a["url"] for a in esperados])
                self.assertEqual(len(evidencia["peticiones"]), len(esperados))
                self.assertTrue(all(p.get_header("User-agent") == red.agente_de_usuario() for p in peticiones))
                self.assertTrue(cobertura.comprobada(raiz, evidencia))

    def test_cuerpo_incompleto_en_cualquier_recurso_no_emite_recibo(self) -> None:
        """El cierre local de una descarga parcial no acredita los recursos que llegaron antes."""
        modulo = cobertura.SERIES["ocupados"]
        cuerpos = cuerpos_ocupados()
        for incompleto in archivos_ocupados(cuerpos):
            with self.subTest(archivo=incompleto["archivo"]), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal)
                carpeta = raiz / "var/actualizacion/originales/ocupados"
                recibo = raiz / "recepcion.json"

                def abrir(peticion: Request, *, _url: str = incompleto["url"], **_opciones: object) -> HTTPResponse:
                    datos = cuerpos[peticion.full_url]
                    longitud = len(datos) + int(peticion.full_url == _url)
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
                        {"ruta": str(recibo), "fuente": "ocupados", "intento": "actual_90"}
                    )
                }
                with (
                    mock.patch.dict(os.environ, configuracion),
                    mock.patch.object(red, "abrir_peticion", side_effect=abrir),
                    mock.patch.object(modulo, "ORIGINAL", carpeta),
                    mock.patch.object(modulo, "PROCEDENCIA", carpeta / "procedencia.json"),
                    self.assertRaises(FormatoInesperado),
                    observacion_remota.contexto_descarga(),
                ):
                    modulo.descargar()
                self.assertFalse(recibo.exists())
                self.assertFalse((carpeta / "procedencia.json").exists())


if __name__ == "__main__":
    unittest.main()
