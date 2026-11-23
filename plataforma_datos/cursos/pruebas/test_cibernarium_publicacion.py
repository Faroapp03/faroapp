"""La publicación respeta matrícula acreditada sin inventar apertura del aula."""

import unittest
from copy import deepcopy

from plataforma_datos.cursos import seleccion_entrega_catalogo as seleccion
from plataforma_datos.cursos.pruebas import test_cibernarium_matricula_actual as fixtures


class PublicacionCibernarium(unittest.TestCase):
    """El soporte público usa la misma observación y política que el evaluador."""

    def setUp(self) -> None:
        """Prepara cuerpos sintéticos y ejecuta el constructor vigente."""
        self.caso = fixtures.MatriculaCibernarium()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)

    def evaluacion(self) -> dict:
        """Conserva el resultado del evaluador, sin reescribir su estado.

        Returns:
            Entrada y resultado que consume la selección pública.
        """
        return {
            "entradas": {"oferta": self.caso.oferta, "observaciones": [self.caso.obs], "politica": self.caso.politica},
            "corte_utc": fixtures.AHORA,
            "resultado": self.caso.evaluar(),
        }

    def test_matricula_presencial_actual_sin_plazo_de_inscripcion_inventado(self) -> None:
        """El calendario de clase propio y DISP0 corroborado soportan una solicitud."""
        registro = self.evaluacion()
        self.assertEqual(registro["resultado"]["estado"], "disponible-publicamente")
        self.assertIsNone(seleccion.comprobar_soporte(registro))
        self.assertIsNone(self.caso.obs["detalle"]["acceso_abierto"])

    def test_matricula_actual_antes_de_la_apertura_del_aula(self) -> None:
        """No se atribuye acceso al Campus por poder solicitar matrícula."""
        actividad = fixtures.actividad()
        actividad["formationType"] = "ONLINE"
        actividad["listEditions"][0].update(
            listSessions=[],
            sessionsOnline={"startDate": "Sun Oct 25 10:00:00 CET 2026", "endDate": "Thu Dec 31 23:59:00 CET 2026"},
        )
        self.caso.oferta, self.caso.obs = self.caso.construir(actividad)
        self.assertIsNone(seleccion.comprobar_soporte(self.evaluacion()))
        self.assertIsNone(self.caso.obs["detalle"]["acceso_abierto"])

    def test_otra_identidad_no_se_acepta_por_el_estado_guardado(self) -> None:
        """Una decisión positiva no convalida un apoyo de otra edición."""
        registro = deepcopy(self.evaluacion())
        registro["entradas"]["observaciones"][0]["detalle"][fixtures.matricula_actual.CAMPO]["edicion_id"] = "999"
        self.assertIsNotNone(seleccion.comprobar_soporte(registro))

    def test_politica_sin_registro_no_acredita_publicacion(self) -> None:
        """Una etiqueta compatible de disponibilidad no reemplaza la política registrada."""
        registro = deepcopy(self.evaluacion())
        registro["entradas"]["politica"]["version"] = "no-registrada"
        self.assertIsNotNone(seleccion.comprobar_soporte(registro))
