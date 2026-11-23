"""Cadencias por conjunto y permisos de descarga separados de la reconstrucción local."""

import unittest
from datetime import UTC, datetime, timedelta, timezone
from unittest import mock

from plataforma_datos.orquestacion import planificacion_de_comprobaciones as planificacion
from plataforma_datos.orquestacion.modulos import Modulo
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES

AHORA = datetime(2026, 10, 18, 12, tzinfo=UTC)
AUTOMATICAS = (
    "oit",
    "clasificaciones",
    "cataluna",
    "ocupados",
    "tich",
    "salarios",
    "formacion",
    "consorci",
    "acreditacion",
    "citilab",
    "enlaces_lecturas",
    "derechos",
    "idescat",
    "nombres",
    "empresas",
    "observatori",
    "actic",
    "barcelonactiva",
    "fundae",
    "hp_life",
    "cibervoluntarios",
    "claude_academy",
    "territorios",
    "mundo_eurostat",
    "ilostat",
    "tic_llars",
    "clima_empresarial",
    "ue_eurostat",
    "decada_digital",
    "ia_nacional_isl",
    "ia_nacional_gbr",
    "ia_nacional_bra",
    "ia_nacional_che",
    "ia_nacional_isr",
    "ia_nacional_kor",
    "epa",
    "eaes",
    "ofertas",
    "enlaces",
)


