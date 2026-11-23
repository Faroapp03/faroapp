"""Las fuentes de IA y trabajo respetan su política, cadencia y dependencias declaradas."""

import unittest
from dataclasses import replace
from unittest import mock

from plataforma_datos.contratos import fuentes
from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion.pruebas.ayuda_descriptores import comprobar_tema, referencia_congelada


class PruebaDescriptoresIATrabajo(unittest.TestCase):
    """Comprueba todas las fuentes del tema contra su referencia operativa independiente."""

    def test_politicas_cadencias_y_dependencias_conservadas(self) -> None:
        """La referencia fija políticas y relaciones; la igualdad impide omitir fuentes nuevas."""
        referencia = referencia_congelada(self, "operacion-ia-trabajo-v1.json")
        comprobar_tema(self, "ia_y_trabajo", referencia, solo_operativas=True)

    def test_documentacion_generada_es_exacta(self) -> None:
        """El mismo comprobador de instalación valida todas las fichas y README de IA y trabajo."""
        self.assertEqual(fuentes.main(["--tema", "ia_y_trabajo", "--comprobar"]), 0)

    def test_ia_trabajo_no_puede_quedar_fuera_de_la_guarda_comun(self) -> None:
        """Una política divergente en IA y trabajo se detecta aunque Cursos sea correcto."""
        cargar = fuentes.cargar_descriptores

        def alterados(*, tema: str = "cursos") -> tuple[fuentes.DescriptorFuente, ...]:
            registros = cargar(tema=tema)
            if tema == "ia_y_trabajo":
                return tuple(
                    replace(d, actualizacion=d.actualizacion._replace(red=True)) if d.id == "cambra" else d
                    for d in registros
                )
            return registros

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=alterados):
            self.assertIn("cambra: política distinta del descriptor", modulos.comprobar_registro())

    def test_descriptor_ia_trabajo_corrupto_no_se_ignora(self) -> None:
        """La ausencia de una ficha de IA y trabajo produce un fallo explícito del registro."""
        cargar = fuentes.cargar_descriptores

        def incompletos(*, tema: str = "cursos") -> tuple[fuentes.DescriptorFuente, ...]:
            if tema == "ia_y_trabajo":
                raise fuentes.ErrorDescriptor("ficha dañada")
            return cargar(tema=tema)

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=incompletos):
            self.assertIn("descriptores de IA y trabajo no válidos: ficha dañada", modulos.comprobar_registro())


if __name__ == "__main__":
    unittest.main()
