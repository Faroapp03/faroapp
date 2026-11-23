"""Pruebas de la fuente del Consorci: lectura, unión, acciones previstas, contacto sin datos personales y controles."""

import io
import json
import re
import subprocess
import tempfile
import unittest
from collections.abc import Callable
from contextlib import ExitStack, redirect_stdout
from datetime import UTC, date, datetime
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import plataforma_datos.cursos.fuentes.consorci.conjunto as conjunto_consorci
import plataforma_datos.cursos.fuentes.consorci.constantes as constantes_consorci
import plataforma_datos.cursos.fuentes.consorci.contactos as contactos
import plataforma_datos.cursos.fuentes.consorci.lector as consorci
from plataforma_datos.comun import lugares, red, socrata
from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.nucleo import RAIZ, Controles, Descarga, OriginalCambiado

COPIA = "2026-10-05"
# Instantes Unix (medianoche UTC) del 5 y del 6 de octubre de 2025, que fechan los metadatos de Socrata de los ejemplos.
DIA_1 = int(datetime(2025, 10, 5, tzinfo=UTC).timestamp())
DIA_2 = int(datetime(2025, 10, 6, tzinfo=UTC).timestamp())
# Una fila de qv5z-dgk3 como la publica el Consorci (los datos de contacto, inventados).
ACCION = {
    "identificador": "294021",
    "num_grup": "2",
    "denominacio": "Fonaments de la Intel·ligència Artificial Generativa - CCS",
    "modalitat": "adaptada a Aula virtual",
    "hores": "60",
    "data_inici": "2026-10-06T00:00:00.000",
    "data_final": "2026-11-26T00:00:00.000",
    "nif_entitat_formaci": "B00000000",
    "nom_entitat_formaci": "Entitat de Prova",
    "codi_municipi": "08019",
    "nom_municipi": "BARCELONA",
    "codi_comarca": "13",
    "web": "www.entitat-de-prova.cat",
    "email": "cursos@entitat-de-prova.cat",
    "tel_fon": "930000000",
}
# Sus cursos en jdcj-za6r: uno con fecha y otro «En programació».
CURSO = {
    "codicurs": "CTRD0046",
    "nom_del_curs": "Fonaments de la Intel·ligència Artificial Generativa - CCS",
    "data_inici_oferta_curs_centre": "06/10/2026",
}
EN_PROGRAMACION = {**CURSO, "data_inici_oferta_curs_centre": constantes_consorci.EN_PROGRAMACION}
# Una fila de hhvr-cedj: la misma acción, prevista sin fecha (sus campos de contacto tienen otros nombres).
PREVISTA = {
    "identificador": "294021",
    "nom_de_l_acci": "Fonaments de la Intel·ligència Artificial Generativa - CCS",
    "nif_entitat_formaci": "B00000000",
    "entitat": "Entitat de Prova",
    "codi_municipi": "08019",
    "nom_municipi": "BARCELONA",
    "modalitat": "Teleformació",
    "hores": "60",
    "web": "www.entitat-de-prova.cat",
    "correu_electr_nic": "formacio@entitat-de-prova.cat",
    "tel_fon": "930000000",
}


def metadatos(filas: int = 1, actualizado: int = DIA_1, vistas: int = 0) -> bytes:
    """Compone los metadatos de un conjunto como los publica la API: recuento, actualización y visitas.

    Args:
        filas: filas no nulas que declara la columna «identificador».
        actualizado: última actualización de las filas, en segundos desde 1970-01-01 (UTC).
        vistas: contador de visitas, que cambia sin que cambien los datos.

    Returns:
        JSON de los metadatos, en UTF-8.
    """
    columnas = [{"fieldName": "identificador", "cachedContents": {"non_null": filas, "null": 0}}]
    return json.dumps({"rowsUpdatedAt": actualizado, "viewCount": vistas, "columns": columnas}).encode()


def copia_con(acciones: list[dict[str, str]], cursos: list[dict[str, str]]) -> consorci.Copia:
    """Compone una copia del día COPIA con esas filas (la oferta FPCAT no interviene en las ediciones).

    Args:
        acciones: filas del conjunto de acciones formativas.
        cursos: filas del conjunto de cursos.

    Returns:
        Copia del Consorci con esas filas, sin oferta FPCAT ni metadatos.
    """
    filas = {constantes_consorci.ACCIONES.identificador: acciones, constantes_consorci.CURSOS.identificador: cursos}
    return consorci.Copia(COPIA, {**filas, constantes_consorci.OFERTA.identificador: []}, {})


def edicion_de(**cambios: str | None) -> dict[str, object]:
    """Prepara la edición de ACCION y le aplica los cambios indicados.

    Args:
        **cambios: campos de la edición preparada que se sustituyen.

    Returns:
        Edición preparada con los cambios.
    """
    nueva, _ = consorci.edicion(ACCION, consorci.indice_de_cursos([CURSO]))
    return {**nueva, **cambios}


