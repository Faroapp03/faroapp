"""La actualización entrega datos y recursos web de una misma versión o conserva la anterior."""

import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar, sustitucion
from plataforma_datos.orquestacion.pruebas.ayudas import Corte
from plataforma_datos.orquestacion.pruebas.test_actualizar import (
    PAQUETE_VIGENTE,
    EjecutorSimulado,
    coincide_paso,
    escribir_paquete,
)

RUTAS = ("datos", "web")
PASOS = (
    "plataforma_datos.orquestacion.publicar_globales",
    "globales:generar",
    "lecturas:generar",
    "informe:ejemplo",
    "web:preparar",
    "verificar:datos",
)


def escribir(raiz: Path, ruta: str, contenido: bytes) -> None:
    """Escribe exclusivamente en la instalación ficticia de la prueba."""
    destino = raiz / ruta
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(contenido)


def contenido(raiz: Path) -> dict[str, bytes]:
    """Captura datos y web, excluyendo informes operativos.

    Returns:
        Bytes de cada archivo, por ruta relativa al producto ficticio.
    """
    archivos = [archivo for carpeta in ("datos", "web") for archivo in (raiz / carpeta).rglob("*")]
    return {archivo.relative_to(raiz).as_posix(): archivo.read_bytes() for archivo in archivos if archivo.is_file()}


def posiciones_de_los_pasos(ordenes: list[list[str]]) -> list[int]:
    """Sitúa cada paso de `PASOS` en la lista de órdenes por su nombre de orden.

    Returns:
        El índice de la primera orden de cada paso, en el orden de `PASOS`.
    """
    return [next(i for i, orden in enumerate(ordenes) if coincide_paso(orden, paso)) for paso in PASOS]


class EjecutorConWeb(EjecutorSimulado):
    """Simula derivados que cambian al exportar; no reemplaza los ensayos de construcción real."""

    def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """Genera derivados ficticios al recibir sus órdenes.

        Returns:
            Resultado de la orden, incluido el fallo inyectado cuando corresponda.
        """
        resultado = super().__call__(orden, area)
        if resultado.codigo:
            return resultado
        if "plataforma_datos.orquestacion.publicar_globales" in orden:
            escribir(area, "datos/globales/datos-globales.json", b"global nuevo")
        if "globales:generar" in orden:
            escribir(area, "web/datos/datos-globales.json", b"global web nuevo")
        if "web:preparar" in orden:
            escribir(area, ".web-local/web/sw.js", b"version nueva")
        return resultado


