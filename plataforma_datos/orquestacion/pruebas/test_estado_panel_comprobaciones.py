"""Consulta registrada, reconstrucción local y revisión conservan identidades y fechas independientes."""

import hashlib
import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion import estado_panel as panel
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import ALCANCES_CON_REVISION, CONJUNTOS
from plataforma_datos.orquestacion.sustitucion import cerrojo

AHORA = datetime(2026, 10, 17, 12, 0, 0, 123456, tzinfo=UTC)
SOC = "soc-oferta"
CATALOGOS = "formacion-catalogos"


def evidencia(fuente: str) -> dict:
    """Construye evidencia sin consultar HTTP ni archivos externos.

    Returns:
        Recibo sintético v2 de una respuesta vinculada.
    """
    return {
        "version": 2,
        "fuente": fuente,
        "intento": "intento-sintetico",
        "comienzo_utc": AHORA.isoformat(),
        "fin_utc": AHORA.isoformat(),
        "peticiones": [
            {
                "recurso_sha256": "a" * 64,
                "url_final_sha256": "b" * 64,
                "respuesta_sha256": "c" * 64,
                "bytes": 42,
                "completado_utc": AHORA.isoformat(),
                "original_sha256": "c" * 64,
                "original_bytes": 42,
            }
        ],
    }


