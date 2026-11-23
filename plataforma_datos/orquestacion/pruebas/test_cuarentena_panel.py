"""Los cambios retenidos llegan al panel con un contrato cerrado; lo ilegible nunca pasa por «nada retenido»."""

import copy
import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.cursos.fuentes.formacion.censo_soc import CIFRAS_PENDIENTE
from plataforma_datos.orquestacion import almacen_trabajos
from plataforma_datos.orquestacion import cuarentena_panel as retenidos
from plataforma_datos.orquestacion import estado_panel as panel
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import VERSION_PANEL_EMITIDA
from plataforma_datos.orquestacion.cuarentena_del_paquete import ARCHIVO_DE_CUARENTENA, VERSION_CUARENTENA
from plataforma_datos.orquestacion.instantanea_del_recibo import validar_instantanea
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES

AHORA = datetime(2026, 11, 22, 6, tzinfo=UTC)
PUBLICADA = "a" * 64
RETENIDA = "b" * 64
OFERTA = "c" * 64
NADA_LEIDO = {"cuarentena": {"lectura": "leida", "cambios": []}, "censoSoc": {"lectura": "leida", "pendiente": None}}


def entrada_de_cuarentena(aceptada: str | None = None) -> dict:
    """Una entrada de cuarentena.json con la forma exacta que escribe registrar_cuarentena.

    Returns:
        La entrada de formacion.json, que se conserva con correspondencia-eures.json.
    """
    return {
        "grupo": ["correspondencia-eures.json", "formacion.json"],
        "perdidas": [
            {"archivo": "formacion.json", "medida": "entradas", "antes": 1000, "despues": 700},
            {"archivo": "formacion.json", "medida": "cursos SOC", "antes": 400, "despues": 250},
        ],
        "desde_utc": "2026-11-20T05:00:00+00:00",
        "ultima_utc": "2026-11-21T05:00:00+00:00",
        "vigente_sha256": PUBLICADA,
        "exportado_sha256": RETENIDA,
        "aceptada_utc": aceptada,
    }


def cifras_soc() -> dict:
    """Las cifras de una oferta del SOC pendiente, con la forma exacta que escribe censo_soc.

    Returns:
        Las cifras, con microsegundos en la consulta como las escribe ahora_utc.
    """
    return {
        "archivo": "soc-cursos-pendiente.json",
        "sha256": OFERTA,
        "bytes": 123456,
        "comprobado_remoto_utc": "2026-11-21T04:30:15.123456+00:00",
        "cursos": 120,
        "copia_anterior": "soc-cursos-2026-11-20.json",
        "cursos_copia_anterior": 400,
        "perdida_maxima": 0.2,
    }


