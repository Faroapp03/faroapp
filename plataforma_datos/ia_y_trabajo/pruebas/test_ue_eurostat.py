"""Pruebas autónomas de series, preparación y controles de la UE-27 de Eurostat."""

import unittest
from typing import Any
from unittest import mock

import plataforma_datos.ia_y_trabajo.comun.tablas_eurostat as tablas_eurostat
import plataforma_datos.ia_y_trabajo.fuentes.ue_eurostat.lector as ue_eurostat
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado
from plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_ue import RECUENTO_ESPECIALISTAS_TIC, IndicadorUe
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import UE27

INDICADOR = IndicadorUe("prueba", "isoc_sks_itspt", {"unit": "PC_EMP"}, ("Prueba", "Prova"), "empleo")
EN_SERIE = INDICADOR._replace(desde=2022)
# Códigos de las empresas con IA que usan robots y texto, vigilados por los controles.
CODIGO_ROBOTS = "E_AI_TAR"
CODIGO_TEXTO = "E_AI_TTM"

# Las cifras que publicaba Eurostat el 11/10/2026 en las tablas de INDICADORES_UE (catalogo_ue.py), por indicador y año:
# Son una regresión del lector, no una regla para las publicaciones posteriores.
REFERENCIA: dict[str, dict[int, float]] = {
    "empresas-ia-10-49": {2025: 17.0},
    "empresas-ia-50-249": {2025: 30.36},
    "empresas-ia-250-o-mas": {2025: 55.03},
    "empresas-ia-texto": {2025: 11.75},
    "empresas-ia-imagen-video-sonido": {2025: 9.55},
    "empresas-ia-lenguaje": {2025: 8.76},
    "empresas-ia-voz": {2025: 7.22},
    "empresas-ia-automatizacion": {2025: 5.35},
    "empresas-ia-aprendizaje-automatico": {2025: 5.1},
    "empresas-ia-reconocimiento-imagenes": {2025: 3.78},
    "empresas-ia-robots": {2025: 1.39},
    "empresas-ia-uso-marketing-ventas": {2025: 6.92},
    "empresas-ia-uso-administracion": {2025: 6.19},
    "empresas-ia-uso-finanzas": {2025: 4.61},
    "empresas-ia-uso-produccion": {2025: 4.14},
    "empresas-ia-uso-seguridad-informatica": {2025: 3.94},
    "empresas-ia-uso-id-innovacion": {2025: 3.8},
    "empresas-ia-uso-logistica": {2025: 1.21},
    "empresas-ia-motivo-la-penso": {2025: 11.1},
    "empresas-ia-motivo-conocimientos": {2025: 7.76},
    "empresas-ia-motivo-dudas-legales": {2025: 5.92},
    "empresas-ia-motivo-proteccion-datos": {2025: 5.82},
    "empresas-nube-datos-ia": {2025: 63.2},
    "empresas-ia-seccion-j": {2025: 62.52},
    "empresas-ia-seccion-f": {2025: 10.79},
    "ia-generativa-uso-privado": {2025: 25.49},
    "ia-generativa-educacion-formal": {2025: 9.32},
    "ia-generativa-16-24": {2025: 63.81},
    "ia-generativa-25-34": {2025: 50.65},
    "ia-generativa-35-44": {2025: 38.96},
    "ia-generativa-45-54": {2025: 28.35},
    "ia-generativa-55-64": {2025: 16.49},
    "ia-generativa-65-74": {2025: 6.5},
    "ia-generativa-no-la-usa-no-la-necesita": {2025: 64.25},
    "ia-generativa-no-la-usa-no-sabe-usarla": {2025: 13.77},
    "ia-generativa-no-la-usa-no-sabia-que-existia": {2025: 8.47},
    "ia-generativa-no-la-usa-privacidad-seguridad": {2025: 7.25},
    "ia-generativa-uso-privado-mujeres": {2025: 22.76},
    "ia-generativa-educacion-formal-mujeres": {2025: 9.3},
    "ia-generativa-uso-privado-hombres": {2025: 28.27},
    "ia-generativa-educacion-formal-hombres": {2025: 9.35},
    "ia-generativa-trabajo-ocupados": {2025: 21.8},
    "ia-generativa-trabajo-estudios-5-8": {2025: 30.89},
    "ia-generativa-trabajo-estudios-3-4": {2025: 9.51},
    "ia-generativa-trabajo-estudios-0-2": {2025: 3.98},
    "capacidades-digitales-basicas": {2025: 60.4, 2021: 53.92},
    "capacidades-digitales-basicas-mujeres": {2025: 59.04},
    "capacidades-digitales-basicas-hombres": {2025: 61.79},
    "capacidades-digitales-basicas-16-24": {2025: 74.55},
    "capacidades-digitales-basicas-55-74": {2025: 42.6},
    "capacidades-digitales-basicas-no-manual": {2025: 76.88},
    "capacidades-digitales-basicas-manual": {2025: 45.68},
    "especialistas-tic": {2025: 10450.8},
    "especialistas-tic-empleo": {2025: 5.0},
    "especialistas-tic-mujeres": {2025: 19.5},
    "empresas-formacion-tic": {2024: 22.29},
    "empresas-formacion-tic-resto-del-personal": {2024: 19.36},
    "empresas-formacion-tic-especialistas": {2024: 11.44},
    "capacidades-digitales-avanzadas": {2025: 31.43, 2021: 26.46},
    "capacidades-digitales-solo-basicas": {2025: 28.97},
    "capacidades-digitales-bajas": {2025: 17.4},
    "capacidades-digitales-reducidas": {2025: 9.04},
    "capacidades-digitales-limitadas": {2025: 4.41},
    "capacidades-digitales-ninguna": {2025: 2.54},
    "capacidades-digitales-sin-evaluar": {2025: 6.21},
    "capacidades-digitales-area-comunicacion": {2025: 92.07},
    "capacidades-digitales-area-informacion": {2025: 86.47},
    "capacidades-digitales-area-resolucion-problemas": {2025: 86.07},
    "capacidades-digitales-area-seguridad": {2025: 74.63},
    "capacidades-digitales-area-contenidos": {2025: 70.51},
    "pymes-intensidad-digital-basica-v3": {2025: 71.39},
    "pymes-intensidad-digital-basica-v4": {2024: 72.91},
    "empresas-especialistas-tic": {2024: 20.05},
    "empresas-buscan-especialistas-tic": {2024: 9.55},
    "empresas-vacantes-tic-dificiles": {2024: 5.49},
    "vacantes-tic-dificiles-entre-las-que-buscaron": {2024: 57.5, 2022: 62.85},
    "especialistas-tic-dificultad-faltan-candidaturas": {2024: 43.24},
    "especialistas-tic-dificultad-salarios": {2024: 41.86},
    "especialistas-tic-dificultad-formacion": {2024: 41.73},
    "especialistas-tic-dificultad-experiencia": {2024: 40.9},
}


