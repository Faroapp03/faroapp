"""Pruebas autónomas de lectura, controles y formas de la lista INE de nombres.

Los cinco contrastes con los originales y TypeScript viven en la evidencia de la incorporación.
"""

import io
import unittest
from contextlib import redirect_stdout
from typing import Any
from unittest import mock

import plataforma_datos.comun.fuentes.nombres.lector as nombres
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, ValidacionFallida
from plataforma_datos.orquestacion import admision


def tabla_correcta() -> list[list[Any]]:
    """Compone una lista general como la publica el INE: numerada desde 1, de más a menos frecuente, con sus caracteres.

    Returns:
        Filas de la lista: orden, nombre y frecuencia.
    """
    return [[1, "MARIA", 600], [2, "D'AMICO", 300], [3, "MARCEL·LA", 20]]


def con_una_celda(fila: int, columna: int, valor: object) -> list[list[Any]]:
    """Compone la lista correcta con una sola celda cambiada.

    Args:
        fila: posición de la fila, desde 0.
        columna: posición de la columna, desde 0.
        valor: valor nuevo de la celda.

    Returns:
        Filas de la lista con el cambio.
    """
    filas = tabla_correcta()
    filas[fila][columna] = valor
    return filas


class PruebaFormaDeNombre(unittest.TestCase):
    """La forma con que se exporta un nombre es la misma con que el motor lo busca."""

    def test_forma(self) -> None:
        """Minúsculas, sin tildes, sin «ñ» ni «ç» y sin apóstrofos ni punto volado."""
        casos = {"Núria": "nuria", "D'Amico": "damico", "O’Brien": "obrien", "Marcel·la": "marcella", "MUÑOZ": "munoz"}
        for nombre, esperada in casos.items():
            with self.subTest(nombre=nombre):
                self.assertEqual(nombres.forma(nombre), esperada)


class PruebaPalabrasQueNoSonNombre(unittest.TestCase):
    """Las piezas con que la lista de nombres sabe qué palabras no son un nombre."""

    def test_palabras_corrientes(self) -> None:
        """De un texto corriente cuentan las palabras en minúscula, por su raíz; de uno en mayúsculas, todas."""
        self.assertEqual(
            nombres.palabras_corrientes("atiende a la Sra. García en el Hospital"), {"atiend", "a", "la", "en", "el"}
        )
        self.assertEqual(nombres.palabras_corrientes("COCINA DE COLECTIVIDADES"), {"cocin", "de", "colectividad"})
        self.assertEqual(nombres.palabras_corrientes("col·legi"), {"collegi"})
        self.assertEqual(nombres.palabras_corrientes(None), set())

    def test_cabezas_de_titulos(self) -> None:
        """La raíz de la primera palabra de cada título y de cada forma de un título doble."""
        titulos = ["cuiner/cuinera de restaurant", "Directors generals i presidents executius", "Tècnica de so"]
        self.assertEqual(nombres.cabezas_de_titulos(titulos), {"cuiner", "director", "tecnic"})

    def test_textos_usa_el_mismo_contenido_que_comprueba(self) -> None:
        """La composición ES recibe los bytes admitidos sin volver a abrir los archivos."""
        archivos = {"captura": b"contenido comprobado"}
        with (
            mock.patch.object(nombres, "textos_validados", return_value=archivos),
            mock.patch.object(
                nombres, "combinar_textos", return_value={"tareas": {"1": {"corto": "tarea"}}}
            ) as combinar,
        ):
            self.assertEqual(nombres._textos_de_tareas(), ["tarea"])
        combinar.assert_called_once_with(archivos=archivos)

    def test_catalan_usa_el_mismo_contenido_que_comprueba(self) -> None:
        """El vocabulario CA recibe la misma instantánea admitida de traducciones."""
        archivos = {"captura": b"contenido comprobado"}
        with (
            mock.patch.object(nombres, "catalan_validado", return_value=archivos),
            mock.patch.object(
                nombres, "traducciones_catalan", return_value={"tareas-1": {"textos": {"1": "tasca"}}}
            ) as traducciones,
        ):
            self.assertEqual(nombres._traduccion_al_catalan(), {"tareas": ["tasca"]})
        traducciones.assert_called_once_with(archivos=archivos)


