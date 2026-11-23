"""Canal operativo Cibernàrium: fechas, cobertura y conservación de la casa mixta."""

import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import recibos_compartidos as recibos
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion as a
from plataforma_datos.cursos.fuentes.barcelonactiva import declaraciones_actuales as faq
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.recepciones_catalogo import conservar_bytes


def _bloque(codigo: str, pregunta: str, respuesta: str) -> str:
    numero = codigo.removeprefix("NU").removeprefix("CG")
    return (
        f'<li class="item-{numero}"><button class="123 faq-accordion">{codigo} {pregunta}</button>'
        f'<div class="panel-faqs"><p>{respuesta}</p></div></li>'
    )


def _normas() -> bytes:
    return (
        "<ul>"
        + _bloque("CG12", "Les activitats del Cibernàrium són de pagament o són gratuïtes?", faq.GRATUIDAD)
        + _bloque(
            "NU2",
            "Qui pot inscriure's a les activitats Cibernàrium?",
            "Tota persona major de 16 anys i amb DNI, NIE o passaport "
            "pot inscriure's a qualsevol activitat de Cibernàrium. "
            "No cal estar en cap situació laboral específica ni pertànyer a cap sector professional concret.",
        )
        + _bloque(
            "NU3",
            "Per què haig d'estar registrat a Barcelona Activa?",
            "No és possible inscriure's a les activitats sense fer registre previ.",
        )
        + "</ul>"
    ).encode()


def _actividad(id: int) -> dict:
    return {
        "activityId": str(id),
        "title": "Activitat " + str(id),
        "formationType": "ONLINE",
        "description": "NO_SE_PUBLICA_DESCRIPCION",
        "imageURL": "NO_SE_PUBLICA_IMAGEN",
        "listEditions": [
            {
                "activityId": str(id),
                "listSessions": [],
                "registrationCode": "DISP0",
                "sessionsOnline": {
                    "startDate": "Thu Jan 01 00:00:00 CET 2026",
                    "endDate": "Thu Dec 31 23:59:00 CET 2026",
                    "URL": "https://invalid.example/?p_auth=NO_SE_PUBLICA_TOKEN",
                },
            }
        ],
    }


def _captura(  # noqa: PLR0913 - La fixture varía identidad, respuesta y reloj de forma explícita.
    original: Path,
    url: str,
    cuerpo: bytes,
    *,
    id: str | None = None,
    http: int = 200,
    fin: str = "2026-10-23T21:00:02Z",
    tipo: str = "text/html",
    url_final: str | None = None,
) -> dict:
    ref = conservar_bytes(original / "cuerpos", cuerpo, ".body")
    meta = {
        "url": url,
        "url_final": url if url_final is None else url_final,
        "http": http,
        "completo": True,
        "bytes": len(cuerpo),
        "cuerpo_sha256": ref.sha256,
        "inicio_utc": "2026-10-23T21:00:00Z",
        "fin_utc": fin,
        "content_type": tipo,
        "error": None,
    }
    estable, evento = recibos.separar(recibos.canonico(meta), campos_evento=frozenset({"inicio_utc", "fin_utc"}))
    e = conservar_bytes(original / "recepciones", evento, ".json")
    m = conservar_bytes(original / "metadatos", estable, ".json")
    return {
        "id": id,
        "cuerpo": comun.referencia_conservada(ref.ruta, original),
        "recibo": comun.referencia_conservada(e.ruta, original),
        "intento": comun.referencia_conservada(e.ruta, original),
        "metadatos": comun.referencia_conservada(m.ruta, original),
    }