def fila(anio: int, valor: float | None, marca: str | None = None, geo: str = UE27) -> dict[str, Any]:
    """Una fila preparada de `isoc_sks_itspt` con la unidad del indicador de prueba.

    Returns:
        La fila, con el año, el valor, la marca y el territorio dados.
    """
    return {"tabla": "isoc_sks_itspt", "unit": "PC_EMP", "geo": geo, "anio": anio, "valor": valor, "marca": marca}


def tablas_con_las_etiquetas(cambios: dict[str, str] | None = None) -> dict[str, Any]:
    """Las etiquetas vigiladas, como las guarda la preparación, con los cambios que se pidan.

    Returns:
        Las tablas con sus etiquetas, por tabla.
    """
    tablas: dict[str, Any] = {}
    for indicador in ue_eurostat.TODOS:
        etiquetas = tablas.setdefault(indicador.tabla, {"actualizado": "2026-06-15", "etiquetas": {}})["etiquetas"]
        for dimension, codigo in indicador.codigos.items():
            etiquetas[codigo] = (cambios or {}).get(codigo, ue_eurostat.etiqueta_esperada(dimension, codigo))
    return tablas


def filas_de_referencia() -> list[dict[str, Any]]:
    """Una fila por cada cifra de referencia, con los códigos de su indicador: lo que daría una lectura correcta.

    Returns:
        Las filas preparadas de la UE-27.
    """
    por_id = {indicador.id: indicador for indicador in ue_eurostat.TODOS}
    return [
        {"tabla": por_id[id_].tabla, **por_id[id_].codigos, "geo": UE27, "anio": anio, "valor": valor, "marca": None}
        for id_, por_anio in REFERENCIA.items()
        for anio, valor in por_anio.items()
    ]


