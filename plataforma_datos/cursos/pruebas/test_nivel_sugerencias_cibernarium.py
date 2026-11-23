"""La categoría y los destinatarios son señales independientes del título."""

import unittest

from plataforma_datos.cursos.nivel_sugerencias_cibernarium import sugerir


class NivelCibernarium(unittest.TestCase):
    """Evita inferir nivel por duración o por expresiones genéricas."""

    def test_senales_explicitas(self) -> None:
        """Solo categorías y descripciones reconocidas generan orientación."""
        self.assertEqual(sugerir({"category": "Formació tecnològica bàsica"})["valor"], "inicial")
        self.assertEqual(sugerir({"category": "Formació tecnològica avançada - IT Academy"})["valor"], "avanzado")
        self.assertEqual(sugerir({"description": "Adreçat a persones principiants"})["valor"], "inicial")
        self.assertIsNone(sugerir({"description": "Utiliza herramientas avanzadas", "duration": 2}))

    def test_acciones_y_requisitos_orientan_sin_inventar_nivel(self) -> None:
        """Se atiende a evidencia explícita, no a categoría especializada ni verbos genéricos."""
        casos = (
            ("Descobreix els conceptes bàsics i crearàs fluxos senzills.", "inicial"),
            ("Edita sense complicacions i sense coneixements tècnics.", "inicial"),
            ("Ja tens un projecte funcionant amb WordPress i vols aprofundir.", "intermedio"),
            ("Aprèn a automatitzar tasques i a crear scripts.", "intermedio"),
            ("Aprèn a analitzar l'audiència i personalitzar els teus informes.", "intermedio"),
            ("Certificació Microsoft Access Expert per acreditar competències avançades.", "avanzado"),
            ("Una nova funció. Practicarem i editarem vídeos en directe.", "inicial"),
            ("Investigació de paraules clau, optimització i monitoratge.", "intermedio"),
            ("Una interfície amb navegació i gestió de l'estat multiplataforma.", "intermedio"),
            ("Transformar una aplicació Android existent en una experiència XR.", "intermedio"),
            ("Màquina virtual, contenidors, Kubernetes i serverless.", "avanzado"),
        )
        for descripcion, nivel in casos:
            with self.subTest(descripcion=descripcion):
                dato = sugerir({"category": "Formació tecnològica especialitzada", "description": descripcion})
                self.assertIsNotNone(dato)
                self.assertEqual(dato["valor"], nivel)
                self.assertEqual(dato["regla"], "nivel-cibernarium-v3")
        for descripcion in (
            "Aprendràs a crear contingut per comunicar projectes.",
            "No aprendràs a automatitzar tasques ni a crear scripts.",
            "No anticipa, detecta ni mitiga atacs en ciberseguretat.",
            "No revisa màquina virtual, contenidors, Kubernetes i serverless.",
            "Descobreix els conceptes bàsics i crearàs fluxos senzills. Nivell avançat.",
            "Formació tecnològica especialitzada.",
        ):
            with self.subTest(descripcion=descripcion):
                self.assertIsNone(
                    sugerir({"category": "Formació tecnològica especialitzada", "description": descripcion})
                )

    def test_sin_previos_con_negaciones_y_conflictos(self) -> None:
        """Una frase negativa no se usa cuando se niega o contradice."""
        for texto in (
            "Formació introductòria. No es requereixen coneixements previs.",
            "Formació introductòria. No calen coneixements previs.",
        ):
            self.assertEqual(sugerir({"description": texto})["valor"], "inicial")
        for texto in (
            "No és cert que no es requereixen coneixements previs.",
            "No calen coneixements previs. Requereix coneixements bàsics d'Excel.",
            "No calen coneixements previs. Nivell avançat.",
        ):
            self.assertIsNone(sugerir({"description": texto}))
