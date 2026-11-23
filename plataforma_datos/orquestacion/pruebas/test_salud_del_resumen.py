"""El parte de salud del resumen: qué dice de cada fuente, qué dice de lo que falta y cuál es el veredicto del día."""

import json
import re
import tempfile
import unittest
from collections.abc import Collection
from pathlib import Path

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos import adquisicion_por_fuente, error_de_retirada
from plataforma_datos.cursos.decisiones_retirada import construir_registro, guardar_registro
from plataforma_datos.cursos.error_de_retirada import medir_error
from plataforma_datos.cursos.lecturas import contrato_lectura
from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas
from plataforma_datos.cursos.lecturas.contrato_lectura import bytes_de
from plataforma_datos.cursos.pruebas.ejemplos_retirada import CURSO, cadena
from plataforma_datos.cursos.retirada_por_evidencia import Curso, decidir, regla_de_retirada
from plataforma_datos.orquestacion import formas_del_diario as formas
from plataforma_datos.orquestacion import resumen_diario, salud_del_resumen
from plataforma_datos.orquestacion.salud_del_resumen import componer_salud, parte_de_salud, veredicto_del_dia

DIAS = tuple(f"2026-11-{dia:02d}T05:00:00Z" for dia in range(10, 18))
CICLO = {"desde": "2026-11-13T04:00:00.250+00:00", "hasta": "2026-11-14T23:59:59.900+00:00"}
SIN_PAGINA = ("formacion", "formacion:oferta")
CON_PAGINA = ("fundae", "fundae:digitalizate")
DESCARGADA = {"estado": "terminado", "causa": None}
LEEN_Y_EMITEN = frozenset({"barcelonactiva", "fundae"})
AMBITOS_POR_FUENTE = 2


def lecturas_de(patron: str, ambito: tuple[str, str] = SIN_PAGINA, **opciones: str | dict[int, str]) -> list[dict]:
    """La cadena de lecturas de un curso con ese patrón de presencia, en días consecutivos.

    Returns:
        Las lecturas tal como las guarda el almacén.
    """
    return cadena(patron, ambito=ambito, horas=DIAS, **opciones)


def registros_de(lecturas: list[dict]) -> list[dict]:
    """Los registros que la regla real de retirada habría guardado tras cada lectura.

    Returns:
        Un registro por lectura.
    """
    curso = Curso(id=CURSO, fuente=lecturas[0]["fuente"], ambito=lecturas[0]["ambito"])
    return [
        construir_registro(lectura, regla_de_retirada(), [decidir(curso, lecturas[: posicion + 1])])
        for posicion, lectura in enumerate(lecturas)
    ]


def parte(
    lecturas: list[dict],
    *,
    descargas: dict | None = None,
    emiten: Collection[str] = LEEN_Y_EMITEN,
    error: list[dict] | None = None,
) -> dict:
    """El parte de un ciclo con esas lecturas, sin registros de decisiones y con el error medido sobre ellas.

    Returns:
        El bloque `salud`.
    """
    medido = medir_error([], lecturas) if error is None else error
    return componer_salud(lecturas=lecturas, registros=[], error=medido, descargas=descargas or {}, emiten=emiten)


def fila_de(salud: dict, fuente: str) -> dict:
    """La fila de una fuente del parte.

    Returns:
        La fila.
    """
    return next(fila for fila in salud["fuentes"] if fila["fuente"] == fuente)


