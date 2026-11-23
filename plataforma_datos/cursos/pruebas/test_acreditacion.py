"""Pruebas de la cadena de acreditación: códigos, alarmas, descarga, conjunto y punto de información."""

import unittest
from datetime import date
from unittest import mock

import plataforma_datos.cursos.fuentes.acreditacion.piezas.conjunto as piezas_conjunto
import plataforma_datos.cursos.fuentes.acreditacion.piezas.descarga as descarga
import plataforma_datos.cursos.fuentes.acreditacion.piezas.preparacion as preparacion
import plataforma_datos.cursos.fuentes.acreditacion.piezas.validacion as validacion
import plataforma_datos.cursos.fuentes.acreditacion.relaciones as relaciones
from plataforma_datos.comun import boe
from plataforma_datos.comun.nucleo import Controles, Descarga, ErrorFuente, FormatoInesperado
from plataforma_datos.cursos.fuentes.acreditacion.piezas.conjunto import conjunto_validado
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    EJEMPLOS,
    EJEMPLOS_DE_GRUPO,
    PAGINAS_REGISTRADAS,
    PUNTO_DE_INFORMACION,
    SIN_ENLACE,
    Pagina,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.descarga import (
    Lector,
    certificados_del_soc,
    nombre_de_disposicion,
    numero_del_archivo,
    real_decreto_del_soc,
    url_de_disposicion,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.preparacion import ocupacion_clasificada
from plataforma_datos.cursos.fuentes.acreditacion.piezas.relacion_con_ocupaciones import (
    Cadena,
    Relaciones,
    todas_las_relaciones,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.validacion import (
    avisos_de_paginas,
    controles_de_ejemplos,
    controles_de_lectura,
    controles_de_normas,
    controles_del_punto_de_informacion,
    punto_de_informacion,
)
from plataforma_datos.cursos.pruebas.ejemplos_acreditacion import REGLA_DE_EJEMPLO, certificado, linea


class PruebaCodigosDeOcupacion(unittest.TestCase):
    """De qué clasificación es cada código y a qué grupos CNO-11 lleva."""

    TABLAS = ({"4111", "5710", "8321", "4430"}, {"5113": ["5710"], "3073": ["3160", "3326"], "5330": ["5220", "5430"]})

    def clasificada(self, codigo: str | None, forma: str | None, anio: int) -> dict[str, object]:
        """La ocupación clasificada, sin su texto.

        Returns:
            Clase, código COSISPE y grupos de la ocupación.
        """
        ocupacion = ocupacion_clasificada(boe.Ocupacion(codigo, "x", forma), anio, self.TABLAS)
        return {clave: ocupacion[clave] for clave in ("clase", "cosispe", "grupos")}

    def test_cada_forma_con_su_epoca(self) -> None:
        """«4111.1011» es CO-SISPE; «5330.001.0», CNO-94; ocho cifras, según el año y si el grupo existe."""
        self.assertEqual(
            self.clasificada("41111011", "4.4", 2011), {"clase": "cno11", "cosispe": "41111011", "grupos": ["4111"]}
        )
        self.assertEqual(
            self.clasificada("53300010", "4.3.1", 2008), {"clase": "cno94", "cosispe": None, "grupos": ["5220", "5430"]}
        )
        self.assertEqual(
            self.clasificada("51130024", "8", 2008), {"clase": "cno94", "cosispe": None, "grupos": ["5710"]}
        )
        self.assertEqual(
            self.clasificada("83211032", "8", 2011), {"clase": "cno11", "cosispe": "83211032", "grupos": ["8321"]}
        )
        # En 2011 aún se publicaron códigos de la CNO-94: el grupo 3073 no existe en la CNO-11.
        self.assertEqual(
            self.clasificada("30730012", "8", 2011), {"clase": "cno94", "cosispe": None, "grupos": ["3160", "3326"]}
        )
        self.assertEqual(
            self.clasificada("4430", "4", 2013), {"clase": "cno11-grupo", "cosispe": None, "grupos": ["4430"]}
        )
        self.assertEqual(
            self.clasificada("99999999", "8", 2013), {"clase": "desconocido", "cosispe": None, "grupos": []}
        )
        self.assertEqual(self.clasificada(None, None, 2013), {"clase": "sin-codigo", "cosispe": None, "grupos": []})


class PruebaAlarmas(unittest.TestCase):
    """Cada control que bloquea, con un caso que pasa y otro que falla."""

    RESUMEN = {"reales_decretos_del_indice": 95, "titulos_que_no_cuadran": []}

    def fallidos(self, certificados: list[dict[str, object]], resumen: dict[str, object] | None = None) -> list[str]:
        """Los controles de lectura que fallan con estos certificados.

        Returns:
            Texto de cada control de lectura que falla.
        """
        controles = Controles()
        controles_de_lectura(controles, certificados, resumen or self.RESUMEN)
        return controles.fallidos

    def test_lectura_correcta(self) -> None:
        """Con todos los anexos leídos, el nivel del SOC y sus unidades en el anexo, no falla nada."""
        self.assertEqual(self.fallidos([certificado()] * 40), [])

    def test_anexos_que_faltan_nivel_y_unidades(self) -> None:
        """Un anexo sin leer de cada 30, un nivel distinto o unidades sin su nombre del BOE disparan su alarma."""
        sin_anexo = [certificado()] * 29 + [certificado(anexo=None)]
        self.assertEqual(len(self.fallidos(sin_anexo)), 1)
        distinto = [certificado(anexo={"nivel": 3, "real_decreto": "1/2011", "ocupaciones": []})] + [certificado()] * 40
        self.assertIn("ADGD0308", " ".join(self.fallidos(distinto)))
        sin_nombre = [certificado(unidades=[{"codigo": "UC1", "nombre_es": None}])] * 40
        self.assertEqual(len(self.fallidos(sin_nombre)), 1)
        self.assertEqual(len(self.fallidos([certificado()], {**self.RESUMEN, "reales_decretos_del_indice": 10})), 1)
        cambiado = {**self.RESUMEN, "titulos_que_no_cuadran": ["boe-rd-2011-645.html"]}
        self.assertIn("boe-rd-2011-645.html", " ".join(self.fallidos([certificado()], cambiado)))

    def test_ejemplos_del_estudio_y_descartes(self) -> None:
        """Si un ejemplo deja de dar su certificado o vuelve una relación descartada, falla."""
        ocupaciones: dict[str, dict[str, str]] = {}
        for esco, codigo, relacion in EJEMPLOS:
            ocupaciones.setdefault(esco, {})[codigo] = relacion
        grupos = {isco: {codigo: "grupo"} for isco, codigo in EJEMPLOS_DE_GRUPO}
        controles = Controles()
        controles_de_ejemplos(controles, Relaciones(ocupaciones, grupos))
        self.assertEqual(controles.fallidos, [])
        controles = Controles()
        sin_cuidadora = Relaciones({**ocupaciones, "5322.1": {}}, grupos)
        controles_de_ejemplos(controles, sin_cuidadora)
        self.assertEqual(len(controles.fallidos), 1)
        controles = Controles()
        con_relojeria = Relaciones(ocupaciones, {**grupos, "5223": {"COMV0108": "grupo", "ARTB0112": "grupo"}})
        controles_de_ejemplos(controles, con_relojeria)
        self.assertIn("5223→ARTB0112", " ".join(controles.fallidos))

    def test_las_descartadas_se_quitan(self) -> None:
        """Una relación de DESCARTADAS que la regla da se quita de la ocupación y del grupo ISCO-08 por mayoría."""
        cadena = Cadena(
            eures={},
            isco_a_cno11={"7125": ["7122"], "5223": ["5220"]},
            ocupaciones={"7125.1": "7125", "5223.9": "5223"},
            nombres={"7125.1": ["cristalero", "cristalero de edificios"], "5223.9": ["dependiente de floristería"]},
            genericas=relaciones.que_no_distinguen({}),
        )
        limpieza = {
            "codigo": "SSCM0108",
            "ocupaciones": [],
            "anexo": {"ocupaciones": [linea("72940011", "Cristalero de edificios", "cno94", ["7122"])]},
        }
        floristeria = {
            "codigo": "AGAJ0110",
            "ocupaciones": [],
            "anexo": {"ocupaciones": [linea("53300034", "Dependiente de floristería", "cno94", ["5220"])]},
        }
        todas = todas_las_relaciones(cadena, [limpieza, floristeria])
        self.assertEqual(todas.ocupaciones["7125.1"], {}, "cristalero: la limpieza de cristales no es su oficio")
        self.assertEqual(todas.grupos["7125"], {})
        self.assertEqual(todas.ocupaciones["5223.9"], {"AGAJ0110": "grupo"})
        self.assertEqual(todas.grupos["5223"], {}, "el grupo de vendedores en tiendas no da floristería")

    def test_pasajes_literales_y_equivalencias(self) -> None:
        """Un pasaje que ya no está en su norma o una equivalencia que falta bloquean la validación."""
        equivalencias = {unidad: [{"codigo": "UC2"}] for unidad in ("UC0249_2", "UC0250_2", "UC0251_2")}
        pasajes = {"edad": {"literal": True, "norma": "Real Decreto 659/2023"}}
        controles = Controles()
        controles_de_normas(controles, {"pasajes": pasajes, "equivalencias": equivalencias})
        self.assertEqual(controles.fallidos, [])
        controles = Controles()
        pasajes = {"edad": {"literal": False, "norma": "Real Decreto 659/2023"}}
        controles_de_normas(controles, {"pasajes": pasajes, "equivalencias": {}})
        self.assertEqual(len(controles.fallidos), 2)

    def test_avisos_de_las_paginas_registradas_a_mano(self) -> None:
        """Una página sin huella o comprobada hace más de 60 días da un aviso, que no bloquea."""
        paginas = {
            "tramite": {"comprobado": "2026-10-06", "sha256": {"ca": "a"}},
            "agencia": {"comprobado": "2026-10-06", "sha256": None},
        }
        self.assertEqual(len(avisos_de_paginas(paginas, date(2026, 10, 7))), 1)
        self.assertEqual(len(avisos_de_paginas(paginas, date(2026, 12, 6))), 3)

    def test_las_paginas_registradas_tienen_lo_que_se_comprueba(self) -> None:
        """Cada página registrada a mano tiene título, dirección en catalán, fecha y, si no tiene huella, el porqué."""
        for clave, pagina in PAGINAS_REGISTRADAS.items():
            with self.subTest(pagina=clave):
                self.assertTrue(pagina["titulo"] and pagina["url"]["ca"].startswith("https://"))
                date.fromisoformat(pagina["comprobado"])
                self.assertTrue(pagina["sha256"] is not None or "a mano" in pagina["dice"])


class PruebaDescarga(unittest.TestCase):
    """Qué se pide al BOE y cómo: índice o ELI, robots.txt antes de cada petición y PDF solo si hace falta."""

    def test_direccion_de_cada_real_decreto(self) -> None:
        """Por su identificador si el índice lo cita; si no, por su ELI con la fecha conocida; sin fecha, se detiene."""
        indice = {"645/2011": boe.Disposicion("645", 2011, "2011-05-09", "BOE-A-2011-9930")}
        self.assertEqual(url_de_disposicion("645/2011", indice), "https://www.boe.es/buscar/act.php?id=BOE-A-2011-9930")
        self.assertEqual(url_de_disposicion("615/2013", indice), "https://www.boe.es/eli/es/rd/2013/08/02/615")
        with self.assertRaisesRegex(ErrorFuente, "añade su fecha"):
            url_de_disposicion("1/2030", indice)

    def test_certificados_y_reales_decretos_del_soc(self) -> None:
        """Las especialidades con real decreto son certificados; su real decreto sale del campo «certprof»."""
        filas = [
            {"codiespecialitat": "ADGD0308", "certprof": "RD 645/2011"},
            {"codiespecialitat": "ADGD0308", "certprof": "RD 645/2011"},
            {"codiespecialitat": "FMEC0119", "certprof": "RD 569/2023, de 4 de juliol"},
            {"codiespecialitat": "TCPF0010", "certprof": "undefined"},
        ]
        certificados = certificados_del_soc(filas)
        self.assertEqual(sorted(certificados), ["ADGD0308", "FMEC0119"])
        self.assertEqual(real_decreto_del_soc(certificados["FMEC0119"]), "569/2023")
        self.assertEqual(numero_del_archivo(nombre_de_disposicion("569/2023", "pdf")), "569/2023")

    def test_pdf_solo_si_hace_falta(self) -> None:
        """Se pide el PDF de un real decreto sin anexos legibles o con un certificado del SOC que no está en ninguno."""
        codigos = {"1379/2008": (set(), "eli"), "645/2011": ({"ADGD0308"}, "eli"), "717/2011": ({"MAMA0109"}, "eli")}
        certificados = {
            "ADGD0308": {"filas": [{"certprof": "RD 645/2011"}]},
            "MAMD0209": {"filas": [{"certprof": "RD 717/2011"}]},
            "AGAO0308M": {"filas": [{"certprof": "RD 645/2011"}]},
        }
        self.assertEqual(descarga._pdf_necesarios(codigos, certificados), ["1379/2008", "645/2011", "717/2011"])
        codigos["645/2011"] = ({"ADGD0308", "AGAO0308"}, "eli")
        self.assertEqual(descarga._pdf_necesarios(codigos, certificados), ["1379/2008", "717/2011"])

    def test_robots_antes_de_pedir(self) -> None:
        """El lector pide el robots.txt del sitio una vez y no pide lo que prohíbe; espera entre peticiones."""
        pedidas: list[str] = []

        def red(url: str, *_: object) -> Descarga:
            pedidas.append(url)
            return Descarga(b"User-agent: *\nDisallow: /privado/\n", url, "text/plain")

        with (
            mock.patch.object(descarga, "descargar_url", red),
            mock.patch.object(descarga.time, "sleep") as pausa,
        ):
            lector = Lector(aceptar_cambio=False)
            with self.assertRaisesRegex(FormatoInesperado, "robots.txt"):
                lector.descargar(Pagina("x.html", "https://www.boe.es/privado/x", "X"))
            with self.assertRaisesRegex(FormatoInesperado, "robots.txt"):
                lector.descargar(Pagina("y.html", "https://www.boe.es/privado/y", "Y"))
        self.assertEqual(pedidas, ["https://www.boe.es/robots.txt"])
        self.assertEqual(pausa.call_count, 1)
        self.assertEqual(set(lector.robots["www.boe.es"]), {"url", "sha256", "consultado_utc"})


class PruebaConjunto(unittest.TestCase):
    """Lo que exporta el paquete: las relaciones admitidas y todo el catálogo de certificados con anexo."""

    def setUp(self) -> None:
        """La oferta de la prueba es sintética; este nominal no depende de originales ni preparados."""
        cataluna = {"en_la_oferta": [], "no_disponibles": {}, "oferta_actualizada": "2025-09-12"}
        parche = mock.patch.object(piezas_conjunto, "de_cataluna", return_value=cataluna)
        parche.start()
        self.addCleanup(parche.stop)

    def test_conjunto_validado(self) -> None:
        """Van las relaciones con algún certificado y todos los certificados con anexo, con fechas, enlaces y horas."""
        registrados = [
            {
                "archivo": "boe-rd-2011-645.html",
                "url": "https://www.boe.es/buscar/act.php?id=BOE-A-2011-9930",
                "descargado_utc": "2026-10-06T14:00:00+00:00",
            },
        ]
        preparados = [
            certificado(nombre_es="Actividades de gestión administrativa", nombre_ca="Activitats de gestió", horas=880),
            certificado(codigo="ADGD0108", nombre_es="x", nombre_ca="y", horas=1),  # sin relación: va igual
            certificado(codigo="EOCH0108", anexo=None),  # sin anexo: no se puede citar su Real Decreto
        ]
        normas = {"horas_nivel_1": {"cifra": None}}
        todas = Relaciones({"4311.1": {"ADGD0308": "ocupacion"}, "9999.1": {}}, {"4311": {}})
        revision = {  # inventada para la prueba
            "regla_sha256": REGLA_DE_EJEMPLO,
            "fecha": "2026-10-20",
            "lista": "datos/revisiones/acreditacion/admitidas.tsv",
            "ids": {"4311.1": {"ADGD0308": "R-0a1b2c3"}},
        }
        with mock.patch.object(piezas_conjunto, "registrados", return_value=registrados):
            conjunto = conjunto_validado(preparados, normas, todas, revision)
        self.assertEqual(conjunto["relaciones"], {"ocupaciones": {"4311.1": [["ADGD0308", "ocupacion"]]}, "grupos": {}})
        self.assertEqual(conjunto["revision"], revision, "cada relación del paquete con la procedencia de su revisión")
        self.assertEqual(list(conjunto["certificados"]), ["ADGD0308", "ADGD0108"], "el catálogo, no solo los usados")
        exportado = conjunto["certificados"]["ADGD0308"]
        self.assertEqual(exportado["boe"], "https://www.boe.es/buscar/act.php?id=BOE-A-2011-9930")
        self.assertEqual(exportado["unidades"][0]["nombre"], {"es": "Realizar registros contables", "ca": "Registres"})
        self.assertNotIn("ocupaciones", exportado)
        self.assertEqual((conjunto["fecha_boe"], conjunto["horas_nivel_1"]), ("2026-10-06", None))
        self.assertNotIn("sindicatura", conjunto["enlaces"])
        self.assertEqual(
            conjunto["enlaces"]["tramite"]["es"], "https://tramits.gencat.cat/es/tramits/tramits-temes/21900_Acreditat"
        )


class PruebaPuntoDeInformacion(unittest.TestCase):
    """El teléfono de Cornellà sale de la página guardada del Ajuntament, no de un texto del motor."""

    def test_el_telefono_exportado_es_el_de_la_pagina(self) -> None:
        """El paquete lleva el teléfono que cita la página, con su dirección del Ajuntament."""
        punto = punto_de_informacion(PAGINAS_REGISTRADAS)
        pagina = PAGINAS_REGISTRADAS[PUNTO_DE_INFORMACION]
        self.assertEqual(punto["telefono"], "93 474 33 99")
        self.assertIn(f"Tel. {punto['telefono']}", pagina["dice"])
        self.assertTrue(punto["url"].startswith("https://www.cornella.cat/"))

    def test_un_telefono_que_la_pagina_no_dice_no_se_admite(self) -> None:
        """Un teléfono que no está en la cita de la página hace fallar la validación."""
        paginas = {**PAGINAS_REGISTRADAS}
        paginas[PUNTO_DE_INFORMACION] = {**paginas[PUNTO_DE_INFORMACION], "telefono": "93 000 00 00"}
        controles = Controles()
        controles_del_punto_de_informacion(controles, paginas)
        self.assertFalse(controles.admitido)

    def test_no_se_enlaza_en_el_bloque(self) -> None:
        """La página da el teléfono, no un enlace más del bloque."""
        self.assertIn("cornella", SIN_ENLACE)

    def test_control_describe_la_cita_y_huella_registradas(self) -> None:
        """El control técnico dice lo que coteja y no afirma abrir el original de la página."""
        controles = Controles()
        controles_del_punto_de_informacion(controles, PAGINAS_REGISTRADAS)
        self.assertEqual(
            controles.lista,
            [
                {
                    "control": "el teléfono del punto de información de Cornellà (93 474 33 99) está en la cita "
                    "registrada del Ajuntament, con una huella registrada",
                    "resultado": "correcto",
                }
            ],
        )
        pagina = PAGINAS_REGISTRADAS[PUNTO_DE_INFORMACION]
        for cambios in ({"dice": "sin teléfono"}, {"sha256": None}):
            with self.subTest(cambios=cambios):
                controles = Controles()
                controles_del_punto_de_informacion(controles, {PUNTO_DE_INFORMACION: {**pagina, **cambios}})
                self.assertFalse(controles.admitido)


class PruebaEntradasDefectuosas(unittest.TestCase):
    """Regresiones de entradas incompletas: motivo de la fuente y ningún valor inventado."""

    def test_catalogo_vacio_falla_su_control(self) -> None:
        """Un catálogo vacío registra una alarma en vez de dividir por cero."""
        controles = Controles()
        validacion.controles_de_lectura(controles, [], PruebaAlarmas.RESUMEN)
        self.assertFalse(controles.admitido)
        self.assertIn("0 de 0 certificados", " ".join(controles.fallidos))

    def test_cobertura_sin_personas_tiene_motivo(self) -> None:
        """Sin denominador no se inventa una parte ni aparece una traza aritmética."""
        with self.assertRaisesRegex(FormatoInesperado, "acreditacion:.*personas.*positivo"):
            validacion.resumen_de_cobertura({"personas": {"total": 0, "cota_baja": 0, "estimacion": 0, "cota_alta": 0}})

    def test_cifras_del_soc_con_superindices_tienen_motivo(self) -> None:
        """La comprobación isdigit admite superíndices que int rechaza: cada campo identifica el valor defectuoso."""
        fila = {"nivellespecialitat": "2", "hores": "880", "modulformdurada": "120", "unitcompcodi": "UC1"}
        for campo in ("nivellespecialitat", "hores", "modulformdurada"):
            with self.subTest(campo=campo), self.assertRaisesRegex(FormatoInesperado, campo):
                preparacion.certificado_preparado("ADGD0308", [{**fila, campo: "²"}], [], (set(), {}), {})

    def test_certificado_soc_sin_codigo_tiene_motivo(self) -> None:
        """Una fila reconocida como certificado exige su código, sin normalizarlo ni lanzar KeyError."""
        for valor in (None, "", " ", 123):
            with self.subTest(codigo=valor), self.assertRaisesRegex(FormatoInesperado, "SOC.*fila 1.*código"):
                certificados_del_soc([{"certprof": "RD 645/2011", "codiespecialitat": valor}])

    def test_numeros_de_real_decreto_invalidos_tienen_motivo(self) -> None:
        """El mismo contrato de número protege nombres, orden y direcciones."""
        for numero in ("sin numero", "645", "x/2011", "645/11"):
            for funcion in (nombre_de_disposicion, descarga.orden_de_numero, lambda n: url_de_disposicion(n, {})):
                with self.subTest(numero=numero, funcion=funcion), self.assertRaisesRegex(ErrorFuente, "Real Decreto"):
                    funcion(numero)

    def test_archivo_de_real_decreto_invalido_tiene_motivo(self) -> None:
        """Un nombre ajeno al contrato no causa ValueError ni fabrica un número."""
        with self.assertRaisesRegex(ErrorFuente, "archivo.*Real Decreto"):
            numero_del_archivo("boe-rd-2011.html")

    def test_no_se_inventa_fecha_si_falta_titulo(self) -> None:
        """Un consolidado sin título identificable no recibe el primero de enero como fecha real."""
        with (
            mock.patch.object(preparacion, "registrados", return_value=[{"archivo": "boe-rd-2011-645.html"}]),
            mock.patch.object(preparacion, "_lineas", return_value=["sin título"]),
            self.assertRaisesRegex(FormatoInesperado, "boe-rd-2011-645.html.*título"),
        ):
            preparacion.textos_de_los_reales_decretos()

    def test_pdf_sin_consolidado_no_inventa_fecha(self) -> None:
        """El PDF toma la fecha de su consolidado: si falta, se detiene la preparación."""
        with (
            mock.patch.object(preparacion, "registrados", return_value=[{"archivo": "boe-rd-2011-645.pdf"}]),
            mock.patch.object(preparacion, "_lineas", return_value=[]),
            self.assertRaisesRegex(FormatoInesperado, "boe-rd-2011-645.pdf.*fecha.*consolidado"),
        ):
            preparacion.textos_de_los_reales_decretos()

    def test_fecha_registrada_invalida_tiene_motivo(self) -> None:
        """Una fecha ilegible identifica la página registrada que hay que corregir."""
        for valor in ("ayer", None, 123, []):
            with self.subTest(fecha=valor), self.assertRaisesRegex(FormatoInesperado, "tramite.*fecha"):
                avisos_de_paginas({"tramite": {"comprobado": valor, "sha256": {}}}, date(2026, 10, 15))

    def test_fecha_registrada_futura_no_se_acepta(self) -> None:
        """Una comprobación en el futuro no pasa por reciente."""
        with self.assertRaisesRegex(FormatoInesperado, "tramite.*futur"):
            avisos_de_paginas({"tramite": {"comprobado": "2027-01-01", "sha256": {}}}, date(2026, 10, 15))


class PruebaProcedenciaDelConjunto(unittest.TestCase):
    """La fecha del BOE y las direcciones salen de sus propias copias, con errores legibles si faltan."""

    def setUp(self) -> None:
        """Aísla el catálogo de oferta, que estas pruebas de procedencia no leen."""
        datos = {"en_la_oferta": [], "no_disponibles": {}, "oferta_actualizada": "2025-09-12"}
        parche = mock.patch.object(piezas_conjunto, "de_cataluna", return_value=datos)
        parche.start()
        self.addCleanup(parche.stop)

    def test_fecha_del_ine_no_cambia_fecha_boe(self) -> None:
        """Una copia del INE más reciente no fecha los textos del BOE."""
        entradas = [
            {
                "archivo": "boe-rd-2011-645.html",
                "url": "https://www.boe.es/x",
                "descargado_utc": "2026-10-06T00:00:00Z",
            },
            {"archivo": "ine-cno11-cno94.xls", "url": "https://www.ine.es/x", "descargado_utc": "2026-10-15T00:00:00Z"},
        ]
        with mock.patch.object(piezas_conjunto, "registrados", return_value=entradas):
            conjunto = conjunto_validado([], {"horas_nivel_1": {"cifra": None}}, Relaciones({}, {}), {})
        self.assertEqual(conjunto["fecha_boe"], "2026-10-06")

    def test_sin_copias_del_boe_tiene_motivo(self) -> None:
        """Sin copias no se intenta max sobre una lista vacía."""
        with (
            mock.patch.object(piezas_conjunto, "registrados", return_value=[]),
            self.assertRaisesRegex(FormatoInesperado, "acreditacion:.*copias.*BOE"),
        ):
            conjunto_validado([], {"horas_nivel_1": {"cifra": None}}, Relaciones({}, {}), {})

    def test_certificado_sin_direccion_del_boe_tiene_motivo(self) -> None:
        """Una procedencia incompleta identifica el real decreto sin dirección."""
        entradas = [{"archivo": "boe-rd-2011-1.html", "url": "https://www.boe.es/x", "descargado_utc": "2026-10-06"}]
        with (
            mock.patch.object(piezas_conjunto, "registrados", return_value=entradas),
            self.assertRaisesRegex(FormatoInesperado, "645/2011.*dirección|dirección.*645/2011"),
        ):
            conjunto_validado(
                [certificado(nombre_es="Gestión", nombre_ca="Gestió", horas=880)],
                {"horas_nivel_1": {"cifra": None}},
                Relaciones({}, {}),
                {},
            )
