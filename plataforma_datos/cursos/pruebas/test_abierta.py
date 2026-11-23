"""Pruebas de la formación abierta: el criterio que aplica la validación a cada ficha redactada por Faro."""

import unittest
from contextlib import redirect_stderr
from datetime import date, timedelta
from io import StringIO
from typing import Any
from unittest import mock

import plataforma_datos.cursos.fuentes.abierta.lector as abierta
from plataforma_datos.comun.nucleo import FormatoInesperado

HOY = date(2026, 10, 6)
HOSTS = {"iedra.uned.es", "learn.microsoft.com"}


def documento() -> dict[str, Any]:
    """Documento mínimo inventado, independiente de las fichas manuales operativas.

    Returns:
        Dos fichas nuevas por llamada: una admitida y otra que incumple R7.
    """
    ficha = {
        "id": "ejemplo-admitido",
        "titulo": "Curso digital inventado para pruebas",
        "entidad": "Entidad de ejemplo",
        "titular": "publico",
        "enlace": "https://cursos.example/digital",
        "idioma": "es",
        "traduccion_automatica": False,
        "tema": "digital",
        "area_digcomp": 1,
        "nivel": "A1",
        "horas": 18.75,
        "a_tu_ritmo": True,
        "inicio": "2026-01-01",
        "fin": None,
        "dirigido_a": None,
        "certificado": {"emisor": "Entidad de ejemplo", "precio_eur": 10, "ects": 1.5},
        "comprobado": "2026-10-06",
        "requisitos": {
            requisito: {"cumple": True, "evidencia": "https://cursos.example/evidencia", "nota": "Hecho inventado"}
            for requisito in abierta.REQUISITOS
        },
    }
    excluida = {
        **ficha,
        "id": "ejemplo-excluido",
        "requisitos": {
            **ficha["requisitos"],
            "R7": {
                "cumple": False,
                "evidencia": "https://cursos.example/temario",
                "nota": "Práctica de un producto concreto",
            },
        },
    }
    return {
        "criterio": "v1.1",
        "plataformas": {"cursos.example": {"nota": "Plataforma inventada"}},
        "fichas": [ficha, excluida],
    }


def fallidos(contenido: dict[str, Any], hoy: date = HOY) -> list[str]:
    """Lista los controles que no pasa un documento de fichas el día `hoy`.

    Args:
        contenido: documento de fichas, con la forma del versionado.
        hoy: fecha con la que se juzgan las comprobaciones y los fines publicados.

    Returns:
        Texto de cada control fallido, en el orden en que se comprueban.
    """
    return abierta.controles_de_las_fichas(contenido, hoy).fallidos


class PruebaFichasDeEjemplo(unittest.TestCase):
    """La selección se prueba con hechos inventados y fechas fijas."""

    def test_pasan_todos_los_controles(self) -> None:
        """El documento de ejemplo pasa todos los controles el día de su comprobación."""
        self.assertEqual(fallidos(documento()), [])

    def test_las_que_no_cumplen_r7_no_se_exportan(self) -> None:
        """Las fichas que enseñan a manejar un producto comercial concreto se quedan fuera, con su motivo."""
        exportadas = {ficha["id"] for ficha in abierta.conjunto(documento())["fichas"]}
        no_cumplen = [ficha for ficha in documento()["fichas"] if not ficha["requisitos"]["R7"]["cumple"]]
        # Sin ninguna ficha que incumpla R7 el bucle no afirmaría nada: la prueba exige el caso que dice probar.
        self.assertTrue(no_cumplen, "el documento de ejemplo debe incluir una ficha que incumpla R7")
        for ficha in no_cumplen:
            with self.subTest(ficha=ficha["id"]):
                self.assertNotIn(ficha["id"], exportadas)
                self.assertEqual(abierta.incumplidos(ficha), ["R7"])

    def test_el_paquete_no_lleva_los_requisitos(self) -> None:
        """El paquete solo lleva los hechos de cada ficha: los requisitos y sus notas se quedan en el área operativa."""
        for ficha in abierta.conjunto(documento())["fichas"]:
            self.assertNotIn("requisitos", ficha)


