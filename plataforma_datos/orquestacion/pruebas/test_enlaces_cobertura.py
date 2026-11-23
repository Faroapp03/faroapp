"""Un día normal de la comprobación de enlaces queda acreditado; un día en que falla de verdad, no."""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.orquestacion.pruebas import dia_de_enlaces as dia


class CoberturaDeEnlaces(unittest.TestCase):
    """El seguimiento real, sobre el lector real, registra y publica lo que la evidencia deja acreditar."""

    def produce(self, escenario: str) -> dict:
        """Un día del escenario, hasta el estado del panel, en una instalación temporal.

        Returns:
            El resultado registrado y el estado del panel.
        """
        with tempfile.TemporaryDirectory() as carpeta:
            return dia.producir(Path(carpeta), escenario)

    def fila(self, salida: dict) -> dict:
        """La fila de `enlaces` del seguimiento remoto del panel.

        Returns:
            La fila de la fuente.
        """
        return next(f for f in salida["instantanea"]["seguimientoRemoto"] if f["fuente"] == "enlaces")

    def test_un_dia_con_el_tope_alcanzado_queda_comprobado(self) -> None:
        """Siete de ocho enlaces consultados: el resto espera al ciclo siguiente y la fuente se acredita."""
        salida = self.produce("tope")
        self.assertEqual(salida["registro"], "comprobada")
        fila = self.fila(salida)
        self.assertEqual(fila["ultimoIntento"]["resultado"], "comprobada")
        self.assertEqual(fila["fallosSeguidos"], 0)
        self.assertEqual(fila["incidenciasPendientes"], [])
        self.assertIsNone(fila["consultaParcial"])
        self.assertIsNone(fila["coberturaLimitada"])
        self.assertEqual(fila["salidaParcial"], {"motivos": ["tope-de-consultas"], "descartadas": 0, "aRevisar": 0})
        self.assertEqual(fila["enlaces"], {"comprobados": 7, "ocultos": 0, "sinComprobar": 1})
        conjunto = next(c for c in salida["instantanea"]["comprobaciones"]["conjuntos"] if c["fuente"] == "enlaces")
        self.assertIsNotNone(conjunto["ultimaComprobacion"])

    def test_un_dia_con_un_dominio_frenado_queda_comprobado(self) -> None:
        """Un dominio que pide que se le deje en paz se salta, y el resto del turno se acredita."""
        salida = self.produce("dominio")
        self.assertEqual(salida["registro"], "comprobada")
        fila = self.fila(salida)
        self.assertEqual(fila["salidaParcial"], {"motivos": ["dominio-con-limite"], "descartadas": 0, "aRevisar": 0})
        self.assertEqual(fila["enlaces"]["sinComprobar"], 4)

    def test_un_dia_cortado_por_el_plazo_queda_comprobado(self) -> None:
        """El plazo agotado es otro corte del turno, y solo vale si el ciclo duró el plazo."""
        salida = self.produce("plazo")
        self.assertEqual(salida["registro"], "comprobada")
        self.assertEqual(self.fila(salida)["salidaParcial"]["motivos"], ["plazo-de-la-descarga"])

    def test_un_corte_por_plazo_que_no_duro_el_plazo_queda_parcial(self) -> None:
        """Un ciclo que dice haber agotado su plazo sin que el tiempo lo respalde no se acredita."""
        self.assertEqual(self.produce("plazo-sin-duracion")["registro"], "parcial")

    def test_un_dia_sin_validar_queda_parcial(self) -> None:
        """Sin conjunto validado de ese ciclo no hay nada que acreditar."""
        for escenario in ("sin-validar", "validacion-de-otro-dia", "validacion-con-las-mismas-cifras"):
            with self.subTest(escenario=escenario):
                salida = self.produce(escenario)
                self.assertEqual(salida["registro"], "parcial")
                fila = self.fila(salida)
                self.assertEqual(fila["ultimoIntento"]["resultado"], "parcial")
                self.assertEqual([p["conjunto"] for p in fila["incidenciasPendientes"]], ["enlaces"])

    def test_un_dia_en_que_ninguna_consulta_obtuvo_respuesta_queda_parcial(self) -> None:
        """Todo cortes de red: el conjunto se valida, pero no se acredita ningún enlace."""
        salida = self.produce("sin-respuesta")
        self.assertEqual(salida["registro"], "parcial")
        self.assertEqual(self.fila(salida)["enlaces"], {"comprobados": 0, "ocultos": 0, "sinComprobar": 8})

    def test_un_dia_sin_ninguna_respuesta_concluyente_queda_parcial(self) -> None:
        """Un 5xx, o un dominio que pide que se le deje en paz, tiene código pero no dice nada del enlace."""
        for escenario in ("todo-503", "todo-429", "plazo-con-un-503"):
            with self.subTest(escenario=escenario):
                salida = self.produce(escenario)
                self.assertEqual(salida["registro"], "parcial")
                self.assertEqual(self.fila(salida)["enlaces"]["comprobados"], 0)

    def test_dos_cursos_con_la_misma_ficha_no_impiden_acreditar_el_dia(self) -> None:
        """Una dirección repetida en un conjunto se consulta y se cuenta una vez."""
        self.assertEqual(self.produce("enlace-repetido")["registro"], "comprobada")

    def test_un_dia_sin_observacion_de_lo_consultado_queda_parcial(self) -> None:
        """Si lo consultado no deja una observación fechada en el ciclo, no se acredita."""
        self.assertEqual(self.produce("sin-fecha")["registro"], "parcial")


if __name__ == "__main__":
    unittest.main()
