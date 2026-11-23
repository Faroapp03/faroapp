"""Regresiones de inclusión completa entre CNAE-2009 y el ámbito ETICCE de 2026."""

import json
import unittest
from typing import Any

from plataforma_datos.comun.nucleo import RAIZ, FormatoInesperado
from plataforma_datos.mercado.fuentes.empresas.piezas.correspondencia_cnae import agrupaciones_para_cnae09

CONTRATO = RAIZ / "plataforma_datos" / "mercado" / "fuentes" / "empresas" / "contratos" / "empresas-cnae2025.json"


def filas_de_prueba() -> list[dict[str, Any]]:
    """Filas sintéticas por agrupación oficial, con la celda total real de 2026.

    Returns:
        Una fila por agrupación. Los ceros de detalle son propios del banco.
    """
    contrato = json.loads(CONTRATO.read_text(encoding="utf-8"))
    return [
        {
            "parte": "sectores",
            "tamano": "Total",
            "agrupacion": nombre,
            "pregunta": "D.1 % de empresas que emplean tecnologías de Inteligencia Artificial (IA) (1)",
            "valor": 33.6 if nombre == "Total Empresas" else 0.0,
        }
        for nombre in contrato["agrupaciones"]
    ]


def grupo_con_prefijo(resultado: dict[str, dict[str, Any]], prefijo: str) -> dict[str, Any]:
    """El agregado oficial identificado por su prefijo en este banco.

    Returns:
        El único agregado con el prefijo pedido.
    """
    return next(valor for nombre, valor in resultado.items() if nombre.startswith(prefijo))


class CorrespondenciaCNAE(unittest.TestCase):
    """Los códigos iguales y las correspondencias parciales no justifican inclusión."""

    def test_45_no_entra_entera_por_reparaciones_fuera(self) -> None:
        """45.20 pasa a 95.31, fuera del ámbito, aunque sus ventas sí estén dentro."""
        total = agrupaciones_para_cnae09(filas_de_prueba(), {45})["Total Empresas"]
        self.assertEqual(total["divisiones"], [])
        self.assertIn("95.31", total["divisiones_parciales"]["45"]["destinos_2025_fuera"])
        self.assertIn("45.20", total["divisiones_parciales"]["45"]["clases_2009_fuera"])

    def test_951_no_convierte_95_en_division_completa(self) -> None:
        """La reparación de ordenadores no representa todo el antiguo 95."""
        resultado = agrupaciones_para_cnae09(filas_de_prueba(), {95})
        informacion = grupo_con_prefijo(resultado, "3.6.")
        self.assertEqual(informacion["divisiones"], [])
        self.assertIn("95", informacion["divisiones_parciales"])
        self.assertIn("95.21", informacion["divisiones_parciales"]["95"]["clases_2009_fuera"])

    def test_construccion_no_presupone_identidad_por_codigo(self) -> None:
        """Los tres códigos antiguos tienen contenido fuera de Construcción-2025."""
        resultado = agrupaciones_para_cnae09(filas_de_prueba(), {41, 42, 43})
        construccion = grupo_con_prefijo(resultado, "2.")
        self.assertEqual(construccion["divisiones"], [])
        self.assertEqual(set(construccion["divisiones_parciales"]), {"41", "42", "43"})
        self.assertEqual(resultado["Total Empresas"]["divisiones"], [42, 43])

    def test_inclusion_completa_y_grupo_mas_amplio(self) -> None:
        """56 cabe en Hostelería; 79 necesita Servicios y no se prorratea."""
        resultado = agrupaciones_para_cnae09(filas_de_prueba(), {56, 79})
        hosteleria = grupo_con_prefijo(resultado, "3.4.")
        servicios = grupo_con_prefijo(resultado, "3. Total")
        self.assertEqual(hosteleria["divisiones"], [56])
        self.assertIn("56.40", hosteleria["divisiones_parciales"]["79"]["destinos_2025_dentro"])
        self.assertEqual(servicios["divisiones"], [56, 79])
        self.assertEqual(servicios["criterio"], "inclusion_completa_de_contenidos")

    def test_particion_explicita_y_cambio_de_pregunta(self) -> None:
        """Un código fuera del ámbito se excluye y otra pregunta exige revisión."""
        filas = filas_de_prueba()
        total = agrupaciones_para_cnae09(filas, {56, 84, 95})["Total Empresas"]
        self.assertEqual(total["divisiones"], [56])
        self.assertEqual(total["divisiones_excluidas"], [84])
        self.assertEqual(set(total["divisiones_parciales"]), {"95"})
        filas[0]["pregunta"] = "Otra definición de IA"
        with self.assertRaises(FormatoInesperado):
            agrupaciones_para_cnae09(filas, {56})

    def test_conserva_porcentaje_y_error_sin_convertirlos(self) -> None:
        """Los valores se toman de las filas, sin cálculos con la correspondencia."""
        filas = filas_de_prueba()
        nombre = next(f["agrupacion"] for f in filas if f["agrupacion"].startswith("3.4."))
        filas.append({"parte": "errores", "agrupacion": nombre, "valor": 0.72})
        resultado = agrupaciones_para_cnae09(filas, {56})
        self.assertEqual(resultado["Total Empresas"]["pct"], 33.6)
        self.assertEqual(resultado[nombre]["error_estandar_de_referencia"], 0.72)
        self.assertIsNone(resultado["Total Empresas"]["error_estandar_de_referencia"])

    def test_desconocidos_duplicados_y_grupos_ausentes_fallan(self) -> None:
        """Una revisión de agrupaciones no se admite mediante coincidencias parciales."""
        filas = filas_de_prueba()
        casos = [filas[1:], [*filas, filas[0]], [*filas, {**filas[0], "agrupacion": "Nuevo sector"}]]
        for caso in casos:
            with self.subTest(caso=len(caso)), self.assertRaises(FormatoInesperado):
                agrupaciones_para_cnae09(caso, {56})
        with self.assertRaises(FormatoInesperado):
            agrupaciones_para_cnae09(filas, {4})

    def test_contrato_real_con_procedencia_oficial_fijada(self) -> None:
        """El recurso conserva las relaciones y las capturas oficiales revisadas."""
        contrato = json.loads(CONTRATO.read_text(encoding="utf-8"))
        huellas = {f["archivo"]: f["sha256"] for f in contrato["fuentes"]}
        self.assertEqual(
            huellas["Correspondencia_CNAE09_CNAE25.xlsx"],
            "1822004304ab460ea792df8ebbdd53cc45e984de146ca54b2761ae9e598c863d",
        )
        self.assertEqual(
            huellas["sectores-82382.json"],
            "0f90d2851bff3e5d14ebac4064a19f1ab3e557abf6543533f7666e7b373d3536",
        )
        self.assertEqual(len(contrato["clases_2009_a_2025"]), 629)
        self.assertEqual(sum(map(len, contrato["clases_2009_a_2025"].values())), 1033)
        self.assertEqual(contrato["clases_2009_a_2025"]["95.11"], ["95.10"])
        self.assertEqual(contrato["clases_2009_a_2025"]["95.12"], ["95.10"])
        self.assertIn("56.40", contrato["clases_2009_a_2025"]["79.90"])


if __name__ == "__main__":
    unittest.main()