class PruebaSerie(unittest.TestCase):
    """De las filas de Eurostat a la serie de un indicador de la UE-27."""

    def test_sin_desde_solo_la_cifra_mas_reciente(self) -> None:
        """Sin serie, la cifra más reciente de la UE-27, con su nota; otro territorio no cuenta."""
        filas = [fila(2023, 4.0), fila(2025, 5.0, "e"), fila(2025, 9.0, geo="ES")]
        self.assertEqual(ue_eurostat.serie(filas, INDICADOR), [{"valor": 5.0, "anio": 2025, "nota": "estimada"}])

    def test_con_desde_la_serie_va_de_la_mas_reciente_a_la_mas_antigua(self) -> None:
        """Con serie, desde su año, la más reciente primero; la confidencial no entra."""
        filas = [fila(2021, 3.0), fila(2022, 4.0, "b"), fila(2024, 5.0), fila(2023, None, "c")]
        self.assertEqual(
            ue_eurostat.serie(filas, EN_SERIE),
            [{"valor": 5.0, "anio": 2024, "nota": None}, {"valor": 4.0, "anio": 2022, "nota": "ruptura_de_serie"}],
        )

    def test_la_confidencial_no_es_la_mas_reciente(self) -> None:
        """Una cifra confidencial no tiene valor: la más reciente es la anterior."""
        filas = [fila(2025, 7.0, "c"), fila(2024, 5.0)]
        self.assertEqual(ue_eurostat.serie(filas, INDICADOR), [{"valor": 5.0, "anio": 2024, "nota": None}])


