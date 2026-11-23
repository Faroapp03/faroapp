"""De punta a punta con el material real: cada edición se prepara desde la carpeta de su año y cuadra con su tabla.

Lee los microdatos reales fuera del repositorio y no escribe nunca en ellos (trabaja sobre copias):

- `FARO_EVIDENCIAS_TICH`: la carpeta con `datos_2026.zip` y `eurostat-2025.json`;
- `FARO_MICRODATOS_TICH_2025`: el ZIP de microdatos de 2025;
- `FARO_INSTALACION_TICH`: la raíz de una instalación con los originales de 2025 sueltos en `originales/tich/` y las
  clasificaciones validadas.

Sin ellas, se omiten con su motivo. Las tablas publicadas, y la metodología y el cuestionario de 2026, son las capturas
del repositorio. Cada edición carga sus microdatos una vez por prueba. La edición admitida no lee un PDF: toma de su
estado lo que dicen sus documentos; solo la candidata lee los suyos.
"""

import io
import json
import os
import shutil
import tempfile
import unittest
import zipfile
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import comprobar_originales, guardar_json, leer_json, sha256
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, Controles, Descarga
from plataforma_datos.ia_y_trabajo.fuentes.tich import candidata
from plataforma_datos.ia_y_trabajo.fuentes.tich import documentos_de_la_edicion as documentos
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import FICHERO_CUESTIONARIO

EVIDENCIAS = os.environ.get("FARO_EVIDENCIAS_TICH", "")
MICRODATOS_2025 = os.environ.get("FARO_MICRODATOS_TICH_2025", "")
INSTALACION = os.environ.get("FARO_INSTALACION_TICH", "")
MOTIVO = "sin FARO_EVIDENCIAS_TICH y FARO_MICRODATOS_TICH_2025: los microdatos reales no viven en el repositorio"
MOTIVO_INSTALACION = "sin FARO_INSTALACION_TICH: no hay una instalación real con los originales de 2025 sueltos"
CAPTURAS = Path(__file__).parent / "datos" / "ine-tich"
EDICIONES = {
    "2025": estado.primera(),
    "2026": {
        **estado.primera(),
        "anio": "2026",
        "anios_medidos": ["2025", "2026"],
        "tablas": {"uso": "82804", "errores": "82907"},
        "documentos": {
            "metodologia": "0d90a3e3ef9cfcd29bd3a0982bd17ad707e1fdd57ea046b008a279adb610ede2",
            "cuestionario": "2172bcb98f59fb8b6b3e5867fecfbfa53f234318a3d86f7359fa2ff4a11d8290",
        },
    },
}


def originales(carpeta: Path, edicion: estado.Edicion) -> None:
    """Deja los originales reales de una edición en la carpeta de su año, con su procedencia y la de la operación."""
    evidencias = Path(EVIDENCIAS)
    nombres = estado.nombres(edicion)
    origen = {
        nombres.microdatos: Path(MICRODATOS_2025) if edicion["anio"] == "2025" else evidencias / "datos_2026.zip",
        nombres.uso: CAPTURAS / f"{edicion['tablas']['uso']}.csv",
        nombres.errores: CAPTURAS / f"{edicion['tablas']['errores']}.csv",
        nombres.epa: evidencias / f"eurostat-{edicion['epa_anio']}.json",
    }
    del_anio = estado.carpeta(edicion, carpeta)
    del_anio.mkdir(parents=True)
    registros = []
    for nombre, ruta in origen.items():
        shutil.copyfile(ruta, del_anio / nombre)
        registros.append({"archivo": nombre, "sha256": sha256(del_anio / nombre)})
    guardar_json(del_anio / "procedencia.json", {"anio": edicion["anio"], "archivos": registros})
    guardar_json(carpeta / "procedencia.json", {"archivos": estado.en_la_operacion(edicion, registros)})


