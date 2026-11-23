"""Lectura del BOE y controles de sus piezas de acreditación, sin originales ni red."""

import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.fuentes.acreditacion.piezas.preparacion as preparacion
from plataforma_datos.comun import boe
from plataforma_datos.comun.nucleo import Controles, ErrorFuente, FormatoInesperado
from plataforma_datos.cursos.fuentes.acreditacion.piezas.validacion import controles_de_horas, horas_que_no_cuadran


class PruebaTextosDelBoe(unittest.TestCase):
    """El índice, los títulos y los anexos de certificado, con las variantes que publica el BOE."""

    def test_indice_solo_con_reales_decretos_de_certificados(self) -> None:
        """De las «Referencias anteriores» salen los que nombran sus anexos; el Real Decreto 34/2008, no."""
        pagina = """<h5>Referencias posteriores</h5><ul><li>CITA Real Decreto 1/2020, de 1 de enero (Ref. BOE-A-2020-1).
        </li></ul><h5>Referencias anteriores</h5><ul><li>MODIFICA:<ul>
        <li>arts. 4 a 8 y los apartados III y IV de los anexos del Real Decreto 645/2011, de 9 de mayo (Ref.
        <a href="/x">BOE-A-2011-9930</a>).</li>
        <li>arts. 4 a 8 y los apartados III y IV del anexo del Real Decreto 1535/2011, de 31 de octubre (Ref.
        <a href="/x">BOE-A-2011-19240</a>).</li>
        <li>arts. 2 y 5 y AÑADE el anexo IV al Real Decreto 34/2008, de 18 de enero (Ref. BOE-A-2008-1628).</li>
        </ul></li></ul><h5>Materias</h5>"""
        indice = boe.referencias_anteriores(pagina.encode())
        self.assertEqual(sorted(indice), ["1535/2011", "645/2011"])
        self.assertEqual(indice["645/2011"], boe.Disposicion("645", 2011, "2011-05-09", "BOE-A-2011-9930"))
        # Sin la sección «Materias», la de referencias llega hasta el final, con la última cifra de la última cita.
        al_final = (
            "<h5>Referencias anteriores</h5> del anexo del Real Decreto 1535/2011, de 31 de octubre "
            "(Ref. BOE-A-2011-19240"
        )
        self.assertEqual(boe.referencias_anteriores(al_final.encode())["1535/2011"].boe, "BOE-A-2011-19240")

    def test_titulo_y_pdf_de_una_disposicion(self) -> None:
        """El título da el número y la fecha; el PDF original es el ELI que declara la página."""
        self.assertEqual(
            boe.titulo_de(["Real Decreto 1379/2008, de 1 de agosto, por el que…"]), ("1379/2008", "2008-08-01")
        )
        self.assertIsNone(boe.titulo_de(["Orden de 1 de enero"]))
        pagina = b'<meta about="x" resource="https://www.boe.es/eli/es/rd/2008/08/01/1373/dof/spa/pdf"/>'
        self.assertEqual(boe.enlace_al_pdf(pagina), "https://www.boe.es/eli/es/rd/2008/08/01/1373/dof/spa/pdf")
        self.assertIsNone(boe.enlace_al_pdf(b'<a href="/boe/dias/2008/09/04/pdfs/A1.pdf">PDF</a>'))

    def test_anexo_con_las_variantes_del_boe(self) -> None:
        """Código en minúsculas, unidades partidas, título en dos renglones, viñetas y la nota de género."""
        lineas = [
            "Denominación: Atención sociosanitaria a personas",
            "en el domicilio.",
            "Código: sscs0108",
            "Nivel de cualificación profesional: 2",
            "Relación de unidades de competencia que configuran el certificado de profesionalidad:",
            "UC0249_2: Desarrollar intervenciones de atención física",
            "domiciliaria.",
            "UC0250 2: Desarrollar intervenciones psicosociales.",
            "Competencia general:",
            "Ocupaciones y puestos de trabajo",
            "relacionados.",
            "Los términos de la siguiente relación de ocupaciones se utilizan con carácter genérico.",
            "51130024 Auxiliar de ayuda a domicilio",
            "− 5710.1013 Asistentes domiciliarios.",
            "Cuidador de personas mayores.",
            "Duración de la formación asociada: 600 horas.",
            "Código INAJ0110",
            "Otras ocupaciones o puestos de trabajo relacionados:",
            "8270.001.0 Encargado de industrias alimentarias",
            "Requisitos necesarios para el ejercicio profesional:",
        ]
        anexos = boe.anexos(lineas)
        self.assertEqual(sorted(anexos), ["INAJ0110", "SSCS0108"])
        [anexo] = anexos["SSCS0108"]
        self.assertEqual(anexo.denominacion, "Atención sociosanitaria a personas en el domicilio")
        self.assertEqual(anexo.nivel, 2)
        self.assertEqual(
            anexo.unidades,
            [
                ("UC0249_2", "Desarrollar intervenciones de atención física domiciliaria"),
                ("UC0250_2", "Desarrollar intervenciones psicosociales"),
            ],
        )
        self.assertEqual(
            anexo.ocupaciones,
            [
                boe.Ocupacion("51130024", "Auxiliar de ayuda a domicilio", "8"),
                boe.Ocupacion("57101013", "Asistentes domiciliarios", "4.4"),
                boe.Ocupacion(None, "Cuidador de personas mayores", None),
            ],
        )
        self.assertEqual(
            anexos["INAJ0110"][0].ocupaciones,
            [boe.Ocupacion("82700010", "Encargado de industrias alimentarias", "4.3.1")],
        )

    def test_unidades_sin_texto_de_la_parte_siguiente(self) -> None:
        """El título siguiente sin dos puntos cierra la lista de unidades y no se pega a la última.

        Vale para «Competencia general» sin dos puntos o con punto; varias unidades en un mismo renglón son varias.
        """
        lineas = [
            "Código: IFCT0410",
            "Nivel de cualificación profesional: 3",
            "Relación de unidades de competencia que configuran el certificado de profesionalidad:",
            "UC0228_3: Diseñar la infraestructura de red telemática.UC0229_3: Coordinar la implantación de la "
            "infraestructura de red telemática. UC0230_3: Administrar la infraestructura de red telemática.",
            "UC0997_3: Colaborar en el análisis de la investigación de mercados",
            "Competencia general",
            "Intervenir, bajo la supervisión del equipo director de la investigación, en la organización.",
            "Entorno Profesional:",
            "Ocupaciones y puestos de trabajo relacionados:",
            "Técnico en redes",
        ]
        [anexo] = boe.anexos(lineas)["IFCT0410"]
        self.assertEqual(
            anexo.unidades,
            [
                ("UC0228_3", "Diseñar la infraestructura de red telemática"),
                ("UC0229_3", "Coordinar la implantación de la infraestructura de red telemática"),
                ("UC0230_3", "Administrar la infraestructura de red telemática"),
                ("UC0997_3", "Colaborar en el análisis de la investigación de mercados"),
            ],
        )
        con_punto = [*lineas[:4], "Competencia general.", *lineas[6:]]
        self.assertEqual(
            boe.anexos(con_punto)["IFCT0410"][0].unidades[-1][1], "Administrar la infraestructura de red telemática"
        )

    def test_codigos_de_unidad_con_espacios_dentro(self) -> None:
        """«UC 1518_3», «UC0875 _3» y «UC1462_ 2» abren cada uno su unidad, con el código normalizado."""
        lineas = [
            "Código: HOTR0110",
            "Relación de unidades de competencia que configuran el certificado de profesionalidad:",
            "UC0711_2: Definir y ejecutar los trabajos de preparación.",
            "UC 1518_3: Gestionar departamentos del área de alojamiento.",
            "UC0875 _3: Gestionar el área de mantenimiento",
            "y sus equipos.",
            "UC1462_ 2: Organizar los procesos de restauración.",
            "UC1463_2: Supervisar la limpieza.",
            "Competencia general:",
            "Ocupaciones o puestos de trabajo relacionados:",
            "Gobernanta",
        ]
        [anexo] = boe.anexos(lineas)["HOTR0110"]
        self.assertEqual(
            anexo.unidades,
            [
                ("UC0711_2", "Definir y ejecutar los trabajos de preparación"),
                ("UC1518_3", "Gestionar departamentos del área de alojamiento"),
                ("UC0875_3", "Gestionar el área de mantenimiento y sus equipos"),
                ("UC1462_2", "Organizar los procesos de restauración"),
                ("UC1463_2", "Supervisar la limpieza"),
            ],
        )
        self.assertEqual(anexo.irregulares, [])

    def test_codigos_de_unidad_con_guion_irregulares_o_solos(self) -> None:
        """El guion separa el nivel; una errata de cifras o sin nivel no se adivina, pero cierra la unidad anterior.

        Un código solo en su renglón (una celda de tabla) abre su unidad, y el nombre del renglón siguiente es suyo.
        """
        lineas = [
            "Código: ADGG0108",
            "Relación de unidades de competencia que configuran el certificado de profesionalidad:",
            "UC2173-3: Planificar la gestión administrativa.UC 0987_3: Gestionar el sistema de información.",
            "UC987_3: Administrar los sistemas de archivo.",
            "UC14789_3: Gestionar documentos.",
            "UC0490 Organizar la agenda",
            "de la dirección.",
            "UC0233_2",
            "Manejar aplicaciones ofimáticas.",
            "Competencia general:",
            "Ocupaciones o puestos de trabajo relacionados:",
            "Secretaria",
        ]
        [anexo] = boe.anexos(lineas)["ADGG0108"]
        self.assertEqual(
            anexo.unidades,
            [
                ("UC2173_3", "Planificar la gestión administrativa"),
                ("UC0987_3", "Gestionar el sistema de información"),
                ("UC0233_2", "Manejar aplicaciones ofimáticas"),
            ],
        )
        self.assertEqual(
            anexo.irregulares,
            [
                ("UC987_3", "Administrar los sistemas de archivo"),
                ("UC14789_3", "Gestionar documentos"),
                ("UC0490", "Organizar la agenda de la dirección"),
            ],
        )
        self.assertEqual(
            boe.nombres_de_unidades(["UC 1518_3: Gestionar departamentos", "UC987_3: Errata"]),
            {"UC1518_3": "Gestionar departamentos"},
        )
        tabla = ["ANEXO XIII–a", "UC 0249_2", "NO", "UC2259 _2", "UC987_2", "NO", "UC2261_2", "ANEXO XIII-b"]
        self.assertEqual(boe.equivalencias(tabla), [("UC0249_2", "NO", "UC2259_2")])

    def test_mismo_codigo_dos_veces(self) -> None:
        """El BOE puede dar el mismo código a dos certificados: se guardan los dos, en su orden."""
        lineas = []
        for nombre in ("Trabajos de carpintería y mueble", "Aserrado de madera"):
            lineas += [f"Denominación: {nombre}", "Código: MAMA0209", "Ocupaciones o puestos de trabajo relacionados:"]
            lineas += ["8209.1077 Montador", "Duración de la formación asociada: 1 horas"]
        anexos = boe.anexos(lineas)
        self.assertEqual(
            [anexo.denominacion for anexo in anexos["MAMA0209"]],
            ["Trabajos de carpintería y mueble", "Aserrado de madera"],
        )

    def test_titulo_de_la_lista_con_erratas_y_notas(self) -> None:
        """«Ocupación o puestos…», «Ocupaciones v puestos…» y «… relevantes Faltan códigos» abren la lista."""
        for titulo in (
            "Ocupación o puestos de trabajo relacionados",
            "Ocupaciones v puestos de trabajo relacionados:",
            "Ocupaciones y puestos de trabajo relevantes Faltan códigos",
            "Ocupaciones o puesto de trabajo relacionados:",
        ):
            with self.subTest(titulo=titulo):
                self.assertTrue(boe.OCUPACIONES.match(titulo))
        self.assertFalse(boe.OCUPACIONES.match("Ocupaciones y puestos de trabajo que se relacionan con el sector"))

    def test_equivalencias_del_real_decreto_151_2022(self) -> None:
        """Cada fila del anexo XIII-a son tres celdas: suprimida, requisitos y equivalente; el XIII-b no cuenta."""
        lineas = [
            "ANEXO XIII–a",
            "Unidad de Competencia suprimida",
            "UC0249_2",
            "NO",
            "UC2259_2",
            "UC0251_2",
            "NO",
            "UC2261_2",
            "ANEXO XIII-b",
            "UC2259_2",
            "NO",
            "UC0249_2",
            "UC2259_2: Desarrollar las intervenciones de atención personal",
        ]
        self.assertEqual(boe.equivalencias(lineas), [("UC0249_2", "NO", "UC2259_2"), ("UC0251_2", "NO", "UC2261_2")])
        self.assertEqual(
            boe.nombres_de_unidades(lineas), {"UC2259_2": "Desarrollar las intervenciones de atención personal"}
        )

    def test_sin_cabeceras_de_pagina(self) -> None:
        """La cabecera de cada página del BOE no entra en la lista de ocupaciones."""
        lineas = [
            "36680 Martes 9 septiembre 2008 BOE núm. 218",
            "BOE núm. 218 Martes 9 septiembre 2008 36681",
            "Albañil",
        ]
        self.assertEqual(boe.sin_cabeceras(lineas), ["Albañil"])


