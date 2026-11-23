"""Una foto del paquete de Python comprueba su catálogo antes de cada caso y, si es otro, dice cómo regenerarla."""

import unittest

from plataforma_datos.comun.pruebas import foto_del_paquete as foto

AJENA = "0" * 64
REGENERAR = "la orden de la foto"


class PaqueteDeLaFoto(unittest.TestCase):
    """La foto vale con su catálogo y se detiene con cualquier otro."""

    def test_con_el_catalogo_del_arbol_no_dice_nada(self) -> None:
        """La huella del árbol es la de su catálogo publicado."""
        foto.exigir_el_paquete_de_la_foto(foto.huella_del_catalogo(), REGENERAR)

    def test_con_otro_catalogo_dice_cual_es_el_suyo_y_como_regenerarla(self) -> None:
        """El mensaje nombra las dos huellas y la orden, no una cifra que no cuadra."""
        with self.assertRaises(AssertionError) as contexto:
            foto.exigir_el_paquete_de_la_foto(AJENA, REGENERAR)
        mensaje = str(contexto.exception)
        self.assertIn(f"foto del paquete con el catálogo {AJENA}", mensaje)
        self.assertIn(f"(catálogo {foto.huella_del_catalogo()})", mensaje)
        self.assertIn(f"regenera la foto: {REGENERAR}", mensaje)

    def test_cada_caso_de_la_clase_marcada_se_detiene_antes_de_prepararse(self) -> None:
        """Con otro catálogo, el caso falla sin llegar a su propia preparación ni a su cuerpo."""
        llamadas: list[str] = []

        class Casos(unittest.TestCase):
            def setUp(self) -> None:
                llamadas.append("preparar")

            def test_cuerpo(self) -> None:
                llamadas.append("cuerpo")

        marcada = foto.foto_del_paquete(catalogo=AJENA, regenerar=REGENERAR)(Casos)
        resultado = unittest.TestResult()
        marcada("test_cuerpo").run(resultado)
        self.assertEqual(llamadas, [])
        self.assertEqual(len(resultado.failures) + len(resultado.errors), 1)

    def test_con_su_catalogo_el_caso_se_prepara_y_se_ejecuta(self) -> None:
        """Con el catálogo del árbol, la marca no cambia nada del caso."""
        llamadas: list[str] = []

        class Casos(unittest.TestCase):
            def setUp(self) -> None:
                llamadas.append("preparar")

            def test_cuerpo(self) -> None:
                llamadas.append("cuerpo")

        marcada = foto.foto_del_paquete(catalogo=foto.huella_del_catalogo(), regenerar=REGENERAR)(Casos)
        resultado = unittest.TestResult()
        marcada("test_cuerpo").run(resultado)
        self.assertEqual(llamadas, ["preparar", "cuerpo"])
        self.assertTrue(resultado.wasSuccessful())


if __name__ == "__main__":
    unittest.main()