class PruebaLectura(unittest.TestCase):
    """Nombres, fechas, municipios y direcciones tal como los publica el Consorci."""

    def test_modulo_de_certificado_en_el_nombre(self) -> None:
        """Un módulo de certificado lleva el certificado y el módulo delante del nombre, con «: » o sin él."""
        for nombre in (": B_SSCS0108_MF0249_Higiene i atenció", "B_SSCS0108_MF0249_Higiene i atenció"):
            with self.subTest(nombre=nombre):
                self.assertEqual(consorci.partes_del_nombre(nombre), ("SSCS0108", "MF0249", "Higiene i atenció"))
        self.assertEqual(consorci.partes_del_nombre("  Big  data "), (None, None, "Big data"))

    def test_fechas_de_los_dos_conjuntos(self) -> None:
        """qv5z-dgk3 publica fechas ISO con hora; jdcj-za6r, dd/mm/aaaa o «En programació»."""
        self.assertEqual(consorci.fecha_iso("2026-10-06T00:00:00.000"), "2026-10-06")
        self.assertEqual(consorci.fecha_iso("06/10/2026"), "2026-10-06")
        self.assertIsNone(consorci.fecha_iso(constantes_consorci.EN_PROGRAMACION))

    def test_municipio_con_su_forma_oficial(self) -> None:
        """Los municipios en mayúsculas recuperan la forma de su nombre, con artículos y elisiones."""
        casos = {
            "L'HOSPITALET DE LLOBREGAT": "L'Hospitalet de Llobregat",
            "VILANOVA I LA GELTRÚ": "Vilanova i la Geltrú",
            "LA SEU D'URGELL": "La Seu d'Urgell",
            "EL PRAT DE LLOBREGAT": "El Prat de Llobregat",
            "VILA-SECA": "Vila-seca",
        }
        for publicado, legible in casos.items():
            with self.subTest(publicado=publicado):
                self.assertEqual(lugares.municipio_legible(publicado), legible)

    def test_comarca_solo_en_cataluna(self) -> None:
        """La comarca publicada vale si el municipio es de Cataluña por su código INE; fuera, o sin comarca, no hay."""
        self.assertEqual(lugares.comarca_en_cataluna("08019", "13"), "13")
        self.assertEqual(lugares.comarca_en_cataluna("43123", "36"), "36")
        self.assertIsNone(lugares.comarca_en_cataluna("28079", "13"))
        self.assertIsNone(lugares.comarca_en_cataluna("08019", ""))

    def test_direccion_de_la_api(self) -> None:
        """Se piden todas las filas en un orden fijo y, en la oferta FPCAT, solo las del Consorci."""
        consulta = parse_qs(urlsplit(socrata.url_de_datos(constantes_consorci.OFERTA)).query)
        self.assertEqual(consulta["$limit"], [str(socrata.LIMITE_FILAS)])
        self.assertEqual(consulta["$order"], [":id"])
        self.assertEqual(consulta["$where"], ["origen='CFCC'"])
        self.assertNotIn("$where", parse_qs(urlsplit(socrata.url_de_datos(constantes_consorci.ACCIONES)).query))

    def test_archivos_de_la_copia(self) -> None:
        """La copia de un día tiene, de cada uno de los cuatro conjuntos, sus filas y sus metadatos con la fecha."""
        nombres = [archivo["archivo"] for archivo in socrata.archivos_de_la_copia(constantes_consorci.CONJUNTOS, COPIA)]
        self.assertIn(f"qv5z-dgk3-{COPIA}.json", nombres)
        self.assertIn(f"7vig-4syr-{COPIA}-metadatos.json", nombres)
        self.assertIn(f"hhvr-cedj-{COPIA}.json", nombres)
        self.assertEqual(len(nombres), len(constantes_consorci.CONJUNTOS) * 2)

    def test_metadatos_del_mismo_dia(self) -> None:
        """Dos descargas de metadatos del mismo día son la misma copia si solo cambian sus contadores de visitas."""
        archivo = {"archivo": f"qv5z-dgk3-{COPIA}-metadatos.json"}
        mismos = socrata.equivalencia(archivo)
        self.assertIsNotNone(mismos)
        self.assertTrue(mismos(metadatos(vistas=1), metadatos(vistas=2)))
        self.assertFalse(mismos(metadatos(), metadatos(filas=2)))
        self.assertFalse(mismos(metadatos(), metadatos(actualizado=DIA_2)))
        self.assertIsNone(socrata.equivalencia({"archivo": f"qv5z-dgk3-{COPIA}.json"}), "los datos, idénticos")


