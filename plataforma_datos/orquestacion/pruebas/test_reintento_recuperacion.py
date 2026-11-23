"""Un reintento sin trabajo recupera transacciones antes de declarar éxito, bajo el cerrojo."""

import io
import json
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar, candidato, sustitucion
from plataforma_datos.orquestacion.estado_de_la_actualizacion import SIN_INTENTO
from plataforma_datos.orquestacion.modulos import IDS
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import Plan
from plataforma_datos.orquestacion.pruebas.ayudas import Corte
from plataforma_datos.orquestacion.pruebas.test_candidato import preparar
from plataforma_datos.orquestacion.pruebas.test_estado_panel import documento


class ReintentoConRecuperacion(unittest.TestCase):
    """Corte real de renombrado y selección real; nunca órdenes de fuentes ni red."""

    def setUp(self) -> None:
        """Raíces aisladas con espacios y Unicode y una transacción interrumpida."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        self.area = Path(temporal.name) / "area"
        preparar(self.raiz)
        (self.raiz / sustitucion.CARPETA).mkdir()
        (self.area / "datos").mkdir(parents=True)
        (self.area / "datos/dato.json").write_text('"nuevo"', encoding="utf-8")
        self.anterior = sustitucion.huellas_del_arbol(self.raiz / "datos")
        self.interrumpir("datos", "paquete")

    def interrumpir(self, relativa: str, modulo: str) -> None:
        """Rearma un corte de promoción real para cada entrada y subcaso."""
        renombrar = Path.rename

        def cortar(ruta: Path, destino: Path) -> Path:
            if ruta == self.raiz / f"{relativa}.nuevo":
                raise Corte()
            return renombrar(ruta, destino)

        with mock.patch.object(Path, "rename", cortar), self.assertRaises(Corte):
            sustitucion.sustituir(self.raiz, self.area, (relativa,), actualizar.diario(modulo))
        self.assertFalse((self.raiz / relativa).exists())

    def ejecutar_cli(self, *opciones: str) -> int:
        """Ejecuta el main real sobre la raíz propia sin permitir una ronda artificial.

        Returns:
            Código de salida observado.
        """
        with (
            mock.patch.object(actualizar, "RAIZ", self.raiz),
            mock.patch.object(actualizar, "_actualizar", side_effect=AssertionError("no debe iniciar otra ronda")),
            redirect_stdout(io.StringIO()),
        ):
            return actualizar.main(["--pendientes", *opciones])

    def test_corte_se_recupera_sin_vencidos_y_repetir_no_fabrica_intentos(self) -> None:
        """Datos vuelve íntegro; la recuperación sin fuentes no crea fechas ni informe nuevo."""
        self.assertEqual(self.ejecutar_cli(), 0)
        self.assertEqual(sustitucion.huellas_del_arbol(self.raiz / "datos"), self.anterior)
        self.assertFalse((self.raiz / "datos.anterior").exists())
        self.assertFalse((self.raiz / "datos.nuevo").exists())
        self.assertFalse((self.raiz / sustitucion.CARPETA / actualizar.diario("paquete")).exists())
        estado = sustitucion.huellas_del_arbol(self.raiz)
        self.assertEqual(self.ejecutar_cli(), 0)
        self.assertEqual(sustitucion.huellas_del_arbol(self.raiz), estado)
        self.assertEqual(
            list((self.raiz / sustitucion.CARPETA).iterdir()), [self.raiz / sustitucion.CARPETA / ".cerrojo"]
        )

    def test_recuperar_no_reescribe_el_estado_previo(self) -> None:
        """Una recuperación sin selección conserva bytes y fecha del estado que ya estaba registrado."""
        estado = self.raiz / sustitucion.CARPETA / "estado.json"
        registro = documento()
        registro["modulos"] = {nombre: dict(SIN_INTENTO) for nombre in IDS}
        estado.write_text(json.dumps(registro), encoding="utf-8")
        previo = estado.read_bytes(), estado.stat().st_mtime_ns
        self.assertEqual(self.ejecutar_cli(), 0)
        self.assertEqual((estado.read_bytes(), estado.stat().st_mtime_ns), previo)

    def test_cerrojo_ocupado_no_declara_exito_ni_muta_la_transaccion(self) -> None:
        """No se selecciona ni recupera cuando la autoridad está ocupada por otro descriptor."""
        with sustitucion.cerrojo(self.raiz):
            antes = sustitucion.huellas_del_arbol(self.raiz)
            self.assertEqual(self.ejecutar_cli(), actualizar.CODIGO_ROJO)
            self.assertEqual(sustitucion.huellas_del_arbol(self.raiz), antes)

    def test_ensayo_y_sin_descargar_conservan_la_recuperacion_y_el_no_op(self) -> None:
        """Las opciones no conceden descargas ni permiten saltarse el diario anterior."""
        self.assertEqual(self.ejecutar_cli("--ensayo", "--sin-descargar", "oit"), 0)
        self.assertEqual(sustitucion.huellas_del_arbol(self.raiz / "datos"), self.anterior)
        self.assertFalse((self.raiz / sustitucion.CARPETA / "comprobaciones.json").exists())

    def test_seleccion_se_consulta_bajo_el_cerrojo(self) -> None:
        """La lectura de pendientes comparte la exclusión que protege la recuperación."""
        seleccionar = actualizar.pendientes

        def bajo_cerrojo(raiz: Path, ahora: datetime) -> tuple[str, ...]:
            with self.assertRaises(sustitucion.ActualizacionEnCurso), sustitucion.cerrojo(raiz):
                pass
            return seleccionar(raiz, ahora)

        with mock.patch.object(actualizar, "pendientes", side_effect=bajo_cerrojo) as observado:
            self.assertEqual(self.ejecutar_cli(), 0)
        observado.assert_called_once()

    def test_salida_sin_trabajo_del_plan_recupera_antes_de_no_op(self) -> None:
        """También programada y búsqueda a demanda recuperan antes de una selección sin módulos."""
        for argumento in ("--programada", "--buscar-actualizaciones"):
            if (self.raiz / "datos").exists():
                self.interrumpir("datos", "paquete")
            with (
                self.subTest(argumento=argumento),
                mock.patch.object(actualizar, "RAIZ", self.raiz),
                mock.patch.object(actualizar, "plan_desde_registro", return_value=Plan((), (), ())),
                mock.patch.object(actualizar, "_actualizar") as ejecutar,
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(actualizar.main([argumento]), 0)
                ejecutar.assert_not_called()
                self.assertEqual(sustitucion.huellas_del_arbol(self.raiz / "datos"), self.anterior)
                self.assertFalse((self.raiz / sustitucion.CARPETA / "comprobaciones.json").exists())

    def test_diario_defectuoso_no_se_convierte_en_sin_pendientes(self) -> None:
        """La recuperación fallida conserva respaldos y devuelve rojo aun sin reintentos vencidos."""
        diario = self.raiz / sustitucion.CARPETA / actualizar.diario("paquete")
        diario.write_text('{"fase":"ajena"}', encoding="utf-8")
        antes = sustitucion.huellas_del_arbol(self.raiz)
        self.assertEqual(self.ejecutar_cli(), actualizar.CODIGO_ROJO)
        despues = sustitucion.huellas_del_arbol(self.raiz)
        despues.pop(f"{sustitucion.CARPETA}/.cerrojo", None)
        self.assertEqual(despues, antes)

    def test_comprobacion_inicial_va_tras_recuperar_y_antes_de_seleccionar(self) -> None:
        """La llamada de retorno interna comparte cerrojo y no existe en Opciones ni como argumento CLI."""
        comprobaciones = []

        def comprobar(raiz: Path, _ahora: datetime) -> None:
            self.assertEqual(sustitucion.huellas_del_arbol(raiz / "datos"), self.anterior)
            with self.assertRaises(sustitucion.ActualizacionEnCurso), sustitucion.cerrojo(raiz):
                pass
            self.assertFalse((raiz / sustitucion.CARPETA / "comprobaciones.json").exists())
            comprobaciones.append("comprobada")

        with redirect_stdout(io.StringIO()):
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(reintentar_pendientes=True), comprobar_entrada=comprobar
            )
        self.assertEqual(resultado, actualizar.ResultadoActualizacion(0, None, None, {}))
        self.assertEqual(comprobaciones, ["comprobada"])
        self.assertNotIn("comprobar_entrada", actualizar.Opciones._fields)

    def test_candidato_recupera_preparados_antes_de_leer_estado_panel(self) -> None:
        """Una instantánea que necesita fichas no puede abortar antes de recuperar su carpeta preparada."""
        actualizar.recuperar_todo(self.raiz)
        relativa = "var/actualizacion/preparados/abierta"
        shutil.copytree(self.raiz / relativa, self.area / relativa)
        anterior = sustitucion.huellas_del_arbol(self.raiz / relativa)
        self.interrumpir(relativa, "abierta")
        ejecutor = mock.Mock(side_effect=AssertionError("no debe ejecutar órdenes"))
        recibo = candidato.ejecutar_candidato(self.raiz, "reintentar-pendientes", ejecutor)
        self.assertEqual(recibo["resultado"], "sin-pendientes")
        self.assertEqual(sustitucion.huellas_del_arbol(self.raiz / relativa), anterior)
        self.assertFalse((self.raiz / f"{relativa}.anterior").exists())
        self.assertFalse((self.raiz / sustitucion.CARPETA / "comprobaciones.json").exists())
        ejecutor.assert_not_called()

    def test_candidato_reintenta_la_recuperacion_sin_validar_un_paquete_nuevo(self) -> None:
        """El recibo sin pendientes pasa por la misma recuperación y no ejecuta procesos."""
        ejecutor = mock.Mock(side_effect=AssertionError("no debe ejecutar órdenes"))
        recibo = candidato.ejecutar_candidato(self.raiz, "reintentar-pendientes", ejecutor)
        self.assertEqual(recibo["resultado"], "sin-pendientes")
        self.assertEqual(sustitucion.huellas_del_arbol(self.raiz / "datos"), self.anterior)
        self.assertIsNone(recibo["huellaPaquete"])
        self.assertIsNone(recibo["veredicto"])
        ejecutor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
