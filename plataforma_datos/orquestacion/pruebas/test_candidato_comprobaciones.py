"""El diario remoto atraviesa trabajo, reanudación y siguiente candidato sin descargar."""

import subprocess
import unittest
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion import ejecutor_operativo as ejecutor
from plataforma_datos.orquestacion.almacen_trabajos import leer_referencia
from plataforma_datos.orquestacion.pruebas import test_ejecutor_operativo as casos_ejecutor
from plataforma_datos.orquestacion.pruebas.test_comprobaciones_remotas import AHORA, evidencia
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import plan_desde_registro
from plataforma_datos.orquestacion.sustitucion import cerrojo


class PruebaCandidatoComprobaciones(unittest.TestCase):
    """Conservación real del diario; solo motor y construcción usan dobles existentes."""

    def comprobar_referencia(self, caso: casos_ejecutor.PruebaEjecutorOperativo, resultado: str) -> None:
        """La base del siguiente trabajo incorpora el intento sin perder la última validada."""
        referencia = leer_referencia(caso.almacen)
        if resultado == "rechazado":
            self.assertNotEqual(referencia["baseOperativa"], referencia["ultimaValidada"])
            self.assertEqual(referencia["ultimaValidada"], caso.base)
        else:
            self.assertEqual(referencia["baseOperativa"], referencia["ultimaValidada"])
        self.assertFalse(referencia["bloqueoOperativo"])

    def comprobar_reanudacion(self, caso: casos_ejecutor.PruebaEjecutorOperativo) -> None:
        """Reenvía desde otra carpeta sin alterar índice, diario, referencia ni permiso."""
        referencia = leer_referencia(caso.almacen)
        recibo = caso.cliente.recibos[0]
        objetos = dict(caso.almacen.objetos)
        reanudacion = caso.raiz / "Reanudación Año 2026"
        reanudacion.mkdir()
        caso.config = replace(caso.config, directorio_trabajo=reanudacion)
        caso.cliente.perder = False
        caso.ejecutar(reanudar=True)
        self.assertEqual(caso.cliente.recibos[1], recibo)
        self.assertEqual(caso.almacen.objetos, objetos)
        self.assertEqual(leer_referencia(caso.almacen), referencia)
        self.assertEqual(len(caso.motores), 1)
        self.assertEqual(len(caso.cliente.inicios), 1)

    def comprobar_continuidad(self, resultado: str, *, accion: str = "actualizar-datos") -> None:
        """Una llamada de retorno incierta no repite consulta y el nuevo job recibe su cadencia."""
        caso = casos_ejecutor.PruebaEjecutorOperativo(methodName="runTest")
        self.addCleanup(caso.doCleanups)
        caso.setUp()
        caso.config = replace(caso.config, accion=accion)
        caso.version_recibo = 2 if accion == "comprobar-programada" else 1
        caso.resultado = resultado
        diarios: list[bytes] = []
        planes = []
        momento = AHORA + timedelta(hours=1)

        def proceso(orden: list[str], cwd: Path, plazo: float, entorno: dict) -> subprocess.CompletedProcess:
            if "plataforma_datos.orquestacion.candidato" not in orden:
                return caso.proceso(orden, cwd, plazo, entorno)
            ruta = cwd / registro.ARCHIVO
            if diarios:
                # Se lee en la raíz hidratada del segundo job, antes de cualquier efecto del motor.
                self.assertEqual(ruta.read_bytes(), diarios[0])
                self.assertEqual(plan_desde_registro(cwd, momento), planes[0])
                self.assertNotIn("formacion", plan_desde_registro(cwd, momento).fuentes)
                return caso.proceso(orden, cwd, plazo, entorno)
            respuesta = caso.proceso(orden, cwd, plazo, entorno)
            with cerrojo(cwd):
                ciclo = registro.iniciar_ciclo(cwd, AHORA, "programada")
                registro.iniciar_fuente(cwd, ciclo, "formacion", ("soc-oferta",), AHORA, remoto=True)
                registro.terminar_fuente(
                    cwd,
                    ciclo,
                    "formacion",
                    AHORA + timedelta(seconds=2),
                    resultado="comprobada",
                    evidencia=evidencia(),
                    comprobados=("soc-oferta",),
                )
                registro.cerrar_ciclo(
                    cwd,
                    ciclo,
                    AHORA + timedelta(seconds=3),
                    resultado="fallo" if resultado == "rechazado" else "preparado",
                    paquete_preparado=resultado == "validado",
                )
            diarios.append(ruta.read_bytes())
            planes.append(plan_desde_registro(cwd, momento))
            self.assertEqual(registro.leer_registro(cwd)["fuentes"]["formacion"]["evidencia"]["bytes"], 42)
            return respuesta

        with mock.patch.object(ejecutor, "ejecutar_con_plazo", side_effect=proceso):
            caso.cliente.perder = True
            with self.assertRaises(OSError):
                caso.ejecutar()
            self.comprobar_referencia(caso, resultado)
            self.comprobar_reanudacion(caso)

            siguiente = caso.raiz / "Siguiente candidato Año 2026"
            siguiente.mkdir()
            caso.config = replace(caso.config, directorio_trabajo=siguiente, revision_reserva=2, run_id="124")
            caso.resultado = "rechazado"
            caso.ejecutar()
            self.assertEqual(len(caso.motores), 2)
            self.assertEqual((caso.motores[1] / registro.ARCHIVO).read_bytes(), diarios[0])

    def test_validado_reanuda_y_hidrata_diario_y_plan_en_siguiente_trabajo(self) -> None:
        """La base validada conserva evidencia exacta y evita repetir SOC antes del día."""
        self.comprobar_continuidad("validado")

    def test_rechazado_exportable_reanuda_y_conserva_diario_sin_perder_validada(self) -> None:
        """El rechazo avanza base operativa con diario y mantiene la última generación validada."""
        self.comprobar_continuidad("rechazado")


if __name__ == "__main__":
    unittest.main()
