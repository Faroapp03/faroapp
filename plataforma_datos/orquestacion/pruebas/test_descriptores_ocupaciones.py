"""Las fichas de Ocupaciones gobiernan su operación y hacen visibles sus errores de contrato."""

import unittest
from dataclasses import replace
from unittest import mock

from plataforma_datos.contratos import fuentes
from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion.pruebas.ayuda_descriptores import comprobar_tema, referencia_congelada


class PruebaDescriptoresOcupaciones(unittest.TestCase):
    """Comprueba cuatro fuentes contra su referencia independiente de las fichas."""

    def test_politicas_cadencias_y_dependencias_conservadas(self) -> None:
        """La referencia es independiente de las fichas y está fijada por su huella."""
        comprobar_tema(self, "ocupaciones", referencia_congelada(self, "operacion-ocupaciones-v1.json"))

    def test_documentacion_generada_es_exacta(self) -> None:
        """El mismo comprobador de instalación valida todas las fichas y README de Ocupaciones."""
        self.assertEqual(fuentes.main(["--tema", "ocupaciones", "--comprobar"]), 0)

    def test_ocupaciones_no_puede_quedar_fuera_de_la_guarda_comun(self) -> None:
        """Una política divergente en Ocupaciones se detecta aunque Cursos sea correcto."""
        cargar = fuentes.cargar_descriptores

        def alterados(*, tema: str = "cursos") -> tuple[fuentes.DescriptorFuente, ...]:
            registros = cargar(tema=tema)
            if tema == "ocupaciones":
                return tuple(
                    replace(d, actualizacion=d.actualizacion._replace(red=True)) if d.id == "esco" else d
                    for d in registros
                )
            return registros

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=alterados):
            self.assertIn("esco: política distinta del descriptor", modulos.comprobar_registro())

    def test_descriptor_ocupaciones_corrupto_no_se_ignora(self) -> None:
        """La ausencia de una ficha de Ocupaciones produce un fallo explícito del registro."""
        cargar = fuentes.cargar_descriptores

        def incompletos(*, tema: str = "cursos") -> tuple[fuentes.DescriptorFuente, ...]:
            if tema == "ocupaciones":
                raise fuentes.ErrorDescriptor("ficha dañada")
            return cargar(tema=tema)

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=incompletos):
            self.assertIn("descriptores de Ocupaciones no válidos: ficha dañada", modulos.comprobar_registro())


if __name__ == "__main__":
    unittest.main()
