"""Condiciones públicas con finalidad y tiempo propios, sin cuentas ni red."""

import copy
import hashlib
import html
import json
import shutil
import unittest
from dataclasses import replace
from unittest.mock import patch
from urllib.parse import quote, urlsplit

from plataforma_datos.cursos import almacen_catalogo, contenido_academy, contrato_entrega_catalogo, operacion_fuente
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos.fuentes.claude_academy import actualizacion as academy
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_formacion as condiciones
from plataforma_datos.cursos.fuentes.claude_academy import lector
from plataforma_datos.cursos.hechos_entrega_catalogo import proyectar_hechos
from plataforma_datos.cursos.pruebas import test_academy_actualizacion as flujo
from plataforma_datos.cursos.pruebas.test_acceso_publico_academy import CURSO, captura
from plataforma_datos.cursos.pruebas.test_aprendizaje_entrega import RAIZ
from plataforma_datos.cursos.recepciones_catalogo import RespuestaCatalogo


def faq(*, extra: str = "", encabezado: str = "Sign-in and access") -> tuple[bytes, dict]:
    """Reconstruye fragmentos de prueba; estos bytes no se atribuyen a una consulta real.

    Returns:
        HTML y metadatos sintéticos con la sección revisada y un cambio adversario opcional.
    """
    d = json.loads((RAIZ / "pruebas/fixtures/academy-inscripcion-seccion.json").read_bytes())
    cuerpo = "<h1>Frequently asked questions</h1>"
    for tag, texto in d["bloques"]:
        cuerpo += f"<{tag}>" + html.escape(encabezado if tag == "h2" else texto) + f"</{tag}>"
    return captura(condiciones.FAQ, "FAQ · Claude Academy", cuerpo + extra)


def propia(*, login: str | None = None, modo: str = "Online", ajeno: bool = False) -> tuple[bytes, lector.FichaAcademy]:
    """Construye metadatos de curso propios o ajenos y un enlace de inscripción.

    Returns:
        Captura sintética y ficha reextraída, nunca identidad adjudicada por título.
    """
    d = {
        "@type": "Course",
        "url": CURSO if not ajeno else CURSO + "-otro",
        "name": "Curso de ejemplo",
        "hasCourseInstance": [{"@type": "CourseInstance", "courseMode": modo}],
    }
    enlace = login if login is not None else "/login?returnTo=%2Fcourses%2Fejemplo"
    cuerpo = '<h1>Curso de ejemplo</h1><a href="' + html.escape(enlace) + '">Sign in to save progress</a>'
    cuerpo += '<script type="application/ld+json">' + json.dumps(d) + "</script>"
    raw, meta = captura(CURSO, "Curso de ejemplo · Claude Academy", cuerpo)
    return raw, lector.extraer_ficha(raw, meta, url_esperada=CURSO)


