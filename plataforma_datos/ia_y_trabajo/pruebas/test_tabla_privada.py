"""La tabla privada de la Cambra se comprueba por la huella del manifiesto y se recupera del almacén sin sustituirla.

El manifiesto fija la tabla como origen de la parte pública (`exposicion-cambra.json`), que lleva su propia huella.
"""

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.cambra.tabla_privada as tabla

# Datos sintéticos con la forma de la tabla: ninguna cifra es del estudio.
SINTETICA = json.dumps({"fuente": "Sintética", "ocupaciones_cno3": {"999": {"nivel": 3}}}).encode("utf-8")
HUELLA_DE_LA_PARTE_PUBLICA = "0" * 64


def _instalacion(raiz: Path, contenido: bytes | None, huella: str | None = None) -> None:
    (raiz / "datos").mkdir()
    fijada = huella or hashlib.sha256(SINTETICA).hexdigest()
    entrada = {"origenes": {tabla.ORIGEN: fijada}, "sha256": HUELLA_DE_LA_PARTE_PUBLICA}
    (raiz / tabla.MANIFIESTO).write_text(json.dumps({tabla.ARCHIVO_PUBLICO: entrada}), encoding="utf-8")
    if contenido is not None:
        (raiz / tabla.RUTA).write_bytes(contenido)


class AlmacenSimulado:
    """Hace de almacén: entrega los bytes de un blob por su clave y registra lo que se le pide."""

    def __init__(self, blobs: dict[str, bytes]) -> None:
        self.blobs = blobs
        self.pedidos: list[tuple[str, str, int]] = []

    def __enter__(self) -> "AlmacenSimulado":
        return self

    def __exit__(self, *_error: object) -> None:
        return None

    def recuperar(self, clave: str, destino: Path, sha256: str, bytes_maximos: int) -> None:
        """Escribe el blob pedido en su destino, como el almacén real tras cotejarlo."""
        self.pedidos.append((clave, sha256, bytes_maximos))
        destino.write_bytes(self.blobs[clave])


