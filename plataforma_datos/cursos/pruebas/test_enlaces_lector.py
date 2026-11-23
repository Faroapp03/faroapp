"""El lector de enlaces de punta a punta, con carpetas temporales y respuestas simuladas, y su primer ciclo."""

import io
import json
import tempfile
import unittest
from collections.abc import Callable
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import ArchivoFaltante, ValidacionFallida
from plataforma_datos.cursos.fuentes.enlaces import candidatos as modulo_candidatos
from plataforma_datos.cursos.fuentes.enlaces import consulta, lector
from plataforma_datos.cursos.fuentes.enlaces.candidatos import Candidato
from plataforma_datos.cursos.fuentes.enlaces.observaciones import (
    CURSOS,
    PROGRAMAS,
    WEBS,
    es_heredado,
    esta_oculto,
    esta_visible_el_programa,
    estado_heredado,
    observacion,
    orden_de_consulta,
)
from plataforma_datos.cursos.pruebas.instalacion_de_formacion import (
    VALIDACION_ADMITIDA,
    cursos_de_la_muestra,
    montar_consorci,
    montar_formacion,
)

ROTA = "https://rota.example/"
SANA = "https://sana.example/"
CAIDA = "https://caida.example/"
CURSOS_REALES = cursos_de_la_muestra()
ID_FUERA, ID_BUENA = (curso["id"] for curso in CURSOS_REALES)
FICHA_FUERA, FICHA_BUENA = (curso["enlace"] for curso in CURSOS_REALES)
ANTES = "2026-10-06"
RESPONDIO = 200
LIMITADO = 429
CONSORCI = {
    "ediciones": [{"web": ROTA}, {"web": SANA}],
    "entidades": {"a": {"web": CAIDA}, "b": {"web": None}},
}
PAQUETE_ANTERIOR = {
    "programas": {"comprobado": ANTES, "candidatas": 2, "codigos": ["ADGD093PO"]},
    "webs": {
        "comprobado": ANTES,
        "candidatas": 3,
        "rotas": [ROTA, "https://ya-no-existe.example/"],
        "sin_respuesta": [CAIDA],
    },
    "cursos": {"comprobado": ANTES, "candidatos": 2, "fuera_de_la_oferta": [ID_FUERA, "retirado"]},
}
PDF_ADGD = modulo_candidatos.direccion_del_programa("ADGD093PO")
PDF_SEAD = modulo_candidatos.direccion_del_programa("SEAD0058")


def _respuestas(codigos: dict[str, int | None]) -> Callable[[str, str], dict]:
    """Una consulta simulada.

    Returns:
        La función que da, por dirección, la observación de su código o de un corte de red si es None.
    """

    def pedir(url: str, conjunto: str) -> dict:
        codigo = codigos[url]
        instante = "2026-11-15T08:00:00+00:00"
        if codigo is None:
            return observacion(instante, None, None, motivo="red")
        es_pdf = True if conjunto == PROGRAMAS and codigo == RESPONDIO else None
        huella = "c" * 64 if es_pdf else None
        return observacion(instante, codigo, url, es_pdf=es_pdf, huella=huella)

    return pedir