class PruebaContactoSinDatosPersonales(unittest.TestCase):
    """De cada entidad llega lo necesario para inscribirse y nada que pueda ser de una persona."""

    def test_correos_de_la_entidad(self) -> None:
        """Pasan los buzones de funciones (con el nombre del dominio, si acaso) o con el nombre del dominio."""
        for correo in (
            "cursos@entitat-de-prova.cat",
            "Info@entitat-de-prova.cat",
            "formacioprovacentre@provacentre.org",
            "atencionalumno@academia-de-prova.com",
            "secretaria.general@escola.cat",
            "info.provacentre@provacentre.com",
            "provacentre@provacentre.org",
            "provacentre@prova-centre.es",
        ):
            with self.subTest(correo=correo):
                self.assertTrue(contactos.es_correo_de_la_entidad(correo))

    def test_correos_que_pueden_ser_de_una_persona(self) -> None:
        """No pasan los correos con nombres o apellidos, ni los que no son una dirección válida: en la duda, no pasan.

        Una palabra que no es una función ni el dominio basta («maria.secretaria», «institucional_ari»), y el comienzo o
        el final del dominio no es el dominio («pau@pauprova.cat», «prova@cepprova.com»). Las direcciones son
        inventadas, en dominios de prueba: el patrón importa, no la persona.
        """
        for correo in (
            "maria.secretaria@escola.cat",
            "secretaria.maria@escola.cat",
            "info.jordi@provacentre.com",
            "institucional_ari@universitat-de-prova.edu",
            "pau@pauprova.cat",
            "prova@pauprova.cat",
            "prova@cepprova.com",
            "provacentre.provacentre@provacentre.com",
            "pserra@provacentre.com",
            "laia.serra@entitat-de-prova.org",
            "x.serra@entitat-de-prova.es",
            "laia@tutoria-de-prova.net",
            "laia@laiaformaciodeprova.cat",
            "formacion@academiadeprova",
            "www.entitat-de-prova.org / www.entitat-de-prova.net",
        ):
            with self.subTest(correo=correo):
                self.assertFalse(contactos.es_correo_de_la_entidad(correo))

    def test_web_como_direccion_completa(self) -> None:
        """La web se completa con su protocolo; lo que no es una web no se guarda."""
        self.assertEqual(contactos.web_de_la_entidad("www.idfo.com"), "https://www.idfo.com")
        self.assertEqual(contactos.web_de_la_entidad("\xa0www.pallares.eu"), "https://www.pallares.eu")
        self.assertEqual(contactos.web_de_la_entidad("http://www.academiacep.cat"), "http://www.academiacep.cat")
        self.assertIsNone(contactos.web_de_la_entidad("formacio@entitat-de-prova.org"))

    def test_movil_y_persona_fisica_se_retiran(self) -> None:
        """Un móvil y todo el contacto de una entidad que es una persona física no llegan; se cuentan como retirados."""
        publicado = contactos.ContactoPublicado(
            "47000000X", "Joana Garcia", "www.entitat-de-prova.cat", "jgarcia@prova.cat", "609 000 000"
        )
        ficha = constantes_consorci.CONTACTO_OFICIAL
        nada = {"entidad": None, "web": None, "correo": None, "telefono": None, "contacto_oficial": ficha}
        datos, retirados = contactos.contacto(publicado, ficha)
        self.assertEqual(datos, nada)
        self.assertTrue(all(retirados.values()))
        for nif in ("47000000X", "X0000000T", "K0000000J", ""):
            with self.subTest(nif=nif):
                autonoma = publicado._replace(nif=nif, correo="info@entitat-de-prova.cat", telefono="93 000 00 00")
                datos, retirados = contactos.contacto(autonoma, ficha)
                self.assertEqual(datos, nada, "su web, su buzón y su fijo también la identifican")
                self.assertEqual(
                    retirados,
                    {
                        "correos_que_pueden_ser_de_una_persona": False,
                        "telefonos_moviles": False,
                        "entidades_que_son_personas_fisicas": True,
                    },
                )
        datos, retirados = contactos.contacto(
            publicado._replace(nif="B00000000", nombre="Entitat de Prova", correo="", telefono="93 000 00 00"), ficha
        )
        self.assertEqual((datos["entidad"], datos["telefono"]), ("Entitat de Prova", "930000000"))
        self.assertIsNone(datos["contacto_oficial"], "una persona jurídica da su propio contacto")
        self.assertFalse(any(retirados.values()))

    def test_los_dos_conjuntos_con_sus_campos(self) -> None:
        """Una edición y una acción prevista toman el contacto de sus campos, que se llaman distinto en cada uno."""
        edicion = edicion_de()
        nueva, retirados = consorci.prevista(PREVISTA, consorci.indice_de_cursos([CURSO]), {})
        self.assertEqual((edicion["entidad"], edicion["correo"]), ("Entitat de Prova", "cursos@entitat-de-prova.cat"))
        self.assertEqual((nueva["entidad"], nueva["correo"]), ("Entitat de Prova", "formacio@entitat-de-prova.cat"))
        self.assertFalse(any(retirados.values()))

    def test_persona_fisica_con_el_contacto_oficial_en_los_dos_conjuntos(self) -> None:
        """Una edición y una acción prevista de una persona física llevan solo el contacto oficial, sin su contacto."""
        persona = {"nif_entitat_formaci": "47000000X"}
        edicion, _ = consorci.edicion({**ACCION, **persona}, consorci.indice_de_cursos([CURSO]))
        prevista, retirados = consorci.prevista({**PREVISTA, **persona}, consorci.indice_de_cursos([CURSO]), {})
        for nueva in (edicion, prevista):
            with self.subTest(id=nueva["id"]):
                self.assertEqual(
                    {campo: nueva[campo] for campo in ("entidad", "web", "correo", "telefono", "contacto_oficial")},
                    {
                        "entidad": None,
                        "web": None,
                        "correo": None,
                        "telefono": None,
                        "contacto_oficial": constantes_consorci.CONTACTO_OFICIAL,
                    },
                )
        self.assertTrue(retirados["entidades_que_son_personas_fisicas"])

    def test_nif_de_entidad_y_de_persona(self) -> None:
        """Solo una persona jurídica conserva su nombre: DNI y NIE son de personas físicas."""
        self.assertTrue(contactos.es_entidad_juridica("B66103680"))
        self.assertTrue(contactos.es_entidad_juridica("G08000000"))
        for nif in ("47123456X", "X1234567L", "K1234567A", ""):
            with self.subTest(nif=nif):
                self.assertFalse(contactos.es_entidad_juridica(nif))


