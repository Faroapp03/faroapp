"""ACTIC con entradas sintéticas: tabla, preparación, validación y contrato del conjunto."""

import copy
import hashlib
import io
import tempfile
import unittest
from collections.abc import Callable, Iterable, Iterator
from contextlib import ExitStack, contextmanager, redirect_stdout
from pathlib import Path
from typing import Any
from unittest.mock import patch

import plataforma_datos.cursos.fuentes.actic.lector as actic
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import ArchivoDescargable, ErrorFuente

FECHA_CONSULTA = "2026-10-07T00:00:00+00:00"


def procedencia_sintetica() -> dict[str, Any]:
    """Describe cinco originales locales; los metadatos normativos proceden de la tabla declarada.

    Returns:
        La procedencia independiente de capturas o rutas operativas.
    """
    registros = []
    for archivo in actic.ARCHIVOS:
        contenido = contenido_sintetico(archivo["archivo"])
        registros.append(
            {
                **copy.deepcopy(archivo),
                "sha256": hashlib.sha256(contenido).hexdigest(),
                "descargado_utc": FECHA_CONSULTA,
            }
        )
    return {"archivos": registros}


def contenido_sintetico(nombre: str) -> bytes:
    """Reúne los pasajes declarados en texto plano para PDF y HTML para el portal.

    Returns:
        Los bytes del original sintético.
    """
    texto = "\n".join(actic.pasajes_buscados()[nombre])
    if nombre.endswith(".html"):
        texto = f'<html><meta charset="utf-8"><body><p>{texto}</p></body></html>'
    return texto.encode()


@contextmanager
def entorno_sintetico() -> Iterator[tuple[Path, dict[str, Any]]]:
    """Aísla las rutas y el extractor PDF; HTML, huellas y cierre de validación son reales.

    Yields:
        La raíz temporal y su procedencia.
    """
    with tempfile.TemporaryDirectory() as temporal, ExitStack() as pila:
        raiz = Path(temporal)
        datos = raiz / "var" / "actualizacion"
        original = datos / "originales" / actic.FUENTE
        preparado = datos / "preparados" / actic.FUENTE
        original.mkdir(parents=True)
        escribir_entero = entrada_salida.escribir_entero_creando_carpeta

        def escribir_aislado(ruta: Path, partes: Iterable[str]) -> None:
            if not ruta.resolve().is_relative_to(raiz.resolve()):
                raise AssertionError(f"El fixture ACTIC impide escribir fuera del temporal: {ruta}")
            escribir_entero(ruta, partes)

        pila.enter_context(
            patch.object(entrada_salida, "escribir_entero_creando_carpeta", side_effect=escribir_aislado)
        )
        for nombre, valor in (
            ("ORIGINALES", datos / "originales"),
            ("PREPARADOS", datos / "preparados"),
            ("VALIDADOS", datos / "validados"),
        ):
            pila.enter_context(patch.object(entrada_salida, nombre, valor))
        for nombre, valor in (
            ("ORIGINAL", original),
            ("PREPARADO", preparado),
            ("PROCEDENCIA", original / "procedencia.json"),
            ("PASAJES_LEIDOS", preparado / "pasajes.json"),
        ):
            pila.enter_context(patch.object(actic, nombre, valor))
        pila.enter_context(
            patch.object(actic.pdf, "texto", side_effect=lambda contenido: contenido.decode().splitlines())
        )
        pila.enter_context(redirect_stdout(io.StringIO()))
        procedencia = procedencia_sintetica()
        for entrada in procedencia["archivos"]:
            (original / entrada["archivo"]).write_bytes(contenido_sintetico(entrada["archivo"]))
        guardar_json(actic.PROCEDENCIA, procedencia)
        guardar_json(actic.PASAJES_LEIDOS, actic.pasajes_buscados())
        yield raiz, procedencia