def aislada(parches: ExitStack, temporal: Path, carpeta: Path, ruta_estado: Path) -> None:
    """Dirige la fuente a una instalación temporal y hace fallar cualquier lectura de PDF."""
    sin_pdf = AssertionError("la edición admitida no lee sus PDF")
    for objetivo, nombre, valor in (
        (tich, "ORIGINAL", carpeta),
        (tich, "PROCEDENCIA", carpeta / "procedencia.json"),
        (tich, "ESTADO_EDICION", ruta_estado),
        (tich, "ESTIMACIONES", temporal / "estimaciones.json"),
        (tich, "PUBLICADAS", temporal / "publicadas.json"),
    ):
        parches.enter_context(mock.patch.object(objetivo, nombre, valor))
    parches.enter_context(
        mock.patch.object(tich, "comprobar_originales", lambda fuente: comprobar_originales(fuente, carpeta))
    )
    parches.enter_context(mock.patch.object(documentos, "texto_del_pdf", side_effect=sin_pdf))
    parches.enter_context(mock.patch.object(documentos, "secciones_en_muestra", side_effect=sin_pdf))
    parches.enter_context(mock.patch("builtins.print"))


@unittest.skipUnless(EVIDENCIAS and MICRODATOS_2025, MOTIVO)
class PruebaEdicionesReales(unittest.TestCase):
    """2025 y 2026, cada una desde su carpeta, con la base de 16 a 74 años: cuadran con 76444 y 82804."""

    def test_cada_edicion_cuadra_con_su_tabla_de_uso_sin_leer_sus_pdf(self) -> None:
        """Población exacta y % al decimal en los tres grupos; las secciones y las huellas, las de su estado."""
        for anio, edicion in EDICIONES.items():
            with self.subTest(anio=anio), tempfile.TemporaryDirectory() as temporal, ExitStack() as parches:
                carpeta, ruta_estado = Path(temporal) / "originales", Path(temporal) / "edicion.json"
                originales(carpeta, estado.valida(edicion))
                estado.guardar(estado.valida(edicion), ruta_estado)
                aislada(parches, Path(temporal), carpeta, ruta_estado)
                tich.preparar()
                preparado = leer_json(Path(temporal) / "estimaciones.json")
                publicadas = leer_json(Path(temporal) / "publicadas.json")
            controles = Controles()
            tich._controles_publicadas(controles, preparado["estimaciones"], publicadas)
            self.assertEqual(len(controles.lista), 3)
            self.assertTrue(controles.admitido, controles.fallidos)
            self.assertEqual(preparado["edicion"], estado.valida(edicion))
            self.assertEqual(
                (preparado["secciones_en_muestra"]["espana"], preparado["secciones_en_muestra"]["cataluna"]),
                (2500, 216),
            )
            self.assertEqual(preparado["enunciado"]["diferencias"], [])
            self.assertEqual(len(publicadas["errores"]), 18)


@unittest.skipUnless(INSTALACION, MOTIVO_INSTALACION)
class PruebaInstalacionRecienMigrada(unittest.TestCase):
    """Con los originales de 2025 sueltos y sin red: migra, prepara y valida 2025 sin pedir ningún documento."""

    def test_migra_prepara_y_valida_2025_sin_red_ni_pdf(self) -> None:
        """Copias con su huella, 2025 admitida con sus controles y el estado escrito con 2.500 y 216 secciones."""
        instalacion = Path(INSTALACION) / DATOS_RELATIVOS
        clasificaciones = leer_json(instalacion / "validados" / "clasificaciones" / "clasificaciones.json")
        with tempfile.TemporaryDirectory() as temporal, ExitStack() as parches:
            carpeta, ruta_estado = Path(temporal) / "originales", Path(temporal) / "edicion.json"
            shutil.copytree(instalacion / "originales" / "tich", carpeta)
            aislada(parches, Path(temporal), carpeta, ruta_estado)
            parches.enter_context(mock.patch.object(tich, "leer_validado", return_value=clasificaciones))
            cerrar = parches.enter_context(mock.patch.object(tich, "cerrar_validacion"))
            tich.preparar()
            tich.validar()
            migrada = (carpeta / "2025" / "procedencia.json").exists()
            operacion = leer_json(carpeta / "procedencia.json")
            admitida = estado.leer(ruta_estado)
        informe, controles, conjunto = cerrar.call_args.args[1], cerrar.call_args.args[2], cerrar.call_args.args[3]()
        self.assertTrue(migrada)
        self.assertTrue(all(entrada["archivo"].startswith("2025/") for entrada in operacion["archivos"]))
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertEqual((conjunto["anio"], conjunto["anios_medidos"]), ("2025", ["2025"]))
        self.assertEqual(
            (informe["secciones_en_muestra"]["espana"], informe["secciones_en_muestra"]["cataluna"]), (2500, 216)
        )
        self.assertEqual(admitida, estado.primera())


