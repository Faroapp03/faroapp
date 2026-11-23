"""La descarga de fichas de FUNDAE (catálogo 3) emite en cada ciclo la lectura de las ediciones, sin red."""

import copy
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.cursos.fuentes.fundae import adquisicion, descarga, ediciones, lectura, lectura_preinscripcion
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.pruebas.test_fundae import COLECTIVOS, centro, fila
from plataforma_datos.cursos.pruebas.test_fundae_ediciones import ABIERTA, CODIGO, conservar, difusiones, indice
from plataforma_datos.cursos.retirada_por_evidencia import Curso, decidir

NUEVA = 5000
DIA_1, DIA_2 = "2026-10-23T10:00:01Z", "2026-11-01T10:00:01Z"
ID_ABIERTA, ID_NUEVA = f"fundae:edicion:{ABIERTA}", f"fundae:edicion:{NUEVA}"


def difusiones_del_dia_2() -> dict[str, Any]:
    """Difusiones del 1/11: la edición 3177 ya cerró el 31/10 y entra la 5000, abierta hasta fin de año.

    Returns:
        La respuesta de la ficha.
    """
    nueva = {**fila(NUEVA), "fechaPreinscripcionFin": "2026-12-31T00:00:00"}
    return {"centrosRFO": [fila(ABIERTA), nueva], "curso": centro()["curso"]}


def centro_con(*filas: dict[str, object]) -> dict[str, Any]:
    """La ficha de la entidad con esas difusiones.

    Returns:
        La respuesta de la entidad.
    """
    return {"centrosRFO": list(filas), "curso": centro()["curso"]}


class Instalacion:
    """Una instalación temporal donde se ejecuta `descargar` con las respuestas simuladas de FUNDAE."""

    def __init__(self, caso: unittest.TestCase) -> None:
        """Crea la casa FUNDAE de una instalación."""
        area = tempfile.TemporaryDirectory()
        caso.addCleanup(area.cleanup)
        self.raiz = Path(area.name)
        self.fundae = self.raiz / "var" / "actualizacion" / "originales" / "fundae"
        self.fundae.mkdir(parents=True)

    def ciclo(
        self,
        hora: str,
        *,
        dia_2: bool = False,
        http_indice: int = 200,
        colectivos: tuple[int, object] = (200, COLECTIVOS),
        consultas: int | None = None,
    ) -> lectura.Resultado:
        """Un ciclo con el índice de la especialidad y sus fichas a esa hora.

        Returns:
            El resultado de la descarga.
        """
        canal = self.fundae / "catalogos"
        captura = conservar(canal, adquisicion.URLS["subvencionada"], indice(CODIGO), http_indice, hora)
        guardar_json(canal / "procedencia.json", {"auxiliares": {"subvencionada": captura}})
        api: dict[str, tuple[int, object]] = {ediciones.url_difusiones(CODIGO): (200, difusiones())}
        api[ediciones.url_centro(CODIGO, "B00000000")] = (200, centro())
        api[ediciones.url_colectivos(ABIERTA)] = colectivos
        if dia_2:
            api[ediciones.url_difusiones(CODIGO)] = (200, difusiones_del_dia_2())
            api[ediciones.url_centro(CODIGO, "B00000000")] = (200, centro_con(fila(ABIERTA), fila(NUEVA)))
            api[ediciones.url_colectivos(NUEVA)] = colectivos

        def recibir(url: str, carpeta: Path, segundos: int | None = None) -> dict[str, Any]:
            http, dato = api.get(url, (503, {}))
            return conservar(carpeta, url, copy.deepcopy(dato), http, hora)

        presupuesto = None if consultas is None else descarga.Presupuesto(recibir, consultas=consultas)
        with patch.object(descarga.tramite, "descargar"):
            return descarga.descargar(self.fundae, recibir, presupuesto)

    def lecturas(self) -> list[dict]:
        """Las lecturas de la preinscripción guardadas, en el orden del almacén.

        Returns:
            Las lecturas del ámbito.
        """
        return [x for x in listar_lecturas(self.raiz, "fundae") if x["ambito"] == lectura_preinscripcion.AMBITO]

    def captura(self) -> lectura_preinscripcion.Captura:
        """Lo conservado por la última descarga, tal como lo lee la lectura.

        Returns:
            La captura.
        """
        return lectura_preinscripcion.capturar(
            self.fundae, leer_json(self.fundae / ediciones.CARPETA / "procedencia.json")
        )


