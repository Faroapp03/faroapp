"""El productor de la EAES descarga la tabla, sus grupos y sus subgrupos, prepara, valida y cita su último año."""

import json
import unittest

import plataforma_datos.mercado.fuentes.eaes.lector as eaes
from plataforma_datos.comun.entrada_salida import carpetas, leer_json, ruta_del_conjunto
from plataforma_datos.comun.nucleo import FormatoInesperado, ValidacionFallida
from plataforma_datos.mercado.pruebas.ayuda_productores import ConDatosAislados, Respuesta, recorte

# El contenido íntegro de var/actualizacion/originales/eaes/ (captura del 20/10/2026), con sangría: la tabla 28186
# con 2022 a 2024, sus grupos y los subgrupos de cada grupo.
TABLA = recorte("eaes/ine-eaes-28186.json")
GRUPOS = recorte("eaes/ine-eaes-28186-grupos.json")
URL_TABLA, URL_GRUPOS = (archivo["url"] for archivo in eaes.ARCHIVOS)


def respuestas(tabla: bytes = TABLA) -> dict[str, Respuesta]:
    """Lo que la red devuelve: la tabla, sus grupos y los subgrupos de cada grupo por su identificador.

    Returns:
        {dirección: respuesta}.
    """
    salida = {URL_TABLA: Respuesta(tabla), URL_GRUPOS: Respuesta(GRUPOS)}
    for valor in json.loads(GRUPOS):
        if valor["Codigo"]:
            url = eaes.archivo_de_hijos(valor["Codigo"], valor["Id"])["url"]
            salida[url] = Respuesta(recorte(f"eaes/ine-eaes-cno11-{valor['Codigo']}.json"))
    return salida


def sin_el_ultimo_anio(tabla: bytes) -> bytes:
    """La tabla tal como estaba antes de publicarse su último año.

    Returns:
        La tabla sin el dato más reciente de cada serie.
    """
    series = json.loads(tabla)
    for serie in series:
        serie["Data"] = [dato for dato in serie["Data"] if dato["Anyo"] != max(d["Anyo"] for d in serie["Data"])]
    return json.dumps(series, ensure_ascii=False).encode("utf-8")


class PruebaProductorEaes(ConDatosAislados):
    """Descarga con un doble de red, prepara y valida la captura real."""

    def actualizar(self, tabla: bytes = TABLA, *, aceptar_cambio: bool = False) -> None:
        """Una vuelta completa del productor.

        Args:
            tabla: Los bytes que devuelve la red para la tabla.
            aceptar_cambio: Si la descarga acepta un original distinto.
        """
        with self.con_red(respuestas(tabla)):
            eaes.descargar(aceptar_cambio)
        eaes.preparar()
        eaes.validar()

    def test_descarga_prepara_y_valida_con_cita_del_anio_leido(self) -> None:
        """Pide la tabla, los grupos y los diecisiete grupos de subgrupos; la cita dice el último año."""
        self.actualizar()
        self.assertEqual(len(self.pedidas), 2 + len(eaes.LETRAS))
        procedencia = leer_json(carpetas("eaes").original / "procedencia.json")
        self.assertEqual(len(procedencia["archivos"]), 2 + len(eaes.LETRAS))
        conjunto = leer_json(ruta_del_conjunto("eaes"))
        self.assertEqual((conjunto["ultimo_anio"], conjunto["anios"]), (2024, [2022, 2023, 2024]))
        self.assertEqual(conjunto["grupos"]["A"]["cno2"], ["11", "12", "13", "14", "15"])
        self.assertIn("Definitivos 2024", conjunto["cita"])

    def test_cada_vuelta_pide_tabla_grupos_y_subgrupos(self) -> None:
        """Con los grupos iguales, la segunda vuelta vuelve a pedir los subgrupos y la procedencia sigue entera."""
        self.actualizar()
        self.pedidas.clear()
        self.actualizar()
        self.assertEqual(len(self.pedidas), 2 + len(eaes.LETRAS))
        self.assertEqual(self.pedidas[:2], [URL_TABLA, URL_GRUPOS])
        procedencia = leer_json(carpetas("eaes").original / "procedencia.json")
        self.assertEqual(len(procedencia["archivos"]), 2 + len(eaes.LETRAS))

    def test_por_el_camino_real_de_la_peticion(self) -> None:
        """Con el transporte doblado en `abrir_peticion`, la tabla, los grupos y los subgrupos pasan por los topes."""
        with self.con_transporte(respuestas()):
            eaes.descargar(False)
        eaes.preparar()
        eaes.validar()
        self.assertEqual(leer_json(ruta_del_conjunto("eaes"))["ultimo_anio"], 2024)

    def test_anio_nuevo_se_incorpora_y_la_cita_lo_dice(self) -> None:
        """Con un año más en la tabla, la siguiente vuelta lo incorpora."""
        self.actualizar(sin_el_ultimo_anio(TABLA))
        self.assertIn("Definitivos 2023", leer_json(ruta_del_conjunto("eaes"))["cita"])
        self.actualizar(TABLA, aceptar_cambio=True)
        self.assertIn("Definitivos 2024", leer_json(ruta_del_conjunto("eaes"))["cita"])

    def test_anio_que_retrocede_se_rechaza_y_se_conserva_el_validado(self) -> None:
        """Una tabla que acaba antes que lo validado no se admite."""
        self.actualizar()
        validado = ruta_del_conjunto("eaes").read_bytes()
        with self.assertRaises(ValidacionFallida):
            self.actualizar(sin_el_ultimo_anio(TABLA), aceptar_cambio=True)
        self.assertEqual(ruta_del_conjunto("eaes").read_bytes(), validado)

    def test_respuesta_mal_formada_no_sustituye_el_original(self) -> None:
        """Una tabla que no es JSON de Tempus se rechaza y el original queda como estaba."""
        self.actualizar()
        anterior = (carpetas("eaes").original / eaes.TABLA).read_bytes()
        malas = respuestas()
        malas[URL_TABLA] = Respuesta(b'[{"Nombre": "sin datos"}]')
        with self.con_red(malas), self.assertRaises(FormatoInesperado):
            eaes.descargar(True)
        self.assertEqual((carpetas("eaes").original / eaes.TABLA).read_bytes(), anterior)


if __name__ == "__main__":
    unittest.main()