class PruebaHorasDeLosModulos(unittest.TestCase):
    """Las horas de los módulos formativos de un certificado no pueden pasar de las del certificado."""

    @staticmethod
    def _certificado(codigo: str, horas: int | None, modulos: list[int | None]) -> dict[str, object]:
        """Un certificado con sus horas y las de cada uno de sus módulos.

        Returns:
            Certificado con sus horas y sus unidades.
        """
        unidades = [{"codigo": f"UC{posicion}", "horas": horas_modulo} for posicion, horas_modulo in enumerate(modulos)]
        return {"codigo": codigo, "horas": horas, "unidades": unidades}

    def test_los_que_no_cuadran(self) -> None:
        """Solo cuenta un certificado con todas sus cifras y módulos que suman más que él."""
        certificados = [
            self._certificado("AFDA0112", 660, [220, 240, 40, 230]),  # 730 h de módulos frente a 660
            self._certificado("ADGD0108", 630, [120, 150, 200]),  # cuadra: el resto son prácticas
            self._certificado("SINHORAS", None, [100]),  # sin la cifra del certificado no se compara
            self._certificado("UNASOLA", 100, [None, 200]),  # sin alguna cifra de módulo no se compara
        ]
        self.assertEqual(horas_que_no_cuadran(certificados), ["AFDA0112"])

    def test_un_certificado_nuevo_que_no_cuadra_para_la_validacion(self) -> None:
        """Uno nuevo que no cuadra hace fallar el control; uno conocido, no."""
        controles = Controles()
        nuevo = self._certificado("NUEVO0101", 100, [80, 40])
        controles_de_horas(controles, [nuevo])
        self.assertTrue(any("NUEVO0101" in fallo for fallo in controles.fallidos))
        conocido = self._certificado("AFDA0112", 660, [220, 240, 40, 230])
        controles = Controles()
        controles_de_horas(controles, [conocido])
        self.assertEqual(controles.fallidos, [])