class LectorDePuntaAPunta(unittest.TestCase):
    """descargar, preparar y validar con un paquete anterior de semilla."""

    def setUp(self) -> None:
        """Carpetas temporales para originales, preparados, validados y paquete."""
        self.contexto = ExitStack()
        self.addCleanup(self.contexto.close)
        raiz = Path(self.contexto.enter_context(tempfile.TemporaryDirectory()))
        self.raiz = raiz
        for nombre in ("ORIGINALES", "PREPARADOS", "VALIDADOS"):
            self.contexto.enter_context(mock.patch.object(entrada_salida, nombre, raiz / nombre.lower()))
        original, preparado = raiz / "originales" / "enlaces", raiz / "preparados" / "enlaces"
        self.contexto.enter_context(mock.patch.object(lector, "ORIGINAL", original))
        self.contexto.enter_context(mock.patch.object(lector, "PREPARADO", preparado))
        self.contexto.enter_context(mock.patch.object(lector, "PROCEDENCIA", original / "procedencia.json"))
        paquete = raiz / "paquete"
        paquete.mkdir()
        self.contexto.enter_context(mock.patch.object(lector, "PAQUETE", paquete))
        self.paquete = paquete / "enlaces-comprobados.json"
        self.paquete.write_text(json.dumps(PAQUETE_ANTERIOR), encoding="utf-8")
        montar_consorci(CONSORCI)
        self.rutas_de_formacion = montar_formacion(self.contexto)
        self.contexto.enter_context(redirect_stdout(io.StringIO()))

    def _ciclo(self, codigos: dict[str, int | None]) -> dict:
        with mock.patch.object(consulta, "consultar", side_effect=_respuestas(codigos)):
            lector.descargar()
        lector.preparar()
        lector.validar()
        return json.loads(entrada_salida.ruta_del_conjunto("enlaces").read_text(encoding="utf-8"))

    def test_los_candidatos_salen_de_los_preparados_de_la_formacion_y_del_conjunto_del_consorci(self) -> None:
        """Webs del Consorci, una ficha por curso y un programa por especialidad de la formación."""
        candidatos = lector._fuentes_del_paquete()
        por_conjunto = {c: sorted(x.clave for x in candidatos if x.conjunto == c) for c in (WEBS, CURSOS, PROGRAMAS)}
        self.assertEqual(por_conjunto[WEBS], sorted([ROTA, SANA, CAIDA]))
        self.assertEqual(por_conjunto[CURSOS], sorted([ID_FUERA, ID_BUENA]))
        self.assertEqual(por_conjunto[PROGRAMAS], ["ADGD093PO", "SEAD0058"])
        self.assertEqual(
            {x.url for x in candidatos if x.conjunto == CURSOS},
            {FICHA_FUERA, FICHA_BUENA},
        )

    def test_la_formacion_no_tiene_conjunto_validado_y_ninguna_orden_lo_lee(self) -> None:
        """Un ciclo entero con la instalación como es: en validados/formacion solo está validacion.json."""
        formacion = entrada_salida.carpetas("formacion").validado
        self.assertEqual([ruta.name for ruta in formacion.iterdir()], ["validacion.json"])
        self.assertFalse(entrada_salida.ruta_del_conjunto("formacion").exists())
        codigos = {ROTA: 200, SANA: 200, CAIDA: 200, FICHA_FUERA: 200, FICHA_BUENA: 200, PDF_ADGD: 200, PDF_SEAD: 200}
        self._ciclo(codigos)
        self.assertEqual([ruta.name for ruta in formacion.iterdir()], ["validacion.json"])

    def test_sin_la_validacion_admitida_de_la_formacion_la_descarga_falla_y_no_guarda_nada(self) -> None:
        """Una validación que no admite la formación detiene la orden con su motivo."""
        entrada_salida.guardar_json(
            entrada_salida.carpetas("formacion").validacion,
            {**VALIDACION_ADMITIDA, "estado": "Rechazado"},
        )
        with self.assertRaisesRegex(ValidacionFallida, "enlaces: .*formacion: no admitida"):
            lector.descargar()
        self.assertFalse((self.raiz / "originales" / "enlaces" / "observaciones.json").exists())

    def test_sin_el_informe_de_validacion_de_la_formacion_la_orden_dice_que_falta(self) -> None:
        """Si falta validacion.json, el error nombra el archivo que falta."""
        codigos = {ROTA: 200, SANA: 200, CAIDA: 200, FICHA_FUERA: 200, FICHA_BUENA: 200, PDF_ADGD: 200, PDF_SEAD: 200}
        self._ciclo(codigos)
        entrada_salida.carpetas("formacion").validacion.unlink()
        for orden in (lector.descargar, lector.preparar, lector.validar):
            with self.subTest(orden=orden.__name__), self.assertRaisesRegex(ArchivoFaltante, "validacion.json"):
                orden()

    def test_sin_un_preparado_de_la_formacion_la_orden_dice_cual_falta(self) -> None:
        """Si falta un preparado, el error nombra el archivo y no se guarda nada."""
        self.rutas_de_formacion["cursos"].unlink()
        with self.assertRaisesRegex(ArchivoFaltante, "enlaces: .*falta .*soc-cursos.jsonl"):
            lector.descargar()
        self.assertFalse((self.raiz / "originales" / "enlaces" / "observaciones.json").exists())

    def test_sin_el_conjunto_validado_del_consorci_la_orden_dice_que_falta(self) -> None:
        """El Consorci se lee de su conjunto validado y de su validación admitida."""
        entrada_salida.ruta_del_conjunto("consorci").unlink()
        with self.assertRaisesRegex(ArchivoFaltante, "consorci.json"):
            lector.descargar()

    def test_la_semilla_son_los_programas_enlazados_y_lo_oculto_del_paquete_anterior(self) -> None:
        """Se heredan los programas buenos, las webs rotas y los cursos fuera; no la web que no respondió una vez."""
        heredados = [(conjunto, clave, esta_oculto(estado)) for conjunto, clave, estado in lector._heredados()]
        self.assertEqual(
            heredados,
            [
                (PROGRAMAS, "ADGD093PO", False),
                (WEBS, ROTA, True),
                (WEBS, "https://ya-no-existe.example/", True),
                (CURSOS, ID_FUERA, True),
                (CURSOS, "retirado", True),
            ],
        )
        self.assertTrue(all(es_heredado(estado) for _c, _k, estado in lector._heredados()))

    def test_sin_estado_propio_se_hereda_tambien_del_paquete_con_observaciones(self) -> None:
        """Con el paquete ya en su forma nueva, lo oculto conserva su evidencia y lo enlazado sigue enlazado."""
        evidencia = {"url": ROTA, "codigo_http": 404, "observado_el": "2026-11-01T08:00:00+00:00", "url_final": ROTA}
        nuevo = {
            "version": 2,
            "programas": {"comprobado": ANTES, "candidatas": 2, "codigos": ["ADGD093PO"]},
            "webs": {"comprobado": ANTES, "candidatas": 3, "ocultas": [evidencia]},
            "cursos": {
                "comprobado": ANTES,
                "candidatos": 2,
                "ocultos": [{**evidencia, "url": FICHA_FUERA, "id": ID_FUERA}],
            },
        }
        self.paquete.write_text(json.dumps(nuevo), encoding="utf-8")
        previo = lector._estado_previo(lector._fuentes_del_paquete())
        self.assertTrue(esta_oculto(previo[WEBS][ROTA]))
        self.assertEqual(previo[WEBS][ROTA]["concluyente"]["codigo_http"], 404)
        self.assertEqual(previo[WEBS][ROTA]["concluyente"]["observado_el"], evidencia["observado_el"])
        self.assertTrue(esta_oculto(previo[CURSOS][FICHA_FUERA]))
        self.assertTrue(esta_visible_el_programa(previo[PROGRAMAS][PDF_ADGD]))
        self.assertNotIn(SANA, previo[WEBS])

    def test_un_oculto_heredado_con_un_fallo_pasajero_sigue_oculto_y_la_validacion_se_admite(self) -> None:
        """Una web heredada oculta cuya primera consulta falla queda pendiente: se admite y va la primera en la cola."""
        codigos = {ROTA: None, SANA: 200, CAIDA: 200, FICHA_FUERA: 503, FICHA_BUENA: 200, PDF_ADGD: 200, PDF_SEAD: 200}
        conjunto = self._ciclo(codigos)
        self.assertEqual([e["url"] for e in conjunto["webs"]["ocultas"]], [ROTA])
        self.assertEqual([e["id"] for e in conjunto["cursos"]["ocultos"]], [ID_FUERA])
        informe = json.loads((self.raiz / "validados" / "enlaces" / "validacion.json").read_text(encoding="utf-8"))
        self.assertTrue(informe["estado"].startswith("Admitido"))
        observaciones = json.loads(
            (self.raiz / "originales" / "enlaces" / "observaciones.json").read_text(encoding="utf-8")
        )
        estado_rota = observaciones["enlaces"][WEBS][ROTA]
        self.assertEqual(estado_rota["ultima"]["motivo"], "red")
        previo = {c: dict(observaciones["enlaces"][c]) for c in observaciones["enlaces"]}
        orden = sorted(
            lector._fuentes_del_paquete(),
            key=lambda c: orden_de_consulta(c.url, previo[c.conjunto].get(c.url), c.conjunto),
        )
        self.assertEqual([c.url for c in orden[:2]], [ROTA, FICHA_FUERA])

    def test_antes_de_la_primera_consulta_sigue_oculto_lo_que_el_paquete_ocultaba(self) -> None:
        """Con un tope de cero consultas nada reaparece: la web rota y el curso fuera siguen ocultos, sin código."""
        previo = lector._estado_previo(lector._fuentes_del_paquete())
        paquete = lector.conjunto_del_paquete(lector._fuentes_del_paquete(), previo)
        self.assertEqual([e["url"] for e in paquete["webs"]["ocultas"]], [ROTA])
        self.assertEqual(paquete["webs"]["ocultas"][0]["codigo_http"], None)
        self.assertEqual([e["id"] for e in paquete["cursos"]["ocultos"]], [ID_FUERA])
        self.assertEqual(paquete["programas"]["codigos"], ["ADGD093PO"])

    def test_el_primer_ciclo_sustituye_lo_heredado_por_observaciones_propias(self) -> None:
        """Lo que responde vuelve; un 404 queda oculto con su código y su fecha; un corte de red no cambia nada."""
        codigos = {
            ROTA: 200,
            SANA: 200,
            CAIDA: None,
            FICHA_FUERA: 404,
            FICHA_BUENA: 200,
            PDF_ADGD: 404,
            PDF_SEAD: 200,
        }
        conjunto = self._ciclo(codigos)
        self.assertEqual(conjunto["version"], 2)
        self.assertEqual(conjunto["webs"]["ocultas"], [])
        self.assertEqual(
            conjunto["cursos"]["ocultos"],
            [
                {
                    "url": FICHA_FUERA,
                    "codigo_http": 404,
                    "observado_el": "2026-11-15T08:00:00+00:00",
                    "url_final": FICHA_FUERA,
                    "id": ID_FUERA,
                }
            ],
        )
        self.assertEqual(conjunto["programas"]["codigos"], ["SEAD0058"])
        informe = json.loads((self.raiz / "validados" / "enlaces" / "validacion.json").read_text(encoding="utf-8"))
        self.assertTrue(informe["estado"].startswith("Admitido"))
        # Si es la pasada larga depende del día de la semana en que se ejecuta la prueba: basta con que se diga.
        self.assertIsInstance(informe["cobertura"].pop("dia_largo"), bool)
        self.assertEqual(
            informe["cobertura"],
            {
                "comprobados": 6,
                "ocultos": 1,
                "sin_comprobar": 1,
                "candidatos": 7,
                "consultadas": 7,
                # Las respuestas simuladas llevan una fecha fija: frente al reloj real, lo expuesto queda vencido.
                "expuestos": 3,
                "expuestos_vencidos": 3,
                "ensenados": 1,
                "ensenados_vencidos": 0,
                "fichas_fuera_de_la_muestra": 0,
                "dominios_con_anomalia": [],
            },
        )
        self.assertNotIn("consulta_parcial", informe)

    def test_el_segundo_ciclo_parte_de_las_observaciones_guardadas(self) -> None:
        """Una web que dio 404 vuelve cuando responde; un fallo de red posterior no la oculta de nuevo."""
        primero = {ROTA: 404, SANA: 200, CAIDA: 200, FICHA_FUERA: 200, FICHA_BUENA: 200, PDF_ADGD: 200, PDF_SEAD: 200}
        self.assertEqual([e["url"] for e in self._ciclo(primero)["webs"]["ocultas"]], [ROTA])
        self.assertEqual(self._ciclo({**primero, ROTA: 200})["webs"]["ocultas"], [])
        self.assertEqual(self._ciclo({**primero, ROTA: None})["webs"]["ocultas"], [])

    def test_el_tope_corta_el_ciclo_y_el_informe_lo_dice(self) -> None:
        """Con un tope de tres consultas el informe lleva el motivo; los enlaces sin consultar conservan lo anterior."""
        codigos = {ROTA: 200, SANA: 200, CAIDA: 200, FICHA_FUERA: 200, FICHA_BUENA: 200, PDF_ADGD: 200, PDF_SEAD: 200}
        # El mismo tope el día de la pasada larga: la prueba no depende del día de la semana.
        with mock.patch.object(lector, "MAX_CONSULTAS", 3), mock.patch.object(lector, "MAX_CONSULTAS_DIA_LARGO", 3):
            self._ciclo(codigos)
        informe = json.loads((self.raiz / "validados" / "enlaces" / "validacion.json").read_text(encoding="utf-8"))
        self.assertEqual(informe["consulta_parcial"], {"motivo": lector.TOPE})
        self.assertEqual(informe["cobertura"]["consultadas"], 3)

    def test_un_observaciones_de_un_ciclo_anterior_sin_dominios_con_limite_se_valida(self) -> None:
        """La clave `dominios_con_limite` puede faltar en lo guardado por un ciclo anterior."""
        codigos = {ROTA: 200, SANA: 200, CAIDA: 200, FICHA_FUERA: 200, FICHA_BUENA: 200, PDF_ADGD: 200, PDF_SEAD: 200}
        self._ciclo(codigos)
        guardado = json.loads((self.raiz / "originales" / "enlaces" / "observaciones.json").read_text(encoding="utf-8"))
        del guardado["ciclo"]["dominios_con_limite"]
        lector._escribir_observaciones(guardado["enlaces"], guardado["ciclo"])
        lector.preparar()
        lector.validar()
        informe = json.loads((self.raiz / "validados" / "enlaces" / "validacion.json").read_text(encoding="utf-8"))
        self.assertTrue(informe["estado"].startswith("Admitido"))


