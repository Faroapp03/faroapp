"""La emisión de lecturas: encadena, califica y guarda siempre, también cuando el almacén o la cadena fallan."""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.lecturas.aceptaciones import Aceptacion, guardar_aceptacion
from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas, guardar_lectura, listar_lecturas
from plataforma_datos.cursos.lecturas.cadena import referencia
from plataforma_datos.cursos.lecturas.emision import Censo, ErrorEmision, emitir_lectura
from plataforma_datos.cursos.lecturas.pruebas import ejemplos

FUENTE, AMBITO = "cibervoluntarios", "catalogo"
NUEVE = frozenset(f"cv:{n}" for n in range(1, 10))
CAMPOS = ("id", "titulo", "estado")
OTROS_CAMPOS = ("id", "titulo", "estado", "modalidad")


def censo(observado: str, ids: frozenset[str], **cambios: object) -> Censo:
    """Un censo completo de Cibervoluntarios donde nada explica las salidas salvo lo que se pida.

    Returns:
        El censo, con los campos cambiados que se pidan.
    """
    datos = {
        "fuente": FUENTE,
        "ambito": AMBITO,
        "observado_utc": observado,
        "completa": True,
        "ids": ids,
        "recuento_bruto": len(ids),
        "recuento_vigente": len(ids),
        "rutas_de_campos": CAMPOS,
        "explicar_salida": lambda _curso: None,
    }
    return Censo(**{**datos, **cambios})