def con_el_periodo_cambiado(microdatos: Path) -> bytes:
    """Los microdatos de 2026 con otro periodo en la descripción de `IAG` de su diseño de registro.

    Returns:
        El ZIP, con el resto de sus bytes de dentro tal cual.
    """
    nombres = estado.nombres(CANDIDATA)
    with zipfile.ZipFile(microdatos) as externo:
        interno = zipfile.ZipFile(io.BytesIO(externo.read(FICHERO_CUESTIONARIO)))
    salida_interna = io.BytesIO()
    with interno, zipfile.ZipFile(salida_interna, "w", zipfile.ZIP_DEFLATED) as nuevo:
        for miembro in interno.namelist():
            datos = interno.read(miembro)
            if miembro == nombres.diseno:
                diseno = json.loads(datos)
                for campo in diseno["layout"]:
                    if campo.get("name") == "IAG":
                        campo["description"] = campo["description"].replace("3 meses", "6 meses")
                datos = json.dumps(diseno, ensure_ascii=False).encode()
            nuevo.writestr(miembro, datos)
    salida = io.BytesIO()
    with zipfile.ZipFile(salida, "w") as externo:
        externo.writestr(FICHERO_CUESTIONARIO, salida_interna.getvalue())
    return salida.getvalue()


# La candidata de 2026 tal como la registra la descarga: con la EPA de 2025, la que Eurostat tiene publicada.
CANDIDATA = {
    "anio": "2026",
    "anios_medidos": ["2025", "2026"],
    "tablas": {"uso": "82804", "errores": "82907"},
    "epa_anio": "2025",
}


def respuestas(microdatos_2026: bytes) -> dict[str, bytes]:
    """Lo que responde el INE y Eurostat en la consulta, sin red: las capturas reales, por su dirección.

    Returns:
        {dirección: bytes}.
    """
    evidencias = Path(EVIDENCIAS)
    capturas = json.loads((CAPTURAS / "procedencia.json").read_text(encoding="utf-8"))["archivos"]
    epa = estado.archivos(estado.primera())[3]["url"]
    return {
        **{archivo["url"]: (CAPTURAS / archivo["archivo"]).read_bytes() for archivo in capturas},
        "https://www.ine.es/ftp/microdatos/tich/datos_2025.zip": Path(MICRODATOS_2025).read_bytes(),
        "https://www.ine.es/ftp/microdatos/tich/datos_2026.zip": microdatos_2026,
        epa: (evidencias / "eurostat-2025.json").read_bytes(),
        epa.replace("time=2025", "time=2026"): (evidencias / "eurostat-2026.json").read_bytes(),
    }