class FrenoPorDominio(unittest.TestCase):
    """Tres 403 o 429 seguidos de un dominio lo saltan el resto del ciclo, sin tocar lo no consultado."""

    def setUp(self) -> None:
        """Cinco webs de un dominio y una de otro."""
        self.candidatos = [
            Candidato(f"https://limitado.example/{n}", WEBS, f"https://limitado.example/{n}") for n in range(5)
        ]
        self.candidatos.append(Candidato(SANA, WEBS, SANA))
        self.pedidas: list[str] = []

    def _pedir(self, url: str, _conjunto: str) -> dict:
        self.pedidas.append(url)
        codigo = LIMITADO if "limitado" in url else RESPONDIO
        return observacion("2026-11-15T08:00:00+00:00", codigo, url)

    def test_tres_limites_seguidos_saltan_el_dominio_y_el_ciclo_lo_dice(self) -> None:
        """El dominio recibe tres consultas; las dos restantes quedan sin tocar y el informe lleva el motivo."""
        previo = {WEBS: {}, CURSOS: {}, PROGRAMAS: {}}
        estado, ciclo = lector.comprobar_ciclo(self.candidatos, previo, self._pedir)
        self.assertEqual(len([p for p in self.pedidas if "limitado" in p]), lector.LIMITES_SEGUIDOS)
        self.assertIn(SANA, self.pedidas)
        self.assertEqual(ciclo["dominios_con_limite"], ["limitado.example"])
        self.assertEqual(len(estado[WEBS]), lector.LIMITES_SEGUIDOS + 1)
        self.assertEqual(ciclo["sin_consultar"], 2)

    def test_los_ocultos_heredados_rotan_entre_ciclos_con_un_dominio_frenado(self) -> None:
        """Tres heredados con 429 frenan el dominio; en el ciclo siguiente van delante los dos que faltaban."""
        candidatos = [
            Candidato(f"https://limitado.example/{n}", WEBS, f"https://limitado.example/{n}") for n in range(5)
        ]
        previo = {WEBS: {c.url: estado_heredado(ANTES, oculto=True) for c in candidatos}, CURSOS: {}, PROGRAMAS: {}}
        estado, ciclo = lector.comprobar_ciclo(candidatos, previo, self._pedir)
        primeras = list(self.pedidas)
        self.assertEqual((len(primeras), ciclo["dominios_con_limite"]), (3, ["limitado.example"]))
        self.pedidas.clear()
        lector.comprobar_ciclo(candidatos, estado, self._pedir)
        sin_alcanzar = [c.url for c in candidatos if c.url not in primeras]
        self.assertEqual(self.pedidas[:2], sin_alcanzar)

    def test_una_respuesta_buena_entre_medias_reinicia_la_cuenta(self) -> None:
        """Dos limites, una respuesta buena y dos limites más no frenan el dominio."""
        codigos = iter([LIMITADO, LIMITADO, RESPONDIO, LIMITADO, LIMITADO])

        def pedir(url: str, _conjunto: str) -> dict:
            return observacion("2026-11-15T08:00:00+00:00", next(codigos), url)

        _, ciclo = lector.comprobar_ciclo(self.candidatos[:5], {WEBS: {}, CURSOS: {}, PROGRAMAS: {}}, pedir)
        self.assertEqual(ciclo["dominios_con_limite"], [])
        self.assertEqual(ciclo["consultadas"], 5)


if __name__ == "__main__":
    unittest.main()