class CondicionesFormacionAcademyPruebas(unittest.TestCase):
    """No equipara inscripción con lectura ni la práctica con matrícula gratuita."""

    def test_faq_declaracion_completa_revisada(self) -> None:
        """Reconoce sección y finalidad; conserva el párrafo y su localizador exactos."""
        declaracion = condiciones.declaracion_inscripcion(*faq())
        self.assertIsNotNone(declaracion)
        self.assertEqual(declaracion.sha256_texto, condiciones.HUELLA_PARRAFO)
        self.assertIn(condiciones.FRAGMENTO, declaracion.texto)
        self.assertIn("/p[", declaracion.localizador)

    def test_cambio_o_contradiccion_en_seccion_no_se_da_por_conocido(self) -> None:
        """La frase intacta no tapa una condición añadida o un contexto distinto."""
        for opciones in (
            {"extra": "<p>A paid account is now required to enroll.</p>"},
            {"encabezado": "Archived policy"},
        ):
            with self.subTest(opciones=opciones):
                self.assertIsNone(condiciones.declaracion_inscripcion(*faq(**opciones)))
        raw, meta = faq()
        raw = raw.replace(b"free Claude account", b"paid Claude account")
        meta.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        self.assertIsNone(condiciones.declaracion_inscripcion(raw, meta))

    def test_declaracion_citada_o_entidad_ajena_no_es_politica_actual(self) -> None:
        """Conservar la frase y encabezados dentro de una cita no acredita su aplicación."""
        for apertura, cierre in (
            ("<blockquote>", "</blockquote>"),
            (
                '<section itemscope itemtype="https://schema.org/Product" itemid="https://example.test/archivo">',
                "</section>",
            ),
        ):
            raw, meta = faq()
            raw = raw.replace(b"<h2>", apertura.encode() + b"<h2>", 1).replace(b"</main>", cierre.encode() + b"</main>")
            meta.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            with self.subTest(apertura=apertura):
                self.assertIsNone(condiciones.declaracion_inscripcion(raw, meta))

    def test_error_http_o_canonical_ajeno_no_acreditan_faq(self) -> None:
        """Un error técnico no se transforma en nueva confirmación del registro."""
        raw, meta = faq()
        with self.assertRaises(lector.ErrorFichaAcademy):
            condiciones.declaracion_inscripcion(raw, {**meta, "http": 403})
        raw = raw.replace(condiciones.FAQ.encode(), (condiciones.FAQ + "-otra").encode())
        meta.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        with self.assertRaises(lector.ErrorFichaAcademy):
            condiciones.declaracion_inscripcion(raw, meta)

    def test_login_debe_volver_al_mismo_curso(self) -> None:
        """No sigue el enlace y rechaza retorno ajeno, duplicado o consulta ambigua."""
        self.assertIsNotNone(condiciones.enlace_inscripcion(propia()[1]))
        for login in (
            "/login?returnTo=%2Fcourses%2Fotro",
            "https://otro.example/login?returnTo=%2Fcourses%2Fejemplo",
            "/login?returnTo=%2Fcourses%2Fejemplo&returnTo=%2Fcourses%2Fotro",
        ):
            self.assertIsNone(condiciones.enlace_inscripcion(propia(login=login)[1]))
        f = propia()[1]
        self.assertIsNone(condiciones.enlace_inscripcion(replace(f, enlaces=f.enlaces * 2)))

    def test_modalidad_solo_jsonld_de_la_identidad_propia(self) -> None:
        """No obtiene modo de título, plataforma, producto o instancia contradictoria."""
        raw, f = propia()
        self.assertEqual(condiciones.modalidad(raw, f)["valor"], "en-linea")
        for opciones in ({"ajeno": True}, {"modo": "In person"}):
            raw, f = propia(**opciones)
            self.assertIsNone(condiciones.modalidad(raw, f))

    def test_faq_anterior_conserva_valor_y_fecha_y_futura_no_se_proyecta(self) -> None:
        """La prueba conserva la fecha de su captura días después; una captura futura no cuenta."""
        raw, f = propia()
        prueba = {
            "url": condiciones.FAQ,
            "sha256": "f" * 64,
            "capturado_utc": "2026-10-23T10:01:00Z",
            "localizador": "p",
        }
        dato = {
            "regla": condiciones.REGLA,
            "registro_previo_para_inscribirse": True,
            "alcance": "declaracion_general",
            "evidencia": prueba,
        }
        actual = contenido_academy.TemarioAcademy(
            ficha=f, cuerpo_html=raw.decode(), idioma="en", comprobado_el="2026-10-23T10:00:00Z", inscripcion=dato
        )
        self.assertIn("inscripcion", contenido_academy.datos_para_entrega(actual, "2026-10-23T10:02:00Z"))
        anterior = replace(
            actual, inscripcion={**dato, "evidencia": {**prueba, "capturado_utc": "2026-10-23T09:59:00Z"}}
        )
        self.assertIn("inscripcion", contenido_academy.datos_para_entrega(anterior, "2026-10-23T10:02:00Z"))
        for fecha, corte in (("2026-10-23T10:03:00Z", "2026-10-23T10:02:00Z"),):
            otro = replace(actual, inscripcion={**dato, "evidencia": {**prueba, "capturado_utc": fecha}})
            self.assertNotIn("inscripcion", contenido_academy.datos_para_entrega(otro, corte))
        antigua = contenido_academy.datos_para_entrega(actual, "2026-10-27T10:01:00Z")
        self.assertEqual(antigua["inscripcion"]["vigencia"], {"comprobado_el": "2026-10-23T10:01:00Z"})
        self.assertNotIn("vigente", antigua["inscripcion"])
        self.assertEqual(len(antigua["referencias"]), 2)
        hecho = proyectar_hechos({}, alcance="unidad", condiciones_actuales=antigua)["requiere_registro_previo"]
        self.assertEqual((hecho["valor"], hecho["motivo"]), (True, "conocido"))
        self.assertEqual(hecho["vigencia"], {"comprobado_el": "2026-10-23T10:01:00Z"})

    def test_hechos_conservan_prosa_costes_y_conflictos(self) -> None:
        """La declaración general no sobrescribe texto, ni un registro propio contrario."""
        datos = {
            "requisitos_publicados": "Cuenta de práctica; algunas funciones requieren plan de pago.",
            "coste_practicas": "No comprobado",
        }
        antes = copy.deepcopy(datos)
        actual = {"inscripcion": {"registro_previo_para_inscribirse": True}, "modalidad": {"valor": "en-linea"}}
        salida = proyectar_hechos(datos, alcance="unidad", proveedor_id="anthropic", condiciones_actuales=actual)
        self.assertEqual(salida["requiere_registro_previo"]["valor"], True)
        self.assertEqual(salida["requiere_registro_previo"]["alcance"], "declaracion_general")
        self.assertEqual(salida["modalidad"]["valor"], "en-linea")
        self.assertIsNone(salida["coste_practicas"]["valor"])
        self.assertEqual(datos, antes)
        datos["requisitos_publicados"] = {"registro_previo_para_inscribirse": False}
        conflicto = proyectar_hechos(datos, alcance="unidad", proveedor_id="anthropic", condiciones_actuales=actual)
        self.assertEqual(conflicto["requiere_registro_previo"]["motivo"], "declaraciones_contradictorias")