class PruebaUnion(unittest.TestCase):
    """Cada edición toma su código de especialidad de jdcj-za6r, o del certificado de su nombre."""

    def test_por_nombre_y_fecha_de_inicio(self) -> None:
        """La misma edición en los dos conjuntos: mismo nombre y misma fecha de inicio."""
        indice = consorci.indice_de_cursos([CURSO, {**CURSO, "codicurs": "OTRO", "data_inici_oferta_curs_centre": ""}])
        nombre = ACCION["denominacio"]
        self.assertEqual(
            consorci.codigo_de_especialidad(nombre, "2026-10-06", None, indice), ("CTRD0046", "nombre-y-fecha")
        )

    def test_por_nombre_si_es_el_unico(self) -> None:
        """Sin la misma fecha, vale el código del nombre si en todo el conjunto es uno solo; si hay dos, ninguno."""
        nombre = ACCION["denominacio"]
        unico = consorci.indice_de_cursos([EN_PROGRAMACION])
        self.assertEqual(consorci.codigo_de_especialidad(nombre, "2026-11-02", None, unico), ("CTRD0046", "nombre"))
        ambiguo = consorci.indice_de_cursos([EN_PROGRAMACION, {**EN_PROGRAMACION, "codicurs": "CTRD9999"}])
        self.assertEqual(consorci.codigo_de_especialidad(nombre, "2026-11-02", None, ambiguo), (None, "sin-codigo"))

    def test_certificado_en_el_nombre(self) -> None:
        """Un módulo de certificado no necesita la unión: el código está en su nombre."""
        indice = consorci.indice_de_cursos([])
        self.assertEqual(
            consorci.codigo_de_especialidad("Higiene", "2026-10-07", "SSCS0108", indice),
            ("SSCS0108", "certificado-en-el-nombre"),
        )


class PruebaPrevistas(unittest.TestCase):
    """Las acciones previstas toman su código como las ediciones y se exportan por especialidad, con sus entidades."""

    def test_codigo_de_la_prevista(self) -> None:
        """Por orden: el certificado del nombre, el de las ediciones de su acción o el único de su nombre."""
        indice = consorci.indice_de_cursos([EN_PROGRAMACION])
        nombre = PREVISTA["nom_de_l_acci"]
        casos = (
            (("Higiene", "SSCS0108", "CTRD0046"), ("SSCS0108", "certificado-en-el-nombre")),
            ((nombre, None, "IFCT0049"), ("IFCT0049", "ediciones-de-la-accion")),
            ((nombre, None, None), ("CTRD0046", "nombre")),
            (("Un altre curs", None, None), (None, "sin-codigo")),
        )
        for (nombre_de_la_accion, certificado, de_su_accion), esperado in casos:
            with self.subTest(nombre=nombre_de_la_accion, certificado=certificado, de_su_accion=de_su_accion):
                self.assertEqual(
                    consorci.codigo_de_la_prevista(nombre_de_la_accion, certificado, de_su_accion, indice), esperado
                )

    def test_prevista_completa(self) -> None:
        """Una acción prevista lleva su código, su modalidad, si es a distancia, su municipio legible y sus horas."""
        nueva, _ = consorci.prevista(PREVISTA, consorci.indice_de_cursos([]), {"294021": "CTRD0046"})
        self.assertEqual((nueva["especialidad"], nueva["union"]), ("CTRD0046", "ediciones-de-la-accion"))
        self.assertEqual(
            (nueva["modalidad"], nueva["a_distancia"], nueva["municipio"], nueva["horas"]),
            ("Teleformació", True, "Barcelona", "60"),
        )

    def test_por_especialidad_con_cada_entidad_una_vez(self) -> None:
        """Cada entidad va una vez, con un identificador propio; la especialidad lleva el nombre más repetido."""
        base, _ = consorci.prevista(PREVISTA, consorci.indice_de_cursos([]), {"294021": "CTRD0046"})
        otra_entidad = {**base, "entidad": "Altra Entitat", "web": "https://altra.example"}
        presencial = {**base, "modalidad": "Presencial"}
        otro_nombre = {**base, "nombre": "Fonaments de la IA"}
        sin_codigo = {**base, "especialidad": None}
        exportado = conjunto_consorci.previstas_por_especialidad(
            [base, otra_entidad, presencial, otro_nombre, sin_codigo]
        )
        self.assertEqual(list(exportado["previstas"]), ["CTRD0046"])
        especialidad = exportado["previstas"]["CTRD0046"]
        self.assertEqual(especialidad["nombre"], base["nombre"])
        self.assertEqual(len(especialidad["acciones"]), 4)
        self.assertEqual(sorted(exportado["entidades"]), ["e001", "e002"])
        self.assertEqual(
            sorted(entidad["entidad"] for entidad in exportado["entidades"].values()),
            ["Altra Entitat", "Entitat de Prova"],
        )
        self.assertNotIn("nif", json.dumps(exportado))


