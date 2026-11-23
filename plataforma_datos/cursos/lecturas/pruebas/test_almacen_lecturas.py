"""El almacén de lecturas: archivos inmutables por lectura y una lista ordenada que valida cada archivo."""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.lecturas import contrato_lectura as contrato
from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas, guardar_lectura, listar_lecturas
from plataforma_datos.cursos.lecturas.contrato_lectura import ErrorLectura
from plataforma_datos.cursos.lecturas.pruebas import ejemplos


class AlmacenLecturasPruebas(unittest.TestCase):
    """Cada prueba trabaja en una instalación temporal propia; nada toca la instalación real."""

    def setUp(self) -> None:
        """Una raíz vacía en una carpeta temporal."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Instalación ñ"
        self.raiz.mkdir()

    def test_guarda_en_la_carpeta_de_la_fuente_con_bytes_canonicos(self) -> None:
        """La lectura queda en `validados/<fuente>/lecturas/<lectura_id>.json`, tal como la serializa el contrato."""
        lectura = ejemplos.primera()
        ruta = guardar_lectura(self.raiz, lectura)
        relativa = ruta.relative_to(self.raiz).as_posix()
        self.assertEqual(
            relativa, f"var/actualizacion/validados/barcelonactiva/lecturas/{lectura.a_json()['lectura_id']}.json"
        )
        self.assertEqual(ruta.read_bytes(), contrato.bytes_de(lectura.a_json()))

    def test_guardar_dos_veces_la_misma_lectura_es_inocuo(self) -> None:
        """La segunda escritura no cambia el archivo ni crea otro."""
        ruta = guardar_lectura(self.raiz, ejemplos.primera())
        antes = ruta.stat().st_mtime_ns
        self.assertEqual(guardar_lectura(self.raiz, ejemplos.primera()), ruta)
        self.assertEqual(ruta.stat().st_mtime_ns, antes)
        self.assertEqual([p.name for p in ruta.parent.iterdir()], [ruta.name])

    def test_otro_veredicto_para_la_misma_observacion_es_un_error(self) -> None:
        """Lo observado ya tiene su veredicto: otro contenido con el mismo identificador no lo sustituye."""
        ruta = guardar_lectura(self.raiz, ejemplos.segunda())
        original = ruta.read_bytes()
        anomala = ejemplos.segunda(estado="anomala", motivos=("forma_cambiada",))
        with self.assertRaisesRegex(ErrorLectura, "una lectura guardada no cambia"):
            guardar_lectura(self.raiz, anomala)
        self.assertEqual(ruta.read_bytes(), original)

    def test_lista_en_orden_de_observacion(self) -> None:
        """La lista va de la más antigua a la más reciente, sea cual sea el orden en que se guardaron."""
        self.assertEqual(listar_lecturas(self.raiz, ejemplos.FUENTE), [])
        guardar_lectura(self.raiz, ejemplos.segunda())
        guardar_lectura(self.raiz, ejemplos.primera())
        lecturas = listar_lecturas(self.raiz, ejemplos.FUENTE)
        self.assertEqual(lecturas, [ejemplos.primera().a_json(), ejemplos.segunda().a_json()])
        self.assertEqual(lecturas[1]["anterior"], lecturas[0]["lectura_id"])

    def test_lista_rechaza_archivos_que_no_son_lecturas_de_la_fuente(self) -> None:
        """Un nombre ajeno, un archivo con el nombre de otra lectura o una lectura de otra fuente no pasan."""
        ruta = guardar_lectura(self.raiz, ejemplos.primera())
        carpeta = ruta.parent
        ajeno = carpeta / "notas.json"
        ajeno.write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(ErrorLectura, "no es el nombre de una lectura"):
            listar_lecturas(self.raiz, ejemplos.FUENTE)
        ajeno.unlink()
        cambiada = carpeta / f"{'0' * 64}.json"
        cambiada.write_bytes(ruta.read_bytes())
        with self.assertRaisesRegex(ErrorLectura, "guarda otra lectura"):
            listar_lecturas(self.raiz, ejemplos.FUENTE)
        cambiada.unlink()
        otra = carpeta_de_lecturas(self.raiz, "fundae")
        otra.mkdir(parents=True)
        (otra / ruta.name).write_bytes(ruta.read_bytes())
        with self.assertRaisesRegex(ErrorLectura, "lectura de otra fuente"):
            listar_lecturas(self.raiz, "fundae")

    def test_temporal_de_una_escritura_cortada_no_es_una_lectura(self) -> None:
        """El temporal que deja un corte en seco no se lista; lo guardado entero, sí."""
        ruta = guardar_lectura(self.raiz, ejemplos.primera())
        (ruta.parent / f".{ruta.name}.a1b2c3d4.parcial").write_bytes(b'{"version":')
        self.assertEqual(listar_lecturas(self.raiz, ejemplos.FUENTE), [ejemplos.primera().a_json()])

    def test_fuente_que_no_es_un_nombre_de_carpeta_se_rechaza(self) -> None:
        """El nombre de la fuente forma una ruta: nada de subir de carpeta ni de mayúsculas."""
        for fuente in ("../fundae", "Fundae", ""):
            with self.subTest(fuente=fuente), self.assertRaisesRegex(ErrorLectura, "fuente no admitida"):
                carpeta_de_lecturas(self.raiz, fuente)


if __name__ == "__main__":
    unittest.main()