class PruebaTablaPrivada(unittest.TestCase):
    """Presente y correcta, todo igual; ausente o distinta, un fallo que dice qué falta y cómo obtenerlo."""

    def setUp(self) -> None:
        """Cada prueba tiene su instalación en una carpeta nueva."""
        self.carpeta = tempfile.TemporaryDirectory()
        self.raiz = Path(self.carpeta.name)

    def tearDown(self) -> None:
        """Retira la carpeta de la prueba."""
        self.carpeta.cleanup()

    def test_la_tabla_fijada_se_lee_tal_cual(self) -> None:
        """Con la tabla que fija el manifiesto, se lee igual que hoy."""
        _instalacion(self.raiz, SINTETICA)
        self.assertEqual(tabla.leer(self.raiz), json.loads(SINTETICA))

    def test_sin_la_tabla_el_fallo_nombra_el_archivo_y_como_obtenerlo(self) -> None:
        """Sin el archivo, el fallo dice cuál falta, que tampoco está el validado y con qué orden se obtiene."""
        _instalacion(self.raiz, None)
        with self.assertRaises(tabla.TablaPrivadaAusente) as error:
            tabla.leer(self.raiz)
        self.assertIn("Falta datos/cambra.json", str(error.exception))
        self.assertIn(f"tampoco está su conjunto validado ({tabla.ORIGEN})", str(error.exception))
        self.assertIn("tabla_privada recuperar", str(error.exception))

    def test_una_tabla_con_otra_huella_se_rechaza(self) -> None:
        """Un solo byte distinto basta para rechazarla."""
        _instalacion(self.raiz, SINTETICA + b" ")
        with self.assertRaises(tabla.TablaPrivadaDistinta) as error:
            tabla.comprobar(self.raiz)
        self.assertIn("no es la tabla que fija datos/manifiesto.json", str(error.exception))

    def _validado(self, contenido: bytes) -> Path:
        ruta = self.raiz / tabla.ORIGEN
        ruta.parent.mkdir(parents=True)
        ruta.write_bytes(contenido)
        return ruta

    def test_en_el_ciclo_basta_el_conjunto_validado(self) -> None:
        """Donde la cadena acaba de admitir la tabla no hay copia aparte: vale su conjunto validado, por su huella."""
        _instalacion(self.raiz, None)
        validado = self._validado(SINTETICA)
        self.assertEqual(tabla.comprobar(self.raiz), validado)
        self.assertEqual(tabla.leer(self.raiz), json.loads(SINTETICA))

    def test_un_conjunto_validado_con_otra_huella_no_vale(self) -> None:
        """El conjunto validado no se acepta por estar ahí: tiene que ser el que fija el manifiesto."""
        _instalacion(self.raiz, None)
        self._validado(SINTETICA + b" ")
        with self.assertRaises(tabla.TablaPrivadaDistinta):
            tabla.comprobar(self.raiz)

    def test_una_copia_vieja_no_estorba_si_el_conjunto_validado_es_el_fijado(self) -> None:
        """Con una copia que quedó de otra versión y el conjunto validado vigente, se usa el vigente."""
        _instalacion(self.raiz, SINTETICA + b" ")
        validado = self._validado(SINTETICA)
        self.assertEqual(tabla.comprobar(self.raiz), validado)

    def test_si_ninguna_de_las_dos_es_la_fijada_el_fallo_nombra_las_dos(self) -> None:
        """Con la copia y el conjunto validado presentes y los dos distintos, el motivo nombra ambos."""
        _instalacion(self.raiz, SINTETICA + b" ")
        self._validado(SINTETICA + b"  ")
        with self.assertRaises(tabla.TablaPrivadaDistinta) as error:
            tabla.comprobar(self.raiz)
        self.assertIn(f"datos/cambra.json ni {tabla.ORIGEN} no son la tabla que fija", str(error.exception))

    def _cli(self, *argumentos: str) -> tuple[int, str, str]:
        salida, errores = io.StringIO(), io.StringIO()
        with redirect_stdout(salida), redirect_stderr(errores):
            codigo = tabla.main([*argumentos, "--raiz", str(self.raiz)])
        return codigo, salida.getvalue(), errores.getvalue()

    def test_la_orden_ruta_da_solo_la_ruta_comprobada(self) -> None:
        """Las pruebas de Node leen la tabla por esta orden: una línea con la ruta, relativa a la instalación."""
        _instalacion(self.raiz, SINTETICA)
        self.assertEqual(self._cli("ruta"), (0, "datos/cambra.json\n", ""))
        (self.raiz / tabla.RUTA).unlink()
        self._validado(SINTETICA)
        self.assertEqual(self._cli("ruta"), (0, f"{tabla.ORIGEN}\n", ""))
        self.assertEqual(self._cli("comprobar")[1], f"{tabla.ORIGEN}: es la tabla fijada por datos/manifiesto.json.\n")

    def test_la_orden_ruta_sin_tabla_falla_con_el_motivo(self) -> None:
        """Sin tabla en ningún sitio no escribe ninguna ruta: sale con uno y el motivo."""
        _instalacion(self.raiz, None)
        codigo, salida, errores = self._cli("ruta")
        self.assertEqual((codigo, salida), (1, ""))
        self.assertIn("Falta datos/cambra.json", errores)
        self.assertIn(tabla.ORIGEN, errores)

    def test_la_huella_fijada_es_la_del_origen_de_la_parte_publica(self) -> None:
        """La tabla es el origen de la parte pública; la huella de la parte pública no la fija."""
        _instalacion(self.raiz, None)
        self.assertEqual(tabla.huella_fijada(self.raiz), hashlib.sha256(SINTETICA).hexdigest())
        manifiesto = {tabla.ARCHIVO: {"sha256": hashlib.sha256(SINTETICA).hexdigest()}}
        (self.raiz / tabla.MANIFIESTO).write_text(json.dumps(manifiesto), encoding="utf-8")
        with self.assertRaises(tabla.ErrorFuente):
            tabla.huella_fijada(self.raiz)

    def test_un_manifiesto_sin_huella_valida_no_admite_ninguna_tabla(self) -> None:
        """Sin una huella de 64 cifras hexadecimales no hay con qué comprobarla."""
        _instalacion(self.raiz, SINTETICA, huella="no-es-una-huella")
        with self.assertRaises(tabla.ErrorFuente):
            tabla.comprobar(self.raiz)

    def test_recuperar_pide_el_blob_de_la_huella_fijada_y_lo_comprueba(self) -> None:
        """La clave es la del contenido fijado y la configuración sale solo del entorno recibido."""
        _instalacion(self.raiz, None)
        huella = hashlib.sha256(SINTETICA).hexdigest()
        almacen = AlmacenSimulado({f"blobs/{huella}": SINTETICA})
        with (
            mock.patch.object(tabla, "AlmacenS3", return_value=almacen),
            mock.patch.object(tabla, "configuracion_privada") as configuracion,
        ):
            tabla.recuperar(self.raiz, {"FARO_ALMACEN_S3": "{}"})
        configuracion.assert_called_once_with({"FARO_ALMACEN_S3": "{}"})
        self.assertEqual(almacen.pedidos, [(f"blobs/{huella}", huella, tabla.MAX_BYTES)])
        self.assertEqual((self.raiz / tabla.RUTA).read_bytes(), SINTETICA)

    def test_recuperar_no_toca_el_almacen_si_la_tabla_fijada_ya_esta(self) -> None:
        """Una instalación que ya la tiene no hace ninguna petición."""
        _instalacion(self.raiz, SINTETICA)
        with mock.patch.object(tabla, "AlmacenS3") as almacen:
            tabla.recuperar(self.raiz, {})
        almacen.assert_not_called()

    def test_recuperar_no_sustituye_una_tabla_distinta(self) -> None:
        """Una tabla con otra huella se rechaza y se deja como estaba."""
        _instalacion(self.raiz, b"{}")
        with mock.patch.object(tabla, "AlmacenS3") as almacen, self.assertRaises(tabla.TablaPrivadaDistinta):
            tabla.recuperar(self.raiz, {})
        almacen.assert_not_called()
        self.assertEqual((self.raiz / tabla.RUTA).read_bytes(), b"{}")

    def test_la_cli_falla_con_el_motivo_y_sin_imprimir_la_tabla(self) -> None:
        """La orden explica el motivo y no vuelca el contenido."""
        _instalacion(self.raiz, SINTETICA + b" ")
        errores = io.StringIO()
        with mock.patch.object(tabla, "RAIZ", self.raiz), redirect_stderr(errores):
            self.assertEqual(tabla.main(["comprobar"]), 1)
        self.assertIn("su huella es otra", errores.getvalue())
        self.assertNotIn("Sintética", errores.getvalue())

    def test_un_almacen_que_falla_da_un_mensaje_sin_secretos(self) -> None:
        """El fallo del almacén da un mensaje fijo, sin el texto de la excepción."""
        _instalacion(self.raiz, None)
        errores = io.StringIO()
        with (
            mock.patch.object(tabla, "RAIZ", self.raiz),
            mock.patch.object(tabla, "configuracion_privada", side_effect=ValueError("secreto-sintetico")),
            redirect_stderr(errores),
        ):
            self.assertEqual(tabla.main(["recuperar"]), 1)
        self.assertEqual(errores.getvalue().strip(), tabla.ERROR_ALMACEN)


if __name__ == "__main__":
    unittest.main()
