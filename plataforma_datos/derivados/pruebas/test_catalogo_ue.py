"""Catálogo europeo: códigos, unidades, identificadores y catálogos compartidos."""

import unittest

import plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_ue as catalogo_ue
import plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales as constantes_datos_globales
import plataforma_datos.ia_y_trabajo.fuentes.ue_eurostat.lector as ue_eurostat
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_ue import (
    INDICADORES_UE,
    RECUENTO_ESPECIALISTAS_TIC,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    INDICADORES_EUROSTAT,
    UNIDAD_DEL_RECUENTO,
    UNIDAD_PORCENTAJE,
)
from plataforma_datos.ia_y_trabajo.pruebas.test_ue_eurostat import REFERENCIA


class PruebaCatalogo(unittest.TestCase):
    """El catálogo de la UE-27: único, sin repetir los de los países, con sus códigos vigilados y su unidad."""

    def test_cada_indicador_una_vez_y_ninguno_repite_uno_de_los_paises(self) -> None:
        """Ningún id se repite ni pisa uno del catálogo de los países."""
        ids = [indicador.id for indicador in ue_eurostat.TODOS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertFalse(set(ids) & {str(indicador["id"]) for indicador in INDICADORES_EUROSTAT})

    def test_cada_codigo_tiene_su_etiqueta_y_cada_indicador_su_cifra_de_referencia(self) -> None:
        """Cada código usado está vigilado y cada indicador tiene su cifra de referencia."""
        usados = {codigo for indicador in ue_eurostat.TODOS for codigo in indicador.codigos.values()}
        self.assertEqual(usados, set(ue_eurostat.ETIQUETAS))
        self.assertEqual(set(REFERENCIA), {indicador.id for indicador in ue_eurostat.TODOS})

    def test_las_unidades_de_eurostat_son_las_de_su_base(self) -> None:
        """La unidad de Eurostat de cada bloque es la de la base que dice su definición."""
        unidades = {indicador.base: indicador.codigos["unit"] for indicador in INDICADORES_UE}
        self.assertEqual(unidades["personas"], "PC_IND")
        self.assertEqual(unidades["personas-sin-ia-generativa"], "PC_IND_IUAIX")
        self.assertEqual(unidades["empresas-que-buscaron-tic"], "PC_ENT_ITSPRCR2")
        self.assertEqual(RECUENTO_ESPECIALISTAS_TIC.codigos, {"unit": "THS_PER"})


class PruebaUnidadDelIndicador(unittest.TestCase):
    """La unidad y el texto de la definición salen del propio indicador, no de quien lo pide."""

    def test_una_unidad_que_contradice_al_indicador_se_rechaza(self) -> None:
        """Una unidad explícita no puede contradecir la definición de porcentaje o de miles."""
        for indicador, unidad in (
            (RECUENTO_ESPECIALISTAS_TIC, UNIDAD_PORCENTAJE),
            (INDICADORES_UE[0], UNIDAD_DEL_RECUENTO),
        ):
            with (
                self.subTest(indicador=indicador.id),
                self.assertRaisesRegex(FormatoInesperado, indicador.id + ".*unidad"),
            ):
                catalogo_ue.para_el_contrato(indicador, unidad)

    def test_la_unidad_explicita_coherente_conserva_el_contrato_entero(self) -> None:
        """El consumidor que aún pasa la unidad correcta obtiene exactamente el contrato implícito."""
        for indicador in (*INDICADORES_UE, RECUENTO_ESPECIALISTAS_TIC):
            self.assertEqual(
                catalogo_ue.para_el_contrato(indicador, indicador.unidad), catalogo_ue.para_el_contrato(indicador)
            )

    def test_un_recuento_lleva_su_unidad_y_su_definicion_sin_que_nadie_se_la_diga(self) -> None:
        """El recuento de especialistas en TIC es «Miles de…»; cualquier otro indicador, un porcentaje."""
        recuento = catalogo_ue.para_el_contrato(RECUENTO_ESPECIALISTAS_TIC)
        self.assertEqual(recuento["unidad"], UNIDAD_DEL_RECUENTO)
        self.assertTrue(catalogo_ue.definicion(RECUENTO_ESPECIALISTAS_TIC)["es"].startswith("Miles de"))
        otro = catalogo_ue.para_el_contrato(INDICADORES_UE[0])
        self.assertEqual(otro["unidad"], UNIDAD_PORCENTAJE)
        propio = RECUENTO_ESPECIALISTAS_TIC._replace(id="otro-recuento")
        self.assertTrue(catalogo_ue.definicion(propio)["es"].startswith("Miles de"))


class PruebaIdsDeLaIaGenerativa(unittest.TestCase):
    """Los indicadores de IA generativa por fin y por sexo tienen estos ids y estos nombres."""

    def test_ids_y_nombres_por_fin_y_sexo(self) -> None:
        """Por cada fin: todas las personas, mujeres y hombres, con el id que los distingue."""
        ids = [indicador.id for indicador in INDICADORES_UE if indicador.id.startswith("ia-generativa-uso-privado")]
        self.assertEqual(
            ids,
            ["ia-generativa-uso-privado", "ia-generativa-uso-privado-mujeres", "ia-generativa-uso-privado-hombres"],
        )
        todas = catalogo_ue._ia_generativa_para("I_IUAIPR", "IND_TOTAL", ("", ""))
        self.assertEqual(todas.nombre[0], "Personas que usan IA generativa para uso privado")
        mujeres = catalogo_ue._ia_generativa_para("I_IUAIPR", "F_Y16_74", ("mujeres", "dones"))
        self.assertEqual(
            mujeres.nombre,
            ("Mujeres que usan IA generativa para uso privado", "Dones que fan servir IA generativa per a ús privat"),
        )


class PruebaTramos(unittest.TestCase):
    """Los tramos de edad y de estudios de Eurostat se leen por su forma, no por la posición de sus caracteres."""

    def test_tramos_de_edad_y_de_estudios(self) -> None:
        """«Y25_34» y «I0_2» dan su principio y su fin; los identificadores de estudios y de edad salen de ellos."""
        self.assertEqual(catalogo_ue._tramo("Y25_34"), ("25", "34"))
        self.assertEqual(catalogo_ue._tramo("I0_2"), ("0", "2"))
        self.assertEqual(catalogo_ue._edad("Y25_34"), ("25 a 34 años", "25 a 34 anys"))
        ids = {indicador.id for indicador in INDICADORES_UE}
        self.assertIn("ia-generativa-25-34", ids)
        self.assertIn("ia-generativa-trabajo-estudios-0-2", ids)

    def test_un_tramo_con_otra_forma_se_detiene(self) -> None:
        """Un código que no es letra, cifras, «_» y cifras no se corta por posición: lanza un error con su nombre."""
        for codigo in ("Y65_", "ISCO0_5x", "Y65_74_80", ""):
            with self.subTest(codigo=codigo), self.assertRaisesRegex(FormatoInesperado, "no tiene la forma"):
                catalogo_ue._tramo(codigo)


class PruebaSoloLectura(unittest.TestCase):
    """Los catálogos que comparten varios módulos no se pueden cambiar por accidente desde uno de ellos."""

    def test_los_catalogos_compartidos_son_de_solo_lectura(self) -> None:
        """Ni los códigos de un indicador ni los catálogos de módulo admiten una asignación."""
        compartidos = [
            *(indicador.codigos for indicador in (*INDICADORES_UE, RECUENTO_ESPECIALISTAS_TIC)),
            catalogo_ue.TODAS_LAS_EMPRESAS,
            catalogo_ue.BASES,
            catalogo_ue.CLAVES,
            *(
                getattr(catalogo_ue, nombre)
                for nombre in (
                    "TECNOLOGIAS",
                    "USOS",
                    "MOTIVOS_DE_LAS_EMPRESAS",
                    "PARA_QUE",
                    "SEXOS",
                    "ESTUDIOS",
                    "MOTIVOS_DE_LAS_PERSONAS",
                    "NIVELES",
                    "AREAS",
                    "GRUPOS_DE_LAS_CAPACIDADES",
                    "DIFICULTADES",
                    "FORMACION_TIC",
                )
            ),
            catalogo_ue.ENCUESTAS,
            constantes_datos_globales.NOTAS,
            constantes_datos_globales.NOTA_DE_LA_MARCA,
            constantes_datos_globales.CON_CATALUNA_DEL_IDESCAT,
        ]
        for catalogo in compartidos:
            with self.assertRaises(TypeError):
                catalogo["nuevo"] = "valor"


if __name__ == "__main__":
    unittest.main()