class PruebaValidacion(unittest.TestCase):
    """Los controles: etiquetas literales, cobertura, rango y cifras de referencia."""

    def test_la_lectura_correcta_pasa_todos_los_controles(self) -> None:
        """Con las cifras y las etiquetas de referencia, ningún control falla."""
        controles = Controles()
        ue_eurostat._controles(controles, filas_de_referencia(), tablas_con_las_etiquetas())
        self.assertEqual(controles.fallidos, [])

    def test_las_cifras_de_la_primera_captura_se_conservan_en_la_serie(self) -> None:
        """El lector conserva valores y años de la captura usada como regresión."""
        filas = filas_de_referencia()
        for indicador in ue_eurostat.TODOS:
            with self.subTest(indicador=indicador.id):
                self.assertEqual(
                    {cifra["anio"]: cifra["valor"] for cifra in ue_eurostat.serie(filas, indicador)},
                    REFERENCIA[indicador.id],
                )

    def test_si_eurostat_cambia_una_etiqueta_la_validacion_se_detiene(self) -> None:
        """Una etiqueta oficial distinta detiene la validación y nombra el código."""
        controles = Controles()
        cambio = {"E_ITSPRCR2": "Enterprise recruited personnel for jobs requiring ICT skills"}
        ue_eurostat._controles(controles, filas_de_referencia(), tablas_con_las_etiquetas(cambio))
        self.assertFalse(controles.admitido)
        self.assertIn("E_ITSPRCR2", " ".join(controles.fallidos))

    def test_un_codigo_de_dos_dimensiones_se_compara_en_cada_tabla(self) -> None:
        """F es «Females» en el sexo y «Construction» en la CNAE: cada tabla se compara con la suya, sin fundirlas."""
        controles = Controles()
        ue_eurostat._controles(controles, filas_de_referencia(), tablas_con_las_etiquetas())
        self.assertEqual(controles.fallidos, [])
        tablas = tablas_con_las_etiquetas()
        con_cnae_f = next(indicador.tabla for indicador in ue_eurostat.TODOS if indicador.codigos.get("nace_r2") == "F")
        tablas[con_cnae_f]["etiquetas"]["F"] = "Females"
        controles = Controles()
        ue_eurostat._controles(controles, filas_de_referencia(), tablas)
        self.assertIn(f"{con_cnae_f}:F", " ".join(controles.fallidos))

    def test_un_indicador_sin_cifra_se_nombra(self) -> None:
        """Un indicador sin cifra en las filas se nombra."""
        sin_robots = [cifra for cifra in filas_de_referencia() if cifra.get("indic_is") != CODIGO_ROBOTS]
        controles = Controles()
        ue_eurostat._controles(controles, sin_robots, tablas_con_las_etiquetas())
        self.assertIn("empresas-ia-robots", " ".join(controles.fallidos))

    def test_una_revision_compatible_no_se_confunde_con_error_de_lectura(self) -> None:
        """Una revisión dentro del rango y con igual definición pasa los controles."""
        distinta = [
            {**cifra, "valor": 99.0} if cifra.get("indic_is") == CODIGO_TEXTO else cifra
            for cifra in filas_de_referencia()
        ]
        controles = Controles()
        ue_eurostat._controles(controles, distinta, tablas_con_las_etiquetas())
        self.assertEqual(controles.fallidos, [])

    def test_dos_cifras_del_mismo_anio_de_un_indicador_se_nombran(self) -> None:
        """Si una dimensión no fijada trae dos valores, salen dos cifras del mismo año: no se elige una en silencio."""
        filas = filas_de_referencia()
        doble = next(cifra for cifra in filas if cifra.get("indic_is") == CODIGO_TEXTO)
        filas.append({**doble, "otra_dimension": "otro", "valor": 1.0})
        controles = Controles()
        ue_eurostat._controles(controles, filas, tablas_con_las_etiquetas())
        self.assertIn("con varias: ['empresas-ia-texto']", " ".join(controles.fallidos))


class PruebaMarcasCompuestas(unittest.TestCase):
    """Las marcas completas conservan la fiabilidad y excluyen las cifras no publicables."""

    def test_las_marcas_compuestas_llevan_la_nota_prioritaria(self) -> None:
        """Porcentajes y recuentos conservan bu/be, incluidos los ceros y las series desde un año."""
        for indicador in (INDICADOR, RECUENTO_ESPECIALISTAS_TIC):
            for desde in (None, 2022):
                for marca, nota in (("bu", "poco_fiable"), ("be", "estimada")):
                    with self.subTest(unidad=indicador.unidad, desde=desde, marca=marca):
                        cifras = [{**fila(2025, 0.0, marca), **indicador.codigos}]
                        self.assertEqual(
                            ue_eurostat.serie(cifras, indicador._replace(desde=desde)),
                            [{"valor": 0.0, "anio": 2025, "nota": nota}],
                        )

    def test_una_marca_desconocida_no_se_da_como_firme(self) -> None:
        """Una letra sin significado declarado se diagnostica en porcentajes y recuentos."""
        for indicador in (INDICADOR, RECUENTO_ESPECIALISTAS_TIC):
            for desde in (None, 2022):
                with self.subTest(unidad=indicador.unidad, desde=desde):
                    cifras = [{**fila(2025, 5.0, "b?"), **indicador.codigos}]
                    with self.assertRaisesRegex(FormatoInesperado, "no tiene nota declarada"):
                        ue_eurostat.serie(cifras, indicador._replace(desde=desde))

    def test_confidencial_o_no_aplicable_compuesta_no_es_la_ultima_cifra(self) -> None:
        """Aunque traigan valor, bc/ez no entran: la anterior con valor cero sigue siendo publicable."""
        for indicador in (INDICADOR, RECUENTO_ESPECIALISTAS_TIC):
            for desde in (None, 2022):
                for marca in ("bc", "ez"):
                    with self.subTest(unidad=indicador.unidad, desde=desde, marca=marca):
                        cifras = [
                            {**fila(2025, 9.0, marca), **indicador.codigos},
                            {**fila(2024, 0.0), **indicador.codigos},
                        ]
                        self.assertEqual(
                            ue_eurostat.serie(cifras, indicador._replace(desde=desde)),
                            [{"valor": 0.0, "anio": 2024, "nota": None}],
                        )