class PruebaEdiciones(unittest.TestCase):
    """De las filas de la copia a las ediciones: sin repetidas, sin terminadas y cada una con su identificador."""

    def test_edicion_completa(self) -> None:
        """La edición lleva su código, fechas ISO, modalidad a distancia, municipio legible y contacto de la entidad."""
        nueva = edicion_de()
        self.assertEqual(nueva["id"], "294021-2-20261006-20261126-v")
        self.assertEqual(
            (nueva["especialidad"], nueva["inicio"], nueva["fin"]), ("CTRD0046", "2026-10-06", "2026-11-26")
        )
        self.assertEqual((nueva["modalidad"], nueva["a_distancia"]), ("Adaptada a Aula virtual", True))
        self.assertEqual((nueva["municipio"], nueva["correo"]), ("Barcelona", "cursos@entitat-de-prova.cat"))
        self.assertEqual(nueva["comarca"], "13")
        fuera = consorci.edicion({**ACCION, "codi_municipi": "28079"}, consorci.indice_de_cursos([CURSO]))[0]
        self.assertIsNone(fuera["comarca"], "fuera de Cataluña no hay comarca")

    def test_repetidas_terminadas_y_dos_modalidades(self) -> None:
        """Una fila repetida cuenta una vez, una terminada antes de la copia no entra y dos modalidades son dos."""
        terminada = {**ACCION, "identificador": "1", "data_inici": "2026-09-01T00:00", "data_final": "2026-10-04T00:00"}
        presencial = {**ACCION, "modalitat": "Presencial"}
        ediciones, recuentos = consorci.ediciones_de_la_copia(
            copia_con([ACCION, ACCION, terminada, presencial], [CURSO])
        )
        self.assertEqual(
            [nueva["id"] for nueva in ediciones], ["294021-2-20261006-20261126-p", "294021-2-20261006-20261126-v"]
        )
        self.assertEqual(recuentos, {"filas_repetidas": 1, "terminadas_antes_de_la_copia": 1})

    def test_momento_como_el_informe(self) -> None:
        """El día de inicio la edición ya ha empezado; solo está por iniciar si empieza después."""
        nueva = edicion_de()
        self.assertEqual(conjunto_consorci.momento_en(nueva, "2026-10-05"), "por-iniciar")
        self.assertEqual(conjunto_consorci.momento_en(nueva, "2026-10-06"), "iniciado")
        self.assertEqual(conjunto_consorci.momento_en(nueva, "2026-11-27"), "terminado")