class PruebaPiezasDelBoe(unittest.TestCase):
    """Detalles de la lectura del BOE: forma del código, cierre de la lista de unidades y tablas de clasificación."""

    def test_la_forma_del_codigo_es_una_de_las_cuatro_conocidas(self) -> None:
        """Cada línea con código da su forma y sus cifras; sin código, ninguna forma."""
        self.assertEqual(
            boe.separar_codigo_de_ocupacion("4111.1011 Empleados"), boe.Ocupacion("41111011", "Empleados", "4.4")
        )
        self.assertEqual(
            boe.separar_codigo_de_ocupacion("5330.001.0 Peones"), boe.Ocupacion("53300010", "Peones", "4.3.1")
        )
        self.assertEqual(
            boe.separar_codigo_de_ocupacion("41111011 Empleados"), boe.Ocupacion("41111011", "Empleados", "8")
        )
        self.assertEqual(
            boe.separar_codigo_de_ocupacion("Auxiliar de oficina"), boe.Ocupacion(None, "Auxiliar de oficina", None)
        )
        self.assertEqual({forma for forma, _ in boe.FORMAS_DE_CODIGO}, {"4.4", "4.3.1", "8", "4"})

    def test_un_titulo_partido_se_une_con_su_calificativo(self) -> None:
        """«Ocupaciones y puestos de trabajo» + «relacionados.» es el título de la lista; otra línea no."""
        unidas = boe._titulos_enteros(["Ocupaciones y puestos de trabajo", "relevantes:", "Peones"])
        self.assertEqual(unidas, ["Ocupaciones y puestos de trabajo relevantes:", "Peones"])
        self.assertEqual(
            boe._titulos_enteros(["Ocupaciones y puestos de trabajo", "Peones"]),
            [
                "Ocupaciones y puestos de trabajo",
                "Peones",
            ],
        )

    def test_la_lista_de_unidades_se_cierra_con_el_titulo_siguiente(self) -> None:
        """Un título conocido la cierra; un renglón con «:» solo la cierra si ya hay unidades."""
        self.assertTrue(boe._cierra_la_lista("Competencia general:", hay_unidades=False))
        self.assertTrue(boe._cierra_la_lista("Entorno profesional", hay_unidades=True))
        self.assertTrue(boe._cierra_la_lista("algo que acaba en:", hay_unidades=True))
        self.assertFalse(boe._cierra_la_lista("profesionalidad:", hay_unidades=False))

    def test_la_cabecera_de_pagina_acepta_los_dos_ordenes(self) -> None:
        """El día de la semana puede ir antes o después del número del diario."""
        self.assertEqual(boe.sin_cabeceras(["36680 Martes 9 septiembre 2008 BOE núm. 218", "texto"]), ["texto"])
        self.assertEqual(boe.sin_cabeceras(["BOE núm. 218 36680 Martes 9 septiembre 2008", "texto"]), ["texto"])

    def test_las_tablas_de_clasificacion_llevan_nombre(self) -> None:
        """Los grupos de la CNO-11 y la correspondencia de la CNO-94 se leen por nombre y siguen siendo una tupla."""
        tablas = boe.TablasDeClasificacion({"4111"}, {"5330": ["5330"]})
        self.assertEqual(tablas.grupos_cno11, {"4111"})
        self.assertEqual(tablas[1], tablas.correspondencia_cno94)


