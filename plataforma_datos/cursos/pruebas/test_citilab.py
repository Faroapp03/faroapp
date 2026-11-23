"""Pruebas de la fuente de Citilab: los hechos que se sacan del texto de cada ficha y las fichas que no se usan."""

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

import plataforma_datos.cursos.fuentes.citilab.lector as citilab
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.fuentes.citilab import lectura_de_fechas, paginacion

# Una ficha como la publica la API de Citilab: secciones con encabezados y estilos por medio (texto inventado).
CONTENIDO = """
<h2 class="kt-adv-heading">DESCRIPCIÓ</h2><style>.x{color:red}</style><p>Un curs per començar.</p>
<h2>INFORMACIÓ ÚTIL</h2>
<p><strong>OBJECTIUS</strong></p><ul><li>Afavorir l&#8217;autonomia</li></ul>
<p><strong>A QUI S&#8217;ADREÇA?</strong></p><p>Públic adult</p>
<p><strong>MODALITAT</strong></p><p>Presencial</p>
<p><strong>PRE-REQUISITS</strong></p><p>Cap, més enllà de tenir interès en les noves tecnologies.</p>
<p><strong>DURADA I HORARI</strong></p>
<p>32 hores (16 sessions)</p>
<p>Grup de matí: dimarts i dijous, de 11:00 a 13:00 hores</p>
<p>Grup de tarda: dimarts i dijous, de 16:00 a 18:00 hores</p>
<p>Inici (primera sessió): 1 d&#8217;octubre de 2026</p>
<p>Final (última sessió): 24 de novembre de 2026</p>
<p><strong>COST</strong></p><p>Gratuït. Cal tenir el carnet de Citilaber.</p>
<h2>LLOC</h2><p>Citilab<br>Pl. Can Suris, s/n<br>Cornellà, Barcelona 08940 Espanya<br>Tel. +34 93 551 06 60</p>
"""
VOCABULARIOS = {"public": {541: "adults", 562: "8-12-anys"}, "tipus-formacio": {537: "competencies-digitals"}}


def ficha(**cambios: object) -> dict[str, Any]:
    """Una ficha de la API con el contenido de prueba y lo que se cambie.

    Args:
        **cambios: Los campos de la ficha que sustituyen a los de base.

    Returns:
        La ficha de la API con el contenido de prueba.
    """
    base = {
        "id": 1,
        "modified": "2026-09-29T09:51:16",
        "link": "https://www.citilab.eu/formacio-tecnologia-informacio-comunicacio/iniciat/",
        "title": {"rendered": "Inicia&#8217;t al món digital"},
        "content": {"rendered": CONTENIDO},
        "public": [541],
        "tipus-formacio": [537],
    }
    return {**base, **cambios}


class PruebaHechosDeLaFicha(unittest.TestCase):
    """Lo que se lee de una ficha completa."""

    def test_de_una_ficha_completa_se_leen_todos_los_hechos(self) -> None:
        """Título, público, modalidad, requisitos, horas, fechas, horario, coste y lugar, sin descripción."""
        hechos = citilab.hechos(ficha(), VOCABULARIOS)
        self.assertEqual(hechos["titulo"], "Inicia’t al món digital")
        self.assertEqual(hechos["publico"], ["adults"])
        self.assertEqual((hechos["modalidad"], hechos["requisitos"]), ("presencial", "ninguno"))
        self.assertEqual((hechos["horas"], hechos["sesiones"]), (32.0, 16.0))
        self.assertEqual((hechos["inicio"], hechos["fin"], hechos["periodico"]), ("2026-10-01", "2026-11-24", False))
        self.assertEqual(
            hechos["horario"],
            [
                {"dias": [2, 4], "desde": "11:00", "hasta": "13:00", "a_distancia": False},
                {"dias": [2, 4], "desde": "16:00", "hasta": "18:00", "a_distancia": False},
            ],
        )
        self.assertEqual(
            hechos["coste"],
            {"gratuito": True, "precio_eur": None, "carnet_citilaber": True, "descuento_paro_pct": None},
        )
        self.assertEqual(hechos["lugar"]["municipio"], "Cornellà")
        self.assertNotIn("Un curs per començar", str(hechos))
        self.assertIsNone(citilab.motivo_de_exclusion(hechos))

    def test_las_fichas_que_no_se_usan(self) -> None:
        """En castellano o solo para infancia y juventud, con su motivo."""
        castellano = citilab.hechos(ficha(link="https://www.citilab.eu/es/formacio-x/"), VOCABULARIOS)
        self.assertEqual(citilab.motivo_de_exclusion(castellano), "en-castellano")
        infancia = citilab.hechos(ficha(public=[562]), VOCABULARIOS)
        self.assertEqual(citilab.motivo_de_exclusion(infancia), "solo-infancia-y-juventud")


