"""Las series Eurostat admiten nuevas entregas compatibles y rechazan cambios incompatibles."""

import datetime
import unittest
from typing import Any

import plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector as mundo
import plataforma_datos.ia_y_trabajo.fuentes.ue_eurostat.lector as ue
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import CATALUNA, UE27
from plataforma_datos.ia_y_trabajo.comun import tablas_eurostat
from plataforma_datos.ia_y_trabajo.pruebas.test_mundo_eurostat import tabla_jsonstat
from plataforma_datos.ia_y_trabajo.pruebas.test_ue_eurostat import filas_de_referencia, tablas_con_las_etiquetas


def filas_del_mundo() -> list[dict[str, Any]]:
    """Construye cobertura mínima con las cifras iniciales de empresas UE.

    Returns:
        Las filas de los indicadores y territorios vigilados.
    """
    filas = []
    for indicador, (tabla, codigos) in mundo.CODIGOS_DE_CADA_INDICADOR.items():
        territorios = (*mundo.TERRITORIOS_DE_LA_COMPARACION, *((CATALUNA,) if indicador in mundo.DE_CATALUNA else ()))
        for geo in territorios:
            if (indicador, geo) in mundo.HUECOS_CONOCIDOS:
                continue
            valores = {2025: 20.0}
            if indicador == "empresas-ia" and geo == UE27:
                valores = {2025: 19.95, 2024: 13.48, 2023: 8.06, 2021: 7.65}
            filas.extend(
                {"tabla": tabla, **codigos, "geo": geo, "anio": anio, "valor": valor, "marca": None}
                for anio, valor in valores.items()
            )
    filas.extend(
        {
            "tabla": mundo.EMPLEO,
            "unit": "THS_PER",
            "age": "Y_GE15",
            "geo": pais,
            "anio": 2025,
            "sex": "T",
            "isco08": "TOTAL",
            "valor": 100.0,
            "marca": None,
        }
        for pais in mundo.PAISES_DEL_CONTRASTE
    )
    return filas


def controlar_mundo(filas: list[dict[str, Any]]) -> Controles:
    """Controla filas sintéticas con todas las etiquetas conocidas.

    Returns:
        Los controles de mundo.
    """
    controles = Controles()
    mundo._controles(controles, filas, {"tablas": {"etiquetas": mundo.ETIQUETAS}})
    return controles


def controlar_ue(filas: list[dict[str, Any]]) -> Controles:
    """Controla filas sintéticas con las etiquetas de cada tabla.

    Returns:
        Los controles de la UE.
    """
    controles = Controles()
    ue._controles(controles, filas, tablas_con_las_etiquetas())
    return controles