class EmisionPruebas(unittest.TestCase):
    """Cada prueba emite en una instalación temporal propia; sin red ni reloj."""

    def setUp(self) -> None:
        """Una raíz vacía en una carpeta temporal."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Instalación"
        self.raiz.mkdir()

    def emitir(self, *args: object, **cambios: object) -> dict:
        """Emite un censo y exige que no haya problemas.

        Returns:
            La lectura emitida.
        """
        emision = emitir_lectura(self.raiz, censo(*args, **cambios))
        self.assertEqual(emision.problemas, ())
        return emision.lectura

    def test_la_primera_lectura_lista_su_censo_y_la_segunda_encadena(self) -> None:
        """La primera no tiene anterior; la segunda calcula entradas y salidas y explica cada salida."""
        primera = self.emitir("2026-11-15T05:00:00Z", NUEVE)
        self.assertIsNone(primera["anterior"])
        self.assertEqual(primera["entradas"], sorted(NUEVE))
        self.assertEqual(primera["estado"], "sana")
        explicaciones = {"cv:1": "fin_publicado", "cv:2": "fuente_declara_baja"}
        segunda = self.emitir(
            "2026-11-16T05:00:00Z",
            (NUEVE - {"cv:1", "cv:2", "cv:3"}) | {"cv:10"},
            explicar_salida=explicaciones.get,
        )
        self.assertEqual(segunda["anterior"], primera["lectura_id"])
        self.assertEqual(segunda["entradas"], ["cv:10"])
        self.assertEqual(
            segunda["salidas"],
            [
                {"id": "cv:1", "explicada_por": "fin_publicado"},
                {"id": "cv:2", "explicada_por": "fuente_declara_baja"},
                {"id": "cv:3", "explicada_por": None},
            ],
        )
        self.assertEqual(segunda["estado"], "sana")
        self.assertEqual(listar_lecturas(self.raiz, FUENTE), [primera, segunda])

    def test_emitir_dos_veces_el_mismo_censo_no_cambia_nada(self) -> None:
        """La misma observación da la misma lectura y el mismo archivo."""
        una = emitir_lectura(self.raiz, censo("2026-11-15T05:00:00Z", NUEVE))
        otra = emitir_lectura(self.raiz, censo("2026-11-15T05:00:00Z", NUEVE))
        self.assertEqual((una.lectura, una.ruta), (otra.lectura, otra.ruta))
        self.assertEqual(len(listar_lecturas(self.raiz, FUENTE)), 1)

    def test_un_dia_malo_tambien_queda_registrado(self) -> None:
        """Cuatro salidas sin explicar de nueve dan una lectura anómala, guardada; un corte da una incompleta."""
        self.emitir("2026-11-15T05:00:00Z", NUEVE)
        anomala = self.emitir("2026-11-16T05:00:00Z", NUEVE - {"cv:1", "cv:2", "cv:3", "cv:4"})
        self.assertEqual((anomala["estado"], anomala["motivos"]), ("anomala", ["salidas_no_explicadas_en_bloque"]))
        incompleta = self.emitir(
            "2026-11-17T05:00:00Z", frozenset({"cv:5"}), completa=False, motivo_incompleta="consulta_fallida"
        )
        self.assertEqual(incompleta["estado"], "incompleta")
        self.assertEqual([x["estado"] for x in listar_lecturas(self.raiz, FUENTE)], ["sana", "anomala", "incompleta"])

    def test_la_referencia_es_la_ultima_sana_aunque_la_anterior_no_lo_sea(self) -> None:
        """Tras una lectura anómala, la forma se compara con la última sana y las salidas con la anterior."""
        sana = self.emitir("2026-11-15T05:00:00Z", NUEVE)
        self.emitir("2026-11-16T05:00:00Z", NUEVE, rutas_de_campos=OTROS_CAMPOS)
        siguiente = self.emitir("2026-11-17T05:00:00Z", NUEVE, rutas_de_campos=OTROS_CAMPOS)
        self.assertEqual(siguiente["motivos"], ["forma_cambiada"])
        self.assertEqual(referencia(listar_lecturas(self.raiz, FUENTE), set()), sana)

    def test_un_almacen_ilegible_no_pierde_la_lectura_nueva(self) -> None:
        """Con un archivo que no es una lectura, la nueva empieza una cadena y el resultado lo dice."""
        self.emitir("2026-11-15T05:00:00Z", NUEVE)
        (carpeta_de_lecturas(self.raiz, FUENTE) / "basura.json").write_text("{", encoding="utf-8")
        emision = emitir_lectura(self.raiz, censo("2026-11-16T05:00:00Z", NUEVE - {"cv:1"}))
        self.assertIsNone(emision.lectura["anterior"])
        self.assertEqual(emision.lectura["entradas"], sorted(NUEVE - {"cv:1"}))
        self.assertTrue(emision.ruta.is_file())
        self.assertIn("no se puede leer", emision.problemas[0])
        self.assertIn("cadena nueva", emision.problemas[0])

    def test_una_cadena_con_un_eslabon_que_falta_empieza_otra(self) -> None:
        """Si la anterior apunta a una lectura que no está, el censo anterior no se inventa: cadena nueva."""
        guardar_lectura(self.raiz, ejemplos.segunda(fuente=FUENTE, ambito=AMBITO))
        emision = emitir_lectura(self.raiz, censo("2026-11-19T05:00:00Z", NUEVE))
        self.assertIsNone(emision.lectura["anterior"])
        self.assertEqual(emision.lectura["salidas"], [])
        self.assertIn("no se puede rehacer", emision.problemas[0])

    def test_las_lecturas_de_un_ambito_se_emiten_en_orden(self) -> None:
        """Otra lectura igual de reciente o posterior partiría la cadena: se rechaza y no se guarda nada."""
        self.emitir("2026-11-16T05:00:00Z", NUEVE)
        with self.assertRaises(ErrorEmision):
            emitir_lectura(self.raiz, censo("2026-11-15T05:00:00Z", NUEVE - {"cv:9"}))
        self.assertEqual(len(listar_lecturas(self.raiz, FUENTE)), 1)

    def test_una_lectura_aceptada_pasa_a_ser_la_referencia_elegida(self) -> None:
        """La aceptación hace de la lectura anómala la referencia; antes de su hora, no cuenta."""
        self.emitir("2026-11-15T05:00:00Z", NUEVE)
        cambio = self.emitir("2026-11-16T05:00:00Z", NUEVE, rutas_de_campos=OTROS_CAMPOS)
        aceptacion = Aceptacion(
            fuente=FUENTE,
            ambito=AMBITO,
            lectura_id=cambio["lectura_id"],
            aceptada_utc="2026-11-16T10:00:00Z",
            motivo="La fuente añade la modalidad a cada curso; la forma nueva es la buena.",
        )
        guardar_aceptacion(self.raiz, aceptacion)
        lecturas = listar_lecturas(self.raiz, FUENTE)
        self.assertEqual(referencia(lecturas, {cambio["lectura_id"]}), cambio)
        self.assertEqual(referencia(lecturas, set()), lecturas[0])

    def test_tras_aceptar_una_forma_nueva_la_siguiente_con_esa_forma_sale_sana(self) -> None:
        """La lectura aceptada es la referencia: la siguiente con su forma es sana y la aceptada no se reescribe."""
        self.emitir("2026-11-15T05:00:00Z", NUEVE)
        cambio = self.emitir("2026-11-16T05:00:00Z", NUEVE, rutas_de_campos=OTROS_CAMPOS)
        ruta_del_cambio = carpeta_de_lecturas(self.raiz, FUENTE) / f"{cambio['lectura_id']}.json"
        bytes_del_cambio = ruta_del_cambio.read_bytes()
        guardar_aceptacion(
            self.raiz,
            Aceptacion(
                fuente=FUENTE,
                ambito=AMBITO,
                lectura_id=cambio["lectura_id"],
                aceptada_utc="2026-11-16T10:00:00Z",
                motivo="Forma nueva revisada.",
            ),
        )
        siguiente = self.emitir("2026-11-17T05:00:00Z", NUEVE, rutas_de_campos=OTROS_CAMPOS)
        self.assertEqual((siguiente["estado"], siguiente["motivos"]), ("sana", []))
        self.assertEqual(cambio["estado"], "anomala")
        self.assertEqual(ruta_del_cambio.read_bytes(), bytes_del_cambio)
        self.assertEqual(len(listar_lecturas(self.raiz, FUENTE)), 3)


if __name__ == "__main__":
    unittest.main()
