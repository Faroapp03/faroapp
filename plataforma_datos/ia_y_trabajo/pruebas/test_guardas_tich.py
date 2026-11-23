"""Regresiones de entradas defectuosas y aislamiento de los resultados de TIC-H."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.tich import errores_del_ine, estimacion
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion import primera
from plataforma_datos.ia_y_trabajo.fuentes.tich.motivos_no_uso import no_sabian_como


class PruebaGuardasTich(unittest.TestCase):
    """Los bordes de entrada fallan con motivo y los contenedores devueltos no alteran las reglas."""

    def test_mediana_sin_valores_falla_con_motivo_y_conserva_los_casos_validos(self) -> None:
        """Una lista vacía no tiene mediana; los casos unitario, impar y par mantienen sus cifras."""
        with self.assertRaisesRegex(FormatoInesperado, "no hay valores.*mediana"):
            errores_del_ine.mediana(iter(()))
        for valores, esperado in (([0.67], 0.67), ([0.25, 0.8, 0.6], 0.6), ([0.7, 0.6], 0.65)):
            with self.subTest(valores=valores):
                self.assertEqual(errores_del_ine.mediana(iter(valores)), esperado)

    def test_contraste_sin_areas_comunes_falla_con_motivo(self) -> None:
        """No se calculan medianas ni un contraste favorable sin áreas comparables."""
        with self.assertRaisesRegex(FormatoInesperado, "no hay áreas comunes"):
            errores_del_ine.contraste_errores_ine(Controles(), {}, {estimacion.TOTAL_NACIONAL: 0.5})

    def test_contraste_no_divide_por_un_error_kish_no_positivo_o_no_finito(self) -> None:
        """Un denominador inutilizable detiene el contraste con su área y sin fabricar una razón."""
        for valor in (0.0, -0.1, float("nan"), float("inf")):
            for campo in ("cv_kish_pct", "error_kish_puntos"):
                calculado = {estimacion.TOTAL_NACIONAL: {"cv_kish_pct": 1.0, "error_kish_puntos": 1.0}}
                calculado[estimacion.TOTAL_NACIONAL][campo] = valor
                with (
                    self.subTest(valor=valor, campo=campo),
                    self.assertRaisesRegex(FormatoInesperado, "error de Kish.*finito y positivo"),
                ):
                    errores_del_ine.contraste_errores_ine(Controles(), calculado, {estimacion.TOTAL_NACIONAL: 0.5})

    def test_acepta_un_iterador_de_respuestas_afirmativas(self) -> None:
        """La pertenencia se aplica por igual a todas las filas, aunque los códigos lleguen en un iterador."""
        filas = [{"FACTOR_P": "1", "uso": "1"}] * 2
        self.assertEqual(estimacion.proporcion_ponderada(filas, "uso", iter(["1"])), (1.0, 2.0))

    def test_sin_personas_o_pesos_validos_no_se_estima(self) -> None:
        """Una muestra vacía o un peso no positivo, no finito o no numérico se rechazan con motivo."""
        for filas in ([], *([{"FACTOR_P": peso, "uso": "1"}] for peso in ("0", "-1", "nan", "inf", "x"))):
            with self.subTest(filas=filas), self.assertRaises(FormatoInesperado):
                estimacion.proporcion_ponderada(filas, "uso")

    def test_cifra_no_numerica_se_rechaza_con_su_tabla(self) -> None:
        """Una marca no numérica se explica como error de la tabla, sin un ValueError suelto."""
        with tempfile.TemporaryDirectory() as temporal:
            for nombre, funcion, contenido in (
                (
                    "ine-76849.csv",
                    tich._publicadas_errores,
                    f"Total Nacional;Comunidades y Ciudades Autónomas;Principales usos de TIC;Total\n"
                    f"Total Nacional;;{tich.FILA_CONTRASTE};..\n",
                ),
                (
                    "ine-76444.csv",
                    tich._publicadas_uso,
                    "Población de referencia;Características socioeconómicas;Inteligencia Artificial Generativa;Total\n"
                    f"{tich.POBLACION_PUBLICADA};Ocupación principal: Manual;Total;..\n",
                ),
            ):
                ruta = Path(temporal) / nombre
                ruta.write_text(contenido, encoding="utf-8")
                with (
                    self.subTest(tabla=nombre),
                    mock.patch.object(tich, "original", return_value=ruta),
                    self.assertRaisesRegex(FormatoInesperado, nombre),
                ):
                    funcion(primera())

    def test_jsonstat_denso_y_disperso_dan_la_misma_epa(self) -> None:
        """JSON-stat admite listas densas y objetos dispersos; ambos conservan cifras y orden."""
        base = {
            "extension": {"id": tich.EPA_DATASET},
            "dimension": {"isco08": {"category": {"index": {"OC23": 0, "OC24": 1}}}},
        }
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "epa.json"
            for valores in ({"0": 50.0, "1": None}, [50.0, None]):
                ruta.write_text(json.dumps({**base, "value": valores}), encoding="utf-8")
                with self.subTest(valores=valores), mock.patch.object(tich, "original", return_value=ruta):
                    self.assertEqual(tich._epa_por_isco2(primera()), {"23": 50.0})

    def test_grupo_publicado_sin_cifra_registra_el_control_fallido(self) -> None:
        """Si un grupo no alcanza la muestra, el contraste falla con su nombre, sin KeyError."""
        controles = Controles()
        tich._controles_publicadas(
            controles,
            {"espana_grupos": {"manual": {"muestra": 99}}},
            {"uso": {"manual": {"poblacion": 100, "pct": 10}}},
        )
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("manual", controles.fallidos[0])

    def test_el_conjunto_no_comparte_el_diccionario_de_bloques(self) -> None:
        """Modificar un conjunto devuelto no cambia la regla que se aplicará a la siguiente preparación."""
        niveles = (
            "espana_isco2",
            "espana_isco1",
            "espana_bloques",
            "espana_grupos",
            "cataluna_isco1",
            "cataluna_grupos",
        )
        preparado = {"estimaciones": dict.fromkeys(niveles, {}), "clases_por_isco2": {}}
        with mock.patch.object(tich, "BLOQUES", {"25": "25+35"}):
            conjunto = tich._conjunto_validado(preparado, {}, edicion=primera())
            conjunto["bloque_por_isco2"]["25"] = "alterado"
            self.assertEqual(tich.BLOQUES, {"25": "25+35"})

    def test_un_grupo_que_la_epa_no_confirma_se_da_en_su_gran_grupo_con_su_motivo(self) -> None:
        """El grupo bajado no va a 2 cifras; el dato lo dice con su motivo y declara el año de la EPA."""
        grupo = {"pct": 50.0, "ic95": [40.0, 60.0], "muestra": 200, "regla_nchs": {"publicable": True}}
        niveles = ("espana_isco1", "espana_bloques", "espana_grupos", "cataluna_isco1", "cataluna_grupos")
        estimaciones = {**dict.fromkeys(niveles, {}), "espana_isco2": {"21": grupo, "26": grupo}}
        preparado = {"estimaciones": estimaciones, "clases_por_isco2": {}}
        conjunto = tich._conjunto_validado(preparado, {}, {"26": "reparto-distinto-de-la-epa"}, edicion=primera())
        self.assertEqual(list(conjunto["espana_isco2"]), ["21"])
        self.assertEqual(conjunto["grupos_en_su_gran_grupo"], {"26": "reparto-distinto-de-la-epa"})
        self.assertEqual(conjunto["epa_anio"], "2025")


class PruebaUniversoDe16a74(unittest.TestCase):
    """Las estimaciones por grupo se hacen con las personas de 16 a 74 años, y la población publicada coincide."""

    def test_el_universo_deja_fuera_a_quien_no_tiene_entre_16_y_74_anios(self) -> None:
        """Una persona ocupada de 75 años o de 15 no entra; las de 16 y 74, sí."""
        filas = [{"EDAD": edad} for edad in ("15", "16", "40", "74", "75")]
        self.assertEqual([fila["EDAD"] for fila in tich.del_universo(filas)], ["16", "40", "74"])

    def test_una_persona_sin_edad_detiene_la_lectura(self) -> None:
        """La edad es obligatoria: una fila sin ella, o con una que no es un número, no se descarta en silencio."""
        for edad in ("", "4O", " 40", "٤٠", "４０"):
            with self.subTest(edad=edad), self.assertRaisesRegex(FormatoInesperado, "sin edad"):
                tich.del_universo([{"EDAD": "40"}, {"EDAD": edad}])

    def test_la_poblacion_publicada_tiene_que_coincidir_salvo_el_redondeo(self) -> None:
        """Con la base de 16 a 74 años la población de cada grupo es la de la tabla, con una persona de margen."""
        publicadas = {"uso": {"manual": {"poblacion": 6268320.0, "pct": 7.7}}}
        for poblacion, admitido in ((6268320, True), (6268321, True), (6271753, False)):
            with self.subTest(poblacion=poblacion):
                controles = Controles()
                calculada = {"espana_grupos": {"manual": {"pct": 7.7, "poblacion": poblacion}}}
                tich._controles_publicadas(controles, calculada, publicadas)
                self.assertEqual(controles.admitido, admitido, controles.lista)


class PruebaNoSabianComo(unittest.TestCase):
    """Base de la tabla 3.4.2 del Idescat: ocupados de Cataluña de 16 a 74 años que no usaron la IA y respondieron."""

    @staticmethod
    def fila(ocupacion: str, no_sabe: str, **cambios: str) -> dict[str, str]:
        """Una entrevista sintética de la base, con factor 1.

        Returns:
            La fila con las variables que usa el cálculo.
        """
        return {
            "CCAA": "09",
            "EDAD": "40",
            "IAG": "6",
            "IAG_NO3": no_sabe,
            "OCUPACION1": ocupacion,
            "FACTOR_P": "1",
            **cambios,
        }

    def test_cuenta_solo_la_base_y_separa_las_clases(self) -> None:
        """Quien usó la IA, es de otra comunidad, de otra edad o no respondió al motivo no entra en la base."""
        filas = [self.fila("1", "1")] * 60 + [self.fila("1", "6")] * 60 + [self.fila("6", "6")] * 99
        filas += [
            self.fila("1", "1", IAG="1"),
            self.fila("1", "1", CCAA="01"),
            self.fila("1", "1", EDAD="80"),
            self.fila("1", ""),
        ]
        diseno = {"layout": [{"name": "IAG_NO3", "description": "Razones: No sabía cómo utilizarlas"}]}
        calculado = no_sabian_como(filas, 200, tich.estimar, diseno)
        self.assertEqual(calculado["descripcion"], "Razones: No sabía cómo utilizarlas")
        manual, no_manual = calculado["por_clase"]["manual"], calculado["por_clase"]["no_manual"]
        self.assertEqual((manual["pct"], manual["muestra"]), (50.0, 120))
        # Por debajo de 100 entrevistas también se estima: es un cálculo de contraste, no una cifra publicada.
        self.assertEqual((no_manual["pct"], no_manual["muestra"]), (0.0, 99))
        self.assertIn("ic95", no_manual)
        # El intervalo necesita al menos dos entrevistas (muestra − 1 grados de libertad); con una, solo la muestra.
        with self.assertRaises(ValueError):
            tich.estimar([self.fila("1", "1")], "IAG_NO3", 200)
        una = no_sabian_como([self.fila("1", "1")], 200, tich.estimar, {"layout": []})
        self.assertEqual(una["por_clase"]["manual"], {"muestra": 1})
        dos = no_sabian_como([self.fila("1", "1")] * 2, 200, tich.estimar, {"layout": []})
        self.assertEqual((dos["por_clase"]["manual"]["pct"], dos["por_clase"]["manual"]["muestra"]), (100.0, 2))
        sin_base = no_sabian_como([self.fila("1", "1", IAG="1")], 200, tich.estimar, {"layout": []})
        self.assertEqual(
            sin_base, {"descripcion": None, "por_clase": {"manual": {"muestra": 0}, "no_manual": {"muestra": 0}}}
        )


if __name__ == "__main__":
    unittest.main()