class PruebaPiezas(unittest.TestCase):
    """Cada lectura, con los casos reales que plantean dudas; lo que no se lee con seguridad queda en None."""

    def test_inicio_y_final_mandan_sobre_las_sesiones(self) -> None:
        """«Inici» y «Final» mandan; sin ellas, la primera y la última de las sesiones; con una sola, solo el inicio."""
        self.assertEqual(citilab.fecha("Inici (primera sessió): 28 de setembre de 2026"), "2026-09-28")
        self.assertEqual(citilab.fecha("20 d'octubre de 2026, de 17:15h a 18:45h"), "2026-10-20")
        sesiones = ["De setembre a octubre", "20 d'octubre de 2026, de 17:15h a 18:45h", "10 de novembre de 2026"]
        self.assertEqual(citilab.fechas(sesiones), ("2026-10-20", "2026-11-10"))
        self.assertEqual(citilab.fechas(["Inici (primera sessió): 24 de setembre de 2026"]), ("2026-09-24", None))
        self.assertEqual(citilab.fechas(["6 hores en total: 4 sessions"]), (None, None))

    def test_una_franja_sin_dias_no_se_da(self) -> None:
        """Días de una línea anterior, horas sin minutos y franjas a distancia; si una franja no tiene días, None."""
        self.assertEqual(
            citilab.horario(["Cada divendres:", "de 10:00 a 12:00 hores."]),
            [{"dias": [5], "desde": "10:00", "hasta": "12:00", "a_distancia": False}],
        )
        self.assertEqual(
            citilab.horario(["Dimarts, d'11 a 13 hores"]),
            [{"dias": [2], "desde": "11:00", "hasta": "13:00", "a_distancia": False}],
        )
        self.assertTrue(citilab.horario(["Atenció virtual: divendres, de 16:00 a 18:00 hores"])[0]["a_distancia"])
        self.assertIsNone(citilab.horario(["De 10:00 a 12:00 hores"]))
        self.assertIsNone(citilab.horario(["Servei permanent obert a peticions"]))

    def test_el_coste_es_gratuito_de_pago_o_se_desconoce(self) -> None:
        """Gratuito, con precio y descuento, o sin dejarlo claro (None)."""
        self.assertTrue(citilab.coste(["Gratuït."])["gratuito"])
        de_pago = citilab.coste(["75 euros/persona", "50% de descompte per a adults a l'atur o jubilats."])
        self.assertEqual(
            (de_pago["gratuito"], de_pago["precio_eur"], de_pago["descuento_paro_pct"]), (False, 75.0, 50.0)
        )
        self.assertIsNone(citilab.coste(["Variable en funció de cada formació."])["gratuito"])
        self.assertIsNone(citilab.coste(["Cal consultar. Contacta'ns."])["gratuito"])

    def test_requisitos_por_su_texto(self) -> None:
        """Autoevaluación es «prueba»; otro requisito, «otros»; sin texto, se desconoce (None)."""
        self.assertEqual(citilab.requisitos(["Fer el test d'autoavaluació"]), "prueba")
        self.assertEqual(citilab.requisitos(["Tenir competències digitals bàsiques"]), "otros")
        self.assertIsNone(citilab.requisitos([]))

    def test_modalidad_solo_si_es_clara(self) -> None:
        """«En línia», aunque tenga apoyo presencial, es en línea; «Híbrida» no dice cuál es."""
        self.assertEqual(citilab.modalidad(["En línia (amb suport presencial)"]), "en-linea")
        self.assertIsNone(citilab.modalidad(["Híbrida"]))

    def test_lugar_sin_su_forma_no_vale(self) -> None:
        """Un lugar sin nombre, dirección y municipio con su código postal (solo «Citilab») no se da."""
        self.assertIsNone(citilab.lugar(["Citilab"]))
        self.assertIsNone(citilab.lugar(["Citilab", "Pl. Can Suris, s/n", "Cornellà, Barcelona Espanya"]))

    def test_lugar_con_su_forma_da_nombre_direccion_municipio_y_codigo_postal(self) -> None:
        """Un lugar con las tres primeras líneas completas da sus cuatro campos."""
        self.assertEqual(
            citilab.lugar(["Citilab", "Pl. Can Suris, s/n", "Cornellà, Barcelona 08940 Espanya"]),
            {
                "nombre": "Citilab",
                "direccion": "Pl. Can Suris, s/n",
                "municipio": "Cornellà",
                "codigo_postal": "08940",
            },
        )

    def test_la_ia_cuenta_como_palabra_no_dentro_de_otra(self) -> None:
        """«IA» en el título o la inteligencia artificial en la descripción cuentan; «2D» o «anys» no la contienen."""
        self.assertTrue(citilab.trata_la_ia("Programa IA", []))
        self.assertTrue(citilab.trata_la_ia("Curs", ["Aprendre els orígens de la Intel·ligència Artificial."]))
        self.assertFalse(citilab.trata_la_ia("Fabricació 2D", ["Tenir 16 anys"]))


