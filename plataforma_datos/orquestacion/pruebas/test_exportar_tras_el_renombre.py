"""La exportación completa el renombre declarado de la Cambra y la generación que sale de ella es coherente.

Ciclo del 24/11/2026: la base del almacén era anterior al renombre y su paquete publicaba «cambra.json». La exportación
escribía el manifiesto nuevo, con «exposicion-cambra.json», pero dejaba el archivo antiguo en datos/, y la generación
no se pudo conservar: su comprobación exige que datos/ tenga exactamente lo que nombra el manifiesto. Aquí se exporta
sobre esa base, sobre una ya renombrada y sobre una instalación con la tabla privada de la Cambra, que lleva el nombre
antiguo y no es del paquete.
"""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json, sha256
from plataforma_datos.ia_y_trabajo.fuentes.cambra import tabla_privada
from plataforma_datos.orquestacion import exportar_paquete
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.exportacion.comun import Paquete
from plataforma_datos.orquestacion.hora_limite_del_motor import VARIABLE as HORA_LIMITE
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import (
    COMPLETAR_RENOMBRES,
    EXPORTAR_EL_PAQUETE,
    EXPORTAR_EN_EL_CICLO_OPERATIVO,
    ORDENES_DEL_PAQUETE,
    SI,
    ordenes_del_paquete,
)
from plataforma_datos.orquestacion.pruebas import test_exportar_paquete as arnes
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar

TABLA = {"ocupaciones": [{"isco": "2511", "exposicion": 0.61, "componentes": [0.4, 0.7]}]}