class PruebaTablaCno94(unittest.TestCase):
    """La tabla CNO-94 → CNO-11 del INE con otra forma se rechaza diciendo qué falta."""

    def leer(self, filas: list[list[str]]) -> dict[str, list[str]]:
        """Lee una tabla inventada como si fuera la del INE.

        Args:
            filas: filas de la hoja.

        Returns:
            La correspondencia leída.
        """
        with (
            mock.patch.object(preparacion, "original", return_value=Path("tabla.xls")),
            mock.patch.object(preparacion, "leer_xls", return_value={"hoja": filas}),
        ):
            return preparacion.correspondencia_cno94()

    def test_cabecera_y_filas(self) -> None:
        """Sin cabecera o con una fila corta: ErrorFuente con el motivo; la tabla buena se lee."""
        cabecera = ["CNO94", "", "", "CNO11"]
        self.assertEqual(self.leer([cabecera, ["1111", "", "", "1120"], []]), {"1111": ["1120"]})
        with self.assertRaisesRegex(ErrorFuente, "cabecera"):
            self.leer([["otra"], ["1111", "", "", "1120"]])
        with self.assertRaisesRegex(ErrorFuente, "fila 2"):
            self.leer([cabecera, ["1111", ""]])


class PruebaEntradasDefectuosasDelBoe(unittest.TestCase):
    """Un texto o una fecha dañados se detienen con el motivo de la fuente."""

    def test_utf8_invalido_da_error_de_formato(self) -> None:
        """Un byte inválido impide extraer texto; el error incluye su posición."""
        with self.assertRaisesRegex(FormatoInesperado, "UTF-8.*3"):
            boe.texto_de_html(b"<p>\xff</p>")

    def test_fecha_imposible_o_mes_desconocido_da_error_de_formato(self) -> None:
        """Las fechas leídas del título y las referencias también pasan la validación de calendario."""
        for fecha in ("31 de febrero", "0 de enero", "32 de mayo", "9 de mesinventado"):
            with self.subTest(fecha=fecha), self.assertRaisesRegex(FormatoInesperado, "fecha.*2022"):
                boe.titulo_de([f"Real Decreto 151/2022, de {fecha}"])
        self.assertEqual(boe.fecha_iso("29", "febrero", "2024"), "2024-02-29")

    def test_una_vineta_sin_ocupacion_da_error_de_formato(self) -> None:
        """Una viñeta o puntuación sola no se registra como una ocupación de texto vacío."""
        for renglon in ("−", "...", "• ."):
            lineas = ["Código: ADGG0108", "Ocupaciones o puestos de trabajo relacionados:", renglon]
            with self.subTest(renglon=renglon), self.assertRaisesRegex(FormatoInesperado, "ocupaci.*vacía"):
                boe.anexos(lineas)