class SituacionDeCadaFuente(unittest.TestCase):
    """Cada fuente figura con lo que se sabe de ella, y lo que falta se dice."""

    def test_una_fuente_sana_dice_sus_recuentos_y_sus_salidas_por_explicacion(self) -> None:
        """Bruto, vigente, declarado, entradas, salidas explicadas por cada explicación y sin explicar."""
        lecturas = lecturas_de("1110", explicaciones={3: "fin_publicado"}, ambito=CON_PAGINA)
        fila = fila_de(parte(lecturas[3:], descargas={"fundae": DESCARGADA}), "fundae")
        (lectura,) = fila["lecturas"]
        self.assertEqual((fila["registro"], fila["estado"]), ("lee", "sana"))
        self.assertEqual((lectura["estado"], lectura["motivos"]), ("sana", []))
        self.assertEqual((lectura["bruto"], lectura["vigente"], lectura["declarado"]), (2, 2, None))
        self.assertEqual(lectura["entradas"], 0)
        self.assertEqual(lectura["salidasExplicadas"], {"fin_publicado": 1, "fuente_declara_baja": 0})
        self.assertEqual(lectura["salidasSinExplicar"], 0)
        self.assertEqual(fila["descarga"], DESCARGADA)

    def test_una_salida_sin_explicacion_se_cuenta_aparte(self) -> None:
        """Lo que sale sin que nada lo explique no se mezcla con las salidas explicadas."""
        lecturas = lecturas_de("10", ambito=CON_PAGINA, explicaciones={1: "fuente_declara_baja"})
        (lectura,) = fila_de(parte(lecturas[1:]), "fundae")["lecturas"]
        self.assertEqual(lectura["salidasExplicadas"], {"fin_publicado": 0, "fuente_declara_baja": 1})
        (lectura,) = fila_de(parte(lecturas_de("10", ambito=CON_PAGINA)[1:]), "fundae")["lecturas"]
        self.assertEqual((lectura["salidasSinExplicar"], lectura["salidasExplicadas"]["fin_publicado"]), (1, 0))

    def test_una_fuente_anomala_dice_su_estado_y_sus_motivos(self) -> None:
        """Una lectura anómala lo dice con su motivo y el cambio de forma que lo causó."""
        lecturas = lecturas_de("111", estados="ssa", ambito=CON_PAGINA)
        fila = fila_de(parte(lecturas[2:]), "fundae")
        (lectura,) = fila["lecturas"]
        self.assertEqual((fila["registro"], fila["estado"]), ("lee", "anomala"))
        self.assertEqual(lectura["motivos"], ["forma_cambiada"])
        self.assertTrue(lectura["formaCambiada"])
        self.assertEqual(lectura["valoresNuevos"], 0)

    def test_una_lectura_incompleta_dice_por_que(self) -> None:
        """Un censo que no llegó entero dice su motivo y no cuenta como sano."""
        lecturas = lecturas_de("111", estados="ssi", ambito=CON_PAGINA)
        fila = fila_de(parte(lecturas[2:]), "fundae")
        self.assertEqual(fila["estado"], "incompleta")
        self.assertEqual(fila["lecturas"][0]["motivoIncompleta"], "consulta_fallida")

    def test_una_fuente_que_se_leyo_y_no_dejo_lectura_figura_como_sin_lectura(self) -> None:
        """Se descargó, su adquisición emite y no hay lectura del ciclo: es un problema, no una fuente sana."""
        fila = fila_de(parte([], descargas={"fundae": {"estado": "terminado", "causa": "http-503"}}), "fundae")
        self.assertEqual(fila["registro"], "sin-lectura")
        self.assertIsNone(fila["estado"])
        self.assertEqual(fila["lecturas"], [])
        self.assertEqual(fila["descarga"], {"estado": "terminado", "causa": "http-503"})

    def test_una_lectura_de_otro_ciclo_no_vale_para_este(self) -> None:
        """Sin lecturas del ciclo no hay lectura aunque el almacén tenga las de otros días."""
        salud = parte([], descargas={"barcelonactiva": DESCARGADA})
        self.assertEqual(fila_de(salud, "barcelonactiva")["registro"], "sin-lectura")

    def test_una_fuente_que_aun_no_emite_figura_como_no_registra_todavia(self) -> None:
        """Se descargó, su adquisición aún no emite lecturas: se dice y no se da por sana."""
        fila = fila_de(parte([], descargas={"hp_life": DESCARGADA}), "hp_life")
        self.assertEqual(fila["registro"], "no-registra-todavia")
        self.assertIsNone(fila["estado"])

    def test_una_fuente_que_este_ciclo_no_se_descargo_figura_como_no_leida(self) -> None:
        """Sin descarga en el diario no se espera lectura, pero tampoco se da por observada."""
        salud = parte([])
        self.assertEqual({fila["registro"] for fila in salud["fuentes"]}, {"no-leida"})
        self.assertEqual([fila["fuente"] for fila in salud["fuentes"]], sorted(salud_del_resumen.FUENTES_DE_CURSOS))

    def test_con_varias_lecturas_de_un_ambito_vale_la_ultima(self) -> None:
        """Dos lecturas del mismo ámbito en el ciclo: el parte dice la última."""
        lecturas = lecturas_de("111", estados="sas", ambito=CON_PAGINA)
        fila = fila_de(parte(lecturas[1:]), "fundae")
        self.assertEqual((len(fila["lecturas"]), fila["estado"]), (1, "sana"))

    def test_la_fuente_con_dos_ambitos_toma_el_peor_estado(self) -> None:
        """El estado de la fuente es el del peor de sus ámbitos."""
        sana = lecturas_de("11", ambito=("barcelonactiva", "cibernarium:edicion"))
        anomala = lecturas_de("11", estados="sa", ambito=("barcelonactiva", "cibernarium:programa"))
        fila = fila_de(parte([sana[1], anomala[1]]), "barcelonactiva")
        self.assertEqual(
            [lectura["ambito"] for lectura in fila["lecturas"]], ["cibernarium:edicion", "cibernarium:programa"]
        )
        self.assertEqual(fila["estado"], "anomala")