class PruebaOficios(unittest.TestCase):
    """Los nombres que son también un oficio, para que ni la limpieza ni el buscador se coman una ocupación."""

    def test_raiz(self) -> None:
        """Masculino, femenino y plural comparten raíz; una palabra corta se queda como está."""
        self.assertEqual({nombres.raiz(palabra) for palabra in ("pastor", "pastora", "pastores")}, {"pastor"})
        self.assertEqual(nombres.raiz("ana"), "ana")

    def test_formas_simples(self) -> None:
        """Una forma por nombre de una sola palabra, sin repetir; los compuestos no entran."""
        filas = [[1, "MARIA CARMEN", 900], [2, "NÚRIA", 30], [3, "NURIA", 25], [4, "DE LA TORRE", 20]]
        self.assertEqual(nombres.formas_simples(filas), ["nuria"])

    def test_cabezas_de_ocupacion(self) -> None:
        """La primera palabra de cada nombre de una ocupación ESCO, del título y de los alternativos, por su raíz."""
        ocupaciones = [
            {"titulo_es": "pastor/pastora", "nombres_alternativos_es": ["Pastora de ovejas"]},
            {"titulo_es": "herrero de forja/herrera de forja"},
        ]
        self.assertEqual(nombres.cabezas_de_ocupacion(ocupaciones), {"pastor", "herrer"})

    def test_tambien_oficio(self) -> None:
        """Las dos formas de género de un oficio, y ningún otro nombre."""
        self.assertEqual(nombres.tambien_oficio(["pastor", "pastora", "laura"], {"pastor"}), ["pastor", "pastora"])


class PruebaLecturaDeTablas(unittest.TestCase):
    """Las tablas del INE, leídas celda a celda."""

    def test_filas_numeradas(self) -> None:
        """Solo cuentan las filas que empiezan por su número de orden y tienen texto; el orden puede ser «1.0»."""
        filas = [["Orden", "Nombre", "Frecuencia"], ["1.0", " MARIA ", "600.0"], ["", "nota", ""], ["2", "", "5"]]
        self.assertEqual(nombres._filas_numeradas(filas, 3), [[1, "MARIA", 600]])

    def test_una_frecuencia_fraccionaria_o_no_decimal_no_se_trunca(self) -> None:
        """Las celdas deben representar enteros decimales, sin truncar ni reinterpretar notación."""
        for valor in ("20.5", "1e3", "inf", "NaN", "٢٠"):
            with self.subTest(valor=valor), self.assertRaises(FormatoInesperado):
                nombres._entero(valor)
        for valor in ("20", "20.0", 20, 20.0):
            with self.subTest(valor=valor):
                self.assertEqual(nombres._entero(valor), 20)

    def test_tablas_contiguas(self) -> None:
        """Una tabla de tres columnas por nacionalidad, una al lado de otra, con su título dos filas por encima."""
        filas = [
            ["", "Marruecos", "", "", "Rumanía", "", ""],
            ["", "Nombre", "Frecuencia", "Por mil", "Nombre", "Frecuencia", "Por mil"],
            ["", "MOHAMED", "900.0", "1", "ION", "300", "1"],
            ["", "AHMED", "100", "1", "", "", ""],
        ]
        self.assertEqual(
            nombres._tablas_contiguas(filas, 0, 2),
            [
                {"nacionalidad": "Marruecos", "filas": [["MOHAMED", 900], ["AHMED", 100]]},
                {"nacionalidad": "Rumanía", "filas": [["ION", 300]]},
            ],
        )

    def test_como_tabla(self) -> None:
        """Las columnas de un .xlsx en su orden de hoja de cálculo: Z va antes que AA."""
        self.assertEqual(
            nombres._como_tabla([{"AA": "c", "B": "b"}, {"Z": "z"}]),
            [["", "b", *([""] * 24), "c"], [*([""] * 25), "z", ""]],
        )
        self.assertEqual(nombres._como_tabla([{"A": "a", "C": "c"}]), [["a", "", "c"]])
        self.assertEqual(nombres._como_tabla([]), [])

    def test_una_columna_fuera_del_libro_no_reserva_memoria(self) -> None:
        """Una referencia más allá de XFD se rechaza antes de reservar una fila de ancho arbitrario."""
        with self.assertRaises(FormatoInesperado):
            nombres._como_tabla([{"XFE": "fuera"}])


