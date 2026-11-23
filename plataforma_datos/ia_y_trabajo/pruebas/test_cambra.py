"""Cálculos de la Cambra contra el paquete canónico y rechazo de entradas dañadas."""

import unittest
from pathlib import Path
from unittest.mock import patch

import plataforma_datos.ia_y_trabajo.fuentes.cambra.lector as cambra
from plataforma_datos.comun.nucleo import (
    RAIZ,
    Controles,
    FormatoInesperado,
)
from plataforma_datos.ia_y_trabajo.fuentes.cambra import tabla_privada


class PruebaCambra(unittest.TestCase):
    """Las cifras del paquete canónico reproducen los cálculos publicados del estudio."""

    @classmethod
    def setUpClass(cls) -> None:
        """Reconstruye solo los campos de cálculo presentes en el paquete admitido.

        La tabla no está en el repositorio: sin ella, o con otra huella, el fallo dice qué falta y cómo obtenerla.
        """
        cls.conjunto = tabla_privada.leer(RAIZ)
        cls.filas = [
            {
                "cno11": codigo,
                "puntuacion_media": fila["puntuacion"],
                "nivel_media": fila["nivel"],
                "mujeres": fila["mujeres"],
                "hombres": fila["hombres"],
                "total": fila["mujeres"] + fila["hombres"],
                "ocupacion_ca": cls.conjunto["ocupados_cno3"].get(codigo, {}).get("ocupacion_ca", ""),
            }
            for codigo, fila in cls.conjunto["ocupaciones_cno3"].items()
        ]

    def test_reproduce_el_reparto_publicado_por_sexo(self) -> None:
        """No expuestas 23/34, media o alta 30/23 y alta 21/11 (% de las mujeres / % de los hombres), sin redondeos."""
        reparto = cambra.reparto_por_sexo(self.filas)
        self.assertEqual(
            {cifra: (valor["mujeres"], valor["hombres"]) for cifra, valor in reparto.items()},
            {"no_expuestas": (23, 34), "media_o_alta": (30, 23), "alta": (21, 11)},
        )

    def test_reproduce_la_taula4(self) -> None:
        """Las 25 ocupaciones de la Taula 4 suman su total publicado y cada fila da sus cifras (primera y última)."""
        seleccion = cambra.taula4(self.filas)
        self.assertEqual(len(seleccion), 25)
        self.assertEqual(sum(fila["ocupados"] for fila in seleccion), 697526)
        publicadas = [
            (fila["cno11"], fila["ocupados"], fila["pct_ocupacion_total"], fila["pct_mujeres"]) for fila in seleccion
        ]
        self.assertEqual(publicadas[0], ("430", 123001, 4.0, 72.3))
        self.assertEqual(publicadas[-1], ("443", 689, 0.0, 66.5))

    def test_una_ocupacion_de_la_taula4_que_falta_es_un_control_fallido(self) -> None:
        """Sin una de las 25, el control de los totales falla y dice cuál falta (sin KeyError)."""
        sin_una = [fila for fila in self.filas if fila["cno11"] != "430"]
        controles = Controles()
        cambra._comprobar_publicadas(controles, sin_una)
        self.assertTrue(any("faltan en la tabla: ['430']" in fallido for fallido in controles.fallidos))

    def test_la_variacion_exportada_es_la_comprobada(self) -> None:
        """El conjunto lleva VARIACION_TOTAL, la que usan los controles de la Taula 13."""
        conjunto = cambra._conjunto_validado(self.filas, cambra._taula13())
        self.assertEqual(conjunto["variacion_contratacion_total"], cambra.VARIACION_TOTAL)
        self.assertEqual(conjunto, self.conjunto)

    def test_cobertura_y_total_publicado(self) -> None:
        """El paquete contiene 163 ocupaciones distintas y 3.102.146 personas ocupadas."""
        self.assertEqual(len({fila["cno11"] for fila in self.filas}), 163)
        self.assertEqual(sum(fila["total"] for fila in self.filas), 3102146)

    def test_niveles_por_cortes_de_la_escala(self) -> None:
        """Cada corte abre su nivel (0,2 ya es nivel 2; 0,5, nivel 5) y el nivel de cada fila es el de su puntuación."""
        self.assertEqual(
            [cambra.nivel_de(valor) for valor in (0.1, 0.1999, 0.2, 0.39, 0.4, 0.5, 0.7)], [1, 1, 2, 3, 4, 5, 5]
        )
        self.assertTrue(all(fila["nivel_media"] == cambra.nivel_de(fila["puntuacion_media"]) for fila in self.filas))

    def test_titulo_sin_codigo_del_estudio(self) -> None:
        """Una fila cuyo título no empieza por el código del estudio no se prepara."""
        fila = dict.fromkeys(cambra.COLUMNAS, 1.0)
        fila.update(cno11_3d="960", titulo_censo_2022="Peons construcció i mineria")
        with self.assertRaises(FormatoInesperado):
            cambra._fila_preparada(fila, 2)

    def test_taula13_codigos_unicos(self) -> None:
        """Ningún código de la Taula 13 se transcribió dos veces."""
        self.assertEqual(len({fila[0] for fila in cambra.TAULA13}), len(cambra.TAULA13))


