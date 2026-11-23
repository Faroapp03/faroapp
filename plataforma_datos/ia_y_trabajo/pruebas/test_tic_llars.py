"""Pruebas de la lectura de la tabla TIC en los hogares del Idescat (tic_llars.py)."""

import copy
import json
import tempfile
import unicodedata
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector as tic_llars
from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.comun.nucleo import Controles, Descarga, FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.tic_llars import coherencia

# El cálculo propio de «no sabía cómo» con los microdatos de 2025 (motivos_no_uso.py): 45,8 % [34,5; 57,4] con 120
# entrevistas y 33,5 % [26,0; 41,6] con 234, las mismas cifras que publica el Idescat.
NO_SABE_2025 = {
    "descripcion": coherencia.DESCRIPCION_NO_SABE,
    "por_clase": {
        "manual": {"pct": 45.8, "ic95": [34.5, 57.4], "muestra": 120},
        "no_manual": {"pct": 33.5, "ic95": [26.0, 41.6], "muestra": 234},
    },
}
# Las cifras que publicó el Idescat para 2025: datos de prueba, no un validador de la fuente.
CIFRAS_2025 = {
    "personas-ia-generativa-usuarios-internet": 46.0,
    "personas-ia-generativa-trabajo-usuarios-internet": 24.3,
    "mujeres-ia-generativa-usuarios-internet": 42.9,
    "hombres-ia-generativa-usuarios-internet": 49.0,
    "mujeres-ia-generativa-trabajo-usuarios-internet": 23.3,
    "hombres-ia-generativa-trabajo-usuarios-internet": 25.3,
    "ia-generativa-no-sabe-usarla": 41.3,
    "ia-generativa-trabajo-manual-usuarios-internet": 8.0,
    "ia-generativa-trabajo-no-manual-usuarios-internet": 44.2,
    "ia-generativa-trabajo-trabajador-tic": 77.4,
    "ia-generativa-no-sabe-usarla-trabajador-manual": 45.8,
    "ia-generativa-no-sabe-usarla-trabajador-no-manual": 33.5,
}