class CicloInscripcionAcademyPruebas(unittest.TestCase):
    """La FAQ participa en el ciclo común; fallo no publica, cambio no hereda permiso."""

    def setUp(self) -> None:
        """Prepara recepción sintética completa y controles productivos, sin red."""
        self.conocidos_real = operacion_fuente.conocidos
        self.caso = flujo.AcademyActualizacionPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.original = self.caso.rx.recibir
        self.http_faq = 200
        self.extra_faq = ""
        self.identidad_faq_ajena = False
        parche = patch.object(operacion_fuente, "consultar", side_effect=self.recibir)
        parche.start()
        self.addCleanup(parche.stop)
        self.caso.rx.ciclo()
        self.caso.componer()

    def recibir(self, url: str, **opciones: object) -> RespuestaCatalogo:
        """Sustituye solo el transporte por HTML/fechas sintéticos identificados.

        Returns:
            Respuesta que las etapas reales aún deben preparar, validar y admitir.
        """
        rx = self.original(url, **opciones)
        if url == condiciones.FAQ:
            raw, _meta = faq(extra=self.extra_faq)
            if self.identidad_faq_ajena:
                raw = raw.replace(condiciones.FAQ.encode(), (condiciones.FAQ + "-ajena").encode())
            if self.http_faq is None:
                return replace(rx, cuerpo=None, http=None, completo=False, error="Fallo sintético de conexión")
            return replace(rx, cuerpo=raw, http=self.http_faq)
        ruta = urlsplit(url).path
        curso = lector.PATRON_CURSO.fullmatch(ruta)
        if curso is not None:
            extra = '<a href="/login?returnTo=' + quote(ruta, safe="") + '">Sign in to save progress</a>'
            dato = {
                "@type": "Course",
                "name": "Curso " + curso[1],
                "url": url,
                "hasCourseInstance": [{"@type": "CourseInstance", "courseMode": "Online"}],
            }
            extra += '<script type="application/ld+json">' + json.dumps(dato) + "</script>"
            return replace(rx, cuerpo=rx.cuerpo.replace(b"</main>", extra.encode() + b"</main>"))
        return rx

    def _comprobar_fallo_auxiliar(self, http: int | None) -> None:
        """Ejecuta el fallo indicado y compara fichas, fechas y referencia conservada."""
        _, anterior = self.caso.componer()
        previa = next(o for o in anterior["ofertas"] if o["unidad"]["id"] == flujo.ID)
        area = self.caso.raiz / almacen_catalogo.RUTA
        control = json.loads((area / almacen_catalogo.CONTROL).read_bytes())
        faq_previa = almacen_catalogo.leer_documento(area, control["procedencia"]["control-academy"])["faq"]
        self.http_faq = http
        conjunto = self.caso.rx.ciclo()
        self.assertIn(conjunto["auxiliares"]["faq"]["lectura"]["fallo"], {"ErrorFichaAcademy", "FormatoInesperado"})
        _, despues = self.caso.componer("2026-10-23T10:06:00Z")
        actual = next(o for o in despues["ofertas"] if o["unidad"]["id"] == flujo.ID)
        self.assertGreater(actual["comprobado_el"], previa["comprobado_el"])
        self.assertEqual(actual["hechos"]["modalidad"]["valor"], "en-linea")
        self.assertIs(actual["hechos"]["requiere_registro_previo"]["valor"], True)
        self.assertNotIn("vence_el", actual)
        self.assertEqual(
            actual["hechos"]["requiere_registro_previo"]["vigencia"],
            previa["hechos"]["requiere_registro_previo"]["vigencia"],
        )
        self.assertGreater(actual["comprobado_el"], previa["comprobado_el"])
        control = json.loads((area / almacen_catalogo.CONTROL).read_bytes())
        conservada = almacen_catalogo.leer_documento(area, control["procedencia"]["control-academy"])["faq"]
        self.assertEqual(conservada, faq_previa)

    def test_faq_403_no_bloquea_fichas_y_conserva_prueba_anterior_sin_renovarla(self) -> None:
        """Renueva fichas válidas sin convertir el error FAQ en cierre o confirmación."""
        self._comprobar_fallo_auxiliar(403)

    def test_transporte_faq_sin_cuerpo_no_bloquea_fichas_ni_fabrica_prueba(self) -> None:
        """Conserva el recibo del intento fallido aunque no exista cuerpo que archivar."""
        self._comprobar_fallo_auxiliar(None)

    def test_faq_antigua_conserva_registro_y_fecha_tras_fichas_nuevas(self) -> None:
        """Un día después, la ficha renovada no renueva ni anula la FAQ fallida; conserva su fecha."""
        _, anterior = self.caso.componer()
        previa = next(o for o in anterior["ofertas"] if o["unidad"]["id"] == flujo.ID)
        self.http_faq = 403
        self.caso.rx.numero += 86400
        self.caso.rx.ciclo()
        _, despues = self.caso.componer("2026-10-24T10:06:00Z")
        actual = next(o for o in despues["ofertas"] if o["unidad"]["id"] == flujo.ID)
        registro = actual["hechos"]["requiere_registro_previo"]
        self.assertIs(registro["valor"], True)
        self.assertEqual(registro["vigencia"], previa["hechos"]["requiere_registro_previo"]["vigencia"])
        self.assertTrue(registro["vigencia"]["comprobado_el"].startswith("2026-10-23"))
        self.assertTrue(actual["comprobado_el"].startswith("2026-10-24"))

    def test_seleccion_sin_intento_faq_conserva_referencia_previa(self) -> None:
        """Actualizar filas sin auxiliar no borra ni renueva una prueba conservada."""
        area = self.caso.raiz / almacen_catalogo.RUTA
        control = json.loads((area / almacen_catalogo.CONTROL).read_bytes())
        previo = almacen_catalogo.leer_documento(area, control["procedencia"]["control-academy"])
        inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
        academy._guardar_seleccion(area, control, inventario, previo["recepciones"], None)
        actual = almacen_catalogo.leer_documento(area, control["procedencia"]["control-academy"])
        self.assertEqual(actual, previo)

    def test_faq_200_con_identidad_ajena_desconoce_registro_sin_cerrar_curso(self) -> None:
        """La respuesta completa ajena no selecciona una FAQ histórica conveniente."""
        self.identidad_faq_ajena = True
        conjunto = self.caso.rx.ciclo()
        self.assertIs(conjunto["auxiliares"]["faq"]["lectura"]["retener_anterior"], False)
        _, publico = self.caso.componer("2026-10-23T10:06:00Z")
        oferta = next(o for o in publico["ofertas"] if o["unidad"]["id"] == flujo.ID)
        self.assertIsNone(oferta["hechos"]["requiere_registro_previo"]["valor"])
        self.assertEqual(oferta["hechos"]["modalidad"]["valor"], "en-linea")

    def test_reaplicar_hp_conserva_selector_academy_hechos_fechas_y_replay(self) -> None:
        """La nueva recepción HP no sustituye la procedencia de Academy por su firma."""
        _, publico = self.caso.componer()
        previas = {o["unidad"]["id"]: o for o in publico["ofertas"] if o["proveedor_id"] == "anthropic"}
        nueva = self.caso.hp.guardar_recepcion(fecha="2026-10-23T10:02:00Z")
        original, _, _ = operacion_fuente.rutas_de_la_fuente("hp_life", self.caso.raiz)
        original.mkdir(parents=True)
        fila = {"id": nueva.id}
        for campo, ref in (("cuerpo", nueva.cuerpo), ("recibo", nueva.recibo), ("intento", nueva.recibo)):
            destino = original / ref.ruta.name
            if not destino.exists():
                shutil.copyfile(ref.ruta, destino)
            fila[campo] = {"archivo": destino.name, "sha256": ref.sha256}
        operacion_fuente.guardar_capturas_de_fuente(original, "hp_life", [fila], {})
        with patch.object(operacion_fuente, "conocidos", side_effect=self.conocidos_real):
            operacion_fuente.preparar("hp_life", raiz=self.caso.raiz)
            operacion_fuente.validar("hp_life", raiz=self.caso.raiz)
            _, actual = self.caso.componer("2026-10-23T10:06:00Z")
            academias = {o["unidad"]["id"]: o for o in actual["ofertas"] if o["proveedor_id"] == "anthropic"}
            self.assertEqual(academias, previas)
            area = self.caso.raiz / almacen_catalogo.RUTA
            control = json.loads((area / almacen_catalogo.CONTROL).read_bytes())
            self.assertIn("control-academy", control["procedencia"])
            self.assertIn("recibo-academy", control["procedencia"])
            fijo = self.caso.inventario()
            self.caso.componer("2026-10-23T10:06:00Z")
            self.assertEqual(self.caso.inventario(), fijo)

    def test_procedencia_ajena_sin_archivo_conservado_no_se_rescata(self) -> None:
        """Ni la firma de la fuente ni un nombre anterior sustituyen el archivo SHA."""
        anterior = {"procedencia": {"control-academy": {"archivo": "anterior.ref", "sha256": "a" * 64}}}
        nuevo = {"procedencia": {}, "archivos_conservados": []}
        with self.assertRaises(contrato_entrega_catalogo.ErrorEntregaCatalogo):
            componer._heredar_procedencias(anterior, nuevo)

    def test_intervalo_de_hecho_exige_forma_corte_y_referencia(self) -> None:
        """Rechaza vigencia vacía, futura, con vencimiento propio o sin enlace a la fecha de una prueba."""
        _, publico = self.caso.componer()
        oferta = next(o for o in publico["ofertas"] if o["unidad"]["id"] == flujo.ID)
        contrato_entrega_catalogo._oferta(oferta, publico["corte_proyeccion_utc"], publico["schema_version"])
        for variante in ("vacio", "futuro", "con_vencimiento", "sin_referencia", "desconocido"):
            fila = copy.deepcopy(oferta)
            h = fila["hechos"]["requiere_registro_previo"]
            if variante == "vacio":
                h["vigencia"] = {}
            elif variante == "futuro":
                h["vigencia"] = {"comprobado_el": "2026-10-24T10:00:00Z"}
            elif variante == "con_vencimiento":
                h["vigencia"]["vence_el"] = "2026-10-25T10:00:00Z"
            elif variante == "sin_referencia":
                fila["referencias"] = []
            else:
                h.update(valor=None, motivo="comprobacion_vencida")
            with self.subTest(variante=variante), self.assertRaises(contrato_entrega_catalogo.ErrorEntregaCatalogo):
                contrato_entrega_catalogo._oferta(fila, publico["corte_proyeccion_utc"], publico["schema_version"])

    def test_faq_cambiada_se_admite_como_desconocida_sin_presumir_registro(self) -> None:
        """Mantiene oferta y modalidad, pero el registro ya no está acreditado."""
        _, previo = self.caso.componer()
        oferta = next(o for o in previo["ofertas"] if o["unidad"]["id"] == flujo.ID)
        self.assertIs(oferta["hechos"]["requiere_registro_previo"]["valor"], True)
        self.assertEqual(oferta["hechos"]["modalidad"]["valor"], "en-linea")
        self.extra_faq = "<p>Account conditions have changed; contact the provider.</p>"
        self.caso.rx.ciclo()
        _, despues = self.caso.componer("2026-10-23T10:06:00Z")
        actual = next(o for o in despues["ofertas"] if o["unidad"]["id"] == flujo.ID)
        self.assertIsNone(actual["hechos"]["requiere_registro_previo"]["valor"])
        self.assertEqual(actual["hechos"]["modalidad"]["valor"], "en-linea")


if __name__ == "__main__":
    unittest.main()
