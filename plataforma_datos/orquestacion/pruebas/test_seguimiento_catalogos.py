"""Los catálogos diarios solo renuevan su consulta después de admitir el módulo y acreditar todos sus recursos."""

import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.pruebas.test_cobertura_citilab as test_cobertura_citilab
import plataforma_datos.cursos.pruebas.test_cobertura_consorci as test_cobertura_consorci
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.modulos import Modulo
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import Seguimiento

INICIO = datetime(2026, 10, 17, 8, tzinfo=UTC)
FIN = INICIO + timedelta(minutes=2)


class PruebaSeguimientoCatalogos(unittest.TestCase):
    """Ejercita coberturas reales y registro durable; solo el ejecutor de órdenes utiliza un doble."""

    def test_admision_y_cobertura_son_requisitos_independientes(self) -> None:
        """Descargar o reconstruir por separado no da una fecha nueva, aunque el otro paso termine bien."""
        catalogos = (
            ("consorci", test_cobertura_consorci.PruebaCoberturaConsorci),
            ("citilab", test_cobertura_citilab.PruebaCoberturaCitilab),
        )
        for fuente, fabrica in catalogos:
            for variante in ("completo", "rechazado", "parcial", "local", "etapa-fallida"):
                with self.subTest(fuente=fuente, variante=variante):
                    copia = fabrica()
                    copia.setUp()
                    try:
                        self.comprobar(fuente, variante, copia.raiz, copia.evidencia)
                    finally:
                        copia.doCleanups()

    def comprobar(self, fuente: str, variante: str, raiz: Path, evidencia: dict) -> None:
        """Comprueba el resultado registrado después de la admisión simulada y la cobertura real."""
        if variante == "parcial":
            evidencia["peticiones"].pop()
        ciclo = registro.iniciar_ciclo(raiz, INICIO, "programada")

        def ejecutar(orden: list[str], _area: Path) -> actualizar.Resultado:
            etapa = etapa_de_fuente(orden)[1]
            codigo = int(variante == "etapa-fallida" and etapa == "preparar")
            return actualizar.Resultado(codigo, "", evidencia if etapa == "descargar" else None)

        observador = Seguimiento(raiz, ciclo, ejecutar, mock.Mock(side_effect=[INICIO, FIN]))
        sin_descargar = (fuente,) if variante == "local" else ()
        for orden in actualizar.ordenes_de_la_fuente(fuente, sin_descargar):
            observador.ejecutar(orden.orden, raiz)
        self.assertEqual(registro.leer_registro(raiz)["conjuntos"], {})
        resultado = actualizar.ResultadoDelModulo("ámbar" if variante == "rechazado" else "verde")
        observador.terminar_modulo(Modulo(fuente, (fuente,)), resultado)
        documento = registro.leer_registro(raiz)
        esperados = {fuente} if variante == "completo" else set()
        self.assertEqual(set(documento["conjuntos"]), esperados)
        if variante == "completo":
            self.assertEqual(documento["fuentes"][fuente]["resultado"], "comprobada")
            registro.cerrar_ciclo(raiz, ciclo, FIN, resultado="fallo", paquete_preparado=False)
            despues = registro.leer_registro(raiz)
            self.assertEqual(despues["conjuntos"], documento["conjuntos"])
            self.assertTrue(despues["reconstruccion_pendiente"])


if __name__ == "__main__":
    unittest.main()
