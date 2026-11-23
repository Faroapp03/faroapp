"""La edición nueva como candidata: se prepara y valida como la admitida y se incorpora sola o queda detenida.

Con microdatos sintéticos pequeños, las tablas capturadas del INE y la metodología y el cuestionario reales de 2026 (que
viven en `datos/ine-tich/`), en una instalación temporal: ninguna prueba escribe en `var/`. Los controles que piden
microdatos reales (contraste con la tabla de uso, la EPA, los errores del INE, la regla del NCHS y la correspondencia)
se fijan; los demás, también la huella de cada original, corren de verdad.
"""

import csv
import io
import json
import re
import tempfile
import unittest
import zipfile
import zlib
from collections.abc import Callable
from contextlib import ExitStack, suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun.entrada_salida import comprobar_originales, guardar_json, leer_json, sha256, sha256_bytes
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, Controles, FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.tich import candidata
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import FICHERO_CUESTIONARIO, VARIABLES
from plataforma_datos.ia_y_trabajo.fuentes.tich.documentos_de_la_edicion import PARTES
from plataforma_datos.ia_y_trabajo.fuentes.tich.ediciones import edicion_del_catalogo
from plataforma_datos.ia_y_trabajo.pruebas.test_documentos_tich import diseno_de_la_pregunta
from plataforma_datos.ia_y_trabajo.pruebas.test_ediciones_tich import catalogo
from plataforma_datos.orquestacion import ediciones_observadas
from plataforma_datos.orquestacion.contrato_de_trabajos import AlmacenTrabajoInvalido
from plataforma_datos.orquestacion.ediciones_observadas import (
    NO_VERIFICABLE,
    campos_del_panel,
    clave_en_la_fila,
    comprobar_en_el_recibo,
)

DATOS = Path(__file__).parent / "datos" / "ine-tich"
OBSERVADA = {
    "estado": "pendiente-de-incorporar",
    "anio": "2026",
    "observado_utc": "2026-11-15T03:00:00+00:00",
}
BASE_2026: candidata.Base = {
    "anio": "2026",
    "anios_medidos": ["2025", "2026"],
    "tablas": {"uso": "82804", "errores": "82907"},
    "epa_anio": "2025",
}
# Lo que dice la metodología real de 2026 y la huella de sus dos documentos.
LEIDO_DE_2026 = {
    "secciones": {"espana": 2500, "cataluna": 216},
    "documentos": {
        "metodologia": "0d90a3e3ef9cfcd29bd3a0982bd17ad707e1fdd57ea046b008a279adb610ede2",
        "cuestionario": "2172bcb98f59fb8b6b3e5867fecfbfa53f234318a3d86f7359fa2ff4a11d8290",
    },
}
# Uso por motivos profesionales de las ocupaciones manuales en la tabla 82804 de 2026 (en la 76444 de 2025, 7,7).
USO_MANUAL_2026 = 16.5
FIJADOS = (
    "_controles_grupos",
    "_controles_correspondencia",
    "_controles_regla",
    "contraste_errores_ine",
    "_controles_epa",
)


def microdatos(anio: str, diseno: dict[str, Any], clases_del_21: tuple[str, ...] = ("6",)) -> bytes:
    """Un ZIP de microdatos con su fichero del cuestionario: seis personas ocupadas y su diseño de registro.

    En 2026, dos son del grupo 52, una manual y otra no manual: el grupo no tiene clase en esa edición. Las del grupo
    21 llevan, por turno, las clases de `clases_del_21` en 2026 (`OCUPACION1`: 1 manual, 6 no manual).

    Returns:
        Sus bytes.
    """
    fila = {
        "CCAA": "09",
        "HABITAT_ESTRATO": "1",
        "EDAD": "40",
        "OCUPACION": "21",
        "OCUPACION1": "6",
        "OCUPACION2": "6",
        "IAG_TRAB": "1",
        "TELETRAB": "1",
        "IAG": "1",
        "FACTOR_P": "1000.5",
    }
    filas = [{**fila, "IAG_TRAB": "1" if indice % 2 else "6"} for indice in range(6)]
    if anio == "2026":
        filas[4:] = [{**filas[4], "OCUPACION": "52"}, {**filas[5], "OCUPACION": "52", "OCUPACION1": "1"}]
        for indice, fila_21 in enumerate(filas[:4]):
            fila_21["OCUPACION1"] = clases_del_21[indice % len(clases_del_21)]
    texto = "\t".join(VARIABLES) + "\n" + "".join("\t".join(f[v] for v in VARIABLES) + "\n" for f in filas)
    interno = io.BytesIO()
    nombres = estado.nombres({**BASE_2026, "anio": anio})
    with zipfile.ZipFile(interno, "w") as escrito:
        escrito.writestr(nombres.diseno, json.dumps(diseno))
        escrito.writestr(nombres.datos, texto.encode("latin-1"))
    externo = io.BytesIO()
    with zipfile.ZipFile(externo, "w") as escrito:
        escrito.writestr(FICHERO_CUESTIONARIO, interno.getvalue())
    return externo.getvalue()


