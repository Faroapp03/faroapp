"""Catálogos y originales de cada edición deben pertenecer a la misma consulta admitida."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import plataforma_datos.comun.fuentes.nombres.lector as nombres
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector as ia_nacional_bra
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector as ia_nacional_gbr
import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
import plataforma_datos.ia_y_trabajo.pruebas.test_tic_llars as test_tic_llars
import plataforma_datos.mercado.fuentes.salarios.lector as salarios
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.comun.pruebas.test_ediciones_nombres import catalogo as catalogo_nombres
from plataforma_datos.ia_y_trabajo.fuentes.tich import candidata as candidata_tich
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as edicion_tich
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import documentos_del_anio
from plataforma_datos.ia_y_trabajo.pruebas.test_ediciones_nacionales import CETIC, ONS
from plataforma_datos.ia_y_trabajo.pruebas.test_ediciones_tich import catalogo as catalogo_tich
from plataforma_datos.mercado.pruebas.test_ediciones_salarios import catalogo as catalogo_salarios
from plataforma_datos.orquestacion import cobertura_ediciones as cobertura
from plataforma_datos.orquestacion.pruebas import test_seguimiento_catalogos

CATALOGOS = {
    "tich": catalogo_tich().encode(),
    "salarios": catalogo_salarios(),
    "tic_llars": test_tic_llars.PruebaDescubrimientoTicLlars.CATALOGO.encode(),
    "nombres": catalogo_nombres(),
    "ia_nacional_gbr": ONS,
    "ia_nacional_bra": CETIC,
}
INSTANTE = "2026-10-17T08:00:00Z"


def sha(contenido: bytes) -> str:
    """Identifica el cuerpo conservado por la fixture.

    Returns:
        SHA256 hexadecimal de sus bytes completos.
    """
    return hashlib.sha256(contenido).hexdigest()


class PruebaCoberturaEdiciones(unittest.TestCase):
    """Ejercita los contratos reales sin red ni dependencia de las capturas operativas."""

    def crear(self, fuente: str) -> None:
        """Construye una captura íntegra e independiente para un intento sintético."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        nombre, catalogo, archivos = cobertura.CONTRATOS[fuente]
        self.carpeta = self.raiz / "var/actualizacion/originales" / nombre
        self.carpeta.mkdir(parents=True)
        self.procedencia = {"descubrimiento": [], "archivos": []}
        self.evidencia = {
            "version": 2,
            "fuente": fuente,
            "intento": "ediciones_93",
            "comienzo_utc": INSTANTE,
            "fin_utc": "2026-10-17T08:02:00Z",
            "peticiones": [],
        }
        if fuente == "tich":
            self.procedencia["edicion"] = tich.edicion_del_catalogo(CATALOGOS[fuente].decode())
        elif fuente == "salarios":
            self.procedencia["edicion"] = salarios.edicion_del_catalogo(CATALOGOS[fuente])
        elif fuente == "nombres":
            self.procedencia["edicion"] = nombres.edicion_del_catalogo(CATALOGOS[fuente])
        elif fuente == "ia_nacional_gbr":
            self.procedencia["edicion"] = ia_nacional_gbr.edicion_del_catalogo(CATALOGOS[fuente])
        elif fuente == "ia_nacional_bra":
            self.procedencia["edicion"] = ia_nacional_bra.edicion_del_catalogo(CATALOGOS[fuente])
        for indice, archivo in enumerate((catalogo, *archivos)):
            contenido = CATALOGOS[fuente] if indice == 0 else f"original {indice}".encode()
            url = archivo["url"]
            final = url.replace("/js/", "/jsCache/", 1) if "/DATOS_TABLA/" in url else url
            # La TIC-H guarda los originales en la carpeta de su año y la operación los registra con esa ruta.
            registrado = f"2025/{archivo['archivo']}" if fuente == "tich" and indice else archivo["archivo"]
            (self.carpeta / registrado).parent.mkdir(exist_ok=True)
            (self.carpeta / registrado).write_bytes(contenido)
            grupo = "archivos" if indice else "descubrimiento"
            self.procedencia[grupo].append(
                {
                    "archivo": registrado,
                    "url": url,
                    "url_final": final,
                    "bytes": len(contenido),
                    "sha256": sha(contenido),
                    "descargado_utc": "2026-10-01T08:00:00Z",
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
        """Escribe solo la procedencia de esta fixture."""
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")
        if (self.carpeta / "2025").is_dir():
            # La TIC-H registra en la procedencia de cada año el año de la EPA que descargó.
            del_anio = {"anio": "2025", "epa_anio": "2025", "archivos": []}
            (self.carpeta / "2025" / "procedencia.json").write_text(json.dumps(del_anio), encoding="utf-8")

    def test_consulta_completa_sin_renovar_fechas_de_originales(self) -> None:
        """Unos bytes ya conservados pueden haberse comprobado de nuevo; su antigüedad no se reescribe."""
        for fuente in CATALOGOS:
            with self.subTest(fuente=fuente):
                self.crear(fuente)
                anterior = (self.carpeta / "procedencia.json").read_bytes()
                self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
                self.assertEqual((self.carpeta / "procedencia.json").read_bytes(), anterior)

    def peticion(self, url: str, contenido: bytes) -> dict:
        """La petición observada de un recurso con su cuerpo.

        Returns:
            La petición, con la forma del recibo.
        """
        return {
            "recurso_sha256": identidad_recurso(url),
            "url_final_sha256": sha(url.encode()),
            "respuesta_sha256": sha(contenido),
            "bytes": len(contenido),
            "original_sha256": sha(contenido),
            "original_bytes": len(contenido),
            "completado_utc": INSTANTE,
        }

    def con_candidata(self) -> list[dict]:
        """Añade a la TIC-H una candidata de 2026: tres originales y dos PDF pedidos, su EPA copiada y su sondeo.

        Returns:
            Las peticiones de la candidata, que la fixture añade a la evidencia.
        """
        del_anio, registros, peticiones = self.carpeta / "2026", [], []
        del_anio.mkdir()
        for indice, url in enumerate(
            (
                "https://www.ine.es/ftp/microdatos/tich/datos_2026.zip",
                "https://www.ine.es/jaxi/files/tpx/es/csv_bdsc/82804.csv",
                "https://www.ine.es/jaxi/files/tpx/es/csv_bdsc/82907.csv",
                "https://www.ine.es/metodologia/t25/t25304506626.pdf",
                "https://www.ine.es/metodologia/t25/t25p450_tich_cues_26.pdf",
            )
        ):
            contenido = f"candidata {indice}".encode()
            nombre = url.rsplit("/", 1)[1]
            (del_anio / nombre).write_bytes(contenido)
            registros.append(
                {"archivo": nombre, "url": url, "url_final": url, "bytes": len(contenido), "sha256": sha(contenido)}
            )
            peticiones.append(self.peticion(url, contenido))
        epa = next(r for r in self.procedencia["archivos"] if "eurostat" in r["archivo"])
        registros.append({**epa, "archivo": epa["archivo"].removeprefix("2025/"), "copia_de": epa["archivo"]})
        sondeo = {"anio": "2026", "url": epa["url"].replace("time=2025", "time=2026"), "resultado": "sin-el-anio"}
        peticiones.append(self.peticion(sondeo["url"], b"{}"))
        del_anio_json = {"anio": "2026", "epa_anio": "2025", "epa_sondeo": sondeo, "archivos": registros}
        (del_anio / "procedencia.json").write_text(json.dumps(del_anio_json), encoding="utf-8")
        edicion = {"anio": "2026", "anios_medidos": ["2025", "2026"], "tablas": {}, "epa_anio": "2025"}
        archivos = [{"archivo": f"2026/{r['archivo']}", "sha256": r["sha256"]} for r in registros]
        self.procedencia["candidata"] = {"edicion": edicion, "archivos": archivos}
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")
        return peticiones

    def test_con_candidata_se_cuentan_sus_peticiones_y_su_epa_copiada_no(self) -> None:
        """Con todas sus peticiones se acredita; sin una, o con la copia contada como petición, no."""
        self.crear("tich")
        sin_candidata = list(self.evidencia["peticiones"])
        peticiones = self.con_candidata()
        self.evidencia["peticiones"] = [*sin_candidata, *peticiones]
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
        for evidencia in (
            {**self.evidencia, "peticiones": sin_candidata},
            {**self.evidencia, "peticiones": [*sin_candidata, *peticiones[:-1]]},
            {
                **self.evidencia,
                "peticiones": [*self.evidencia["peticiones"], self.peticion("https://otro.example", b"")],
            },
        ):
            with self.subTest(peticiones=len(evidencia["peticiones"])):
                self.assertFalse(cobertura.comprobada(self.raiz, evidencia))
        (self.carpeta / "2026" / "82804.csv").write_bytes(b"cambiado")
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_la_candidata_detenida_a_medias_se_acredita_con_las_peticiones_hechas(self) -> None:
        """Un PDF que falla tras el sondeo de la EPA: se cuentan las hechas y el sondeo; con otra cuenta, no."""
        self.crear("tich")
        sin_candidata = list(self.evidencia["peticiones"])
        peticiones = self.con_candidata()
        del_anio = json.loads((self.carpeta / "2026" / "procedencia.json").read_text(encoding="utf-8"))
        registros = del_anio["archivos"]
        # Microdatos, dos tablas, la EPA copiada y el primer PDF; el segundo PDF falló después del sondeo.
        hechos = [registros[0], registros[1], registros[2], registros[5], registros[3]]
        hechas = [*peticiones[:4], peticiones[5]]
        self.procedencia.pop("candidata")
        self.procedencia["candidata_detenida"] = {
            "anio": "2026",
            "motivo": "tablas",
            "detalle": "HTTPError: 503",
            "archivos": hechos,
            "epa_sondeo": del_anio["epa_sondeo"],
        }
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")
        self.evidencia["peticiones"] = [*sin_candidata, *hechas]
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
        for indice in range(len(hechas)):
            with self.subTest(sin=indice):
                evidencia = {**self.evidencia, "peticiones": [*sin_candidata, *hechas[:indice], *hechas[indice + 1 :]]}
                self.assertFalse(cobertura.comprobada(self.raiz, evidencia))
        con_la_fallida = {**self.evidencia, "peticiones": [*sin_candidata, *hechas, peticiones[4]]}
        self.assertFalse(cobertura.comprobada(self.raiz, con_la_fallida))
        (self.carpeta / "2026" / hechos[0]["archivo"]).write_bytes(b"cambiado")
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def incorporada(self) -> list[dict]:
        """El día de la incorporación de 2026: lo que registra la procedencia y lo que pidió la consulta.

        La consulta pidió el catálogo, los originales de 2025, los índices navegados, los originales de 2026 con sus
        dos PDF y el sondeo de la EPA de 2026; la EPA de 2026 es la copia de la de 2025. La procedencia es la que
        escribe la incorporación (`operacion_con_la_incorporada`) y el estado de la edición ya es el de 2026.

        Returns:
            Las peticiones de esa consulta, que la fixture deja en la evidencia.
        """
        peticiones_2025 = list(self.evidencia["peticiones"])
        catalogo = catalogo_tich(2026, 2026).encode()
        (self.carpeta / "ine-tich-resultados.html").write_bytes(catalogo)
        self.procedencia["descubrimiento"][0] |= {"bytes": len(catalogo), "sha256": sha(catalogo)}
        self.procedencia["edicion"] = tich.edicion_del_catalogo(catalogo.decode())
        url_catalogo = self.procedencia["descubrimiento"][0]["url"]
        peticiones = [self.peticion(url_catalogo, catalogo), *peticiones_2025[1:]]
        primera = edicion_tich.primera()
        edicion = edicion_tich.valida(
            {
                "anio": "2026",
                "anios_medidos": ["2025", "2026"],
                "tablas": {"uso": "82804", "errores": "82907"},
                "epa_anio": "2025",
                "secciones": primera["secciones"],
                "documentos": primera["documentos"],
            }
        )
        pdf = documentos_del_anio(
            "2026",
            {
                "metodologia": "https://www.ine.es/metodologia/t25/t25304506626.pdf",
                "cuestionario": "https://www.ine.es/metodologia/t25/t25p450_tich_cues_26.pdf",
            },
        )
        epa_2025 = next(r for r in self.procedencia["archivos"] if "eurostat" in r["archivo"])
        del_anio, registros = self.carpeta / "2026", []
        del_anio.mkdir()
        for archivo in (*edicion_tich.archivos(edicion), *pdf):
            if archivo["archivo"] == epa_2025["archivo"].removeprefix("2025/"):
                contenido = (self.carpeta / epa_2025["archivo"]).read_bytes()
                extra = {"copia_de": epa_2025["archivo"]}
            else:
                contenido, extra = f"2026 {archivo['archivo']}".encode(), {}
                peticiones.append(self.peticion(archivo["url"], contenido))
            (del_anio / archivo["archivo"]).write_bytes(contenido)
            registros.append(
                {
                    "archivo": archivo["archivo"],
                    "url": archivo["url"],
                    "url_final": archivo["url"],
                    "bytes": len(contenido),
                    "sha256": sha(contenido),
                    **extra,
                }
            )
        sondeo = {"anio": "2026", "url": epa_2025["url"].replace("time=2025", "time=2026"), "resultado": "sin-el-anio"}
        peticiones.append(self.peticion(sondeo["url"], b"{}"))
        indices = [f"https://www.ine.es/dynt3/inebase/index.htm?padre={n}" for n in (1, 2, 3)]
        peticiones += [self.peticion(url, b"indice") for url in indices[1:]]
        del_anio_json = {
            "anio": "2026",
            "epa_anio": "2025",
            "epa_sondeo": sondeo,
            "archivos": registros,
        }
        (del_anio / "procedencia.json").write_text(json.dumps(del_anio_json), encoding="utf-8")
        self.procedencia["candidata"] = {
            "edicion": {key: edicion[key] for key in candidata_tich.Base.__annotations__},
            "archivos": edicion_tich.en_la_operacion(edicion, registros),
        }
        self.procedencia["tablas_edicion_nueva"] = {"paginas": [{"url": url, "sha256": "0" * 64} for url in indices]}
        self.procedencia = candidata_tich.operacion_con_la_incorporada(self.procedencia, edicion)
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")
        estado = self.raiz / DATOS_RELATIVOS / "validados" / "tich"
        estado.mkdir(parents=True)
        edicion_tich.guardar(edicion, estado / "edicion.json")
        self.evidencia["peticiones"] = peticiones
        return peticiones

    def test_el_dia_de_la_incorporacion_se_acredita_con_las_peticiones_conservadas(self) -> None:
        """Con exactamente esas peticiones sí; con una de menos, una de más o una huella cambiada, no."""
        self.crear("tich")
        peticiones = self.incorporada()
        self.assertEqual(len(self.procedencia["consulta_de_la_incorporacion"]["documentos"]), 2)
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
        for indice in range(len(peticiones)):
            with self.subTest(sin=indice):
                evidencia = {**self.evidencia, "peticiones": peticiones[:indice] + peticiones[indice + 1 :]}
                self.assertFalse(cobertura.comprobada(self.raiz, evidencia))
        de_mas = [*peticiones, self.peticion("https://otro.example", b"")]
        self.assertFalse(cobertura.comprobada(self.raiz, {**self.evidencia, "peticiones": de_mas}))
        de_antes = self.procedencia["consulta_de_la_incorporacion"]["anterior"]["archivos"][0]["archivo"]
        for ruta in (de_antes, "2026/ine-tich-2026-cuestionario.pdf"):
            with self.subTest(cambiado=ruta):
                original = (self.carpeta / ruta).read_bytes()
                (self.carpeta / ruta).write_bytes(b"cambiado")
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
                (self.carpeta / ruta).write_bytes(original)
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))

    def test_el_dia_siguiente_es_el_de_siempre_sin_el_bloque_de_la_incorporacion(self) -> None:
        """Sin el bloque, ni los originales de 2025 ni los índices ni los PDF son peticiones de la consulta."""
        self.crear("tich")
        peticiones = self.incorporada()
        self.procedencia.pop("consulta_de_la_incorporacion")
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        propias = [peticiones[0], *peticiones[4:8], peticiones[-3]]
        self.evidencia["peticiones"] = propias
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))

    def test_sin_catalogo_sin_original_o_sin_vinculo_no_se_acredita(self) -> None:
        """Cada recurso es necesario una sola vez, tanto índice como datos de la edición."""
        for fuente in CATALOGOS:
            self.crear(fuente)
            for indice in range(len(self.evidencia["peticiones"])):
                for campo in (None, "respuesta_sha256", "original_sha256", "url_final_sha256", "recurso_sha256"):
                    caso = copy.deepcopy(self.evidencia)
                    if campo is None:
                        caso["peticiones"].pop(indice)
                    else:
                        caso["peticiones"][indice][campo] = "0" * 64
                    with self.subTest(fuente=fuente, indice=indice, campo=campo):
                        self.assertFalse(cobertura.comprobada(self.raiz, caso))
            self.procedencia.pop("descubrimiento")
            self.guardar()
            self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_sucesora_con_huellas_coherentes_no_acredita_contrato_antiguo(self) -> None:
        """No basta con declarar el año conocido ni con recalcular hashes de un catálogo más reciente."""
        for fuente in CATALOGOS:
            with self.subTest(fuente=fuente):
                self.crear(fuente)
                cuerpo = CATALOGOS[fuente].replace(b"2025", b"2026").replace(b"ticll25", b"ticll26")
                if fuente == "salarios":
                    cuerpo = catalogo_salarios(2026, publicado="23/09/2028")
                elif fuente == "ia_nacional_gbr":
                    cuerpo = CATALOGOS[fuente].replace(b"2023to2026", b"2023to2027").replace(b"20260720", b"20270720")
                registro = self.procedencia["descubrimiento"][0]
                (self.carpeta / registro["archivo"]).write_bytes(cuerpo)
                registro.update(bytes=len(cuerpo), sha256=sha(cuerpo))
                self.evidencia["peticiones"][0].update(
                    bytes=len(cuerpo),
                    original_bytes=len(cuerpo),
                    respuesta_sha256=sha(cuerpo),
                    original_sha256=sha(cuerpo),
                )
                self.guardar()
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_duplicados_tipos_rutas_y_metodos_no_reciben_cobertura(self) -> None:
        """Ni la ambigüedad del inventario ni otro método HTTP se equiparan a la consulta esperada."""
        for fuente in CATALOGOS:
            self.crear(fuente)
            for cambio in ("duplicada", "extra", "post", "tamano", "version"):
                caso = copy.deepcopy(self.evidencia)
                if cambio == "duplicada":
                    caso["peticiones"][-1] = caso["peticiones"][0]
                elif cambio == "extra":
                    caso["peticiones"].append(caso["peticiones"][0])
                elif cambio == "post":
                    url = cobertura.CONTRATOS[fuente][1]["url"]
                    caso["peticiones"][0]["recurso_sha256"] = identidad_recurso(url, "POST")
                elif cambio == "tamano":
                    caso["peticiones"][0]["original_bytes"] = True
                else:
                    caso["version"] = True
                with self.subTest(fuente=fuente, cambio=cambio):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))
            for grupo in ("archivos", "descubrimiento"):
                anterior = copy.deepcopy(self.procedencia)
                self.procedencia[grupo].append(self.procedencia[grupo][0])
                self.guardar()
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
                self.procedencia = anterior
            self.procedencia["descubrimiento"][0]["archivo"] = "../ajeno"
            self.guardar()
            self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_integracion_exige_admision_y_consulta_completa(self) -> None:
        """El registro durable no da fecha nueva a una copia local, parcial o rechazada."""
        control = test_seguimiento_catalogos.PruebaSeguimientoCatalogos()
        for fuente in CATALOGOS:
            for variante in ("completo", "rechazado", "parcial", "local", "etapa-fallida"):
                with self.subTest(fuente=fuente, variante=variante):
                    self.crear(fuente)
                    control.comprobar(fuente, variante, self.raiz, self.evidencia)

    def test_edicion_declarada_conserva_identidad_y_tipos_del_catalogo(self) -> None:
        """Un año igual por coerción numérica no es el registro tipado emitido por el lector."""
        for fuente, campo, valor in (
            ("salarios", "anio", 2022.0),
            ("tich", "anio_resultados", 2025.0),
            ("tich", "anio_microdatos", 2025.0),
            ("salarios", "publicado", "24/09/2024"),
            ("tich", "url_microdatos", "https://ajeno.example/datos_2025.zip"),
            ("nombres", "fecha_datos", "01/01/2026"),
            ("nombres", "publicado", "24/04/2026"),
            ("ia_nacional_gbr", "url", ia_nacional_gbr.ARTICULO + "-otra"),
            ("ia_nacional_gbr", "publicado", "2026-07-21"),
            ("ia_nacional_bra", "anio", 2025.0),
        ):
            with self.subTest(fuente=fuente, campo=campo):
                self.crear(fuente)
                self.procedencia["edicion"][campo] = valor
                self.guardar()
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))


if __name__ == "__main__":
    unittest.main()