class PruebaControles(unittest.TestCase):
    """Las alarmas de la validación: recuento, unión, gratuidad, ediciones empezadas y contacto."""

    def resumen(self, **cambios: object) -> dict[str, object]:
        """Compone el resumen de una copia correcta y le aplica los cambios indicados.

        Args:
            **cambios: claves del resumen que se sustituyen.

        Returns:
            Resumen de la copia con los cambios.
        """
        conjuntos = {
            constantes_consorci.ACCIONES.identificador: {
                "filas": 1,
                "filas_segun_metadatos": 1,
                "filas_por_origen": {},
            },
            constantes_consorci.CURSOS.identificador: {"filas": 2, "con_fecha": 1, "filas_segun_metadatos": 2},
            constantes_consorci.OFERTA.identificador: {
                "filas": 1,
                "filas_segun_metadatos": 9,
                "filas_por_origen": {"CFCC": 1},
            },
            constantes_consorci.ACCIONES_PREVISTAS.identificador: {
                "filas": 3,
                "filas_segun_metadatos": 3,
                "filas_por_origen": {},
            },
        }
        resumen = {
            "copia": COPIA,
            "conjuntos": conjuntos,
            "destinatarios": [constantes_consorci.DESTINATARIOS_OCUPADAS],
            "precios": {
                constantes_consorci.CURSOS.identificador: ["0"],
                constantes_consorci.OFERTA.identificador: ["Subvencionat"],
            },
            "financiacion_publica": ["Sí"],
            "modalidades": ["Presencial"],
            "modalidades_de_las_previstas": ["Presencial", "Mixta"],
        }
        return {**resumen, **cambios}

    def fallidos(self, comprobar: Callable[..., None], *argumentos: object) -> list[str]:
        """Ejecuta `comprobar` con sus argumentos sobre unos controles nuevos.

        Args:
            comprobar: función de control que recibe los controles y sus argumentos.
            *argumentos: argumentos de `comprobar` tras los controles.

        Returns:
            Texto de cada control que no pasa.
        """
        controles = Controles()
        comprobar(controles, *argumentos)
        return controles.fallidos

    def test_recuento_frente_a_los_metadatos(self) -> None:
        """Una descarga con menos filas que las declaradas (o cortada en el límite) es una alarma."""
        self.assertEqual(self.fallidos(conjunto_consorci._controles_de_recuento, self.resumen()), [])
        incompleto = self.resumen()
        incompleto["conjuntos"][constantes_consorci.CURSOS.identificador]["filas_segun_metadatos"] = 3
        self.assertEqual(len(self.fallidos(conjunto_consorci._controles_de_recuento, incompleto)), 1)
        cortada = self.resumen()
        cortada["conjuntos"][constantes_consorci.ACCIONES.identificador].update(
            filas=socrata.LIMITE_FILAS, filas_segun_metadatos=socrata.LIMITE_FILAS
        )
        self.assertEqual(len(self.fallidos(conjunto_consorci._controles_de_recuento, cortada)), 1)

    def test_alarma_de_la_union_por_debajo_del_85(self) -> None:
        """Con 85 de 100 ediciones (o acciones previstas) con código no hay alarma; con 84, sí."""

        def con(con_codigo: int) -> list[dict[str, str | None]]:
            """Compone cien registros, de los que los `con_codigo` primeros tienen su código de especialidad.

            Args:
                con_codigo: cuántos registros llevan código.

            Returns:
                Los cien registros.
            """
            return [{"especialidad": "X" if numero < con_codigo else None} for numero in range(100)]

        for ediciones, previstas, alarmas in ((85, 85, 0), (84, 100, 1), (100, 84, 1)):
            preparados = constantes_consorci.Preparados(con(ediciones), con(previstas), {}, self.resumen())
            with self.subTest(ediciones=ediciones, previstas=previstas):
                self.assertEqual(len(self.fallidos(conjunto_consorci._controles_de_union, preparados)), alarmas)

    def test_gratuidad_destinatarios_y_modalidad(self) -> None:
        """Un precio, un público o una modalidad que no se esperan son una alarma."""
        self.assertEqual(self.fallidos(conjunto_consorci._controles_de_condiciones, self.resumen()), [])
        for cambio in (
            {
                "precios": {
                    constantes_consorci.CURSOS.identificador: ["0", "120"],
                    constantes_consorci.OFERTA.identificador: ["Subvencionat"],
                }
            },
            {"destinatarios": [constantes_consorci.DESTINATARIOS_OCUPADAS, "Qualsevol persona"]},
            {"modalidades": ["Presencial", "Mixta"]},
            {"modalidades_de_las_previstas": ["Presencial", "Semipresencial"]},
        ):
            with self.subTest(cambio=cambio):
                self.assertEqual(
                    len(self.fallidos(conjunto_consorci._controles_de_condiciones, self.resumen(**cambio))), 1
                )

    def falla_por(self, fallidos: list[str], causa: str) -> None:
        """Comprueba que entre los controles fallidos está el de la causa esperada, no otro cualquiera.

        Args:
            fallidos: textos de los controles que no pasan.
            causa: fragmento del texto del control que el caso tiene que hacer fallar.
        """
        self.assertTrue(any(causa in control for control in fallidos), f"«{causa}» no está en {fallidos}")

    def test_ediciones_y_contacto(self) -> None:
        """Identificador repetido, fecha imposible, terminada, horas, sin comarca o contacto indebido: alarmas."""
        buena = edicion_de()
        self.assertEqual(self.fallidos(conjunto_consorci._controles_de_ediciones, [buena], COPIA), [])
        self.assertEqual(self.fallidos(conjunto_consorci._controles_de_contacto, [buena], "ediciones"), [])
        for cambio, causa in (
            ({"fin": "2026-02-30"}, "inicio y fin reales"),
            ({"fin": "2026-10-04"}, "terminó antes de la copia"),
            ({"horas": "0"}, "las horas de cada edición"),
        ):
            with self.subTest(cambio=cambio):
                fallidos = self.fallidos(conjunto_consorci._controles_de_ediciones, [edicion_de(**cambio)], COPIA)
                self.falla_por(fallidos, causa)
        repetida = self.fallidos(conjunto_consorci._controles_de_ediciones, [buena, buena], COPIA)
        self.assertEqual(repetida, ["cada edición tiene un identificador propio"])
        presencial_fuera = edicion_de(a_distancia=False, comarca=None)
        fuera = self.fallidos(conjunto_consorci._controles_de_ediciones, [presencial_fuera], COPIA)
        self.assertEqual(len(fuera), 1)
        self.falla_por(fuera, "con su comarca")
        sin_contacto = {"entidad": None, "web": None, "correo": None, "telefono": None}
        de_persona_fisica = edicion_de(**sin_contacto, contacto_oficial=constantes_consorci.CONTACTO_OFICIAL)
        self.assertEqual(self.fallidos(conjunto_consorci._controles_de_contacto, [de_persona_fisica], "ediciones"), [])
        de_una_persona, sin_forma, oficial_indebido = (
            "puede ser el de una persona",
            "forma de contactar",
            "personas físicas",
        )
        for cambio, causa in (
            ({"correo": "pserra@provacentre.com"}, de_una_persona),
            ({"telefono": "609000000"}, de_una_persona),
            ({"web": None, "correo": None, "telefono": None}, sin_forma),
            (sin_contacto, sin_forma),
            ({**sin_contacto, "contacto_oficial": "https://ficha.example/curs"}, sin_forma),
            (
                {**sin_contacto, "contacto_oficial": constantes_consorci.CONTACTO_OFICIAL, "entidad": "Joana Garcia"},
                oficial_indebido,
            ),
            ({"contacto_oficial": constantes_consorci.CONTACTO_OFICIAL}, oficial_indebido),
        ):
            with self.subTest(cambio=cambio):
                fallidos = self.fallidos(conjunto_consorci._controles_de_contacto, [edicion_de(**cambio)], "ediciones")
                self.assertEqual(len(fallidos), 1)
                self.falla_por(fallidos, causa)

    def test_cita_con_la_fecha_de_actualizacion(self) -> None:
        """La cita dice la fuente que pide la licencia y la fecha de la última actualización."""
        resumen = self.resumen()
        resumen["conjuntos"][constantes_consorci.ACCIONES.identificador]["actualizado"] = "2026-10-05"
        resumen["conjuntos"][constantes_consorci.CURSOS.identificador]["actualizado"] = "2026-10-05"
        resumen["conjuntos"][constantes_consorci.ACCIONES_PREVISTAS.identificador]["actualizado"] = "2026-10-03"
        self.assertTrue(conjunto_consorci.cita(resumen).startswith(constantes_consorci.ORGANISMO))
        self.assertIn("acciones previstas (hhvr-cedj)", conjunto_consorci.cita(resumen))
        self.assertTrue(conjunto_consorci.cita(resumen).endswith("actualizados el 03/10/2026 y el 05/10/2026."))


