"""Recepciones inmutables y publicación recuperable de metadatos Chrome, siempre offline."""

import hashlib
import json
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import comprobar_originales
from plataforma_datos.comun.fuentes.versiones_navegadores import lector
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado
from plataforma_datos.comun.pruebas import test_versiones_navegadores as montaje
from plataforma_datos.comun.pruebas.test_versiones_navegadores import (
    FECHA,
    SIGUIENTE,
    VERSION,
    captura,
    release,
)
from plataforma_datos.orquestacion.sustitucion import RecuperacionIncompleta, recuperar


class PruebaRecepcionesChrome(unittest.TestCase):
    """Usa el montador existente sin heredar ni duplicar sus quince pruebas."""

    def setUp(self) -> None:
        """Aísla reloj, originales y admisión en temporales propios."""
        self.escenario = montaje.PruebaVersionesNavegadores("test_error_transitorio_preserva_ultima_buena")
        self.escenario.setUp()
        self.addCleanup(self.escenario.doCleanups)
        self.carpetas = self.escenario.carpetas

    def test_rechazo_de_misma_huella_no_sustituye_procedencia_de_ultima_buena(self) -> None:
        """Destino o MIME distintos quedan como observación rechazada, sin borrar la revisión anterior."""
        datos = captura(release())
        self.escenario.adquirir(datos)
        previo = lector.admitido()
        archivos = {p.name: p.read_bytes() for p in self.carpetas.validado.iterdir()}
        for final, tipo in (("https://google.com/", "application/json"), (lector.URL, "text/html")):
            with (
                self.subTest(final=final, tipo=tipo),
                mock.patch.object(lector, "descargar_url", return_value=Descarga(datos, final, tipo)),
                mock.patch("plataforma_datos.comun.red.ahora_utc", return_value=SIGUIENTE),
                mock.patch.object(lector, "ahora_utc", return_value=SIGUIENTE),
                self.assertRaises(FormatoInesperado),
            ):
                lector.descargar()
            self.assertEqual(lector.admitido(), previo)
            self.assertEqual({p.name: p.read_bytes() for p in self.carpetas.validado.iterdir()}, archivos)
        observaciones = [json.loads(p.read_bytes()) for p in (self.carpetas.original / "observaciones").glob("*.json")]
        recibidas = {(o["recepcion"]["url_final"], o["recepcion"]["content_type"]) for o in observaciones}
        self.assertEqual(len(observaciones), 3)
        self.assertIn(("https://google.com/", "application/json"), recibidas)
        self.assertIn((lector.URL, "text/html"), recibidas)
        self.assertEqual(len(list(self.carpetas.original.glob("chrome-*.json"))), 1)

    def test_recepcion_posterior_iguales_bytes_tiene_fecha_propia_sin_clonar_cuerpo(self) -> None:
        """La nueva consulta no modifica la captura previa ni la fecha de publicación."""
        datos = captura(release())
        self.escenario.adquirir(datos)
        previo = lector.admitido()
        cuerpo = next(self.carpetas.original.glob("chrome-*.json"))
        antes = cuerpo.read_bytes(), cuerpo.stat().st_mtime_ns
        self.escenario.adquirir(datos, SIGUIENTE)
        with mock.patch.object(lector, "ahora_utc", return_value=SIGUIENTE):
            posterior = lector.admitido()
        self.assertEqual(posterior["observado_utc"], SIGUIENTE)
        self.assertEqual(posterior["serving_inicio_utc"], previo["serving_inicio_utc"])
        self.assertNotEqual(posterior["original"], previo["original"])
        self.assertIn(previo["original"], lector._entradas())
        self.assertEqual((cuerpo.read_bytes(), cuerpo.stat().st_mtime_ns), antes)
        self.assertEqual(len(list((self.carpetas.original / "observaciones").glob("*.json"))), 2)

    def test_misma_respuesta_reevalua_el_inicio_futuro_en_otra_recepcion(self) -> None:
        """Una ventana que empieza después se evalúa al recibir, sin usar la fecha del primer cuerpo."""
        futuro = {**release("157.0.0.1"), "serving": {"startTime": SIGUIENTE}}
        datos = captura(release(), futuro)
        self.escenario.adquirir(datos)
        self.assertEqual(lector.admitido()["version_completa"], VERSION)
        self.escenario.adquirir(datos, SIGUIENTE)
        with mock.patch.object(lector, "ahora_utc", return_value=SIGUIENTE):
            admitido = lector.admitido()
        self.assertEqual(admitido["version_completa"], "157.0.0.1")
        self.assertEqual(admitido["observado_utc"], SIGUIENTE)

    def test_procedencia_anterior_no_se_migra_en_silencio(self) -> None:
        """La fuente nunca activada exige adquisición explícita ante su formato experimental anterior."""
        self.carpetas.original.mkdir(parents=True)
        ruta = self.carpetas.original / "procedencia.json"
        datos = captura(release())
        huella = hashlib.sha256(datos).hexdigest()
        nombre = f"chrome-{huella}.json"
        (self.carpetas.original / nombre).write_bytes(datos)
        contenido = json.dumps(
            {
                "archivos": [
                    {
                        "archivo": nombre,
                        "sha256": huella,
                        "bytes": len(datos),
                        "url": lector.URL,
                        "url_final": lector.URL,
                        "content_type": "application/json",
                        "descargado_utc": FECHA,
                    }
                ]
            }
        ).encode()
        ruta.write_bytes(contenido)
        with self.assertRaises(FormatoInesperado):
            lector.preparar()
        self.assertEqual(ruta.read_bytes(), contenido)

    def test_indice_estandar_verifica_cuerpo_y_observaciones(self) -> None:
        """El respaldo común puede comprobar todos los archivos sin tratar el índice como cuerpo HTTP."""
        self.escenario.adquirir(captura(release()))
        rutas = comprobar_originales(lector.FUENTE)
        archivos = {p for p in self.carpetas.original.rglob("*") if p.is_file() and p.name != "procedencia.json"}
        self.assertEqual(set(rutas), archivos)
        self.assertEqual(len(rutas), 2)
        observacion = next(p for p in rutas if p.parent.name == "observaciones")
        observacion.write_bytes(b"alterada")
        with self.assertRaises(FormatoInesperado):
            lector.admitido()

    def _candidato_nuevo(self) -> dict[str, bytes]:
        self.escenario.adquirir(captura(release()))
        anterior = {p.name: p.read_bytes() for p in self.carpetas.validado.iterdir()}
        datos = captura(release("157.0.0.1"))
        with mock.patch.object(lector, "descargar_url", return_value=Descarga(datos, lector.URL, "application/json")):
            lector.descargar()
            lector.preparar()
        return anterior

    def test_error_al_escribir_conjunto_o_informe_preserva_admision(self) -> None:
        """La preparación local completa falla antes de sustituir cualquier archivo vigente."""
        anterior = self._candidato_nuevo()
        reemplazar = Path.replace
        for nombre in (f"{lector.FUENTE}.json", "validacion.json"):

            def fallar(origen: Path, destino: Path, nombre: str = nombre) -> Path:
                if destino.name == nombre:
                    raise OSError("fallo de escritura simulado")
                return reemplazar(origen, destino)

            with self.subTest(nombre=nombre), mock.patch.object(Path, "replace", fallar), self.assertRaises(OSError):
                lector.validar()
            self.assertEqual({p.name: p.read_bytes() for p in self.carpetas.validado.iterdir()}, anterior)
            self.assertEqual(lector.admitido()["version_completa"], VERSION)

    def test_error_al_promover_recupera_ultima_buena(self) -> None:
        """Un fallo de renombrado tras retirar lo vigente se deshace con su diario."""
        anterior = self._candidato_nuevo()
        renombrar = Path.rename

        def fallar(origen: Path, destino: Path) -> Path:
            if origen.name == self.carpetas.validado.name + ".nuevo":
                raise OSError("fallo de promoción simulado")
            return renombrar(origen, destino)

        with mock.patch.object(Path, "rename", fallar), self.assertRaises(OSError):
            lector.validar()
        self.assertEqual({p.name: p.read_bytes() for p in self.carpetas.validado.iterdir()}, anterior)
        self.assertEqual(lector.admitido()["version_completa"], VERSION)

    def test_recuperacion_fallida_informa_y_conserva_diario_y_respaldo(self) -> None:
        """No oculta un segundo fallo ni elimina la evidencia necesaria para recuperar."""
        anterior = self._candidato_nuevo()
        renombrar = Path.rename

        def fallar(origen: Path, destino: Path) -> Path:
            if origen.name in {self.carpetas.validado.name + ".nuevo", self.carpetas.validado.name + ".anterior"}:
                raise OSError("fallo de promoción y recuperación simulado")
            return renombrar(origen, destino)

        with mock.patch.object(Path, "rename", fallar), self.assertRaises(RecuperacionIncompleta) as error:
            lector.validar()
        respaldo = self.carpetas.validado.with_name(self.carpetas.validado.name + ".anterior")
        self.assertEqual({p.name: p.read_bytes() for p in respaldo.iterdir()}, anterior)
        diarios = list(self.carpetas.validado.parent.glob(".*-admision-*/diario.json"))
        self.assertEqual(len(diarios), 1)
        self.assertIn(str(diarios[0]), str(error.exception))
        recuperar(self.carpetas.validado.parent, (self.carpetas.validado.name,), diarios[0])
        self.assertEqual(lector.admitido()["version_completa"], VERSION)

    def test_interrupcion_observada_durante_promocion_recupera_ultima_buena(self) -> None:
        """Una interrupción Python observada tampoco deja mezclados conjunto e informe."""
        anterior = self._candidato_nuevo()
        renombrar = Path.rename

        def interrumpir(origen: Path, destino: Path) -> Path:
            if origen.name == self.carpetas.validado.name + ".nuevo":
                raise KeyboardInterrupt
            return renombrar(origen, destino)

        with mock.patch.object(Path, "rename", interrumpir), self.assertRaises(KeyboardInterrupt):
            lector.validar()
        self.assertEqual({p.name: p.read_bytes() for p in self.carpetas.validado.iterdir()}, anterior)
        self.assertEqual(lector.admitido()["version_completa"], VERSION)

    def test_respaldo_pendiente_no_se_borra_para_otra_admision(self) -> None:
        """Un resto previo bloquea la publicación sin limpiar una recuperación ajena."""
        anterior = self._candidato_nuevo()
        respaldo = self.carpetas.validado.with_name(self.carpetas.validado.name + ".anterior")
        respaldo.mkdir()
        evidencia = respaldo / "pendiente"
        evidencia.write_bytes(b"conservar")
        with self.assertRaises(FormatoInesperado):
            lector.validar()
        self.assertEqual(evidencia.read_bytes(), b"conservar")
        self.assertEqual({p.name: p.read_bytes() for p in self.carpetas.validado.iterdir()}, anterior)

    def test_revalidacion_explicita_con_firmas_nuevas_no_fabrica_consulta(self) -> None:
        """Actualizar el lector exige revalidar, pero no bloquea indefinidamente una anterior íntegra."""
        self.escenario.adquirir(captura(release()))
        previo = lector.admitido()
        originales = {
            p.relative_to(self.carpetas.original): p.read_bytes()
            for p in self.carpetas.original.rglob("*")
            if p.is_file()
        }
        firmas = dict.fromkeys(lector._firmas(), "1" * 64)
        with mock.patch.object(lector, "_firmas", return_value=firmas):
            with self.assertRaises(FormatoInesperado):
                lector.admitido()
            lector.preparar()
            with self.assertRaises(FormatoInesperado):
                lector.admitido()
            lector.validar()
            actualizado = lector.admitido()
            self.assertEqual(actualizado, {**previo, "firmas": firmas})
            archivos = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpetas.validado.iterdir()}
            lector.validar()
            self.assertEqual(
                {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpetas.validado.iterdir()}, archivos
            )
        self.assertEqual(
            {
                p.relative_to(self.carpetas.original): p.read_bytes()
                for p in self.carpetas.original.rglob("*")
                if p.is_file()
            },
            originales,
        )

    def test_cambio_de_firmas_no_autoriza_tamper_ni_captura_anterior_ni_retroceso(self) -> None:
        """Separar integridad de vigencia no permite alterar la anterior ni retrocederla."""
        self.escenario.adquirir(captura(release()), SIGUIENTE)
        firmas = dict.fromkeys(lector._firmas(), "2" * 64)
        with (
            mock.patch.object(lector, "_firmas", return_value=firmas),
            mock.patch.object(lector, "ahora_utc", return_value=SIGUIENTE),
        ):
            for version, fecha in (("155.0.0.1", SIGUIENTE), (VERSION, FECHA)):
                with (
                    self.subTest(version=version, fecha=fecha),
                    mock.patch.object(
                        lector,
                        "descargar_url",
                        return_value=Descarga(captura(release(version)), lector.URL, "application/json"),
                    ),
                    mock.patch("plataforma_datos.comun.red.ahora_utc", return_value=fecha),
                    self.assertRaises(FormatoInesperado),
                ):
                    lector.descargar()
            ruta = self.carpetas.validado / f"{lector.FUENTE}.json"
            datos = json.loads(ruta.read_bytes())
            datos["version_completa"] = "999.0.0.0"
            ruta.write_text(json.dumps(datos))
            with self.assertRaises(FormatoInesperado):
                lector.preparar()