class DecisionesYError(unittest.TestCase):
    """Las retiradas decididas por grupo y el error observado, con su cota o sin retiradas comprobables."""

    def test_sin_registros_dice_sin_decisiones_y_sin_retiradas_comprobables(self) -> None:
        """Nada del ciclo guarda aún decisiones: el parte lo dice con ceros y no da el error por cero."""
        fila = fila_de(parte(lecturas_de("11", ambito=CON_PAGINA)[1:]), "fundae")
        self.assertEqual(
            fila["decisiones"],
            {
                "registros": 0,
                "retirar": {"fuente": 0, "censo_y_pagina": 0, "censo_repetido": 0},
                "pendientes": 0,
                "mantenidas": 0,
            },
        )
        self.assertEqual(fila["error"]["estado"], "sin-retiradas-comprobables")
        self.assertEqual((fila["error"]["tasa"], fila["error"]["cota95"]), (None, None))

    def test_una_retirada_sin_lectura_sana_posterior_no_es_comprobable(self) -> None:
        """Retirada decidida pero sin lectura sana después: no hay tasa ni cota que dar."""
        lecturas = lecturas_de("1100")
        registros = registros_de(lecturas)
        salud = componer_salud(
            lecturas=lecturas[3:],
            registros=registros[3:],
            error=medir_error(registros, lecturas),
            descargas={},
            emiten=frozenset(),
        )
        fila = fila_de(salud, "formacion")
        self.assertEqual(fila["decisiones"]["retirar"], {"fuente": 0, "censo_y_pagina": 0, "censo_repetido": 1})
        self.assertEqual(fila["error"]["estado"], "sin-retiradas-comprobables")
        self.assertEqual((fila["error"]["retiradas"], fila["error"]["comprobables"]), (1, 0))

    def test_un_error_observado_se_da_con_su_tasa_y_su_naturaleza(self) -> None:
        """Una retirada que reaparece da la tasa observada y dice que es un límite inferior."""
        lecturas = lecturas_de("11001")
        registros = registros_de(lecturas)
        salud = componer_salud(
            lecturas=lecturas[3:],
            registros=registros[3:],
            error=medir_error(registros, lecturas),
            descargas={},
            emiten=frozenset(),
        )
        fila = fila_de(salud, "formacion")
        self.assertEqual(fila["decisiones"]["registros"], 2)
        self.assertEqual(fila["decisiones"]["mantenidas"], 1)
        self.assertEqual(fila["error"]["estado"], "medido")
        self.assertEqual((fila["error"]["reaparecidas"], fila["error"]["tasa"]), (1, 1.0))
        self.assertEqual(fila["error"]["naturaleza"], "limite_inferior")

    def test_cero_errores_comprobados_da_la_cota_y_no_un_cero(self) -> None:
        """Con retiradas comprobables y ningún error se da la cota, no una tasa del 0 %."""
        lecturas = lecturas_de("110000")
        registros = registros_de(lecturas)
        salud = componer_salud(
            lecturas=lecturas[5:],
            registros=registros[5:],
            error=medir_error(registros, lecturas),
            descargas={},
            emiten=frozenset(),
        )
        error = fila_de(salud, "formacion")["error"]
        self.assertEqual((error["estado"], error["comprobables"], error["reaparecidas"]), ("medido", 1, 0))
        self.assertIsNone(error["tasa"])
        self.assertGreater(error["cota95"], 0)

    def test_una_fuente_sin_fila_de_medida_dice_sin_medida(self) -> None:
        """Si la medida no trae la fuente, el parte no inventa un cero."""
        error = fila_de(parte(lecturas_de("11", ambito=CON_PAGINA)[1:], error=[]), "fundae")["error"]
        self.assertEqual((error["estado"], error["tasa"], error["cota95"]), ("sin-medida", None, None))


