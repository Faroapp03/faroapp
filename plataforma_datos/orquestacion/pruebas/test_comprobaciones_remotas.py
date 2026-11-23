"""Registro remoto privado: cortes, cronología y escritura íntegra sin red ni procesos hijos."""

import copy
import json
import os
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion.sustitucion import cerrojo

AHORA = datetime(2026, 10, 17, 12, tzinfo=UTC)
SOC = "soc-oferta"
CATALOGOS = "formacion-catalogos"


def evidencia(*, peticiones: bool = True) -> dict:
    """Construye una recepción cerrada sin URLs o cuerpos.

    Returns:
        Evidencia HTTP que pasa por el validador real compartido del observador.
    """
    return {
        "version": 1,
        "fuente": "formacion",
        "intento": "intento-http-separado",
        "comienzo_utc": AHORA.isoformat(),
        "fin_utc": (AHORA + timedelta(seconds=1)).isoformat(),
        "peticiones": [
            {
                "recurso_sha256": "a" * 64,
                "url_final_sha256": "b" * 64,
                "respuesta_sha256": "c" * 64,
                "bytes": 42,
                "completado_utc": AHORA.isoformat(),
            }
        ]
        if peticiones
        else [],
    }


class PruebaComprobacionesRemotas(unittest.TestCase):
    """El cerrojo es el del motor; el registro nunca fabrica actividad ni historia remota."""

    def setUp(self) -> None:
        """Instalación propia portable y cerrojo existente adquirido por el llamador."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        self.raiz.mkdir(parents=True)
        self.enterContext(cerrojo(self.raiz))
        self.ruta = self.raiz / registro.ARCHIVO

    def comenzar(self, conjuntos: tuple[str, ...] = (SOC,), *, remoto: bool = True) -> str:
        """Inicia una selección de formación antes de cualquier efecto.

        Returns:
            Identificador durable del ciclo.
        """
        ciclo = registro.iniciar_ciclo(self.raiz, AHORA, "programada")
        registro.iniciar_fuente(self.raiz, ciclo, "formacion", conjuntos, AHORA, remoto=remoto)
        return ciclo

    def completar(self, ciclo: str) -> None:
        """Confirma SOC tras validación admitida por el llamador, sin acreditar tráfico."""
        registro.terminar_fuente(
            self.raiz,
            ciclo,
            "formacion",
            AHORA + timedelta(seconds=2),
            resultado="comprobada",
            evidencia=evidencia(),
            comprobados=(SOC,),
        )

    def test_ausencia_no_crea_archivo_ni_exito(self) -> None:
        """Solo ausencia real produce el esquema actual vacío, sin escribir ni acreditar consultas."""
        estado = registro.leer_registro(self.raiz)
        self.assertEqual(estado["version"], registro.VERSION_REGISTRO)
        self.assertIsNone(estado["ultimo_ciclo"])
        self.assertFalse(estado["conjuntos"])
        self.assertFalse(self.ruta.exists())

    def test_exito_por_conjunto_no_equivale_a_paquete_activo(self) -> None:
        """Conserva comprobación y preparación separadas; no tiene ningún campo de versión activa."""
        ciclo = self.comenzar()
        self.completar(ciclo)
        estado = registro.leer_registro(self.raiz)
        self.assertTrue(estado["reconstruccion_pendiente"])
        self.assertEqual(set(estado["conjuntos"]), {SOC})
        self.assertNotEqual(estado["fuentes"]["formacion"]["evidencia"]["intento"], ciclo)
        registro.cerrar_ciclo(
            self.raiz, ciclo, AHORA + timedelta(seconds=3), resultado="preparado", paquete_preparado=True
        )
        estado = registro.leer_registro(self.raiz)
        self.assertFalse(estado["reconstruccion_pendiente"])
        self.assertNotIn("activo", json.dumps(estado))

    def test_parcial_solo_renueva_conjunto_explicito(self) -> None:
        """Una fuente con catálogos manuales no los rejuvenece al comprobar solo SOC."""
        ciclo = self.comenzar((SOC, CATALOGOS))
        registro.terminar_fuente(
            self.raiz,
            ciclo,
            "formacion",
            AHORA + timedelta(seconds=2),
            resultado="parcial",
            evidencia=evidencia(),
            comprobados=(SOC,),
        )
        estado = registro.leer_registro(self.raiz)
        self.assertEqual(set(estado["conjuntos"]), {SOC})
        self.assertEqual(estado["fuentes"]["formacion"]["resultado"], "parcial")

    def test_error_posterior_conserva_ultima_buena_y_marca_pendiente(self) -> None:
        """Un fallo nuevo no borra ni actualiza el éxito anterior."""
        ciclo = self.comenzar()
        self.completar(ciclo)
        buenas = registro.leer_registro(self.raiz)["conjuntos"]
        siguiente = AHORA + timedelta(days=1)
        nuevo = registro.iniciar_ciclo(self.raiz, siguiente, "manual")
        registro.iniciar_fuente(self.raiz, nuevo, "formacion", (SOC,), siguiente, remoto=True)
        registro.terminar_fuente(self.raiz, nuevo, "formacion", siguiente, resultado="fallo", evidencia=None)
        registro.cerrar_ciclo(self.raiz, nuevo, siguiente, resultado="fallo", paquete_preparado=False)
        estado = registro.leer_registro(self.raiz)
        self.assertEqual(estado["conjuntos"], buenas)
        self.assertTrue(estado["reconstruccion_pendiente"])

    def test_corte_interrumpe_fuente_abierta_sin_borrar_buenas(self) -> None:
        """Adquirir un ciclo nuevo después del corte conserva la tarea de reconstruir."""
        anterior = self.comenzar()
        nuevo = registro.iniciar_ciclo(self.raiz, AHORA + timedelta(seconds=1), "manual")
        estado = registro.leer_registro(self.raiz)
        self.assertNotEqual(nuevo, anterior)
        self.assertEqual(estado["fuentes"]["formacion"]["resultado"], "interrumpido")
        self.assertTrue(estado["reconstruccion_pendiente"])

    def test_paquete_fallido_no_borra_comprobacion_remota(self) -> None:
        """Puede recomponerse después sin volver a consultar una fuente ya comprobada."""
        ciclo = self.comenzar()
        self.completar(ciclo)
        buenas = registro.leer_registro(self.raiz)["conjuntos"]
        registro.cerrar_ciclo(
            self.raiz, ciclo, AHORA + timedelta(seconds=3), resultado="fallo", paquete_preparado=False
        )
        estado = registro.leer_registro(self.raiz)
        self.assertEqual(estado["conjuntos"], buenas)
        self.assertTrue(estado["reconstruccion_pendiente"])

    def test_local_posterior_conserva_cadencia_y_fallo_remoto_renueva_intento(self) -> None:
        """La última ejecución local no oculta el intento HTTP; fallar HTTP no renueva el último éxito."""
        ciclo = self.comenzar()
        self.completar(ciclo)
        primero = registro.leer_registro(self.raiz)
        ultima_buena = primero["conjuntos"]
        ultimo_http = primero["fuentes"]["formacion"]["ultimo_intento_remoto_utc"]
        local = AHORA + timedelta(days=1)
        segundo = registro.iniciar_ciclo(self.raiz, local, "programada")
        registro.iniciar_fuente(self.raiz, segundo, "formacion", (SOC,), local)
        registro.terminar_fuente(self.raiz, segundo, "formacion", local, resultado="local", evidencia=None)
        self.assertEqual(
            registro.leer_registro(self.raiz)["fuentes"]["formacion"]["ultimo_intento_remoto_utc"], ultimo_http
        )
        remoto = AHORA + timedelta(days=2)
        tercero = registro.iniciar_ciclo(self.raiz, remoto, "programada")
        registro.iniciar_fuente(self.raiz, tercero, "formacion", (SOC,), remoto, remoto=True)
        registro.terminar_fuente(self.raiz, tercero, "formacion", remoto, resultado="fallo", evidencia=None)
        posterior = registro.leer_registro(self.raiz)
        self.assertEqual(posterior["fuentes"]["formacion"]["ultimo_intento_remoto_utc"], "2026-10-19T12:00:00Z")
        self.assertEqual(posterior["conjuntos"], ultima_buena)

    def test_cero_http_no_concede_comprobacion(self) -> None:
        """Código nominal con cero peticiones no afirma actualidad remota."""
        ciclo = self.comenzar()
        antes = self.ruta.read_bytes()
        with self.assertRaises(ValueError):
            registro.terminar_fuente(
                self.raiz,
                ciclo,
                "formacion",
                AHORA + timedelta(seconds=2),
                resultado="comprobada",
                evidencia=evidencia(peticiones=False),
                comprobados=(SOC,),
            )
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_local_y_ensayo_no_crean_exito_remoto(self) -> None:
        """Reconstrucción local conserva su modo; ensayo no es un modo productivo permitido."""
        with self.assertRaises(ValueError):
            registro.iniciar_ciclo(self.raiz, AHORA, "ensayo")
        ciclo = self.comenzar(remoto=False)
        registro.terminar_fuente(self.raiz, ciclo, "formacion", AHORA, resultado="local", evidencia=None)
        estado = registro.leer_registro(self.raiz)
        self.assertFalse(estado["fuentes"]["formacion"]["remoto"])
        self.assertEqual(estado["conjuntos"], {})

    def test_remoto_falso_no_permite_renovar_ni_con_evidencia(self) -> None:
        """Una reconstrucción no se convierte en consulta al entregar una evidencia ajena."""
        ciclo = self.comenzar(remoto=False)
        with self.assertRaises(ValueError):
            self.completar(ciclo)

    def test_cronologia_rechaza_atraso_fechas_sin_zona_y_final_antes_http(self) -> None:
        """El reloj durable no retrocede ni admite confirmaciones fuera de su fase."""
        ciclo = self.comenzar()
        antes = self.ruta.read_bytes()
        for instante in (AHORA - timedelta(seconds=1), AHORA.replace(tzinfo=None), AHORA):
            with self.subTest(instante=instante), self.assertRaises(ValueError):
                registro.terminar_fuente(
                    self.raiz,
                    ciclo,
                    "formacion",
                    instante,
                    resultado="comprobada",
                    evidencia=evidencia(),
                    comprobados=(SOC,),
                )
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_ids_subconjuntos_y_transiciones_no_se_adivinan(self) -> None:
        """No acepta otro ciclo, conjunto de otra fuente, doble inicio o doble cierre."""
        ciclo = registro.iniciar_ciclo(self.raiz, AHORA, "programada")
        for conjuntos in (("desconocido",), (SOC, SOC), ("citilab",)):
            with self.subTest(conjuntos=conjuntos), self.assertRaises(ValueError):
                registro.iniciar_fuente(self.raiz, ciclo, "formacion", conjuntos, AHORA)
        registro.iniciar_fuente(self.raiz, ciclo, "formacion", (SOC,), AHORA, remoto=True)
        with self.assertRaises(ValueError):
            registro.iniciar_fuente(self.raiz, ciclo, "formacion", (SOC,), AHORA, remoto=True)
        with self.assertRaises(ValueError):
            registro.cerrar_ciclo(
                self.raiz, "00000000-0000-4000-8000-000000000000", AHORA, resultado="fallo", paquete_preparado=False
            )
        self.completar(ciclo)
        with self.assertRaises(ValueError):
            self.completar(ciclo)
        registro.cerrar_ciclo(
            self.raiz, ciclo, AHORA + timedelta(seconds=3), resultado="preparado", paquete_preparado=True
        )
        with self.assertRaises(ValueError):
            registro.iniciar_fuente(self.raiz, ciclo, "citilab", ("citilab",), AHORA + timedelta(seconds=4))

    def test_evidencia_fuente_ajena_o_fuera_de_intervalo_no_se_registra(self) -> None:
        """El validador compartido coteja identidad y las fases HTTP quedan dentro del intento de fuente."""
        ciclo = self.comenzar()
        for campo, valor in (("fuente", "citilab"), ("comienzo_utc", (AHORA - timedelta(days=1)).isoformat())):
            dato = evidencia()
            dato[campo] = valor
            with self.subTest(campo=campo), self.assertRaises(ValueError):
                registro.terminar_fuente(
                    self.raiz,
                    ciclo,
                    "formacion",
                    AHORA + timedelta(seconds=2),
                    resultado="comprobada",
                    evidencia=dato,
                    comprobados=(SOC,),
                )
        self.assertEqual(registro.leer_registro(self.raiz)["conjuntos"], {})

    def test_escritura_fallida_conserva_anterior_sin_temporal(self) -> None:
        """El fallo de promoción no deja documento parcial ni reemplaza el registro previo."""
        self.comenzar()
        antes = self.ruta.read_bytes()
        reemplazar = Path.replace

        def fallar(origen: Path, destino: Path) -> Path:
            if destino == self.ruta:
                raise OSError("fallo de disco sintético")
            return reemplazar(origen, destino)

        with mock.patch.object(Path, "replace", fallar), self.assertRaises(OSError):
            registro.iniciar_ciclo(self.raiz, AHORA + timedelta(seconds=1), "manual")
        self.assertEqual(self.ruta.read_bytes(), antes)
        self.assertEqual(list(self.ruta.parent.glob(".comprobaciones-*")), [])

    def test_presente_corrupto_duplicado_o_desmedido_no_es_ausencia(self) -> None:
        """No hay recuperación silenciosa de JSON roto, NaN, campos desconocidos o archivo desmedido."""
        self.comenzar()
        for contenido in (
            b"{}",
            b"null",
            b'{"version":1,"version":1}',
            b'{"x":NaN}',
            b" " * (registro.MAX_REGISTRO_BYTES + 1),
        ):
            with self.subTest(contenido=contenido[:30]):
                self.ruta.write_bytes(contenido)
                with self.assertRaises(ValueError):
                    registro.leer_registro(self.raiz)

    def test_enlace_directorio_fifo_y_hardlink_no_se_leen(self) -> None:
        """El lector no sigue enlaces ni espera en dispositivos o tuberías."""
        self.comenzar()
        original = self.ruta.read_bytes()
        otro = self.raiz / "otro.json"
        otro.write_bytes(original)
        for tipo in ("symlink", "hardlink", "fifo", "directorio"):
            with self.subTest(tipo=tipo):
                self.ruta.unlink()
                if tipo == "symlink":
                    self.ruta.symlink_to(otro)
                elif tipo == "hardlink":
                    os.link(otro, self.ruta)
                elif tipo == "fifo":
                    os.mkfifo(self.ruta)
                else:
                    self.ruta.mkdir()
                with self.assertRaises(ValueError):
                    registro.leer_registro(self.raiz)
                if self.ruta.is_dir():
                    self.ruta.rmdir()
                    self.ruta.write_bytes(original)
                elif tipo != "directorio":
                    self.ruta.unlink()
                    self.ruta.write_bytes(original)

    def test_enlace_de_padre_y_documento_incoherente_fallan(self) -> None:
        """No permite rutas indirectas ni retirar pendiente de un ciclo abierto."""
        self.comenzar()
        estado = registro.leer_registro(self.raiz)
        adulterado = copy.deepcopy(estado)
        adulterado["reconstruccion_pendiente"] = False
        self.ruta.write_text(json.dumps(adulterado), encoding="utf-8")
        with self.assertRaises(ValueError):
            registro.leer_registro(self.raiz)
        self.ruta.unlink()
        original = self.ruta.parent
        aparte = original.with_name("movido")
        original.rename(aparte)
        original.symlink_to(aparte)
        with self.assertRaises(ValueError):
            registro.leer_registro(self.raiz)

    def test_intento_remoto_incoherente_o_buena_sin_vinculo_no_se_admite(self) -> None:
        """Un timestamp remoto futuro o una última buena adulterada no pasan como comprobación."""
        ciclo = self.comenzar()
        self.completar(ciclo)
        estado = registro.leer_registro(self.raiz)
        for remoto in (None, "2026-10-18T12:00:00Z"):
            adulterado = copy.deepcopy(estado)
            adulterado["fuentes"]["formacion"]["ultimo_intento_remoto_utc"] = remoto
            self.ruta.write_text(json.dumps(adulterado), encoding="utf-8")
            with self.subTest(remoto=remoto), self.assertRaises(ValueError):
                registro.leer_registro(self.raiz)
        adulterado = copy.deepcopy(estado)
        adulterado["conjuntos"][SOC]["sha256_evidencia"] = "d" * 64
        self.ruta.write_text(json.dumps(adulterado), encoding="utf-8")
        with self.assertRaises(ValueError):
            registro.leer_registro(self.raiz)


if __name__ == "__main__":
    unittest.main()
