"""La captura vigente del visor conserva censo, periodos y procedencia sin revisión manual."""

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
import plataforma_datos.mercado.fuentes.cataluna.piezas.captura_cataluna as captura_cataluna
import plataforma_datos.mercado.fuentes.cataluna.piezas.controles_cataluna as controles_cataluna
import plataforma_datos.mercado.fuentes.observatori.lector as observatori
import plataforma_datos.mercado.fuentes.observatori.piezas.conjunto_observatori as conjunto_observatori
import plataforma_datos.mercado.fuentes.observatori.piezas.preparar_observatori as preparar_observatori
from plataforma_datos.comun import vigencia
from plataforma_datos.comun.nucleo import Controles, Descarga, FormatoInesperado, OriginalCambiado
from plataforma_datos.mercado.fuentes.observatori.piezas.constantes_observatori import CAMPOS, DEFINICIONES


class PruebaActualizacionCataluna(unittest.TestCase):
    """Regresiones de entradas que hoy confunden el periodo o la publicación."""

    def test_mes_unico_debe_ser_el_del_contexto(self) -> None:
        """Todas las filas de mayo siguen siendo incorrectas para un contexto de junio."""
        fila = {
            "mes": 202605,
            "personas_contratadas": 100,
            "contratos": 120,
            "pct_indefinidos": 50,
            "pct_mujeres_contratos": 50,
        }
        controles = Controles()
        with mock.patch.object(controles_cataluna, "MIN_OCUPACIONES_OBSERVATORI", 1):
            controles_cataluna.controles_observatori(controles, {"1111": fila}, {}, {"mes": 202606})
        self.assertEqual(controles.lista[0]["resultado"], "ERROR")

    def test_serie_con_hueco_no_es_del_periodo(self) -> None:
        """Trece meses distintos con el último correcto no bastan si falta un mes interior."""
        meses = [202505, *range(202507, 202513), *range(202601, 202607)]
        datos = json.dumps({"items": [{"c_mes": mes} for mes in meses]}).encode()
        self.assertFalse(observatori._meses_del_periodo("C_P5_EVOL_1", observatori.meses_de(datos), "2026-06"))

    def test_observatori_no_guarda_claves_repetidas(self) -> None:
        """Una ocupación duplicada en el mismo mes se rechaza antes de conservar el original."""
        fila = dict.fromkeys(CAMPOS.values())
        fila.update({"c_mes": 202606, "c_grup_primari": "1111", "c_comarca_42": "11", "d_comarca": "Baix Llobregat"})
        archivo = observatori.archivos("2026-06")[0]
        descarga = Descarga(json.dumps({"items": [fila, fila]}).encode(), archivo["url"], "application/json")
        with (
            mock.patch.object(observatori, "descargar_url", return_value=descarga),
            mock.patch.object(observatori, "conservar_o_sustituir") as guardar,
            self.assertRaisesRegex(FormatoInesperado, "duplicadas"),
        ):
            observatori._descargar_uno(archivo, "2026-06", None, False)
        guardar.assert_not_called()

    def test_columna_mes_repetida_no_se_oculta_en_observatori(self) -> None:
        """El último valor de c_mes no puede ocultar una columna anterior incompatible."""
        datos = b'{"items":[{"c_mes":202605,"c_mes":202606}]}'
        with self.assertRaisesRegex(FormatoInesperado, "duplicada"):
            observatori.meses_de(datos)

    def test_preparacion_observatori_rechaza_columna_repetida(self) -> None:
        """La preparación desde archivo usa el mismo lector estricto que la descarga."""
        datos = (
            b'{"items":[{"c_mes":202605,"c_mes":202606,"c_grup_primari":"1111",'
            b'"eo_cont_mes":1,"eo_per_cont_mes":1,"eo_dno_mes":1}]}'
        )
        with TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "serie.json"
            ruta.write_bytes(datos)
            with (
                mock.patch.object(preparar_observatori, "original", return_value=ruta),
                mock.patch.object(cataluna, "periodo_archivado", return_value="2026-06"),
                self.assertRaisesRegex(FormatoInesperado, "duplicada"),
            ):
                preparar_observatori.filas_del_original("C_P5_EVOL_1")

    def test_cambio_metodologico_no_se_acepta_por_conservar_frases(self) -> None:
        """Añadir una definición incompatible no queda admitido aunque sobrevivan las nueve frases conocidas."""
        anterior = {"metodologia_i_taules_de_detall": {"metodologia": {"texto": " ".join(DEFINICIONES.values())}}}
        nuevo = json.loads(json.dumps(anterior))
        nuevo["metodologia_i_taules_de_detall"]["metodologia"]["texto"] += (
            " Ara cada persona es compta per contracte, sense deduplicar."
        )
        self.assertTrue(all(preparar_observatori.metodologia(nuevo)["definiciones"].values()))
        datos = json.dumps(anterior).encode()
        archivo = observatori.archivos("2026-06")[-1]
        previo = {
            "archivo": archivo["archivo"],
            "sha256": hashlib.sha256(datos).hexdigest(),
            "descargado_utc": "2026-10-01T00:00:00+00:00",
        }
        with TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            (carpeta / archivo["archivo"]).write_bytes(datos)
            descarga = Descarga(json.dumps(nuevo).encode(), archivo["url"], "application/json")
            with (
                mock.patch.object(observatori, "ORIGINAL", carpeta),
                mock.patch.object(observatori, "descargar_url", return_value=descarga),
                self.assertRaises(OriginalCambiado),
            ):
                observatori._descargar_uno(archivo, "2026-06", previo, True)

    def test_cambio_ui_ajeno_a_metodologia_es_compatible(self) -> None:
        """La firma metodológica no convierte una corrección de interfaz en cambio de definición."""
        anterior = {
            "metodologia_i_taules_de_detall": {"metodologia": {"texto": " ".join(DEFINICIONES.values())}},
            "global": {"cabecera": "Anterior"},
        }
        nuevo = {**anterior, "global": {"cabecera": "Nueva"}}
        datos = json.dumps(anterior).encode()
        archivo = observatori.archivos("2026-06")[-1]
        previo = {
            "archivo": archivo["archivo"],
            "sha256": hashlib.sha256(datos).hexdigest(),
            "descargado_utc": "2026-10-01T00:00:00+00:00",
        }
        with TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            (carpeta / archivo["archivo"]).write_bytes(datos)
            descarga = Descarga(json.dumps(nuevo).encode(), archivo["url"], "application/json")
            with (
                mock.patch.object(observatori, "ORIGINAL", carpeta),
                mock.patch.object(observatori, "descargar_url", return_value=descarga),
            ):
                registro = observatori._descargar_uno(archivo, "2026-06", previo, True)
            self.assertEqual(registro["sha256"], hashlib.sha256(descarga.datos).hexdigest())

    def test_referencia_taula13_no_se_proyecta_fuera_de_su_ventana(self) -> None:
        """Septiembre de 2025 no contrasta una ventana entre diciembre de 2025 y de 2026."""
        controles = Controles()
        cambra = {"contratacion_cno4": {"1111": {"contratos_2025": 1000}}}
        fila = {"personas_contratadas": 2000, "personas_contratadas_anterior": 1800}
        aplicable = controles_cataluna.controles_contraste_contratacion(
            controles, {"1111": fila}, cambra, {"mes": 202612}
        )
        self.assertIs(aplicable, False)
        self.assertEqual(controles.lista, [])

    def test_fecha_publicacion_desconocida_no_es_fecha_consulta(self) -> None:
        """Sin fecha oficial ni calendario siguiente, el bloque distingue publicación desconocida."""
        bloque = vigencia.bloque("2026-09", None, None, "Sin calendario oficial", "Observatori")
        self.assertEqual(vigencia.problemas(bloque), [])
        self.assertFalse(vigencia.fecha_valida(None))
        bloque["siguiente_prevista"] = "2027-01"
        self.assertTrue(vigencia.problemas(bloque))

    def test_cita_futura_sin_fecha_publicada(self) -> None:
        """La cita oficial del nuevo periodo no sustituye publicación por la fecha de descarga."""
        cita = cataluna.CITA_OBSERVATORI_SIN_FECHA.format(periodo="setembre de 2026")
        bloque = conjunto_observatori.bloque_de_vigencia("2026-09", cita)
        self.assertIsNone(bloque["publicado"])
        self.assertEqual(bloque["periodo"], "2025-10/2026-09")
        self.assertEqual(vigencia.problemas(bloque), [])

    def test_septiembre_2025_solo_contrasta_el_intervalo_comparable(self) -> None:
        """Los límites del contraste histórico son septiembre de 2025 y de 2026, incluidos."""
        cambra = {"contratacion_cno4": {"1111": {"contratos_2025": 1000}}}
        fila = {"personas_contratadas": 1000, "personas_contratadas_anterior": 900}
        for mes, esperado in ((202508, False), (202509, True), (202609, True), (202610, False)):
            controles = Controles()
            with self.subTest(mes=mes):
                aplicable = controles_cataluna.controles_contraste_contratacion(
                    controles, {"1111": fila}, cambra, {"mes": mes}
                )
                self.assertIs(aplicable, esperado)
                self.assertEqual(len(controles.lista), int(esperado))