class PruebaControles(unittest.TestCase):
    """Cobertura y forma de las listas generales, y su contraste con las tablas por nacionalidad."""

    def test_tabla_correcta(self) -> None:
        """Una lista numerada sin huecos, de 20 personas o más, de más a menos y con los caracteres del INE pasa."""
        controles = Controles()
        nombres._controles_de_tabla(controles, "nombres", tabla_correcta())
        self.assertTrue(controles.admitido, controles.fallidos)

    def test_cada_defecto_falla_su_control(self) -> None:
        """Un hueco, una frecuencia baja, un desorden o una tilde hacen fallar el control que les corresponde."""
        defectos = {
            "numeradas sin huecos": con_una_celda(1, 0, 3),
            "20 personas o más": con_una_celda(2, 2, 19),
            "de la más frecuente a la menos": con_una_celda(1, 2, 700),
            "solo letras sin tildes": con_una_celda(0, 1, "MARÍA"),
        }
        for control, filas in defectos.items():
            with self.subTest(control=control):
                controles = Controles()
                nombres._controles_de_tabla(controles, "nombres", filas)
                self.assertEqual(len(controles.fallidos), 1)
                self.assertIn(control, controles.fallidos[0])

    def test_una_tabla_vacia_no_se_admite(self) -> None:
        """Una lectura sin datos no acredita cobertura aunque los controles universales sean vacíos."""
        controles = Controles()
        nombres._controles_de_tabla(controles, "nombres", [])
        self.assertFalse(controles.admitido)

    def test_controles_fallidos_se_registran_sin_leer_dependencias(self) -> None:
        """Un fallo propio conserva su diagnóstico aunque falten las entradas del vocabulario."""
        controles = Controles()
        controles.comprobar(False, "tabla sin datos")
        with (
            mock.patch.object(nombres, "_leer_preparados", return_value={}),
            mock.patch.object(nombres, "leer_json", return_value={}),
            mock.patch.object(nombres, "_controles", return_value=controles),
            mock.patch.object(nombres, "_conjunto_validado", side_effect=FileNotFoundError("dependencia")) as conjunto,
            mock.patch.object(admision, "guardar_validacion") as guardar,
            redirect_stdout(io.StringIO()),
            self.assertRaises(ValidacionFallida),
        ):
            nombres.validar()
        conjunto.assert_not_called()
        self.assertEqual(guardar.call_args.args[1]["controles"], controles.lista)
        self.assertNotIn("cobertura", guardar.call_args.args[1])

    def test_informe_admitido_conserva_el_orden_de_sus_campos(self) -> None:
        """El cálculo diferido de cobertura conserva la serialización del informe válido."""
        controles = Controles()
        controles.comprobar(True, "tabla correcta")
        with (
            mock.patch.object(nombres, "_leer_preparados", return_value={}),
            mock.patch.object(nombres, "leer_json", return_value={}),
            mock.patch.object(nombres, "_controles", return_value=controles),
            mock.patch.object(nombres, "_conjunto_validado", return_value={}),
            mock.patch.object(nombres, "_cobertura", return_value={"nombres": 1}),
            mock.patch.object(admision, "guardar_validacion") as guardar,
            mock.patch.object(admision, "guardar_json_compacto"),
            redirect_stdout(io.StringIO()),
        ):
            nombres.validar()
        self.assertEqual(
            list(guardar.call_args.args[1]), ["estado", "comprobado_utc", "cobertura", "limite", "controles"]
        )
        self.assertEqual(guardar.call_args.args[1]["cobertura"], {"nombres": 1})

    def test_contraste_con_las_nacionalidades(self) -> None:
        """Un nombre frecuente de una nacionalidad tiene que estar en la lista general de su sexo; uno raro, no."""
        generales = {"hombre": {"MOHAMED"}, "mujer": {"FATIMA"}, "apellido": {"GARCIA"}}
        tablas = [
            {"nacionalidad": "Marruecos", "sexo": "hombre", "filas": [["MOHAMED", 900], ["AHMED", 20], ["OMAR", 19]]},
            {"nacionalidad": "Perú", "filas": [["GARCIA", 50], ["QUISPE", 40]]},
        ]
        self.assertEqual(nombres._contrastar(tablas, generales), ["Marruecos: AHMED", "Perú: QUISPE"])


if __name__ == "__main__":
    unittest.main()