class AdquisicionCibernarium(unittest.TestCase):
    """Recepción causal y preservación del canal ocupacional en la misma casa."""

    def setUp(self) -> None:
        """Construye dos páginas, normas y procedencia previa solo en el temporal propio."""
        self.area = tempfile.TemporaryDirectory()
        self.addCleanup(self.area.cleanup)
        self.raiz = Path(self.area.name)
        self.original, self.preparado, self.validado = a.rutas(self.raiz)
        self.original.mkdir(parents=True)
        self.legado = {
            "fuente_id": "barcelonactiva",
            "titulo": "Catàleg d'ocupacions",
            "cita": "Consulta anterior",
            "licencia": "Conservada",
            "estado": "Original previo",
            "archivos": [],
        }
        (self.original.parent / "procedencia.json").write_bytes(recibos.canonico(self.legado))
        self.capturas = []
        for desde in (0, 15):
            filas = [_actividad(i) for i in range(desde + 1, min(desde + 16, 17))]
            cuerpo = recibos.canonico({"numActivities": 16, "start": desde, "end": desde + 15, "activities": filas})
            self.capturas.append(
                _captura(
                    self.original,
                    a.url_pagina(desde),
                    cuerpo,
                    tipo="application/json",
                    fin=f"2026-10-23T21:00:{2 + desde:02}Z",
                )
            )
        self.normas = _captura(self.original, a.NORMAS, _normas())
        a._guardar(self.original, self.capturas, {"normas": self.normas}, {}, {})
        self.doc = recibos.leer_json((self.original / "procedencia.json").read_bytes())

    def test_censo_contrato_y_fechas_independientes(self) -> None:
        """Cada edición e instante proceden de su página, sin publicar el contenido privado."""
        calculado = a.calcular(self.original, self.doc, [])
        self.assertEqual(len(calculado["censo"]["actividades"]), 16)
        self.assertEqual(len(calculado["censo"]["ediciones"]), 16)
        self.assertEqual(
            [f["lectura"]["fin_utc"] for f in calculado["recepciones"]],
            ["2026-10-23T21:00:02Z", "2026-10-23T21:00:17Z"],
        )
        self.assertIsNone(calculado["publicacion_confirmada"])
        self.assertEqual(
            calculado["auxiliares"]["normas"]["lectura"]["condiciones"]["formacion"]["valor"], "gratis_formacion"
        )
        for privado in ("p_auth", "NO_SE_PUBLICA", "description", "imageURL"):
            self.assertNotIn(privado, json.dumps(calculado))

    def test_no_adopta_estado_o_metadatos_del_legado(self) -> None:
        """Vincular el canal conserva las afirmaciones históricas y lista sus nuevos originales."""
        nuevo = recibos.leer_json((self.original.parent / "procedencia.json").read_bytes())
        self.assertEqual({k: v for k, v in nuevo.items() if k != "canales_operativos"}, self.legado)
        raiz = nuevo["canales_operativos"]["cibernarium"]
        self.assertEqual(
            raiz["indice"]["sha256"], hashlib.sha256((self.original / "procedencia.json").read_bytes()).hexdigest()
        )
        self.assertTrue(all(r["archivo"].startswith("cibernarium/") for r in raiz["archivos"]))

    def test_documento_admitido_no_lee_indice_actual_fallido(self) -> None:
        """Reproducir la admisión anterior usa su índice aunque el intento actual falle."""
        anterior = a.calcular(self.original, self.doc, [])
        (self.original / "procedencia.json").write_bytes(b'{"intento":"posterior fallido"}\n')
        self.assertEqual(a.calcular(self.original, self.doc, []), anterior)

    def test_replay_conserva_bytes_y_mtime_de_indices(self) -> None:
        """La misma recepción no vuelve a escribir los dos índices."""
        rutas = [self.original / "procedencia.json", self.original.parent / "procedencia.json"]
        previo = [(r.read_bytes(), r.stat().st_mtime_ns) for r in rutas]
        a._guardar(self.original, self.capturas, {"normas": self.normas}, {}, self.doc)
        self.assertEqual([(r.read_bytes(), r.stat().st_mtime_ns) for r in rutas], previo)

    def test_pagina_ausente_no_es_censo_y_el_orden_del_indice_no_decide(self) -> None:
        """La cobertura exige todos los intervalos; cada página se identifica por su URL, no por su posición."""
        with self.assertRaises(FormatoInesperado):
            a.calcular(self.original, {**self.doc, "capturas": self.doc["capturas"][:1]}, [])
        ordenado = a.calcular(self.original, self.doc, [])
        invertido = a.calcular(self.original, {**self.doc, "capturas": self.doc["capturas"][::-1]}, [])
        self.assertEqual(
            {k: v for k, v in invertido.items() if k != "procedencia_sha256"},
            {k: v for k, v in ordenado.items() if k != "procedencia_sha256"},
        )

    def test_edicion_repetida_entre_actividades_se_rechaza(self) -> None:
        """Una edición nativa no puede atribuirse a dos actividades."""
        cuerpo, _ = a.pagina(self.original, self.capturas[1])
        pagina = recibos.leer_json(cuerpo)
        pagina["activities"][0]["listEditions"][0]["activityId"] = "1"
        cap = _captura(self.original, a.url_pagina(15), recibos.canonico(pagina), tipo="application/json")
        with self.assertRaises(FormatoInesperado):
            a.calcular(self.original, {**self.doc, "capturas": [self.capturas[0], cap]}, [])

    def test_ficha_sin_prefijo_de_idioma_exige_mismo_host_e_id_en_el_recibo(self) -> None:
        """El destino público sin prefijo regional identifica únicamente la ficha solicitada."""
        for final, identificada in (
            (robot.ORIGEN + "/formacio?activityId=1", True),
            (robot.ORIGEN + "/ca/formacio?activityId=1", True),
            (robot.ORIGEN + "/formacio?activityId=2", False),
            ("https://example.org/formacio?activityId=1", False),
        ):
            with self.subTest(final=final):
                ficha = _captura(self.original, robot.url_ficha("1"), b"ficha", id="cibernarium:1", url_final=final)
                self.assertIs(a._lectura_html(self.original, ficha, "1")["identificada"], identificada)

    def test_ficha_fallida_no_es_cierre_del_censo(self) -> None:
        """La denegación individual permanece visible y no se interpreta como una baja."""
        ficha = _captura(self.original, robot.url_ficha("1"), b"denegada", id="cibernarium:1", http=403)
        calculado = a.calcular(self.original, {**self.doc, "fichas": {"1": ficha}}, [])
        self.assertTrue(calculado["censo_completo"])
        self.assertFalse(calculado["fichas"]["1"]["lectura"]["identificada"])
        self.assertEqual(calculado["fichas"]["1"]["lectura"]["http"], 403)

    def test_error_local_de_edicion_no_inventa_fechas(self) -> None:
        """Una fecha desconocida conserva identidad y diagnóstico, sin sustituirla."""
        cuerpo, _ = a.pagina(self.original, self.capturas[1])
        pagina = recibos.leer_json(cuerpo)
        pagina["activities"][0]["listEditions"][0]["sessionsOnline"]["endDate"] = "fecha no reconocida"
        cap = _captura(self.original, a.url_pagina(15), recibos.canonico(pagina), tipo="application/json")
        lectura = a.extraer(self.original, cap)
        self.assertEqual(
            lectura["errores_ediciones"], [{"id": "cibernarium-edicion:16", "motivo": "edicion_no_interpretable"}]
        )
        self.assertEqual(lectura["ediciones"], ["cibernarium-edicion:16"])

    def test_descarga_usa_api_y_normas_sin_fichas_estables(self) -> None:
        """El conector serial recibe el censo y apoyo sin volver a pedir fichas estables."""
        por_url = {comun.leer_recibo(self.original, cap)["url"]: cap for cap in [*self.capturas, self.normas]}
        conocidos = [{"id": "cibernarium:" + str(i), "titulo": "Activitat " + str(i)} for i in range(1, 17)]
        with patch.object(comun, "recibir_url", side_effect=lambda url, *_args, **_kw: por_url[url]) as recibir:
            a.descargar(conocidos, self.original, self.doc)
        self.assertEqual(
            [llamada.args[0] for llamada in recibir.call_args_list], [a.url_pagina(0), a.url_pagina(15), a.NORMAS]
        )
        self.assertEqual(
            [llamada.kwargs["perfil"] for llamada in recibir.call_args_list],
            ["datos", "datos", "idioma-original"],
        )
        self.assertEqual(
            a.calcular(self.original, self.doc, []),
            a.calcular(self.original, recibos.leer_json((self.original / "procedencia.json").read_bytes()), []),
        )

    def test_rotacion_prioriza_altas_y_deduplica_la_ficha_de_padre_conocido(self) -> None:
        """Alta y edición sin idioma comparten presupuesto sin duplicar el programa."""
        por_url = {comun.leer_recibo(self.original, cap)["url"]: cap for cap in [*self.capturas, self.normas]}
        conocidos = [{"id": "cibernarium:" + str(i), "titulo": "Activitat " + str(i)} for i in range(1, 16)]
        programas = {p["id"]: p for p in conocidos}
        ediciones = {
            "cibernarium-edicion:1": {
                "programa_id": "cibernarium:1",
                "datos": {"idioma_ficha_principal": None, "sincronia": "sincrona"},
            }
        }
        base = self.raiz / "base.sqlite3"
        base.touch()
        pedidos = []

        def ficha(url: str, _original: Path, ident: str, _hasta: float, **_opciones: object) -> dict:
            pedidos.append(ident)
            return _captura(self.original, url, b"<html>Ficha</html>", id=ident)

        with (
            patch.object(comun, "recibir_url", side_effect=lambda url, *_args, **_kw: por_url[url]),
            patch.object(a.contraste_ediciones.negocio_actual, "leer", return_value=(programas, ediciones)),
            patch.object(a.contraste_ediciones, "recibir_ficha", side_effect=ficha),
            patch.object(a.contraste_ediciones, "recibir", return_value={}),
        ):
            a.descargar(conocidos, self.original, self.doc, base=base)
        self.assertEqual(pedidos, ["cibernarium:16", "cibernarium:1"])
        self.assertEqual(len(pedidos), len(set(pedidos)))

        # Un presupuesto de cero debe bloquear tanto las altas como las pendientes.
        pedidos.clear()
        with (
            patch.object(comun, "recibir_url", side_effect=lambda url, *_args, **_kw: por_url[url]),
            patch.object(a.contraste_ediciones.negocio_actual, "leer", return_value=(programas, ediciones)),
            patch.object(a.contraste_ediciones, "recibir_ficha", side_effect=ficha),
            patch.object(a.contraste_ediciones, "recibir", return_value={}),
            patch.object(a, "MAX_FICHAS_NUEVAS", 0),
        ):
            a.descargar(conocidos, self.original, self.doc, base=base)
        self.assertEqual(pedidos, [])

    def test_censo_lento_se_admite_con_las_fichas_pendientes(self) -> None:
        """La adquisición conserva las páginas admitidas aunque agote el margen antes de las fichas opcionales."""
        por_url = {comun.leer_recibo(self.original, cap)["url"]: cap for cap in [*self.capturas, self.normas]}
        transcurrido = [0.0]

        def recibir_del_censo(url: str, *_args: object, **_opciones: object) -> dict:
            self.assertIn(url, por_url, "Se intentó una ficha opcional después de agotar el presupuesto")
            if url == a.NORMAS:
                transcurrido[0] = 45 * 60
            return por_url[url]

        with (
            patch.object(comun, "recibir_url", side_effect=recibir_del_censo) as recibir,
            patch.object(time, "monotonic", side_effect=lambda: transcurrido[0]),
            patch.object(a.contraste_ediciones.negocio_actual, "leer", return_value=({}, {})),
        ):
            a.descargar([], self.original, self.doc, base=Path("base"))
        self.assertEqual([v.args[0] for v in recibir.call_args_list], [a.url_pagina(0), a.url_pagina(15), a.NORMAS])
        procedencia = recibos.leer_json((self.original / "procedencia.json").read_bytes())
        confirmado = a.calcular(self.original, procedencia, [])
        self.assertTrue(confirmado["censo_completo"])
        self.assertEqual(len(confirmado["censo"]["actividades"]), 16)
        self.assertEqual(procedencia["fichas"], self.doc["fichas"])
        self.assertEqual(procedencia["fichas_de_ediciones"], {})