class PruebaTicLlars(unittest.TestCase):
    """La tabla HTML del Idescat: cada cifra por su fila y su columna, sin la columna de población."""

    PAGINA = (
        "<table><caption>Persones de 16 a 74 anys que han fet servir internet</caption><thead><tr><th></th>"
        "<th>Total</th><th>Ús d'alguna eina d'IA generativa</th><th>Amb finalitats professionals o relacionades amb "
        "la feina</th></tr></thead><tbody><tr><th>Sexe</th></tr><tr><th scope='row'>Dona</th><td>2.979.566</td>"
        "<td>42,9</td><td>23,3</td></tr><tr><th>Total</th><td>5.982.153</td><td>46,0</td><td>..</td></tr></tbody>"
        "</table>"
    )

    def test_cada_cifra_por_su_fila_y_su_columna(self) -> None:
        """Cada cifra se encuentra por su fila y su columna; la población de la fila no es una columna de datos."""
        tabla = tic_llars.leer_tabla(self.PAGINA)
        self.assertEqual(
            tabla["cifras"]["Dona"],
            {
                "Ús d'alguna eina d'IA generativa": 42.9,
                "Amb finalitats professionals o relacionades amb la feina": 23.3,
            },
        )

    def test_la_segunda_tabla_de_la_pagina_se_lee_por_su_posicion(self) -> None:
        """La segunda tabla (por ocupación) se lee por su posición; una que no existe detiene la lectura."""
        pagina = self.PAGINA + self.PAGINA.replace("Dona", "Treballador manual").replace("42,9", "35,4")
        self.assertEqual(
            tic_llars.leer_tabla(pagina, 1)["cifras"]["Treballador manual"]["Ús d'alguna eina d'IA generativa"], 35.4
        )
        with self.assertRaises(FormatoInesperado):
            tic_llars.leer_tabla(self.PAGINA, 1)

    def test_una_tabla_sin_cuerpo_o_con_una_fila_repetida_detiene_la_lectura(self) -> None:
        """Sin «<tbody» la tabla no se lee vacía, y una fila con el mismo rótulo no pisa a la anterior en silencio."""
        with self.assertRaises(FormatoInesperado):
            tic_llars.leer_tabla(self.PAGINA.replace("<tbody", "<tcuerpo"))
        fila = self.PAGINA[self.PAGINA.index("<tr", self.PAGINA.index("<tbody")) : self.PAGINA.index("</tbody>")]
        with self.assertRaises(FormatoInesperado):
            tic_llars.leer_tabla(self.PAGINA.replace("</tbody>", f"{fila}</tbody>"))

    def test_manual_o_no_manual_fuera_del_intervalo_del_calculo_de_faro_se_nombra(self) -> None:
        """Manual y no manual caen en el intervalo del 95 % del cálculo con los microdatos; si no, se nombran."""
        grupos = {"manual": {"ic95": [4.2, 14.4]}, "no_manual": {"ic95": [39.0, 48.9]}}
        cifras = {
            "ia-generativa-trabajo-manual-usuarios-internet": 8.0,
            "ia-generativa-trabajo-no-manual-usuarios-internet": 55.0,
        }
        self.assertEqual(
            tic_llars.fuera_del_calculo_de_faro(cifras, grupos),
            {"ia-generativa-trabajo-no-manual-usuarios-internet": (55.0, [39.0, 48.9])},
        )

    def test_el_titulo_dice_la_base_y_el_dato_no_disponible_no_tiene_cifra(self) -> None:
        """El título (la base) se guarda literal y «..» no tiene cifra."""
        tabla = tic_llars.leer_tabla(self.PAGINA)
        self.assertEqual(tabla["titulo"], "Persones de 16 a 74 anys que han fet servir internet")
        self.assertIsNone(tabla["cifras"]["Total"]["Amb finalitats professionals o relacionades amb la feina"])

    def test_una_clase_de_tich_distinta_de_la_del_idescat_se_nombra(self) -> None:
        """Manual son los grandes grupos 6 a 9 y no manual del 0 al 5; un grupo con la otra clase se nombra."""
        clases = {"01": "no_manual", "52": "no_manual", "61": "manual", "71": "no_manual", "34": "manual"}
        self.assertEqual(tic_llars.clases_distintas(clases), {"71": "no_manual", "34": "manual"})

    def test_quienes_no_saben_usarla_por_clase_llevan_la_procedencia_de_su_tabla(self) -> None:
        """De lo validado: la cifra de cada clase, su año y la URL y la huella de la tabla 3.4.2."""
        conjunto = {
            "cita": "Idescat",
            "tablas": {
                "3.4.2": {"url": "https://idescat/3.4.2", "sha256": "ab", "descargado_utc": "2026-10-11T03:34Z"}
            },
            "cifras": {
                "ia-generativa-no-sabe-usarla-trabajador-manual": {"valor": 45.8, "anio": 2025, "nota": None},
                "ia-generativa-no-sabe-usarla-trabajador-no-manual": {"valor": 33.5, "anio": 2025, "nota": None},
            },
        }
        motivos = tic_llars.motivos_no_uso(conjunto)
        self.assertEqual(motivos["no_sabia_como_utilizarlas"], {"manual": 45.8, "no_manual": 33.5})
        self.assertEqual(
            (motivos["url"], motivos["sha256"], motivos["consultado"], motivos["anio"], motivos["tabla"]),
            ("https://idescat/3.4.2", "ab", "2026-10-11", "2025", "3.4.2"),
        )
        conjunto["cifras"]["ia-generativa-no-sabe-usarla-trabajador-manual"]["anio"] = 2024
        with self.assertRaises(FormatoInesperado):
            tic_llars.motivos_no_uso(conjunto)


