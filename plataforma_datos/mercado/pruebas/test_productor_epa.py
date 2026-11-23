"""El productor de la EPA descarga, prepara y valida, detecta el trimestre nuevo y conserva lo anterior si falla."""

import json
import unittest

import plataforma_datos.mercado.fuentes.epa.lector as epa
from plataforma_datos.comun.entrada_salida import carpetas, leer_json, ruta_del_conjunto
from plataforma_datos.comun.nucleo import FormatoInesperado, OriginalCambiado, ValidacionFallida
from plataforma_datos.mercado.pruebas.ayuda_productores import ConDatosAislados, Respuesta, recorte

# Recorte de var/actualizacion/originales/epa/ine-epa-65314.json (captura del 20/10/2026): las once series de
# Cataluña en ambos sexos y la de hombres, con sus nueve últimos trimestres (2024T2 a 2026T2) tal como los da el INE.
TABLA = recorte("epa-65314.json")
CODIGOS = recorte("epa-65314-ocupaciones.json")
LARGO_SHA256 = 64
URL_TABLA, URL_CODIGOS = (archivo["url"] for archivo in epa.ARCHIVOS)


def sin_el_ultimo_trimestre(tabla: bytes) -> bytes:
    """La misma tabla tal como estaba antes de publicarse su último trimestre.

    Returns:
        La tabla sin el dato más reciente de cada serie.
    """
    series = json.loads(tabla)
    for serie in series:
        serie["Data"] = serie["Data"][1:]
    return json.dumps(series, ensure_ascii=False).encode("utf-8")


class PruebaProductorEpa(ConDatosAislados):
    """Descarga con un doble de red, prepara y valida el recorte real."""

    def actualizar(self, tabla: bytes, *, aceptar_cambio: bool = False) -> None:
        """Una vuelta completa del productor con la tabla dada.

        Args:
            tabla: Los bytes que devuelve la red para la tabla.
            aceptar_cambio: Si la descarga acepta un original distinto, como hace la política mensual.
        """
        with self.con_red({URL_TABLA: Respuesta(tabla), URL_CODIGOS: Respuesta(CODIGOS)}):
            epa.descargar(aceptar_cambio)
        epa.preparar()
        epa.validar()

    def test_descarga_prepara_y_valida_con_cita_del_trimestre_leido(self) -> None:
        """La procedencia guarda huella y fecha; el conjunto trae las once series y la cita de su trimestre."""
        self.actualizar(TABLA)
        self.assertEqual(self.pedidas, [URL_TABLA, URL_CODIGOS])
        procedencia = leer_json(carpetas("epa").original / "procedencia.json")
        self.assertTrue(all(len(entrada["sha256"]) == LARGO_SHA256 for entrada in procedencia["archivos"]))
        self.assertTrue(all(entrada["descargado_utc"] for entrada in procedencia["archivos"]))
        conjunto = leer_json(ruta_del_conjunto("epa"))
        self.assertEqual(conjunto["ultimo_trimestre"], "2026T2")
        self.assertEqual(sorted(conjunto["grupos"]), sorted(epa.GRUPOS))
        self.assertEqual(conjunto["grupos"]["total"]["miles"]["2026T2"], 3997.8)
        self.assertIn("última publicación: trimestre 2/2026", conjunto["cita"])

    def test_trimestre_nuevo_se_detecta_e_incorpora(self) -> None:
        """Cuando el INE añade un trimestre, la siguiente vuelta lo incorpora y la cita lo dice."""
        self.actualizar(sin_el_ultimo_trimestre(TABLA))
        self.assertEqual(leer_json(ruta_del_conjunto("epa"))["ultimo_trimestre"], "2026T1")
        self.actualizar(TABLA, aceptar_cambio=True)
        conjunto = leer_json(ruta_del_conjunto("epa"))
        self.assertEqual(conjunto["ultimo_trimestre"], "2026T2")
        self.assertIn("trimestre 2/2026", conjunto["cita"])

    def test_por_el_camino_real_de_la_peticion(self) -> None:
        """Con el transporte doblado en el punto más bajo, la descarga pasa por la identidad, el turno y los topes."""
        with self.con_transporte({URL_TABLA: Respuesta(TABLA), URL_CODIGOS: Respuesta(CODIGOS)}):
            epa.descargar(False)
        epa.preparar()
        epa.validar()
        self.assertEqual(leer_json(ruta_del_conjunto("epa"))["ultimo_trimestre"], "2026T2")

    def test_respuesta_mal_formada_no_sustituye_el_original(self) -> None:
        """Un cuerpo que no es la tabla, otro tipo de contenido u otro origen se rechazan y queda lo anterior."""
        self.actualizar(TABLA)
        anterior = (carpetas("epa").original / epa.TABLA).read_bytes()
        malas = (
            Respuesta(b"<html>mantenimiento</html>"),
            Respuesta(b'{"error": 1}'),
            Respuesta(TABLA, tipo="text/html"),
            Respuesta(TABLA, final="https://otro.example/65314"),
            Respuesta(TABLA, estado=204),
        )
        for mala in malas:
            with (
                self.subTest(mala=mala[1:]),
                self.con_red({URL_TABLA: mala, URL_CODIGOS: Respuesta(CODIGOS)}),
                self.assertRaises(FormatoInesperado),
            ):
                epa.descargar(True)
            self.assertEqual((carpetas("epa").original / epa.TABLA).read_bytes(), anterior)

    def test_original_distinto_sin_aceptar_se_detiene(self) -> None:
        """Fuera de la política mensual, un original nuevo espera a que se acepte a propósito."""
        self.actualizar(sin_el_ultimo_trimestre(TABLA))
        with self.con_red({URL_TABLA: Respuesta(TABLA)}), self.assertRaises(OriginalCambiado):
            epa.descargar(False)

    def test_trimestre_que_retrocede_se_rechaza_y_se_conserva_el_validado(self) -> None:
        """Una tabla que acaba antes que lo validado no se admite; el conjunto anterior queda intacto."""
        self.actualizar(TABLA)
        validado = ruta_del_conjunto("epa").read_bytes()
        with self.assertRaises(ValidacionFallida):
            self.actualizar(sin_el_ultimo_trimestre(TABLA), aceptar_cambio=True)
        self.assertEqual(ruta_del_conjunto("epa").read_bytes(), validado)

    def test_serie_incompleta_no_se_admite(self) -> None:
        """Sin un gran grupo, la validación se detiene."""
        series = [serie for serie in json.loads(TABLA) if "Ocupaciones militares" not in serie["Nombre"]]
        with self.assertRaises(ValidacionFallida):
            self.actualizar(json.dumps(series).encode("utf-8"))


if __name__ == "__main__":
    unittest.main()
