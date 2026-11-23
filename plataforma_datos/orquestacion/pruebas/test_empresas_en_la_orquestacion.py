"""La selección programada y la generación operativa respetan la admisión contractual de Empresas."""

import io
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime
from unittest import mock

from plataforma_datos.comun.nucleo import ValidacionFallida
from plataforma_datos.mercado.pruebas.ayuda_contratos_empresas import InstalacionContratosEmpresas
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion import seguimiento_de_comprobaciones as seguimiento
from plataforma_datos.orquestacion.modulos import Modulo
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS


class PruebaEmpresasEnLaOrquestacion(InstalacionContratosEmpresas, unittest.TestCase):
    """Un cambio de contrato de Empresas llega a la selección programada y al guardián de la generación."""

    def test_plan_revalida_sin_cadencia_remota_vencida(self) -> None:
        """Un cambio local selecciona preparar/validar, sin conceder otra descarga."""
        ahora = datetime(2026, 10, 22, 16, tzinfo=UTC)
        fuentes = {c.fuente for c in CONJUNTOS if c.fuente is not None}
        documento = {
            "reconstruccion_pendiente": False,
            "fuentes": {
                fuente: {
                    "conjuntos": [c.id for c in CONJUNTOS if c.fuente == fuente],
                    "ultimo_intento_remoto_utc": ahora.isoformat(),
                }
                for fuente in fuentes
            },
        }
        with mock.patch.object(seguimiento.registro, "leer_registro", return_value=documento):
            self.assertEqual(seguimiento.plan_desde_registro(self.raiz, ahora).modulos, ())
            self.cnae.write_bytes(self.cnae.read_bytes() + b" ")
            plan = seguimiento.plan_desde_registro(self.raiz, ahora)
            self.assertEqual(plan.fuentes, ())
            self.assertEqual(plan.modulos, ("empresas",))
            with redirect_stdout(io.StringIO()):
                opciones = actualizar._opciones_programadas(self.raiz, actualizar.Opciones(programada=True), ahora)
            self.assertEqual(opciones.solo, ("empresas",))
            ordenes = actualizar.ordenes_de_la_fuente("empresas", opciones.sin_descargar)
            self.assertEqual([o.orden[3] for o in ordenes], ["preparar", "validar"])

    def test_generacion_operativa_rechaza_admision_contractual_antigua(self) -> None:
        """El guardián ya utilizado por la generación impide copiar un conjunto antiguo como admitido."""
        self.cnae.write_bytes(self.cnae.read_bytes() + b" ")
        with (
            mock.patch.object(generacion, "MODULOS", (Modulo("empresas", ("empresas",)),)),
            self.assertRaises(ValidacionFallida),
        ):
            generacion._admitidos(self.raiz)


if __name__ == "__main__":
    unittest.main()
