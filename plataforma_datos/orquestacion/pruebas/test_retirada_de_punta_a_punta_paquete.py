"""La regla de retirada del Consorci, de su estado guardado a lo publicado en el paquete y al aviso del panel.

Recorre el ciclo del paquete entero (`actualizar.ejecutar_paquete`) sobre una instalación temporal sin red: el estado
de la regla y sus decisiones con evidencia están guardados como los deja el módulo del Consorci al publicarse, el área
se prepara como en cada ciclo y la orden de exportar ejecuta la exportación real, con su enganche
(`retirada_en_el_paquete`); las demás órdenes del paquete responden en verde. Después se compara (con lo que explica
`retiradas_explicadas`), se aplica la cuarentena, se publica y se lee el panel (`estado_panel`). Con la regla activa,
las 30 ediciones retiradas con evidencia no se publican, el archivo no va a cuarentena aunque pierda el 30 %, su
entrada del manifiesto lleva los registros de la regla entre sus orígenes y el panel avisa de la activación y de la
retirada amplia. Con la misma regla en sombra, lo publicado no cambia ni un byte.
"""

import contextlib
import io
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import leer_json, sha256
from plataforma_datos.cursos.decisiones_retirada import ruta_del_registro
from plataforma_datos.cursos.estado_de_la_retirada import ultimo_registro
from plataforma_datos.orquestacion import actualizar, exportar_paquete
from plataforma_datos.orquestacion import cuarentena_del_paquete as cuarentena
from plataforma_datos.orquestacion.area_de_ensayo import preparar_area
from plataforma_datos.orquestacion.estado_de_la_actualizacion import VERDE, ResultadoDelModulo
from plataforma_datos.orquestacion.estado_panel import estado_panel
from plataforma_datos.orquestacion.exportacion.comun import Paquete
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import EXPORTAR_EL_PAQUETE
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, Comparacion
from plataforma_datos.orquestacion.pruebas import test_exportar_paquete as arnes
from plataforma_datos.orquestacion.pruebas.test_retirada_y_cuarentena import CICLO_UTC, regla, unidades

ACTIVADA_UTC = "2026-11-12T05:00:00Z"
AHORA = datetime(2026, 11, 13, 6, tzinfo=UTC)
ORIGENES = {
    "consorci.json": ("var/actualizacion/validados/consorci/consorci.json", "ediciones"),
    "citilab.json": ("var/actualizacion/validados/citilab/citilab.json", "cursos"),
}
RETIRADAS = [unidad["id"] for unidad in unidades(30)]
ESTADO_DE_LA_REGLA = "var/actualizacion/validados/consorci/retirada/00000001.json"


def exportar_en(raiz: Path) -> None:
    """Ejecuta la exportación real del paquete sobre una instalación, como la orden del ciclo en su área.

    Las fuentes leen las 100 unidades de siempre: lo que se retira lo quita el enganche de la exportación, no la fuente.
    """
    construidos = {
        nombre: Paquete({lista: unidades(100)}, [raiz / origen]) for nombre, (origen, lista) in ORIGENES.items()
    }
    with (
        mock.patch.object(exportar_paquete, "RAIZ", raiz),
        mock.patch.object(entrada_salida, "RAIZ", raiz.resolve()),
        contextlib.redirect_stdout(io.StringIO()),
        contextlib.redirect_stderr(io.StringIO()),
    ):
        arnes.PruebaExportacion().exportar(raiz / "datos", construidos)


def ejecutor(orden: list[str], area: Path) -> actualizar.Resultado:
    """La orden de exportar es la real; las demás órdenes del paquete terminan en verde sin hacer nada.

    Returns:
        Éxito.
    """
    if list(orden) == list(EXPORTAR_EL_PAQUETE.orden):
        exportar_en(area)
    return actualizar.Resultado(0, "")