class PruebaComprobacionesPanel(unittest.TestCase):
    """El productor solo proyecta el registro seguro; no deduce éxitos de otras fechas."""

    def setUp(self) -> None:
        """Crea una instalación aislada y portátil con su cerrojo propio."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        fichas = self.raiz / "var/actualizacion/preparados/abierta/fichas.json"
        fichas.parent.mkdir(parents=True)
        fichas.write_text('{"fichas":[],"plataformas":{}}', encoding="utf-8")
        self.enterContext(cerrojo(self.raiz))

    def iniciar(self, fuente: str, conjuntos: tuple[str, ...], *, remoto: bool = True, ahora: datetime = AHORA) -> str:
        """Abre una operación mediante el escritor productivo.

        Returns:
            Identificador del ciclo abierto.
        """
        ciclo = registro.iniciar_ciclo(self.raiz, ahora, "programada")
        registro.iniciar_fuente(self.raiz, ciclo, fuente, conjuntos, ahora, remoto=remoto)
        return ciclo

    def comprobar_soc(self) -> str:
        """Registra SOC comprobado, manteniendo el conjunto manual fuera de esa consulta.

        Returns:
            Identificador del ciclo cerrado con un paquete preparado.
        """
        ciclo = self.iniciar("formacion", (SOC, CATALOGOS))
        registro.terminar_fuente(
            self.raiz,
            ciclo,
            "formacion",
            AHORA,
            resultado="parcial",
            evidencia=evidencia("formacion"),
            comprobados=(SOC,),
        )
        registro.cerrar_ciclo(self.raiz, ciclo, AHORA, resultado="preparado", paquete_preparado=True)
        return ciclo

    def snapshot(self, ahora: datetime = AHORA) -> dict:
        """Consulta el productor con un único reloj explícito.

        Returns:
            Instantánea del contrato vigente de la instalación sintética.
        """
        return panel.estado_panel(self.raiz, ahora)

    def test_ausencia_proyecta_59_conjuntos_y_revision_sin_inventar_evidencia(self) -> None:
        """Los dos externos y las entradas locales se presentan sin una consulta ficticia."""
        estado = self.snapshot()
        comprobaciones = estado["comprobaciones"]
        self.assertEqual(estado["version"], 5)
        self.assertEqual(estado["observadoEn"], "2026-10-17T12:00:00.123456Z")
        self.assertIsNone(comprobaciones["registradoEn"])
        self.assertFalse(comprobaciones["reconstruccionPendiente"])
        self.assertTrue(all(f["ultimaOperacion"] is None for f in estado["fuentes"]))
        conjuntos = comprobaciones["conjuntos"]
        self.assertEqual(len(conjuntos), 59)
        self.assertEqual([c["id"] for c in conjuntos], [c.id for c in CONJUNTOS])
        enlaces = next(c for c in conjuntos if c["id"] == "enlaces_lecturas")
        self.assertEqual(enlaces["fuente"], "enlaces_lecturas")
        self.assertEqual(enlaces["intervaloDias"], 7)
        self.assertIsNone(enlaces["ultimaComprobacion"])
        for fila, conjunto in zip(conjuntos, CONJUNTOS, strict=True):
            self.assertIsNone(fila["ultimaComprobacion"])
            self.assertEqual(fila["fuente"], conjunto.fuente)
            self.assertEqual(fila["intervaloDias"], conjunto.intervalo_dias)
            self.assertEqual(fila["alcance"], conjunto.alcance)
            self.assertEqual(fila["operacion"], conjunto.operacion)
            self.assertEqual(
                fila["revisionNecesaria"],
                conjunto.operacion == "revision"
                or (conjunto.operacion == "descargar" and conjunto.alcance in ALCANCES_CON_REVISION),
            )
        self.assertEqual([c["id"] for c in conjuntos if c["fuente"] is None], ["ia_nacional", "encuestas_isco4"])
        self.assertFalse((self.raiz / registro.ARCHIVO).exists())

    def test_parcial_formacion_separa_soc_de_catalogos_y_preserva_vinculo(self) -> None:
        """El resumen saneado conserva el ciclo y la huella exactos, sin recibos ni campos privados."""
        ciclo = self.comprobar_soc()
        esperado = registro.leer_registro(self.raiz)
        ruta = self.raiz / registro.ARCHIVO
        antes = hashlib.sha256(ruta.read_bytes()).hexdigest()
        with mock.patch.object(registro, "leer_registro", wraps=registro.leer_registro) as leer:
            estado = self.snapshot()
        leer.assert_called_once_with(self.raiz)
        self.assertEqual(hashlib.sha256(ruta.read_bytes()).hexdigest(), antes)
        fuente = next(f for f in estado["fuentes"] if f["id"] == "formacion")
        operacion = fuente["ultimaOperacion"]
        self.assertEqual(operacion["resultado"], "parcial")
        self.assertEqual(operacion["ciclo"], ciclo)
        self.assertTrue(operacion["remoto"])
        self.assertEqual(operacion["inicioEn"], "2026-10-17T12:00:00.123456Z")
        self.assertEqual(operacion["finEn"], operacion["inicioEn"])
        self.assertEqual(operacion["ultimoIntentoRemotoEn"], operacion["inicioEn"])
        self.assertEqual(operacion["huellaEvidencia"], esperado["fuentes"]["formacion"]["evidencia"]["sha256"])
        conjuntos = {c["id"]: c for c in estado["comprobaciones"]["conjuntos"]}
        self.assertEqual(
            conjuntos[SOC]["ultimaComprobacion"],
            {"fecha": operacion["finEn"], "ciclo": ciclo, "huellaEvidencia": operacion["huellaEvidencia"]},
        )
        self.assertIsNone(conjuntos[CATALOGOS]["ultimaComprobacion"])
        self.assertTrue(conjuntos[CATALOGOS]["revisionNecesaria"])
        self.assertIsNone(fuente["fecha"])
        self.assertNotIn("intento-sintetico", json.dumps(estado))

    def test_local_y_fallo_posteriores_conservan_exito_antiguo_y_no_renuevan_fuente(self) -> None:
        """El resultado último cambia; fecha, ciclo y huella del éxito remoto anterior permanecen."""
        self.comprobar_soc()
        buena = next(c for c in self.snapshot()["comprobaciones"]["conjuntos"] if c["id"] == SOC)["ultimaComprobacion"]
        for dias, resultado, remoto in ((1, "local", False), (2, "fallo", True)):
            ahora = AHORA + timedelta(days=dias)
            ciclo = self.iniciar("formacion", (SOC, CATALOGOS), remoto=remoto, ahora=ahora)
            registro.terminar_fuente(self.raiz, ciclo, "formacion", ahora, resultado=resultado, evidencia=None)
            registro.cerrar_ciclo(self.raiz, ciclo, ahora, resultado="fallo", paquete_preparado=False)
            estado = self.snapshot(ahora)
            operacion = next(f for f in estado["fuentes"] if f["id"] == "formacion")["ultimaOperacion"]
            self.assertEqual(operacion["resultado"], resultado)
            self.assertEqual(operacion["remoto"], remoto)
            self.assertEqual(
                operacion["ultimoIntentoRemotoEn"], (ahora if remoto else AHORA).isoformat().replace("+00:00", "Z")
            )
            self.assertIsNone(operacion["huellaEvidencia"])
            actual = next(c for c in estado["comprobaciones"]["conjuntos"] if c["id"] == SOC)["ultimaComprobacion"]
            self.assertEqual(actual, buena)
            self.assertTrue(estado["comprobaciones"]["reconstruccionPendiente"])

    def test_comprobada_con_revision_pendiente_no_afirma_edicion_vigente(self) -> None:
        """Consultar íntegramente una referencia no elimina su revisión editorial."""
        ciclo = self.iniciar("oit", ("oit",))
        registro.terminar_fuente(
            self.raiz, ciclo, "oit", AHORA, resultado="comprobada", evidencia=evidencia("oit"), comprobados=("oit",)
        )
        estado = self.snapshot()
        conjunto = next(c for c in estado["comprobaciones"]["conjuntos"] if c["id"] == "oit")
        self.assertIsNotNone(conjunto["ultimaComprobacion"])
        self.assertTrue(conjunto["revisionNecesaria"])
        self.assertTrue(estado["comprobaciones"]["reconstruccionPendiente"])

    def test_corte_abierto_e_interrumpido_son_observacion_sin_actividad_inferida(self) -> None:
        """No se convierte un ciclo abierto o interrumpido en éxito de consulta."""
        self.iniciar("consorci", ("consorci",))
        abierto = next(f for f in self.snapshot()["fuentes"] if f["id"] == "consorci")["ultimaOperacion"]
        self.assertEqual(abierto["resultado"], "en-curso")
        self.assertIsNone(abierto["finEn"])
        self.assertIsNone(abierto["huellaEvidencia"])
        posterior = AHORA + timedelta(days=1)
        registro.iniciar_ciclo(self.raiz, posterior, "manual")
        estado = self.snapshot(posterior)
        interrumpido = next(f for f in estado["fuentes"] if f["id"] == "consorci")["ultimaOperacion"]
        self.assertEqual(interrumpido["resultado"], "interrumpido")
        self.assertEqual(interrumpido["finEn"], posterior.isoformat().replace("+00:00", "Z"))
        self.assertTrue(all(c["ultimaComprobacion"] is None for c in estado["comprobaciones"]["conjuntos"]))

    def test_reloj_futuro_en_el_mismo_segundo_falla_y_no_se_trunca(self) -> None:
        """El reloj no se compara tras perder los microsegundos de la observación."""
        self.comprobar_soc()
        with self.assertRaises(panel.EstadoPanelInvalido):
            self.snapshot(AHORA.replace(microsecond=123455))
        estado = self.snapshot(AHORA.replace(microsecond=123457))
        self.assertEqual(estado["observadoEn"], "2026-10-17T12:00:00.123457Z")
        self.assertEqual(estado["comprobaciones"]["registradoEn"], "2026-10-17T12:00:00.123456Z")

    def test_registro_presente_defectuoso_no_se_oculta_como_ausente(self) -> None:
        """JSON ambiguo, excesivo o cronología adulterada fallan con el error público genérico."""
        self.comprobar_soc()
        ruta = self.raiz / registro.ARCHIVO
        original = registro.leer_registro(self.raiz)
        original["conjuntos"][SOC]["sha256_evidencia"] = "d" * 64
        for contenido in (
            b"{",
            b'{"version":1,"version":1}',
            b'{"x":NaN}',
            b" " * (registro.MAX_REGISTRO_BYTES + 1),
            json.dumps(original).encode(),
        ):
            with self.subTest(bytes=len(contenido)):
                ruta.write_bytes(contenido)
                with self.assertRaisesRegex(panel.EstadoPanelInvalido, "^" + panel.ERROR_GENERICO + "$"):
                    self.snapshot()


if __name__ == "__main__":
    unittest.main()