class PruebaTextoNormalizado(unittest.TestCase):
    """La línea normalizada tiene apóstrofos rectos y espacios simples, también los de no separación."""

    def test_el_espacio_de_no_separacion_se_junta_como_cualquier_otro(self) -> None:
        """U+00A0 y los espacios repetidos pasan a un solo espacio; el apóstrofo tipográfico, al recto."""
        self.assertEqual(citilab.normalizar("A\u00a0QUI  S\u2019ADREÇA?"), "A QUI S'ADREÇA?")

    def test_un_termino_que_no_esta_en_el_vocabulario_lleva_el_prefijo_de_desconocido(self) -> None:
        """El término sin vocabulario no se pierde: lleva PREFIJO_DESCONOCIDO, que el control de validar detecta."""
        ficha = {
            "id": 1,
            "title": {"rendered": "Curs"},
            "content": {"rendered": "<p>x</p>"},
            "link": "https://www.citilab.eu/curs/",
            "modified": "2026-01-01T00:00:00",
            "public": [99],
            "tipus-formacio": [],
        }
        curso = citilab.hechos(ficha, {"public": {}, "tipus-formacio": {}})
        self.assertEqual(curso["publico"], [f"{citilab.PREFIJO_DESCONOCIDO}99"])


class PruebaLoQueNoSeLeeConSeguridad(unittest.TestCase):
    """Una errata de la web deja el dato vacío; una ficha con otra forma se rechaza diciendo cuál."""

    def test_una_fecha_imposible_queda_sin_fecha(self) -> None:
        """«31 de febrer» o «0 d'octubre» no se inventan ni detienen la copia: no hay fecha."""
        self.assertIsNone(citilab.fecha("Inici: 31 de febrer de 2026"))
        self.assertIsNone(citilab.fecha("Inici: 0 d'octubre de 2026"))
        self.assertEqual(citilab.fecha("Inici: 28 de febrer de 2026"), "2026-02-28")

    def test_cap_como_palabra(self) -> None:
        """«Cap» es «ninguno»; «Capacitat…» es un requisito."""
        self.assertEqual(citilab.requisitos(["Cap."]), "ninguno")
        self.assertEqual(citilab.requisitos(["Capacitat per fer servir l'ordinador"]), "otros")

    def test_una_ficha_sin_su_forma(self) -> None:
        """Una ficha sin título renderizado o con el público en otra forma se rechaza con su id."""
        buena = {
            "id": 7,
            "title": {"rendered": "Curs"},
            "content": {"rendered": "<p>Text</p>"},
            "link": "https://www.citilab.eu/formacio/curs/",
            "modified": "2026-10-01T10:00:00",
            "public": [],
            "tipus-formacio": [],
        }
        vocabularios = {"public": {}, "tipus-formacio": {}}
        self.assertEqual(citilab.hechos(buena, vocabularios)["titulo"], "Curs")
        for campo, valor in (("title", "Curs"), ("public", None), ("link", None)):
            with self.subTest(campo=campo), self.assertRaisesRegex(FormatoInesperado, "ficha 7"):
                citilab.hechos({**buena, campo: valor}, vocabularios)