class PruebaPlanificacionComprobaciones(unittest.TestCase):
    """Una decisión de cadencia no equivale a una consulta correcta ni a una versión activa."""

    @staticmethod
    def recientes() -> dict[str, datetime]:
        """Prepara últimos intentos conocidos para todos los conjuntos.

        Returns:
            Instante actual por ID; no expresa éxito ni vigencia.
        """
        return {conjunto.id: AHORA for conjunto in planificacion.CONJUNTOS}

    def test_cobertura_exacta_fuentes_mixta_y_externas(self) -> None:
        """Todas las fuentes, formación dividida y los dos productores externos tienen cobertura."""
        conjuntos = planificacion.CONJUNTOS
        ids = [conjunto.id for conjunto in conjuntos]
        self.assertEqual(len(conjuntos), len(FUENTES) + 3)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual({c.fuente for c in conjuntos if c.fuente is not None}, set(FUENTES))
        self.assertEqual([c.id for c in conjuntos if c.fuente == "formacion"], ["soc-oferta", "formacion-catalogos"])
        self.assertEqual([c.id for c in conjuntos if c.fuente is None], ["ia_nacional", "encuestas_isco4"])
        self.assertEqual(
            {c.id for c in conjuntos if c.intervalo_dias == 1},
            {
                "soc-oferta",
                "consorci",
                "citilab",
                "barcelonactiva",
                "fundae",
                "hp_life",
                "cibervoluntarios",
                "claude_academy",
                "enlaces",
            },
        )
        for conjunto in conjuntos:
            if conjunto.operacion == "descargar":
                self.assertIsNotNone(conjunto.fuente)
                self.assertIn(conjunto.intervalo_dias, (1, 7, 30))
            else:
                self.assertIsNone(conjunto.intervalo_dias)

    def test_primera_seleccion_exacta_sin_evidencia(self) -> None:
        """La ausencia de intentos vence las consultas soportadas, sin simular lectores para las demás."""
        plan = planificacion.planificar(AHORA, {})
        self.assertEqual(plan.fuentes, AUTOMATICAS)
        self.assertEqual(plan.modulos, AUTOMATICAS)
        for pendiente in ("esco", "formacion-catalogos", "agencia", "abierta", "ia_nacional", "encuestas_isco4"):
            self.assertIn(pendiente, plan.revisiones)
        for historica in ("censo", "sectores", "certificados2016", "eurobarometro", "ceo_panel", "datos_globales"):
            self.assertNotIn(historica, plan.fuentes)
            self.assertNotIn(historica, plan.revisiones)

    def test_cero_trabajo_automatico_no_oculta_revisiones(self) -> None:
        """Los intentos recientes evitan trabajo, pero no convierten referencias sin sonda en actualizadas."""
        plan = planificacion.planificar(AHORA, self.recientes())
        self.assertEqual(plan.fuentes, ())
        self.assertEqual(plan.modulos, ())
        self.assertIn("oit", plan.revisiones)
        self.assertIn("territorios", plan.revisiones)
        self.assertIn("formacion-catalogos", plan.revisiones)
        self.assertNotIn("actualizado", plan._fields)

    def test_limite_diario_por_fecha_utc(self) -> None:
        """Los canales diarios vencen en la siguiente fecha UTC, incluso tras un intento fallido."""
        intentos = self.recientes()
        diarios = (
            "soc-oferta",
            "consorci",
            "citilab",
            "barcelonactiva",
            "fundae",
            "hp_life",
            "cibervoluntarios",
            "claude_academy",
        )
        for identificador in diarios:
            intentos[identificador] = AHORA.replace(hour=0)
        self.assertEqual(planificacion.planificar(AHORA, intentos).fuentes, ())
        for identificador in diarios:
            intentos[identificador] = AHORA - timedelta(days=1) + timedelta(microseconds=1)
        plan = planificacion.planificar(AHORA, intentos)
        self.assertEqual(
            plan.fuentes,
            (
                "formacion",
                "consorci",
                "citilab",
                "barcelonactiva",
                "fundae",
                "hp_life",
                "cibervoluntarios",
                "claude_academy",
            ),
        )
        self.assertEqual(plan.modulos, plan.fuentes)

    def test_limite_de_30_dias_independiente_de_frecuencia_editorial(self) -> None:
        """La sonda anual vence a los 30 días de calendario, sin confundir detección con admisión de otra edición."""
        intentos = self.recientes()
        intentos["tich"] = AHORA - timedelta(days=29)
        self.assertEqual(planificacion.planificar(AHORA, intentos).fuentes, ())
        intentos["tich"] = AHORA - timedelta(days=30) + timedelta(microseconds=1)
        self.assertEqual(planificacion.planificar(AHORA, intentos).fuentes, ("tich",))
        for fuente in ("tich", "tic_llars", "salarios"):
            self.assertNotIn(fuente, planificacion.planificar(AHORA, intentos).revisiones)

    def test_cola_variable_no_salta_consulta_diaria_ni_de_30_dias(self) -> None:
        """Llegar a las 04:16 tras un intento a las 04:17 no posterga otro día las consultas que vencen."""
        ahora = AHORA.replace(hour=4, minute=16)
        intentos = {conjunto.id: ahora for conjunto in planificacion.CONJUNTOS}
        for identificador in ("soc-oferta", "consorci", "citilab"):
            intentos[identificador] = ahora - timedelta(days=1) + timedelta(minutes=1)
        self.assertEqual(planificacion.planificar(ahora, intentos).fuentes, ("formacion", "consorci", "citilab"))
        intentos["tich"] = ahora - timedelta(days=30) + timedelta(minutes=1)
        self.assertEqual(
            planificacion.planificar(ahora, intentos).fuentes, ("tich", "formacion", "consorci", "citilab")
        )

    def test_sondas_de_nombres_y_nacionales_no_equivalen_a_ediciones_fijas(self) -> None:
        """El descubrimiento evita revisión permanente; sin sonda sigue siendo necesaria."""
        conjuntos = {conjunto.id: conjunto for conjunto in planificacion.CONJUNTOS}
        plan = planificacion.planificar(AHORA, self.recientes())
        for fuente in ("nombres", "ia_nacional_gbr", "ia_nacional_bra"):
            with self.subTest(fuente=fuente):
                self.assertEqual(conjuntos[fuente].alcance, "descubre-edicion")
                self.assertEqual(conjuntos[fuente].intervalo_dias, 30)
                self.assertNotIn(fuente, plan.revisiones)
        for fuente in ("ia_nacional_isl", "ia_nacional_che", "ia_nacional_isr", "ia_nacional_kor"):
            self.assertIn(fuente, plan.revisiones)

    def test_medianoche_utc_y_cambio_de_anio_sin_margen_oculto(self) -> None:
        """Cambiar la fecha UTC vence la consulta diaria sin sumar 24 h ni adelantarla dentro del mismo día."""
        ahora = datetime(2027, 1, 1, tzinfo=UTC)
        intentos = {conjunto.id: ahora for conjunto in planificacion.CONJUNTOS}
        intentos["soc-oferta"] = ahora - timedelta(microseconds=1)
        self.assertEqual(planificacion.planificar(ahora, intentos).fuentes, ("formacion",))
        intentos["soc-oferta"] = ahora
        self.assertEqual(planificacion.planificar(ahora, intentos).fuentes, ())

    def test_forzar_consulta_sin_inventar_descargas_manuales(self) -> None:
        """Forzar salta intervalos, pero solo permite las descargas ya soportadas."""
        plan = planificacion.planificar(AHORA, self.recientes(), forzar=True)
        self.assertEqual(plan.fuentes, AUTOMATICAS)
        self.assertNotIn("esco", plan.fuentes)
        self.assertNotIn("datos_globales", plan.fuentes)
        self.assertIn("formacion-catalogos", plan.revisiones)

    def test_las_dos_partes_del_visor_se_consultan_juntas(self) -> None:
        """Un intento pendiente consulta el mismo corte de Cataluña y sus desgloses del Observatori."""
        for vencida in ("cataluna", "observatori"):
            for sin_intento in (False, True):
                with self.subTest(vencida=vencida, sin_intento=sin_intento):
                    intentos = self.recientes()
                    if sin_intento:
                        del intentos[vencida]
                    else:
                        intentos[vencida] -= timedelta(days=30)
                    plan = planificacion.planificar(AHORA, intentos)
                    self.assertEqual(plan.fuentes, ("cataluna", "observatori"))
                    self.assertEqual(plan.modulos, plan.fuentes)

    def test_recomponer_el_visor_no_autoriza_consultas_remotas(self) -> None:
        """Una reconstrucción local conserva los permisos aunque el visor tenga dos consumidores."""
        for fuente in ("cataluna", "observatori"):
            with self.subTest(fuente=fuente):
                plan = planificacion.planificar(AHORA, self.recientes(), recomponer=(fuente,))
                self.assertEqual(plan.fuentes, ())
                self.assertEqual(plan.modulos, (fuente,))

    def test_fechas_invalidas_no_aplazan_trabajo(self) -> None:
        """Naive, otro huso y futuro se rechazan también al forzar, sin ignorar intentos ajenos."""
        for instante in (
            AHORA.replace(tzinfo=None),
            AHORA.astimezone(timezone(timedelta(hours=1))),
            AHORA + timedelta(microseconds=1),
            "2026-10-18",
        ):
            for forzar in (False, True):
                with self.subTest(instante=instante, forzar=forzar), self.assertRaises(ValueError):
                    planificacion.planificar(AHORA, {"soc-oferta": instante}, forzar=forzar)
        with self.assertRaises(ValueError):
            planificacion.planificar(AHORA.replace(tzinfo=None), {})
        with self.assertRaises(ValueError):
            planificacion.planificar(AHORA, {"desconocido": AHORA})
        with self.assertRaises(ValueError):
            planificacion.planificar(AHORA, {}, forzar="si")

    def test_recomponer_no_concede_descarga_ni_cierra_dependencias(self) -> None:
        """El plan elige módulos locales; la propagación de cambios sigue perteneciendo al motor existente."""
        plan = planificacion.planificar(AHORA, self.recientes(), recomponer=("datos_globales", "tich", "tich"))
        self.assertEqual(plan.fuentes, ())
        self.assertEqual(plan.modulos, ("tich", "datos_globales"))
        with self.assertRaises(ValueError):
            planificacion.planificar(AHORA, {}, recomponer=("ajeno",))

    def test_modulo_multifuente_solo_autoriza_fuentes_vencidas(self) -> None:
        """Dos conjuntos de una fuente deduplican y otra fuente del mismo módulo no obtiene descarga."""
        conjuntos = (
            planificacion.Conjunto("a1", "a", "cambiante", "catalogo-actual", "descargar", 1),
            planificacion.Conjunto("a2", "a", "cambiante", "catalogo-actual", "descargar", 1),
            planificacion.Conjunto("b", "b", "cambiante", "catalogo-actual", "descargar", 7),
        )
        modulos = (Modulo("grupo", ("a", "b")), Modulo("consumidor", ("c",), ("grupo",)))
        with (
            mock.patch.object(planificacion, "CONJUNTOS", conjuntos),
            mock.patch.object(planificacion, "MODULOS", modulos),
        ):
            plan = planificacion.planificar(AHORA, {"b": AHORA}, recomponer=("consumidor",))
        self.assertEqual(plan.fuentes, ("a",))
        self.assertEqual(plan.modulos, ("grupo", "consumidor"))
        self.assertEqual(plan.revisiones, ())

    def test_entrada_no_se_muta_y_consultas_no_dependen_del_orden_del_mapping(self) -> None:
        """El plan es determinista y solo devuelve las tres colecciones del contrato."""
        intentos = self.recientes()
        copia = dict(intentos)
        plan = planificacion.planificar(AHORA, intentos)
        self.assertEqual(intentos, copia)
        self.assertEqual(plan, planificacion.planificar(AHORA, dict(reversed(list(intentos.items())))))
        self.assertEqual(plan._fields, ("fuentes", "modulos", "revisiones"))


if __name__ == "__main__":
    unittest.main()
