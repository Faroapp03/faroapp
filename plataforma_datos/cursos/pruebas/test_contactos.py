"""Regresiones de contacto defectuoso, sin ampliar la política de NIF ni de buzones."""

import unittest

import plataforma_datos.cursos.fuentes.consorci.contactos as contactos


class PruebaContactosDefectuosos(unittest.TestCase):
    """Los patrones comprueban el campo entero y conservan su alfabeto declarado."""

    def test_un_buzon_numerico_no_es_el_nombre_del_dominio(self) -> None:
        """Dos nombres sin letras no demuestran que sea el buzón de una entidad."""
        for correo in ("123@456.com", "---@123.cat", "123@123.cat"):
            with self.subTest(correo=correo):
                self.assertFalse(contactos.es_correo_de_la_entidad(correo))

    def test_correo_con_salto_final_o_letras_fuera_del_patron(self) -> None:
        """La validación directa no acepta un sufijo fuera del correo ni letras ajenas a a-z."""
        for correo in ("info@centre.cat\n", "info@centre.cK", "info@centre.cİ", "info@centre.cı", "info@centre.cſ"):
            with self.subTest(correo=correo):
                self.assertFalse(contactos.es_correo_de_la_entidad(correo))

    def test_fijo_solo_con_nueve_cifras_ascii(self) -> None:
        """Un salto final y las cifras Unicode no son las nueve cifras del patrón."""
        for telefono in ("930000000\n", "9٣٠٠٠٠٠٠٠", "9３０００００００"):
            with self.subTest(telefono=telefono):
                self.assertFalse(contactos.es_telefono_fijo(telefono))
        for telefono in ("800000000", "905000000", "930000000"):
            with self.subTest(telefono=telefono):
                self.assertTrue(contactos.es_telefono_fijo(telefono))
        self.assertFalse(contactos.es_telefono_fijo("34930000000"))

    def test_web_no_admite_las_letras_extra_de_ignorecase(self) -> None:
        """El dominio respeta a-z sin tocar los caracteres de la ruta ni la normalización de texto."""
        for web in ("centre.cK", "centre.cİ", "centre.cı", "centre.cſ"):
            with self.subTest(web=web):
                self.assertIsNone(contactos.web_de_la_entidad(web))
        self.assertEqual(contactos.web_de_la_entidad(" www.centre.cat\n"), "https://www.centre.cat")

    def test_contacto_defectuoso_se_retira_con_su_motivo(self) -> None:
        """El consumidor de privacidad retira el buzón numérico sin inventar otra forma de contacto."""
        publicado = contactos.ContactoPublicado("B00000000", "Entidad", "", "123@456.com", "9٣٠٠٠٠٠٠٠")
        datos, motivos = contactos.contacto(publicado, "https://fuente.example/contacto")
        self.assertIsNone(datos["correo"])
        self.assertIsNone(datos["telefono"])
        self.assertTrue(motivos["correos_que_pueden_ser_de_una_persona"])
        self.assertTrue(motivos["telefonos_moviles"])

    def test_alfabeto_ascii_no_excluye_espacios_unicode(self) -> None:
        """Los espacios Unicode siguen sin ser caracteres de un correo ni de una ruta web."""
        self.assertFalse(contactos.es_correo_de_la_entidad("info@centre.cat\u00a0"))
        self.assertIsNone(contactos.web_de_la_entidad("centre.cat/una\u00a0ruta"))


if __name__ == "__main__":
    unittest.main()