class PruebaRetenidosDelPanel(unittest.TestCase):
    """Lectura de las dos retenciones desde una instalación sintética."""

    def setUp(self) -> None:
        """Prepara una instalación fuera del producto, con espacios y acentos en su ruta."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        self.cuarentena = self.raiz / CARPETA_DE_INFORMES / ARCHIVO_DE_CUARENTENA
        self.cuarentena.parent.mkdir(parents=True)
        self.cifras = self.raiz / "var" / "actualizacion" / "originales" / "formacion" / CIFRAS_PENDIENTE
        self.cifras.parent.mkdir(parents=True)

    def guardar_cuarentena(self, archivos: dict) -> None:
        """Escribe cuarentena.json en su versión vigente."""
        documento = {"version": VERSION_CUARENTENA, "archivos": archivos}
        self.cuarentena.write_text(json.dumps(documento), encoding="utf-8")

    def test_sin_retenciones_se_lee_que_no_hay_nada_retenido(self) -> None:
        """Sin cuarentena.json ni cifras del SOC, las dos partes se leen y no retienen nada."""
        self.assertEqual(retenidos.retenidos_del_panel(self.raiz), NADA_LEIDO)

    def test_una_cuarentena_vigente_viaja_con_sus_cifras_fechas_y_huellas(self) -> None:
        """El cambio retenido lleva su grupo, cada pérdida con su medida, sus fechas en UTC y las dos huellas."""
        self.guardar_cuarentena({"formacion.json": entrada_de_cuarentena()})
        bloque = retenidos.retenidos_del_panel(self.raiz)
        self.assertEqual(
            bloque["cuarentena"],
            {
                "lectura": "leida",
                "cambios": [
                    {
                        "archivo": "formacion.json",
                        "grupo": ["correspondencia-eures.json", "formacion.json"],
                        "perdidas": [
                            {"medida": "entradas", "antes": 1000, "despues": 700},
                            {"medida": "cursos-soc", "antes": 400, "despues": 250},
                        ],
                        "desdeUtc": "2026-11-20T05:00:00Z",
                        "ultimaUtc": "2026-11-21T05:00:00Z",
                        "vigenteSha256": PUBLICADA,
                        "exportadoSha256": RETENIDA,
                        "aceptadaUtc": None,
                    }
                ],
            },
        )
        self.assertEqual(bloque["censoSoc"], NADA_LEIDO["censoSoc"])

    def test_una_cuarentena_aceptada_dice_cuando_se_acepto(self) -> None:
        """La aceptación viaja como instante UTC; los cambios salen en el orden de sus archivos."""
        otra = {**entrada_de_cuarentena(), "grupo": ["censo.json"]}
        otra["perdidas"] = [{"archivo": "censo.json", "medida": "entradas", "antes": 50, "despues": 10}]
        self.guardar_cuarentena(
            {"formacion.json": entrada_de_cuarentena("2026-11-21T09:15:00+01:00"), "censo.json": otra}
        )
        cambios = retenidos.retenidos_del_panel(self.raiz)["cuarentena"]["cambios"]
        self.assertEqual([cambio["archivo"] for cambio in cambios], ["censo.json", "formacion.json"])
        self.assertIsNone(cambios[0]["aceptadaUtc"])
        self.assertEqual(cambios[1]["aceptadaUtc"], "2026-11-21T08:15:00Z")

    def test_el_censo_del_soc_pendiente_viaja_sin_nombres_de_archivo(self) -> None:
        """Cursos de la oferta y de la copia, huella y consulta; ni el nombre de la copia ni el de la oferta."""
        self.cifras.write_text(json.dumps(cifras_soc()), encoding="utf-8")
        bloque = retenidos.retenidos_del_panel(self.raiz)
        self.assertEqual(
            bloque["censoSoc"],
            {
                "lectura": "leida",
                "pendiente": {
                    "cursosOferta": 120,
                    "cursosCopia": 400,
                    "huella": OFERTA,
                    "consultadoEn": "2026-11-21T04:30:15.123456Z",
                },
            },
        )
        self.assertNotIn("soc-cursos", json.dumps(bloque))
        self.assertEqual(bloque["cuarentena"], NADA_LEIDO["cuarentena"])

    def test_una_cuarentena_ilegible_o_de_otra_version_no_pasa_por_nada_retenido(self) -> None:
        """JSON roto, otra versión, campos de otra forma o un directorio se informan como «ilegible»."""
        de_otra_version = json.dumps({"version": VERSION_CUARENTENA + 1, "archivos": {}})
        sin_huella = {"version": VERSION_CUARENTENA, "archivos": {"formacion.json": entrada_de_cuarentena()}}
        sin_huella["archivos"]["formacion.json"]["vigente_sha256"] = "corta"
        desordenada = copy.deepcopy(sin_huella)
        desordenada["archivos"]["formacion.json"]["vigente_sha256"] = PUBLICADA
        desordenada["archivos"]["formacion.json"]["desde_utc"] = "2026-11-22T05:00:00+00:00"
        for nombre, contenido in (
            ("roto", "{"),
            ("otra version", de_otra_version),
            ("huella invalida", json.dumps(sin_huella)),
            ("retenido despues de la ultima vez", json.dumps(desordenada)),
            ("no es utf-8", b"\xff\xfe"),
        ):
            with self.subTest(nombre):
                if isinstance(contenido, bytes):
                    self.cuarentena.write_bytes(contenido)
                else:
                    self.cuarentena.write_text(contenido, encoding="utf-8")
                bloque = retenidos.retenidos_del_panel(self.raiz)
                self.assertEqual(bloque["cuarentena"], {"lectura": "ilegible", "cambios": None})
                self.assertEqual(bloque["censoSoc"], NADA_LEIDO["censoSoc"])
        self.cuarentena.unlink()
        self.cuarentena.mkdir()
        self.assertEqual(retenidos.cuarentena_del_panel(self.raiz), {"lectura": "ilegible", "cambios": None})

    def test_unas_cifras_del_soc_ilegibles_o_de_otra_forma_no_pasan_por_nada_pendiente(self) -> None:
        """JSON roto, claves repetidas, campos de más o de menos, otra oferta, NaN o un enlace se dicen «ilegible»."""
        de_mas = {**cifras_soc(), "version": 2}
        de_menos = {clave: valor for clave, valor in cifras_soc().items() if clave != "copia_anterior"}
        otra_oferta = {**cifras_soc(), "archivo": "otra.json"}
        sin_caida = {**cifras_soc(), "cursos": 400}
        sin_zona = {**cifras_soc(), "comprobado_remoto_utc": "2026-11-21T04:30:15"}
        for nombre, contenido in (
            ("roto", "{"),
            ("repetida", '{"cursos": 1, "cursos": 2}'),
            ("no finito", json.dumps(cifras_soc()).replace("0.2", "NaN")),
            ("campo de mas", json.dumps(de_mas)),
            ("campo de menos", json.dumps(de_menos)),
            ("otra oferta", json.dumps(otra_oferta)),
            ("sin caida", json.dumps(sin_caida)),
            ("sin zona", json.dumps(sin_zona)),
        ):
            with self.subTest(nombre):
                self.cifras.write_text(contenido, encoding="utf-8")
                self.assertEqual(retenidos.censo_soc_del_panel(self.raiz), {"lectura": "ilegible", "pendiente": None})
        self.cifras.unlink()
        destino = self.raiz / "cifras-ajenas.json"
        destino.write_text(json.dumps(cifras_soc()), encoding="utf-8")
        self.cifras.symlink_to(destino)
        self.assertEqual(retenidos.censo_soc_del_panel(self.raiz), {"lectura": "ilegible", "pendiente": None})


class PruebaContratoDeRetenidos(unittest.TestCase):
    """El contrato es cerrado: rechaza campos de más o de menos en cada nivel y lecturas incoherentes."""

    def bloque(self) -> dict:
        """Un bloque válido con un cambio retenido y el censo pendiente.

        Returns:
            El bloque, que el contrato admite.
        """
        return {
            "cuarentena": {
                "lectura": "leida",
                "cambios": [
                    {
                        "archivo": "formacion.json",
                        "grupo": ["formacion.json"],
                        "perdidas": [{"medida": "entradas", "antes": 10, "despues": 5}],
                        "desdeUtc": "2026-11-20T05:00:00Z",
                        "ultimaUtc": "2026-11-21T05:00:00Z",
                        "vigenteSha256": PUBLICADA,
                        "exportadoSha256": RETENIDA,
                        "aceptadaUtc": None,
                    }
                ],
            },
            "censoSoc": {
                "lectura": "leida",
                "pendiente": {
                    "cursosOferta": 1,
                    "cursosCopia": 9,
                    "huella": OFERTA,
                    "consultadoEn": "2026-11-21T04:00:00Z",
                },
            },
        }

    def test_admite_el_bloque_valido_y_rechaza_campos_de_mas(self) -> None:
        """Un campo de más en el bloque, en una parte, en un cambio, en una pérdida o en el censo se rechaza."""
        retenidos.validar_retenidos(self.bloque())
        rutas = (
            (),
            ("cuarentena",),
            ("cuarentena", "cambios", 0),
            ("cuarentena", "cambios", 0, "perdidas", 0),
            ("censoSoc",),
            ("censoSoc", "pendiente"),
        )
        for ruta in rutas:
            with self.subTest(ruta=ruta):
                bloque = self.bloque()
                destino = bloque
                for paso in ruta:
                    destino = destino[paso]
                destino["ruta"] = "/privado"
                with self.assertRaises(retenidos.RetenidosInvalidos):
                    retenidos.validar_retenidos(bloque)

    def test_rechaza_lecturas_incoherentes_y_valores_ajenos(self) -> None:
        """«ilegible» no lleva datos; una medida, un archivo o un instante ajenos no pasan."""
        casos = {
            "ilegible con cambios": lambda b: b["cuarentena"].update(lectura="ilegible"),
            "ilegible con censo": lambda b: b["censoSoc"].update(lectura="ilegible"),
            "lectura desconocida": lambda b: b["censoSoc"].update(lectura="vacia"),
            "medida libre": lambda b: b["cuarentena"]["cambios"][0]["perdidas"][0].update(medida="cursos SOC"),
            "archivo con ruta": lambda b: b["cuarentena"]["cambios"][0].update(archivo="../formacion.json"),
            "instante con zona": lambda b: b["cuarentena"]["cambios"][0].update(desdeUtc="2026-11-20T05:00:00+00:00"),
            "aceptada antes de retener": lambda b: b["cuarentena"]["cambios"][0].update(
                aceptadaUtc="2026-11-19T05:00:00Z"
            ),
            "cifra negativa": lambda b: b["censoSoc"]["pendiente"].update(cursosOferta=-1),
        }
        for nombre, cambiar in casos.items():
            with self.subTest(nombre):
                bloque = self.bloque()
                cambiar(bloque)
                with self.assertRaises(retenidos.RetenidosInvalidos):
                    retenidos.validar_retenidos(bloque)


class PruebaRetenidosEnElEstado(unittest.TestCase):
    """El enganche en el estado del panel: la v5 de hoy no cambia y la v6 lleva el bloque validado."""

    def setUp(self) -> None:
        """Prepara la instalación mínima que el estado del panel sabe leer, con una cuarentena vigente."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        fichas = self.raiz / "var" / "actualizacion" / "preparados" / "abierta" / "fichas.json"
        fichas.parent.mkdir(parents=True)
        fichas.write_text('{"fichas": [], "plataformas": {}}', encoding="utf-8")
        cuarentena = self.raiz / CARPETA_DE_INFORMES / ARCHIVO_DE_CUARENTENA
        cuarentena.parent.mkdir(parents=True)
        documento = {"version": VERSION_CUARENTENA, "archivos": {"formacion.json": entrada_de_cuarentena()}}
        cuarentena.write_text(json.dumps(documento), encoding="utf-8")

    def test_el_estado_que_se_emite_hoy_conserva_la_version_que_lee_el_servidor(self) -> None:
        """Por omisión sale la v5 sin el bloque, aunque haya cuarentena: el lector publicado la sigue entendiendo."""
        self.assertEqual(VERSION_PANEL_EMITIDA, 5)
        estado = panel.estado_panel(self.raiz, AHORA)
        self.assertEqual(estado["version"], 5)
        self.assertNotIn(retenidos.CLAVE_RETENIDOS, estado)
        validar_instantanea(estado)

    def test_la_v6_lleva_los_retenidos_y_el_recibo_la_valida(self) -> None:
        """La v6 añade el bloque; el validador del recibo la admite y rechaza mezclar versiones o un campo de más."""
        estado = panel.estado_panel(self.raiz, AHORA, version=6)
        self.assertEqual(estado["version"], 6)
        self.assertEqual(estado[retenidos.CLAVE_RETENIDOS]["cuarentena"]["cambios"][0]["archivo"], "formacion.json")
        validar_instantanea(estado)
        sin_bloque = {clave: valor for clave, valor in estado.items() if clave != retenidos.CLAVE_RETENIDOS}
        de_mas = copy.deepcopy(estado)
        de_mas[retenidos.CLAVE_RETENIDOS]["cuarentena"]["cambios"][0]["motivo"] = "texto libre"
        for nombre, mezcla in (
            ("v6 sin bloque", sin_bloque),
            ("v5 con bloque", {**estado, "version": 5}),
            ("campo de mas", de_mas),
        ):
            with self.subTest(nombre), self.assertRaises(almacen_trabajos.AlmacenTrabajoInvalido):
                validar_instantanea(mezcla)

    def test_una_version_desconocida_no_se_emite(self) -> None:
        """Solo se emiten la v5 y la v6; otra se rechaza con el error genérico del panel."""
        for version in (4, 7):
            with self.subTest(version=version), self.assertRaises(panel.EstadoPanelInvalido):
                panel.estado_panel(self.raiz, AHORA, version=version)


if __name__ == "__main__":
    unittest.main()