class PruebaEntregaConjunta(unittest.TestCase):
    """La promoción no puede dar verde con datos nuevos y una web antigua."""

    def setUp(self) -> None:
        """Dos raíces aisladas, con espacios y acentos, y datos sintéticos pequeños."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        base = Path(temporal.name).resolve()
        self.raiz, self.area = base / "Mis documentos/Año 2026", base / "candidato"
        escribir_paquete(self.raiz / "datos", PAQUETE_VIGENTE)
        for ruta, texto in {
            "datos/globales/datos-globales.json": b"global anterior",
            "web/datos/datos-globales.json": b"global web anterior",
        }.items():
            escribir(self.raiz, ruta, texto)
        self.antes = contenido(self.raiz)
        self.nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}

    def ejecutar(self, fallo: str | None = None, ensayo: bool = False) -> tuple[int, EjecutorConWeb]:
        """Ejecuta el coordinador real con procesos sustituidos por el simulador.

        Returns:
            Código de salida y ejecutor con las órdenes observadas.
        """
        ejecutor = EjecutorConWeb(self.nuevo, falla_en=fallo)
        opciones = actualizar.Opciones(area=self.area, pausa=0, reintento=0, solo=(), ensayo=ensayo)
        with contextlib.redirect_stdout(io.StringIO()):
            codigo = actualizar.actualizar(self.raiz, opciones, ejecutor)
        return codigo, ejecutor

    def test_una_version_contiene_datos_y_web_nuevos_sin_la_web_construida(self) -> None:
        """Los consumidores reciben los bytes del paquete admitido; lo construido no se promueve."""
        codigo, ejecutor = self.ejecutar()
        self.assertEqual(codigo, 0)
        self.assertFalse((self.raiz / "web/paquete").exists())
        self.assertFalse((self.raiz / ".web-local").exists())
        posiciones = posiciones_de_los_pasos(ejecutor.ordenes)
        self.assertEqual(posiciones, sorted(posiciones))
        # El mismo recorrido con el intérprete en carpetas que se llaman como un paso.
        for trampa in ("/tmp/verificar/bin/python", "/tmp/web:preparar/python", "/tmp/globales:generar/python"):
            with self.subTest(interprete=trampa):
                ordenes = [
                    [trampa, *orden[1:]] if orden[0] == actualizar.PYTHON else orden for orden in ejecutor.ordenes
                ]
                self.assertEqual(posiciones_de_los_pasos(ordenes), posiciones)

    def test_fallo_de_cualquier_etapa_conserva_toda_la_version(self) -> None:
        """También un fallo del cotejo final impide sustituir datos y web."""
        for paso in PASOS:
            with self.subTest(paso=paso):
                shutil.rmtree(self.raiz)
                for ruta, datos in self.antes.items():
                    escribir(self.raiz, ruta, datos)
                codigo, _ = self.ejecutar(paso)
                self.assertEqual(codigo, actualizar.CODIGO_AMBAR)
                self.assertEqual(contenido(self.raiz), self.antes)

    def test_ensayo_no_promueve_ningun_componente(self) -> None:
        """Construir y comprobar en ensayo conserva la instalación completa."""
        codigo, _ = self.ejecutar(ensayo=True)
        self.assertEqual(codigo, 0)
        self.assertEqual(contenido(self.raiz), self.antes)

    def test_corte_entre_componentes_recupera_una_version_entera(self) -> None:
        """Un corte al promover cada componente se recupera con el coordinador real."""
        renombrar = Path.rename
        for objetivo in RUTAS:
            with self.subTest(objetivo=objetivo):
                shutil.copytree(self.raiz, self.area)
                for ruta in self.antes:
                    escribir(self.area, ruta, b"contenido nuevo")
                (self.raiz / sustitucion.CARPETA).mkdir(parents=True, exist_ok=True)

                def cortar(ruta: Path, destino: Path, objetivo: str = objetivo) -> Path:
                    if ruta == self.raiz / f"{objetivo}.nuevo":
                        raise Corte()
                    return renombrar(ruta, destino)

                with mock.patch.object(Path, "rename", cortar), self.assertRaises(Corte):
                    actualizar.publicar(self.raiz, self.area, "paquete", RUTAS, False)
                actualizar.recuperar_todo(self.raiz)
                self.assertEqual(contenido(self.raiz), self.antes)
                self.assertFalse(any(p.name.endswith((".nuevo", ".anterior")) for p in self.raiz.rglob("*")))
                shutil.rmtree(self.area)

    def test_un_cambio_de_un_solo_archivo_de_la_web_tambien_se_promueve(self) -> None:
        """La huella incluye cada archivo de una carpeta, no solamente su lista."""
        shutil.copytree(self.raiz, self.area)
        escribir(self.area, "web/datos/datos-globales.json", b"global web corregido")
        (self.raiz / sustitucion.CARPETA).mkdir(parents=True, exist_ok=True)
        resultado = actualizar.publicar(self.raiz, self.area, "paquete", RUTAS, False)
        self.assertTrue(resultado.publicado)
        self.assertEqual((self.raiz / "web/datos/datos-globales.json").read_bytes(), b"global web corregido")

    def test_diario_anterior_recupera_solo_las_rutas_que_declara(self) -> None:
        """Ampliar la entrega no autoriza a limpiar respaldos ajenos al diario anterior."""
        informes = self.raiz / sustitucion.CARPETA
        informes.mkdir(parents=True)
        (self.raiz / "datos").rename(self.raiz / "datos.anterior")
        escribir(self.raiz, "datos/nuevo.json", b"nuevo")
        escribir(self.raiz, "web.anterior/conservar.txt", b"ajeno al diario")
        (informes / actualizar.diario("paquete")).write_text(
            json.dumps({"fase": sustitucion.PREPARADO, "sustituidos": ["datos"]})
        )
        self.assertEqual(actualizar.recuperar_todo(self.raiz), ["paquete"])
        self.assertEqual(contenido(self.raiz), self.antes)
        self.assertEqual((self.raiz / "web.anterior/conservar.txt").read_bytes(), b"ajeno al diario")


if __name__ == "__main__":
    unittest.main()