class VeredictoDelDia(unittest.TestCase):
    """El veredicto sale solo de lo observado: todas sanas, alguna anómala o alguna sin lectura."""

    def veredicto(self, lecturas: list[dict], descargas: dict, emiten: Collection[str] = LEEN_Y_EMITEN) -> str:
        """El veredicto del parte de un ciclo.

        Returns:
            El veredicto del día.
        """
        return parte(lecturas, descargas=descargas, emiten=emiten)["veredicto"]

    def todas(self, **cambios: dict | None) -> dict:
        """Todas las fuentes de cursos descargadas, salvo las que `cambios` anula.

        Returns:
            Las descargas por fuente.
        """
        descargas = dict.fromkeys(salud_del_resumen.FUENTES_DE_CURSOS, DESCARGADA)
        return {fuente: d for fuente, d in {**descargas, **cambios}.items() if d is not None}

    def test_todas_las_fuentes_sanas(self) -> None:
        """Cada fuente de cursos deja una lectura sana: el día es sano."""
        lecturas = [
            lecturas_de("11", ambito=(fuente, f"{fuente}:censo"))[1] for fuente in salud_del_resumen.FUENTES_DE_CURSOS
        ]
        salud = parte(lecturas, descargas=self.todas(), emiten=set(salud_del_resumen.FUENTES_DE_CURSOS))
        self.assertEqual(salud["veredicto"], "sana")
        self.assertEqual(
            salud["cuenta"],
            {
                "sanas": len(salud_del_resumen.FUENTES_DE_CURSOS),
                "anomalas": 0,
                "sinLectura": 0,
                "noRegistran": 0,
                "noLeidas": 0,
            },
        )

    def test_alguna_anomala(self) -> None:
        """Una lectura anómala hace anómalo el día aunque las demás estén sanas."""
        sana = lecturas_de("11", ambito=("barcelonactiva", "cibernarium:edicion"))[1]
        anomala = lecturas_de("11", estados="sa", ambito=CON_PAGINA)[1]
        salud = parte([sana, anomala], descargas=self.todas())
        self.assertEqual(salud["veredicto"], "anomala")
        self.assertEqual((salud["cuenta"]["sanas"], salud["cuenta"]["anomalas"]), (1, 1))

    def test_alguna_sin_lectura_pesa_mas_que_una_anomala(self) -> None:
        """Una fuente que se leyó y no dejó lectura es lo primero que dice el veredicto."""
        anomala = lecturas_de("11", estados="sa", ambito=CON_PAGINA)[1]
        descargas = {"fundae": DESCARGADA, "barcelonactiva": DESCARGADA}
        self.assertEqual(self.veredicto([anomala], descargas), "sin-lectura")

    def test_las_sanas_con_una_que_no_registra_son_sana_parcial(self) -> None:
        """Lo que registra está sano, pero hay una fuente que aún no registra: no se da el día por sano."""
        sana = lecturas_de("11", ambito=CON_PAGINA)[1]
        descargas = {"fundae": DESCARGADA, "hp_life": DESCARGADA}
        self.assertEqual(self.veredicto([sana], descargas), "sana-parcial")

    def test_las_sanas_con_una_no_leida_son_sana_parcial(self) -> None:
        """Una fuente que este ciclo no se descargó no se da por observada."""
        sana = lecturas_de("11", ambito=CON_PAGINA)[1]
        self.assertEqual(self.veredicto([sana], {"fundae": DESCARGADA}), "sana-parcial")

    def test_sin_ninguna_lectura_que_valorar_no_hay_observaciones(self) -> None:
        """Ni sano ni enfermo: nada que valorar."""
        self.assertEqual(self.veredicto([], {}), "sin-observaciones")
        self.assertEqual(self.veredicto([], {"hp_life": DESCARGADA}), "sin-observaciones")

    def test_no_depende_del_paso_de_los_dias_ni_de_fallos_seguidos(self) -> None:
        """La misma fila da el mismo veredicto sea cual sea la historia: solo cuenta lo observado."""
        fila = {"registro": "lee", "estado": "sana"}
        self.assertEqual(veredicto_del_dia([fila]), "sana")
        self.assertEqual(veredicto_del_dia([{"registro": "sin-lectura", "estado": None}, fila]), "sin-lectura")