def tablas(mes: int = 202606) -> dict[str, bytes]:
    """Una captura pequeña con los campos que consumen Cataluña y sus lectores.

    Returns:
        Los tres cuerpos oficiales simulados.
    """
    anio, numero = divmod(mes, 100)
    periodo = {"c_mes": mes, "d_periode": f"{tuple(cataluna.MESES)[numero - 1]} de {anio}"}
    total = {**periodo, "eo_cont_sum_12m": 200, "eo_per_cont_com_anual": 150}
    ocupacion = {
        **total,
        "c_grup_primari": "1111",
        "d_grup_primari_cno11": "Ocupación",
        "eo_per_cont_var_anual": 0.1,
        "eo_perc_indef_tot_cont": 0.5,
        "eo_dno_mitj": 100,
    }
    sexo = [
        {
            **periodo,
            "c_grup_primari": "1111",
            "d_grup_primari_cno11": "Ocupación",
            "c_sexe": codigo,
            "d_sexe": nombre,
            "eo_perc_cont_ocup_sexe": 0.5,
        }
        for codigo, nombre in captura_cataluna.SEXOS.items()
    ]
    return {
        tabla: json.dumps({"items": filas}).encode()
        for tabla, filas in (
            (cataluna.TABLA_TOTALES, [total]),
            (cataluna.TABLA_CONTRATACION, [ocupacion]),
            (cataluna.TABLA_MUJERES, sexo),
        )
    }