class PruebaControles(unittest.TestCase):
    """Cada control falla con lo que tiene que impedir."""

    def test_una_ficha_con_descripcion_no_pasa(self) -> None:
        """Sin campo de descripción, la ficha no puede copiar textos de la plataforma."""
        contenido = documento()
        contenido["fichas"][0]["descripcion"] = "Texto copiado de la plataforma"
        self.assertIn("cada ficha tiene solo sus campos y valores admitidos", fallidos(contenido))

    def test_un_enlace_con_seguimiento_o_de_otra_plataforma_no_pasa(self) -> None:
        """Afiliación, seguimiento, un fragmento o una plataforma sin registrar hacen fallar el control."""
        enlace = "https://iedra.uned.es/courses/curso/about"
        self.assertTrue(abierta.enlace_limpio(enlace, HOSTS))
        for malo in (f"{enlace}?utm_source=faro", f"{enlace}?aff=1", f"{enlace}#ref", "http://iedra.uned.es/c"):
            self.assertFalse(abierta.enlace_limpio(malo, HOSTS), malo)
        self.assertFalse(abierta.enlace_limpio("https://cursos.example/curso", HOSTS))

    def test_ficha_sin_revisar_200_dias_se_admite_y_sale_al_llegar_su_fin(self) -> None:
        """El tiempo desde la comprobación no retira una ficha; solo su fin publicado la saca del paquete."""
        tarde = HOY + timedelta(days=200)
        for fin in (None, "2027-12-31"):
            with self.subTest(fin=fin):
                contenido = documento()
                contenido["fichas"][0]["fin"] = fin
                self.assertEqual(fallidos(contenido, tarde), [])
                exportadas = abierta.conjunto(contenido, tarde)["fichas"]
                self.assertEqual([ficha["id"] for ficha in exportadas], ["ejemplo-admitido"])
                self.assertEqual(exportadas[0]["comprobado"], "2026-10-06")
        contenido = documento()
        contenido["fichas"].append({**documento()["fichas"][0], "id": "ejemplo-sin-fin"})
        contenido["fichas"][0]["fin"] = "2026-11-30"
        self.assertEqual(fallidos(contenido, tarde), [])
        exportadas = {ficha["id"] for ficha in abierta.conjunto(contenido, tarde)["fichas"]}
        self.assertEqual(exportadas, {"ejemplo-sin-fin"})
        self.assertIn("ejemplo-admitido", {f["id"] for f in abierta.conjunto(contenido, date(2026, 11, 30))["fichas"]})
        terminada = documento()
        terminada["fichas"][0]["fin"] = "2026-11-30"
        self.assertIn("al menos una ficha cumple los diez requisitos", fallidos(terminada, tarde))
        futura = documento()
        futura["fichas"][0]["comprobado"] = "2026-10-07"
        control = "cada ficha admitida, con comprobación no futura, ya iniciada y sin terminar al comprobarla"
        self.assertIn(control, fallidos(futura, HOY))

    def test_la_revision_pendiente_solo_avisa_con_margen(self) -> None:
        """El aviso empieza MARGEN_DE_AVISO días antes de la revisión pendiente y no cambia los controles."""
        pendiente = abierta.revision_pendiente(documento(), HOY)
        self.assertEqual(pendiente, date(2027, 1, 5))
        self.assertIsNone(abierta.aviso_de_revision(documento(), date(2026, 12, 5)))
        aviso = abierta.aviso_de_revision(documento(), date(2026, 12, 6))
        self.assertIn("05/01/2027", aviso or "")
        self.assertIn("30 días", aviso or "")
        self.assertIn("está pendiente", abierta.aviso_de_revision(documento(), pendiente) or "")
        self.assertEqual(fallidos(documento(), pendiente), [])

    def test_una_ficha_terminada_no_cuenta_para_la_revision_pendiente(self) -> None:
        """La revisión solo mira las fichas que se publican ese día: una que pasó su fin publicado ya no se revisa."""
        contenido = documento()
        terminada = {**contenido["fichas"][0], "id": "ejemplo-terminado", "comprobado": "2026-03-01"}
        contenido["fichas"].append({**terminada, "fin": "2026-06-30"})
        self.assertEqual(abierta.revision_pendiente(contenido, HOY), date(2027, 1, 5))
        self.assertIsNone(abierta.aviso_de_revision(contenido, HOY))
        contenido["fichas"][-1] = {**terminada, "fin": "2026-12-31"}
        self.assertEqual(abierta.revision_pendiente(contenido, HOY), date(2026, 5, 31), "sin terminar, sí cuenta")

    def test_la_fecha_de_la_validacion_se_puede_fijar_para_reproducir_una_version(self) -> None:
        """FARO_HOY fija el día de la validación; sin ella, hoy en UTC. Un valor que no es fecha la detiene."""
        self.assertEqual(abierta.dia_de_la_validacion({"FARO_HOY": "2026-10-06"}), date(2026, 10, 6))
        with mock.patch.object(abierta, "hoy_utc", return_value=date(2026, 10, 7)):
            self.assertEqual(abierta.dia_de_la_validacion({}), date(2026, 10, 7))
        with self.assertRaises(FormatoInesperado):
            abierta.dia_de_la_validacion({"FARO_HOY": "6/10/2026"})

    def test_un_requisito_sin_evidencia_no_pasa(self) -> None:
        """Cada requisito declara resultado y evidencia con enlace https; no se consulta su contenido."""
        contenido = documento()
        contenido["fichas"][0]["requisitos"]["R3"]["evidencia"] = "sin enlace"
        self.assertIn("cada requisito, con resultado y evidencia", fallidos(contenido))

    def test_una_nota_que_llama_oficial_a_un_curso_no_pasa(self) -> None:
        """Faro no llama oficial ni acreditado a lo que no lo es."""
        contenido = documento()
        contenido["fichas"][0]["requisitos"]["R1"]["nota"] = "Curso oficial de la UNED."
        self.assertIn("ninguna nota llama oficial o acreditado a un curso", fallidos(contenido))

    def test_sin_ninguna_ficha_que_pase_no_se_admite(self) -> None:
        """Si ninguna ficha cumple el criterio, no hay nada que exportar."""
        contenido = documento()
        for ficha in contenido["fichas"]:
            ficha["requisitos"]["R2"]["cumple"] = False
        self.assertIn("al menos una ficha cumple los diez requisitos", fallidos(contenido))
        self.assertIsNone(abierta.revision_pendiente(contenido, HOY))
        self.assertIsNone(abierta.aviso_de_revision(contenido, HOY))

    def test_una_ficha_mal_redactada_es_un_control_fallido_y_no_una_traza(self) -> None:
        """Campos que faltan, tipos equivocados o fechas mal escritas dejan fallido el control de forma."""
        roturas = {
            "sin requisitos": lambda ficha: ficha.pop("requisitos"),
            "horas en texto": lambda ficha: ficha.update(horas="diez"),
            "requisito sin cumple": lambda ficha: ficha["requisitos"]["R1"].pop("cumple"),
            "evidencia que no es texto": lambda ficha: ficha["requisitos"]["R2"].update(evidencia=3),
            "fecha mal escrita": lambda ficha: ficha.update(comprobado="6/10/2026"),
            "certificado en texto": lambda ficha: ficha.update(certificado="sí"),
        }
        for nombre, romper in roturas.items():
            with self.subTest(rotura=nombre):
                contenido = documento()
                romper(contenido["fichas"][0])
                fallos = fallidos(contenido)
                self.assertTrue(
                    {
                        "cada ficha tiene solo sus campos y valores admitidos",
                        "cada requisito, con resultado y evidencia",
                    }
                    & set(fallos),
                    fallos,
                )
        contenido = documento()
        pendiente = abierta.revision_pendiente(contenido, HOY)
        contenido["fichas"].insert(0, {**contenido["fichas"][0], "id": "rota", "comprobado": "6/10/2026"})
        self.assertEqual(
            abierta.revision_pendiente(contenido, HOY),
            pendiente,
            "la fecha rota no anula la revisión pendiente de las demás",
        )
        contenido = documento()
        contenido["fichas"].append("no es una ficha")
        self.assertIn("cada ficha tiene solo sus campos y valores admitidos", fallidos(contenido))

    def test_los_limites_publicados_citan_la_revision_como_aviso(self) -> None:
        """«limites» cita DIAS_DE_REVISION, aunque cambie, como aviso que no retira fichas; requisitos del criterio."""
        informe: dict[str, Any] = {}
        with (
            mock.patch.object(abierta, "DIAS_DE_REVISION", 45),
            mock.patch.object(
                abierta, "cerrar_validacion", lambda _fuente, i, _controles, _conjunto: informe.update(i)
            ),
            mock.patch.object(abierta, "leer_fichas", return_value=documento()),
            mock.patch.object(abierta, "leer_json", return_value={"archivos": [{"sha256": "x"}]}),
            mock.patch.object(abierta, "sha256", return_value="x"),
            mock.patch.object(abierta, "requerir"),
        ):
            abierta.validar(HOY)
        self.assertIn("a los 45 días sin revisar, solo se avisa", informe["limites"])
        self.assertNotIn("deja de mostrarse", informe["limites"])
        self.assertEqual(informe["cobertura"]["terminadas"], [])
        self.assertEqual(len(abierta.REQUISITOS), abierta.NUMERO_DE_REQUISITOS)


