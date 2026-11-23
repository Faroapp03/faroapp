"""Pruebas del lector del Idescat: lectura literal de sus archivos y nombre CNO-11 por la correspondencia oficial."""

import unittest
from typing import Any

import plataforma_datos.comun.fuentes.idescat.lector as idescat
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado

# Como los publica el Idescat con f=ssv: marca BOM (U+FEFF, escrita como escape para que se vea y ningún editor la
# quite), tres líneas de cabecera, columnas y un `;` al final de cada fila.
BOM = "\ufeff"
CIUO = (
    f"{BOM}CIUO-2008 (ca) Classificació internacional uniforme d'ocupacions 2008\n"
    "Institut d'Estadística de Catalunya\n"
    "https://www.idescat.cat/metodes/classificacions/ciuo-2008-ca\n"
    "Nivell;Codi;Descripció;\n"
    "Grans grups;9;Ocupacions elementals;\n"
    'Subgrups;912;"Netejadors de vehicles, finestres i afins; bugaders i planxadors manuals";\n'
    "\n"
)
CORRESPONDENCIA = (
    f"{BOM}Correspondència amb CNO-2011 (es). 4 dígits\nInstitut d'Estadística de Catalunya\nhttps://www.idescat.cat\n"
    "CCO-2011 (ca);CNO-2011 (es);Particions;\n"
    "5993;5993;;\n"
    "2598;2599;2;\n"
    "2593;2599;2;\n"
)
CCO = {
    "2": {"nivel": "Grans grups", "titulo": "Tècnics i professionals científics i intel·lectuals"},
    "5993": {"nivel": "Grups primaris", "titulo": "Treballadors dels serveis personals"},
    "2593": {"nivel": "Grups primaris", "titulo": "Professionals de la cultura"},
    "2598": {"nivel": "Grups primaris", "titulo": "Altres professionals de la cultura"},
}


class PruebaLectura(unittest.TestCase):
    """Los textos se leen literales: con su `;` interior entre comillas y sin la cabecera ni filas vacías."""

    def test_rubricas_literales(self) -> None:
        """El `;` entre comillas forma parte del nombre; la marca BOM y las filas vacías no cuentan."""
        rubricas = idescat.rubricas(CIUO, idescat.CIUO)
        self.assertEqual(list(rubricas), ["9", "912"])
        titulo = "Netejadors de vehicles, finestres i afins; bugaders i planxadors manuals"
        self.assertEqual(rubricas["912"]["titulo"], titulo)
        self.assertEqual(rubricas["9"]["nivel"], "Grans grups")

    def test_con_y_sin_marca_bom_se_lee_igual(self) -> None:
        """La marca BOM es opcional: el mismo archivo sin ella da las mismas rúbricas y la misma correspondencia."""
        self.assertTrue(CIUO.startswith(BOM))
        self.assertEqual(idescat.rubricas(CIUO.removeprefix(BOM), "sin-bom"), idescat.rubricas(CIUO, "con-bom"))
        sin_bom = CORRESPONDENCIA.removeprefix(BOM)
        self.assertEqual(
            idescat.correspondencia(sin_bom, "sin-bom"), idescat.correspondencia(CORRESPONDENCIA, "con-bom")
        )

    def test_correspondencia_por_codigo_cno(self) -> None:
        """Cada código CNO-11 con sus códigos CCO-2011, en orden."""
        self.assertEqual(
            idescat.correspondencia(CORRESPONDENCIA, idescat.CORRESPONDENCIA),
            {"2599": ["2593", "2598"], "5993": ["5993"]},
        )

    def test_original_con_otra_forma(self) -> None:
        """Sin fila de columnas, sin una columna o con una fila corta: FormatoInesperado con el nombre del archivo."""
        cabecera = "".join(CIUO.splitlines(keepends=True)[:3])
        for texto, motivo in [
            (cabecera, "nombres de las columnas"),
            (CIUO.replace("Descripció;", "Descripcio;"), "Descripció"),
            (CIUO.replace("Grans grups;9;Ocupacions elementals;", "Grans grups;9"), "2 campos"),
        ]:
            with self.subTest(motivo=motivo), self.assertRaisesRegex(FormatoInesperado, f"{idescat.CIUO}.*{motivo}"):
                idescat.rubricas(texto, idescat.CIUO)

    def test_columnas_duplicadas_no_ocultan_el_nombre(self) -> None:
        """Una segunda Descripció no puede reemplazar en silencio la primera columna oficial."""
        texto = CIUO.replace("Descripció;", "Descripció;Descripció;")
        texto = texto.replace("Ocupacions elementals;", "Ocupacions elementals;Otro;")
        texto = texto.replace('planxadors manuals";', 'planxadors manuals";Otro;')
        with self.assertRaisesRegex(FormatoInesperado, "columnas repetidas"):
            idescat.rubricas(texto, idescat.CIUO)

    def test_rubrica_duplicada_no_se_sobrescribe(self) -> None:
        """Una segunda fila del mismo código no desaparece al formar el diccionario."""
        with self.assertRaisesRegex(FormatoInesperado, "código repetido.*9"):
            idescat.rubricas(CIUO + "Grans grups;9;Otro nombre;\n", idescat.CIUO)

    def test_csv_con_comillas_incorrectas_da_error_de_fuente(self) -> None:
        """Las comillas mal cerradas fallan con archivo y motivo, sin csv.Error ni nombre truncado."""
        texto = CIUO + 'Grans grups;8;"Nombre"x;\n'
        with self.assertRaisesRegex(FormatoInesperado, idescat.CIUO):
            idescat.rubricas(texto, idescat.CIUO)