class PruebaActic(unittest.TestCase):
    """Los ocho contratos nominales se ejecutan sin originales ni preparados operativos."""

    def test_tres_niveles_y_cinco_areas(self) -> None:
        """La tabla transcrita conserva los tres niveles y las 19 competencias del modelo declarado."""
        self.assertEqual([nivel["clave"] for nivel in actic.NIVELES], ["basico", "medio", "avanzado"])
        self.assertEqual([area.numero for area in actic.AREAS], [1, 2, 3, 4, 5])
        self.assertEqual([len(area.competencias) for area in actic.AREAS], [3, 3, 4, 5, 4])

    def test_un_pasaje_que_falta_se_nombra(self) -> None:
        """Cada duración ausente se identifica con su archivo y texto."""
        leidos = actic.pasajes_buscados()
        quitados = [pasaje for pasaje in leidos[actic.NORMAS] if "120 minuts" in pasaje]
        leidos[actic.NORMAS] = [pasaje for pasaje in leidos[actic.NORMAS] if pasaje not in quitados]
        self.assertEqual(actic.pasajes_que_faltan(leidos), [f"{actic.NORMAS}: «{pasaje}»" for pasaje in quitados])

    def test_cada_pasaje_apunta_a_un_original_declarado(self) -> None:
        """Todos los pasajes citan un original y la publicación procede de las disposiciones declaradas."""
        self.assertEqual(set(actic.PASAJES), {archivo["archivo"] for archivo in actic.ARCHIVOS})
        self.assertEqual(actic.PUBLICADO, "2026-07-21")

    def test_direcciones_eli_de_las_disposiciones(self) -> None:
        """Las direcciones ELI conservan las fechas y los números declarados."""
        urls = [archivo["url"] for archivo in actic.ARCHIVOS if "norma" in archivo]
        self.assertEqual(
            urls,
            [
                "https://portaljuridic.gencat.cat/eli/es-ct/o/2026/03/17/emt47/dof/cat/pdf",
                "https://portaljuridic.gencat.cat/eli/es-ct/o/2026/03/17/emt48/dof/cat/pdf",
                "https://portaljuridic.gencat.cat/eli/es-ct/o/2026/07/10/emt136/dof/cat/pdf",
            ],
        )

    def test_una_pagina_que_solo_cambia_de_plantilla_es_la_misma(self) -> None:
        """La descarga usa texto para HTML y bytes para PDF, sin aceptar cambios del texto visible."""
        antes = b"<html><head><script>var t=1;</script></head><body><p>No caduca.</p></body></html>"
        ahora = b"<html><head><script>var t=2;</script></head><body><p>No   caduca.</p></body></html>"

        registros = procedencia_sintetica()["archivos"]

        def descargar(
            archivos: list[ArchivoDescargable],
            carpeta: Path,
            aceptar_cambio: bool,
            equivalentes: Callable[[ArchivoDescargable], Callable[[bytes, bytes], bool] | None],
        ) -> list[dict[str, Any]]:
            for archivo in archivos:
                igual = equivalentes(archivo)
                if archivo["archivo"].endswith(".pdf"):
                    self.assertIsNone(igual)
                else:
                    self.assertIsNotNone(igual)
                    if igual is not None:
                        self.assertTrue(igual(antes, ahora))
                        self.assertFalse(igual(antes, b"<html><body><p>Caduca.</p></body></html>"))
            return registros

        with entorno_sintetico(), patch.object(actic, "descargar_originales", side_effect=descargar):
            actic.descargar()
            self.assertEqual(leer_json(actic.PROCEDENCIA)["archivos"], registros)

    def test_el_conjunto_versionado(self) -> None:
        """El conjunto validado es el reconstruido y conserva el contrato que consume formación transversal."""
        with entorno_sintetico() as (raiz, procedencia):
            actic.validar()
            conjunto = leer_json(raiz / "var/actualizacion/validados/actic/actic.json")
            self.assertEqual(conjunto, actic.conjunto(procedencia))
        self.assertEqual([nivel["clave"] for nivel in conjunto["niveles"]], ["basico", "medio", "avanzado"])
        self.assertEqual([nivel["minutos"] for nivel in conjunto["niveles"]], [120, 120, 120])
        self.assertIsNone(conjunto["prueba"]["tasa_importe"])
        self.assertIn("desempleo", conjunto["prueba"]["exencion"])
        self.assertEqual(conjunto["modelo"]["vigente_desde"], "2026-09-15")
        self.assertEqual([entrada["dogc"] for entrada in conjunto["disposiciones"]], ["9634", "9634", "9712"])
        for entrada in conjunto["disposiciones"]:
            self.assertRegex(entrada["sha256"], r"^[0-9a-f]{64}$")

    def test_preparar_reproduce_los_preparados(self) -> None:
        """Las cinco entradas sintéticas reproducen todos los pasajes buscados byte a byte."""
        with entorno_sintetico():
            esperado = actic.PASAJES_LEIDOS.read_bytes()
            actic.preparar()
            self.assertEqual(actic.PASAJES_LEIDOS.read_bytes(), esperado)


class PruebaAreas(unittest.TestCase):
    """Las áreas se publican con campos legibles."""

    def test_cada_area_lleva_su_numero_y_sus_competencias(self) -> None:
        """El conjunto conserva el número, los nombres y las competencias de cada área."""
        conjunto = actic.conjunto(procedencia_sintetica())
        self.assertEqual(
            conjunto["areas"],
            [
                {"area": area.numero, "ca": area.ca, "es": area.es, "competencias_ca": area.competencias}
                for area in actic.AREAS
            ],
        )


