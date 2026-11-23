"""Publicación offline desde admisión, sin catálogo alternativo ni datos reales."""

import hashlib
import json
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.pruebas.test_permisos_publicados import ModoDeLoPublicado
from plataforma_datos.cursos import publicar_catalogo as publicacion
from plataforma_datos.cursos.admision_catalogo import ErrorAdmisionCatalogo
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.pruebas import test_entrega_catalogo as fixtures


class PublicarCatalogoPruebas(unittest.TestCase):
    """Cada prueba usa una V9 y evidencias sintéticas privadas propias."""

    def setUp(self) -> None:
        """Prepara una publicación sintética admitida y su destino exclusivo."""
        self.caso = fixtures.EntregaCatalogoPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.confirmar_recurso()
        self.publico = self.caso.admitir()
        self.web = self.caso.raiz / "Web pública ñ"

    def test_publica_solo_asset_y_referencia_externa_sin_renovar(self) -> None:
        """Publica DTO, aprendizaje vinculado y puntero; repetir conserva bytes y mtime."""
        antes = self.caso.base.read_bytes()
        referencia = publicacion.publicar(self.caso.solicitud, web=self.web)
        asset = self.web / referencia["ruta"]
        self.assertEqual(json.loads(asset.read_bytes()), self.publico)
        self.assertIn(referencia["sha256"], asset.name)
        self.assertNotIn("catalogo_privado", asset.read_text())
        self.assertNotIn(str(self.caso.raiz), (self.web / publicacion.RUTA_REFERENCIA).read_text())
        huellas = {
            p.relative_to(self.web): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.web.rglob("*") if p.is_file()
        }
        self.assertEqual(len(huellas), 3)
        companeros = list((self.web / "datos/catalogo-aprendizaje").glob("*.json"))
        self.assertEqual(len(companeros), 1)
        aprendizaje = companeros[0].read_bytes()
        sha_aprendizaje = hashlib.sha256(aprendizaje).hexdigest()
        self.assertEqual(companeros[0].stem, sha_aprendizaje)
        self.assertEqual(
            json.loads(aprendizaje)["catalogo"], {k: referencia[k] for k in ("sha256", "bytes", "revision")}
        )
        puntero = (self.web / publicacion.RUTA_REFERENCIA).read_text()
        self.assertIn("export const APRENDIZAJE", puntero)
        self.assertIn(sha_aprendizaje, puntero)
        self.assertNotIn(str(self.caso.raiz), aprendizaje.decode())
        self.assertEqual(publicacion.publicar(self.caso.solicitud, web=self.web), referencia)
        self.assertEqual(
            huellas,
            {
                p.relative_to(self.web): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.web.rglob("*")
                if p.is_file()
            },
        )
        self.assertEqual(self.caso.base.read_bytes(), antes)

    def test_nueva_publicacion_retira_solo_generaciones_publicas_anteriores(self) -> None:
        """La entrega contiene una generación; la evidencia privada permanece intacta."""
        from dataclasses import replace

        anterior = publicacion.publicar(self.caso.solicitud, web=self.web)
        vieja = self.web / anterior["ruta"]
        aprendizajes = self.web / "datos/catalogo-aprendizaje"
        anterior_aprendizaje = next(aprendizajes.glob("*.json"))
        ajeno = aprendizajes / "README.md"
        ajeno.write_text("Un archivo ajeno no es una generación gestionada.\n")
        privada = self.caso.base.read_bytes()
        nueva = replace(self.caso.solicitud, area=self.caso.raiz / "Otra proyección", corte_utc="2026-10-22T10:45:00Z")
        publicacion.entrega.preparar(nueva)
        publicacion.entrega.validar(nueva)
        actual = publicacion.publicar(nueva, web=self.web)
        self.assertNotEqual(actual["ruta"], anterior["ruta"])
        self.assertFalse(vieja.exists())
        self.assertFalse(anterior_aprendizaje.exists())
        self.assertEqual(len(list((self.web / "datos/catalogo-cursos").glob("*.json"))), 1)
        self.assertEqual(len(list(aprendizajes.glob("*.json"))), 1)
        self.assertTrue(ajeno.is_file())
        self.assertEqual(self.caso.base.read_bytes(), privada)
        self.assertEqual(publicacion.publicar(nueva, web=self.web), actual)

    def test_limpieza_no_sigue_enlaces_hacia_evidencias(self) -> None:
        """Una generación enlazada detiene la limpieza sin tocar su destino."""
        publicacion.publicar(self.caso.solicitud, web=self.web)
        evidencia = self.caso.raiz / "evidencia-privada.txt"
        evidencia.write_bytes(b"hecho conservado")
        enlace = self.web / "datos/catalogo-cursos" / ("a" * 64 + ".json")
        enlace.symlink_to(evidencia)
        with self.assertRaises(ErrorEntregaCatalogo):
            publicacion.publicar(self.caso.solicitud, web=self.web)
        self.assertTrue(enlace.is_symlink())
        self.assertEqual(evidencia.read_bytes(), b"hecho conservado")

    def test_limpieza_interrumpida_se_completa_al_repetir(self) -> None:
        """Fallar tras el puntero no pierde la generación vigente ni bloquea el reintento."""
        from pathlib import Path

        referencia = publicacion.publicar(self.caso.solicitud, web=self.web)
        sobrante = self.web / "datos/catalogo-cursos" / ("a" * 64 + ".json")
        sobrante.write_text("{}")
        retirar = Path.unlink

        def fallar(archivo: Path, missing_ok: bool = False) -> None:
            if archivo == sobrante:
                raise OSError("Limpieza sintética interrumpida")
            retirar(archivo, missing_ok=missing_ok)

        with patch.object(Path, "unlink", fallar), self.assertRaises(OSError):
            publicacion.publicar(self.caso.solicitud, web=self.web)
        self.assertTrue((self.web / referencia["ruta"]).is_file())
        self.assertTrue(sobrante.is_file())
        self.assertEqual(publicacion.publicar(self.caso.solicitud, web=self.web), referencia)
        self.assertFalse(sobrante.exists())

    def test_fallo_de_exportacion_no_modifica_ultima_publicacion(self) -> None:
        """Un fallo anterior al puntero conserva exactamente la entrega anterior."""
        publicacion.publicar(self.caso.solicitud, web=self.web)
        antes = {p: p.read_bytes() for p in self.web.rglob("*") if p.is_file()}
        with (
            patch.object(publicacion.entrega, "exportar", side_effect=OSError("fallo sintético")),
            self.assertRaises(OSError),
        ):
            publicacion.publicar(self.caso.solicitud, web=self.web)
        self.assertEqual(antes, {p: p.read_bytes() for p in self.web.rglob("*") if p.is_file()})

    def test_rechaza_origen_adulterado_y_raiz_publica_con_privados(self) -> None:
        """Ninguna admisión adulterada o raíz con entradas privadas llega a la web."""
        with self.assertRaises(ErrorEntregaCatalogo):
            publicacion.publicar(self.caso.solicitud, web=self.caso.raiz)
        self.caso.base.write_bytes(self.caso.base.read_bytes() + b"alterado")
        with self.assertRaises(ErrorAdmisionCatalogo):
            publicacion.publicar(self.caso.solicitud, web=self.web)
        self.assertFalse((self.web / publicacion.RUTA_REFERENCIA).exists())

    def test_fallo_del_puntero_conserva_ultima_entrega_y_no_activa_asset_huerfano(self) -> None:
        """Un reemplazo fallido conserva el puntero anterior incluso con un recurso estático nuevo ya escrito."""
        from dataclasses import replace
        from pathlib import Path

        publicacion.publicar(self.caso.solicitud, web=self.web)
        puntero = self.web / publicacion.RUTA_REFERENCIA
        anterior = puntero.read_bytes(), puntero.stat().st_mtime_ns
        previas = {p: p.read_bytes() for p in (self.web / "datos").rglob("*.json")}
        nueva = replace(self.caso.solicitud, area=self.caso.raiz / "Otra proyección", corte_utc="2026-10-22T10:45:00Z")
        publicacion.entrega.preparar(nueva)
        publicacion.entrega.validar(nueva)
        reemplazar = Path.replace

        def fallar(origen: Path, destino: Path) -> Path:
            if destino == puntero:
                raise OSError("Reemplazo sintético rechazado")
            return reemplazar(origen, destino)

        with patch.object(Path, "replace", fallar), self.assertRaises(OSError):
            publicacion.publicar(nueva, web=self.web)
        self.assertEqual((puntero.read_bytes(), puntero.stat().st_mtime_ns), anterior)
        self.assertTrue(all(p.is_file() and p.read_bytes() == contenido for p, contenido in previas.items()))
        publicacion.publicar(nueva, web=self.web)
        self.assertEqual(len(list((self.web / "datos/catalogo-cursos").glob("*.json"))), 1)
        self.assertEqual(len(list((self.web / "datos/catalogo-aprendizaje").glob("*.json"))), 1)

    def test_fallo_de_aprendizaje_conserva_publicacion_y_sqlite(self) -> None:
        """No se activa una candidata si no puede generar su compañero consumido."""
        publicacion.publicar(self.caso.solicitud, web=self.web)
        antes = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.web.rglob("*") if p.is_file()}
        sqlite = self.caso.base.read_bytes()
        with (
            patch.object(publicacion, "generar_companero", side_effect=ValueError("Temario sintético rechazado")),
            self.assertRaises(ValueError),
        ):
            publicacion.publicar(self.caso.solicitud, web=self.web)
        self.assertEqual(antes, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.web.rglob("*") if p.is_file()})
        self.assertEqual(sqlite, self.caso.base.read_bytes())


class ModoDelCatalogoPublicado(ModoDeLoPublicado, unittest.TestCase):
    """El catálogo web publicado queda legible por otro usuario: 0666 menos la umask."""

    def escritores(self) -> dict[str, Callable[[Path, bytes], None]]:
        """Escritores propios del paquete cuya salida lee otro servicio.

        Returns:
            Cada escritor real por su nombre, con la firma (ruta, bytes).
        """
        return {"publicar_catalogo": publicacion._guardar}