class DeclaracionesGeneralesCibernarium(unittest.TestCase):
    """FAQ exacta frente a menciones incidentales, cambios o bloques ambiguos."""

    def extraer(self, cuerpo: bytes) -> dict:
        """Asocia los bytes de la fixture a una recepción completa e identificada.

        Returns:
            Condiciones generales que el lector puede justificar en esos bloques.
        """
        return faq.extraer(
            cuerpo,
            {
                "url_final": a.NORMAS,
                "http": 200,
                "completo": True,
                "cuerpo_sha256": hashlib.sha256(cuerpo).hexdigest(),
                "inicio_utc": "2026-10-23T21:00:00Z",
                "fin_utc": "2026-10-23T21:00:02Z",
            },
        )

    def test_gratuidad_y_registro_son_generales_no_personales(self) -> None:
        """El coste y requisito general no prueban certificado ni admisión de la persona."""
        salida = self.extraer(_normas())
        self.assertEqual(salida["formacion"]["alcance"], "declaracion_general")
        self.assertTrue(salida["inscripcion"]["registro_previo_para_inscribirse"])
        self.assertEqual(salida["acceso_general"]["edad"], {"operador": ">", "anos": 16})
        self.assertNotIn("certificado", salida)

    def test_mencion_de_menu_no_acredita_coste(self) -> None:
        """La misma frase en un menú no tiene alcance de condición del catálogo."""
        self.assertIsNone(self.extraer(("<nav>" + faq.GRATUIDAD + "</nav>").encode())["formacion"])

    def test_respuesta_distinta_no_se_normaliza_a_gratuita(self) -> None:
        """Una declaración nueva conserva el coste desconocido."""
        cuerpo = _normas().replace(faq.GRATUIDAD.encode(), b"Algunes activitats tenen cost")
        self.assertIsNone(self.extraer(cuerpo)["formacion"])

    def test_faq_duplicada_no_elige_una(self) -> None:
        """El lector rechaza dos respuestas para la misma FAQ en vez de escoger una."""
        duplicado = (
            _bloque("CG12", "Les activitats del Cibernàrium són de pagament o són gratuïtes?", faq.GRATUIDAD)
        ).encode()
        with self.assertRaises(FormatoInesperado):
            self.extraer(_normas() + duplicado)