def epa() -> bytes:
    """Una EPA de Eurostat mínima en JSON-stat, con un grupo.

    Returns:
        Sus bytes.
    """
    documento = {
        "extension": {"id": "LFSA_EGAI2D"},
        "dimension": {"isco08": {"category": {"index": {"OC21": 0}}}},
        "value": {"0": 100.0},
    }
    return json.dumps(documento).encode()


def diseno_valido() -> dict[str, Any]:
    """El diseño de registro de las pruebas, con la pregunta de la serie y la lista de ocupaciones.

    Returns:
        El diseño.
    """
    diseno = diseno_de_la_pregunta()
    ocupaciones = {"21": "Profesionales de la salud", "52": "Vendedores"}
    return {**diseno, "codelists": {**diseno["codelists"], "T_OCUPA": ocupaciones}}


def _escribir_anio(carpeta: Path, edicion: dict[str, Any], contenidos: dict[str, bytes]) -> list[dict[str, Any]]:
    """Deja los originales de una edición en la carpeta de su año, con su procedencia.

    Returns:
        Sus registros, con la ruta dentro de la carpeta de la fuente.
    """
    del_anio = estado.carpeta(edicion, carpeta)
    del_anio.mkdir(parents=True, exist_ok=True)
    registros = []
    for nombre, datos in contenidos.items():
        (del_anio / nombre).write_bytes(datos)
        registros.append({"archivo": nombre, "sha256": sha256_bytes(datos)})
    guardar_json(
        del_anio / "procedencia.json",
        {"anio": edicion["anio"], "epa_anio": edicion["epa_anio"], "archivos": registros},
    )
    return estado.en_la_operacion(edicion, registros)


def instalacion(
    carpeta: Path,
    diseno_2026: dict[str, Any] | None = None,
    procedencia: dict | None = None,
    clases_del_21: tuple[str, ...] = ("6",),
) -> None:
    """Una instalación con 2025 admitida y 2026 observada, navegada y descargada como candidata."""
    primera = estado.primera()
    nombres_2025, nombres_2026 = estado.nombres(primera), estado.nombres(BASE_2026)
    admitidos = _escribir_anio(
        carpeta,
        primera,
        {
            nombres_2025.microdatos: microdatos("2025", diseno_valido()),
            nombres_2025.uso: (DATOS / "76444.csv").read_bytes(),
            nombres_2025.errores: (DATOS / "76849.csv").read_bytes(),
            nombres_2025.epa: epa(),
        },
    )
    candidatos = _escribir_anio(
        carpeta,
        BASE_2026,
        {
            nombres_2026.microdatos: microdatos("2026", diseno_2026 or diseno_valido(), clases_del_21),
            nombres_2026.uso: (DATOS / "82804.csv").read_bytes(),
            nombres_2026.errores: (DATOS / "82907.csv").read_bytes(),
            nombres_2026.epa: epa(),
            nombres_2026.metodologia: (DATOS / "metodologia-2026.pdf").read_bytes(),
            nombres_2026.cuestionario: (DATOS / "cuestionario-2026.pdf").read_bytes(),
        },
    )
    cuerpo = catalogo(2026, 2026).encode()
    guardar_json(
        carpeta / "procedencia.json",
        {
            "fuente": "TIC-H 2025",
            "edicion": edicion_del_catalogo(cuerpo.decode()),
            "edicion_nueva": {**OBSERVADA, "sha256_catalogo": sha256_bytes(cuerpo)},
            "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo)}],
            "archivos": admitidos,
            "tablas_edicion_nueva": {
                "paginas": [{"url": f"https://www.ine.es/indice/{n}", "sha256": "0" * 64} for n in range(3)]
            },
            "candidata": {"edicion": dict(BASE_2026), "archivos": candidatos},
            **(procedencia or {}),
        },
    )


