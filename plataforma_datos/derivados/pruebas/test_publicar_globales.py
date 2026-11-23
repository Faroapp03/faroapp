"""Puente global con agregados pequeños y archivos temporales propios; sin microdatos ni red."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.derivados.fuentes.datos_globales.lector as datos_globales
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import RAIZ, ArchivoFaltante, FormatoInesperado, ValidacionFallida
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_datos_globales import problemas_del_contrato
from plataforma_datos.derivados.pruebas.test_catalogo_calculado import PAISES
from plataforma_datos.orquestacion import admision
from plataforma_datos.orquestacion import publicar_globales as publicador


def entradas_de_prueba() -> dict:
    """Veinte agregados autocontenidos, con las fixtures pequeñas de clasificación y encuestas.

    Returns:
        Entradas que componer puede leer sin fuentes operativas.
    """
    fixtures = Path(__file__).with_name("fixtures")
    entradas = json.loads((fixtures / "entradas-globales-minimas.json").read_text())
    paises = {
        **PAISES,
        **{
            iso2: {"iso3": iso3, "es": iso3, "ca": iso3}
            for iso2, iso3 in (
                ("ES", "ESP"),
                ("DE", "DEU"),
                ("FR", "FRA"),
                ("IT", "ITA"),
                ("US", "USA"),
                ("CA", "CAN"),
                ("AU", "AUS"),
                ("IS", "ISL"),
                ("GB", "GBR"),
                ("CH", "CHE"),
                ("IL", "ISR"),
                ("KR", "KOR"),
            )
        },
    }
    entradas.update(
        {
            "mundo-eurostat": {
                "consultado": "2026-10-11",
                "cifras": {
                    indicador["id"]: {
                        codigo: [{"valor": 20.0, "anio": 2025, "nota": None}]
                        for codigo in (
                            "EU27_2020",
                            "ES",
                            "DE",
                            "FR",
                            "IT",
                            *(("ES51",) if indicador["id"] != "empresas-ia" else ()),
                        )
                    }
                    for indicador in datos_globales.INDICADORES_EUROSTAT
                },
            },
            "ue-eurostat": {
                "consultado": "2026-10-11",
                "cifras": {},
                "recuentos": {
                    datos_globales.RECUENTO_ESPECIALISTAS_TIC.id: [{"valor": 1000, "anio": 2025, "nota": None}],
                },
            },
            "decada-digital": {"url": "https://example.org/norma"},
            "eurobarometro": {
                "anio": 2025,
                "url": "https://example.org/encuesta",
                "licencia": "Prueba",
                "preguntas": {
                    hoja: {
                        "pregunta": "Pregunta de prueba",
                        "respuesta": "Respuesta de prueba",
                        "base": "Base de prueba",
                        "cifras": {"EU27_2020": 50},
                    }
                    for hoja in datos_globales.ENCUESTAS
                },
            },
            "tic-llars": {"consultado": "2026-10-11", "cifras": {}},
            "clima-empresarial": {
                "consultado": "2026-10-11",
                "cifras": {
                    "establecimientos-ia-personal-cualificado": {"valor": 25.0, "anio": 2025, "nota": None},
                },
            },
            "ilostat": {
                "consultado": "2026-10-11",
                "paises": {
                    codigo: {
                        "anio": 2025,
                        "empleo": {"4": {"valor": 10.0, "nota": None}},
                        "mujeres": {"4": {"valor": 50.0, "nota": None}},
                    }
                    for codigo in ("ESP", "DEU", "FRA", "ITA", "USA")
                },
            },
            "territorios": {"paises": paises},
            "encuestas-isco4": json.loads(
                (RAIZ / "plataforma_datos/ia_y_trabajo/pruebas/fixtures/encuestas-isco4.json").read_text()
            ),
        }
    )
    for fuente, indicadores in datos_globales.MEDIDAS_NACIONALES.items():
        entradas[fuente] = {
            "consultado": "2026-10-11",
            "paises": {iso3: {"valor": 10.0, "anio": 2025} for iso3 in indicadores},
        }
    return entradas


class PruebaPublicarGlobales(unittest.TestCase):
    """Admisión, consistencia de composición y conservación del archivo anterior ante errores."""

    def setUp(self) -> None:
        """Raíz trasladada y veinte conjuntos admitidos pequeños."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        self.validados = self.raiz / publicador.CARPETA_VALIDADA
        self.entradas = entradas_de_prueba()
        self.informe = {"estado": "Admitido", "controles": [{"control": "prueba", "resultado": "correcto"}]}
        for fuente, datos in self.entradas.items():
            self.escribir(self.validados / fuente / f"{fuente}.json", datos)
            self.escribir(self.validados / fuente / "validacion.json", self.informe)
        self.origen = self.validados / "datos-globales/datos-globales.json"
        self.validacion = self.origen.with_name("validacion.json")
        self.datos = datos_globales.componer(self.entradas)
        self.assertEqual(problemas_del_contrato(self.datos), [])
        self.assertEqual(datos_globales.faltan_imprescindibles(self.datos), {})
        self.escribir(self.origen, self.datos)
        self.escribir(self.validacion, self.informe)
        self.destino = self.raiz / publicador.DESTINO
        self.destino.parent.mkdir(parents=True)
        self.destino.write_bytes(b"version anterior")

    def escribir(self, ruta: Path, datos: object) -> None:
        """Guarda una entrada propia con sangría deliberadamente distinta a la habitual."""
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=3) + "\n", encoding="utf-8")

    def rechaza(self, error: type[Exception]) -> None:
        """Un rechazo conserva el destino y no deja un archivo parcial."""
        with self.assertRaises(error):
            publicador.publicar_globales(self.raiz)
        self.assertEqual(self.destino.read_bytes(), b"version anterior")
        self.assertEqual(list(self.destino.parent.glob(f".{self.destino.name}.*.parcial")), [])

    def test_publica_bytes_exactos_y_respeta_ajenos(self) -> None:
        """No reserializa la sangría del agregado ni modifica otro archivo público."""
        ajeno = self.destino.with_name("notas.txt")
        ajeno.write_bytes(b"ajeno")
        for _ in range(2):
            self.assertEqual(publicador.publicar_globales(self.raiz), self.destino)
            self.assertEqual(self.destino.read_bytes(), self.origen.read_bytes())
            self.assertEqual(ajeno.read_bytes(), b"ajeno")

    def test_ruta_explicita_de_admision_no_usa_globales(self) -> None:
        """La extensión keyword no necesita cambiar carpetas compartidas."""
        with mock.patch.object(entrada_salida, "carpetas", side_effect=AssertionError("ruta global usada")):
            self.assertEqual(admision.exigir_admitido("datos-globales", ruta=self.validacion), self.informe)

    def test_falta_agregado_o_informe(self) -> None:
        """Ni un informe sin conjunto ni un conjunto sin informe autorizan publicación."""
        for ruta in (self.origen, self.validacion):
            with self.subTest(ruta=ruta.name):
                contenido = ruta.read_bytes()
                ruta.unlink()
                self.rechaza(ArchivoFaltante)
                ruta.write_bytes(contenido)

    def test_informe_global_defectuoso_o_fallido(self) -> None:
        """Rechaza formas desconocidas, estado fallido, controles fallidos y controles vacíos."""
        for informe in (
            [],
            {},
            {"estado": "Con errores", "controles": self.informe["controles"]},
            {"estado": "Admitido", "controles": [{"control": "fallo", "resultado": "ERROR"}]},
            {"estado": "Admitido", "controles": []},
        ):
            with self.subTest(informe=informe):
                self.escribir(self.validacion, informe)
                self.rechaza(ValidacionFallida)

    def test_json_roto_o_no_utf8(self) -> None:
        """Un agregado ilegible tiene diagnóstico y conserva lo publicado."""
        for contenido in (b"{roto", b"\xff"):
            with self.subTest(contenido=contenido):
                self.origen.write_bytes(contenido)
                self.rechaza(FormatoInesperado)

    def test_contrato_invalido(self) -> None:
        """Un porcentaje imposible no pasa por tener un informe admitido."""
        self.datos["territorios"][0]["valores"][0]["valor"] = 101
        self.escribir(self.origen, self.datos)
        self.rechaza(ValidacionFallida)

    def test_cifra_alterada_con_informe_antiguo(self) -> None:
        """Una cifra distinta pero válida para el contrato debe coincidir con los veinte agregados."""
        self.datos["territorios"][0]["valores"][0]["valor"] = 21.0
        self.assertEqual(problemas_del_contrato(self.datos), [])
        self.escribir(self.origen, self.datos)
        self.rechaza(ValidacionFallida)

    def test_imprescindible_ausente_aunque_compuesto_coincida(self) -> None:
        """La composición y el contrato no sustituyen el control de territorios imprescindibles."""
        del self.entradas["ilostat"]["paises"]["DEU"]["empleo"]["4"]
        self.escribir(self.validados / "ilostat/ilostat.json", self.entradas["ilostat"])
        datos = datos_globales.componer(self.entradas)
        self.assertEqual(problemas_del_contrato(datos), [])
        self.escribir(self.origen, datos)
        self.rechaza(ValidacionFallida)

    def test_no_pisa_parcial_ajeno(self) -> None:
        """El temporal de nombre único no reemplaza un archivo preexistente con nombre fijo."""
        ajeno = self.destino.with_name(f".{self.destino.name}.parcial")
        ajeno.write_bytes(b"parcial ajeno")
        publicador.publicar_globales(self.raiz)
        self.assertEqual(ajeno.read_bytes(), b"parcial ajeno")
        self.assertEqual(list(self.destino.parent.glob(f".{self.destino.name}.*.parcial")), [])

    def test_entrada_sin_admision(self) -> None:
        """El informe fallido de una fuente impide usar su agregado."""
        ruta = self.validados / "mundo-eurostat/validacion.json"
        self.escribir(ruta, {"estado": "Con errores", "controles": self.informe["controles"]})
        self.rechaza(ValidacionFallida)

    def test_entrada_ausente_o_malformada(self) -> None:
        """La forma se exige antes de componer, sin KeyError ni sustitución del destino."""
        ruta = self.validados / "ceo-panel/ceo-panel.json"
        ruta.unlink()
        self.rechaza(ArchivoFaltante)
        self.escribir(ruta, {})
        self.rechaza(FormatoInesperado)

    def test_fallo_al_sustituir_conserva_anterior(self) -> None:
        """Un error real de reemplazo no trunca el público y retira el parcial propio."""
        reemplazar = Path.replace

        def falla(ruta: Path, destino: Path) -> Path:
            """Simula fallo de disco solo al sustituir el destino de esta prueba.

            Returns:
                El resultado del reemplazo real para cualquier otra ruta.

            Raises:
                OSError: En el destino propio del ensayo.
            """
            if destino == self.destino:
                raise OSError("disco lleno simulado")
            return reemplazar(ruta, destino)

        with mock.patch.object(Path, "replace", falla):
            self.rechaza(OSError)
