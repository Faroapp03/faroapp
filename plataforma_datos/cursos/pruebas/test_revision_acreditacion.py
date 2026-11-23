"""Pruebas de las relaciones admitidas y la procedencia de su revisión."""

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.fuentes.acreditacion.lector as acreditacion
import plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes as constantes
from plataforma_datos.comun.nucleo import ArchivoFaltante, Controles, ErrorFuente
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    CABECERA_DE_LA_REVISION,
    HUELLA_DE_LA_REGLA,
    REGLA_DE_LA_REVISION,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.relacion_con_ocupaciones import Cadena, Relaciones
from plataforma_datos.cursos.fuentes.acreditacion.piezas.revision import (
    CABECERA_DE_LAS_DESCARTADAS,
    Revision,
    faltas_de_procedencia,
    leer_admitidas,
    leer_descartadas_en_la_revision,
    lo_que_se_ensena,
    procedencia_de_la_revision,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.validacion import controles_de_revision
from plataforma_datos.cursos.pruebas.ejemplos_acreditacion import REGLA_DE_EJEMPLO, fila_admitida, lista_de_ejemplo


class PruebaRevision(unittest.TestCase):
    """Relaciones admitidas dentro del catálogo, con procedencia; los descartes de la revisión mandan."""

    def setUp(self) -> None:
        """Una carpeta temporal para las listas inventadas."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name)

    def leer(self, filas: list[dict[str, str]], **opciones: object) -> dict[tuple[str, str], object]:
        """Lee una lista inventada con la huella de la regla de ejemplo.

        Returns:
            Parejas (ocupación ESCO, certificado) admitidas, con la procedencia de su revisión.
        """
        ruta = lista_de_ejemplo(self.carpeta, filas, opciones.pop("cabecera", None))
        return leer_admitidas(ruta, opciones.pop("regla", REGLA_DE_EJEMPLO))

    def rechaza(self, filas: list[dict[str, str]], motivo: str, **opciones: object) -> None:
        """La lectura falla y el mensaje dice el motivo."""
        with self.assertRaises(ErrorFuente) as error:
            self.leer(filas, **opciones)
        self.assertIn(motivo, str(error.exception))

    def test_sin_lista_no_se_exporta_ninguna_relacion(self) -> None:
        """Sin el archivo, la lectura falla con un mensaje que dice qué falta y que no se enseña nada sin revisar."""
        with self.assertRaises(ArchivoFaltante) as error:
            leer_admitidas(self.carpeta / "admitidas.tsv", REGLA_DE_EJEMPLO)
        self.assertIn("admitidas.tsv", str(error.exception))
        self.assertIn("sin revisar", str(error.exception))

    def test_validar_sin_lista_falla_antes_de_escribir_nada(self) -> None:
        """La validación lee la lista lo primero: sin ella no calcula ni guarda ningún conjunto."""
        with (
            mock.patch.object(acreditacion, "ADMITIDAS", self.carpeta / "admitidas.tsv"),
            mock.patch.object(acreditacion, "cerrar_validacion") as cerrar,
            mock.patch.object(acreditacion, "leer_jsonl") as leer,
            self.assertRaises(ArchivoFaltante),
        ):
            acreditacion.validar()
        cerrar.assert_not_called()
        leer.assert_not_called()

    def test_sin_huella_fijada_no_se_lee(self) -> None:
        """Si el código no fija la huella de la regla, ninguna lista vale."""
        self.rechaza([fila_admitida("4311.1", "ADGD0308")], "HUELLA_DE_LA_REGLA", regla=None)

    def test_la_huella_fijada_es_la_de_la_decision(self) -> None:
        """La huella del código es la del documento que decide la regla, tal como está: si cambia, falla."""
        documento = REGLA_DE_LA_REVISION.read_bytes()
        self.assertEqual(constantes.HUELLA_DE_LA_REGLA, hashlib.sha256(documento).hexdigest())

    def test_guia_operativa_separa_la_norma_sin_renovar_la_regla(self) -> None:
        """Las rutas operativas apuntan a la misma norma fijada; no modifican las firmas de las listas."""
        norma = constantes.RAIZ / "docs" / "acreditacion" / "norma-fijada.md"
        self.assertEqual(REGLA_DE_LA_REVISION, norma)
        self.assertEqual(
            hashlib.sha256(norma.read_bytes()).hexdigest(),
            "a141f1b2c9ff92acc6b19845549c79a92a2ead02ea2d403040a64bbd779d56c8",
        )
        guia = (constantes.RAIZ / "docs" / "regla-de-la-acreditacion.md").read_text(encoding="utf-8")
        self.assertIn("(acreditacion/norma-fijada.md)", guia)
        self.assertIn("var/actualizacion/revisiones/acreditacion/admitidas.tsv", guia)
        self.assertNotEqual(hashlib.sha256(guia.encode()).hexdigest(), HUELLA_DE_LA_REGLA)

    def test_lee_la_lista(self) -> None:
        """Cada pareja admitida, con la fecha de la decisión, la huella de la regla y su id; tres C de cuatro bastan."""
        admitidas = self.leer(
            [fila_admitida("4311.1", "ADGD0308"), fila_admitida("4311.2", "ADGD0308", "CDCC", id="R-00000ff")]
        )
        self.assertEqual(
            admitidas,
            {
                ("4311.1", "ADGD0308"): Revision(
                    "2026-10-20", REGLA_DE_EJEMPLO[:12], "R-0a1b2c3", frozenset({"VIGENTE-ocupacion"})
                ),
                ("4311.2", "ADGD0308"): Revision(
                    "2026-10-20", REGLA_DE_EJEMPLO[:12], "R-00000ff", frozenset({"VIGENTE-ocupacion"})
                ),
            },
        )

    def test_una_sola_fecha(self) -> None:
        """La fecha de cada fila es la de la decisión: una lista con dos fechas no se lee."""
        otra = fila_admitida("4311.2", "ADGD0308", fecha="2026-10-21", id="R-00000ff")
        self.rechaza([fila_admitida("4311.1", "ADGD0308"), otra], "fecha")

    def test_cabecera_distinta(self) -> None:
        """Una lista con otras columnas no se lee, aunque sus filas parezcan buenas."""
        cabecera = tuple(columna for columna in CABECERA_DE_LA_REVISION if columna != "en_la_cadena")
        self.rechaza([fila_admitida("4311.1", "ADGD0308")], "cabecera", cabecera=cabecera)

    def test_huella_de_otra_regla(self) -> None:
        """Una fila hecha con otra regla hace fallar la lista entera."""
        otra = fila_admitida("4311.2", "ADGD0308", regla_sha256="70a2c702cb69")
        self.rechaza([fila_admitida("4311.1", "ADGD0308"), otra], "regla")

    def test_tres_juicios_c_de_cuatro_y_una_cita(self) -> None:
        """Con dos C de cuatro, aunque no haya ninguna X, o sin cita, la fila no vale."""
        for fila in (
            fila_admitida("4311.1", "ADGD0308", "CCDD"),
            fila_admitida("4311.1", "ADGD0308", "XCXC"),
            fila_admitida("4311.1", "ADGD0308", "cccc"),
            fila_admitida("4311.1", "ADGD0308", cita="  "),
        ):
            with self.subTest(fila=fila):
                self.rechaza([fila], "cita")

    def test_filas_que_no_son_admitidas(self) -> None:
        """Una decisión que no es C, una fecha o un id mal formados y una pareja repetida no se aceptan."""
        self.rechaza([fila_admitida("4311.1", "ADGD0308", decision="D")], "decision")
        self.rechaza([fila_admitida("4311.1", "ADGD0308", fecha="20/10/2026")], "fecha")
        self.rechaza([fila_admitida("4311.1", "ADGD0308", id="9a0789")], "id")
        self.rechaza([fila_admitida("4311.1", "ADGD0308")] * 2, "repetida")

    CADENA = Cadena(
        eures={},
        isco_a_cno11={"4311": ["4111"], "5223": ["5220"]},
        ocupaciones={"4311.1": "4311", "4311.2": "4311", "4311.3": "4311", "5223.6": "5223"},
        nombres={},
        genericas=frozenset(),
    )
    PROPUESTAS = Relaciones(
        {
            "4311.1": {"ADGD0308": "ocupacion", "ADGG0408": "grupo"},
            "4311.2": {"ADGD0308": "ocupacion"},
            "4311.3": {"ADGD0308": "grupo"},
            "5223.6": {"AGAJ0110": "grupo", "COMV0108": "grupo"},
        },
        {"4311": {"ADGD0308": "grupo"}, "5223": {"COMV0108": "grupo"}},
    )

    CATALOGO = frozenset({"ADGD0308", "ADGG0408", "AGAJ0110", "COMV0108"})

    def revision(self, *parejas: tuple[str, str], estratos: str = "VIGENTE-ocupacion") -> dict[tuple[str, str], object]:
        """Una revisión inventada que admite estas parejas, todas con la misma fecha y los mismos estratos.

        Returns:
            Revisión de cada pareja.
        """
        return {
            pareja: Revision("2026-10-20", "0123456789ab", f"R-{numero:07x}", frozenset(estratos.split(",")))
            for numero, pareja in enumerate(parejas)
        }

    def ensenar(self, admitidas: dict[tuple[str, str], object]) -> Relaciones:
        """Lo que se enseña con la cadena, las propuestas y el catálogo de ejemplo.

        Returns:
            Relaciones admitidas que se enseñan, sin las descartadas.
        """
        return lo_que_se_ensena(self.CADENA, self.PROPUESTAS, admitidas, self.CATALOGO)

    def test_la_revision_manda(self) -> None:
        """Lo admitido se enseña aunque la cadena no lo proponga; DESCARTADAS manda; fuera del paquete, no."""
        admitidas = {
            **self.revision(("4311.1", "ADGD0308"), ("4311.2", "ADGD0308")),
            **self.revision(("4311.3", "ADGG0408"), estratos="A1"),  # sin proponer, el anexo nombra la ocupación
            **self.revision(("4311.2", "ADGG0408"), estratos="A2,EST"),  # sin proponer, por palabras o variante
            **self.revision(("4311.9", "ADGD0308"), estratos="A1"),  # la ocupación no está en el paquete
            **self.revision(("4311.1", "XXXX0000"), estratos="A1"),  # el certificado no está en el catálogo
            **self.revision(("5223.6", "AGAJ0110")),  # admitida y propuesta, pero en DESCARTADAS
        }
        todas = self.ensenar(admitidas)
        self.assertEqual(
            todas.ocupaciones,
            {
                "4311.1": {"ADGD0308": "ocupacion"},
                "4311.2": {"ADGD0308": "ocupacion", "ADGG0408": "grupo"},
                "4311.3": {"ADGG0408": "ocupacion"},
                "5223.6": {},
            },
        )
        self.assertEqual(todas.grupos, {"4311": {"ADGD0308": "grupo", "ADGG0408": "grupo"}, "5223": {}})
        sin_revision = self.ensenar({})
        self.assertEqual(
            sum(map(len, sin_revision.ocupaciones.values())) + sum(map(len, sin_revision.grupos.values())), 0
        )

    def test_una_propuesta_conserva_el_tipo_de_la_cadena(self) -> None:
        """Si la cadena la propone, la relación es la suya, sean cuales sean los estratos de la revisión."""
        todas = self.ensenar(self.revision(("4311.1", "ADGG0408"), estratos="A1"))
        self.assertEqual(todas.ocupaciones["4311.1"], {"ADGG0408": "grupo"})

    def test_procedencia_de_cada_relacion(self) -> None:
        """La regla, la fecha y la lista, una vez; cada relación de una ocupación, con el id de su fila."""
        admitidas = self.revision(("4311.1", "ADGD0308"), ("4311.2", "ADGD0308"))
        todas = self.ensenar(admitidas)
        procedencia = procedencia_de_la_revision(todas, admitidas)
        self.assertEqual(
            procedencia,
            {
                "regla_sha256": constantes.HUELLA_DE_LA_REGLA,
                "fecha": "2026-10-20",
                "lista": "var/actualizacion/revisiones/acreditacion/admitidas.tsv",
                "ids": {"4311.1": {"ADGD0308": "R-0000000"}, "4311.2": {"ADGD0308": "R-0000001"}},
            },
        )
        relaciones_del_paquete = {
            "ocupaciones": {
                esco: [[codigo, rel] for codigo, rel in lista.items()]
                for esco, lista in todas.ocupaciones.items()
                if lista
            }
        }
        self.assertEqual(faltas_de_procedencia({"relaciones": relaciones_del_paquete, "revision": procedencia}), [])

    def test_sin_procedencia_no_se_exporta(self) -> None:
        """Sin el bloque, con otra regla o con una relación sin id, la exportación tiene algo que decir."""
        relaciones_del_paquete = {"ocupaciones": {"4311.1": [["ADGD0308", "ocupacion"]]}, "grupos": {}}
        buena = {
            "regla_sha256": constantes.HUELLA_DE_LA_REGLA,
            "fecha": "2026-10-20",
            "lista": "var/actualizacion/revisiones/acreditacion/admitidas.tsv",
            "ids": {"4311.1": {"ADGD0308": "R-0000000"}},
        }
        faltas = faltas_de_procedencia
        self.assertEqual(faltas({"relaciones": relaciones_del_paquete, "revision": buena}), [])
        self.assertTrue(faltas({"relaciones": relaciones_del_paquete}))
        self.assertTrue(faltas({"relaciones": relaciones_del_paquete, "revision": {**buena, "regla_sha256": "0" * 64}}))
        self.assertTrue(faltas({"relaciones": relaciones_del_paquete, "revision": {**buena, "fecha": "ayer"}}))
        self.assertIn(
            "4311.1→ADGD0308",
            " ".join(faltas({"relaciones": relaciones_del_paquete, "revision": {**buena, "ids": {}}})),
        )

    def test_control_de_lo_que_se_ensena(self) -> None:
        """Pasa si se enseña justo lo admitido; falla si se cuela una sin admitir o se queda fuera una admitida."""
        admitidas = self.revision(("4311.1", "ADGD0308"), ("4311.2", "ADGD0308"), ("4311.3", "ADGG0408"))
        todas = self.ensenar(admitidas)

        def fallidos(relaciones_ensenadas: Relaciones) -> str:
            """Los controles de la revisión que fallan con estas relaciones, en una línea.

            Returns:
                Textos de los controles que fallan, separados por espacios.
            """
            controles = Controles()
            controles_de_revision(controles, self.CADENA, relaciones_ensenadas, admitidas, self.CATALOGO)
            return " ".join(controles.fallidos)

        self.assertEqual(fallidos(todas), "")
        colada = Relaciones({**todas.ocupaciones, "4311.3": {"ADGD0308": "grupo"}}, todas.grupos)
        self.assertIn("4311.3→ADGD0308", fallidos(colada))
        olvidada = Relaciones({**todas.ocupaciones, "4311.3": {}}, todas.grupos)
        self.assertIn("4311.3→ADGG0408", fallidos(olvidada))


class PruebaContratosDeRevision(unittest.TestCase):
    """Los metadatos dañados se rechazan con su motivo, antes de la exportación."""

    def test_una_fecha_iso_es_un_dia_real_con_cifras_ascii(self) -> None:
        """Ni fechas imposibles ni cifras Unicode pasan la lectura o el control de procedencia."""
        with tempfile.TemporaryDirectory() as carpeta:
            for fecha in ("2026-99-99", "2026-02-29", "0000-01-01", "２０２６-１０-２０", "٢٠٢٦-١٠-٢٠"):
                with self.subTest(fecha=fecha):
                    ruta = lista_de_ejemplo(Path(carpeta), [fila_admitida("4311.1", "ADGD0308", fecha=fecha)])
                    with self.assertRaisesRegex(ErrorFuente, "fecha"):
                        leer_admitidas(ruta, REGLA_DE_EJEMPLO)
                    conjunto = self.conjunto()
                    conjunto["revision"]["fecha"] = fecha
                    self.assertTrue(any("fecha" in falta for falta in faltas_de_procedencia(conjunto)))
            ruta = lista_de_ejemplo(Path(carpeta), [fila_admitida("4311.1", "ADGD0308", fecha="2024-02-29")])
            self.assertEqual(leer_admitidas(ruta, REGLA_DE_EJEMPLO)["4311.1", "ADGD0308"].fecha, "2024-02-29")

    @staticmethod
    def conjunto() -> dict[str, object]:
        """Un conjunto mínimo con procedencia válida.

        Returns:
            El conjunto, independiente en cada llamada.
        """
        return {
            "relaciones": {"ocupaciones": {"4311.1": [["ADGD0308", "ocupacion"]]}},
            "revision": {
                "regla_sha256": constantes.HUELLA_DE_LA_REGLA,
                "fecha": "2026-10-20",
                "lista": "var/actualizacion/revisiones/acreditacion/admitidas.tsv",
                "ids": {"4311.1": {"ADGD0308": "R-0000000"}},
            },
        }

    def test_sin_lista_no_hay_procedencia(self) -> None:
        """La lista es texto no vacío; admite la procedencia de paquetes transferidos."""
        self.assertEqual(faltas_de_procedencia(self.conjunto()), [])
        for lista in (None, "", [], "  "):
            with self.subTest(lista=lista):
                conjunto = self.conjunto()
                conjunto["revision"]["lista"] = lista
                self.assertTrue(any("lista" in falta for falta in faltas_de_procedencia(conjunto)))
        for lista in ("datos/revisiones/acreditacion/admitidas.tsv", "otra.tsv"):
            with self.subTest(lista_transferida=lista):
                conjunto = self.conjunto()
                conjunto["revision"]["lista"] = lista
                self.assertEqual(faltas_de_procedencia(conjunto), [])
        conjunto = self.conjunto()
        del conjunto["revision"]["lista"]
        self.assertTrue(any("lista" in falta for falta in faltas_de_procedencia(conjunto)))

    def test_ids_y_relaciones_dan_motivo_si_no_son_objetos(self) -> None:
        """Un contrato JSON dañado devuelve faltas sin KeyError o AttributeError."""
        for ids in (None, [], "R-0000000", {"4311.1": None}, {"4311.1": []}, {"4311.1": "R-0000000"}):
            with self.subTest(ids=ids):
                conjunto = self.conjunto()
                conjunto["revision"]["ids"] = ids
                self.assertTrue(faltas_de_procedencia(conjunto))
        for relaciones in (None, [], {}, {"ocupaciones": None}, {"ocupaciones": []}):
            with self.subTest(relaciones=relaciones):
                conjunto = self.conjunto()
                conjunto["relaciones"] = relaciones
                self.assertTrue(any("relaciones" in falta for falta in faltas_de_procedencia(conjunto)))
        conjunto = self.conjunto()
        del conjunto["relaciones"]
        self.assertTrue(any("relaciones" in falta for falta in faltas_de_procedencia(conjunto)))

    def test_una_relacion_danada_no_se_exporta(self) -> None:
        """El control devuelve una falta si la lista de relaciones no contiene parejas de cadenas."""
        for lista in (
            None,
            {},
            "ADGD0308",
            [None],
            [["ADGD0308"]],
            [["ADGD0308", "ocupacion", "extra"]],
            [[None, "grupo"]],
        ):
            with self.subTest(lista=lista):
                conjunto = self.conjunto()
                conjunto["relaciones"]["ocupaciones"]["4311.1"] = lista
                self.assertTrue(any("relaciones" in falta for falta in faltas_de_procedencia(conjunto)))


class PruebaFormaDeLasListas(unittest.TestCase):
    """Las listas de la revisión con otra forma se rechazan con su motivo y su línea."""

    def escribir(self, carpeta: Path, nombre: str, lineas: list[str]) -> Path:
        """Escribe un TSV de prueba.

        Args:
            carpeta: carpeta temporal.
            nombre: nombre del archivo.
            lineas: líneas del archivo, ya separadas por tabuladores.

        Returns:
            Ruta del archivo escrito.
        """
        ruta = carpeta / nombre
        ruta.write_text("\n".join(lineas) + "\n", encoding="utf-8")
        return ruta

    def test_las_descartadas_exigen_su_cabecera_filas_completas_y_alguna_fila(self) -> None:
        """Cabecera ajena, fila corta y lista vacía: ErrorFuente con el motivo; la buena se lee."""
        cabecera = "\t".join(CABECERA_DE_LAS_DESCARTADAS)
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            buena = self.escribir(carpeta, "buena.tsv", [cabecera, "\t".join(["1221.3.1", "HOTG0108", *"XXXX", "R-1"])])
            self.assertEqual(leer_descartadas_en_la_revision(buena), {("1221.3.1", "HOTG0108")})
            ajena = self.escribir(carpeta, "ajena.tsv", ["esco\tcert", "1221.3.1\tHOTG0108"])
            with self.assertRaisesRegex(ErrorFuente, "cabecera"):
                leer_descartadas_en_la_revision(ajena)
            corta = self.escribir(carpeta, "corta.tsv", [cabecera, "1221.3.1\tHOTG0108"])
            with self.assertRaisesRegex(ErrorFuente, "línea 2"):
                leer_descartadas_en_la_revision(corta)
            vacia = self.escribir(carpeta, "vacia.tsv", [cabecera])
            with self.assertRaisesRegex(ErrorFuente, "ninguna fila"):
                leer_descartadas_en_la_revision(vacia)

    def test_una_fila_corta_de_admitidas_dice_su_linea(self) -> None:
        """Una fila de admitidas con columnas de menos es ErrorFuente con su línea, no un AttributeError."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = self.escribir(
                Path(temporal), "admitidas.tsv", ["\t".join(CABECERA_DE_LA_REVISION), "1221.3.1\tHOTG0108"]
            )
            with self.assertRaisesRegex(ErrorFuente, "línea 2"):
                leer_admitidas(ruta, HUELLA_DE_LA_REGLA)


