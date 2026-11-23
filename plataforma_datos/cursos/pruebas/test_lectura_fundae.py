"""La adquisición de FUNDAE emite en cada ciclo la lectura del censo de Digitalízate, sin red.

Las respuestas son los recortes de las respuestas públicas reales del 15/11/2026 que ya usan las pruebas del censo.
"""

import copy
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.fuentes.fundae import adquisicion, censo_digitalizate, lectura
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.pruebas.test_censo_digitalizate import BAJAS, CURSO_REAL, RECORTE, ficha, recurso, video
from plataforma_datos.cursos.pruebas.test_fundae_ediciones import conservar
from plataforma_datos.cursos.retirada_por_evidencia import Curso, decidir

PROVEEDOR = 78
CONOCIDOS = {"fuente_id": "fundae", "programas": []}


class Instalacion:
    """Una instalación temporal donde se ejecuta `descargar` con las respuestas simuladas del censo."""

    def __init__(self, caso: unittest.TestCase) -> None:
        """Crea la carpeta de originales del canal de catálogos."""
        area = tempfile.TemporaryDirectory()
        caso.addCleanup(area.cleanup)
        self.raiz = Path(area.name)
        self.original = self.raiz / "var" / "actualizacion" / "originales" / "fundae" / "catalogos"
        self.original.mkdir(parents=True)

    def ciclo(
        self, recursos: list[dict[str, Any]], hora: str, *, ficha_http: int = 200, lista_http: int = 200
    ) -> lectura.Resultado:
        """Recibe el censo con esos recursos en la ficha del proveedor 78, a esa hora.

        Returns:
            El resultado de la adquisición.
        """
        activa = copy.deepcopy(RECORTE["empresas"])
        activa[0]["numeroCursos"] = len(recursos)
        api = {
            censo_digitalizate.EMPRESAS: (lista_http, activa),
            censo_digitalizate.EMPRESAS_BAJA: (200, copy.deepcopy(BAJAS["empresas_baja"])),
            censo_digitalizate.url_detalle(PROVEEDOR): (ficha_http, ficha(*recursos)),
            **{url: (200, {"respuesta": []}) for url in adquisicion.URLS.values()},
        }

        def recibir(url: str, carpeta: Path, *_args: object, **_kwargs: object) -> dict[str, Any]:
            http, dato = api[url]
            return conservar(carpeta, url, dato, http, hora)

        ruta = self.original / "procedencia.json"
        anterior = leer_json(ruta) if ruta.exists() else {}
        with patch.object(comun, "recibir_url", side_effect=recibir):
            return adquisicion.descargar(CONOCIDOS, self.original, anterior)

    def lecturas(self) -> list[dict]:
        """Las lecturas guardadas de FUNDAE, en el orden del almacén.

        Returns:
            Las lecturas del ámbito de Digitalízate.
        """
        return [x for x in listar_lecturas(self.raiz, "fundae") if x["ambito"] == lectura.AMBITO]

    def censo_leido(self) -> dict[str, Any]:
        """El censo conservado, tal como lo lee la adquisición.

        Returns:
            La lectura del censo de Digitalízate.
        """
        documento = leer_json(self.original / "procedencia.json")["censo"]
        return censo_digitalizate.leer(self.original, documento)