class DelAlmacen(unittest.TestCase):
    """`parte_de_salud` lee lo guardado en una instalación y no escribe nada."""

    def setUp(self) -> None:
        """Prepara una instalación vacía."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)

    def guardar(self, lecturas: list[dict]) -> None:
        """Escribe las lecturas y los registros de decisiones de un ámbito en la instalación."""
        for lectura in lecturas:
            carpeta = carpeta_de_lecturas(self.raiz, lectura["fuente"])
            carpeta.mkdir(parents=True, exist_ok=True)
            (carpeta / f"{lectura['lectura_id']}.json").write_bytes(bytes_de(lectura))
        for registro in registros_de(lecturas):
            guardar_registro(self.raiz, registro)

    def test_toma_solo_las_lecturas_del_periodo_del_diario(self) -> None:
        """Las lecturas del 13 y el 14 son de este ciclo; las de los demás días no."""
        lecturas = lecturas_de("11001")
        self.guardar(lecturas)
        salud = parte_de_salud(self.raiz, CICLO, [{"fuente": "formacion", "etapa": "descargar", **DESCARGADA}])
        fila = fila_de(salud, "formacion")
        self.assertEqual(fila["registro"], "lee")
        self.assertEqual([lectura["bruto"] for lectura in fila["lecturas"]], [3])
        self.assertEqual(fila["decisiones"]["registros"], 2)
        self.assertEqual(fila["decisiones"]["retirar"]["censo_repetido"], 1)
        self.assertEqual(fila["error"]["estado"], "medido")

    def test_un_periodo_sin_lecturas_deja_la_fuente_sin_lectura_si_emite(self) -> None:
        """Una descarga de fundae sin lecturas en su periodo: sin lectura, con la lectura de otros días ignorada."""
        self.guardar(lecturas_de("11", ambito=CON_PAGINA))
        periodo = {"desde": "2026-11-20T00:00:00+00:00", "hasta": "2026-11-20T01:00:00+00:00"}
        etapas = [{"fuente": "fundae", "etapa": "descargar", "estado": "fallido", "causa": "plazo-agotado"}]
        fila = fila_de(parte_de_salud(self.raiz, periodo, etapas), "fundae")
        self.assertEqual(fila["registro"], "sin-lectura")
        self.assertEqual(fila["descarga"], {"estado": "fallido", "causa": "plazo-agotado"})

    def test_solo_cuenta_la_etapa_de_descarga(self) -> None:
        """Preparar o validar una fuente no es leerla."""
        etapas = [{"fuente": "fundae", "etapa": "validar", **DESCARGADA}]
        salud = parte_de_salud(self.raiz, CICLO, etapas)
        self.assertEqual(fila_de(salud, "fundae")["registro"], "no-leida")

    def test_sin_instalacion_no_se_calcula_y_no_se_da_por_sano(self) -> None:
        """Sin dónde mirar, el parte lo dice."""
        salud = parte_de_salud(None, CICLO, [])
        self.assertEqual((salud["veredicto"], salud["motivo"], salud["fuentes"]), ("no-calculado", "sin-almacen", []))
        self.assertTrue(formas.es_salud_valida(salud))

    def test_un_almacen_ilegible_no_se_calcula(self) -> None:
        """Una lectura guardada que no cumple el contrato deja el parte sin calcular, con su motivo."""
        carpeta = carpeta_de_lecturas(self.raiz, "fundae")
        carpeta.mkdir(parents=True)
        (carpeta / ("a" * 64 + ".json")).write_text("no es una lectura")
        salud = parte_de_salud(self.raiz, CICLO, [])
        self.assertEqual((salud["veredicto"], salud["motivo"]), ("no-calculado", "almacen-ilegible"))

    def test_no_escribe_en_la_instalacion(self) -> None:
        """Leer el parte no cambia ni un archivo de la instalación."""
        self.guardar(lecturas_de("11001"))
        antes = {ruta: ruta.read_bytes() for ruta in (self.raiz / DATOS_RELATIVOS).rglob("*") if ruta.is_file()}
        parte_de_salud(self.raiz, CICLO, [])
        despues = {ruta: ruta.read_bytes() for ruta in (self.raiz / DATOS_RELATIVOS).rglob("*") if ruta.is_file()}
        self.assertEqual(antes, despues)


class FormaYContrato(unittest.TestCase):
    """La forma cerrada del bloque coincide con los contratos de los que sale y rechaza lo que no es suyo."""

    def test_las_listas_cerradas_son_las_de_los_contratos_de_origen(self) -> None:
        """Estados, motivos, explicaciones y grupos de la forma son los de lectura, retirada y medida."""
        self.assertEqual(formas.ESTADOS_DE_LECTURA, contrato_lectura.ESTADOS)
        self.assertEqual(formas.MOTIVOS_DE_LECTURA, contrato_lectura.MOTIVOS)
        self.assertEqual(formas.MOTIVOS_DE_CENSO_INCOMPLETO, contrato_lectura.MOTIVOS_INCOMPLETA)
        self.assertEqual(formas.EXPLICACIONES_DE_SALIDA, contrato_lectura.EXPLICACIONES_DE_SALIDA)
        self.assertEqual(formas.GRUPOS_DE_RETIRADA, error_de_retirada.GRUPOS)
        self.assertEqual(formas.NATURALEZA_DEL_ERROR, error_de_retirada.NATURALEZA)
        self.assertEqual(formas.FUENTE_DE_SALUD.pattern, contrato_lectura.FUENTE.pattern)
        self.assertEqual(formas.AMBITO_DE_SALUD.pattern, contrato_lectura.AMBITO.pattern)
        self.assertEqual(set(salud_del_resumen.GRAVEDAD), set(contrato_lectura.ESTADOS))

    def test_todas_las_fuentes_con_adquisicion_estan_en_la_lista_de_cursos(self) -> None:
        """Si el registro de adquisiciones suma una fuente, el parte la espera."""
        self.assertLessEqual(set(adquisicion_por_fuente.ADQUIRIENTES), set(salud_del_resumen.FUENTES_DE_CURSOS))

    def test_emite_lecturas_sigue_a_los_modulos_de_lectura(self) -> None:
        """Una fuente emite si tiene su módulo de lectura; Cibernàrium y FUNDAE lo tienen hoy."""
        self.assertTrue(salud_del_resumen.emite_lecturas("barcelonactiva"))
        self.assertTrue(salud_del_resumen.emite_lecturas("fundae"))
        raiz = Path(salud_del_resumen.__file__).parents[1] / "cursos" / "fuentes"
        for fuente in salud_del_resumen.FUENTES_DE_CURSOS:
            self.assertEqual(salud_del_resumen.emite_lecturas(fuente), (raiz / fuente / "lectura.py").is_file(), fuente)

    def test_la_forma_rechaza_un_campo_de_mas_uno_de_menos_o_un_valor_fuera_de_lista(self) -> None:
        """El contrato es cerrado: nada se añade, se quita ni se inventa."""
        salud = parte(lecturas_de("11", ambito=CON_PAGINA)[1:], descargas={"fundae": DESCARGADA})
        self.assertTrue(formas.es_salud_valida(salud))
        for cambio in (
            lambda s: s.update(extra=1),
            lambda s: s.pop("cuenta"),
            lambda s: s.update(veredicto="sano"),
            lambda s: s["fuentes"][0].update(registro="bien"),
            lambda s: fila_de(s, "fundae")["lecturas"][0].update(titulo="Curso de ejemplo"),
            lambda s: fila_de(s, "fundae")["error"].update(tasa=2.0),
            lambda s: fila_de(s, "fundae")["decisiones"]["retirar"].update(otro=1),
        ):
            copia = json.loads(json.dumps(salud))
            cambio(copia)
            self.assertFalse(formas.es_salud_valida(copia))
        self.assertFalse(formas.es_salud_valida(None))

    def test_el_parte_solo_lleva_identificadores_y_recuentos(self) -> None:
        """Ninguna cadena del parte es un título, una dirección, una ruta ni un dato personal."""
        lecturas = lecturas_de("11001", estados="sssas", ambito=CON_PAGINA)
        salud = parte(lecturas[3:], descargas={"fundae": {"estado": "terminado", "causa": "http-503"}})
        cadenas = re.findall(r'"([^"]*)"', json.dumps(salud, ensure_ascii=False))
        self.assertTrue(cadenas)
        self.assertTrue(all(re.fullmatch(r"[A-Za-z0-9_:-]+", texto) for texto in cadenas), cadenas)


class EnElResumen(unittest.TestCase):
    """El resumen de la versión 2 lleva el parte y sigue siendo legible por quien lee la versión 1."""

    CAMPOS_V1 = (
        "identidad",
        "periodo",
        "resultado",
        "fases",
        "fuentes",
        "modulos",
        "cursos",
        "respuestasRechazadas",
        "recorte",
    )

    def setUp(self) -> None:
        """Prepara una instalación con lecturas del ciclo y un diario mínimo."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        for lectura in lecturas_de("1100", ambito=CON_PAGINA)[2:]:  # el 12 y el 13, dentro del periodo del diario
            carpeta = carpeta_de_lecturas(self.raiz, lectura["fuente"])
            carpeta.mkdir(parents=True, exist_ok=True)
            (carpeta / f"{lectura['lectura_id']}.json").write_bytes(bytes_de(lectura))
        base = {"version": 1, "run": "123", "revisionCodigo": "6" * 40, "reserva": "41"}
        etapa = {
            "fase": "etapa-fuente",
            "fuente": "fundae",
            "etapa": "descargar",
            "estado": "terminado",
            "intentoFuente": "4a1f3b52-0c1d-4e8a-9b7a-1d2e3f405162",
            "inicio": "2026-11-12T05:00:00+00:00",
            "fin": "2026-11-12T05:01:00+00:00",
            "codigo": 0,
            "causa": None,
        }
        self.lineas = [
            json.dumps({**base, "utc": "2026-11-10T00:00:00+00:00", "fase": "configuracion", "estado": "inicio"}),
            json.dumps({**base, "utc": "2026-11-12T05:01:00+00:00", **etapa}),
            json.dumps({**base, "utc": "2026-11-17T23:00:00+00:00", "fase": "configuracion", "estado": "confirmado"}),
        ]

    def resumen(self, raiz: Path | None) -> dict:
        """El resumen del diario mínimo, compuesto y leído de vuelta.

        Returns:
            El documento del resumen.
        """
        return json.loads(resumen_diario.componer(self.lineas, "ejecutar", "123", "1", raiz))

    def test_la_version_2_lleva_el_parte_y_valida_su_forma(self) -> None:
        """El resumen dice versión 2, trae `salud` con la forma cerrada y el veredicto del día."""
        resumen = self.resumen(self.raiz)
        self.assertEqual(resumen["version"], 2)
        self.assertTrue(formas.es_salud_valida(resumen["salud"]))
        fundae = fila_de(resumen["salud"], "fundae")
        self.assertEqual((fundae["registro"], fundae["estado"]), ("lee", "sana"))
        self.assertEqual(fila_de(resumen["salud"], "hp_life")["registro"], "no-leida")
        self.assertEqual(resumen["salud"]["veredicto"], "sana-parcial")

    def test_sin_instalacion_el_resumen_dice_que_no_se_calculo(self) -> None:
        """El enganche sin instalación no inventa un parte sano: el resumen sigue siendo válido y lo dice."""
        resumen = self.resumen(None)
        self.assertEqual((resumen["salud"]["veredicto"], resumen["salud"]["motivo"]), ("no-calculado", "sin-almacen"))
        self.assertEqual(resumen["fuentes"][0]["fuente"], "fundae")

    def test_un_lector_de_la_version_1_no_se_rompe(self) -> None:
        """Quien lee por presencia de campo encuentra los mismos campos de la versión 1, con la misma forma."""
        resumen = self.resumen(self.raiz)
        for campo in self.CAMPOS_V1:
            self.assertIn(campo, resumen)
        self.assertEqual(set(resumen["fuentes"][0]), set(self.resumen(None)["fuentes"][0]))
        self.assertEqual(resumen["fuentes"][0]["estado"], "terminado")
        self.assertEqual(set(resumen) - set(self.CAMPOS_V1), {"version", "identidadOidc", "salud", "retenciones"})

    def test_el_resumen_con_todas_las_fuentes_cabe_con_holgura(self) -> None:
        """Seis fuentes, cada una con dos ámbitos, retiradas y motivos, ocupan una fracción del tope."""
        for fuente in salud_del_resumen.FUENTES_DE_CURSOS:
            for ambito in (f"{fuente}:uno", f"{fuente}:dos"):
                lecturas = lecturas_de("11001", estados="ssssa", ambito=(fuente, ambito))
                carpeta = carpeta_de_lecturas(self.raiz, fuente)
                carpeta.mkdir(parents=True, exist_ok=True)
                for lectura in lecturas[3:]:
                    (carpeta / f"{lectura['lectura_id']}.json").write_bytes(bytes_de(lectura))
        contenido = resumen_diario.componer(self.lineas, "ejecutar", "123", "1", self.raiz)
        salud = json.loads(contenido)["salud"]
        self.assertEqual(len(salud["fuentes"]), len(salud_del_resumen.FUENTES_DE_CURSOS))
        self.assertTrue(all(len(fila["lecturas"]) >= AMBITOS_POR_FUENTE for fila in salud["fuentes"]))
        self.assertLess(len(json.dumps(salud).encode()), 16 * 1024)
        self.assertLess(len(contenido), formas.MAX_RESUMEN // 2)


if __name__ == "__main__":
    unittest.main()