def descargar_sin_red(carpeta: Path, microdatos_2026: bytes) -> list[str]:
    """La consulta entera contra las capturas: la admitida, la observación, la navegación y la candidata.

    Returns:
        Las direcciones pedidas, en orden.
    """
    servidas = respuestas(microdatos_2026)

    def responder(url: str, *_: object, **__: object) -> Descarga:
        return Descarga(servidas[url], url, "application/octet-stream")

    with (
        mock.patch.object(tich, "ORIGINAL", carpeta),
        mock.patch.object(tich, "PROCEDENCIA", carpeta / "procedencia.json"),
        mock.patch.object(red, "descargar_url", side_effect=responder) as consultar,
        mock.patch.object(tich.time, "sleep"),
        mock.patch("builtins.print"),
    ):
        carpeta.mkdir(parents=True)
        tich.descargar(aceptar_cambio=False)
    return [llamada.args[0] for llamada in consultar.call_args_list]


def con_la_candidata(parches: ExitStack, temporal: Path, carpeta: Path) -> mock.Mock:
    """Dirige la fuente a la instalación temporal, con las clasificaciones reales y el cierre registrado.

    Returns:
        El cierre de la validación.
    """
    clasificaciones = leer_json(
        Path(INSTALACION) / DATOS_RELATIVOS / "validados" / "clasificaciones" / "clasificaciones.json"
    )
    for nombre, valor in (
        ("ORIGINAL", carpeta),
        ("PROCEDENCIA", carpeta / "procedencia.json"),
        ("ESTADO_EDICION", temporal / "edicion.json"),
        ("ESTIMACIONES", temporal / "estimaciones.json"),
        ("PUBLICADAS", temporal / "publicadas.json"),
        ("PREPARADA", temporal / "candidata.json"),
    ):
        parches.enter_context(mock.patch.object(tich, nombre, valor))
    parches.enter_context(
        mock.patch.object(tich, "comprobar_originales", lambda fuente: comprobar_originales(fuente, carpeta))
    )
    parches.enter_context(mock.patch.object(tich, "leer_validado", return_value=clasificaciones))
    parches.enter_context(mock.patch("builtins.print"))
    return parches.enter_context(mock.patch.object(tich, "cerrar_validacion"))


