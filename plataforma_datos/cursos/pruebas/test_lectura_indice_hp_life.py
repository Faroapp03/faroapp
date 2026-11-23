"""El índice de HP LIFE emite en cada ciclo la lectura de sus cursos, sin red y con recortes de las páginas reales."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.cursos import adquisicion_por_fuente as adquisicion
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos.fuentes.hp_life import descubrimiento, indice, lectura
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas

CAPTURAS = Path(__file__).with_name("capturas_hp_life_indice")
# Los recortes solo traen el identificador y el idioma: cada curso recibe el tipo que trae el índice real.
PAGINAS = {
    n: (CAPTURAS / f"pagina-{n}.html").read_bytes().replace(b'"language":"es"}', b'"language":"es","type":"SelfPaced"}')
    for n in range(1, 6)
}
CAMBIAR = b'{"id":%d,"language":"es","type":"SelfPaced"}'
HORA = "2026-11-15T05:00:10.250000Z"
OTRA_HORA = "2026-11-16T05:00:10.250000Z"
AMBITO = "hp_life:curso"


def sustituir(paginas: dict[int, bytes], salen: tuple[int, ...], entran: tuple[int, ...]) -> dict[int, bytes]:
    """Cambia en la primera página los cursos que salen por los que entran, sin tocar el total.

    Returns:
        Las páginas con el cambio.
    """
    primera = paginas[1]
    for sale, entra in zip(salen, entran, strict=True):
        primera = primera.replace(CAMBIAR % sale, CAMBIAR % entra)
    return {**paginas, 1: primera}


class Instalacion(unittest.TestCase):
    """Una instalación temporal donde cada ciclo recorre el índice servido y emite su lectura."""

    def setUp(self) -> None:
        """Crea la raíz de la instalación y la carpeta de recepciones del caso."""
        temporal = tempfile.TemporaryDirectory(prefix="Lectura HP ñ ")
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.area = self.raiz / "recepciones"

    def servir(self, paginas: dict[int, bytes], estados: dict[int, int] | None = None) -> None:
        """Sustituye el transporte por las páginas dadas; las fichas y la ayuda responden una página vacía."""
        codigos = estados or {}

        def descargar(url: str, **opciones: object) -> Descarga:
            numero = indice.numero_de_pagina(url) if "/allcourses" in url else None
            opciones["comprobar_cabeceras"](codigos.get(numero, 200), url, {})
            cuerpo = paginas[numero] if numero else b"<html></html>"
            return Descarga(cuerpo, url, "text/html; charset=utf-8")

        parche = patch.object(recepciones.red, "descargar_url", side_effect=descargar)
        parche.start()
        self.addCleanup(parche.stop)

    def ciclo(
        self, paginas: dict[int, bytes], hora: str = HORA, estados: dict[int, int] | None = None
    ) -> lectura.Resultado:
        """Recorre el índice servido a esa hora y emite su lectura.

        Returns:
            El resultado de la emisión.
        """
        self.servir(paginas, estados)
        recorrido = descubrimiento.recorrer(area=self.area, reloj=lambda: hora)
        return lectura.emitir(self.raiz, recorrido)

    def lecturas(self) -> list[dict]:
        """Las lecturas guardadas del ámbito de los cursos.

        Returns:
            Las lecturas, de la más antigua a la más reciente.
        """
        return [x for x in listar_lecturas(self.raiz, "hp_life") if x["ambito"] == AMBITO]


class LecturaEnCadaCiclo(Instalacion):
    """Cada ciclo deja su lectura, encadenada con la anterior."""

    def test_dos_ciclos_dejan_dos_lecturas_encadenadas(self) -> None:
        """La segunda cita la primera, lista quién entra y quién sale, y la hora es la de la captura."""
        primero = self.ciclo(PAGINAS)
        segundo = self.ciclo(sustituir(PAGINAS, (452,), (999,)), OTRA_HORA)
        self.assertEqual((len(primero.emisiones), primero.problemas), (1, ()))
        self.assertEqual((len(segundo.emisiones), segundo.problemas), (1, ()))
        antes, despues = self.lecturas()
        self.assertEqual(antes["observado_utc"], "2026-11-15T05:00:10Z")
        self.assertEqual(despues["anterior"], antes["lectura_id"])
        self.assertEqual(despues["observado_utc"], "2026-11-16T05:00:10Z")
        self.assertEqual(despues["entradas"], ["hp-life:999:es"])
        self.assertEqual((despues["estado"], despues["recuento_bruto"], despues["total_declarado"]), ("sana", 37, 37))
        self.assertEqual(despues["huella_forma"]["niveles"], ["programa"])

    def test_el_caso_real_de_37_cursos_es_una_primera_lectura_sana(self) -> None:
        """Las páginas reales traen 37 cursos que el índice da por vigentes, y el total que declara es 37."""
        lectura_real = self.ciclo(PAGINAS).emisiones[0].lectura
        self.assertEqual(
            (lectura_real["estado"], lectura_real["recuento_bruto"], lectura_real["recuento_vigente"]),
            ("sana", 37, 37),
        )
        self.assertEqual(len(lectura_real["entradas"]), 37)
        self.assertEqual(lectura_real["huella_forma"]["valores_nuevos"], [])

    def test_las_salidas_no_tienen_explicacion_y_mas_de_tres_hacen_anomala_la_lectura(self) -> None:
        """Nada explica una salida; tres cursos son lo que la regla admite, cuatro marcan la lectura."""
        self.ciclo(PAGINAS)
        tres = self.ciclo(sustituir(PAGINAS, (452, 441, 438), (991, 992, 993)), OTRA_HORA).emisiones[0].lectura
        self.assertEqual(tres["salidas"], [{"id": f"hp-life:{i}:es", "explicada_por": None} for i in (438, 441, 452)])
        self.assertEqual(tres["estado"], "sana")
        cuatro = self.ciclo(sustituir(PAGINAS, (452, 441, 438, 431), (981, 982, 983, 984)), "2026-11-17T05:00:10Z")
        self.assertEqual(
            (cuatro.emisiones[0].lectura["estado"], cuatro.emisiones[0].lectura["motivos"]),
            ("anomala", ["salidas_no_explicadas_en_bloque"]),
        )

    def test_un_censo_con_una_pagina_caida_da_una_lectura_incompleta(self) -> None:
        """Si una página del índice no responde, la lectura dice que no llegó entero y qué vio."""
        resultado = self.ciclo(PAGINAS, estados={3: 503})
        self.assertEqual(resultado.problemas, ())
        incompleta = resultado.emisiones[0].lectura
        self.assertEqual((incompleta["estado"], incompleta["motivo_incompleta"]), ("incompleta", "consulta_fallida"))
        self.assertEqual((incompleta["recuento_bruto"], incompleta["total_declarado"]), (24, 37))

    def test_sin_ninguna_pagina_legible_no_hay_lectura(self) -> None:
        """Con la primera página caída no hay censo: se dice y no se guarda nada."""
        resultado = self.ciclo(PAGINAS, estados={1: 503})
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("ninguna página legible", resultado.problemas[0])
        self.assertEqual(self.lecturas(), [])

    def test_un_tipo_de_curso_desconocido_queda_anotado(self) -> None:
        """Un tipo fuera del vocabulario de la fuente queda en la forma y hace anómala la lectura."""
        distintas = {**PAGINAS, 2: PAGINAS[2].replace(b'"type":"SelfPaced"', b'"type":"Instructor"', 1)}
        emitida = self.ciclo(distintas).emisiones[0].lectura
        self.assertEqual(emitida["huella_forma"]["valores_nuevos"], [{"campo": "programa.type", "valor": "Instructor"}])
        self.assertIn("valor_desconocido", emitida["motivos"])

    def test_una_lectura_anterior_a_la_guardada_se_dice_y_no_detiene_nada(self) -> None:
        """Volver a un censo más antiguo no parte la cadena: el problema queda dicho."""
        self.ciclo(PAGINAS, OTRA_HORA)
        resultado = self.ciclo(PAGINAS, HORA)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("se emiten en orden", resultado.problemas[0])


class EngancheEnLaAdquisicion(Instalacion):
    """La adquisición de la fuente emite la lectura y un fallo de la emisión no cambia lo que conserva."""

    def adquirir(self, raiz: Path) -> dict:
        """Ejecuta la adquisición de HP LIFE sobre una instalación temporal.

        Returns:
            La procedencia que conserva, sin las horas ni las huellas de cada recepción.
        """
        original = comun.rutas_de_la_fuente("hp_life", raiz)[0]
        original.mkdir(parents=True)
        with patch.object(comun, "pendientes_sin_instalar", return_value=[]):
            adquisicion.ADQUIRIENTES["hp_life"]([], original, {}, raiz)
        procedencia = json.loads((original / "procedencia.json").read_bytes())
        return {
            "claves": sorted(procedencia),
            "capturas": sorted(c["id"] for c in procedencia["capturas"]),
            "auxiliares": sorted(procedencia["auxiliares"]),
            "censo_completo": procedencia["censo_completo"],
        }

    def test_la_adquisicion_emite_la_lectura(self) -> None:
        """Un ciclo completo deja la lectura de los 37 cursos que descubrió."""
        self.servir(PAGINAS)
        self.adquirir(self.raiz)
        (guardada,) = self.lecturas()
        self.assertEqual((guardada["estado"], guardada["recuento_bruto"]), ("sana", 37))

    def test_si_la_emision_falla_la_adquisicion_conserva_lo_mismo(self) -> None:
        """Un fallo del registro no cambia la procedencia: mismas capturas, auxiliares y censo."""
        self.servir(PAGINAS)
        normal = self.adquirir(self.raiz)
        otra = tempfile.TemporaryDirectory(prefix="Lectura HP ñ ")
        self.addCleanup(otra.cleanup)
        with patch.object(lectura, "emitir_lectura", side_effect=OSError("disco lleno")):
            fallida = self.adquirir(Path(otra.name))
        self.assertEqual(fallida, normal)
        self.assertEqual(len(fallida["capturas"]), 37)
        self.assertEqual(listar_lecturas(Path(otra.name), "hp_life"), [])


if __name__ == "__main__":
    unittest.main()