def ejecutar(
    temporal: Path, publicadas_que_fallan: Callable[[dict[str, Any]], bool] = lambda _: False, corte: bool = False
) -> tuple[mock.Mock, estado.Edicion, dict[str, Any]]:
    """Prepara y valida en la instalación temporal, con los controles de microdatos reales fijados.

    Args:
        temporal: La carpeta de la instalación.
        publicadas_que_fallan: Qué cifras publicadas hacen fallar el contraste con la tabla de uso.
        corte: Si el proceso se corta al guardar el estado de la edición, justo después de guardar la validación.

    Returns:
        El cierre de la validación (con su informe, sus controles y su conjunto), el estado y la procedencia.
    """
    carpeta, ruta_estado = temporal / "originales", temporal / "edicion.json"

    def contraste(controles: Controles, _estimaciones: dict[str, Any], publicadas: dict[str, Any]) -> None:
        controles.comprobar(not publicadas_que_fallan(publicadas), "los microdatos reproducen la tabla de uso")

    with ExitStack() as parches:
        for nombre, valor in (
            ("ORIGINAL", carpeta),
            ("PROCEDENCIA", carpeta / "procedencia.json"),
            ("ESTADO_EDICION", ruta_estado),
            ("ESTIMACIONES", temporal / "estimaciones.json"),
            ("PUBLICADAS", temporal / "publicadas.json"),
            ("PREPARADA", temporal / "candidata" / "candidata.json"),
        ):
            parches.enter_context(mock.patch.object(tich, nombre, valor))
        for nombre in FIJADOS:
            parches.enter_context(mock.patch.object(tich, nombre, return_value={}))
        parches.enter_context(mock.patch.object(tich, "_controles_publicadas", contraste))
        parches.enter_context(
            mock.patch.object(tich, "comprobar_originales", lambda fuente: comprobar_originales(fuente, carpeta))
        )
        parches.enter_context(
            mock.patch.object(tich, "leer_validado", return_value={"isco08_es": {}, "isco08_a_cno11": {}})
        )
        parches.enter_context(mock.patch("builtins.print"))
        cerrar = parches.enter_context(mock.patch.object(tich, "cerrar_validacion"))
        tich.preparar()
        if corte:
            parches.enter_context(mock.patch.object(estado, "guardar", side_effect=OSError("corte")))
            with suppress(OSError):
                tich.validar()
        else:
            tich.validar()
    return cerrar, estado.leer(ruta_estado), leer_json(carpeta / "procedencia.json")


class PruebaCandidataIncorporada(unittest.TestCase):
    """La candidata que pasa todos sus controles se publica, y el estado y la procedencia pasan a ella."""

    def test_2026_se_incorpora_con_la_serie_de_los_dos_anios(self) -> None:
        """Conjunto de 2026 con `["2025", "2026"]` y sin observación; estado con lo leído de sus documentos reales."""
        with tempfile.TemporaryDirectory() as temporal:
            instalacion(Path(temporal) / "originales")
            cerrar, admitida, procedencia = ejecutar(Path(temporal))
            preparada = leer_json(Path(temporal) / "candidata" / "candidata.json")
            huellas_al_dia = all(
                sha256(Path(temporal) / "originales" / entrada["archivo"]) == entrada["sha256"]
                for entrada in procedencia["archivos"]
            )
        informe, controles, conjunto = cerrar.call_args.args[1], cerrar.call_args.args[2], cerrar.call_args.args[3]()
        self.assertEqual(cerrar.call_count, 1)
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertEqual((conjunto["anio"], conjunto["anios_medidos"]), ("2026", ["2025", "2026"]))
        self.assertNotIn("edicion_nueva", conjunto)
        self.assertEqual((conjunto["clase_por_isco2"], conjunto["grupos_sin_clase"]), ({"21": "no_manual"}, ["52"]))
        self.assertEqual(informe["grupos_con_las_dos_clases"], {"52": {"manual": 1, "no_manual": 1}})
        self.assertEqual(informe["cambios_de_clase"], {"clase_contraria": [], "a_sin_clase": [], "desde_sin_clase": []})
        self.assertIn(
            "al menos el 95 % de sus entrevistas. En esta edición, los grupos 52 no la tienen", informe["limites"]
        )
        self.assertIn("82804", conjunto["fuentes"]["tich"])
        consulta = procedencia["consulta_de_la_incorporacion"]
        self.assertEqual(set(consulta), {"anterior", "indices", "documentos"})
        self.assertEqual(
            [entrada["archivo"] for entrada in consulta["documentos"]],
            ["2026/ine-tich-2026-metodologia.pdf", "2026/ine-tich-2026-cuestionario.pdf"],
        )
        self.assertEqual(consulta["anterior"]["anio"], "2025")
        self.assertNotIn("candidata", procedencia)
        self.assertEqual(admitida, {**BASE_2026, **LEIDO_DE_2026})
        self.assertEqual(informe["secciones_en_muestra"]["sha256"], LEIDO_DE_2026["documentos"]["metodologia"])
        self.assertEqual(preparada["preparado"]["enunciado"]["diferencias"], [])
        self.assertEqual(
            [entrada["archivo"] for entrada in procedencia["archivos"]],
            [f"2026/{archivo['archivo']}" for archivo in estado.archivos(admitida)],
        )
        self.assertTrue(huellas_al_dia)
        self.assertEqual(set(procedencia) & set(candidata.DE_LA_EDICION_NUEVA), set())
        self.assertIn("2026", procedencia["cita"])
        self.assertEqual(sum(1 for c in controles.lista if c["control"].startswith("huella de 2026/")), 6)

    def test_si_la_admitida_falla_sus_controles_y_la_candidata_los_pasa_el_informe_lo_dice(self) -> None:
        """La tabla de 2025 no cuadra y la de 2026 sí: se incorpora 2026 y su informe nombra los controles de 2025."""
        with tempfile.TemporaryDirectory() as temporal:
            instalacion(Path(temporal) / "originales")
            cerrar, admitida, _ = ejecutar(
                Path(temporal), lambda publicadas: publicadas["uso"]["manual"]["pct"] != USO_MANUAL_2026
            )
        informe, controles = cerrar.call_args.args[1], cerrar.call_args.args[2]
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertEqual(admitida["anio"], "2026")
        sin_admitir = informe["admitida_con_errores"]
        self.assertEqual(sin_admitir["anio"], "2025")
        self.assertTrue(any("tabla de uso" in control for control in sin_admitir["controles"]))

    def test_un_corte_entre_la_validacion_y_el_estado_se_recupera_en_el_ciclo_siguiente(self) -> None:
        """Validación de 2026 guardada y estado en 2025: el cruce de años avisa y el ciclo siguiente incorpora."""
        panel = PruebaPanelDeLaCandidata("test_el_anio_del_estado_tiene_que_ser_el_del_conjunto_validado").panel
        with tempfile.TemporaryDirectory() as temporal:
            instalacion(Path(temporal) / "originales")
            cerrar, en_el_corte, procedencia_cortada = ejecutar(Path(temporal), corte=True)
            self.assertEqual(cerrar.call_args.args[3]()["anio"], "2026")
            self.assertEqual(en_el_corte, estado.primera())
            self.assertIn("candidata", procedencia_cortada)
            self.assertNotIn("consulta_de_la_incorporacion", procedencia_cortada)
            self.assertEqual(panel(None, "2026", "2025"), {"avisoEdicion": "edicion-no-coincide"})
            cerrar, admitida, procedencia = ejecutar(Path(temporal))
        conjunto = cerrar.call_args.args[3]()
        self.assertTrue(cerrar.call_args.args[2].admitido)
        self.assertEqual((conjunto["anio"], admitida["anio"]), ("2026", "2026"))
        self.assertNotIn("candidata", procedencia)
        self.assertNotIn("edicion_nueva", procedencia)
        self.assertTrue(all(entrada["archivo"].startswith("2026/") for entrada in procedencia["archivos"]))


