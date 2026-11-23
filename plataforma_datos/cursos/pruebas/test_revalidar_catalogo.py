"""Un cambio del código que admite el catálogo exige repetir su auditoría antes de que las fuentes lo lean."""

import contextlib
import hashlib
import io
import unittest
from unittest import mock

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import revalidar_catalogo
from plataforma_datos.cursos.auditoria_snapshot_catalogo import ErrorAdmisionCatalogo
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as fixtures


def _sha(ruta: object) -> str:
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


class RevalidarCatalogoPruebas(unittest.TestCase):
    """Catálogo instalado real (SQLite y evidencias sintéticas, sin red) en una raíz temporal."""

    def setUp(self) -> None:
        """Instala un catálogo admitido en la ruta que leen las fuentes."""
        self.caso = fixtures.ActualizacionHpLifePruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        hp.preparar(self.caso.solicitud)
        entrada = hp.solicitud_admision(self.caso.solicitud.area)
        self.raiz = self.caso.raiz
        self.area = self.raiz / almacen.RUTA
        almacen.conservar(
            almacen.EntradaCatalogo(admision=entrada, sha256_admision=self.caso.ref(entrada.validacion_destino).sha256),
            destino=self.area,
        )
        self.firma = admision.firma_codigo()
        # Otro código: la misma firma con una huella cambiada, como tras corregir un módulo de la admisión.
        primero = next(iter(self.firma))
        self.firma_nueva = {**self.firma, primero: "0" * 64}

    def exigir(self) -> None:
        """Lee el catálogo como lo leen las fuentes."""
        solicitud = almacen.solicitud(self.area)
        admision.exigir_snapshot_admitido(solicitud, sha256_validacion=_sha(solicitud.validacion_destino))

    def test_sin_catalogo_instalado_no_hace_nada(self) -> None:
        """Sin admisión instalada no inventa una: las fuentes siguen fallando con su motivo."""
        (self.area / "validacion.json").unlink()
        self.assertIn("nada que revalidar", revalidar_catalogo.revalidar(self.raiz))
        self.assertFalse((self.area / "validacion.json").exists())

    def test_con_el_mismo_codigo_no_reescribe_el_informe(self) -> None:
        """Al día: ni repite la auditoría ni toca el informe."""
        antes = (self.area / "validacion.json").read_bytes()
        with mock.patch.object(admision, "admitir_snapshot") as admitir:
            self.assertIn("código vigente", revalidar_catalogo.revalidar(self.raiz))
        admitir.assert_not_called()
        self.assertEqual((self.area / "validacion.json").read_bytes(), antes)

    def test_un_codigo_nuevo_bloquea_la_lectura_y_la_revalidacion_la_restablece_sin_tocar_el_snapshot(self) -> None:
        """El defecto: con otro código las fuentes no pueden leer; tras revalidar sí, con la misma instantánea."""
        snapshot = almacen.solicitud(self.area).snapshot.ruta
        antes = _sha(snapshot)
        with mock.patch.object(admision, "firma_codigo", return_value=self.firma_nueva):
            with self.assertRaisesRegex(ErrorAdmisionCatalogo, "Contrato o vínculos del informe incompatibles"):
                self.exigir()
            self.assertIn("revalidado", revalidar_catalogo.revalidar(self.raiz))
            self.exigir()
            self.assertIn("código vigente", revalidar_catalogo.revalidar(self.raiz))
        self.assertEqual(_sha(snapshot), antes)

    def test_un_snapshot_alterado_no_se_revalida(self) -> None:
        """La revalidación repite la auditoría: no acepta por herencia un catálogo que ya no la supera."""
        snapshot = almacen.solicitud(self.area).snapshot.ruta
        snapshot.write_bytes(snapshot.read_bytes() + b"alterado")
        with mock.patch.object(admision, "firma_codigo", return_value=self.firma_nueva):
            with self.assertRaises((ErrorAdmisionCatalogo, ValueError)):
                revalidar_catalogo.revalidar(self.raiz)
            with self.assertRaises((ErrorAdmisionCatalogo, ValueError)):
                self.exigir()

    def test_la_orden_explica_una_auditoria_fallida_en_una_linea_sin_traza(self) -> None:
        """Quien ejecuta la orden ve «Error: <motivo>» y el código 1, no una traza de Python."""
        snapshot = almacen.solicitud(self.area).snapshot.ruta
        snapshot.write_bytes(snapshot.read_bytes() + b"alterado")
        original = revalidar_catalogo.revalidar
        salida, errores = io.StringIO(), io.StringIO()
        with (
            mock.patch.object(admision, "firma_codigo", return_value=self.firma_nueva),
            mock.patch.object(revalidar_catalogo, "revalidar", lambda: original(self.raiz)),
            contextlib.redirect_stdout(salida),
            contextlib.redirect_stderr(errores),
        ):
            codigo = revalidar_catalogo.main()
        self.assertEqual(codigo, 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertRegex(
            errores.getvalue(), r"^Error: El catálogo de Cursos no supera la auditoría con el código vigente"
        )
        self.assertIn("Archivo alterado respecto a su SHA256 esperado", errores.getvalue())
        self.assertEqual(errores.getvalue().count("\n"), 1)
        self.assertNotIn("Traceback", errores.getvalue())

    def huellas(self) -> dict[str, str]:
        """Las huellas de todos los archivos del catálogo instalado.

        Returns:
            La huella de cada archivo, por su ruta relativa al catálogo.
        """
        return {p.relative_to(self.area).as_posix(): _sha(p) for p in sorted(self.area.rglob("*")) if p.is_file()}

    def orden(self, *parches: contextlib.AbstractContextManager[object]) -> tuple[int, str]:
        """Ejecuta la orden sobre el catálogo de la prueba y exige una sola línea «Error: …» sin traza.

        Returns:
            El código de salida y lo escrito en stderr.
        """
        original = revalidar_catalogo.revalidar
        salida, errores = io.StringIO(), io.StringIO()
        with contextlib.ExitStack() as pila:
            for parche in parches:
                pila.enter_context(parche)
            pila.enter_context(mock.patch.object(revalidar_catalogo, "revalidar", lambda: original(self.raiz)))
            pila.enter_context(contextlib.redirect_stdout(salida))
            pila.enter_context(contextlib.redirect_stderr(errores))
            codigo = revalidar_catalogo.main()
        self.assertEqual(salida.getvalue(), "")
        self.assertTrue(errores.getvalue().startswith("Error: "), errores.getvalue())
        self.assertEqual(errores.getvalue().count("\n"), 1, errores.getvalue())
        self.assertNotIn("Traceback", errores.getvalue())
        return codigo, errores.getvalue()

    def test_un_informe_que_no_es_un_objeto_json_utf8_se_explica_sin_traza_ni_cambios(self) -> None:
        """JSON válido que no es un objeto, o bytes que no son UTF-8: «Error: …», código 1 y ningún archivo cambiado."""
        informe = self.area / "validacion.json"
        for contenido in (b"[]", b'"texto"', b'{"codigo_sha256": "\xe9"}', b"\xff\xfe\x00"):
            with self.subTest(contenido=contenido):
                informe.write_bytes(contenido)
                antes = self.huellas()
                codigo, errores = self.orden()
                self.assertEqual(codigo, 1)
                self.assertIn("no es un objeto JSON en UTF-8", errores)
                self.assertEqual(self.huellas(), antes)

    def test_una_auditoria_fallida_antes_de_escribir_no_cambia_ningun_archivo(self) -> None:
        """El rechazo de la auditoría llega antes de reemplazar el informe: el catálogo instalado queda igual."""
        snapshot = almacen.solicitud(self.area).snapshot.ruta
        snapshot.write_bytes(snapshot.read_bytes() + b"alterado")
        antes = self.huellas()
        codigo, errores = self.orden(mock.patch.object(admision, "firma_codigo", return_value=self.firma_nueva))
        self.assertEqual(codigo, 1)
        self.assertIn("no supera la auditoría con el código vigente", errores)
        self.assertEqual(self.huellas(), antes)

    def test_un_fallo_tras_reescribir_el_informe_lo_dice_y_la_lectura_sigue_rechazando(self) -> None:
        """Si el código cambia durante la revalidación, solo cambia validacion.json y el catálogo sigue sin admitir."""
        otra_firma = {**self.firma, next(iter(self.firma)): "1" * 64}
        firmas = {"vigente": self.firma_nueva}
        admitir = admision.admitir_snapshot

        def admitir_y_cambiar_el_codigo(solicitud: admision.SolicitudAdmision) -> object:
            informe = admitir(solicitud)
            firmas["vigente"] = otra_firma
            return informe

        antes = self.huellas()
        codigo, errores = self.orden(
            mock.patch.object(admision, "firma_codigo", side_effect=lambda: firmas["vigente"]),
            mock.patch.object(admision, "admitir_snapshot", admitir_y_cambiar_el_codigo),
        )
        self.assertEqual(codigo, 1)
        self.assertIn("ya se reescribió", errores)
        self.assertIn("sigue sin admitir", errores)
        self.assertIn("su lectura lo sigue rechazando", errores)
        despues = self.huellas()
        self.assertEqual({n for n in despues if despues[n] != antes.get(n)}, {"validacion.json"})
        self.assertEqual(set(despues), set(antes))
        with (
            mock.patch.object(admision, "firma_codigo", return_value=otra_firma),
            self.assertRaisesRegex(ErrorAdmisionCatalogo, "Contrato o vínculos del informe incompatibles"),
        ):
            self.exigir()

    def test_una_instantanea_cambiada_durante_la_revalidacion_lo_dice_sin_afirmar_que_se_rechaza(self) -> None:
        """Otro escritor cambia la instantánea tras auditarla: la orden falla, dice qué se reescribió y pide repetir."""
        admitir = admision.admitir_snapshot

        def admitir_y_cambiar_la_instantanea(solicitud: admision.SolicitudAdmision) -> object:
            informe = admitir(solicitud)
            solicitud.snapshot.ruta.write_bytes(solicitud.snapshot.ruta.read_bytes() + b"otro escritor")
            return informe

        codigo, errores = self.orden(
            mock.patch.object(admision, "firma_codigo", return_value=self.firma_nueva),
            mock.patch.object(admision, "admitir_snapshot", admitir_y_cambiar_la_instantanea),
            mock.patch.object(admision, "exigir_snapshot_admitido"),
        )
        self.assertEqual(codigo, 1)
        self.assertIn("su instantánea cambió durante la revalidación", errores)
        self.assertIn("ya se reescribió para la instantánea que se auditó", errores)
        self.assertNotIn("sigue sin admitir", errores)


if __name__ == "__main__":
    unittest.main()