def tabla_sintetica(periodo: str = "2025") -> dict[str, Any]:
    """Una tabla JSON-stat mínima, con un porcentaje y su día civil de actualización.

    Returns:
        La tabla de un año de la UE-27.
    """
    return {
        "class": "dataset",
        "id": ["unit", "geo", "time"],
        "size": [1, 1, 1],
        "dimension": {
            dimension: {"category": {"index": {codigo: 0}, "label": {codigo: codigo}}}
            for dimension, codigo in (("unit", "PC_EMP"), ("geo", UE27), ("time", periodo))
        },
        "value": {"0": 5.0},
        "updated": "2026-06-15T00:30:00+0200",
    }


class PruebaPreparacion(unittest.TestCase):
    """La preparación conserva el día civil y atribuye fechas o periodos inválidos al original."""

    def preparar_tabla(self, contenido: dict[str, Any]) -> dict[str, Any]:
        """Prepara una tabla aislada y devuelve sus metadatos sin escribir archivos.

        Returns:
            Los metadatos de la tabla sintética.
        """
        tabla = INDICADOR.tabla
        with (
            mock.patch.object(ue_eurostat, "TABLAS_DE_LA_UE", (tabla,)),
            mock.patch.object(tablas_eurostat, "comprobar_originales"),
            mock.patch.object(tablas_eurostat, "original", return_value="sintetico.json"),
            mock.patch.object(tablas_eurostat, "leer_json", return_value=contenido),
            mock.patch.object(tablas_eurostat, "guardar_jsonl"),
            mock.patch.object(tablas_eurostat, "guardar_json") as guardar,
        ):
            ue_eurostat.preparar()
        return guardar.call_args.args[1][tabla]

    def test_actualizacion_conserva_el_dia_civil_de_la_fuente(self) -> None:
        """Un instante próximo a medianoche no se desplaza a UTC."""
        self.assertEqual(self.preparar_tabla(tabla_sintetica())["actualizado"], "2026-06-15")

    def test_actualizacion_invalida_nombra_el_original(self) -> None:
        """Fechas imposibles, campo ausente, tipos erróneos y sufijos inválidos tienen diagnóstico propio."""
        for actualizado in (None, 20260615, "2026-02-30T11:00:00+0200", "2026-06-15no-es-fecha", ""):
            with self.subTest(actualizado=actualizado):
                contenido = {**tabla_sintetica(), "updated": actualizado}
                with self.assertRaisesRegex(FormatoInesperado, "eurostat-isoc_sks_itspt.json.*actualización"):
                    self.preparar_tabla(contenido)
        contenido = tabla_sintetica()
        contenido.pop("updated")
        with self.assertRaisesRegex(FormatoInesperado, "eurostat-isoc_sks_itspt.json.*actualización"):
            self.preparar_tabla(contenido)

    def test_periodos_invalidos_se_rechazan_al_preparar(self) -> None:
        """La integración del lector admite solo cuatro cifras ASCII y excluye el año cero."""
        for periodo in ("2025-Q1", "２０２５", "0000"):
            with (
                self.subTest(periodo=periodo),
                self.assertRaisesRegex(FormatoInesperado, "isoc_sks_itspt.*no es un año"),
            ):
                self.preparar_tabla(tabla_sintetica(periodo))

    def test_tabla_sin_cifras_ni_marcas_se_rechaza_al_preparar(self) -> None:
        """La integración del lector no guarda metadatos de una tabla vacía."""
        contenido = {**tabla_sintetica(), "value": {}}
        with self.assertRaisesRegex(FormatoInesperado, "isoc_sks_itspt.*tabla sin filas"):
            self.preparar_tabla(contenido)


if __name__ == "__main__":
    unittest.main()