if __name__ == "__main__":
    unittest.main()


class ColaIdiomasCibernarium(unittest.TestCase):
    """La consulta usa testigos de edición y no confunde cabecera con padre."""

    def test_pendientes_por_identidad_canonica_y_no_por_titulo(self) -> None:
        """Una cabecera alias llega a su padre y los conflictos se conservan sin atribuir."""
        programas = {"cibernarium:100": {"id": "cibernarium:100"}}
        ediciones = {
            "cibernarium-edicion:200": {
                "programa_id": "cibernarium:100",
                "datos": {"idioma_ficha_principal": None, "sincronia": "sincrona"},
            },
            "cibernarium-edicion:201": {
                "programa_id": "cibernarium:otro",
                "datos": {"idioma_ficha_principal": None, "sincronia": "sincrona"},
            },
        }
        actividad = {"activityId": "55", "listEditions": [{"activityId": "200"}]}
        self.assertEqual(a._programas_con_idioma_pendiente([actividad], programas, ediciones), {"100"})
        actividad["listEditions"].append({"activityId": "201"})
        self.assertEqual(a._programas_con_idioma_pendiente([actividad], programas, ediciones), set())
        actividad["listEditions"] = [{"activityId": "200"}]
        ediciones["cibernarium-edicion:200"]["datos"]["idioma_ficha_principal"] = "català"
        self.assertEqual(a._programas_con_idioma_pendiente([actividad], programas, ediciones), set())
        actividad["listEditions"].append({"activityId": "202", "listSessions": [{"beginDateTime": "x"}]})
        self.assertEqual(a._programas_con_idioma_pendiente([actividad], programas, ediciones), {"100"})

    def test_no_repite_ficha_ya_acreditada_y_reintenta_otra_edicion(self) -> None:
        """Solo se detiene la rotación cuando todas las ediciones visibles tienen idioma propio."""
        from plataforma_datos.cursos.pruebas.test_idiomas_edicion_cibernarium import _bloque, _ficha

        with tempfile.TemporaryDirectory() as carpeta:
            original = Path(carpeta)
            cap = _captura(original, robot.url_ficha("101"), _ficha(_bloque(201, "Català", 1)), id="cibernarium:101")
            programas = {"cibernarium:101": {"titulo": "Curso de ejemplo"}}
            ediciones = {
                "cibernarium-edicion:201": {
                    "programa_id": "cibernarium:101",
                    "datos": {"idioma_ficha_principal": None, "sincronia": "sincrona", "sesiones": []},
                }
            }
            actividades = [{"activityId": "55", "listEditions": [{"activityId": "201"}]}]
            self.assertEqual(
                a._sin_fichas_ya_resueltas({"101"}, actividades, programas, ediciones, {"101": cap}, original), set()
            )
            actividades[0]["listEditions"].append({"activityId": "202", "listSessions": [{"beginDateTime": "x"}]})
            self.assertEqual(
                a._sin_fichas_ya_resueltas({"101"}, actividades, programas, ediciones, {"101": cap}, original), {"101"}
            )