class RetiradaDePuntaAPuntaEnElPaquete(unittest.TestCase):
    """Una instalación con el paquete de hoy publicado y la regla del Consorci guardada por su módulo."""

    def setUp(self) -> None:
        """Publica el paquete de hoy con la exportación real, sin regla, y deja lo que lee el panel."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "repositorio"
        self.area = Path(temporal.name) / "area"
        for origen, _ in ORIGENES.values():
            (self.raiz / origen).parent.mkdir(parents=True, exist_ok=True)
            (self.raiz / origen).write_text("{}", encoding="utf-8")
        fichas = self.raiz / "var/actualizacion/preparados/abierta/fichas.json"
        fichas.parent.mkdir(parents=True)
        fichas.write_text('{"fichas": [], "plataformas": {}}', encoding="utf-8")
        (self.raiz / CARPETA_DE_INFORMES).mkdir(parents=True)
        exportar_en(self.raiz)
        self.hoy = self.publicado()

    def publicado(self) -> dict[str, bytes]:
        """Los bytes de cada archivo del paquete publicado.

        Returns:
            Sus bytes, por nombre.
        """
        return {ruta.name: ruta.read_bytes() for ruta in sorted((self.raiz / "datos").iterdir())}

    def ciclo(self) -> tuple[Comparacion, ResultadoDelModulo]:
        """Prepara el área desde lo publicado y ejecuta el paquete, con su cuarentena registrada.

        Returns:
            La comparación con su cuarentena y el resultado del paquete.
        """
        preparar_area(self.raiz, self.area)
        opciones = actualizar.Opciones(area=self.area, pausa=0, reintento=0)
        with contextlib.redirect_stdout(io.StringIO()):
            _, comparacion, resultado = actualizar.ejecutar_paquete(self.raiz, self.area, ejecutor, opciones)
            cuarentena.registrar_cuarentena(self.raiz, comparacion, AHORA)
        return comparacion, resultado

    def fila_del_panel(self) -> dict[str, object]:
        """El seguimiento del Consorci en el estado del panel, leído de lo publicado.

        Returns:
            Su fila del seguimiento remoto.
        """
        filas = estado_panel(self.raiz, AHORA)["seguimientoRemoto"]
        return next(fila for fila in filas if fila["fuente"] == "consorci")

    def test_activa_no_publica_lo_retirado_sin_cuarentena_y_el_panel_lo_avisa(self) -> None:
        """30 de 100 ediciones retiradas con evidencia: se publican las 70, sin cuarentena, y el panel lo dice."""
        regla(self.raiz, "consorci", "activa", RETIRADAS, mantenidas=70, activada_utc=ACTIVADA_UTC)
        comparacion, resultado = self.ciclo()
        self.assertEqual((resultado.veredicto, resultado.motivo), (VERDE, ""))
        self.assertEqual((comparacion.perdidas, comparacion.retenidos, comparacion.alarmas), ((), frozenset(), []))
        self.assertEqual(cuarentena.leer_cuarentena(self.raiz), {})
        publicado = leer_json(self.raiz / "datos/consorci.json")
        self.assertEqual([unidad["id"] for unidad in publicado["ediciones"]], [u["id"] for u in unidades(70, desde=30)])
        self.assertEqual(self.publicado()["citilab.json"], self.hoy["citilab.json"])
        entrada = leer_json(self.raiz / "datos/manifiesto.json")["consorci.json"]
        self.assertEqual(entrada["sha256"], sha256(self.raiz / "datos/consorci.json"))
        self.assertEqual(entrada["origenes"][ESTADO_DE_LA_REGLA], sha256(self.raiz / ESTADO_DE_LA_REGLA))
        (lectura_id,) = ultimo_registro(self.raiz, "consorci")["lecturas"]
        decisiones = ruta_del_registro(self.raiz, "consorci", lectura_id)
        self.assertEqual(entrada["origenes"][decisiones.relative_to(self.raiz).as_posix()], sha256(decisiones))
        fila = self.fila_del_panel()
        self.assertEqual(fila["retirada"], {"cambio": "activada", "decisiones": 30, "en": ACTIVADA_UTC})
        self.assertEqual(fila["retiradaAmplia"], {"retiradas": 30, "cursos": 100, "en": CICLO_UTC})

    def test_en_sombra_lo_publicado_es_el_de_hoy_byte_a_byte(self) -> None:
        """La misma regla en sombra: el paquete no cambia ni un byte y el panel no trae avisos de la retirada."""
        regla(self.raiz, "consorci", "sombra", RETIRADAS, mantenidas=70)
        comparacion, resultado = self.ciclo()
        self.assertEqual((resultado.veredicto, resultado.motivo), (VERDE, "sin cambios"))
        self.assertEqual((comparacion.perdidas, comparacion.retenidos), ((), frozenset()))
        self.assertEqual(self.publicado(), self.hoy)
        fila = self.fila_del_panel()
        self.assertNotIn("retirada", fila)
        self.assertNotIn("retiradaAmplia", fila)


if __name__ == "__main__":
    unittest.main()