class PruebaDescargaSinRed(unittest.TestCase):
    """La copia del día se descarga con pausas, se registra y no sustituye en silencio otra del mismo día."""

    def descargar(self, carpeta: Path, contenido: bytes, aceptar_cambio: bool = False) -> None:
        """Ejecuta `descargar` en `carpeta`, con la red sustituida por `contenido` y sin esperar."""

        def red_simulada(url: str, *_: object) -> Descarga:
            """Responde como la API: los metadatos, iguales salvo sus contadores; las filas, `contenido`.

            Args:
                url: dirección pedida.
                *_: argumentos de la descarga real que la simulación no usa.

            Returns:
                Descarga simulada de esa dirección.
            """
            if "/api/views/" in url:
                return Descarga(metadatos(vistas=len(contenido)), url, "application/json")
            return Descarga(contenido, url, "application/json")

        with ExitStack() as parches:
            parches.enter_context(mock.patch.object(consorci, "ORIGINAL", carpeta))
            parches.enter_context(mock.patch.object(consorci, "PROCEDENCIA", carpeta / "procedencia.json"))
            parches.enter_context(mock.patch.object(red, "descargar_url", red_simulada))
            pausas = parches.enter_context(mock.patch.object(socrata.time, "sleep"))
            parches.enter_context(redirect_stdout(io.StringIO()))
            consorci.descargar(aceptar_cambio, hoy=date.fromisoformat(COPIA))
        self.assertEqual(pausas.call_count, len(constantes_consorci.CONJUNTOS) * 2)

    def test_copia_registrada_con_licencia_y_cita(self) -> None:
        """La procedencia registra el día de la copia, sus ocho archivos, la licencia y la cita."""
        with tempfile.TemporaryDirectory() as temporal:
            self.descargar(Path(temporal), b"[]")
            registrada = leer_json(Path(temporal) / "procedencia.json")
        self.assertEqual(registrada["copia"], COPIA)
        self.assertEqual(len(registrada["archivos"]), len(constantes_consorci.CONJUNTOS) * 2)
        self.assertEqual(
            (registrada["licencia"], registrada["cita"]), (constantes_consorci.LICENCIA, constantes_consorci.ORGANISMO)
        )

    def test_otra_copia_del_mismo_dia(self) -> None:
        """Otra descarga del mismo día con otros datos se detiene; con --aceptar-cambio, la sustituye.

        Los metadatos que solo cambian en sus contadores no la detienen: se conservan los primeros.
        """
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            self.descargar(carpeta, b"[]")
            with self.assertRaises(OriginalCambiado):
                self.descargar(carpeta, b"[{}]")
            self.descargar(carpeta, b"[{}]", aceptar_cambio=True)
            self.assertEqual((carpeta / f"qv5z-dgk3-{COPIA}.json").read_bytes(), b"[{}]")
            self.descargar(carpeta, b"[{}]")
            self.assertEqual((carpeta / f"qv5z-dgk3-{COPIA}-metadatos.json").read_bytes(), metadatos(vistas=2))