class PruebaFechaDeProcedencia(unittest.TestCase):
    """La fecha del paquete se comprueba también al exportar un conjunto ya preparado."""

    def test_una_fecha_imposible_no_se_exporta(self) -> None:
        """La forma AAAA-MM-DD no basta si el día no existe o las cifras no son ASCII."""
        for fecha in ("2026-99-99", "2026-02-29", "0000-01-01", "２０２６-１０-２０", "٢٠٢٦-١٠-٢٠"):
            with self.subTest(fecha=fecha):
                conjunto = PruebaContratosDeRevision.conjunto()
                conjunto["revision"]["fecha"] = fecha
                self.assertTrue(any("fecha" in falta for falta in faltas_de_procedencia(conjunto)))


class PruebaCodificacionDeLasListas(unittest.TestCase):
    """Una lista dañada conserva el motivo y la ruta sin aceptar texto sustituido."""

    def test_utf8_danado_se_informa_en_ambas_listas(self) -> None:
        """Un byte no UTF-8 en cabecera o filas se rechaza como ErrorFuente, con su archivo y motivo."""
        with tempfile.TemporaryDirectory() as temporal:
            for nombre, cabecera in (
                ("admitidas.tsv", CABECERA_DE_LA_REVISION),
                ("descartadas.tsv", CABECERA_DE_LAS_DESCARTADAS),
            ):
                for contenido in (b"\xff\n", "\t".join(cabecera).encode() + b"\n\xff\n"):
                    with self.subTest(nombre=nombre, contenido=contenido):
                        ruta = Path(temporal) / nombre
                        ruta.write_bytes(contenido)
                        with self.assertRaisesRegex(ErrorFuente, f"{nombre}.*UTF-8") as error:
                            if nombre == "admitidas.tsv":
                                leer_admitidas(ruta, REGLA_DE_EJEMPLO)
                            else:
                                leer_descartadas_en_la_revision(ruta)
                        self.assertIsInstance(error.exception.__cause__, UnicodeDecodeError)