class PruebaEntradasTicLlars(unittest.TestCase):
    """Los defectos del original o de su procedencia se explican sin desplazar cifras."""

    def test_atributos_con_mayor_que_y_marcado_interior_conservan_el_texto(self) -> None:
        """Los atributos no aportan texto a la fila y las etiquetas interiores conservan su rótulo."""
        pagina = PruebaTicLlars.PAGINA.replace("<th scope='row'>Dona", "<th title='a > b' scope='row'><b>Dona</b>")
        self.assertEqual(tic_llars.leer_tabla(pagina), tic_llars.leer_tabla(PruebaTicLlars.PAGINA))

    def test_una_tabla_anidada_se_rechaza(self) -> None:
        """Una tabla interior no recorta ni mezcla el cuerpo de la tabla seleccionada."""
        pagina = PruebaTicLlars.PAGINA.replace("Dona</th>", "Dona<table><tr><td>otra</td></tr></table></th>")
        with self.assertRaisesRegex(FormatoInesperado, "tabla.*anidada"):
            tic_llars.leer_tabla(pagina)

    def test_cabeceras_repetidas_no_pisan_cifras(self) -> None:
        """Cada columna de datos necesita un nombre distinto para que ninguna cifra se sobrescriba."""
        pagina = PruebaTicLlars.PAGINA.replace(tic_llars.TRABAJO, tic_llars.USO)
        with self.assertRaisesRegex(FormatoInesperado, "columna.*repetida"):
            tic_llars.leer_tabla(pagina)

    def test_una_fila_corta_o_larga_no_desplaza_las_columnas(self) -> None:
        """Una celda ausente o sobrante se diagnostica por su fila antes de asignar valores."""
        for reemplazo in ("", "<td>42,9</td><td>12,0</td>"):
            with self.subTest(reemplazo=reemplazo), self.assertRaisesRegex(FormatoInesperado, "Dona.*celdas"):
                tic_llars.leer_tabla(PruebaTicLlars.PAGINA.replace("<td>42,9</td>", reemplazo))

    def test_un_numero_invalido_nombra_tabla_fila_y_columna(self) -> None:
        """Un valor ilegible identifica dónde corregir el original."""
        with self.assertRaisesRegex(FormatoInesperado, r"tabla 1.*Dona.*Ús d'alguna.*12,3 \*"):
            tic_llars.leer_tabla(PruebaTicLlars.PAGINA.replace("42,9", "12,3 *"))

    def test_una_posicion_negativa_no_selecciona_la_ultima_tabla(self) -> None:
        """Las posiciones se numeran desde cero y ninguna es negativa."""
        with self.assertRaisesRegex(FormatoInesperado, "posición"):
            tic_llars.leer_tabla(PruebaTicLlars.PAGINA, -1)

    def test_un_indicador_con_tabla_ausente_se_diagnostica(self) -> None:
        """Una tabla ausente se nombra junto al indicador que depende de ella."""
        with self.assertRaisesRegex(FormatoInesperado, "3.4.1.*personas-ia-generativa"):
            tic_llars.cifra({}, "personas-ia-generativa-usuarios-internet")

    def test_una_cifra_ausente_sigue_sin_dato(self) -> None:
        """La ausencia de una fila o columna sigue devolviendo None para los controles de validación."""
        self.assertIsNone(tic_llars.cifra({"3.4.1": {"cifras": {}}}, "personas-ia-generativa-usuarios-internet"))

    @staticmethod
    def procedencia() -> dict:
        """Dos originales sintéticos con día civil distinto del día UTC de su instante.

        Returns:
            La procedencia de ambas tablas, sin archivos de datos operativos.
        """
        return {
            "archivos": [
                {
                    "archivo": f"idescat-ticll25-{numero}.html",
                    "url": f"https://idescat/{numero}",
                    "sha256": "ab",
                    "descargado_utc": "2026-10-11T23:34:00-02:00",
                }
                for numero in tic_llars.TABLAS_DEL_IDESCAT
            ]
        }

    def test_original_ausente_o_duplicado_no_compone_un_conjunto(self) -> None:
        """Cada tabla exige una única entrada del original correspondiente."""
        for archivos in (self.procedencia()["archivos"][:1], self.procedencia()["archivos"] * 2):
            with self.subTest(archivos=len(archivos)), self.assertRaisesRegex(FormatoInesperado, "idescat-ticll25"):
                tic_llars._conjunto({"archivos": archivos}, CIFRAS_2025)

    def test_fecha_de_procedencia_invalida_se_atribuye_al_original(self) -> None:
        """Una fecha imposible o de tipo incorrecto identifica el original y el campo."""
        for fecha in ("2026-02-30T03:34Z", "sin fecha", None):
            procedencia = self.procedencia()
            procedencia["archivos"][0]["descargado_utc"] = fecha
            with (
                self.subTest(fecha=fecha),
                self.assertRaisesRegex(FormatoInesperado, "idescat-ticll25-3.4.1.html.*descargado_utc"),
            ):
                tic_llars._conjunto(procedencia, CIFRAS_2025)

    def test_la_fecha_de_consulta_conserva_el_dia_civil(self) -> None:
        """El año conserva el tipo de cada contrato y la consulta mantiene el día civil."""
        conjunto = tic_llars._conjunto(self.procedencia(), CIFRAS_2025)
        self.assertEqual(conjunto["consultado"], "2026-10-11")
        self.assertEqual(tic_llars.motivos_no_uso(conjunto)["consultado"], "2026-10-11")
        self.assertIsInstance(conjunto["cifras"][next(iter(CIFRAS_2025))]["anio"], int)
        self.assertEqual(tic_llars.motivos_no_uso(conjunto)["anio"], "2025")

    def test_motivos_rechaza_anios_malformados_sin_convertirlos(self) -> None:
        """Un año numérico entero de cuatro cifras forma parte del contrato de Idescat."""
        conjunto = tic_llars._conjunto(self.procedencia(), CIFRAS_2025)
        for anio in (True, 2025.0, "2025", None, 25, 10000):
            modificado = copy.deepcopy(conjunto)
            for dato in modificado["cifras"].values():
                dato["anio"] = anio
            with self.subTest(anio=anio), self.assertRaisesRegex(FormatoInesperado, "año"):
                tic_llars.motivos_no_uso(modificado)

    def test_motivos_rechaza_fecha_invalida_y_nombra_su_tabla(self) -> None:
        """Los motivos no exportan una fecha imposible de su tabla."""
        conjunto = tic_llars._conjunto(self.procedencia(), CIFRAS_2025)
        conjunto["tablas"]["3.4.2"]["descargado_utc"] = "2026-02-30"
        with self.assertRaisesRegex(FormatoInesperado, "3.4.2.*descargado_utc"):
            tic_llars.motivos_no_uso(conjunto)

    def test_motivos_rechaza_porcentaje_ausente_o_fuera_de_rango(self) -> None:
        """El consumidor necesita porcentajes numéricos y presentes, entre cero y cien."""
        conjunto = tic_llars._conjunto(self.procedencia(), CIFRAS_2025)
        for valor in (None, -1, 101, "45,8", True):
            modificado = copy.deepcopy(conjunto)
            modificado["cifras"][tic_llars.NO_SABE_POR_CLASE["manual"]]["valor"] = valor
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "manual.*valor"):
                tic_llars.motivos_no_uso(modificado)

    def test_preparar_atribuye_el_error_al_html(self) -> None:
        """Preparar explica el nombre del HTML además de la fila y la columna."""
        ruta = Mock()
        ruta.read_text.return_value = PruebaTicLlars.PAGINA.replace("42,9", "12,3 *")
        with (
            patch.object(tic_llars, "comprobar_originales"),
            patch.object(tic_llars, "original", return_value=ruta),
            self.assertRaisesRegex(FormatoInesperado, "idescat-ticll25-3.4.1.html.*Dona"),
        ):
            tic_llars.preparar()