class LecturaEnCadaCiclo(unittest.TestCase):
    """Cada descarga deja su lectura de ediciones, encadenada con la anterior."""

    def test_dos_ciclos_dejan_dos_lecturas_y_la_salida_por_plazo_vencido_queda_explicada(self) -> None:
        """El 1/11 sale la 3177 con su plazo vencido en la ficha de hoy y entra la 5000."""
        sitio = Instalacion(self)
        primero, segundo = sitio.ciclo(DIA_1), sitio.ciclo(DIA_2, dia_2=True)
        self.assertEqual((len(primero.emisiones), primero.problemas, segundo.problemas), (1, (), ()))
        antes, despues = sitio.lecturas()
        self.assertEqual((antes["estado"], antes["entradas"], antes["recuento_bruto"]), ("sana", [ID_ABIERTA], 2))
        self.assertEqual((antes["recuento_vigente"], antes["total_declarado"]), (1, None))
        self.assertEqual(despues["anterior"], antes["lectura_id"])
        self.assertEqual(despues["entradas"], [ID_NUEVA])
        self.assertEqual(despues["salidas"], [{"id": ID_ABIERTA, "explicada_por": "fin_publicado"}])
        self.assertEqual((despues["observado_utc"], despues["huella_forma"]["niveles"]), (DIA_2, ["edicion"]))

    def test_una_descarga_cortada_por_su_tope_da_una_lectura_incompleta(self) -> None:
        """Sin presupuesto para la ficha de colectivos, la descarga se corta y la lectura lo dice."""
        emitida = Instalacion(self).ciclo(DIA_1, consultas=3).emisiones[0].lectura
        self.assertEqual((emitida["estado"], emitida["motivo_incompleta"]), ("incompleta", "limite_alcanzado"))

    def test_una_ficha_caida_da_una_lectura_incompleta(self) -> None:
        """Si la ficha de colectivos no responde, la lectura dice que no llegó entera."""
        emitida = Instalacion(self).ciclo(DIA_1, colectivos=(503, {})).emisiones[0].lectura
        self.assertEqual((emitida["estado"], emitida["motivo_incompleta"]), ("incompleta", "consulta_fallida"))

    def test_con_el_indice_caido_no_hay_censo_ni_lectura(self) -> None:
        """Sin el índice no se sabe qué especialidades hay abiertas: se dice y no se guarda nada."""
        sitio = Instalacion(self)
        resultado = sitio.ciclo(DIA_1, http_indice=503)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("el índice del catálogo 3 no respondió", resultado.problemas[0])
        self.assertEqual(sitio.lecturas(), [])

    def test_un_colectivo_desconocido_queda_anotado(self) -> None:
        """La edición se descarta por su colectivo y la lectura anota el valor nuevo, que la hace anómala."""
        desconocido = [{"idColectivo": 9, "descripcionColectivos": "Otro"}]
        emitida = Instalacion(self).ciclo(DIA_1, colectivos=(200, desconocido)).emisiones[0].lectura
        self.assertEqual(emitida["huella_forma"]["valores_nuevos"], [{"campo": "colectivo.idColectivo", "valor": "9"}])
        self.assertEqual(
            (emitida["estado"], emitida["recuento_vigente"], emitida["entradas"]), ("anomala", 0, [ID_ABIERTA])
        )

    def test_si_la_emision_falla_la_descarga_termina_igual(self) -> None:
        """Un fallo del registro se dice en el resultado; las fichas conservadas son las mismas que sin el fallo."""
        normal, fallida = Instalacion(self), Instalacion(self)
        normal.ciclo(DIA_1)
        with patch.object(lectura_preinscripcion, "emitir_lectura", side_effect=OSError("disco lleno")):
            resultado = fallida.ciclo(DIA_1)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("disco lleno", resultado.problemas[0])
        ruta = Path(ediciones.CARPETA) / "procedencia.json"
        self.assertEqual((fallida.fundae / ruta).read_bytes(), (normal.fundae / ruta).read_bytes())
        self.assertEqual(listar_lecturas(fallida.raiz, "fundae"), [])

    def test_una_carpeta_que_no_es_de_una_instalacion_no_emite(self) -> None:
        """Sin instalación no hay dónde guardar: se dice y no se escribe nada."""
        resultado = lectura_preinscripcion.emitir(Path("/originales/fundae"), {})
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no es la carpeta de originales", resultado.problemas[0])


class DeclaracionesDeLaFuente(unittest.TestCase):
    """El fin de la preinscripción, citando su lectura."""

    def test_el_fin_publicado_cita_su_lectura_y_retira_cuando_una_lectura_sana_lo_alcanza(self) -> None:
        """La 3177 cierra el 31/10: el 23/10 se mantiene; con la lectura sana del 1/11 se retira."""
        sitio = Instalacion(self)
        primera = sitio.ciclo(DIA_1).emisiones[0].lectura
        declaradas = lectura_preinscripcion.declaraciones(primera, sitio.captura())
        (fin,) = declaradas[ID_ABIERTA]
        self.assertEqual(
            (fin.canal, fin.lectura_id, fin.cierra_el), ("fin_publicado", primera["lectura_id"], "2026-10-31T23:00:00Z")
        )
        curso = Curso(
            id=ID_ABIERTA, fuente="fundae", ambito=lectura_preinscripcion.AMBITO, declaraciones=declaradas[ID_ABIERTA]
        )
        self.assertEqual(decidir(curso, [primera]).decision, "mantener")
        segunda = sitio.ciclo(DIA_2, dia_2=True).emisiones[0].lectura
        self.assertEqual(decidir(curso, [primera, segunda]).decision, "retirar")

    def test_la_captura_de_otra_lectura_no_da_declaraciones(self) -> None:
        """Las declaraciones solo salen de la captura que dio esa lectura."""
        sitio = Instalacion(self)
        primera = sitio.ciclo(DIA_1).emisiones[0].lectura
        sitio.ciclo(DIA_2, dia_2=True)
        with self.assertRaises(lectura.ErrorLecturaFundae):
            lectura_preinscripcion.declaraciones(primera, sitio.captura())
        with self.assertRaises(lectura.ErrorLecturaFundae):
            lectura_preinscripcion.declaraciones({**primera, "ambito": "fundae:digitalizate"}, sitio.captura())


if __name__ == "__main__":
    unittest.main()
