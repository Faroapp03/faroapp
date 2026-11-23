"""Pruebas focales de la medida nacional del Reino Unido (ONS/BICS)."""

import csv
import io
import unittest

import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector as ia_nacional_gbr
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado

CSV = """"Notes","1. AI use is based on businesses reporting use of at least one artificial intelligence technology.
2. Results include businesses with 10 or more employees.
"
"Unit","Percentage share (%)"
"Date","Percentage of businesses reporting AI use"
"16 March 2026 <br>to 29 March 2026","32.1"
"15 June 2026 <br>to 28 June 2026","34.9"
"""


class Lectura(unittest.TestCase):
    """La cifra y sus referencias conservan la definición de ONS/BICS."""

    def test_reino_unido(self) -> None:
        """El último período, con sus fechas y las dos notas literales."""
        cifra = ia_nacional_gbr.cifra_de_la_figura(CSV)
        self.assertEqual(
            (cifra["valor"], cifra["anio"], cifra["referencia"]), (34.9, 2026, ["2026-06-15", "2026-06-28"])
        )
        self.assertEqual(cifra["notas"], [ia_nacional_gbr.NOTA_DEL_INDICADOR, ia_nacional_gbr.NOTA_DEL_UNIVERSO])
        with self.assertRaises(FormatoInesperado):
            ia_nacional_gbr.cifra_de_la_figura(CSV.replace("Date", "Fecha"))

    def test_metadatos_obligatorios_unicos_y_con_dos_columnas(self) -> None:
        """El CSV no puede ocultar otro universo o unidad detrás de la primera coincidencia."""
        for campo in ("Notes", "Unit"):
            for variante in ("ausente", "corta", "duplicada", "ancha"):
                with self.subTest(campo=campo, variante=variante):
                    filas = list(csv.reader(io.StringIO(CSV)))
                    indice = next(i for i, fila in enumerate(filas) if fila[0] == campo)
                    fila = filas[indice]
                    if variante == "ausente":
                        del filas[indice]
                    elif variante == "corta":
                        filas[indice] = [campo]
                    elif variante == "duplicada":
                        filas.insert(indice + 1, [campo, "otra base"])
                    else:
                        filas[indice] = [*fila, "otra columna"]
                    salida = io.StringIO()
                    csv.writer(salida).writerows(filas)
                    with self.assertRaisesRegex(FormatoInesperado, campo):
                        ia_nacional_gbr.cifra_de_la_figura(salida.getvalue())

    def test_periodo_duplicado_no_elige_por_cifra(self) -> None:
        """Dos cifras del mismo intervalo son ambiguas, incluso si coinciden."""
        for valor in ("34.9", "39.9"):
            with self.subTest(valor=valor):
                texto = CSV + f'"15 June 2026 <br>to 28 June 2026","{valor}"\n'
                with self.assertRaisesRegex(FormatoInesperado, "período.*repetido"):
                    ia_nacional_gbr.cifra_de_la_figura(texto)

    def test_fecha_imposible_del_csv_con_archivo_y_campo(self) -> None:
        """Las fechas imposibles se explican como formato de la fuente, no ValueError."""
        with self.assertRaisesRegex(FormatoInesperado, "ons-bics-ia-figura-1.csv.*Date"):
            ia_nacional_gbr.cifra_de_la_figura(CSV.replace("15 June", "31 June"))

    def test_periodo_invertido_historico_no_se_oculta_con_el_ultimo(self) -> None:
        """La serie completa debe tener intervalos válidos, también fuera de la cifra elegida."""
        with self.assertRaisesRegex(FormatoInesperado, "ons-bics-ia-figura-1.csv.*Date.*orden"):
            ia_nacional_gbr.cifra_de_la_figura(CSV.replace("16 March 2026", "30 March 2026"))

    def test_referencia_del_preparado_invalida_no_se_admite_ni_rompe(self) -> None:
        """Forma, calendario y orden del intervalo son parte del control histórico."""
        cifra = ia_nacional_gbr.cifra_de_la_figura(CSV)
        for referencia in (
            None,
            [],
            ["2026-06-15"],
            ["2026-06-15", "2026-06-28", "2026-07-01"],
            "2026-06-15",
            [None, "2026-06-28"],
            ["2026-02-30", "2026-06-28"],
            ["2026-06-15", "2026-06-31"],
            ["20260615", "2026-06-28"],
            ["2026-06-29", "2026-06-28"],
        ):
            with self.subTest(referencia=referencia):
                controles = Controles()
                ia_nacional_gbr._propios(controles, {**cifra, "referencia": referencia}, {})
                self.assertFalse(controles.admitido)
                self.assertIn("cifras.json", " ".join(controles.fallidos))
                self.assertIn("referencia", " ".join(controles.fallidos))

    def test_referencia_valida_conserva_el_control_nominal(self) -> None:
        """La admisión actual conserva el texto y el orden del informe."""
        controles = Controles()
        ia_nacional_gbr._propios(controles, ia_nacional_gbr.cifra_de_la_figura(CSV), {})
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertEqual(controles.lista[2], {"control": "Reino Unido: año del período", "resultado": "correcto"})


if __name__ == "__main__":
    unittest.main()
