"""Un éxito local no resuelve errores remotos; el legado no reconstruye historia perdida."""

import copy
import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import comprobaciones_remotas as r
from plataforma_datos.orquestacion.sustitucion import cerrojo

SOC = "soc-oferta"
OTRA = "soc-segunda-serie-sintetica"


class SeguimientoRemotoPruebas(unittest.TestCase):
    """Transiciones públicas sobre instalación temporal, sin acceder a fuentes remotas."""

    def setUp(self) -> None:
        """Aísla datos, reloj y cerrojo sin modificar la instalación real."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.enterContext(cerrojo(self.raiz))
        self.ahora = datetime(2026, 10, 22, 10, tzinfo=UTC)
        self.ruta = self.raiz / r.ARCHIVO

    def _ciclo(
        self,
        resultado: str,
        *,
        remoto: bool = True,
        comprobados: tuple[str, ...] = (),
        conjuntos: tuple[str, ...] = (SOC,),
    ) -> dict:
        ciclo = r.iniciar_ciclo(self.raiz, self.ahora, "programada")
        r.iniciar_fuente(self.raiz, ciclo, "formacion", conjuntos, self.ahora, remoto=remoto)
        fin = self.ahora + timedelta(seconds=1)
        evidencia = (
            {
                "version": 2,
                "fuente": "formacion",
                "intento": "recepcion-sintetica",
                "comienzo_utc": self.ahora.isoformat(),
                "fin_utc": fin.isoformat(),
                "peticiones": [
                    {
                        "recurso_sha256": "a" * 64,
                        "url_final_sha256": "b" * 64,
                        "respuesta_sha256": "c" * 64,
                        "bytes": 42,
                        "completado_utc": fin.isoformat(),
                        "original_sha256": "c" * 64,
                        "original_bytes": 42,
                    }
                ],
            }
            if comprobados
            else None
        )
        r.terminar_fuente(
            self.raiz, ciclo, "formacion", fin, resultado=resultado, evidencia=evidencia, comprobados=comprobados
        )
        r.cerrar_ciclo(self.raiz, ciclo, fin, resultado="sin-cambios", paquete_preparado=True)
        self.ahora += timedelta(minutes=1)
        return r.leer_registro(self.raiz)

    def test_local_no_borra_fallo_ni_positiva_previa(self) -> None:
        """Conserva el último fallo remoto y la comprobación anterior tras una reconstrucción correcta."""
        buena = self._ciclo("comprobada", comprobados=(SOC,))
        fallo = self._ciclo("fallo")
        local = self._ciclo("local", remoto=False)
        self.assertEqual(local["seguimiento_remoto"], fallo["seguimiento_remoto"])
        self.assertEqual(local["conjuntos"], buena["conjuntos"])
        self.assertEqual(local["fuentes"]["formacion"]["resultado"], "local")
        self.assertEqual(local["seguimiento_remoto"]["formacion"]["ultimo_intento"]["resultado"], "fallo")

    def test_parcial_solo_resuelve_conjuntos_comprobados(self) -> None:
        """Una fuente sintética con dos consultas no cura la segunda al comprobar la primera."""
        with (
            mock.patch.dict(r.CONJUNTO_FUENTE, {OTRA: "formacion"}),
            mock.patch.object(r, "CONJUNTOS_REMOTOS", r.CONJUNTOS_REMOTOS | {OTRA}),
        ):
            fallo = self._ciclo("fallo", conjuntos=(SOC, OTRA))
            parcial = self._ciclo("parcial", conjuntos=(SOC, OTRA), comprobados=(SOC,))
            pendiente = parcial["seguimiento_remoto"]["formacion"]["incidencias_pendientes"]
            self.assertEqual(set(pendiente), {OTRA})
            self.assertEqual(pendiente[OTRA], fallo["fuentes"]["formacion"])
            completo = self._ciclo("comprobada", conjuntos=(OTRA,), comprobados=(OTRA,))
            self.assertEqual(completo["seguimiento_remoto"]["formacion"]["incidencias_pendientes"], {})

    def test_revision_manual_no_se_convierte_en_fallo_remoto(self) -> None:
        """Una revisión local del catálogo no se atribuye como fallo de descarga."""
        registro = self._ciclo("fallo", conjuntos=(SOC, "formacion-catalogos"))
        self.assertEqual(set(registro["seguimiento_remoto"]["formacion"]["incidencias_pendientes"]), {SOC})

    def test_migracion_local_no_infiere_resultado_remoto_y_es_idempotente(self) -> None:
        """La migración conserva fechas y desconoce el resultado remoto perdido sin escribir dos veces."""
        self._ciclo("fallo")
        local = self._ciclo("local", remoto=False)
        local.pop("seguimiento_remoto")
        local["version"] = 1
        self.ruta.write_text(json.dumps(local))
        self.assertEqual(r.leer_registro(self.raiz), local)
        antes = self.ruta.read_bytes()
        with self.assertRaises(r.RegistroComprobacionesInvalido):
            r.iniciar_ciclo(self.raiz, self.ahora, "manual")
        self.assertEqual(self.ruta.read_bytes(), antes)
        migrado = r.migrar_registro(self.raiz)
        self.assertEqual(
            {k: v for k, v in migrado.items() if k not in ("seguimiento_remoto", "version")},
            {k: v for k, v in local.items() if k != "version"},
        )
        self.assertEqual(
            migrado["seguimiento_remoto"]["formacion"],
            {"ultimo_intento": None, "incidencias_pendientes": {}, "fallos_seguidos": 0},
        )
        bytes_fecha = self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns
        self.assertEqual(r.migrar_registro(self.raiz), migrado)
        self.assertEqual((self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns), bytes_fecha)

    def test_migracion_fallo_remoto_copia_solo_observacion_demostrable(self) -> None:
        """El legado permite recuperar únicamente el último intento realmente almacenado como remoto."""
        anterior = self._ciclo("fallo")
        anterior.pop("seguimiento_remoto")
        anterior["version"] = 1
        self.ruta.write_text(json.dumps(anterior))
        migrado = r.migrar_registro(self.raiz)
        self.assertEqual(migrado["seguimiento_remoto"]["formacion"]["ultimo_intento"], anterior["fuentes"]["formacion"])
        self.assertEqual(
            migrado["seguimiento_remoto"]["formacion"]["incidencias_pendientes"][SOC], anterior["fuentes"]["formacion"]
        )

    def test_incidencia_resuelta_no_puede_reintroducirse_manipulando_json(self) -> None:
        """El contrato rechaza volver a declarar un pendiente después de su comprobación resolutoria."""
        fallo = self._ciclo("fallo")
        buena = self._ciclo("comprobada", comprobados=(SOC,))
        alterado = copy.deepcopy(buena)
        alterado["seguimiento_remoto"]["formacion"]["incidencias_pendientes"] = fallo["seguimiento_remoto"][
            "formacion"
        ]["incidencias_pendientes"]
        with self.assertRaises(r.RegistroComprobacionesInvalido):
            r.validar_registro(alterado)

    def test_fixture_v3_pasa_receptor_y_rechaza_incidencia_resuelta(self) -> None:
        """Python y el receptor real consumen el mismo fixture que el validador Node."""
        from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajoInvalido
        from plataforma_datos.orquestacion.instantanea_del_recibo import validar_instantanea

        ruta = Path(__file__).resolve().parents[3] / "pruebas/fixtures/estado-datos-v3.json"
        documento = json.loads(ruta.read_bytes())
        validar_instantanea(documento)
        documento["comprobaciones"]["conjuntos"][0]["ultimaComprobacion"]["fecha"] = "2026-10-16T12:00:12Z"
        with self.assertRaises(AlmacenTrabajoInvalido):
            validar_instantanea(documento)

    def test_interrupcion_no_borra_el_fallo_no_resuelto(self) -> None:
        """Un nuevo intento cortado se muestra separado sin borrar el fallo pendiente anterior."""
        fallo = self._ciclo("fallo")
        ciclo = r.iniciar_ciclo(self.raiz, self.ahora, "programada")
        r.iniciar_fuente(self.raiz, ciclo, "formacion", (SOC,), self.ahora, remoto=True)
        self.ahora += timedelta(minutes=1)
        local = self._ciclo("local", remoto=False)
        seguimiento = local["seguimiento_remoto"]["formacion"]
        self.assertEqual(seguimiento["ultimo_intento"]["resultado"], "interrumpido")
        self.assertEqual(
            seguimiento["incidencias_pendientes"], fallo["seguimiento_remoto"]["formacion"]["incidencias_pendientes"]
        )

    def test_fallo_de_escritura_migracion_preserva_legado_exacto(self) -> None:
        """Si la promoción de la migración falla, conserva bytes y fecha del registro v1."""
        legado = self._ciclo("fallo")
        legado.pop("seguimiento_remoto")
        legado["version"] = 1
        self.ruta.write_text(json.dumps(legado))
        antes = self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns
        reemplazar = Path.replace

        def fallar(origen: Path, destino: Path) -> Path:
            if destino == self.ruta:
                raise OSError("fallo de sustitución simulado")
            return reemplazar(origen, destino)

        with mock.patch.object(Path, "replace", fallar), self.assertRaises(OSError):
            r.migrar_registro(self.raiz)
        self.assertEqual((self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns), antes)
        self.assertEqual(r.leer_registro(self.raiz), legado)