class LecturaEnCadaCiclo(unittest.TestCase):
    """Cada ciclo de la adquisición deja su lectura, encadenada con la anterior."""

    def test_dos_ciclos_dejan_dos_lecturas_encadenadas(self) -> None:
        """La segunda cita la primera y lista quién entra y quién sale; el bruto cuadra con el total declarado."""
        sitio = Instalacion(self)
        primero = sitio.ciclo([recurso(1), recurso(2), video()], "2026-11-15T05:00:10Z")
        segundo = sitio.ciclo([recurso(2), recurso(3), video()], "2026-11-16T05:00:10Z")
        self.assertEqual((len(primero.emisiones), primero.problemas), (1, ()))
        self.assertEqual((len(segundo.emisiones), segundo.problemas), (1, ()))
        antes, despues = sitio.lecturas()
        self.assertEqual(despues["anterior"], antes["lectura_id"])
        self.assertEqual(despues["observado_utc"], "2026-11-16T05:00:10Z")
        self.assertEqual(antes["entradas"], ["fundae:1:1", "fundae:1:2", f"fundae:1:{2743}"])
        self.assertEqual(despues["entradas"], ["fundae:1:3"])
        self.assertEqual(despues["salidas"], [{"id": "fundae:1:1", "explicada_por": None}])
        self.assertEqual((despues["recuento_bruto"], despues["total_declarado"]), (3, 3))
        self.assertEqual((despues["recuento_vigente"], despues["huella_forma"]["niveles"]), (2, ["programa"]))
        self.assertEqual(despues["huella_forma"]["valores_nuevos"], [])

    def test_con_la_captura_real_la_lectura_sale_sana_y_cuenta_el_curso_y_el_video(self) -> None:
        """El recorte real trae un «Curso» y un «Vídeo formativo»: dos recursos, uno vigente, el total que declara."""
        sitio = Instalacion(self)
        resultado = sitio.ciclo(
            [recurso(CURSO_REAL), video()],
            "2026-11-15T00:30:41Z",
        )
        lectura_emitida = resultado.emisiones[0].lectura
        self.assertEqual(lectura_emitida["estado"], "sana")
        self.assertEqual(
            (lectura_emitida["recuento_bruto"], lectura_emitida["recuento_vigente"]),
            (2, 1),
        )

    def test_una_ficha_caida_da_una_lectura_incompleta(self) -> None:
        """Si la ficha del proveedor no responde, la lectura dice que no llegó entero y por qué."""
        sitio = Instalacion(self)
        resultado = sitio.ciclo([recurso(1)], "2026-11-15T05:00:10Z", ficha_http=503)
        self.assertEqual(resultado.problemas, ())
        emitida = resultado.emisiones[0].lectura
        self.assertEqual((emitida["estado"], emitida["motivo_incompleta"]), ("incompleta", "consulta_fallida"))
        self.assertEqual(emitida["recuento_bruto"], 0)

    def test_sin_la_lista_de_proveedores_no_hay_censo_ni_lectura(self) -> None:
        """Sin la lista activa no se sabe qué recursos hay: se dice y no se guarda nada."""
        sitio = Instalacion(self)
        resultado = sitio.ciclo([recurso(1)], "2026-11-15T05:00:10Z", lista_http=503)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no hay censo de Digitalízate que registrar", resultado.problemas[0])
        self.assertEqual(sitio.lecturas(), [])

    def test_si_la_emision_falla_la_adquisicion_termina_igual(self) -> None:
        """Un fallo del registro se dice en el resultado; la procedencia es la misma que sin el fallo."""
        normal, fallida = Instalacion(self), Instalacion(self)
        recursos = [recurso(1), recurso(2)]
        normal.ciclo(recursos, "2026-11-15T05:00:10Z")
        with patch.object(lectura, "emitir_lectura", side_effect=OSError("disco lleno")):
            resultado = fallida.ciclo(recursos, "2026-11-15T05:00:10Z")
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("disco lleno", resultado.problemas[0])
        self.assertEqual(
            (fallida.original / "procedencia.json").read_bytes(), (normal.original / "procedencia.json").read_bytes()
        )
        self.assertEqual(listar_lecturas(fallida.raiz, "fundae"), [])

    def test_una_lectura_anterior_a_la_guardada_se_dice_y_no_detiene_nada(self) -> None:
        """Volver a un censo más antiguo no parte la cadena: la adquisición termina y el problema queda dicho."""
        sitio = Instalacion(self)
        sitio.ciclo([recurso(1)], "2026-11-16T05:00:10Z")
        resultado = sitio.ciclo([recurso(1), recurso(2)], "2026-11-15T05:00:10Z")
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("se emiten en orden", resultado.problemas[0])

    def test_una_carpeta_que_no_es_de_una_instalacion_no_emite(self) -> None:
        """Sin instalación no hay dónde guardar: se dice y no se escribe nada."""
        resultado = lectura.emitir(Path("/originales"), {}, {}, lambda *_: {})
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no es la carpeta de originales", resultado.problemas[0])


