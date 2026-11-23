"""Comarcas del Idescat y temarios oficiales de la hoja de ruta: lectura literal, rechazo de lo dañado y manifiesto."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.comun.nucleo import PAQUETE, ArchivoFaltante, FormatoInesperado, HuellaIncorrecta
from plataforma_datos.cursos.fuentes.hoja_de_ruta import lector as hoja_de_ruta

CABECERA = "﻿Municipis \nInstitut d'Estadística de Catalunya\nhttps://www.idescat.cat/codis/?id=50&n=9\n"


def lista_del_idescat(filas: list[str]) -> str:
    """Una lista de municipios con la forma del archivo del Idescat.

    Returns:
        El texto del archivo.
    """
    return CABECERA + hoja_de_ruta.CABECERA_MUNICIPIOS + "\n" + "\n".join(filas) + "\n"


class PruebaComarcas(unittest.TestCase):
    """La tabla municipio → comarca sale entera y comprobada de la lista del Idescat."""

    def test_rechaza_una_lista_incompleta_o_con_codigos_raros(self) -> None:
        """Con dos municipios no llega a 947; un código de 5 cifras o fuera de Cataluña, tampoco pasa."""
        with self.assertRaises(FormatoInesperado):
            hoja_de_ruta.comarcas_de(lista_del_idescat(["080018;Abrera;11;Baix Llobregat;"]))
        with self.assertRaises(FormatoInesperado):
            hoja_de_ruta.comarcas_de(lista_del_idescat(["08001;Abrera;11;Baix Llobregat;"]))
        with self.assertRaises(FormatoInesperado):
            hoja_de_ruta.comarcas_de(lista_del_idescat(["280018;Abrera;11;Baix Llobregat;"]))

    def test_el_paquete_tiene_los_947_municipios_y_las_43_comarcas(self) -> None:
        """datos/comarcas.json: cada municipio con una comarca conocida; Cornellà, en el Baix Llobregat."""
        comarcas = json.loads((PAQUETE / "comarcas.json").read_text(encoding="utf-8"))
        self.assertEqual(len(comarcas["municipios"]), 947)
        self.assertEqual(len(comarcas["comarcas"]), 43)
        self.assertTrue(all(m[2] in comarcas["comarcas"] for m in comarcas["municipios"]))
        cornella = next(m for m in comarcas["municipios"] if m[1] == "Cornellà de Llobregat")
        self.assertEqual(comarcas["comarcas"][cornella[2]], "Baix Llobregat")
        self.assertIn("Idescat", comarcas["licencia"])
        self.assertEqual(comarcas["consultado"], "2026-10-21")

    def test_las_equivalencias_del_paquete_salen_de_la_lista(self) -> None:
        """«Palamós» → 171181 para cualquier fuente; «Cornellà» → 080734 solo para Citilab; cada una con su motivo."""
        comarcas = json.loads((PAQUETE / "comarcas.json").read_text(encoding="utf-8"))
        codigos = {m[0]: m for m in comarcas["municipios"]}
        resumen = [(e["nombre"], e["codigo"], e.get("fuenteDelCurso"), e["idescat"]) for e in comarcas["equivalencias"]]
        self.assertEqual(
            resumen,
            [
                ("Palamós", "171181", None, "Palamós i Sant Joan"),
                ("Cornellà", "080734", "citilab", "Cornellà de Llobregat"),
            ],
        )
        self.assertEqual(comarcas["comarcas"][codigos["171181"][2]], "Baix Empordà")
        self.assertEqual(comarcas["comarcas"][codigos["080734"][2]], "Baix Llobregat")
        self.assertTrue(all(e["motivo"] and e["fuente"] for e in comarcas["equivalencias"]))

    def test_rechaza_equivalencias_que_la_lista_no_sostiene(self) -> None:
        """Un nombre ambiguo sin limitarlo a una fuente, un código que no es de ese nombre o un nombre que ya está."""
        municipios = [
            ["080734", "Cornellà de Llobregat", "11"],
            ["170561", "Cornellà del Terri", "28"],
            ["171181", "Palamós i Sant Joan", "10"],
        ]
        base = {"motivo": "m", "fuente": "f"}
        comprobar = hoja_de_ruta.equivalencia_comprobada
        with self.assertRaises(FormatoInesperado):
            comprobar({**base, "nombre": "Cornellà", "codigo": "080734"}, municipios)
        with self.assertRaises(FormatoInesperado):
            comprobar({**base, "nombre": "Palamós", "codigo": "080734"}, municipios)
        with self.assertRaises(FormatoInesperado):
            comprobar({**base, "nombre": "Palamós", "codigo": "171181", "fuenteDelCurso": "citilab"}, municipios)
        with self.assertRaises(FormatoInesperado):
            comprobar({**base, "nombre": "Cornellà del Terri", "codigo": "170561"}, municipios)
        with self.assertRaises(FormatoInesperado):
            comprobar({"nombre": "Palamós", "codigo": "171181", "motivo": "", "fuente": "f"}, municipios)
        bien = comprobar({**base, "nombre": "Cornellà", "codigo": "080734", "fuenteDelCurso": "citilab"}, municipios)
        self.assertEqual(bien["idescat"], "Cornellà de Llobregat")


SEPE = (
    "Objetivo general Analizar con capacidad crítica las situaciones de desigualdad. Relación de módulos de formación "
    "Módulo 1 Sindicalismo e igualdad 7 horas Módulo 2 Las reivindicaciones sindicales 8 horas Modalidad de "
    "impartición Presencial Teleformación"
)
CONSORCI = (
    "Objectiu general Analitzar els elements de la jurisdicció social bàsica. Relació de mòduls de formació Mòdul 1 "
    "La legislació social 11 hores Mòdul 2 Modalitats processals (I) 11 hores Mòdul 3 Comprovació en planta de "
    "tots els gràf … RESULTATS 5 hores"
)
FUNDAE = "CONTENIDOS FORMATIVOS: 1. FUNCIONES. 1.1. Anidar funciones. 2. BASES DE DATOS. 2.1. Filtros. 3. VIST"


class PruebaTemarios(unittest.TestCase):
    """El objetivo y los módulos se copian literales, en su idioma, y sin lo que el extracto deja a medias."""

    def test_ficha_del_sepe_entera_y_literal(self) -> None:
        """Objetivo y módulos tal cual; la lista llega a la modalidad: está completa."""
        temario = hoja_de_ruta.temario_de(SEPE, "SEPE")
        self.assertEqual(
            temario,
            {
                "objetivo": "Analizar con capacidad crítica las situaciones de desigualdad.",
                "modulos": ["Sindicalismo e igualdad", "Las reivindicaciones sindicales"],
                "modulosCompletos": True,
                "idioma": "es",
            },
        )

    def test_ficha_del_consorci_en_catalan_sin_el_modulo_cortado(self) -> None:
        """«Modalitats processals» no cierra la lista; el módulo cortado por «…» no entra."""
        temario = hoja_de_ruta.temario_de(CONSORCI, "Consorci")
        assert temario is not None
        self.assertEqual(temario["idioma"], "ca")
        self.assertEqual(temario["modulos"], ["La legislació social", "Modalitats processals (I)"])
        self.assertFalse(temario["modulosCompletos"])

    def test_fundae_sin_objetivo_y_sin_el_ultimo_apartado(self) -> None:
        """Los apartados de primer nivel, sin el último (puede estar cortado); sin objetivo general."""
        temario = hoja_de_ruta.temario_de(FUNDAE, "FUNDAE")
        assert temario is not None
        self.assertIsNone(temario["objetivo"])
        self.assertEqual(temario["modulos"], ["FUNCIONES", "BASES DE DATOS"])

    def test_sin_objetivo_ni_modulos_no_hay_temario(self) -> None:
        """Un extracto de equipamientos no da «Qué aprenderás»."""
        self.assertIsNone(hoja_de_ruta.temario_de("Las instalaciones y equipamientos deberán cumplir…", "SEPE"))

    def test_exige_la_procedencia_de_cada_extracto(self) -> None:
        """Un extracto sin su fila en textos.jsonl no se acepta: no se inventa su fuente."""
        with self.assertRaises(FormatoInesperado):
            hoja_de_ruta.temarios_de({"ADGD0001": SEPE}, [], "2026-10-21")

    def test_el_temario_lleva_su_fuente_y_su_fecha(self) -> None:
        """Cada temario, con el organismo, la dirección de su ficha y el día de la consulta."""
        fichas = [{"codigo": "ADGD0001", "fuente": "SEPE", "url": "https://sede.sepe.gob.es/x/ADGD0001.pdf"}]
        temarios = hoja_de_ruta.temarios_de({"ADGD0001": SEPE}, fichas, "2026-10-21")
        self.assertEqual(
            temarios["temarios"]["ADGD0001"]["fuente"],
            {"organismo": "SEPE", "url": "https://sede.sepe.gob.es/x/ADGD0001.pdf"},
        )
        self.assertEqual(temarios["temarios"]["ADGD0001"]["consultado"], "2026-10-21")

    def test_el_paquete_tiene_temarios_con_texto_de_su_extracto(self) -> None:
        """datos/temarios.json: cientos de temarios; cada objetivo está, palabra por palabra, en su extracto."""
        temarios = json.loads((PAQUETE / "temarios.json").read_text(encoding="utf-8"))["temarios"]
        self.assertGreater(len(temarios), 400)
        extractos = json.loads(hoja_de_ruta.EXTRACTOS.read_text(encoding="utf-8"))
        for codigo, temario in temarios.items():
            limpio = " ".join(extractos[codigo].split())
            if temario["objetivo"]:
                self.assertIn(temario["objetivo"], limpio, codigo)
            for modulo in temario["modulos"]:
                self.assertIn(modulo, limpio, codigo)


class PruebaManifiesto(unittest.TestCase):
    """Cada archivo va al manifiesto con su huella y la de sus orígenes."""

    def test_escribe_y_comprueba_la_entrada(self) -> None:
        """Escribir deja el archivo y su entrada; comprobar los da por buenos; con otro contenido, no."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            origen = carpeta / "origen.txt"
            origen.write_text("hola", encoding="utf-8")
            (carpeta / "manifiesto.json").write_text('{"oit.json": {"origenes": {}, "sha256": "x"}}', encoding="utf-8")
            hoja_de_ruta.escribir("comarcas.json", {"a": 1}, [origen], carpeta)
            manifiesto = json.loads((carpeta / "manifiesto.json").read_text(encoding="utf-8"))
            self.assertEqual(manifiesto["comarcas.json"]["sha256"], sha256(carpeta / "comarcas.json"))
            self.assertEqual(list(manifiesto["comarcas.json"]["origenes"].values()), [sha256(origen)])
            self.assertTrue(next(iter(manifiesto["comarcas.json"]["origenes"])).endswith("origen.txt"))
            self.assertIn("oit.json", manifiesto)
            self.assertTrue(hoja_de_ruta.escribir("comarcas.json", {"a": 1}, [origen], carpeta, comprobar=True))
            self.assertFalse(hoja_de_ruta.escribir("comarcas.json", {"a": 2}, [origen], carpeta, comprobar=True))

    def test_el_paquete_esta_al_dia(self) -> None:
        """Las entradas de datos/manifiesto.json coinciden con los archivos (solo archivos locales y huellas)."""
        manifiesto = json.loads((PAQUETE / "manifiesto.json").read_text(encoding="utf-8"))
        for nombre in ("comarcas.json", "temarios.json"):
            self.assertEqual(manifiesto[nombre]["sha256"], sha256(PAQUETE / nombre))
        self.assertTrue(hoja_de_ruta.paso_comarcas(comprobar=True))
        self.assertTrue(hoja_de_ruta.paso_temarios(comprobar=True))


class PruebaEntradasFijadas(unittest.TestCase):
    """Una entrada alterada o ausente nunca pasa la comprobación."""

    def test_temarios_rechaza_cada_entrada_alterada_o_ausente(self) -> None:
        """Las tres huellas se exigen incluso en modo de solo comprobación."""
        with tempfile.TemporaryDirectory() as temporal:
            for nombre in ("EXTRACTOS", "TEXTOS", "PROCEDENCIA"):
                ruta = Path(temporal) / getattr(hoja_de_ruta, nombre).name
                with self.subTest(nombre=nombre), mock.patch.object(hoja_de_ruta, nombre, ruta):
                    with self.assertRaises(ArchivoFaltante):
                        hoja_de_ruta.paso_temarios(comprobar=True)
                    ruta.write_text("{}", encoding="utf-8")
                    with self.assertRaises(HuellaIncorrecta):
                        hoja_de_ruta.paso_temarios(comprobar=True)


if __name__ == "__main__":
    unittest.main()
