"""Regresiones focales del robot: datos sintéticos y ninguna conexión de red real."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from typing import Self
from unittest.mock import Mock, patch
from urllib.request import Request

from plataforma_datos.cursos.fuentes.barcelonactiva import idioma_ficha
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

AGENTE = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
)

OBSERVADO = "2026-10-22T01:00:00+00:00"


def actividad(ident: str = "100") -> ObjetoJson:
    """Devuelve una actividad sintética con identidad pública.

    Returns:
        Datos sintéticos de la prueba.
    """
    return {
        "activityId": ident,
        "title": "Título de prueba",
        "description": "TEMARIO QUE NO SE COPIA",
        "formationType": "PRESENCIAL",
        "listEditions": [],
    }


def sesion(
    virtual: bool = True,
    inicio: str = "Thu Oct 22 09:00:00 CEST 2026",
    fin: str = "Thu Oct 22 11:00:00 CEST 2026",
) -> ObjetoJson:
    """Devuelve los datos publicados de una sesión sintética.

    Returns:
        Datos sintéticos de la prueba.
    """
    return {
        "beginDateTime": inicio,
        "endDateTime": fin,
        "centerType": "Zoom" if virtual else "Sessió presencial",
        "centerName": "AULA VIRTUAL" if virtual else "Centro público",
        "centerTown": "Barcelona",
    }


def guardar_pagina(
    raiz: Path, actividades: list[ObjetoJson], total: int | None = None, desde: int = 0, observado: str = OBSERVADO
) -> None:
    """Conserva una página sintética y sus metadatos de consulta."""
    nombre = f"cibernarium-todas-{desde}"
    relativa = Path("capturas/catalunya") / f"{nombre}.json"
    cuerpo = json.dumps(
        {
            "start": desde,
            "end": desde + 15,
            "numActivities": len(actividades) if total is None else total,
            "activities": actividades,
        },
        ensure_ascii=False,
    ).encode()
    (raiz / relativa).parent.mkdir(parents=True, exist_ok=True)
    (raiz / relativa).write_bytes(cuerpo)
    robot.escribir_json(
        raiz / "consultas" / f"{nombre}.json",
        {
            "url": robot.url_pagina(desde),
            "urlFinal": robot.url_pagina(desde),
            "consultadoUTC": observado,
            "sha256": hashlib.sha256(cuerpo).hexdigest(),
            "captura": str(relativa),
        },
    )


class RobotCibernariumTest(unittest.TestCase):
    """Regresiones offline de identidad, procedencia y conservación temporal."""

    def test_zoom_prevalece_sobre_presencial_y_mixta_conserva_sesiones(self) -> None:
        """Comprueba zoom prevalece sobre presencial y mixta conserva sesiones."""
        a = actividad()
        edicion = {"activityId": "200", "listSessions": [sesion()]}
        datos = robot.normalizar_edicion("cibernarium:100", a, edicion)["datos"]
        self.assertEqual((datos["modalidad"], datos["sincronia"]), ("en-linea", "sincrona"))
        self.assertEqual(datos["horas_publicadas"], 2)
        self.assertIn("suma-exacta", datos["metodo_horas"])
        edicion["listSessions"].append(sesion(False, "Fri Oct 23 09:00:00 CEST 2026", "Fri Oct 23 11:00:00 CEST 2026"))
        datos = robot.normalizar_edicion("cibernarium:100", a, edicion)["datos"]
        self.assertEqual(datos["modalidad"], "mixta")
        self.assertEqual(datos["horas_publicadas"], 4)
        self.assertEqual(len(datos["sesiones"]), 2)

    def test_aula_virtual_sin_nombre_tambien_es_online_y_sesion_sin_lugar_desconocida(
        self,
    ) -> None:
        """Comprueba aula virtual sin nombre tambien es online y sesion sin lugar desconocida."""
        s = sesion()
        s.update(centerType="Aula virtual", centerName="")
        self.assertTrue(robot.sesion_virtual(s))
        s.update(centerType="", centerName="")
        datos = robot.normalizar_edicion("cibernarium:100", actividad(), {"activityId": "200", "listSessions": [s]})[
            "datos"
        ]
        self.assertIsNone(datos["modalidad"])

    def test_asincrona_tiene_ventana_no_sesiones_ni_horas_de_un_ano(self) -> None:
        """Comprueba asincrona tiene ventana no sesiones ni horas de un ano."""
        a = {**actividad(), "formationType": "ONLINE"}
        e = {
            "activityId": "200",
            "sessionsOnline": {
                "startDate": "Thu Jan 01 00:00:00 CET 2026",
                "endDate": "Thu Dec 31 23:59:00 CET 2026",
            },
        }
        datos = robot.normalizar_edicion("cibernarium:100", a, e)["datos"]
        self.assertEqual((datos["modalidad"], datos["sincronia"]), ("en-linea", "asincrona"))
        self.assertEqual(datos["sesiones"], [])
        self.assertTrue(datos["ventana_acceso"]["hasta"].startswith("2026-12-31"))
        self.assertIsNone(datos["horas_publicadas"])

    def test_estado_inscripcion_plazas_y_apertura_son_hechos_separados(self) -> None:
        """Comprueba estado inscripcion plazas y apertura son hechos separados."""
        e = {
            "activityId": "200",
            "registrationCode": "DISP3",
            "openingsAvailable": True,
        }
        d = robot.normalizar_edicion("cibernarium:100", actividad(), e)["datos"]
        self.assertEqual(d["plazas"], "sin-plazas")
        self.assertIsNone(d["admision_definitiva"])
        e.update(
            registrationCode="DISP52",
            registrationDesc="Obertura de la inscripció 04/11/2026 a les 08:30h.",
        )
        d = robot.normalizar_edicion("cibernarium:100", actividad(), e)["datos"]
        self.assertEqual(d["estado_inscripcion"], "apertura-futura")
        self.assertEqual(d["apertura_inscripcion"], "2026-11-04T08:30:00+01:00")
        self.assertIsNone(d["plazas"])
        e["registrationCode"] = "DISP0"
        d = robot.normalizar_edicion("cibernarium:100", actividad(), e)["datos"]
        self.assertEqual(d["estado_inscripcion"], "disponible-publicamente")
        self.assertIsNone(d["plazas"])

    def test_dato_ausente_no_se_inventa_y_fecha_no_interpretable_es_error(self) -> None:
        """Comprueba dato ausente no se inventa y fecha no interpretable es error."""
        d = robot.normalizar_edicion("cibernarium:100", actividad(), {"activityId": "200"})["datos"]
        for campo in [
            "modalidad",
            "sincronia",
            "ventana_acceso",
            "horas_publicadas",
            "requisitos_especificos",
            "plazas",
        ]:
            self.assertIsNone(d[campo], campo)
        with self.assertRaises(robot.ErrorRobot):
            robot.normalizar_edicion(
                "cibernarium:100",
                actividad(),
                {
                    "activityId": "200",
                    "listSessions": [sesion(inicio="formato nuevo no interpretado")],
                },
            )

    def test_ficha_solo_hechos_no_temarios_y_horas_no_se_heredan_a_otras_ediciones(
        self,
    ) -> None:
        """Comprueba ficha solo hechos no temarios y horas no se heredan a otras ediciones."""
        html = (
            b'<div data-mobile-index="3"><b>Durada:</b> 10 sessions (40h)<b>Id'
            b"ioma:</b> Catala<b>Dates:</b> publicadas</div><div data-mobile-i"
            b'ndex="5">TEMARIO QUE NO SE COPIA</div>'
        )
        hechos = robot.hechos_ficha(html)
        self.assertEqual(hechos["horas_publicadas_ficha"], 40)
        a = actividad()
        principal = robot.normalizar_edicion("cibernarium:100", a, {"activityId": "100"}, hechos)
        otra = robot.normalizar_edicion("cibernarium:100", a, {"activityId": "200"}, hechos)
        self.assertEqual(principal["datos"]["horas_publicadas"], 40)
        self.assertIsNone(otra["datos"]["horas_publicadas"])
        self.assertNotIn("TEMARIO", json.dumps(hechos))

    def test_idioma_no_incluye_calendario_con_rotulo_data_o_dates(self) -> None:
        """El rótulo Data observado en fichas reales termina el idioma, igual que Dates."""
        for rotulo in ("Data", "Dates"):
            with self.subTest(rotulo=rotulo):
                html = (
                    '<div data-mobile-index="3"><b>Durada:</b> 2 hores'
                    "<b>Idioma:</b> Català "
                    f"<b>{rotulo}:</b> Dimarts 27 d’octubre, 10:00h - 12:00h "
                    "Inscriure'm &gt;&gt; Veure més edicions</div>"
                    '<div data-mobile-index="5">Idioma: Castellà</div>'
                ).encode()
                hechos = robot.hechos_ficha(html)
                self.assertEqual(hechos["idioma_publicado_ficha"], "Català")
                self.assertEqual(hechos["horas_publicadas_ficha"], 2)

    def test_robot_y_entrega_leen_el_idioma_con_la_misma_regla(self) -> None:
        """Cada rótulo siguiente, en cualquier caja, termina el idioma en el robot y en la regla compartida."""
        for rotulo in (*idioma_ficha.ROTULOS_TRAS_IDIOMA, "DATA:", "modalitat:"):
            with self.subTest(rotulo=rotulo):
                cola = f" Català {rotulo} Dimarts 27 d’octubre Ubicació: Cibernàrium-22@ Inscriure'm"
                html = f'<div data-mobile-index="3"><b>Idioma:</b>{cola}</div>'.encode()
                self.assertEqual(robot.hechos_ficha(html)["idioma_publicado_ficha"], "Català")
                self.assertEqual(idioma_ficha.literal_de_idioma(cola), "Català")
        self.assertEqual(idioma_ficha.literal_de_idioma("  Castellà  "), "Castellà")
        self.assertEqual(idioma_ficha.literal_de_idioma("Data: Dimarts"), "")
        self.assertIsNone(idioma_ficha.idioma_de_ficha("Durada: 2 hores Modalitat: Presencial"))

    def test_parcial_no_carga_ni_concilia_y_no_descarga_desde_capturas(self) -> None:
        """Comprueba parcial no carga ni concilia y no descarga desde capturas."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            origen = raiz / "origen"
            guardar_pagina(origen, [actividad(str(i)) for i in range(100, 115)], total=16)
            ciclo = Mock()
            descargador = Mock()
            descargador.obtener.side_effect = AssertionError("La ejecución desde capturas no debe usar red.")
            _, informe = robot.ejecutar(
                raiz / "base.sqlite",
                raiz / "salida",
                origen,
                descargador,
                ciclo,
            )
            self.assertFalse(informe["paginacion_completa"])
            self.assertTrue(informe["errores"])
            ciclo.assert_not_called()
            descargador.obtener.assert_not_called()

    def test_conflicto_edicion_dos_programas_no_sobrescribe_ni_concilia(self) -> None:
        """Comprueba conflicto edicion dos programas no sobrescribe ni concilia."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            a, b = actividad("100"), actividad("101")
            a["listEditions"] = [{"activityId": "300"}]
            b["listEditions"] = [{"activityId": "300"}]
            guardar_pagina(raiz / "origen", [a, b])
            ciclo = Mock()
            _, informe = robot.ejecutar(
                raiz / "base.sqlite",
                raiz / "salida",
                raiz / "origen",
                importar_ciclo=ciclo,
            )
            self.assertTrue(any("contradictorios" in e for e in informe["errores"]))
            ciclo.assert_not_called()

    def test_ciclo_diez_mas_tres_menos_dos_da_once_activos_sin_cambiar_identidad_por_titulo(
        self,
    ) -> None:
        """Comprueba ciclo diez mas tres menos dos da once activos sin cambiar identidad por titulo."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            origen = raiz / "origen"
            iniciales = [actividad(str(i)) for i in range(100, 110)]
            guardar_pagina(origen, iniciales)
            uno, informe = robot.ejecutar(raiz / "base.sqlite", raiz / "salida", origen)
            self.assertEqual(informe["conciliacion"]["activos"], 10)
            siguientes = deepcopy(iniciales[:8]) + [actividad(str(i)) for i in range(110, 113)]
            siguientes[0]["title"] = "Título corregido: conserva activityId"
            guardar_pagina(origen, siguientes, observado="2026-10-23T01:00:00+00:00")
            dos, informe = robot.ejecutar(raiz / "base.sqlite", raiz / "salida", origen)
            self.assertNotEqual(uno, dos)
            self.assertEqual(informe["conciliacion"]["activos"], 11)
            self.assertEqual(len(informe["conciliacion"]["activados"]), 3)
            self.assertEqual(
                set(informe["conciliacion"]["retirados"]),
                {"cibernarium:108", "cibernarium:109"},
            )
            preparado = json.loads((dos / "importacion.json").read_text())
            lote = next(lote for lote in preparado["lotes"] if lote["programas"])
            self.assertEqual(lote["programas"][0]["id"], "cibernarium:100")
            self.assertIsNone(lote["programas"][0]["datos"]["nivel_faro"])
            self.assertNotIn("TEMARIO QUE NO SE COPIA", json.dumps(lote))
            self.assertEqual(lote["observado_utc"], "2026-10-23T01:00:00+00:00")
            _, recaptura = robot.ejecutar(raiz / "reproducida.sqlite", raiz / "reproduccion", dos)
            self.assertTrue(recaptura["conciliado"])

    def test_huella_incorrecta_y_total_que_cambia_no_concilian(self) -> None:
        """Comprueba huella incorrecta y total que cambia no concilian."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            guardar_pagina(raiz / "origen", [actividad("100")])
            captura = raiz / "origen/capturas/catalunya/cibernarium-todas-0.json"
            captura.write_bytes(captura.read_bytes() + b" ")
            ciclo = Mock()
            _, informe = robot.ejecutar(
                raiz / "base.sqlite",
                raiz / "salida",
                raiz / "origen",
                importar_ciclo=ciclo,
            )
            self.assertTrue(informe["errores"])
            ciclo.assert_not_called()
        with self.assertRaises(robot.ErrorRobot):
            robot.validar_pagina({"start": 15, "end": 30, "numActivities": 17, "activities": []}, 15, 16)

    def test_fecha_origen_api_no_se_rejuvenece_por_ejecutar_o_por_una_ficha_posterior(
        self,
    ) -> None:
        """Comprueba fecha origen api no se rejuvenece por ejecutar o por una ficha posterior."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            origen = raiz / "origen"
            guardar_pagina(origen, [actividad("100")])
            relativa = "capturas/catalunya/cibernarium-ficha-100.html"
            contenido = b'<div data-mobile-index="3"><b>Durada:</b> 2 hores</div>'
            (origen / relativa).write_bytes(contenido)
            robot.escribir_json(
                origen / "consultas/cibernarium-ficha-100.json",
                {
                    "urlFinal": robot.url_ficha("100"),
                    "consultadoUTC": "2026-10-23T01:00:00+00:00",
                    "sha256": hashlib.sha256(contenido).hexdigest(),
                    "captura": relativa,
                },
            )
            ciclo = Mock(return_value={"importacion": {}, "conciliacion": {}})
            ruta, informe = robot.ejecutar(
                raiz / "base.sqlite",
                raiz / "salida",
                origen,
                importar_ciclo=ciclo,
            )
            preparado = json.loads((ruta / "importacion.json").read_text())
            lote = next(lote for lote in preparado["lotes"] if lote["programas"])
            self.assertEqual(lote["observado_utc"], OBSERVADO)
            self.assertEqual(informe["observado_api_utc"], OBSERVADO)
            self.assertEqual(ciclo.call_args.args[2].observado_utc, OBSERVADO)

    def test_lote_antiguo_no_se_importa_ni_reconcilia_como_nuevo(self) -> None:
        """Comprueba lote antiguo no se importa ni reconcilia como nuevo."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            origen = raiz / "origen"
            guardar_pagina(
                origen,
                [actividad("100"), actividad("101")],
                observado="2026-10-23T01:00:00+00:00",
            )
            _, primero = robot.ejecutar(raiz / "base.sqlite", raiz / "salida", origen)
            self.assertEqual(primero["conciliacion"]["activos"], 2)
            guardar_pagina(origen, [actividad("100")])
            antes = (raiz / "base.sqlite").read_bytes()
            _, antiguo = robot.ejecutar(raiz / "base.sqlite", raiz / "salida", origen)
            self.assertFalse(antiguo["cargado"])
            self.assertFalse(antiguo["conciliado"])
            self.assertTrue(antiguo["errores"])
            self.assertEqual((raiz / "base.sqlite").read_bytes(), antes)

    def test_fallo_conciliacion_revierte_importacion_y_conserva_archivo_original_exacto(
        self,
    ) -> None:
        """Comprueba fallo conciliacion revierte importacion y conserva archivo original exacto."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            origen = raiz / "origen"
            guardar_pagina(origen, [actividad("100")])
            base = raiz / "base.sqlite"
            _, primero = robot.ejecutar(base, raiz / "salida", origen)
            self.assertTrue(primero["conciliado"])
            antes = base.read_bytes()
            guardar_pagina(
                origen,
                [actividad("100"), actividad("101")],
                observado="2026-10-23T01:00:00+00:00",
            )
            with (
                patch(
                    "plataforma_datos.cursos.catalogo._conciliar_en_conexion",
                    side_effect=RuntimeError("fallo inyectado"),
                ),
                self.assertRaises(RuntimeError),
            ):
                robot.ejecutar(base, raiz / "salida", origen)
            self.assertEqual(base.read_bytes(), antes)
            _, correcto = robot.ejecutar(base, raiz / "salida", origen)
            self.assertEqual(correcto["conciliacion"]["activos"], 2)

    def test_no_admite_dos_ejecuciones_del_robot_para_la_misma_base(self) -> None:
        """Comprueba no admite dos ejecuciones del robot para la misma base."""
        with tempfile.TemporaryDirectory() as carpeta:
            base = Path(carpeta) / "base.sqlite"
            with robot.bloqueo_ejecucion(base), self.assertRaises(robot.ErrorRobot):
                robot.ejecutar(base, Path(carpeta) / "salida", Path(carpeta) / "origen")

    def test_ultima_pagina_admite_limite_recortado_al_total_publicado(self) -> None:
        """Comprueba ultima pagina admite limite recortado al total publicado."""
        total, actividades = robot.validar_pagina(
            {
                "start": 285,
                "end": 288,
                "numActivities": 288,
                "activities": [actividad("100"), actividad("101"), actividad("102")],
            },
            285,
            288,
        )
        self.assertEqual(total, 288)
        self.assertEqual(len(actividades), 3)

    def test_descargador_identidad_generica_y_pausa_minima_serial(self) -> None:
        """Comprueba descargador identidad generica y pausa minima serial."""
        reloj = [0.0]
        pausas = []
        peticiones = []

        def dormir(segundos: float) -> None:
            """Prepara los datos locales de dormir."""
            pausas.append(segundos)
            reloj[0] += segundos

        class Respuesta:
            """Regresiones offline de identidad, procedencia y conservación temporal."""

            status = 200

            def __enter__(self) -> Self:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def read(self, _: ValorJson) -> bytes:
                """Prepara los datos locales de read.

                Returns:
                    Datos sintéticos de la prueba.
                """
                return b"{}"

            def geturl(self) -> str:
                """Prepara los datos locales de geturl.

                Returns:
                    Datos sintéticos de la prueba.
                """
                return robot.url_pagina(0)

        def abrir(peticion: Request, timeout: float, pausa: float) -> Respuesta:
            """Prepara los datos locales de abrir.

            Returns:
                Datos sintéticos de la prueba.
            """
            peticiones.append((peticion, timeout))
            return Respuesta()

        with (
            patch.object(robot, "abrir_serial", abrir),
            patch.object(robot.time, "monotonic", lambda: reloj[0]),
            patch.object(robot.time, "sleep", dormir),
        ):
            descargador = robot.DescargadorSerial(agente_usuario=AGENTE)
            descargador.obtener(robot.url_pagina(0))
            descargador.obtener(robot.url_pagina(15))
        self.assertEqual(pausas, [2.0])
        self.assertTrue(all(p.get_header("User-agent") == AGENTE for p, _ in peticiones))
        for peticion, _ in peticiones:
            for nombre, valor in robot.perfil_web.identidad_publica(robot.perfil_web.perfil_chrome()).items():
                self.assertEqual(peticion.get_header(nombre.capitalize()), valor)
            self.assertIsNone(peticion.get_header("Accept-language"))
            self.assertIsNone(peticion.get_header("Sec-fetch-mode"))
        with self.assertRaises(ValueError):
            robot.DescargadorSerial(1.99, agente_usuario=AGENTE)

    def test_redireccion_respeta_pausa_y_conserva_identidad_generica(self) -> None:
        """Comprueba redireccion respeta pausa y conserva identidad generica."""
        solicitud = robot.Request(robot.url_ficha("100"), headers={"User-Agent": AGENTE})
        destino = robot.url_ficha("200")
        manejador = robot.RedireccionEspaciada(2.0)
        with patch.object(robot.time, "sleep") as pausa:
            siguiente = manejador.redirect_request(solicitud, None, 302, "Found", {}, destino)
        pausa.assert_called_once_with(2.0)
        self.assertEqual(siguiente.full_url, destino)
        self.assertEqual(siguiente.get_header("User-agent"), AGENTE)

    def test_error_de_red_tambien_respeta_pausa_antes_de_reintentar(self) -> None:
        """Comprueba error de red tambien respeta pausa antes de reintentar."""
        reloj = [0.0]
        pausas = []

        def dormir(segundos: float) -> None:
            """Prepara los datos locales de dormir."""
            pausas.append(segundos)
            reloj[0] += segundos

        with (
            patch.object(robot, "abrir_serial", side_effect=robot.URLError("sin conexión")),
            patch.object(robot.time, "monotonic", lambda: reloj[0]),
            patch.object(robot.time, "sleep", dormir),
        ):
            descargador = robot.DescargadorSerial(agente_usuario=AGENTE)
            for _ in range(2):
                with self.assertRaises(robot.URLError):
                    descargador.obtener(robot.url_pagina(0))
        self.assertEqual(pausas, [2.0])

    def test_pausa_invalida_no_puede_eludir_el_minimo(self) -> None:
        """Comprueba pausa invalida no puede eludir el minimo."""
        for valor in [True, float("nan"), float("inf"), "2", 0, 1.99]:
            with self.subTest(valor=valor), self.assertRaises(ValueError):
                robot.DescargadorSerial(valor, agente_usuario=AGENTE)

    def test_capturas_offline_no_necesitan_configuracion_de_identidad(self) -> None:
        """Comprueba capturas offline no necesitan configuracion de identidad."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            guardar_pagina(raiz / "origen", [actividad()])
            with patch.object(
                robot.perfil_web,
                "leer_perfil",
                side_effect=AssertionError("sin configuración web offline"),
            ):
                _, informe = robot.ejecutar(raiz / "base.sqlite", raiz / "salida", raiz / "origen")
            self.assertTrue(informe["conciliado"])

    def test_pagina_posterior_no_autoriza_contenido_ni_censo_antiguos(self) -> None:
        """Comprueba pagina posterior no autoriza contenido ni censo antiguos."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            filas = [actividad(str(i)) for i in range(1, 17)]
            origen = raiz / "origen"
            guardar_pagina(origen, filas[:15], total=16)
            guardar_pagina(origen, filas[15:], total=16, desde=15)
            base = raiz / "base.sqlite"
            _, primero = robot.ejecutar(base, raiz / "salidas", origen)
            self.assertTrue(primero["publicacion_completa"])
            filas[0]["title"] = "Título antiguo"
            guardar_pagina(origen, filas[:15], total=16, observado="2026-10-21T01:00:00+00:00")
            guardar_pagina(
                origen,
                filas[15:],
                total=16,
                desde=15,
                observado="2026-10-23T01:00:00+00:00",
            )
            antes = base.read_bytes()
            ruta, rechazado = robot.ejecutar(base, raiz / "salidas", origen)
            self.assertTrue(rechazado["paginacion_completa"])
            self.assertFalse(rechazado["publicacion_completa"])
            self.assertFalse(rechazado["cargado"])
            self.assertFalse(rechazado["conciliado"])
            self.assertIsNone(rechazado["observado_api_utc"])
            self.assertEqual(rechazado["rechazo_temporal"]["entidad"], "catalogo")
            self.assertEqual(base.read_bytes(), antes)
            self.assertTrue((ruta / "importacion.json").is_file())
            self.assertTrue((ruta / "capturas/cibernarium-todas-0.json").is_file())

    def test_api_nueva_no_rejuvenece_ficha_html_antigua(self) -> None:
        """Comprueba api nueva no rejuvenece ficha html antigua."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            origen = raiz / "origen"

            def guardar(dia_api: int, dia_ficha: int, horas: int) -> None:
                a = actividad("100")
                a["listEditions"] = [{"activityId": "100", "registrationCode": "DISP3"}]
                guardar_pagina(origen, [a], observado=f"2026-10-{dia_api}T01:00:00+00:00")
                relativa = "capturas/catalunya/cibernarium-ficha-100.html"
                cuerpo = f'<div data-mobile-index="3"><b>Durada:</b> {horas} hores</div>'.encode()
                (origen / relativa).write_bytes(cuerpo)
                robot.escribir_json(
                    origen / "consultas/cibernarium-ficha-100.json",
                    {
                        "urlFinal": robot.url_ficha("100"),
                        "captura": relativa,
                        "consultadoUTC": f"2026-10-{dia_ficha}T01:00:00+00:00",
                        "sha256": hashlib.sha256(cuerpo).hexdigest(),
                    },
                )

            guardar(22, 22, 40)
            base = raiz / "base.sqlite"
            _, primero = robot.ejecutar(base, raiz / "salidas", origen)
            self.assertTrue(primero["conciliado"])
            guardar(23, 21, 2)
            antes = base.read_bytes()
            _, rechazo = robot.ejecutar(base, raiz / "salidas", origen)
            self.assertEqual(rechazo["rechazo_temporal"]["canal"], "ficha-html")
            self.assertFalse(rechazo["cargado"])
            self.assertEqual(base.read_bytes(), antes)

    def test_ficha_antigua_abierta_no_sustituye_cerrada_mas_reciente(self) -> None:
        """Comprueba ficha antigua abierta no sustituye cerrada mas reciente."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            origen = raiz / "origen"
            filas = [actividad(str(i)) for i in range(1, 17)]
            filas[0]["listEditions"] = [{"activityId": "1", "registrationCode": "DISP3"}]
            guardar_pagina(origen, filas[:15], total=16)
            guardar_pagina(origen, filas[15:], total=16, desde=15)
            base = raiz / "base.sqlite"
            robot.ejecutar(base, raiz / "salidas", origen)
            antes = base.read_bytes()
            filas[0]["listEditions"][0]["registrationCode"] = "DISP0"
            guardar_pagina(origen, filas[:15], total=16, observado="2026-10-21T01:00:00+00:00")
            guardar_pagina(
                origen,
                filas[15:],
                total=16,
                desde=15,
                observado="2026-10-23T01:00:00+00:00",
            )
            _, rechazo = robot.ejecutar(base, raiz / "salidas", origen)
            self.assertFalse(rechazo["conciliado"])
            self.assertEqual(base.read_bytes(), antes)

    def test_rol_normas_se_conserva_con_redireccion_oficial_de_la_consulta(self) -> None:
        """Comprueba rol normas se conserva con redireccion oficial de la consulta."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            origen = raiz / "origen"
            guardar_pagina(origen, [actividad("100")])
            relativa = "capturas/catalunya/normas.html"
            cuerpo = b"Normas generales publicadas"
            (origen / relativa).write_bytes(cuerpo)
            robot.escribir_json(
                origen / "consultas/cibernarium-normas.json",
                {
                    "url": robot.ORIGEN + "/normes",
                    "urlFinal": robot.ORIGEN + "/ca/normesfaqs",
                    "consultadoUTC": OBSERVADO,
                    "sha256": hashlib.sha256(cuerpo).hexdigest(),
                    "captura": relativa,
                },
            )
            ruta, informe = robot.ejecutar(raiz / "base.sqlite", raiz / "salidas", origen)
            self.assertTrue(informe["conciliado"])
            preparado = json.loads((ruta / "importacion.json").read_text())
            self.assertTrue(
                any(c["canal"] == "normas-acceso" for lista in preparado["canales_temporales"] for c in lista)
            )


if __name__ == "__main__":
    unittest.main()