class PruebaFronteraDeLaApi(unittest.TestCase):
    """La forma externa se rechaza con un motivo antes de extraer hechos."""

    def test_el_id_de_la_ficha_debe_ser_un_entero_positivo(self) -> None:
        """Id ausente, nulo, texto, fracción, booleano o no positivo no llega al paquete."""
        sin_id = ficha()
        del sin_id["id"]
        entradas = [sin_id, *(ficha(id=valor) for valor in (None, "1", 1.5, True, 0, -1, []))]
        for entrada in entradas:
            with self.subTest(id=entrada.get("id")), self.assertRaisesRegex(FormatoInesperado, "id"):
                citilab.hechos(entrada, VOCABULARIOS)

    def test_los_terminos_de_taxonomia_deben_ser_enteros_positivos(self) -> None:
        """No se aceptan claves no hashables ni tipos que se confunden con ids numéricos."""
        for campo in ("public", "tipus-formacio"):
            for valor in ([], {}, None, "541", 541.0, True, 0, -1):
                with self.subTest(campo=campo, valor=valor), self.assertRaisesRegex(FormatoInesperado, campo):
                    citilab.hechos(ficha(**{campo: [valor]}), VOCABULARIOS)

    def test_la_copia_exige_una_lista_de_fichas(self) -> None:
        """Otra raíz JSON se rechaza con el nombre del recurso, antes de iterar fichas."""
        for valor in (None, 3, {}, "fichas"):
            with (
                self.subTest(valor=valor),
                mock.patch.object(citilab, "procedencia", return_value={"copia": "2026-10-06"}),
                mock.patch.object(paginacion, "ultimo_original"),
                mock.patch.object(paginacion, "leer_json", side_effect=[valor, [], []]),
                self.assertRaisesRegex(FormatoInesperado, "formacio"),
            ):
                citilab.leer_copia()

    def test_los_vocabularios_rechazan_terminos_sin_id_y_slug_validos(self) -> None:
        """La API debe dar listas de objetos con ids únicos positivos y slugs de texto."""
        vocabulario_valido = [{"id": 541, "slug": "adults"}]
        invalidos = (
            None,
            {},
            [None],
            [{}],
            [{"id": [], "slug": "adults"}],
            [{"id": True, "slug": "adults"}],
            [{"id": 0, "slug": "adults"}],
            [{"id": 541, "slug": None}],
            [{"id": 541, "slug": ""}],
            [*vocabulario_valido, {"id": 541, "slug": "otro-publico"}],
        )
        for recurso in citilab.VOCABULARIOS:
            for valor in invalidos:
                recursos = {"public": vocabulario_valido, "tipus-formacio": []}
                recursos[recurso] = valor
                with (
                    self.subTest(recurso=recurso, valor=valor),
                    mock.patch.object(citilab, "procedencia", return_value={"copia": "2026-10-06"}),
                    mock.patch.object(paginacion, "ultimo_original"),
                    mock.patch.object(
                        paginacion, "leer_json", side_effect=[[], recursos["public"], recursos["tipus-formacio"]]
                    ),
                    self.assertRaisesRegex(FormatoInesperado, recurso),
                ):
                    citilab.leer_copia()

    def test_una_copia_con_vocabularios_validos_conserva_ids_y_slugs(self) -> None:
        """El contrato de lectura no convierte claves ni reordena fichas."""
        fichas = [ficha(id=2), ficha(id=1)]
        with (
            mock.patch.object(citilab, "procedencia", return_value={"copia": "2026-10-06"}),
            mock.patch.object(paginacion, "ultimo_original"),
            mock.patch.object(paginacion, "leer_json", side_effect=[fichas, [{"id": 541, "slug": "adults"}], []]),
        ):
            copia = citilab.leer_copia()
        self.assertEqual(copia, ("2026-10-06", fichas, {"public": {541: "adults"}, "tipus-formacio": {}}))

    def test_preparar_rechaza_fichas_con_id_repetido_antes_de_guardar(self) -> None:
        """Dos fichas distintas no pueden compartir la identidad de una opción o ficha HTML."""
        fichas = [ficha(id=1), ficha(id=1, title={"rendered": "Otro curso"})]
        with (
            mock.patch.object(citilab, "leer_copia", return_value=("2026-10-06", fichas, VOCABULARIOS)),
            mock.patch.object(citilab, "guardar_json") as guardar,
            self.assertRaisesRegex(FormatoInesperado, "identificadores.*repetidos"),
        ):
            citilab.preparar()
        guardar.assert_not_called()

    def test_la_validacion_rechaza_ids_repetidos_en_un_preparado_modificado(self) -> None:
        """La precondición de identidad también protege validar de un preparado modificado."""
        cursos = [
            {**citilab.hechos(ficha(id=1), VOCABULARIOS), "excluido": None},
            {**citilab.hechos(ficha(id=1, title={"rendered": "Otro curso"}), VOCABULARIOS), "excluido": None},
        ]
        with (
            mock.patch.object(citilab, "procedencia", return_value={"copia": "2026-10-06"}),
            mock.patch.object(citilab, "controles_de_huella"),
            self.assertRaisesRegex(FormatoInesperado, "identificadores.*repetidos"),
        ):
            citilab._controles({"copia": "2026-10-06", "cursos": cursos})

    def test_las_horas_imposibles_o_invertidas_dejan_el_horario_sin_dato(self) -> None:
        """Una franja ilegible deja vacío el horario completo, sin inventar otra franja."""
        for franja in ("de 25 a 30", "de 10:99 a 12", "de 10 a 24", "de 12 a 10", "de 10 a 10"):
            with self.subTest(franja=franja):
                self.assertIsNone(citilab.horario(["Dilluns, de 8 a 9", f"Dimarts, {franja}"]))

    def test_el_limite_del_dia_y_los_minutos_validos_se_conservan(self) -> None:
        """00:00 y 23:59 son límites válidos y no cambian los hechos de una franja."""
        self.assertEqual(
            citilab.horario(["Dilluns, de 0:00 a 23:59"]),
            [{"dias": [1], "desde": "00:00", "hasta": "23:59", "a_distancia": False}],
        )

    def test_las_exclusiones_con_el_mismo_titulo_conservan_cada_ficha(self) -> None:
        """El diagnóstico distingue ids aunque dos exclusiones tengan el mismo título."""
        cursos = [
            {
                **citilab.hechos(ficha(id=identificador, public=[562]), VOCABULARIOS),
                "excluido": "solo-infancia-y-juventud",
            }
            for identificador in (1, 2)
        ]
        with (
            mock.patch.object(
                citilab, "leer_json", return_value={"copia": "2026-10-06", "cursos": cursos, "lectura_de_fechas": []}
            ),
            mock.patch.object(citilab, "_controles", return_value=citilab.Controles()),
            mock.patch.object(citilab, "guardar_pendientes"),
            mock.patch.object(citilab, "cerrar_validacion") as cerrar,
        ):
            citilab.validar()
        informe = cerrar.call_args.args[1]
        self.assertEqual(
            informe["cobertura"]["excluidas"],
            [
                {"id": identificador, "titulo": "Inicia’t al món digital", "motivo": "solo-infancia-y-juventud"}
                for identificador in (1, 2)
            ],
        )