class PruebaRegresiones(unittest.TestCase):
    """Las entradas defectuosas se rechazan con motivo y los pasajes usan la misma normalización."""

    def test_con_todos_los_pasajes_no_falta_ninguno(self) -> None:
        """Los pasajes completos no producen ausencias."""
        self.assertEqual(actic.pasajes_que_faltan(actic.pasajes_buscados()), [])

    def test_la_guarda_del_fixture_impide_cualquier_salida_fuera_del_temporal(self) -> None:
        """Una ruta de salida mal parcheada se detiene antes de escribir en el disco exterior."""
        with (
            entorno_sintetico() as (raiz, _),
            patch.object(actic, "PASAJES_LEIDOS", raiz.parent / "fuera-actic.json"),
            self.assertRaisesRegex(AssertionError, "impide escribir fuera del temporal"),
        ):
            actic.preparar()

    def test_las_comillas_y_espacios_del_pasaje_se_normalizan(self) -> None:
        """Un pasaje con comillas curvas y espacios repetidos se busca igual que el texto del original."""
        pasaje = "L’acreditació  diu “no caduca”"
        texto = actic.texto_del_original(
            "pagina.html", '<meta charset="utf-8"><p>L\'acreditació diu "no caduca"</p>'.encode()
        )
        with patch.object(actic, "PASAJES", {actic.NORMAS: [pasaje]}), patch.object(actic, "AREAS", []):
            self.assertEqual(actic.pasajes_encontrados({actic.NORMAS: texto}), {actic.NORMAS: [pasaje]})

    def test_los_metadatos_normativos_incompletos_no_se_admiten(self) -> None:
        """Una huella válida no acredita una disposición cuyo DOGC o fecha se han vaciado."""
        for campo in ("fecha", "dogc", "publicado", "cve"):
            with self.subTest(campo=campo), entorno_sintetico() as (raiz, procedencia):
                procedencia["archivos"][0]["norma"][campo] = ""
                guardar_json(actic.PROCEDENCIA, procedencia)
                with self.assertRaisesRegex(ErrorFuente, "dogc-emt47-2026.pdf"):
                    actic.validar()
                self.assertFalse((raiz / "var/actualizacion/validados/actic/actic.json").exists())

    def test_una_procedencia_que_no_es_objeto_se_rechaza_con_motivo(self) -> None:
        """La raíz JSON de otro tipo no escapa como AttributeError ni publica ningún conjunto."""
        for contenido in (None, [], "procedencia", 1):
            with self.subTest(contenido=contenido), entorno_sintetico() as (raiz, _):
                guardar_json(actic.PROCEDENCIA, contenido)
                with self.assertRaisesRegex(ErrorFuente, "procedencia.*objeto"):
                    actic.validar()
                self.assertFalse((raiz / "var/actualizacion/validados/actic/actic.json").exists())

    def test_una_pagina_no_declara_una_norma_nula(self) -> None:
        """Una página sin disposición no puede aportar norma:null y romper la composición del conjunto."""
        with entorno_sintetico() as (raiz, procedencia):
            procedencia["archivos"][-1]["norma"] = None
            guardar_json(actic.PROCEDENCIA, procedencia)
            with self.assertRaisesRegex(ErrorFuente, "actic-competencies-nivells.html"):
                actic.validar()
            self.assertFalse((raiz / "var/actualizacion/validados/actic/actic.json").exists())

    def test_tres_disposiciones_duplicadas_no_sustituyen_las_declaradas(self) -> None:
        """Repetir la primera disposición no permite omitir las otras dos aunque el recuento siga siendo tres."""
        with entorno_sintetico() as (raiz, procedencia):
            procedencia["archivos"][:3] = [copy.deepcopy(procedencia["archivos"][0]) for _ in range(3)]
            guardar_json(actic.PROCEDENCIA, procedencia)
            with self.assertRaisesRegex(ErrorFuente, "procedencia"):
                actic.validar()
            self.assertFalse((raiz / "var/actualizacion/validados/actic/actic.json").exists())

    def test_un_pasaje_ausente_impide_publicar_el_conjunto(self) -> None:
        """El validador real rechaza el preparado incompleto y deja informe con el pasaje ausente."""
        with entorno_sintetico() as (raiz, _):
            leidos = actic.pasajes_buscados()
            faltante = leidos[actic.NORMAS].pop()
            guardar_json(actic.PASAJES_LEIDOS, leidos)
            with self.assertRaisesRegex(ErrorFuente, faltante):
                actic.validar()
            self.assertFalse((raiz / "var/actualizacion/validados/actic/actic.json").exists())


if __name__ == "__main__":
    unittest.main()