class PruebaPiezasDeLaCambra(unittest.TestCase):
    """Detalles de la tabla: cortes en texto, filas con nombre y título sin código."""

    def test_los_cortes_del_control_salen_de_la_escala(self) -> None:
        """El texto del control de niveles escribe los cortes de CORTES_NIVEL con coma decimal."""
        self.assertEqual(cambra._cortes_en_texto(), "0,2; 0,3; 0,4 y 0,5")

    def test_los_totales_y_la_taula_13_se_leen_por_nombre(self) -> None:
        """TOTAL4 y las filas de la Taula 13 son tuplas con nombre."""
        self.assertEqual(cambra.TOTAL4.ocupados, 697526)
        self.assertEqual(cambra.TAULA13[0].cno11, "4423")
        self.assertEqual(cambra._taula13()[0]["contratos_2023"], cambra.TAULA13[0].contratos_2023)

    def test_un_titulo_sin_codigo_del_estudio_es_un_error_con_motivo(self) -> None:
        """La fila sin «[código]» al principio del título dice su número de fila."""
        fila = dict.fromkeys(cambra.COLUMNAS, 1)
        fila["titulo_censo_2022"] = "Sin código"
        fila["cno11_3d"] = "430"
        with self.assertRaisesRegex(cambra.FormatoInesperado, "fila 7: el título no empieza por el código"):
            cambra._fila_preparada(fila, 7)


class PruebaEntradasDanadas(unittest.TestCase):
    """El original da errores con contexto si una celda o una fila no tiene el formato contratado."""

    def test_celda_no_numerica_identifica_campo_y_fila(self) -> None:
        """Texto o una celda ausente dan el motivo de la conversión fallida."""
        for valor in ("sin cifra", None):
            with self.subTest(valor=valor):
                fila = dict.fromkeys(cambra.COLUMNAS, 1)
                fila.update(n_4digit=valor, titulo_censo_2022="[C430] Título", cno11_3d="430")
                with self.assertRaisesRegex(
                    FormatoInesperado, "fila 7: ocupaciones_isco_4_cifras no es un número entero"
                ):
                    cambra._fila_preparada(fila, 7)

    def test_fila_corta_identifica_la_fila(self) -> None:
        """Una fila incompleta identifica su número, en lugar de fallar con KeyError."""
        with (
            patch.object(cambra, "leer_xls", return_value={"Hoja": [list(cambra.COLUMNAS), [1]]}),
            self.assertRaisesRegex(FormatoInesperado, "fila 2:.*columnas"),
        ):
            cambra.leer_tabla(Path("tabla.xls"))

    def test_hoja_vacia_da_un_error_de_formato(self) -> None:
        """Una hoja sin cabecera se rechaza antes de desempaquetar sus filas."""
        with (
            patch.object(cambra, "leer_xls", return_value={"Hoja": []}),
            self.assertRaisesRegex(FormatoInesperado, "hoja.*vacía"),
        ):
            cambra.leer_tabla(Path("tabla.xls"))

    def test_tolerancia_y_diagnostico_de_la_variacion(self) -> None:
        """El mensaje precisa la holgura y el margen mantiene sus resultados en el borde."""
        self.assertEqual(cambra.TOLERANCIA_VARIACION, 0.06)
        fila = {"contratos_2023": 1000, "contratos_2025": 1000}
        for desviacion, esperado in ((0.05, True), (0.055, True), (0.06, True), (0.061, False)):
            with self.subTest(desviacion=desviacion):
                self.assertEqual(cambra._variacion_reproducida({**fila, "variacion_pct": desviacion}), esperado)
        controles = Controles()
        with patch.object(cambra, "codigos_en_cno", return_value=True):
            cambra._comprobar_taula13(controles, [], {})
        self.assertEqual(
            controles.lista[1]["control"],
            "cada variación publicada se reproduce con las personas contratadas (redondeo ±0,05 y holgura numérica)",
        )


if __name__ == "__main__":
    unittest.main()
