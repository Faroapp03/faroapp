"""Plan temporal de Idescat y contratos de cada cuerpo HTTP original, sin red real."""

import copy
import math
import unittest
from typing import Any
from unittest import mock

import plataforma_datos.mercado.fuentes.ocupados.lector as ocupados
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.mercado.pruebas.test_ocupados_actualizable import tabla


def metadatos(anios: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """Construye las cuatro tablas sin valores con el alcance fijo y sus tamaños oficiales.

    Returns:
        Metadatos sintéticos por nombre de original.
    """
    documentos = {}
    for numero, archivo in enumerate(ocupados.METADATOS_IDESCAT):
        dimension, territorios = (
            ("CAT", ["TOTAL"]),
            ("CAT", ["TOTAL"]),
            ("COM", list(ocupados.COMARCAS_DE_LA_ZONA)),
            ("MUN", list(ocupados.MUNICIPIOS)),
        )[numero]
        contenido = tabla(anios)
        contenido["updated"] = f"{max(2026, int(anios[-1]))}-05-13"
        contenido["id"][1] = dimension
        contenido["dimension"].pop("CAT")
        contenido["dimension"][dimension] = {"category": {"index": territorios}}
        grupos = [f"A{grupo:03d}" for grupo in range(172)] if numero == 0 else [f"A{grupo:02d}" for grupo in range(64)]
        contenido["dimension"]["OCC_2011"]["category"]["index"] = grupos
        contenido["size"] = [len(anios), len(territorios), len(grupos), 3, 1]
        contenido["value"] = []
        documentos[archivo["archivo"]] = contenido
    return documentos


def cuerpo_parte(meta: dict[str, Any], anios: tuple[str, ...]) -> dict[str, Any]:
    """Una respuesta filtrada de Taules conserva el método aplicable a los años solicitados.

    Returns:
        JSON-stat con los valores de una parte.
    """
    contenido = copy.deepcopy(meta)
    contenido["dimension"]["YEAR"]["category"]["index"] = list(anios)
    contenido["size"][0] = len(anios)
    contenido["value"] = [150] * math.prod(contenido["size"])
    if "2021" not in anios:
        fuente = "Idescat, a partir del Censo de población anual del INE."
        contenido["source"] = fuente
        contenido["extension"]["source"] = [fuente]
    elif len(anios) == 1:
        fuente = "Idescat, a partir del Censo de población y viviendas del INE."
        contenido["source"] = fuente
        contenido["extension"]["source"] = [fuente]
    else:
        anual = anios[1] if len(anios[1:]) == 1 else f"{anios[1]}-{anios[-1]}"
        fuentes = [
            "2021: Idescat, a partir del Censo de población y viviendas del INE.",
            f"{anual}: Idescat, a partir del Censo de población anual del INE.",
        ]
        contenido["source"] = " ".join(fuentes)
        contenido["extension"]["source"] = fuentes
    return contenido


class PruebaPlanPartesOcupados(unittest.TestCase):
    """La capacidad se calcula con categorías reales y no omite años para encajar en el límite."""

    def test_tres_cuatro_cinco_y_treinta_nueve_anios(self) -> None:
        """Cinco años requieren dos partes municipales; el calendario no tiene un techo fijo."""
        for cantidad, esperadas in ((3, 4), (4, 4), (5, 5), (39, 14)):
            anios = tuple(str(anio) for anio in range(2021, 2021 + cantidad))
            documentos = metadatos(anios)
            previo = copy.deepcopy(documentos)
            partes = ocupados.planificar_partes(documentos)
            with self.subTest(cantidad=cantidad):
                self.assertEqual(len(partes), esperadas)
                self.assertEqual(documentos, previo)
                municipales = [parte for parte in partes if "municipios" in parte["archivo"]]
                cubiertos = [anio for parte in municipales for anio in parte["url"].split("&YEAR=")[1].split(",")]
                self.assertEqual(cubiertos, list(anios))
                for parte in municipales:
                    self.assertLessEqual(len(parte["url"].split("&YEAR=")[1].split(",")), 4)
                self.assertTrue(all(parte["archivo"].endswith(".json") for parte in partes))
                self.assertEqual(ocupados.planificar_partes(dict(reversed(list(documentos.items())))), partes)

    def test_metadatos_no_pueden_ocultar_dimensiones_o_cambiar_geografia(self) -> None:
        """La proyección fija no se amplía ni se reduce para eludir la partición."""
        base = metadatos(("2021", "2022", "2023", "2024", "2025"))
        casos = []
        cambio = copy.deepcopy(base)
        cambio.pop(next(iter(cambio)))
        casos.append(cambio)
        cambio = copy.deepcopy(base)
        cambio["extra.json"] = next(iter(cambio.values()))
        casos.append(cambio)
        nombre = ocupados.METADATOS_IDESCAT[-1]["archivo"]
        for clave in ("YEAR", "MUN", "SEX"):
            cambio = copy.deepcopy(base)
            cambio[nombre]["dimension"][clave]["category"]["index"].pop()
            casos.append(cambio)
        for campo, valor in (("dimension", []), ("extension", [])):
            cambio = copy.deepcopy(base)
            cambio[nombre][campo] = valor
            casos.append(cambio)
        cambio = copy.deepcopy(base)
        cambio[nombre]["dimension"]["MUN"]["category"] = []
        casos.append(cambio)
        cambio = copy.deepcopy(base)
        cambio[nombre]["size"][-1] = True
        casos.append(cambio)
        cambio = copy.deepcopy(base)
        cambio[nombre]["value"] = [1]
        casos.append(cambio)
        cambio = copy.deepcopy(base)
        cambio[nombre]["id"].append("AGE")
        casos.append(cambio)
        cambio = copy.deepcopy(base)
        cambio[nombre]["size"][2] += 1
        casos.append(cambio)
        for documentos in casos:
            with self.subTest(documentos=documentos), self.assertRaises(FormatoInesperado):
                ocupados.planificar_partes(documentos)

    def test_un_anio_no_cabe_requiere_revision_sin_recortar(self) -> None:
        """Una tabla incompatible no se parte por grupos ni se declara completa silenciosamente."""
        documentos = metadatos(("2021", "2022", "2023"))
        nombre = ocupados.METADATOS_IDESCAT[-1]["archivo"]
        grupos = [f"{letra}{numero:02d}" for letra in "ABCDE" for numero in range(100)]
        for archivo in ocupados.METADATOS_IDESCAT[1:]:
            documentos[archivo["archivo"]]["dimension"]["OCC_2011"]["category"]["index"] = grupos
            documentos[archivo["archivo"]]["size"][2] = len(grupos)
        with self.assertRaisesRegex(FormatoInesperado, "un año.*20.000|20.000.*un año"):
            ocupados.planificar_partes(documentos)
        self.assertEqual(documentos[nombre]["dimension"]["YEAR"]["category"]["index"], ["2021", "2022", "2023"])

    def test_partes_solo_anuales_y_decenales_no_se_presentan_como_serie_completa(self) -> None:
        """El método filtrado del organismo se valida por los años realmente solicitados."""
        import plataforma_datos.mercado.fuentes.ocupados.piezas.ocupados_idescat as ocupados_idescat

        documentos = metadatos(("2021", "2022", "2023", "2024", "2025"))
        meta = documentos[ocupados.METADATOS_IDESCAT[-1]["archivo"]]
        for anios in (("2021",), ("2022", "2023"), ("2025",), ("2021", "2022", "2023", "2024")):
            ocupados_idescat.comprobar_parte(cuerpo_parte(meta, anios), meta, anios)
        cambio = cuerpo_parte(meta, ("2025",))
        cambio["source"] = "Idescat, a partir del Censo de población y viviendas del INE."
        cambio["extension"]["source"] = [cambio["source"]]
        with self.assertRaises(FormatoInesperado):
            ocupados_idescat.comprobar_parte(cambio, meta, ("2025",))

    def test_parte_con_year_ajeno_incompleta_duplicada_o_desfasada_se_rechaza(self) -> None:
        """El plan no admite otra selección, cuerpo truncado o revisión distinta de sus metadatos."""
        import plataforma_datos.mercado.fuentes.ocupados.piezas.ocupados_idescat as ocupados_idescat

        documentos = metadatos(("2021", "2022", "2023", "2024", "2025"))
        meta = documentos[ocupados.METADATOS_IDESCAT[-1]["archivo"]]
        anios = ("2025",)
        casos = []
        cambio = cuerpo_parte(meta, ("2024",))
        casos.append(cambio)
        cambio = cuerpo_parte(meta, anios)
        cambio["value"].pop()
        casos.append(cambio)
        cambio = cuerpo_parte(meta, anios)
        cambio["updated"] = "2026-05-14"
        casos.append(cambio)
        cambio = cuerpo_parte(meta, anios)
        cambio["dimension"]["MUN"]["category"]["index"].pop()
        casos.append(cambio)
        for contenido in casos:
            with self.subTest(contenido=contenido), self.assertRaises(FormatoInesperado):
                ocupados_idescat.comprobar_parte(contenido, meta, anios)

    def test_lector_legado_solo_admite_sus_siete_originales_explicitos(self) -> None:
        """Una captura antigua sigue preparable y no absorbe otras partes del directorio."""
        procedencia = {"archivos": copy.deepcopy(ocupados.ARCHIVOS)}
        with mock.patch.object(ocupados, "leer_json", return_value=procedencia):
            self.assertEqual(ocupados._captura_idescat(), (None, []))
        procedencia["archivos"].append({**ocupados.ARCHIVOS[0], "archivo": "idescat-17980-cataluna-2021-2023.json"})
        with mock.patch.object(ocupados, "leer_json", return_value=procedencia), self.assertRaises(FormatoInesperado):
            ocupados._captura_idescat()

    def test_modalidad_nueva_exige_marcador_y_plan_exacto(self) -> None:
        """No interpreta marcas ambiguas ni una selección incompleta como una nueva captura completa."""
        for marcador in (None, False, True, "1", 1.0, 2):
            with (
                self.subTest(marcador=marcador),
                mock.patch.object(ocupados, "leer_json", return_value={ocupados.IDESCAT_PARTES: marcador}),
                self.assertRaisesRegex(FormatoInesperado, "modalidad"),
            ):
                ocupados._captura_idescat()
        documentos = metadatos(("2021", "2022", "2023", "2024", "2025"))
        partes = ocupados.planificar_partes(documentos)
        archivos = [*ocupados.METADATOS_IDESCAT, *partes, *ocupados.ARCHIVOS_AUXILIARES]
        procedencia = {ocupados.IDESCAT_PARTES: 1, "archivos": archivos}
        with (
            mock.patch.object(ocupados, "original", side_effect=lambda _, nombre: nombre),
            mock.patch.object(
                ocupados,
                "leer_json",
                side_effect=lambda ruta: procedencia if ruta == ocupados.PROCEDENCIA else documentos[ruta],
            ),
        ):
            self.assertEqual(ocupados._captura_idescat(), (documentos, partes))
            archivos.pop()
            with self.assertRaisesRegex(FormatoInesperado, "inventario incompleto"):
                ocupados._captura_idescat()


if __name__ == "__main__":
    unittest.main()