class PruebaCandidataDetenida(unittest.TestCase):
    """Detenida, se publica la admitida, con la edición nueva detenida y un motivo de la lista cerrada."""

    def publicada_con(
        self,
        diseno: dict[str, Any] | None = None,
        procedencia: dict | None = None,
        fallan: Callable[[dict[str, Any]], bool] = lambda _: False,
    ) -> tuple[dict[str, Any], dict[str, Any], estado.Edicion, dict[str, Any]]:
        """Prepara y valida con la candidata cambiada y devuelve lo publicado.

        Returns:
            El informe, el conjunto, el estado y la procedencia.
        """
        with tempfile.TemporaryDirectory() as temporal:
            instalacion(Path(temporal) / "originales", diseno, procedencia)
            cerrar, admitida, procedencia_final = ejecutar(Path(temporal), fallan)
        self.assertEqual(cerrar.call_count, 1)
        return cerrar.call_args.args[1], cerrar.call_args.args[3](), admitida, procedencia_final

    def comprobar_admitida(self, conjunto: dict[str, Any], admitida: estado.Edicion, procedencia: dict) -> None:
        """Lo publicado, el estado y la procedencia siguen en 2025, con la observación de 2026 tal como se vio."""
        self.assertEqual((conjunto["anio"], conjunto["anios_medidos"]), ("2025", ["2025"]))
        self.assertEqual({**conjunto["edicion_nueva"], "sha256_catalogo": ""}, {**OBSERVADA, "sha256_catalogo": ""})
        self.assertEqual(admitida, estado.primera())
        self.assertEqual(procedencia["edicion_nueva"]["estado"], "pendiente-de-incorporar")
        self.assertTrue(all(entrada["archivo"].startswith("2025/") for entrada in procedencia["archivos"]))

    def test_un_enunciado_cambiado_la_detiene_con_las_partes_que_cambian(self) -> None:
        """«(últimos 6 meses)» en `IAG`: «enunciado-distinto» con el periodo, nunca «no se puede comparar»."""
        diseno = diseno_valido()
        diseno["layout"][0]["description"] = "Uso de alguna herramienta de IA Generativa (últimos 6 meses)"
        informe, conjunto, admitida, procedencia = self.publicada_con(diseno=diseno)
        self.comprobar_admitida(conjunto, admitida, procedencia)
        detenida = informe["candidata_detenida"]
        self.assertEqual(
            (detenida["estado"], detenida["anio"], detenida["motivo"], detenida["partes"]),
            ("detenida-por-controles", "2026", "enunciado-distinto", ["periodo"]),
        )

    def test_un_control_que_no_pasa_la_detiene_por_controles(self) -> None:
        """La tabla de 2026 no cuadra: «controles», sin partes, con el control fallido en el detalle."""
        informe, conjunto, admitida, procedencia = self.publicada_con(
            fallan=lambda publicadas: publicadas["uso"]["manual"]["pct"] == USO_MANUAL_2026
        )
        self.comprobar_admitida(conjunto, admitida, procedencia)
        self.assertEqual(informe["candidata_detenida"]["motivo"], "controles")
        self.assertNotIn("partes", informe["candidata_detenida"])
        self.assertIn("tabla de uso", informe["candidata_detenida"]["detalle"])

    def test_sin_sus_originales_o_con_la_descarga_detenida_la_detiene_por_tablas(self) -> None:
        """Una descarga detenida, o un original de la candidata que no conserva su huella: «tablas»."""
        detenida = {"candidata_detenida": {"anio": "2026", "motivo": "tablas", "detalle": "OSError: 503"}}
        informe, conjunto, admitida, procedencia = self.publicada_con(procedencia=detenida)
        self.comprobar_admitida(conjunto, admitida, procedencia)
        self.assertEqual(informe["candidata_detenida"]["motivo"], "tablas")
        with tempfile.TemporaryDirectory() as temporal:
            instalacion(Path(temporal) / "originales")
            (Path(temporal) / "originales" / "2026" / "ine-tich-2026-cuestionario.pdf").write_bytes(b"%PDF-otro")
            cerrar, admitida, _ = ejecutar(Path(temporal))
        self.assertEqual(cerrar.call_args.args[1]["candidata_detenida"]["motivo"], "tablas")
        self.assertEqual(admitida, estado.primera())

    def poner_microdatos(self, raiz: Path, datos: bytes) -> None:
        """Deja `datos` como los microdatos de 2026, con la huella de lo que quedó, como lo registra una descarga."""
        zip_2026 = raiz / "2026" / estado.nombres(BASE_2026).microdatos
        zip_2026.write_bytes(datos)
        huella = sha256_bytes(datos)
        operacion = leer_json(raiz / "procedencia.json")
        for entrada in operacion["candidata"]["archivos"]:
            if entrada["archivo"].endswith("microdatos.zip") and entrada["archivo"].startswith("2026/"):
                entrada["sha256"] = huella
        guardar_json(raiz / "procedencia.json", operacion)
        del_anio = leer_json(raiz / "2026" / "procedencia.json")
        for entrada in del_anio["archivos"]:
            if entrada["archivo"] == zip_2026.name:
                entrada["sha256"] = huella
        guardar_json(raiz / "2026" / "procedencia.json", del_anio)

    @staticmethod
    def zip_danado(modo: str) -> bytes:
        """Un ZIP de microdatos con el flujo comprimido corrupto («deflate») o cortado por la mitad («corto»).

        Returns:
            Sus bytes.
        """
        crudo = io.BytesIO()
        with zipfile.ZipFile(crudo, "w", zipfile.ZIP_DEFLATED) as escrito:
            escrito.writestr(FICHERO_CUESTIONARIO, bytes(range(256)) * 200)
        datos = bytearray(crudo.getvalue())
        inicio = 30 + len(FICHERO_CUESTIONARIO)
        if modo == "deflate":
            datos[inicio : inicio + 8] = b"\xff" * 8
            return bytes(datos)
        return bytes(datos[: len(datos) // 2])

    def test_un_original_danado_de_la_candidata_la_detiene_y_la_admitida_sigue(self) -> None:
        """ZIP ilegible, con el deflate corrupto o truncado: la admitida sigue y la candidata queda en «controles»."""
        for datos, nombre in (
            (b"esto no es un zip", "BadZipFile"),
            (self.zip_danado("deflate"), "decompressing"),
            (self.zip_danado("corto"), "BadZipFile"),
        ):
            with self.subTest(error=nombre), tempfile.TemporaryDirectory() as temporal:
                instalacion(Path(temporal) / "originales")
                self.poner_microdatos(Path(temporal) / "originales", datos)
                cerrar, admitida, _ = ejecutar(Path(temporal))
                informe, controles = cerrar.call_args.args[1], cerrar.call_args.args[2]
                self.assertEqual(cerrar.call_count, 1)
                self.assertTrue(controles.admitido, controles.fallidos)
                self.assertEqual(admitida, estado.primera())
                self.assertEqual(informe["candidata_detenida"]["motivo"], "controles")
                self.assertIn(nombre, informe["candidata_detenida"]["detalle"])

    def test_cada_error_de_un_original_danado_detiene_la_candidata_con_controles(self) -> None:
        """`zlib.error`, `EOFError` y `csv.Error` al preparar la candidata: detenida por «controles»."""
        for error in (zlib.error("flujo corrupto"), EOFError("flujo truncado"), csv.Error("fila mal formada")):
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as temporal:
                destino = Path(temporal) / "candidata.json"
                guardar_json(Path(temporal) / "2026" / "procedencia.json", {"anio": "2026", "epa_anio": "2025"})
                procedencia = {"edicion_nueva": OBSERVADA, "candidata": {"edicion": BASE_2026, "archivos": []}}
                candidata.preparar(procedencia, mock.Mock(side_effect=error), Path(temporal), destino)
                detenida = leer_json(destino)["detenida"]
                self.assertEqual(detenida["motivo"], "controles")
                self.assertIn(str(error), detenida["detalle"])

    def test_si_el_ine_corrige_los_microdatos_la_candidata_detenida_se_prepara_y_se_incorpora(self) -> None:
        """Detenida con unos microdatos dañados; con los corregidos y su huella nueva, el mismo ciclo la incorpora."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal) / "originales"
            instalacion(Path(temporal) / "originales")
            bueno = (raiz / "2026" / estado.nombres(BASE_2026).microdatos).read_bytes()
            self.poner_microdatos(raiz, b"esto no es un zip")
            cerrar, admitida, procedencia = ejecutar(Path(temporal))
            self.assertEqual(cerrar.call_args.args[1]["candidata_detenida"]["motivo"], "controles")
            self.assertEqual(admitida, estado.primera())
            self.poner_microdatos(raiz, bueno)
            cerrar, admitida, procedencia = ejecutar(Path(temporal))
        self.assertTrue(cerrar.call_args.args[2].admitido)
        self.assertEqual((cerrar.call_args.args[3]()["anio"], admitida["anio"]), ("2026", "2026"))
        self.assertNotIn("candidata", procedencia)

    def test_una_validacion_de_la_candidata_que_lanza_la_detiene_sin_abortar_la_admitida(self) -> None:
        """Un `ErrorFuente` o un `ValueError` al validar con sus datos: «controles»."""
        procedencia = {"edicion_nueva": OBSERVADA, "candidata": {"edicion": BASE_2026, "archivos": []}}
        with tempfile.TemporaryDirectory() as temporal:
            preparada = Path(temporal) / "candidata.json"
            guardar_json(preparada, {"anio": "2026", "archivos": [], "preparado": {}, "publicadas": {}})
            for error in (FormatoInesperado("sin forma"), ValueError("ilegible"), KeyError("falta")):
                with self.subTest(error=type(error).__name__):
                    detenida = candidata.validar(procedencia, mock.Mock(side_effect=error), preparada)
                    self.assertEqual(detenida["motivo"], "controles")
                    self.assertIn(type(error).__name__, detenida["detalle"])

    def test_un_grupo_que_pasa_a_la_clase_contraria_la_detiene_y_a_sin_clase_se_declara(self) -> None:
        """El 21, no manual en 2025: manual en 2026 detiene por controles; mitad y mitad se incorpora y se declara."""
        with tempfile.TemporaryDirectory() as temporal:
            instalacion(Path(temporal) / "originales", clases_del_21=("1",))
            cerrar, admitida, _ = ejecutar(Path(temporal))
        informe = cerrar.call_args.args[1]
        self.assertEqual(admitida, estado.primera())
        self.assertEqual(informe["candidata_detenida"]["motivo"], "controles")
        self.assertIn("pasan ['21']", informe["candidata_detenida"]["detalle"])
        with tempfile.TemporaryDirectory() as temporal:
            instalacion(Path(temporal) / "originales", clases_del_21=("1", "6"))
            cerrar, admitida, _ = ejecutar(Path(temporal))
        informe, controles, conjunto = cerrar.call_args.args[1], cerrar.call_args.args[2], cerrar.call_args.args[3]()
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertEqual(admitida["anio"], "2026")
        self.assertEqual(conjunto["grupos_sin_clase"], ["21", "52"])
        self.assertEqual(informe["cambios_de_clase"]["a_sin_clase"], ["21"])


class PruebaFormaDeLaCandidata(unittest.TestCase):
    """La detención y la candidata tienen forma cerrada; lo preparado tiene que ser de la candidata registrada."""

    def test_cada_motivo_de_la_lista_y_nada_mas(self) -> None:
        """Las partes solo con «enunciado-distinto», en el orden de `PARTES`; otro motivo se rechaza."""
        self.assertEqual(
            candidata.detencion("enunciado-distinto", "d", ["codigos", "pregunta"])["partes"], ["pregunta", "codigos"]
        )
        self.assertEqual(candidata.detencion("tablas", "d"), {"motivo": "tablas", "detalle": "d"})
        self.assertEqual(candidata.detencion("controles", "d"), {"motivo": "controles", "detalle": "d"})
        for motivo, partes in (("enunciado-distinto", []), ("controles", ["periodo"]), ("otro", []), ("e", ["x"])):
            with self.subTest(motivo=motivo), self.assertRaises(FormatoInesperado):
                candidata.detencion(motivo, "d", partes)  # type: ignore[arg-type]
        with self.assertRaises(FormatoInesperado):
            candidata.base_valida({**BASE_2026, "anios_medidos": ["2026", "2025"]})

    def test_sin_candidata_no_hay_nada_que_preparar_ni_validar(self) -> None:
        """Sin observación pendiente, o con la candidata de otro año, la admitida sigue como siempre."""
        for procedencia in (
            {},
            {"candidata": {"edicion": BASE_2026, "archivos": []}},
            {"edicion_nueva": {**OBSERVADA, "anio": "2027"}, "candidata": {"edicion": BASE_2026, "archivos": []}},
        ):
            with self.subTest(procedencia=procedencia):
                self.assertIsNone(candidata.de_la_procedencia(procedencia))
                self.assertIsNone(candidata.validar(procedencia, mock.Mock(side_effect=AssertionError)))

    def test_lo_preparado_de_otra_candidata_no_se_valida(self) -> None:
        """Si las huellas de sus originales no son las registradas, hay que repetir preparar."""
        procedencia = {"edicion_nueva": OBSERVADA, "candidata": {"edicion": BASE_2026, "archivos": [{"a": 1}]}}
        with tempfile.TemporaryDirectory() as temporal:
            preparada = Path(temporal) / "candidata.json"
            guardar_json(preparada, {"anio": "2026", "archivos": [], "detenida": {"motivo": "tablas", "detalle": ""}})
            with self.assertRaisesRegex(FormatoInesperado, "repetir preparar"):
                candidata.validar(procedencia, mock.Mock(), preparada)


class PruebaPanelDeLaCandidata(unittest.TestCase):
    """El panel y el recibo dan la edición nueva detenida con su motivo, y se detienen si el año no se cruza."""

    def panel(self, informe: dict[str, Any] | None, validado_anio: str = "2025", anio_estado: str = "2025") -> dict:
        """Los campos del panel de la TIC-H en una instalación con 2026 observada y la validación dada.

        Returns:
            Los campos.
        """
        cuerpo = catalogo(2026, 2026).encode()
        procedencia = {
            "archivos": [],
            "edicion": edicion_del_catalogo(cuerpo.decode()),
            "edicion_nueva": {**OBSERVADA, "sha256_catalogo": sha256_bytes(cuerpo)},
            "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo)}],
        }
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            originales = raiz / DATOS_RELATIVOS / "originales" / "tich"
            validados = raiz / DATOS_RELATIVOS / "validados" / "tich"
            guardar_json(originales / "procedencia.json", procedencia)
            guardar_json(validados / "tich.json", {"anio": validado_anio})
            if anio_estado != "2025":
                estado.guardar({**BASE_2026, **LEIDO_DE_2026, "anio": anio_estado}, validados / "edicion.json")
            if informe is not None:
                guardar_json(validados / "validacion.json", informe)
            return campos_del_panel(raiz, "tich", datetime(2026, 11, 15, 6, tzinfo=UTC))

    def test_la_detencion_de_la_validacion_admitida_llega_al_panel_con_su_motivo(self) -> None:
        """«detenida-por-controles» con «enunciado-distinto» y sus partes; sin validación admitida, pendiente."""
        detenida = {"estado": "detenida-por-controles", "anio": "2026", "motivo": "enunciado-distinto"}
        admitido = {"estado": "Admitido", "candidata_detenida": {**detenida, "partes": ["periodo"], "detalle": "x"}}
        nueva = self.panel(admitido)["edicionNueva"]
        self.assertEqual(
            (nueva["estado"], nueva["motivo"], nueva["partes"]), (detenida["estado"], detenida["motivo"], ["periodo"])
        )
        for informe in (None, {**admitido, "estado": "Con errores"}, {"estado": "Admitido"}):
            with self.subTest(informe=informe):
                self.assertEqual(self.panel(informe)["edicionNueva"]["estado"], "pendiente-de-incorporar")
        for mal in ({**detenida, "motivo": "otro"}, detenida, {**detenida, "motivo": "tablas", "partes": ["periodo"]}):
            with self.subTest(mal=mal):
                self.assertEqual(
                    self.panel({"estado": "Admitido", "candidata_detenida": mal}), {"avisoEdicion": NO_VERIFICABLE}
                )

    def test_el_anio_del_estado_tiene_que_ser_el_del_conjunto_validado(self) -> None:
        """Estado en 2026 y conjunto en 2025: el panel no da la edición nueva y lo dice."""
        self.assertEqual(self.panel(None, "2025", "2026"), {"avisoEdicion": "edicion-no-coincide"})
        self.assertEqual(self.panel(None, "2026", "2026"), {"avisoEdicion": NO_VERIFICABLE})

    def test_el_panel_cuenta_los_grupos_sin_clase_y_el_recibo_lo_exige_positivo(self) -> None:
        """Solo viaja con algún grupo sin clase en la TIC-H validada; en el recibo, un entero positivo."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            validados = raiz / DATOS_RELATIVOS / "validados" / "tich"
            for grupos, esperado in ((["51", "52"], {"gruposSinClase": 2}), ([], {})):
                with self.subTest(grupos=grupos):
                    guardar_json(validados / "tich.json", {"anio": "2025", "grupos_sin_clase": grupos})
                    self.assertEqual(campos_del_panel(raiz, "tich", datetime(2026, 11, 15, tzinfo=UTC)), esperado)
        comprobar_en_el_recibo({"politica": "edición", "gruposSinClase": 2}, "2026-11-15T06:00:00Z")
        for mala in ({"politica": "edición", "gruposSinClase": 0}, {"politica": "diaria", "gruposSinClase": 1}):
            with self.subTest(mala=mala), self.assertRaises(AlmacenTrabajoInvalido):
                comprobar_en_el_recibo(mala, "2026-11-15T06:00:00Z")
        self.assertEqual(clave_en_la_fila("fuentes", {"gruposSinClase": 2}), ",gruposSinClase")

    def test_el_recibo_acepta_la_detenida_con_su_motivo_y_nada_mas(self) -> None:
        """Con motivo de la lista y partes solo con «enunciado-distinto»; cualquier otra forma se rechaza."""
        nueva = {
            "estado": "detenida-por-controles",
            "anio": "2026",
            "observadoEn": "2026-11-15T03:00:00Z",
            "huellaCatalogo": "a" * 64,
            "motivo": "controles",
        }
        for buena in (nueva, {**nueva, "motivo": "enunciado-distinto", "partes": ["pregunta", "codigos"]}):
            comprobar_en_el_recibo({"politica": "edición", "edicionNueva": buena}, "2026-11-15T06:00:00Z")
        for mala in (
            {**nueva, "motivo": "otro"},
            {**nueva, "partes": ["periodo"]},
            {**nueva, "motivo": "enunciado-distinto", "partes": ["codigos", "pregunta"]},
            {**nueva, "estado": "pendiente-de-incorporar"},
        ):
            with self.subTest(mala=mala), self.assertRaises(AlmacenTrabajoInvalido):
                comprobar_en_el_recibo({"politica": "edición", "edicionNueva": mala}, "2026-11-15T06:00:00Z")


class PruebaContratoDelPanelEnLosDosLados(unittest.TestCase):
    """Las listas cerradas del panel son las mismas en Python y en el lector del panel web (edicion-nueva-datos.js)."""

    def test_estados_motivos_partes_y_avisos_coinciden(self) -> None:
        """Cada lista, con sus valores y en su orden; un valor que solo esté en un lado haría fallar el panel."""
        fuente = (Path(__file__).parents[3] / "src" / "administracion" / "edicion-nueva-datos.js").read_text("utf-8")

        def lista(nombre: str) -> list[str]:
            cuerpo = re.search(rf"const {nombre} = \[(.*?)\];", fuente, re.DOTALL)
            self.assertIsNotNone(cuerpo, nombre)
            valores = [v.strip() for v in cuerpo.group(1).split(",") if v.strip()] if cuerpo else []
            # Un valor sin comillas es una constante del mismo archivo (`DESCARTADA`): se lee su texto.
            constantes = dict(re.findall(r"const ([A-Z]+) = '([^']+)';", fuente))
            return [v.strip("'") if v.startswith("'") else constantes[v] for v in valores]

        self.assertEqual(lista("ESTADOS_EDICION_NUEVA"), list(ediciones_observadas.ESTADOS_PANEL))
        self.assertEqual(lista("MOTIVOS_DETENCION"), list(candidata.MOTIVOS))
        self.assertEqual(lista("PARTES_ENUNCIADO"), list(PARTES))
        self.assertEqual(lista("AVISOS_EDICION"), list(ediciones_observadas.AVISOS_PANEL))


if __name__ == "__main__":
    unittest.main()
