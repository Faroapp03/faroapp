"""Auditoría privada de candidatas FUNDAE. Ninguna prueba requiere conectarse a la fuente."""

import unittest

from plataforma_datos.cursos.fuentes.fundae import auditoria_preinscripcion as auditoria
from plataforma_datos.cursos.pruebas.test_fundae import fila


class CruceDeEdicion(unittest.TestCase):
    """La especialidad y los contactos por sí solos no identifican un trámite de solicitud."""

    def test_contrastar_la_misma_difusion_sin_exportar_contactos(self) -> None:
        """El cruce deja posición y calendario sin exponer datos de contacto."""
        registrada = fila() | {"idCentro": 12, "idAccionFormativa": 15}
        encontrado = auditoria.contrastar_difusion("3177", [registrada], [registrada])
        self.assertEqual(encontrado["plazo"], {"inicio": "2026-09-01", "fin": "2026-10-31"})
        self.assertTrue(encontrado["hay_contacto_publicado"])
        self.assertFalse(encontrado["campos_de_tramite_por_revisar"])
        self.assertNotIn("B00000000", str(encontrado))
        self.assertNotIn("@", str(encontrado))

    def test_una_fila_duplicada_o_un_centro_con_otro_plazo_no_acreditan_la_edicion(self) -> None:
        """Cada ID debe tener una única fila con el mismo centro y las mismas fechas."""
        fila_a = fila() | {"idCentro": 12, "idAccionFormativa": 15}
        for centro in (
            [],
            [fila_a, fila_a],
            [fila_a | {"idCentro": 99}],
            [fila_a | {"fechaPreinscripcionFin": "2026-10-29T00:00:00"}],
        ):
            with self.subTest(centro=centro), self.assertRaises(auditoria.EvidenciaIncompleta):
                auditoria.contrastar_difusion("3177", [fila_a], centro)

    def test_un_campo_nuevo_pide_revisar_el_tramite_sin_exponer_su_valor(self) -> None:
        """Una condición desconocida de inscripción impide una selección automática."""
        registrada = fila() | {"idCentro": 12, "idAccionFormativa": 15, "urlSolicitud": "correo@ejemplo.es"}
        resultado = auditoria.contrastar_difusion("3177", [registrada], [registrada])
        self.assertEqual(resultado["campos_de_tramite_por_revisar"], ["urlSolicitud"])
        self.assertNotIn("correo@ejemplo.es", str(resultado))

    def test_la_gratuidad_de_otro_catalogo_no_cuenta(self) -> None:
        """Distingue la declaración general de otra categoría y de textos contradictorios."""
        declaracion = {"idCatalogo": 3, "descripcionCatalogo": "Oferta", "descripcionCard": auditoria.GRATUIDAD}
        self.assertTrue(auditoria.formacion_gratuita([declaracion]))
        self.assertFalse(auditoria.formacion_gratuita([declaracion | {"idCatalogo": 1}]))
        self.assertFalse(
            auditoria.formacion_gratuita(
                [declaracion | {"descripcionCard": auditoria.GRATUIDAD + ", excepto esta edición de pago."}]
            )
        )
        self.assertFalse(
            auditoria.formacion_gratuita([declaracion | {"descripcionCard": "Ya no es cierto. " + auditoria.GRATUIDAD}])
        )
        self.assertFalse(auditoria.formacion_gratuita([declaracion | {"descripcionCard": "Becas disponibles."}]))

    def test_la_gratuidad_sigue_al_significado_con_otra_presentacion(self) -> None:
        """Admite un preámbulo corregido y la frase de gratuidad aislada o con el fin de la formación."""
        cabecera = {"idCatalogo": 3, "descripcionCatalogo": "Oferta"}
        frase = auditoria.GRATUIDAD.replace("100%", "100 %")
        for entidad in ("Funde", "Fundae"):
            for pausa in (", diseñados", ". Diseñados"):
                texto = (
                    f"Formación gestionada por {entidad}. {frase}{pausa} para mejorar la empleabilidad "
                    "de las personas trabajadoras en toda España."
                )
                self.assertTrue(auditoria.formacion_gratuita([cabecera | {"descripcionCard": texto}]))
        for condicion in (
            "Algunos cursos se facturan al alumno.",
            "La matrícula cuesta 35 euros.",
            "Hay una excepción.",
        ):
            for texto in (condicion + " " + frase, frase + ". " + condicion):
                self.assertFalse(auditoria.formacion_gratuita([cabecera | {"descripcionCard": texto}]))
