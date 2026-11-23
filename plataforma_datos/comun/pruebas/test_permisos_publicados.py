"""Lo que publica la cadena de datos queda legible por un servicio con otro usuario: 0666 menos la umask.

`tempfile.NamedTemporaryFile` crea siempre con 0600 y el renombrado lleva ese modo al archivo publicado. En macOS
con un solo usuario no se nota; en Linux, un servidor web o un Worker local con su propio usuario no podría leer
`datos/`, `web/`, los validados ni el estado del panel. Estas pruebas escriben con los escritores reales y miran
el modo; y una guardia estática impide que vuelva a aparecer un temporal 0600 fuera de lo que es privado a propósito.
"""

import os
import re
import stat
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path

from plataforma_datos.comun.fuentes.versiones_navegadores import lector as lector_versiones
from plataforma_datos.comun.nucleo import RAIZ

# Temporales con 0600 que se quedan así a propósito, con su motivo. Todo lo demás pasa por `temporal_hermano`.
PRIVADOS_A_PROPOSITO = {
    # Solicitud efímera para el adaptador de Cloudflare: la lee solo su proceso hijo y se borra al cerrarse.
    "plataforma_datos/orquestacion/adaptador_versiones.py",
    # Recibos del ejecutor privado (con secretos en su entorno): los lee el propio supervisor, nunca un servicio.
    "plataforma_datos/orquestacion/candidato.py",
    "plataforma_datos/orquestacion/ejecutor_operativo.py",
    # Objetos privados del almacén, en directorios de trabajo que pertenecen al job.
    "plataforma_datos/orquestacion/almacen_s3.py",
    # Objetos, intenciones y recibos de un ensayo privado fuera de la instalación servida.
    "plataforma_datos/orquestacion/almacen_de_ensayo.py",
    "plataforma_datos/orquestacion/simular_mantenimiento.py",
}
TEMPORAL_0600 = re.compile(r"\b(NamedTemporaryFile|mkstemp)\(")
UMASK_HABITUAL = 0o022
UMASK_ESTRICTA = 0o077


class ModoDeLoPublicado:
    """Comprueba que cada escritor real deja su archivo con 0666 menos la umask, no con el 0600 de `tempfile`.

    Cada paquete la combina con `unittest.TestCase` y define `escritores()` con sus propios escritores, de modo que
    ninguna prueba toca los de otro paquete.
    """

    escritores: Callable[[], dict[str, Callable[[Path, bytes], None]]]

    def setUp(self) -> None:
        """Fija la umask habitual de un servicio (022) y una carpeta propia; ambas se restauran al terminar."""
        self.umask_anterior = os.umask(UMASK_HABITUAL)
        self.addCleanup(os.umask, self.umask_anterior)
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.carpeta = Path(carpeta.name)

    def modo(self, ruta: Path) -> int:
        """Permisos de un archivo, sin el tipo.

        Returns:
            Los bits de permiso, como 0o644.
        """
        return stat.S_IMODE(ruta.stat().st_mode)

    def test_con_la_umask_habitual_queda_legible_por_otro_usuario(self) -> None:
        """Con umask 022, lo escrito queda en 0644: el servicio lo lee aunque sea otro usuario."""
        for nombre, escribir in self.escritores().items():
            with self.subTest(nombre):
                ruta = self.carpeta / f"{nombre}.json"
                escribir(ruta, b'{"ok":true}')
                self.assertEqual(ruta.read_bytes(), b'{"ok":true}')
                self.assertEqual(oct(self.modo(ruta)), oct(0o644))

    def test_respeta_una_umask_estricta(self) -> None:
        """Con umask 077, queda en 0600: quien despliega puede seguir restringiéndolo con la umask."""
        os.umask(UMASK_ESTRICTA)
        for nombre, escribir in self.escritores().items():
            with self.subTest(nombre):
                ruta = self.carpeta / f"{nombre}.json"
                escribir(ruta, b"{}")
                self.assertEqual(oct(self.modo(ruta)), oct(0o600))


class ModoDeLoPublicadoEnComun(ModoDeLoPublicado, unittest.TestCase):
    """Escritores de Común: las versiones de navegadores, y el temporal común que usan todos."""

    def escritores(self) -> dict[str, Callable[[Path, bytes], None]]:
        """Escritores de Común cuya salida lee otro servicio.

        Returns:
            Cada escritor real por su nombre, con la firma (ruta, bytes).
        """
        return {"versiones_navegadores": lector_versiones._inmutable}

    def test_el_temporal_comun_no_pisa_ni_sigue_enlaces(self) -> None:
        """El temporal común nace junto al destino, con nombre al azar, en exclusiva y sin seguir enlaces."""
        from plataforma_datos.comun.entrada_salida import temporal_hermano

        with temporal_hermano(self.carpeta, prefijo=".prueba-", sufijo=".tmp") as archivo:
            archivo.write(b"x")
        ruta = Path(archivo.name)
        self.assertEqual(ruta.parent, self.carpeta)
        self.assertRegex(ruta.name, r"^\.prueba-[a-z0-9_]{8}\.tmp$")
        self.assertEqual(oct(self.modo(ruta)), oct(0o644))
        # Creación exclusiva: un nombre ocupado (también por un enlace) nunca se abre; se prueba otro.
        enlace = self.carpeta / "enlace"
        enlace.symlink_to(self.carpeta / "fuera")
        with temporal_hermano(self.carpeta, prefijo="enlace", sufijo="") as otro:
            self.assertNotEqual(Path(otro.name), enlace)
        self.assertFalse((self.carpeta / "fuera").exists())


class SinTemporalesPrivadosEnLoPublicado(unittest.TestCase):
    """Ningún módulo de la cadena crea temporales 0600 salvo los privados a propósito, con su motivo."""

    def test_solo_los_privados_usan_tempfile_para_escribir(self) -> None:
        """Cualquier `NamedTemporaryFile` o `mkstemp` nuevo fuera de la lista de privados hace fallar la prueba."""
        encontrados = set()
        for ruta in sorted((RAIZ / "plataforma_datos").rglob("*.py")):
            relativa = ruta.relative_to(RAIZ).as_posix()
            if "/pruebas/" in relativa:
                continue
            if TEMPORAL_0600.search(ruta.read_text(encoding="utf-8")):
                encontrados.add(relativa)
        self.assertEqual(sorted(encontrados - PRIVADOS_A_PROPOSITO), [])
        # Una excepción que ya no usa tempfile sobra: la lista no guarda motivos de algo que no existe.
        self.assertEqual(sorted(PRIVADOS_A_PROPOSITO - encontrados), [])


if __name__ == "__main__":
    unittest.main()