class PruebaFilasQueNoSeInventan(unittest.TestCase):
    """Fechas imposibles, identificadores normalizados y entidades en un orden reproducible."""

    def test_una_fecha_imposible_queda_sin_fecha(self) -> None:
        """«31/02/2026» o «2026-13-45T…» no detienen la preparación: la fila se queda sin esa fecha."""
        self.assertIsNone(consorci.fecha_iso("31/02/2026"))
        self.assertIsNone(consorci.fecha_iso("00/10/2026"))
        self.assertIsNone(consorci.fecha_iso("2026-13-45T00:00:00.000"))
        self.assertEqual(consorci.fecha_iso("2026-10-05T00:00:00.000"), "2026-10-05")

    def test_el_id_usa_la_accion_y_el_grupo_normalizados(self) -> None:
        """Con espacios en los campos, el id y la acción de la edición siguen la misma forma que su clave."""
        fila = {
            "identificador": " 1234 ",
            "num_grup": "2 ",
            "denominacio": "Curs",
            "data_inici": "05/10/2026",
            "data_final": "06/10/2026",
            "modalitat": "Presencial",
            "nom_municipi": "Cornellà de Llobregat",
        }
        indice = consorci.indice_de_cursos([])
        with mock.patch.object(consorci, "_contacto_de_la_edicion", return_value=({}, {})):
            edicion, _ = consorci.edicion(fila, indice)
        self.assertEqual((edicion["id"], edicion["accion"]), ("1234-2-20261005-20261006-p", "1234"))

    def test_las_etiquetas_de_la_union_son_las_declaradas(self) -> None:
        """Cada forma de encontrar el código sale de constantes_consorci, no de un texto escrito aparte."""
        indice = consorci.indice_de_cursos([])
        self.assertEqual(
            consorci.codigo_de_especialidad("x", "", "SSCS0108", indice)[1], constantes_consorci.UNION_CERTIFICADO
        )
        self.assertEqual(
            consorci.codigo_de_especialidad("x", "", None, indice)[1], constantes_consorci.UNION_SIN_CODIGO
        )
        self.assertEqual(
            consorci.codigo_de_la_prevista("x", None, "AB", indice)[1], constantes_consorci.UNION_EDICIONES_DE_LA_ACCION
        )

    def test_entidades_con_el_mismo_texto_y_otro_tipo(self) -> None:
        """Dos entidades que solo se distinguen por el tipo (None y «None») reciben siempre los mismos ids."""
        campos = conjunto_consorci.CAMPOS_DE_LA_ENTIDAD
        una = dict.fromkeys(campos, "x")
        otra = {**una, campos[0]: None}
        con_texto = {**una, campos[0]: "None"}
        for orden in ([otra, con_texto], [con_texto, otra]):
            entidades, _ = conjunto_consorci._entidades_de(orden)
            self.assertEqual([entidad[campos[0]] for entidad in entidades.values()], [None, "None"])

    def test_las_modalidades_a_distancia_son_las_del_motor(self) -> None:
        """La lista de la cadena y la del motor (vigencia-cursos.ts) son la misma: si una cambia, esto falla."""
        motor = (RAIZ / "motores/cursos/src/vigencia-cursos.ts").read_text(encoding="utf-8")
        declarada = re.search(r"const MODALIDADES_A_DISTANCIA(?:: [^=]+)? = new Set\(\[([^\]]*)\]\)", motor)
        self.assertIsNotNone(declarada)
        self.assertEqual(
            re.findall(r"'([^']*)'", declarada.group(1)), list(constantes_consorci.MODALIDADES_A_DISTANCIA)
        )


class PruebaContratosCompartidos(unittest.TestCase):
    """Las implementaciones por lenguaje mantienen los mismos contratos."""

    def test_el_momento_de_un_curso_coincide_con_el_motor(self) -> None:
        """Todos los pares de fechas y días de borde dan el mismo momento en Python y TypeScript."""
        fechas = (None, "2026-10-04", "2026-10-05", "2026-10-06")
        casos = [
            {"curso": {"inicio": inicio, "fin": fin}, "hoy": hoy}
            for inicio in fechas
            for fin in fechas
            for hoy in fechas[1:]
        ]
        programa = (
            "import { momentoDelCurso } from './motores/cursos/src/vigencia-cursos.ts';"
            "let entrada = ''; for await (const parte of process.stdin) entrada += parte;"
            "console.log(JSON.stringify(JSON.parse(entrada).map(({curso,hoy}) => momentoDelCurso(curso,hoy))));"
        )
        respuesta = subprocess.run(
            ["node", "--input-type=module", "-e", programa],
            cwd=RAIZ,
            input=json.dumps(casos),
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
        self.assertEqual(
            [conjunto_consorci.momento_en(caso["curso"], caso["hoy"]) for caso in casos],
            json.loads(respuesta.stdout),
        )


if __name__ == "__main__":
    unittest.main()