class BajasDeclaradas(unittest.TestCase):
    """Un recurso con `baja: true` en la ficha de un proveedor activo es una baja que declara la fuente."""

    def test_la_baja_sigue_en_el_censo_sin_ser_vigente_y_su_salida_posterior_queda_explicada(self) -> None:
        """El 1 pasa a `baja: true` y sigue listado; cuando deja de listarse sale explicado, y el 2 sin explicación."""
        sitio = Instalacion(self)
        sitio.ciclo([recurso(1), recurso(2), recurso(3)], "2026-11-15T05:00:10Z")
        con_baja = sitio.ciclo([recurso(1, baja=True), recurso(2), recurso(3)], "2026-11-16T05:00:10Z")
        marcada = con_baja.emisiones[0].lectura
        self.assertEqual((marcada["salidas"], marcada["recuento_bruto"], marcada["recuento_vigente"]), ([], 3, 2))
        resultado = sitio.ciclo([recurso(3)], "2026-11-17T05:00:10Z")
        self.assertEqual(
            resultado.emisiones[0].lectura["salidas"],
            [
                {"id": "fundae:1:1", "explicada_por": "fuente_declara_baja"},
                {"id": "fundae:1:2", "explicada_por": None},
            ],
        )

    def test_si_no_se_lee_el_censo_anterior_la_lectura_sale_sin_explicar_y_lo_dice(self) -> None:
        """Un censo anterior ilegible no impide la lectura de hoy: sus bajas no explican nada y el problema consta."""
        sitio = Instalacion(self)
        sitio.ciclo([recurso(1, baja=True), recurso(2)], "2026-11-15T05:00:10Z")
        anterior = leer_json(sitio.original / "procedencia.json")
        actual = anterior["censo"]
        lector = lectura.emitir

        def ilegible(carpeta: Path, documento: dict[str, Any]) -> dict[str, Any] | None:
            if documento is anterior:
                raise OSError("falta una captura")
            return censo_digitalizate.leer(carpeta, documento["censo"])

        resultado = lector(sitio.original, actual, anterior, ilegible)
        self.assertEqual(len(resultado.emisiones), 1)
        self.assertIn("falta una captura", resultado.problemas[0])

    def test_las_declaraciones_citan_su_lectura_y_la_lee_la_retirada(self) -> None:
        """La baja cita la lectura de la captura y la regla de retirada la acepta tal cual."""
        sitio = Instalacion(self)
        emitida = sitio.ciclo([recurso(1, baja=True), recurso(2)], "2026-11-15T05:00:10Z").emisiones[0].lectura
        declaradas = lectura.declaraciones(emitida, sitio.censo_leido())
        self.assertEqual(list(declaradas), ["fundae:1:1"])
        (baja,) = declaradas["fundae:1:1"]
        self.assertEqual((baja.canal, baja.lectura_id), ("baja_declarada", emitida["lectura_id"]))
        curso = Curso(id="fundae:1:1", fuente="fundae", ambito=lectura.AMBITO, declaraciones=declaradas["fundae:1:1"])
        self.assertEqual(decidir(curso, [emitida]).decision, "retirar")

    def test_el_censo_de_otra_captura_no_da_declaraciones(self) -> None:
        """Las declaraciones solo salen del censo que dio esa lectura."""
        sitio = Instalacion(self)
        emitida = sitio.ciclo([recurso(1, baja=True), recurso(2)], "2026-11-15T05:00:10Z").emisiones[0].lectura
        otra = Instalacion(self)
        otra.ciclo([recurso(7)], "2026-11-15T05:00:10Z")
        with self.assertRaises(lectura.ErrorLecturaFundae):
            lectura.declaraciones(emitida, otra.censo_leido())
        with self.assertRaises(lectura.ErrorLecturaFundae):
            lectura.declaraciones({**emitida, "ambito": "fundae:otro"}, sitio.censo_leido())


class ConLoQueYaValidaLaFuente(unittest.TestCase):
    """Lo que este módulo repite para no importar el censo es lo mismo que el censo."""

    def test_el_par_del_tipo_curso_es_el_del_censo(self) -> None:
        """Si el censo cambia lo que es un «Curso», este módulo tiene que cambiar con él."""
        self.assertEqual(lectura.CURSO, censo_digitalizate.CURSO)


if __name__ == "__main__":
    unittest.main()