class PruebaFronteraDelPaquete(unittest.TestCase):
    """Una entrada manual defectuosa no llega a los contratos de selección y presentación."""

    def test_r6_exige_poder_empezar_al_comprobar_sin_limite_de_antiguedad(self) -> None:
        """R6 excluye un inicio posterior a la comprobación; la antigüedad del inicio no excluye."""
        control = "cada ficha admitida, con comprobación no futura, ya iniciada y sin terminar al comprobarla"
        for dias, vigente in ((-1, False), (0, True), (730, True), (731, True), (3650, True)):
            with self.subTest(dias_desde_inicio=dias):
                contenido = documento()
                contenido["fichas"][0]["inicio"] = (HOY - timedelta(days=dias)).isoformat()
                self.assertEqual(control not in fallidos(contenido), vigente)

    def test_recurso_continuo_de_mas_de_dos_anos_comprobado_hoy_sigue_admitido(self) -> None:
        """Un recurso iniciado hace más de 730 días, comprobado hoy y sin cierre se exporta con sus fechas."""
        contenido = documento()
        ficha = contenido["fichas"][0]
        ficha["inicio"] = (HOY - timedelta(days=1000)).isoformat()
        ficha["comprobado"] = HOY.isoformat()
        ficha["fin"] = None
        self.assertEqual(fallidos(contenido), [])
        exportada = next(f for f in abierta.conjunto(contenido, HOY)["fichas"] if f["id"] == ficha["id"])
        self.assertEqual((exportada["inicio"], exportada["comprobado"]), (ficha["inicio"], ficha["comprobado"]))
        # El cierre real sigue mandando: con un fin publicado ya pasado, la ficha deja de admitirse.
        ficha["fin"] = (HOY - timedelta(days=1)).isoformat()
        self.assertIn("al menos una ficha cumple los diez requisitos", fallidos(contenido))

    def test_los_textos_y_el_area_digcomp_tienen_la_forma_del_consumidor(self) -> None:
        """Título, entidad, destinatarios y área conservan sus tipos, sin inventar ni convertir hechos."""
        roturas = {
            "titulo": None,
            "entidad": [],
            "dirigido_a": 3,
            "area_digcomp": "1",
        }
        for campo, valor in roturas.items():
            with self.subTest(campo=campo):
                contenido = documento()
                contenido["fichas"].append({**documento()["fichas"][0], "id": "ejemplo-intacto"})
                contenido["fichas"][0][campo] = valor
                self.assertIn("cada ficha tiene solo sus campos y valores admitidos", fallidos(contenido))
                self.assertNotIn("ejemplo-admitido", {ficha["id"] for ficha in abierta.conjunto(contenido)["fichas"]})

    def test_el_certificado_no_admite_emisor_ni_creditos_de_otro_tipo(self) -> None:
        """El formateo de ECTS recibe un número o null, y el emisor siempre es texto."""
        for campo, valor in (("emisor", None), ("ects", "texto"), ("ects", True)):
            with self.subTest(campo=campo, valor=valor):
                contenido = documento()
                contenido["fichas"][0]["certificado"][campo] = valor
                self.assertIn("cada ficha tiene solo sus campos y valores admitidos", fallidos(contenido))

    def test_los_numeros_no_finitos_no_llegan_al_json_del_paquete(self) -> None:
        """Horas, área, precio y ECTS rechazan infinitos y NaN que no se pueden guardar como JSON."""
        for campo in ("horas", "area_digcomp", "precio_eur", "ects"):
            for valor in (float("inf"), float("nan")):
                with self.subTest(campo=campo, valor=valor):
                    contenido = documento()
                    ficha = contenido["fichas"][0]
                    destino = ficha["certificado"] if campo in ("precio_eur", "ects") else ficha
                    destino[campo] = valor
                    self.assertIn("cada ficha tiene solo sus campos y valores admitidos", fallidos(contenido))

    def test_el_area_digcomp_es_una_de_las_cinco_areas_o_nula(self) -> None:
        """El contrato publica áreas de 1 a 5, nunca booleanos, fracciones ni otros números."""
        for area in (0, 6, 1.5, True):
            with self.subTest(area=area):
                contenido = documento()
                contenido["fichas"][0]["area_digcomp"] = area
                self.assertIn("cada ficha tiene solo sus campos y valores admitidos", fallidos(contenido))

    def test_los_hechos_opcionales_validos_se_conservan_sin_conversion(self) -> None:
        """Las cinco áreas y las ausencias admitidas conservan su valor en la proyección del paquete."""
        for area in (None, 1, 2, 3, 4, 5):
            with self.subTest(area=area):
                contenido = documento()
                contenido["fichas"][0].update(area_digcomp=area, horas=None, dirigido_a="mujeres", certificado=None)
                self.assertEqual(fallidos(contenido), [])
                esperada = {campo: valor for campo, valor in contenido["fichas"][0].items() if campo != "requisitos"}
                self.assertEqual(abierta.conjunto(contenido)["fichas"], [esperada])

    def test_las_fechas_compactas_o_semanales_no_se_exportan_como_aaaa_mm_dd(self) -> None:
        """Los tres campos de fecha rechazan variantes que el consumidor no reconoce."""
        for campo in ("inicio", "fin", "comprobado"):
            for valor in ("20261006", "2026-W41-2", "2026-10-06\n"):
                with self.subTest(campo=campo, valor=valor):
                    contenido = documento()
                    contenido["fichas"][0][campo] = valor
                    self.assertIn("cada ficha tiene solo sus campos y valores admitidos", fallidos(contenido))

    def test_faro_hoy_invalido_falla_con_motivo_y_sin_normalizar(self) -> None:
        """Un valor definido exige fecha real y forma exacta; el error nombra la configuración."""
        for valor in ("", "20261006", "2026-W41-2", "2026-02-30", "2026-10-06\n"):
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "FARO_HOY.*AAAA-MM-DD"):
                abierta.dia_de_la_validacion({"FARO_HOY": valor})

    def test_un_enlace_con_credenciales_puerto_o_forma_invalida_no_es_limpio(self) -> None:
        """La autoridad registrada no incluye credenciales, puertos ni reparaciones implícitas de la URL."""
        for enlace in (
            "https://usuario:clave@iedra.uned.es/curso",
            "https://iedra.uned.es:443/curso",
            "https://iedra.uned.es:otro/curso",
            "https://[iedra.uned.es/curso",
            " https://iedra.uned.es/curso",
            "https://iedra.uned.es/cur\nso",
        ):
            with self.subTest(enlace=enlace):
                self.assertFalse(abierta.enlace_limpio(enlace, HOSTS))

    def test_faro_hoy_invalido_sale_de_la_orden_con_su_motivo(self) -> None:
        """La interfaz usa el error de la fuente para devolver uno y explicar la fecha inválida."""
        salida = StringIO()
        with (
            mock.patch.dict("os.environ", {"FARO_HOY": "2026-W41-2"}),
            mock.patch.object(abierta, "leer_fichas", return_value=documento()),
            mock.patch.object(abierta, "leer_json", return_value={"archivos": [{"sha256": "x"}]}),
            mock.patch.object(abierta, "sha256", return_value="x"),
            mock.patch.object(abierta, "requerir"),
            redirect_stderr(salida),
        ):
            self.assertEqual(abierta.main(["validar"]), 1)
        self.assertRegex(salida.getvalue(), r"^Error: FARO_HOY.*AAAA-MM-DD\n$")

    def test_validar_sin_admitidas_escribe_el_control_fallido(self) -> None:
        """El aviso no impide llegar al informe Con errores cuando ninguna ficha cumple los requisitos."""
        contenido = documento()
        for ficha in contenido["fichas"]:
            ficha["requisitos"]["R2"]["cumple"] = False
        with (
            mock.patch.object(abierta, "leer_fichas", return_value=contenido),
            mock.patch.object(abierta, "leer_json", return_value={"archivos": [{"sha256": "x"}]}),
            mock.patch.object(abierta, "sha256", return_value="x"),
            mock.patch.object(abierta, "requerir"),
            mock.patch.object(abierta, "cerrar_validacion") as cerrar,
        ):
            abierta.validar(HOY)
        cerrar.assert_called_once()
        _fuente, informe, controles, _conjunto = cerrar.call_args.args
        self.assertEqual(informe["estado"], "Con errores")
        self.assertFalse(controles.admitido)
        self.assertIn("al menos una ficha cumple los diez requisitos", controles.fallidos)

    def test_la_lectura_y_los_controles_rechazan_la_raiz_sin_forma_con_motivo(self) -> None:
        """Un JSON válido sin el documento esperado se explica antes de calcular la revisión o los controles."""
        for contenido in (None, [], {}, {"fichas": [], "plataformas": []}):
            with self.subTest(contenido=contenido):
                with (
                    mock.patch.object(abierta, "leer_json", return_value=contenido),
                    mock.patch.object(abierta, "requerir"),
                    self.assertRaisesRegex(FormatoInesperado, "fichas.json"),
                ):
                    abierta.leer_fichas()
                with self.assertRaisesRegex(FormatoInesperado, "fichas.json"):
                    abierta.controles_de_las_fichas(contenido, HOY)

    def test_preparar_rechaza_fichas_sin_forma_antes_de_registrar_su_procedencia(self) -> None:
        """Una lista vacía, un elemento sin forma o comprobaciones nulas no producen índices ni fechas inventadas."""
        for fichas in ([], [None], [{**documento()["fichas"][0], "comprobado": None}]):
            contenido = {**documento(), "fichas": fichas}
            with self.subTest(fichas=fichas):
                with (
                    mock.patch.object(abierta, "leer_fichas", return_value=contenido),
                    mock.patch.object(abierta, "sha256", return_value="huella-inventada"),
                    mock.patch.object(abierta, "guardar_json_fechado") as guardar,
                    self.assertRaisesRegex(FormatoInesperado, "ficha"),
                ):
                    abierta.preparar()
                guardar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
