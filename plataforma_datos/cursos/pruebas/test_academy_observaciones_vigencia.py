"""Del HTML Academy a la regla común: conserva incertidumbres y límites de alcance."""

import unittest
from dataclasses import replace

from plataforma_datos.cursos import (
    contenido_academy,
    hechos_entrega_catalogo,
    oferta_continua,
    politicas_vigencia,
    recepciones_catalogo,
)
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.fuentes.claude_academy import observaciones_vigencia as puente
from plataforma_datos.cursos.pruebas import test_academy_ciclo_recepciones as fixtures
from plataforma_datos.cursos.vigencia import evaluar_vigencia


class AcademyObservacionesPruebas(fixtures.AcademyCicloRecepcionesPruebas):
    """Recepciones sintéticas y extracción/admisión reales, sin red ni cuentas."""

    def setUp(self) -> None:
        """Añade declaraciones literales de destinatarios y requisitos a cada curso."""
        super().setUp()
        self.extra = ""
        self.condiciones = "<h2>Who is this course for?</h2><p>This course is for teachers.</p>"
        self.condiciones += "<h2>Prerequisites</h2><p>No prior experience is required.</p>"
        self.cta_ajeno = False
        self.portada_gratuita = True
        self.resumen_portada = False

    def recibir(self, url: str, **opciones: object) -> recepciones_catalogo.RespuestaCatalogo:
        """Inyecta solo HTML adversario, conservando el transporte y sus fechas.

        Returns:
            Recepción sintética con cuerpo completo y sin comprobaciones fingidas.
        """
        rx = super().recibir(url, **opciones)
        cuerpo = rx.cuerpo
        if url not in (acceso.INDICE, acceso.PORTADA) and not url.endswith("/inicio"):
            cuerpo = cuerpo.replace(b"</main>", (self.condiciones + self.extra + "</main>").encode())
            if self.cta_ajeno:
                cuerpo = cuerpo.replace(b'/inicio">Start course', b'-ajeno/inicio">Start course')
        if url == acceso.PORTADA and self.resumen_portada:
            cuerpo = cuerpo.replace(acceso.DECLARACION.encode(), acceso.RESUMEN_GRATUIDAD.encode())
        if url == acceso.PORTADA and not self.portada_gratuita:
            cuerpo = cuerpo.replace(acceso.DECLARACION.encode(), b"Explore courses and tutorials.")
        return replace(rx, cuerpo=cuerpo)

    def observar(self, *, id: str = "claude-academy:nuevo") -> dict:
        """Compila los bytes admitidos por la operación registrada.

        Returns:
            Observación compuesta con apoyos fechados de cada canal real simulado.
        """
        conjunto = self.ciclo()
        original, _, _ = fuente.rutas_de_la_fuente("claude_academy", self.raiz)
        fila = next(f for f in conjunto["recepciones"] if f["id"] == id)
        _, observacion = puente.construir(original, fila, conjunto["auxiliares"])
        return observacion

    def evaluar(self, observacion: dict, ahora: str = "2026-10-23T10:05:00Z") -> dict:
        """Usa la política Academy versionada y el evaluador común.

        Returns:
            Disponibilidad con motivo, comprobación y próxima revisión interna.
        """
        oferta = {"id": "claude-academy:nuevo", "fuente_id": "claude_academy", "url": acceso.ORIGEN + "/courses/nuevo"}
        return evaluar_vigencia(
            oferta, [observacion], politicas_vigencia.leer_politica("claude_academy", "2"), ahora=ahora
        )

    def test_curso_declarado_gratuito_con_condiciones_constatadas(self) -> None:
        """La primera lección apoya el destino; no afirma acceso sin registro ni fechas."""
        observacion = self.observar()
        self.assertEqual(self.evaluar(observacion)["estado"], "disponible-publicamente")
        self.assertIsNone(observacion["detalle"]["acceso_abierto"])
        self.assertIsNone(observacion["detalle"]["datos_edicion"]["fechas_matricula"]["inicio"])
        self.assertTrue(
            all(c["valor"] is True for c in observacion["detalle"][oferta_continua.CAMPO]["criterios"].values())
        )

    def test_la_portada_breve_conserva_el_recibo_admitido(self) -> None:
        """Releer el resumen conserva la representación histórica de los auxiliares."""
        self.resumen_portada = True
        conjunto = self.ciclo()
        self.assertIsNone(conjunto["auxiliares"]["portada"]["lectura"]["gratuidad_formacion_declarada"])
        self.assertEqual(fuente.leer_validado("claude_academy", self.raiz), conjunto)

    def test_el_precio_de_la_ficha_llega_al_catalogo_y_rechaza_una_huella_ajena(self) -> None:
        """Entrega el precio en la unidad cuando ficha, observación y selector concuerdan."""
        self.extra = (
            '<script type="application/ld+json">{"@type":"Course","url":"https://academy.claude.com/courses/nuevo",'
            '"isAccessibleForFree":true}</script>'
        )
        conjunto = self.ciclo()
        original, _, _ = fuente.rutas_de_la_fuente("claude_academy", self.raiz)
        fila = next(f for f in conjunto["recepciones"] if f["id"] == "claude-academy:nuevo")
        ficha, observacion = puente.construir(original, fila, conjunto["auxiliares"])
        cuerpo, _ = fuente.pagina_academy(original, fila)
        formacion = contenido_academy._gratuidad(observacion, ficha, cuerpo)
        self.assertIsNotNone(formacion)
        temario = contenido_academy.TemarioAcademy(
            ficha=ficha,
            cuerpo_html=cuerpo.decode(),
            idioma=None,
            comprobado_el=ficha.capturado_utc,
            formacion=formacion,
        )
        condiciones = contenido_academy.datos_para_entrega(temario, ficha.capturado_utc)
        coste = hechos_entrega_catalogo.proyectar_hechos(
            {}, alcance="unidad", proveedor_id="anthropic", condiciones_actuales=condiciones
        )["coste_formacion_tipo"]
        self.assertEqual((coste["valor"], coste["alcance"]), ("gratis_formacion", "unidad"))
        formacion["evidencia"]["sha256"] = "1" * 64
        self.assertIsNone(contenido_academy._gratuidad(observacion, ficha, cuerpo))

    def test_portada_breve_con_precio_propio_y_temario_integro(self) -> None:
        """Una oferta del curso y su temario completo tienen pruebas propias en la ficha."""
        self.resumen_portada = True
        oferta = (
            '<script type="application/ld+json">{"@type":"Course","url":"https://academy.claude.com/courses/nuevo",'
            '"isAccessibleForFree":true,"offers":[{"@type":"Offer","category":"Free"}]}</script>'
        )
        self.extra = oferta
        observada = self.observar()
        criterios = observada["detalle"][oferta_continua.CAMPO]["criterios"]
        self.assertIs(criterios["formacion_gratuita"]["valor"], True)
        self.assertIsNone(criterios["curso_completo"]["valor"])
        self.assertNotEqual(self.evaluar(observada)["estado"], "disponible-publicamente")
        titulo = "Curso nuevo"
        boton = f'<button aria-label="Show course lessons. {titulo} — 2 lessons">Contents</button>'
        temario = (
            '<nav aria-label="Course outline"><ul><li><a href="/courses/nuevo/inicio">Introduction</a></li>'
            '<li><a href="/courses/nuevo/practica">Practice</a></li>'
            '<li><a href="/courses/nuevo/complete">\ue071Course complete</a></li></ul></nav>'
        )
        self.extra = oferta + boton + temario
        observada = self.observar()
        self.assertEqual(self.evaluar(observada)["estado"], "disponible-publicamente")
        criterios = observada["detalle"][oferta_continua.CAMPO]["criterios"]
        apoyos_precio = [observada["evidencias"][i] for i in criterios["formacion_gratuita"]["apoyos"]]
        self.assertTrue(any("ld+json" in a["localizador"]["valor"] for a in apoyos_precio))
        apoyos_curso = [observada["evidencias"][i] for i in criterios["curso_completo"]["apoyos"]]
        self.assertTrue(any("/nav[" in a["localizador"]["valor"] for a in apoyos_curso))
        for parcial in (
            "<div hidden>" + temario + "</div>",
            "<template>" + temario + "</template>",
            temario.replace('<li><a href="/courses/nuevo/practica"', '<li inert><a href="/courses/nuevo/practica"'),
            temario.replace("/courses/nuevo/practica", "https://[invalid"),
            temario.replace("/nuevo/practica", "/otro/practica"),
            temario.replace("/nuevo/practica", "/nuevo/inicio"),
            temario.replace('aria-label="Course outline"', 'aria-label="Related courses"'),
            temario.replace('href="/courses/nuevo/practica"', 'aria-disabled="true" href="/courses/nuevo/practica"'),
        ):
            with self.subTest(temario=parcial):
                self.extra = oferta + boton + parcial
                self.assertNotEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")
        self.extra = boton + temario
        sin_precio = self.observar()["detalle"][oferta_continua.CAMPO]["criterios"]
        self.assertIsNone(sin_precio["formacion_gratuita"]["valor"])
        self.assertIs(sin_precio["curso_completo"]["valor"], True)
        self.extra = oferta + boton + temario + "<p>This is a free preview of a paid course.</p>"
        self.assertNotEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")

    def test_muestra_de_pago_no_se_convierte_en_curso_gratuito(self) -> None:
        """La declaración general no tapa una muestra o un precio del curso concreto."""
        for texto in ("This is a free preview of a paid course.", "This course costs 100 euros."):
            with self.subTest(texto=texto):
                self.extra = f"<p>{texto}</p>"
                self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")

    def test_cta_ajeno_no_se_acredita(self) -> None:
        """Un enlace a otro curso no se sigue ni acredita el destino propio."""
        self.cta_ajeno = True
        observacion = self.observar()
        self.assertEqual(self.evaluar(observacion)["estado"], "sin-confirmar")
        self.assertFalse(any("-ajeno/" in url for url in self.llamadas))

    def test_sin_condiciones_o_declaracion_conserva_desconocidos(self) -> None:
        """No infiere elegibilidad de título, publicidad, precio histórico o HTTP200."""
        self.condiciones = ""
        self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")
        self.condiciones = "<p>This course is for teachers.</p><p>No prerequisites are required.</p>"
        self.portada_gratuita = False
        self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")

    def test_cierre_contradictorio_no_abre(self) -> None:
        """La declaración específica de cierre prevalece sobre portada y CTA positivos."""
        self.extra = "<p>This course is closed.</p>"
        self.assertEqual(self.evaluar(self.observar())["estado"], "no-disponible-publicamente")

    def test_mantenimiento_o_cierre_condicional_no_se_declaran_baja_comercial(self) -> None:
        """Una frase técnica o condicional conserva incertidumbre sin interpretar prefijos."""
        for texto in ("This course is closed for maintenance.", "This course is closed if registration ends."):
            with self.subTest(texto=texto):
                self.extra = f"<p>{texto}</p>"
                observacion = self.observar()
                self.assertIsNone(observacion["detalle"]["datos_edicion"]["estado_inscripcion"])
                self.assertEqual(self.evaluar(observacion)["estado"], "sin-confirmar")

    def test_cero_complemento_y_condicion_comercial_no_resuelta(self) -> None:
        """No se deduce pago de la palabra costs ni gratuidad de una prosa no reconocida."""
        self.extra = "<p>This course costs 0 euros.</p>"
        self.assertEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")
        self.extra = "<p>This course requires payment only for its optional certificate.</p>"
        self.assertEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")
        self.extra = "<p>This course requires payment if you are not a student.</p>"
        self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")

    def test_precio_individual_y_etiquetas_equivalentes_prevalecen_sobre_portada(self) -> None:
        """Campos propios positivos, desconocidos o contradictorios no se tapan con Free courses."""
        for texto in (
            "Course price: 49 euros.",
            "Price: €49.",
            "Cost of the course: 49 EUR.",
            "Tuition fee: 49 dollars.",
            "Course fee: 49.",
            "Precio: 49 euros.",
            "This course may require payment.",
            "Pricing is subject to confirmation.",
        ):
            with self.subTest(texto=texto):
                self.extra = f"<p>{texto}</p>"
                self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")

    def test_inscripcion_especifica_cerrada_y_contradiccion_no_se_ofrecen(self) -> None:
        """Reconoce declaraciones propias completas y conserva incertidumbre de las demás."""
        for texto in (
            "Enrollment is closed.",
            "Registration: Closed",
            "Enrollment status: closed.",
            "Inscripciones cerradas.",
        ):
            with self.subTest(texto=texto):
                self.extra = f"<p>{texto}</p>"
                self.assertEqual(self.evaluar(self.observar())["estado"], "no-disponible-publicamente")
        for texto in (
            "Enrollment is not closed.",
            "Registration is closed for maintenance.",
            "Enrollment is closed if payment is required.",
        ):
            with self.subTest(texto=texto):
                self.extra = f"<p>{texto}</p>"
                observacion = self.observar()
                self.assertIsNone(observacion["detalle"]["datos_edicion"]["estado_inscripcion"])
                self.assertEqual(self.evaluar(observacion)["estado"], "sin-confirmar")
        for html in (
            "<p>Enrollment is open.</p><p>Enrollment is closed.</p>",
            "<p>Inscripciones abiertas.</p><p>Inscripciones cerradas.</p>",
        ):
            self.extra = html
            self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")

    def test_complementos_de_pago_no_son_matricula_y_otra_prosa_no_es_cierre(self) -> None:
        """Distingue prácticas/productos/certificado del curso y conserva acceso sin registro desconocido."""
        for html in (
            "<p>Optional certificate price: 49 euros.</p>",
            "<p>A paid plan is required for the optional exercises.</p>",
            "<h2>Optional certificate</h2><p>Price: 49 euros.</p>",
            "<p>Certificate registration is closed.</p>",
            "<p>This course covers pricing strategies and closed-loop systems.</p>",
        ):
            with self.subTest(html=html):
                self.extra = html
                observacion = self.observar()
                self.assertEqual(self.evaluar(observacion)["estado"], "disponible-publicamente")
                self.assertIsNone(observacion["detalle"]["acceso_abierto"])
        self.extra = "<p>Course price: 49 euros including the optional certificate.</p>"
        self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")

    def test_metadatos_de_curso_pagado_o_inscripcion_cerrada_no_se_ofrecen(self) -> None:
        """Metadata propia o Course.offers ligado a la ficha no se oculta detrás del CTA."""
        for html in (
            '<meta itemprop="price" content="49">',
            '<meta name="course:enrollment" content="closed">',
            '<script type="application/ld+json">{"@type":"Course","url":"https://academy.claude.com/courses/nuevo","offers":{"price":"49"}}</script>',
            '<script type="application/ld+json">{"@type":"Course","url":"https://academy.claude.com/courses/nuevo","offers":{"@id":"#oferta"}}</script>',
            '<script type="application/ld+json">{"@type":"Course","url":"https://academy.claude.com/courses/nuevo","offers":{"price":49,"price":0}}</script>',
        ):
            with self.subTest(html=html):
                self.extra = html
                self.assertNotEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")
        self.extra = '<script type="application/ld+json">{"@type":"Course","url":"https://academy.claude.com/courses/otro","offers":{"price":"49"}}</script>'
        self.assertEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")

    def test_entidades_identificadas_ajenas_no_deciden_precio_ni_cierre_del_curso(self) -> None:
        """El ámbito explícito de otro producto o curso se conserva, sin imputarlo al actual."""
        for html in (
            (
                '<section itemscope itemtype="https://schema.org/Product" '
                'itemid="https://academy.claude.com/certificado"><h2>Optional certificate</h2><meta '
                'itemprop="price" content="49"><p>Price: 49 euros.</p></section>'
            ),
            (
                '<section itemscope itemtype="https://schema.org/Product" '
                'itemid="#certificate"><meta itemprop="price" content="49"></section>'
            ),
            (
                '<section itemscope itemtype="https://schema.org/Course" '
                'itemid="/courses/otro"><meta itemprop="price" content="49"><p>Enrollment is '
                "closed.</p></section>"
            ),
            (
                '<section itemscope itemtype="https://schema.org/Course" '
                'itemid="/courses/otro"><h2>Other course</h2><div>Course price: 49 '
                "euros.</div><dl><dt>Enrollment status</dt><dd>Closed</dd></dl></section>"
            ),
        ):
            with self.subTest(html=html):
                self.extra = html
                self.assertEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")
        self.extra += "<p>Course price: 49 euros.</p>"
        self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")

    def test_el_ambito_propio_conserva_precio_y_cierre_y_no_hereda_un_contexto_ajeno(self) -> None:
        """Identificador propio y salida del ámbito se reconocen sin mirar proximidad del texto."""
        self.extra = (
            '<section itemscope itemtype="https://schema.org/Course" '
            'itemid="/courses/nuevo#course"><meta itemprop="price" content="49"></section>'
        )
        self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")
        self.extra = (
            '<section itemscope itemtype="https://schema.org/Course" '
            'itemid="/courses/nuevo"><p>Enrollment is closed.</p></section>'
        )
        self.assertEqual(self.evaluar(self.observar())["estado"], "no-disponible-publicamente")
        self.extra = (
            '<section itemscope itemtype="https://schema.org/Product" '
            'itemid="#certificate"><h2>Optional certificate</h2><p>Price: 49 '
            "euros.</p></section><p>Course price: 0 euros.</p>"
        )
        self.assertEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")

    def test_campos_sin_parrafo_y_cta_comercial_no_quedan_ocultos(self) -> None:
        """Contrasta etiquetas de div/span/dl y controles de compra, no solo prosa p."""
        for html in (
            "<div>Course price: 49 euros.</div>",
            "<span>Enrollment is closed.</span>",
            "<dl><dt>Price</dt><dd>49 euros</dd></dl>",
            "<h2>Enrollment status</h2><div>Closed</div>",
            '<a href="/checkout">Buy the course for 49 euros</a>',
        ):
            with self.subTest(html=html):
                self.extra = html
                self.assertNotEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")
        self.extra = "<h2>Optional certificate</h2><h3>Price</h3><div>49 euros</div>"
        self.assertEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")

    def test_course_free_identificado_no_tapa_precio_individual_contrario(self) -> None:
        """La metadata Free del corpus sirve de apoyo, sin prevalecer sobre condición propia contraria."""
        metadata = '<script type="application/ld+json">{"@type":"Course","url":"https://academy.claude.com/courses/nuevo","isAccessibleForFree":true,"offers":[{"@type":"Offer","category":"Free"}]}</script>'
        self.extra = metadata
        self.assertEqual(self.evaluar(self.observar())["estado"], "disponible-publicamente")
        self.extra += "<p>Course price: 49 euros.</p>"
        self.assertEqual(self.evaluar(self.observar())["estado"], "sin-confirmar")

    def test_conocido_ausente_de_indice_no_se_cierra_ni_se_declara_oferta(self) -> None:
        """No confunde un índice parcial con declaración aplicable o retirada."""
        observacion = self.observar(id="claude-academy:anterior")
        criterios = observacion["detalle"][oferta_continua.CAMPO]["criterios"]
        self.assertIsNone(criterios["formacion_gratuita"]["valor"])
        self.assertIsNone(criterios["curso_completo"]["valor"])

    def test_revision_pendiente_no_rejuvenece_ni_retira_por_compilar(self) -> None:
        """Pasar la revisión interna no cambia capturas, comprobación ni estado."""
        observacion = self.observar()
        antes = self.evaluar(observacion)
        despues = self.evaluar(observacion, antes["revisar_el"])
        self.assertEqual(despues["estado"], antes["estado"])
        self.assertEqual(despues["comprobado_el"], antes["comprobado_el"])
        self.assertEqual(despues["revisar_el"], antes["revisar_el"])


if __name__ == "__main__":
    unittest.main()