class PruebaNombresCno(unittest.TestCase):
    """El nombre catalán de un grupo CNO-11 es el de su único grupo CCO-2011; los partidos en dos no tienen ninguno."""

    def test_partido_en_dos_sin_nombre(self) -> None:
        """2599 se parte en 2593 y 2598: no se elige uno; 5993 y el gran grupo 2 sí tienen nombre."""
        nombres = idescat.nombres_cno11(CCO, idescat.correspondencia(CORRESPONDENCIA, idescat.CORRESPONDENCIA))
        self.assertEqual(nombres, {"2": CCO["2"]["titulo"], "5993": CCO["5993"]["titulo"]})

    def test_destino_inexistente_sin_error(self) -> None:
        """Un destino que no está en la CCO-2011 no da nombre ni error: el control lo señala y el informe se escribe."""
        pares = {"5993": ["5993"], "1111": ["9999"]}
        self.assertEqual(idescat.nombres_cno11(CCO, pares), {"2": CCO["2"]["titulo"], "5993": CCO["5993"]["titulo"]})
        controles = Controles()
        idescat._controles(controles, {"ciuo08": {}, "cco11": CCO, "cno11_a_cco11": pares}, {}, {})
        self.assertIn("cada código CCO-2011 de la correspondencia existe en la CCO-2011", controles.fallidos)


class PruebaControles(unittest.TestCase):
    """Los controles detienen la fuente si falta un código o aparece una partición desconocida."""

    def _fallidos(self, datos: dict[str, Any], isco: dict[str, str], cno: dict[str, Any]) -> list[str]:
        """Ejecuta los controles de la fuente con estos datos y estas clasificaciones.

        Args:
            datos: conjunto de la fuente (ciuo08, cco11 y cno11_a_cco11).
            isco: títulos ISCO-08 del paquete, por código.
            cno: grupos CNO-11 del paquete, por código.

        Returns:
            Texto de cada control que no pasa.
        """
        controles = Controles()
        idescat._controles(controles, datos, isco, cno)
        return controles.fallidos

    def test_codigo_isco_que_falta(self) -> None:
        """Una CIUO-2008 (ca) sin un código ISCO-08 del paquete no se admite."""
        datos = {"ciuo08": {"9": {"titulo": "Ocupacions elementals"}}, "cco11": {}, "cno11_a_cco11": {}}
        fallidos = self._fallidos(datos, {"9": "Ocupaciones elementales", "91": "Limpiadores"}, {})
        self.assertTrue(any("CIUO-2008" in descripcion for descripcion in fallidos))

    def test_particion_desconocida(self) -> None:
        """Una partición que no es de las conocidas de la fuente no se admite."""
        datos = {"ciuo08": {}, "cco11": CCO, "cno11_a_cco11": {"5993": ["2593", "5993"]}}
        fallidos = self._fallidos(datos, {}, {"2": {}, "5993": {}})
        self.assertTrue(any("se parten en dos" in descripcion for descripcion in fallidos))


if __name__ == "__main__":
    unittest.main()