class PruebaAlcanceDelContrasteTich(unittest.TestCase):
    """El validado TIC-H puede excluir una clase por su regla estadística de publicación."""

    @staticmethod
    def controles(grupos: dict) -> Controles:
        """Comprueba referencias completas con clases sintéticas coherentes.

        Returns:
            Los controles de la fuente, sin leer ni escribir datos operativos.
        """
        controles = Controles()
        tic_llars._controles(
            controles,
            {numero: {"titulo": titulo} for numero, titulo in tic_llars.TITULOS.items()},
            CIFRAS_2025,
            {
                "anio": "2025",
                "cataluna_grupos": grupos,
                "contraste_no_sabe_como": NO_SABE_2025,
                "clase_por_isco2": {"01": "no_manual", "61": "manual"},
            },
        )
        return controles

    @staticmethod
    def con_motivo(calculado: object, cifras: dict | None = None) -> tuple[Controles, bool | None]:
        """Valida con la TIC-H de la misma edición y el cálculo de contraste del motivo dado.

        Returns:
            Los controles y si se contrastó el motivo.
        """
        controles = Controles()
        contrastado = tic_llars._controles(
            controles,
            {numero: {"titulo": titulo} for numero, titulo in tic_llars.TITULOS.items()},
            cifras or CIFRAS_2025,
            {
                "anio": "2025",
                "cataluna_grupos": {"manual": {"ic95": [4.2, 14.4]}, "no_manual": {"ic95": [39.0, 48.9]}},
                "contraste_no_sabe_como": calculado,
                "clase_por_isco2": {},
            },
        )
        return controles, contrastado

    def test_no_sabian_como_se_contrasta_con_cualquier_muestra_y_avisa_si_no_hay_base(self) -> None:
        """Dentro del intervalo pasa aunque ninguna clase llegue a 100 entrevistas; fuera falla; sin base, aviso."""
        pequenas = {
            "descripcion": coherencia.DESCRIPCION_NO_SABE,
            "por_clase": {
                "manual": {"pct": 40.0, "ic95": [22.0, 60.0], "muestra": 77},
                "no_manual": {"pct": 30.0, "ic95": [18.0, 45.0], "muestra": 35},
            },
        }
        for calculado in (NO_SABE_2025, pequenas):
            with self.subTest(calculado=calculado):
                controles, contrastado = self.con_motivo(calculado)
                self.assertTrue(controles.admitido, controles.fallidos)
                self.assertTrue(contrastado)
        fuera = {
            **NO_SABE_2025,
            "por_clase": {**NO_SABE_2025["por_clase"], "manual": {"ic95": [50.0, 60.0], "muestra": 120}},
        }
        controles, _ = self.con_motivo(fuera)
        self.assertTrue(any("no sabía cómo" in f and "fuera" in f for f in controles.fallidos), controles.fallidos)
        # Un 0,0 publicado es una cifra, no una ausencia.
        cero = {
            **NO_SABE_2025,
            "por_clase": {**NO_SABE_2025["por_clase"], "manual": {"ic95": [0.0, 4.0], "muestra": 120}},
        }
        controles, _ = self.con_motivo(cero, {**CIFRAS_2025, "ia-generativa-no-sabe-usarla-trabajador-manual": 0.0})
        self.assertFalse(any("no sabía cómo" in f for f in controles.fallidos), controles.fallidos)
        vacia = {**NO_SABE_2025, "por_clase": {"manual": {"muestra": 0}, "no_manual": {"muestra": 0}}}
        # Sin nadie en la base, o con una validación de tich anterior a este cálculo, no hay contraste: aviso.
        for sin_base in (vacia, None):
            with self.subTest(sin_base=sin_base):
                controles, contrastado = self.con_motivo(sin_base)
                self.assertTrue(controles.admitido, controles.fallidos)
                self.assertFalse(contrastado)
                self.assertFalse(any("no sabía cómo" in c["control"] for c in controles.lista))

    def test_validar_antes_de_que_tich_calcule_el_motivo_da_aviso_y_no_fallo(self) -> None:
        """Con una validación de tich sin el cálculo (anterior a volver a validarla), el motivo queda sin contraste."""
        with tempfile.TemporaryDirectory() as temporal:
            validacion = Path(temporal) / "validacion.json"
            carpetas = Mock(return_value=Mock(validacion=validacion))
            with patch.object(coherencia, "carpetas", carpetas):
                self.assertIsNone(coherencia.motivo_calculado_por_tich())
                validacion.write_text(json.dumps({"controles": []}), encoding="utf-8")
                self.assertIsNone(coherencia.motivo_calculado_por_tich())
                validacion.write_text(json.dumps({"contraste_no_sabe_como": NO_SABE_2025}), encoding="utf-8")
                self.assertEqual(coherencia.motivo_calculado_por_tich(), NO_SABE_2025)
        controles, contrastado = self.con_motivo(None)
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertIs(contrastado, False)

    def test_el_control_dice_cada_clase_con_sus_entrevistas_y_su_intervalo(self) -> None:
        """El mensaje da la muestra y el intervalo de cada clase comparada, sin ningún umbral."""
        controles, _ = self.con_motivo(NO_SABE_2025)
        control = next(c["control"] for c in controles.lista if "no sabía cómo" in c["control"])
        self.assertIn("manual (120 entrevistas, IC 34,5–57,4), no_manual (234 entrevistas, IC 26,0–41,6)", control)

    def test_un_cambio_cosmetico_de_la_descripcion_no_detiene_el_contraste(self) -> None:
        """Mayúsculas, espacios dobles, otra forma Unicode o un punto final no cambian el significado de IAG_NO3."""
        for descripcion in (
            "RAZONES PARA NO UTILIZAR IA GENERATIVA:  No sabía cómo utilizarlas.",
            unicodedata.normalize("NFD", coherencia.DESCRIPCION_NO_SABE),
            "Razones para no utilizar IA generativa: no  sabía cómo utilizarlas ",
        ):
            with self.subTest(descripcion=descripcion):
                controles, _ = self.con_motivo({**NO_SABE_2025, "descripcion": descripcion})
                self.assertTrue(controles.admitido, controles.fallidos)
        for descripcion in (None, "Razones para no utilizar IA Generativa: No sabía cómo usarlas para el trabajo"):
            with self.subTest(descripcion=descripcion):
                controles, _ = self.con_motivo({**NO_SABE_2025, "descripcion": descripcion})
                self.assertTrue(any("IAG_NO3" in f for f in controles.fallidos), controles.fallidos)

    def test_si_iag_no3_cambia_de_significado_el_contraste_se_detiene(self) -> None:
        """La descripción de la variable en el diseño de registro de la edición tiene que ser la que se contrasta."""
        otra = {**NO_SABE_2025, "descripcion": "Razones para no utilizar IA Generativa: No sabía que existían"}
        controles, contrastado = self.con_motivo(otra)
        self.assertTrue(contrastado)
        self.assertTrue(any("IAG_NO3" in f for f in controles.fallidos), controles.fallidos)

    def test_una_clase_sin_cifra_publicable_no_inventa_su_intervalo(self) -> None:
        """La forma del validado actual compara solo no_manual y declara manual sin contraste."""
        grupos = {"no_manual": {"pct": 43.9, "ic95": [38.9, 49.1], "muestra": 544}}
        self.assertEqual(tic_llars.fuera_del_calculo_de_faro(CIFRAS_2025, grupos), {})
        controles = self.controles(grupos)
        self.assertTrue(controles.admitido)
        self.assertEqual(
            controles.lista[3],
            {
                "control": "contraste con el intervalo del 95 % del cálculo de Faro con los microdatos de la TIC-H "
                "(tich); clases comparadas: no_manual; sin contraste por no tener cifra publicable en el validado "
                "tich: manual",
                "resultado": "correcto",
            },
        )

    def test_con_la_tich_de_un_anio_posterior_valida_sin_contraste_y_cada_cifra_con_su_anio(self) -> None:
        """La TIC-H de 2026 con las tablas del Idescat de 2025 no detiene la fuente: el contraste espera a la misma."""
        controles = Controles()
        tic_llars._controles(
            controles,
            {numero: {"titulo": titulo} for numero, titulo in tic_llars.TITULOS.items()},
            CIFRAS_2025,
            {"anio": "2026", "cataluna_grupos": {}, "clase_por_isco2": {"61": "manual"}},
        )
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertFalse(any("intervalo" in control["control"] for control in controles.lista))
        self.assertIn("sin contraste con el cálculo de Faro", controles.lista[-1]["control"])

    def test_cifras_incoherentes_de_las_tablas_detienen_sin_cifras_copiadas_a_mano(self) -> None:
        """Un total fuera de las cifras de los sexos, o un uso para trabajar mayor que el total, se nombra."""
        self.assertEqual(tic_llars.incoherencias(CIFRAS_2025), {})
        total = "personas-ia-generativa-usuarios-internet"
        trabajo = "mujeres-ia-generativa-trabajo-usuarios-internet"
        for cambios, nombrado in (({total: 50.0}, total), ({trabajo: 43.0}, trabajo), ({total: None}, total)):
            with self.subTest(cambios=cambios):
                self.assertIn(nombrado, tic_llars.incoherencias({**CIFRAS_2025, **cambios}))
        controles = Controles()
        tic_llars._controles(
            controles,
            {numero: {"titulo": titulo} for numero, titulo in tic_llars.TITULOS.items()},
            {**CIFRAS_2025, total: 50.0},
            {"anio": "2025", "cataluna_grupos": {}, "clase_por_isco2": {}},
        )
        self.assertTrue(any("coherencia de las tablas" in fallo for fallo in controles.fallidos))

    def test_el_contraste_requiere_un_anio_valido_no_anterior_de_tich(self) -> None:
        """Un año anterior o mal escrito de la TIC-H detiene la fuente, sin contrastar."""
        for anio in ("2024", "25", 2025, True, None):
            controles = Controles()
            with self.subTest(anio=anio):
                tic_llars._controles(
                    controles,
                    {numero: {"titulo": titulo} for numero, titulo in tic_llars.TITULOS.items()},
                    CIFRAS_2025,
                    {
                        "anio": anio,
                        "cataluna_grupos": {"no_manual": {"ic95": [39.0, 48.9]}},
                        "clase_por_isco2": {"61": "manual"},
                    },
                )
                self.assertFalse(controles.admitido)
                self.assertTrue(any("año" in fallo for fallo in controles.fallidos))
                self.assertFalse(any("intervalo" in control["control"] for control in controles.lista))

    def test_sin_ninguna_clase_publicable_no_hay_exito_vacio(self) -> None:
        """No disponer de intervalos produce un control fallido, con las dos clases sin contraste."""
        controles = self.controles({})
        self.assertFalse(controles.admitido)
        self.assertEqual(len(controles.fallidos), 1)
        self.assertEqual(controles.lista[3]["resultado"], "ERROR")
        self.assertIn("clases comparadas: ninguna", controles.fallidos[0])
        self.assertIn(
            "sin contraste por no tener cifra publicable en el validado tich: manual, no_manual", controles.fallidos[0]
        )

    def test_una_unica_clase_disponible_fuera_sigue_fallando(self) -> None:
        """El contraste parcial mantiene el criterio y el diagnóstico del indicador y su intervalo."""
        grupos = {"no_manual": {"ic95": [30.0, 40.0]}}
        fuera = {"ia-generativa-trabajo-no-manual-usuarios-internet": (44.2, [30.0, 40.0])}
        self.assertEqual(tic_llars.fuera_del_calculo_de_faro(CIFRAS_2025, grupos), fuera)
        controles = self.controles(grupos)
        self.assertFalse(controles.admitido)
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("clases comparadas: no_manual", controles.fallidos[0])
        self.assertTrue(controles.fallidos[0].endswith(f"; fuera: {fuera}"))

    def test_con_dos_clases_disponibles_se_contrastan_ambas(self) -> None:
        """Con ambos intervalos presentes no se pierde cobertura ni se declara una omisión."""
        controles = self.controles({"manual": {"ic95": [4.2, 14.4]}, "no_manual": {"ic95": [39.0, 48.9]}})
        self.assertTrue(controles.admitido)
        self.assertIn("clases comparadas: manual, no_manual", controles.lista[3]["control"])
        self.assertTrue(
            controles.lista[3]["control"].endswith(
                "sin contraste por no tener cifra publicable en el validado tich: ninguna"
            )
        )