class PruebaRangosYListasDeSesiones(unittest.TestCase):
    """Un rango o una lista de días con un mismo mes da inicio, el primero, y fin, el último."""

    def test_rango_lista_y_dos_fechas_en_una_linea(self) -> None:
        """«Del 3 al 5», «3, 10 i 17» y «entre … i …» ya no dejan el fin vacío."""
        for linea, esperado in (
            ("Del 3 al 5 de març de 2026", ("2026-03-03", "2026-03-05")),
            ("Sessions: 3, 10 i 17 de març de 2026", ("2026-03-03", "2026-03-17")),
            ("entre el 13 d'octubre de 2026 i el 10 de juny de 2027", ("2026-10-13", "2027-06-10")),
            ("20 d'octubre de 2026, de 17:15h a 18:45h", ("2026-10-20", None)),
        ):
            with self.subTest(linea=linea):
                self.assertEqual(citilab.fechas([linea]), esperado)

    def test_numeros_que_no_son_dias_no_se_leen_como_fechas(self) -> None:
        """Un grupo, una sesión, unas plazas o una franja horaria antes de la fecha no inventan días: solo la fecha."""
        for linea, esperado in (
            ("Grup 1, 3 de març de 2026", ["2026-03-03"]),
            ("Sessió 2, 10 de març de 2026", ["2026-03-10"]),
            ("Places: 15, 3 de març de 2026", ["2026-03-03"]),
            ("Dijous de 16 a 18, 5 de març de 2026", ["2026-03-05"]),
            ("De 10 a 12 i 3 de març de 2026", ["2026-03-03"]),
            ("Els dies 3 i 5 de març de 2026", ["2026-03-03", "2026-03-05"]),
        ):
            with self.subTest(linea=linea):
                self.assertEqual(citilab.fechas_de_linea(linea), esperado)

    def test_un_dia_imposible_de_la_lista_no_se_inventa(self) -> None:
        """«30 i 31 de febrer» no da fechas; los demás días válidos de la lista sí."""
        self.assertEqual(citilab.fechas_de_linea("27, 28 i 31 de febrer de 2026"), ["2026-02-27", "2026-02-28"])