class ExportarTrasElRenombre(unittest.TestCase):
    """Una instalación con la generación mínima y la tabla de la Cambra en su conjunto validado."""

    def setUp(self) -> None:
        """Prepara la generación mínima y el conjunto validado de la Cambra, origen de su parte pública."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.temporal = Path(temporal.name).resolve()
        self.raiz = self.temporal / "instalación"
        preparar(self.raiz)
        guardar_json(self.raiz / tabla_privada.ORIGEN, TABLA)
        self.huella_tabla = sha256(self.raiz / tabla_privada.ORIGEN)

    def base(self, publicados: dict[str, object]) -> None:
        """Deja en datos/ un paquete vigente con estos archivos y su manifiesto, como lo restaura el ciclo."""
        manifiesto = {}
        for nombre, contenido in publicados.items():
            guardar_json(self.raiz / "datos" / nombre, contenido)
            origenes = {tabla_privada.ORIGEN: self.huella_tabla} if "cambra" in nombre else {}
            manifiesto[nombre] = {"origenes": origenes, "sha256": sha256(self.raiz / "datos" / nombre)}
        guardar_json(self.raiz / "datos/manifiesto.json", manifiesto)

    def exportar(self, *, ciclo: bool = True) -> dict[str, object]:
        """Exporta el paquete de hoy en datos/: la parte pública de la Cambra sale de su conjunto validado.

        Con `ciclo`, como la orden del ciclo operativo (`--completar-renombres`); sin él, como en una instalación.

        Returns:
            El manifiesto nuevo.
        """
        construidos = {
            "uno.json": Paquete({"dato": 2}, []),
            "exposicion-cambra.json": Paquete({"niveles": {"2511": "alta"}}, [self.raiz / tabla_privada.ORIGEN]),
        }
        with (
            mock.patch.object(exportar_paquete, "RAIZ", self.raiz),
            mock.patch.object(entrada_salida, "RAIZ", self.raiz),
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            return arnes.PruebaExportacion().exportar(self.raiz / "datos", construidos, completar_renombres=ciclo)

    def generacion(self) -> set[str]:
        """Exporta la generación de la instalación, con todas sus comprobaciones.

        Returns:
            Las rutas de los archivos que lleva la generación.
        """
        destino = self.temporal / "generación"
        generacion.exportar_generacion(self.raiz, destino, REVISION)
        return {registro["ruta"] for registro in leer_json(destino / "manifiesto.json")["archivos"]}

    def test_sobre_una_base_anterior_al_renombre_la_generacion_es_coherente(self) -> None:
        """El nombre antiguo se retira con la exportación; la generación lo pasa todo y no lleva la tabla."""
        self.base({"uno.json": {"dato": 1}, "cambra.json": TABLA})
        manifiesto = self.exportar()
        archivos = self.generacion()
        self.assertNotIn("cambra.json", manifiesto)
        self.assertFalse((self.raiz / "datos/cambra.json").exists())
        self.assertIn("datos/exposicion-cambra.json", archivos)
        self.assertNotIn("datos/cambra.json", archivos)
        # Quien comprueba la tabla después de exportar la sigue encontrando: en su conjunto validado.
        self.assertEqual(tabla_privada.comprobar(self.raiz), self.raiz / tabla_privada.ORIGEN)

    def test_sobre_una_base_ya_renombrada_la_exportacion_no_cambia(self) -> None:
        """Sin nombre antiguo publicado no hay nada que retirar, y la generación sale igual de coherente."""
        self.base({"uno.json": {"dato": 1}, "exposicion-cambra.json": {"niveles": {}}})
        manifiesto = self.exportar()
        self.assertEqual(sorted(manifiesto), ["exposicion-cambra.json", "uno.json"])
        self.assertIn("datos/exposicion-cambra.json", self.generacion())

    def test_la_tabla_privada_de_una_instalacion_no_se_retira(self) -> None:
        """Si el manifiesto vigente no nombra «cambra.json», ese archivo es la tabla privada y queda intacto."""
        self.base({"uno.json": {"dato": 1}, "exposicion-cambra.json": {"niveles": {}}})
        guardar_json(self.raiz / tabla_privada.RUTA, TABLA)
        antes = (self.raiz / tabla_privada.RUTA).read_bytes()
        (self.raiz / tabla_privada.ORIGEN).unlink()
        self.exportar_sin_validado(ciclo=False)
        self.assertEqual((self.raiz / tabla_privada.RUTA).read_bytes(), antes)
        self.assertEqual(tabla_privada.comprobar(self.raiz), self.raiz / tabla_privada.RUTA)

    def test_con_un_manifiesto_antiguo_restaurado_una_tabla_con_otros_bytes_no_se_retira(self) -> None:
        """El manifiesto vigente nombra «cambra.json», pero el archivo no tiene su huella: no es el publicado."""
        self.base({"uno.json": {"dato": 1}, "cambra.json": {"ocupaciones": []}})
        guardar_json(self.raiz / tabla_privada.RUTA, TABLA)
        antes = (self.raiz / tabla_privada.RUTA).read_bytes()
        manifiesto = self.exportar()
        self.assertNotIn("cambra.json", manifiesto)
        self.assertEqual((self.raiz / tabla_privada.RUTA).read_bytes(), antes)

    def test_en_una_instalacion_un_manifiesto_antiguo_restaurado_no_retira_la_tabla(self) -> None:
        """Fuera del ciclo operativo nada se retira, aunque el manifiesto restaurado nombre la tabla y su huella."""
        self.base({"uno.json": {"dato": 1}, "cambra.json": TABLA})
        antes = (self.raiz / tabla_privada.RUTA).read_bytes()
        self.exportar(ciclo=False)
        self.assertEqual((self.raiz / tabla_privada.RUTA).read_bytes(), antes)

    def test_solo_el_ciclo_operativo_exporta_completando_los_renombres(self) -> None:
        """Solo la señal propia del ciclo, con su valor exacto, elige la orden con la opción; la hora límite no."""
        self.assertNotIn("--completar-renombres", EXPORTAR_EL_PAQUETE.orden)
        for entorno in ({}, {COMPLETAR_RENOMBRES: "no"}, {HORA_LIMITE: "1800000000"}):
            with self.subTest(entorno=entorno):
                self.assertEqual(ordenes_del_paquete(entorno), ORDENES_DEL_PAQUETE)
        en_el_ciclo = ordenes_del_paquete({COMPLETAR_RENOMBRES: SI})
        self.assertEqual(en_el_ciclo, (EXPORTAR_EN_EL_CICLO_OPERATIVO, *ORDENES_DEL_PAQUETE[1:]))
        self.assertEqual(en_el_ciclo[0].orden[-1], "--completar-renombres")
        for argumentos, completar in (([], False), (["--completar-renombres"], True)):
            with (
                self.subTest(argumentos=argumentos),
                mock.patch.object(exportar_paquete, "exportar_y_contar") as contar,
            ):
                self.assertEqual(exportar_paquete.main(["--destino", str(self.temporal), *argumentos]), 0)
            contar.assert_called_once_with(self.temporal, completar_renombres=completar)

    def exportar_sin_validado(self, *, ciclo: bool) -> None:
        """Exporta como en una instalación de desarrollo: la parte pública cita la huella de la tabla, sin validado."""
        with mock.patch.object(
            exportar_paquete,
            "escribir",
            side_effect=lambda nombre, paquete, carpeta, formato: self.entrada(nombre, paquete, carpeta),
        ):
            self.exportar(ciclo=ciclo)

    def entrada(self, nombre: str, paquete: Paquete, carpeta: Path) -> dict[str, object]:
        """Escribe un archivo del paquete y su entrada; la de la Cambra cita la tabla por su huella.

        Returns:
            La entrada del manifiesto.
        """
        guardar_json(carpeta / nombre, paquete.datos)
        origenes = {tabla_privada.ORIGEN: self.huella_tabla} if "cambra" in nombre else {}
        return {"origenes": origenes, "sha256": sha256(carpeta / nombre)}


if __name__ == "__main__":
    unittest.main()