class PruebaCapturaVigente(unittest.TestCase):
    """Adquisición completa y conservación de la procedencia histórica del censo."""

    def setUp(self) -> None:
        """Instala una captura y cuatro referencias fijas en un directorio exclusivo."""
        temporal = TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name)
        self.documento = {"licencia": "Licencia oficial", "archivos": []}
        for nombre, datos in [(nombre, b"censo fijo") for nombre in captura_cataluna.CENSOS_FIJOS] + [
            (cataluna.OBSERVATORI.format(tabla, "2026-06"), datos) for tabla, datos in tablas().items()
        ]:
            (self.carpeta / nombre).write_bytes(datos)
            self.documento["archivos"].append(
                {
                    "archivo": nombre,
                    "sha256": hashlib.sha256(datos).hexdigest(),
                    "descargado": "2026-09-27",
                    "version": "Dades a juny de 2026 · actualització del 22/07/2026",
                }
            )
        self.ruta = self.carpeta / "procedencia.json"
        self.ruta.write_text(json.dumps(self.documento))
        for parche in (
            mock.patch.object(cataluna, "ORIGINAL", self.carpeta),
            mock.patch.object(cataluna, "procedencia", side_effect=lambda _: json.loads(self.ruta.read_bytes())),
            mock.patch.object(cataluna, "original", side_effect=lambda _, nombre: self.carpeta / nombre),
            mock.patch.object(cataluna, "comprobar_originales"),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    def descargar(self, cuerpos: dict[str, bytes]) -> mock.Mock:
        """Ejecuta la captura con transporte simulado y devuelve sus llamadas.

        Returns:
            El transporte utilizado, para comprobar el alcance exacto.
        """

        def respuesta(url: str) -> Descarga:
            return Descarga(cuerpos[url.rsplit("/", 1)[1].removesuffix(".json")], url, "application/json")

        with (
            mock.patch.object(cataluna, "descargar_url", side_effect=respuesta) as transporte,
            mock.patch.object(cataluna, "observar_original") as vincular,
        ):
            cataluna.descargar(aceptar_cambio=True)
        self.assertEqual(vincular.call_count, 3)
        return transporte

    def test_periodo_nuevo_se_adquiere_sin_post_del_censo(self) -> None:
        """Tres GET nuevos son suficientes; las cuatro referencias fijas conservan bytes y metadatos."""
        transporte = self.descargar(tablas(202609))
        documento = json.loads(self.ruta.read_bytes())
        self.assertEqual(len(documento["archivos"]), 7)
        self.assertEqual(cataluna.periodo_archivado(), "2026-09")
        self.assertEqual(transporte.call_count, 3)
        for registro in documento["archivos"]:
            if registro["archivo"] in captura_cataluna.CENSOS_FIJOS:
                self.assertIn(registro, self.documento["archivos"])
                self.assertEqual((self.carpeta / registro["archivo"]).read_bytes(), b"censo fijo")
            else:
                self.assertIn("descargado_utc", registro)
                self.assertNotIn("actualització", registro["version"])
        self.assertTrue(cataluna.fuentes()["observatori"].endswith("dades a setembre de 2026."))

    def test_copia_legacy_identica_no_inventa_instante(self) -> None:
        """Las entradas sin hora antigua conservan fecha y versión, con metadatos de recepción comprobables."""
        self.descargar(tablas())
        registros = json.loads(self.ruta.read_bytes())["archivos"]
        for registro in registros:
            self.assertEqual(registro["descargado"], "2026-09-27")
            self.assertNotIn("descargado_utc", registro)
            if registro["archivo"].startswith("observatori-"):
                self.assertIn("url_final", registro)
                self.assertIn("bytes", registro)
        self.assertIn("22/07/2026", cataluna.fuentes()["observatori"])

    def test_periodos_distintos_no_promueven_procedencia(self) -> None:
        """Un recurso de junio durante una captura de septiembre deja el manifiesto previo intacto."""
        cuerpos = tablas(202609)
        cuerpos[cataluna.TABLA_MUJERES] = tablas()[cataluna.TABLA_MUJERES]
        previo = self.ruta.read_bytes()
        with self.assertRaises(FormatoInesperado):
            self.descargar(cuerpos)
        self.assertEqual(self.ruta.read_bytes(), previo)

    def test_claves_duplicadas_y_meses_imposibles_se_rechazan(self) -> None:
        """Una fila repetida o un mes que no existe no se ocultan al convertir filas en diccionarios."""
        tabla = cataluna.TABLA_MUJERES
        filas = json.loads(tablas()[tabla])["items"]
        variantes = [
            [*filas, filas[0]],
            [{**fila, "c_mes": 202613} for fila in filas],
            [{**fila, "eo_perc_cont_ocup_sexe": float("nan")} for fila in filas],
            [{**fila, "c_sexe": []} for fila in filas],
        ]
        for variante in variantes:
            with self.subTest(variante=variante), self.assertRaises(FormatoInesperado):
                captura_cataluna.filas_capturadas(json.dumps({"items": variante}).encode(), tabla)

    def test_una_columna_json_duplicada_no_se_sobrescribe(self) -> None:
        """Dos valores de un campo del original detienen la captura, aunque el último sea válido."""
        tabla = cataluna.TABLA_TOTALES
        datos = tablas()[tabla].replace(b'"c_mes": 202606', b'"c_mes": 202605, "c_mes": 202606')
        with self.assertRaisesRegex(FormatoInesperado, "duplicada c_mes"):
            captura_cataluna.filas_capturadas(datos, tabla)


if __name__ == "__main__":
    unittest.main()