class PruebaLecturaDeFechasSostenida(unittest.TestCase):
    """Se detecta que el lector deja de reconocer fechas que la ficha trae, no que cambie cuántos cursos tienen fin."""

    # Fichas como las de Citilab: con inicio y final, periódicas (sin fechas) y con fechas en otra redacción.
    CON_FIN = CONTENIDO
    PERIODICA = CONTENIDO.replace("<p>Inici (primera sessió): 1 d&#8217;octubre de 2026</p>", "").replace(
        "<p>Final (última sessió): 24 de novembre de 2026</p>", ""
    )
    SIN_ANYO = CONTENIDO.replace("1 d&#8217;octubre de 2026", "1 d&#8217;octubre").replace(
        "24 de novembre de 2026", "24 de novembre"
    )

    def _preparados(self, contenidos: list[str]) -> dict[str, Any]:
        """Prepara cursos y su lectura de fechas como lo hace `preparar`, desde fichas de prueba.

        Returns:
            La copia preparada, con los hechos y la lectura de fechas de cada ficha.
        """
        fichas = [ficha(id=numero, content={"rendered": texto}) for numero, texto in enumerate(contenidos, 1)]
        cursos = [{**citilab.hechos(f, VOCABULARIOS), "excluido": None} for f in fichas]
        lectura = [
            lectura_de_fechas.revision_de_fechas(
                f["id"], f["content"]["rendered"], citilab._duracion(f), c["inicio"], c["fin"]
            )
            for f, c in zip(fichas, cursos, strict=True)
        ]
        return {"copia": "2026-10-06", "cursos": cursos, "lectura_de_fechas": lectura}

    def _controles(self, preparados: dict[str, Any], carpeta: Path) -> citilab.Controles:
        """Ejecuta los controles reales con una carpeta de originales propia.

        Returns:
            Los controles de la copia.
        """
        with (
            mock.patch.object(citilab, "procedencia", return_value={"copia": "2026-10-06"}),
            mock.patch.object(citilab, "controles_de_huella"),
            mock.patch.object(citilab, "ORIGINAL", carpeta),
        ):
            return citilab._controles(preparados)

    def test_la_muestra_real_admite_cursos_que_terminan_o_periodicos_nuevos(self) -> None:
        """De 3 con fin entre 9 a 2 entre 8, o a 3 entre 12, no ha cambiado la redacción: no se detiene."""
        with tempfile.TemporaryDirectory() as temporal:
            for con_fin, periodicas in ((3, 6), (2, 6), (3, 9)):
                with self.subTest(con_fin=con_fin, cursos=con_fin + periodicas):
                    preparados = self._preparados([self.CON_FIN] * con_fin + [self.PERIODICA] * periodicas)
                    self.assertEqual(sum(c["fin"] is not None for c in preparados["cursos"]), con_fin)
                    controles = self._controles(preparados, Path(temporal))
                    self.assertTrue(controles.admitido, controles.fallidos)

    def test_fechas_en_otra_redaccion_detienen_la_validacion(self) -> None:
        """Una ficha que nombra fechas sin el año se queda sin fin: el control falla y nombra la ficha."""
        with tempfile.TemporaryDirectory() as temporal:
            preparados = self._preparados([self.CON_FIN] * 3 + [self.PERIODICA] * 5 + [self.SIN_ANYO])
            controles = self._controles(preparados, Path(temporal))
        self.assertFalse(controles.admitido)
        self.assertTrue(any("ids 9" in fallo for fallo in controles.fallidos), controles.fallidos)

    @staticmethod
    def _duracion(*lineas: str) -> str:
        """Una ficha de público adulto con solo estas líneas en «DURADA I HORARI».

        Returns:
            El HTML de la ficha.
        """
        cabecera = (
            "<p><strong>A QUI S&#8217;ADREÇA?</strong></p><p>Públic adult</p><p><strong>DURADA I HORARI</strong></p>"
        )
        return cabecera + "".join(f"<p>{linea}</p>" for linea in lineas)

    def _avisa(self, *lineas: str) -> bool:
        """Si la lectura de fechas de una ficha con esa duración pide revisarla.

        Returns:
            El aviso de la ficha.
        """
        return self._preparados([self._duracion(*lineas)])["lectura_de_fechas"][0]["fechas_sin_leer"]

    def test_otras_redacciones_del_fin_avisan(self) -> None:
        """Numéricas, abreviadas, en castellano o con el inicio leído y el final no: el fin queda vacío y se avisa."""
        for lineas in (
            ("Inici: 01/10/2026", "Final: 24/11/2026"),
            ("Final: 24 de nov. de 2026",),
            ("Inicio: 1 de octubre de 2026", "Final: 24 de noviembre de 2026"),
            ("Inici: 1 d&#8217;octubre de 2026", "Final: 24/11/2026"),
            ("Inici: 1 d&#8217;octubre", "Final: 24 de novembre"),
            ("Final: 24-11-26",),
        ):
            with self.subTest(lineas=lineas):
                self.assertTrue(self._avisa(*lineas))

    def test_fechas_leidas_o_ausentes_no_avisan(self) -> None:
        """Un curso de un día, uno periódico, días de la semana o meses sin día no piden revisión."""
        for lineas in (
            ("Data: 15 d&#8217;octubre de 2026, de 10:00 a 12:00 hores",),
            ("Formació contínua (1 dia a la setmana)", "Dimarts, d&#8217;11 a 13 hores"),
            ("Dilluns, dimarts i dijous, de 16:00 a 18:00 hores",),
            ("16 hores: 16 sessions", "De setembre a gener", "Dilluns de 17:15 a 18:15h"),
            ("Dimarts de 16 a 18 h, d&#8217;octubre a desembre",),
            ("4 dimarts de març, de 10 a 12 h",),
            ("Dimarts 10.00-12.00 h",),
            ("Inici: 1 d&#8217;octubre de 2026", "Final: 24 de novembre de 2026"),
        ):
            with self.subTest(lineas=lineas):
                self.assertFalse(self._avisa(*lineas))

    def test_confirmar_la_lista_revisada_la_admite_solo_para_ese_texto(self) -> None:
        """Una persona confirma con la huella de la lista; si la ficha cambia, vuelve a detenerse."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            preparados = self._preparados([self.CON_FIN, self.SIN_ANYO])
            pendientes = lectura_de_fechas.fichas_sin_confirmar(preparados, {1, 2}, carpeta)
            lectura_de_fechas.guardar_pendientes(carpeta, pendientes)
            with self.assertRaisesRegex(FormatoInesperado, "no son las revisadas"):
                lectura_de_fechas.confirmar(carpeta, "0" * 64)
            huella = lectura_de_fechas.huella_de_pendientes(pendientes)
            self.assertEqual(lectura_de_fechas.confirmar(carpeta, huella), 1)
            lectura_de_fechas.guardar_pendientes(carpeta, pendientes)
            self.assertEqual(lectura_de_fechas.confirmar(carpeta, huella), 1)
            confirmadas = json.loads((carpeta / lectura_de_fechas.CONFIRMADAS).read_text())["fichas"]
            self.assertEqual(len(confirmadas), 1)
            self.assertFalse((carpeta / lectura_de_fechas.PENDIENTES).exists())
            self.assertTrue(self._controles(preparados, carpeta).admitido)
            cambiada = self._preparados([self.CON_FIN, self.SIN_ANYO.replace("Grup de matí", "Grup del matí")])
            self.assertFalse(self._controles(cambiada, carpeta).admitido)
            with self.assertRaisesRegex(FormatoInesperado, "no hay fichas pendientes"):
                lectura_de_fechas.confirmar(carpeta, huella)

    def test_sin_lectura_de_fechas_hay_que_volver_a_preparar(self) -> None:
        """Una copia preparada sin la lectura de fechas no pasa en silencio."""
        with (
            tempfile.TemporaryDirectory() as temporal,
            self.assertRaisesRegex(FormatoInesperado, "vuelve a prepararla"),
        ):
            lectura_de_fechas.fichas_sin_confirmar({"cursos": []}, set(), Path(temporal))


if __name__ == "__main__":
    unittest.main()