@unittest.skipUnless(EVIDENCIAS and MICRODATOS_2025 and INSTALACION, f"{MOTIVO}; {MOTIVO_INSTALACION}")
class PruebaIncorporacionReal(unittest.TestCase):
    """De punta a punta con las capturas: 2026 se incorpora; con otro periodo, queda detenida y sigue 2025."""

    def recorrer(self) -> dict:
        """Los dos caminos, cada uno con su consulta, su preparación y su validación.

        Returns:
            Lo que deja cada paso.
        """
        microdatos_2026 = (Path(EVIDENCIAS) / "datos_2026.zip").read_bytes()
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            pedidas = descargar_sin_red(raiz / "uno", microdatos_2026)
            descargada = leer_json(raiz / "uno" / "procedencia.json")
            with ExitStack() as parches:
                cerrar = con_la_candidata(parches, raiz, raiz / "uno")
                tich.preparar()
                admitida_preparada = leer_json(raiz / "estimaciones.json")
                publicadas_2025 = leer_json(raiz / "publicadas.json")
                preparada_2026 = leer_json(raiz / "candidata.json")
                tich.validar()
                incorporada = (cerrar.call_args.args[1], cerrar.call_args.args[2], cerrar.call_args.args[3]())
            final = (estado.leer(raiz / "edicion.json"), leer_json(raiz / "uno" / "procedencia.json"))
            descargar_sin_red(raiz / "dos", con_el_periodo_cambiado(Path(EVIDENCIAS) / "datos_2026.zip"))
            (raiz / "edicion.json").write_text(json.dumps(estado.primera()), encoding="utf-8")
            guardar_json(raiz / "estimaciones.json", admitida_preparada)
            guardar_json(raiz / "publicadas.json", publicadas_2025)
            with ExitStack() as segundos:
                cerrar = con_la_candidata(segundos, raiz, raiz / "dos")
                procedencia_dos = leer_json(raiz / "dos" / "procedencia.json")
                candidata.preparar(procedencia_dos, tich._preparar_edicion, raiz / "dos", raiz / "candidata.json")
                tich.validar()
                detenida = (cerrar.call_args.args[1], cerrar.call_args.args[3](), estado.leer(raiz / "edicion.json"))
        return {
            "pedidas": pedidas,
            "descargada": descargada,
            "admitida_preparada": admitida_preparada,
            "publicadas_2025": publicadas_2025,
            "preparada_2026": preparada_2026,
            "incorporada": incorporada,
            "final": final,
            "detenida": detenida,
        }

    def test_2026_se_incorpora_y_con_otro_periodo_queda_detenida(self) -> None:
        """Una carga de los microdatos de cada edición: la preparación de 2025 se comparte entre los dos caminos."""
        vuelta = self.recorrer()
        pedidas, descargada, preparada_2026 = vuelta["pedidas"], vuelta["descargada"], vuelta["preparada_2026"]
        admitida_preparada, publicadas_2025 = vuelta["admitida_preparada"], vuelta["publicadas_2025"]
        self.assertIn("https://www.ine.es/ftp/microdatos/tich/datos_2026.zip", pedidas)
        self.assertEqual(len(pedidas), len(set(pedidas)))
        self.assertEqual(len(descargada["candidata"]["archivos"]), 6)
        for anio, preparado, publicadas in (
            ("2026", preparada_2026["preparado"], preparada_2026["publicadas"]),
            ("2025", admitida_preparada, publicadas_2025),
        ):
            with self.subTest(anio=anio):
                contraste = Controles()
                tich._controles_publicadas(contraste, preparado["estimaciones"], publicadas)
                self.assertEqual(len(contraste.lista), 3)
                self.assertTrue(contraste.admitido, contraste.fallidos)
        informe, controles, conjunto = vuelta["incorporada"]
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertEqual((conjunto["anio"], conjunto["anios_medidos"]), ("2026", ["2025", "2026"]))
        self.assertNotIn("edicion_nueva", conjunto)
        admitida, operacion = vuelta["final"]
        self.assertEqual((admitida["anio"], admitida["secciones"]), ("2026", {"espana": 2500, "cataluna": 216}))
        self.assertNotIn("edicion_nueva", operacion)
        self.assertTrue(all(entrada["archivo"].startswith("2026/") for entrada in operacion["archivos"]))
        self.assertEqual(conjunto["grupos_sin_clase"], [])
        self.assertEqual(sorted(informe["grupos_con_las_dos_clases"]), ["51", "52"])
        # De 2025 a 2026 ningún grupo pasa a la clase contraria ni queda sin clase.
        self.assertEqual(informe["cambios_de_clase"], {"clase_contraria": [], "a_sin_clase": [], "desde_sin_clase": []})
        self.assertTrue(all(conjunto["clase_por_isco2"][g] == "no_manual" for g in ("51", "52")))
        # La evidencia que pide la entrega: el reparto de los grupos con las dos clases en cada edición y el grupo 4.
        print(
            json.dumps(
                {
                    "con_las_dos_clases_2026": informe["grupos_con_las_dos_clases"],
                    "cambios_de_clase": informe["cambios_de_clase"],
                    "esos_grupos_en_2025": {
                        g: admitida_preparada["clases_por_isco2"][g] for g in informe["grupos_con_las_dos_clases"]
                    },
                    "grupo_4": {
                        "espana": conjunto["espana_isco1"].get("4"),
                        "cataluna": conjunto["cataluna_isco1"].get("4"),
                    },
                },
                ensure_ascii=False,
            )
        )
        informe, conjunto, admitida = vuelta["detenida"]
        self.assertEqual((conjunto["anio"], conjunto["anios_medidos"], admitida), ("2025", ["2025"], estado.primera()))
        self.assertEqual(
            (informe["candidata_detenida"]["motivo"], informe["candidata_detenida"]["partes"]),
            ("enunciado-distinto", ["periodo"]),
        )


if __name__ == "__main__":
    unittest.main()