class PruebaSeriesActualizables(unittest.TestCase):
    """Las cifras de la primera captura no fijan las de futuras versiones."""

    def test_mundo_admite_anio_nuevo_y_revision(self) -> None:
        """El mismo indicador incorpora 2026 y una revisión histórica sin cambiar su base."""
        filas = filas_del_mundo()
        empresa = next(fila for fila in filas if fila["tabla"] == "isoc_eb_ai" and fila["geo"] == UE27)
        empresa["valor"] = 20.01
        filas.append({**empresa, "anio": 2026, "valor": 24.0})
        self.assertEqual(controlar_mundo(filas).fallidos, [])

    def test_mundo_admite_que_francia_complete_su_cobertura(self) -> None:
        """Un hueco conocido puede cerrarse con una cifra de igual definición."""
        filas = filas_del_mundo()
        for indicador, geo in mundo.HUECOS_CONOCIDOS:
            tabla, codigos = mundo.CODIGOS_DE_CADA_INDICADOR[indicador]
            filas.append({"tabla": tabla, **codigos, "geo": geo, "anio": 2026, "valor": 20.0, "marca": None})
        self.assertEqual(controlar_mundo(filas).fallidos, [])

    def test_ue_admite_anio_nuevo_y_revision(self) -> None:
        """Los indicadores de última cifra avanzan y las series conservan la revisión."""
        filas = filas_de_referencia()
        filas[0]["valor"] += 0.1
        filas.append({**filas[0], "anio": 2026, "valor": 25.0})
        self.assertEqual(controlar_ue(filas).fallidos, [])

    def test_mundo_rechaza_duplicados_de_indicador_y_empleo(self) -> None:
        """Una dimensión nueva no puede sobrescribir valores de una misma serie."""
        for empleo in (False, True):
            with self.subTest(empleo=empleo):
                filas = filas_del_mundo()
                fila = (
                    {
                        "tabla": mundo.EMPLEO,
                        "geo": "ES",
                        "anio": 2025,
                        "sex": "T",
                        "isco08": "OC1",
                        "valor": 10.0,
                        "marca": None,
                    }
                    if empleo
                    else filas[0]
                )
                filas.extend([fila, {**fila, "otra_dimension": "otro"}])
                self.assertIn("una sola cifra", " ".join(controlar_mundo(filas).fallidos))

    def test_ambas_fuentes_rechazan_anios_futuros(self) -> None:
        """Un año futuro no se convierte en la cifra más reciente ni en vigencia."""
        for controlar, base in ((controlar_mundo, filas_del_mundo), (controlar_ue, filas_de_referencia)):
            with self.subTest(fuente=controlar.__name__):
                filas = base()
                filas.append({**filas[0], "anio": datetime.datetime.now(datetime.UTC).year + 1})
                self.assertIn("futuro", " ".join(controlar(filas).fallidos))

    def test_ue_rechaza_rango_historico_aunque_solo_presente_ultima_cifra(self) -> None:
        """Una revisión imposible de una cifra anterior se rechaza antes de truncar la serie."""
        filas = filas_de_referencia()
        filas.append({**filas[0], "anio": 2023, "valor": 101.0})
        self.assertIn("porcentaje", " ".join(controlar_ue(filas).fallidos))

    def test_ue_rechaza_recuento_negativo(self) -> None:
        """Los miles de especialistas TIC deben ser no negativos."""
        filas = filas_de_referencia()
        filas.append(
            {
                "tabla": ue.RECUENTO_ESPECIALISTAS_TIC.tabla,
                "unit": "THS_PER",
                "geo": UE27,
                "anio": 2026,
                "valor": -1.0,
                "marca": None,
            }
        )
        self.assertIn("recuento", " ".join(controlar_ue(filas).fallidos))

    def test_la_frecuencia_no_anual_se_rechaza(self) -> None:
        """No se pierde una frecuencia distinta al convertir las celdas en filas anuales."""
        tabla = tabla_jsonstat()
        tabla["dimension"]["freq"]["category"]["index"] = {"Q": 0}
        with self.assertRaisesRegex(FormatoInesperado, "frecuencia.*anual"):
            tablas_eurostat.filas_de_la_tabla("isoc_ai_iaiu", tabla)

    def test_mundo_rechaza_perdida_del_empleo_de_un_pais(self) -> None:
        """El contraste de ILOSTAT no puede recibir cobertura vacía o sin país requerido."""
        filas = [fila for fila in filas_del_mundo() if fila["tabla"] != mundo.EMPLEO or fila["geo"] != "DE"]
        self.assertIn("sin total: ['DE']", " ".join(controlar_mundo(filas).fallidos))

    def test_mundo_no_mezcla_la_actividad_de_las_empresas(self) -> None:
        """Una base distinta de actividades no sustituye a la empresa de todas las actividades."""
        filas = filas_del_mundo()
        for fila in filas:
            if fila["tabla"] == "isoc_eb_ai" and fila["geo"] == UE27:
                fila["nace_r2"] = "J"
        self.assertIn("cada indicador tiene cifra", " ".join(controlar_mundo(filas).fallidos))

    def test_mundo_no_admite_otra_base_de_empleo(self) -> None:
        """El empleo por ocupación no cambia de unidad ni de edad sin revisión."""
        for clave, valor in (("unit", "PC"), ("age", "Y15-64")):
            with self.subTest(clave=clave):
                filas = filas_del_mundo()
                for fila in filas:
                    if fila["tabla"] == mundo.EMPLEO:
                        fila[clave] = valor
                self.assertIn("unidad, edad", " ".join(controlar_mundo(filas).fallidos))


if __name__ == "__main__":
    unittest.main()