class PruebaDescubrimientoTicLlars(unittest.TestCase):
    """El catálogo anuncia ediciones; una sucesora se revisa antes de tocar las dos tablas."""

    CATALOGO = (
        '<div id="result_"><div><h2>Años disponibles</h2><ul>'
        '<li><a href="/pub/?id=ticll25&amp;lang=es">2025</a></li>'
        '<li><a href="/pub/?id=ticll24&amp;lang=es">2024</a></li>'
        "</ul></div></div>"
    )

    def test_catalogo_descubre_anios_y_rechaza_identidades_ambiguas(self) -> None:
        """Solo se admiten enlaces oficiales consistentes con el año visible, sin duplicados."""
        self.assertEqual(tic_llars.ediciones_disponibles(self.CATALOGO), (2024, 2025))
        for pagina in (
            self.CATALOGO.replace("ticll25", "ticll26"),
            self.CATALOGO.replace("/pub/?id=ticll25", "https://otro.example/pub/?id=ticll25"),
            self.CATALOGO.replace("2024</a>", "2025</a>"),
            self.CATALOGO.replace("Años disponibles", "Sin resultados"),
            '<div id="result_"><h2>Años disponibles</h2></div>',
            self.CATALOGO.replace("</ul>", '<a href="/pub/?id=ticll26&amp;lang=es">2026</ul>'),
        ):
            with self.subTest(pagina=pagina), self.assertRaises(FormatoInesperado):
                tic_llars.ediciones_disponibles(pagina)

    def test_otras_secciones_y_fechas_no_anuncian_edicion(self) -> None:
        """Las tablas básicas y el calendario de la página quedan fuera de la lista de ediciones."""
        pagina = (
            self.CATALOGO.replace("</ul>", '</ul><h2>Tablas básicas</h2><a href="/otra">2030</a>')
            + "<p>Próxima fecha 2027</p>"
        )
        self.assertEqual(tic_llars.edicion_del_catalogo(pagina.encode()), 2025)

    def test_sucesora_o_catalogo_invalido_no_toca_originales(self) -> None:
        """Ni --aceptar-cambio autoriza cambiar automáticamente de contrato anual."""
        for pagina in (self.CATALOGO.replace("ticll25", "ticll26").replace("2025</a>", "2026</a>"), "error"):
            with tempfile.TemporaryDirectory() as temporal, self.subTest(pagina=pagina):
                carpeta = Path(temporal)
                procedencia = carpeta / "procedencia.json"
                procedencia.write_text('{"anterior":true}', encoding="utf-8")
                with (
                    patch.object(tic_llars, "ORIGINAL", carpeta),
                    patch.object(tic_llars, "PROCEDENCIA", procedencia),
                    patch.object(
                        red,
                        "descargar_url",
                        return_value=Descarga(
                            pagina.encode(), "https://www.idescat.cat/estad/ticl?lang=es", "text/html"
                        ),
                    ),
                    patch.object(tic_llars, "descargar_originales") as tablas,
                    self.assertRaises(FormatoInesperado),
                ):
                    tic_llars.descargar(aceptar_cambio=True)
                tablas.assert_not_called()
                self.assertEqual(procedencia.read_text(), '{"anterior":true}')
                self.assertEqual(sorted(p.name for p in carpeta.iterdir()), ["procedencia.json"])

    def test_url_final_inesperada_y_cuerpo_invalido_no_se_guardan(self) -> None:
        """La identidad y el cuerpo se comprueban antes de conservar el catálogo."""
        for cuerpo, url in (
            (self.CATALOGO.encode(), "https://otro.example/catalogo"),
            (b"\xff", tic_llars.CATALOGO["url"]),
            (b"x" * (tic_llars.MAX_CATALOGO_BYTES + 1), tic_llars.CATALOGO["url"]),
        ):
            with tempfile.TemporaryDirectory() as temporal, self.subTest(url=url, bytes=len(cuerpo)):
                carpeta = Path(temporal)
                with (
                    patch.object(tic_llars, "ORIGINAL", carpeta),
                    patch.object(tic_llars, "PROCEDENCIA", carpeta / "procedencia.json"),
                    patch.object(red, "descargar_url", return_value=Descarga(cuerpo, url, "text/html")),
                    self.assertRaises(FormatoInesperado),
                ):
                    tic_llars._descubrir_edicion()
                self.assertEqual(list(carpeta.iterdir()), [])

    def test_mismo_catalogo_conserva_fecha_historica_de_descarga(self) -> None:
        """Un nuevo recibo no convierte bytes antiguos en datos recién publicados."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            procedencia = carpeta / "procedencia.json"
            with (
                patch.object(tic_llars, "ORIGINAL", carpeta),
                patch.object(tic_llars, "PROCEDENCIA", procedencia),
                patch.object(
                    red,
                    "descargar_url",
                    return_value=Descarga(self.CATALOGO.encode(), tic_llars.CATALOGO["url"], "text/html"),
                ),
            ):
                registro = tic_llars._descubrir_edicion()
                registro[0]["descargado_utc"] = "2026-01-30T09:00:00+00:00"
                tic_llars.guardar_json(procedencia, {"descubrimiento": registro})
                self.assertEqual(tic_llars._descubrir_edicion(), registro)

    def test_catalogo_duplicado_en_procedencia_no_se_normaliza(self) -> None:
        """La consulta no descarta una identidad previa repetida para aparentar una procedencia válida."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            procedencia = carpeta / "procedencia.json"
            tic_llars.guardar_json(procedencia, {"descubrimiento": [{"archivo": tic_llars.CATALOGO["archivo"]}] * 2})
            anterior = procedencia.read_bytes()
            with (
                patch.object(tic_llars, "ORIGINAL", carpeta),
                patch.object(tic_llars, "PROCEDENCIA", procedencia),
                patch.object(
                    red,
                    "descargar_url",
                    return_value=Descarga(self.CATALOGO.encode(), tic_llars.CATALOGO["url"], "text/html"),
                ),
                self.assertRaisesRegex(FormatoInesperado, "duplicado"),
            ):
                tic_llars._descubrir_edicion()
            self.assertEqual(procedencia.read_bytes(), anterior)
            self.assertEqual(sorted(p.name for p in carpeta.iterdir()), ["procedencia.json"])

    def test_edicion_conocida_guarda_descubrimiento_separado(self) -> None:
        """El catálogo es evidencia adicional; no altera el inventario de dos tablas operativas."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            with (
                patch.object(tic_llars, "ORIGINAL", carpeta),
                patch.object(tic_llars, "PROCEDENCIA", carpeta / "procedencia.json"),
                patch.object(
                    red,
                    "descargar_url",
                    return_value=Descarga(
                        self.CATALOGO.encode(), "https://www.idescat.cat/estad/ticl?lang=es", "text/html"
                    ),
                ),
                patch.object(tic_llars, "descargar_originales", return_value=[{"tabla": "original"}]),
                patch.object(tic_llars.time, "sleep") as pausa,
                patch.object(tic_llars, "guardar_json") as guardar,
            ):
                tic_llars.descargar()
            registro = guardar.call_args.args[1]
            self.assertEqual(registro["archivos"], [{"tabla": "original"}] * len(tic_llars.ARCHIVOS))
            self.assertEqual(pausa.call_count, len(tic_llars.ARCHIVOS))
            self.assertEqual(len(registro["descubrimiento"]), 1)
            self.assertEqual(registro["descubrimiento"][0]["url"], tic_llars.CATALOGO["url"])
            self.assertEqual((carpeta / tic_llars.CATALOGO["archivo"]).read_text(), self.CATALOGO)


class PruebaCapturaRealDe2025(unittest.TestCase):
    """Las dos páginas reales del Idescat de 2025 que se validaron dan, leídas, las doce cifras publicadas."""

    DATOS = Path(__file__).parent / "datos"

    def test_las_capturas_conservadas_dan_las_cifras_publicadas(self) -> None:
        """Cada página es la de su huella, y la lectura por fila y columna da las cifras que publicó el Idescat."""
        procedencia = json.loads((self.DATOS / "procedencia-idescat-ticll25.json").read_text(encoding="utf-8"))
        tablas: dict = {}
        for archivo in procedencia["archivos"]:
            contenido = (self.DATOS / archivo["archivo"]).read_bytes()
            self.assertEqual(sha256_bytes(contenido), archivo["sha256"])
            numero = archivo["archivo"].removeprefix("idescat-ticll25-").removesuffix(".html")
            tablas[numero] = tic_llars.leer_tabla(contenido.decode("utf-8"))
            tablas[f"{numero}{tic_llars.POR_OCUPACION}"] = tic_llars.leer_tabla(contenido.decode("utf-8"), 1)
        cifras = {indicador: tic_llars.cifra(tablas, indicador) for indicador in tic_llars.CIFRAS_DE_CADA_INDICADOR}
        self.assertEqual(cifras, CIFRAS_2025)
        self.assertEqual(tic_llars.incoherencias(cifras), {})


if __name__ == "__main__":
    unittest.main()
