"""FUNDAE sin red: las ediciones salen del índice del canal diario, con la evidencia de sus fichas.

Las respuestas son simuladas y se conservan con cuerpo y recibo reales; el índice, las fichas y la composición con la
salida anterior son los de producción.
"""

import copy
import hashlib
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from http import HTTPStatus
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import plataforma_datos.cursos.fuentes.fundae.lector as fundae
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import Controles
from plataforma_datos.cursos import operacion_fuente, recibos_compartidos
from plataforma_datos.cursos.adquisicion_por_fuente import ADQUIRIENTES
from plataforma_datos.cursos.fuentes.fundae import adquisicion, descarga, ediciones
from plataforma_datos.cursos.pruebas.test_fundae import COLECTIVOS, centro, fila
from plataforma_datos.cursos.recepciones_catalogo import json_bytes

CODIGO = "IFCT0049"
ABIERTA, CERRADA_POR_PLAZO = 3177, 3178
IA, DIGITAL = "Inteligencia Artificial", "Ofimática / Competencias digitales"


def conservar(carpeta: Path, url: str, dato: object, http: int, fin: str) -> dict[str, Any]:
    """Conserva una respuesta simulada como lo hace `recibir_url`: cuerpo, metadatos y recibo con sus huellas.

    Returns:
        La captura con sus referencias.
    """
    carpeta.mkdir(parents=True, exist_ok=True)
    cuerpo = json_bytes(dato)
    sha = hashlib.sha256(cuerpo).hexdigest()
    (carpeta / (sha + ".body")).write_bytes(cuerpo)
    meta = {
        "url": url,
        "url_final": url,
        "http": http,
        "completo": True,
        "inicio_utc": fin.replace(":01Z", ":00Z"),
        "fin_utc": fin,
        "bytes": len(cuerpo),
        "cuerpo_sha256": sha,
    }
    estable, evento = recibos_compartidos.separar(json_bytes(meta), campos_evento=frozenset({"inicio_utc", "fin_utc"}))
    refs = {}
    for clave, contenido in (("metadatos", estable), ("recibo", evento)):
        huella = hashlib.sha256(contenido).hexdigest()
        (carpeta / (huella + ".json")).write_bytes(contenido)
        refs[clave] = {"archivo": huella + ".json", "sha256": huella}
    return {"id": None, "cuerpo": {"archivo": sha + ".body", "sha256": sha}, **refs, "intento": refs["recibo"]}


def indice(*codigos: str) -> dict[str, Any]:
    """El índice del catálogo 3 con esas especialidades en teleformación, abiertas y del área de IA de FUNDAE.

    Returns:
        La respuesta del índice, con una especialidad presencial que nunca se consulta.
    """
    filas = [
        {"idRecursoFormativoBuscador": n + 1, "idCatalogo": 3, "codigoTitulacion": c, "idModalidad": 2}
        | {"inscripcionAbierta": True, "listaAreasInteres": [{"idAreaInteres": 38, "descripcionAreasInteres": IA}]}
        for n, c in enumerate(codigos)
    ]
    filas.append(
        {"idRecursoFormativoBuscador": 99, "idCatalogo": 3, "codigoTitulacion": "ADGD0003", "idModalidad": 1}
        | {"inscripcionAbierta": True, "listaAreasInteres": [{"idAreaInteres": 46, "descripcionAreasInteres": DIGITAL}]}
    )
    return {"respuesta": filas}


def difusiones() -> dict[str, Any]:
    """La ficha de difusiones de la especialidad: una edición abierta el 23/10 y otra con el plazo ya vencido.

    Returns:
        La respuesta de la ficha.
    """
    vencida = {**fila(CERRADA_POR_PLAZO), "fechaPreinscripcionFin": "2026-10-20T00:00:00"}
    return {"centrosRFO": [fila(ABIERTA), vencida], "curso": centro()["curso"]}


class EdicionesFundaePruebas(unittest.TestCase):
    """Un ciclo es: índice en catalogos/, fichas en ediciones/, lectura y composición con la salida anterior."""

    def setUp(self) -> None:
        """Prepara la casa FUNDAE en una carpeta temporal y una API simulada."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.fundae = Path(temporal.name) / "fundae"
        self.tramite = self.enterContext(patch.object(descarga.tramite, "descargar"))
        self.pedidas: list[str] = []
        self.api: dict[str, tuple[int, object]] = {}
        self.fin = "2026-10-23T10:00:01Z"
        parche = patch.object(fundae, "ORIGINAL", self.fundae)
        parche.start()
        self.addCleanup(parche.stop)

    def recibir(self, url: str, carpeta: Path, segundos: int | None = None) -> dict[str, Any]:
        """La API simulada: lo que no está declarado responde 503.

        Returns:
            La captura conservada.
        """
        self.pedidas.append(url)
        http, dato = self.api.get(url, (503, {}))
        return conservar(carpeta, url, dato, http, self.fin)

    def ciclo(self, codigos: tuple[str, ...], previa: dict | None, *, http_indice: int = 200) -> dict[str, Any]:
        """Un ciclo completo con el índice dado.

        Returns:
            Lo que preparar deja para validar.
        """
        canal = self.fundae / "catalogos"
        captura = conservar(canal, adquisicion.URLS["subvencionada"], indice(*codigos), http_indice, self.fin)
        guardar_json(canal / "procedencia.json", {"auxiliares": {"subvencionada": captura}})
        descarga.descargar(self.fundae, self.recibir)
        documento = leer_json(self.fundae / ediciones.CARPETA / "procedencia.json")
        return fundae.componer_preparado(ediciones.leer(self.fundae, documento), previa)

    def api_completa(self) -> None:
        """Las tres fichas de la edición abierta responden 200."""
        self.api = {
            ediciones.url_difusiones(CODIGO): (200, difusiones()),
            ediciones.url_centro(CODIGO, "B00000000"): (200, centro()),
            ediciones.url_colectivos(ABIERTA): (200, COLECTIVOS),
        }

    def previa(self, preparado: dict[str, Any]) -> dict[str, Any]:
        """La salida admitida de un ciclo, como la lee el siguiente.

        Returns:
            Conjunto, ediciones y evidencias.
        """
        conjunto = copy.deepcopy(preparado["conjunto"])
        return {"conjunto": conjunto, "ediciones": conjunto["ediciones"], "evidencias": preparado["evidencias"]}

    def admitido(self, preparado: dict[str, Any]) -> bool:
        """Pasa los controles de la validación, con la comprobación de los archivos conservados.

        Returns:
            Si se admitiría.
        """
        controles = Controles()
        with redirect_stdout(io.StringIO()):
            fundae.controlar(controles, preparado)
        return controles.admitido

    def test_una_edicion_nueva_del_indice_entra_con_su_evidencia(self) -> None:
        """La especialidad del índice trae su edición abierta, con índice y tres fichas conservados; la vencida no."""
        self.api_completa()
        preparado = self.ciclo((CODIGO,), None)
        self.assertEqual([e["id"] for e in preparado["conjunto"]["ediciones"]], [str(ABIERTA)])
        self.assertEqual(preparado["conjunto"]["consulta"], "2026-10-23")
        prueba = preparado["evidencias"][str(ABIERTA)]
        self.assertEqual(set(prueba), {"indice", "difusiones", "centro", "colectivos"})
        self.assertEqual(prueba["colectivos"]["url"], ediciones.url_colectivos(ABIERTA))
        self.assertTrue(
            all(p["http"] == HTTPStatus.OK and p["recibo"]["sha256"] and p["cuerpo"]["sha256"] for p in prueba.values())
        )
        self.assertTrue(self.admitido(preparado))
        self.tramite.assert_called_once()
        self.assertEqual(self.tramite.call_args.args, (self.fundae / "tramite", CODIGO))
        # La modalidad presencial del índice no se consulta, y de la edición vencida no se pide ninguna ficha.
        self.assertNotIn(ediciones.url_difusiones("ADGD0003"), self.pedidas)
        self.assertNotIn(ediciones.url_colectivos(CERRADA_POR_PLAZO), self.pedidas)
        self.assertNotIn("consulta_parcial", preparado)

    def test_solo_se_consultan_las_especialidades_de_ia_o_competencias_digitales(self) -> None:
        """Acota el área de interés 38 o 46 de FUNDAE o la familia IFC; otra área o sin áreas no se consulta."""
        filas = [
            ("IFCT0049", []),
            ("ADGG052PO", [{"idAreaInteres": 46}]),
            ("COMM18", [{"idAreaInteres": 14}, {"idAreaInteres": 38}]),
            ("HOTR0001", [{"idAreaInteres": 33}]),
            ("SSCE0001", []),
        ]
        dato = {
            "respuesta": [
                {"idRecursoFormativoBuscador": n + 1, "idCatalogo": 3, "codigoTitulacion": c, "idModalidad": 2}
                | {"inscripcionAbierta": True, "listaAreasInteres": areas}
                for n, (c, areas) in enumerate(filas)
            ]
        }
        self.assertEqual(ediciones.especialidades(dato), ["ADGG052PO", "COMM18", "IFCT0049"])

    def test_el_dia_de_la_consulta_es_el_civil_de_espana(self) -> None:
        """A las 23:30 UTC del 31/10 ya es 1/11 en Madrid: una preinscripción que acaba el 31/10 está cerrada."""
        self.api_completa()
        self.fin = "2026-10-31T23:30:01Z"
        preparado = self.ciclo((CODIGO,), None)
        self.assertEqual(preparado["conjunto"]["ediciones"], [])
        self.assertEqual(preparado["conjunto"]["consulta"], "2026-11-01")
        self.assertNotIn(ediciones.url_colectivos(ABIERTA), self.pedidas)

    def test_una_ausencia_en_el_indice_no_da_de_baja(self) -> None:
        """Si el índice deja de listar la especialidad, la edición se conserva con su evidencia anterior."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        self.fin = "2026-10-24T10:00:01Z"
        segundo = self.ciclo(("IFCT0050",), self.previa(primero))
        self.assertEqual(segundo["conjunto"]["ediciones"], primero["conjunto"]["ediciones"])
        self.assertEqual(segundo["evidencias"], primero["evidencias"])
        self.assertEqual(segundo["conservadas"], [str(ABIERTA)])
        self.assertTrue(self.admitido(segundo))

    def test_la_cita_no_rejuvenece_lo_conservado(self) -> None:
        """Una edición conservada del 23/10 junto a una nueva del 24/10: la cita dice «entre el 23/10 y el 24/10»."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        self.assertIn("consultadas el 23/10/2026.", primero["conjunto"]["cita"])
        self.fin = "2026-10-24T10:00:01Z"
        otra = copy.deepcopy(centro())
        otra["curso"]["codigoTitulacion"] = "IFCT0050"
        otra["centrosRFO"][0]["idDifusionAccionFormativa"] = 4000
        self.api = {
            ediciones.url_difusiones("IFCT0050"): (200, {"centrosRFO": otra["centrosRFO"], "curso": otra["curso"]}),
            ediciones.url_centro("IFCT0050", "B00000000"): (200, otra),
            ediciones.url_colectivos(4000): (200, COLECTIVOS),
        }
        segundo = self.ciclo(("IFCT0050",), self.previa(primero))
        self.assertEqual([e["id"] for e in segundo["conjunto"]["ediciones"]], [str(ABIERTA), "4000"])
        self.assertIn("consultadas entre el 23/10/2026 y el 24/10/2026.", segundo["conjunto"]["cita"])
        solo_conservada = self.ciclo(("IFCT0051",), self.previa(primero))
        self.assertIn("consultadas el 23/10/2026.", solo_conservada["conjunto"]["cita"])

    def test_indice_caido_deja_la_salida_anterior_como_consulta_parcial(self) -> None:
        """Con el índice en 503 no se pide ninguna ficha y la salida es la anterior, con el motivo dicho."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        self.pedidas.clear()
        self.fin = "2026-10-24T10:00:01Z"
        segundo = self.ciclo((CODIGO,), self.previa(primero), http_indice=503)
        self.assertEqual(self.pedidas, [])
        self.assertEqual(segundo["conjunto"], primero["conjunto"])
        self.assertEqual(segundo["consulta_parcial"]["motivo"], "indice-caido")
        self.assertEqual(segundo["consulta_parcial"]["indice"]["http"], 503)

    def test_un_fallo_de_un_servicio_no_cierra_una_edicion_abierta(self) -> None:
        """Difusiones, entidad y colectivos son consultas auxiliares. Un error no retira ediciones."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        self.fin = "2026-10-24T10:00:01Z"
        urls = (
            ediciones.url_difusiones(CODIGO),
            ediciones.url_centro(CODIGO, "B00000000"),
            ediciones.url_colectivos(ABIERTA),
        )
        for url in urls:
            for http in (404, 410, 503):
                with self.subTest(url=url, http=http):
                    self.api_completa()
                    self.api[url] = (http, {})
                    segundo = self.ciclo((CODIGO,), self.previa(primero))
                    self.assertEqual(segundo["conjunto"]["ediciones"], primero["conjunto"]["ediciones"])
                    self.assertEqual(segundo["evidencias"], primero["evidencias"])
                    self.assertEqual(segundo["retiradas"], [])
                    self.assertEqual(segundo["consulta_parcial"]["fichas"][0]["http"], http)

    def test_un_fallo_del_servicio_no_prolonga_el_plazo_individual(self) -> None:
        """El plazo observado de la edición vence aunque la siguiente consulta de difusiones responda 410."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        self.fin = "2026-11-01T10:00:01Z"
        self.api[ediciones.url_difusiones(CODIGO)] = (410, {})
        segundo = self.ciclo((CODIGO,), self.previa(primero))
        self.assertEqual(segundo["retiradas"], [{"id": str(ABIERTA), "motivo": "plazo-vencido"}])

    def test_cada_dia_solo_se_piden_las_fichas_de_lo_nuevo_o_cambiado(self) -> None:
        """Con la fila igual se reutilizan entidad y colectivos, con su fecha; la cita da los días de difusiones."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        self.pedidas.clear()
        self.fin = "2026-10-24T10:00:01Z"
        with patch.object(descarga, "REFRESCO_DIARIO", 0):
            segundo = self.ciclo((CODIGO,), self.previa(primero))
        self.assertEqual(self.pedidas, [ediciones.url_difusiones(CODIGO)])
        prueba = segundo["evidencias"][str(ABIERTA)]
        self.assertEqual(prueba["colectivos"]["consultado_utc"], "2026-10-23T10:00:01Z")
        self.assertEqual(prueba["difusiones"]["consultado_utc"], "2026-10-24T10:00:01Z")
        self.assertIn("consultadas entre el 23/10/2026 y el 24/10/2026.", segundo["conjunto"]["cita"])
        self.assertTrue(self.admitido(segundo))

    def test_lo_reutilizado_se_refresca_dentro_del_presupuesto_de_la_mas_antigua_a_la_mas_reciente(self) -> None:
        """Con un refresco diario de 1, cada día se renueva la ficha reutilizada más antigua y la cita lo refleja."""
        self.api_completa()
        self.ciclo((CODIGO,), None)
        self.fin = "2026-10-24T10:00:01Z"
        self.pedidas.clear()
        with patch.object(descarga, "REFRESCO_DIARIO", 1):
            segundo = self.ciclo((CODIGO,), None)
        # Difusiones cada día y, de las dos fichas reutilizadas (entidad y colectivos, del 23/10), una refrescada.
        self.assertEqual(len(self.pedidas), 2)
        self.assertEqual(self.pedidas[0], ediciones.url_difusiones(CODIGO))
        self.fin = "2026-10-25T10:00:01Z"
        self.pedidas.clear()
        with patch.object(descarga, "REFRESCO_DIARIO", 1):
            tercero = self.ciclo((CODIGO,), None)
        prueba = tercero["evidencias"][str(ABIERTA)]
        dias = sorted(prueba[f]["consultado_utc"][:10] for f in ("difusiones", "centro", "colectivos"))
        # La que quedó del 23/10 se refresca el 25/10: en dos días ninguna ficha tiene más de un día.
        self.assertEqual(dias[0], "2026-10-24")
        self.assertNotIn("23/10/2026", tercero["conjunto"]["cita"])
        self.assertIn("consultadas entre el 24/10/2026 y el 25/10/2026.", tercero["conjunto"]["cita"])
        self.assertEqual(len(segundo["evidencias"]), 1)

    def test_el_refresco_tiene_su_parte_del_presupuesto_aunque_haya_corte(self) -> None:
        """Con el tope casi agotado por las especialidades, el refresco reservado sigue avanzando."""
        self.api_completa()
        canal = self.fundae / "catalogos"
        self.ciclo((CODIGO,), None)
        # El 25/10 la rotación empieza por la primera especialidad, la que reutiliza sus fichas.
        self.fin = "2026-10-25T10:00:01Z"
        captura = conservar(canal, adquisicion.URLS["subvencionada"], indice(CODIGO, "IFCT0050"), 200, self.fin)
        guardar_json(canal / "procedencia.json", {"auxiliares": {"subvencionada": captura}})
        with patch.object(descarga, "REFRESCO_DIARIO", 1):
            descarga.descargar(self.fundae, self.recibir, descarga.Presupuesto(self.recibir, consultas=2))
        documento = leer_json(self.fundae / ediciones.CARPETA / "procedencia.json")
        self.assertEqual(documento["corte"]["motivo"], descarga.TOPE)
        self.assertEqual(documento["refrescadas"], 1)

    def test_el_corte_rota_con_el_dia_y_el_plazo_acota_cada_consulta(self) -> None:
        """Con tope 1, días seguidos empiezan por especialidades distintas; el plazo de red no pasa de lo que queda."""
        self.api_completa()
        canal = self.fundae / "catalogos"
        primeras = []
        for dia in ("2026-10-23", "2026-10-24"):
            self.fin = dia + "T10:00:01Z"
            captura = conservar(canal, adquisicion.URLS["subvencionada"], indice(CODIGO, "IFCT0050"), 200, self.fin)
            guardar_json(canal / "procedencia.json", {"auxiliares": {"subvencionada": captura}})
            descarga.descargar(self.fundae, self.recibir, descarga.Presupuesto(self.recibir, consultas=6))
            documento = leer_json(self.fundae / ediciones.CARPETA / "procedencia.json")
            primeras.append(documento["especialidades"][0]["codigo"])
            ediciones.leer(self.fundae, documento)
        self.assertEqual(sorted(primeras), [CODIGO, "IFCT0050"])
        plazos: list[int] = []
        reloj = iter([0.0, 1795.5, 1799.5])
        presupuesto = descarga.Presupuesto(lambda _u, _c, s: plazos.append(s) or {}, reloj=lambda: next(reloj))
        presupuesto("https://agora.fundae.es/x", self.fundae)
        with self.assertRaises(descarga.Agotado):
            presupuesto("https://agora.fundae.es/y", self.fundae)
        self.assertEqual(plazos, [4])

    def test_el_tope_propio_corta_la_descarga_como_consulta_parcial(self) -> None:
        """Sin consultas restantes la descarga se corta: lo no consultado queda dicho y no se da por ausente."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        canal = self.fundae / "catalogos"
        captura = conservar(canal, adquisicion.URLS["subvencionada"], indice(CODIGO, "IFCT0050"), 200, self.fin)
        guardar_json(canal / "procedencia.json", {"auxiliares": {"subvencionada": captura}})
        descarga.descargar(self.fundae, self.recibir, descarga.Presupuesto(self.recibir, consultas=1))
        documento = leer_json(self.fundae / ediciones.CARPETA / "procedencia.json")
        self.assertEqual(documento["corte"], {"motivo": "tope-de-consultas", "consultadas": 1})
        preparado = fundae.componer_preparado(ediciones.leer(self.fundae, documento), self.previa(primero))
        self.assertEqual(preparado["consulta_parcial"]["sin_consultar"], ["IFCT0050"])
        self.assertIn("tope-de-consultas", preparado["consulta_parcial"]["motivo"])
        self.assertEqual([e["id"] for e in preparado["conjunto"]["ediciones"]], [str(ABIERTA)])

    def test_una_fila_con_otra_forma_no_para_el_ciclo(self) -> None:
        """Una difusión sin entidad o con una fecha de otra forma no se publica, queda dicha y el resto sigue."""
        self.api_completa()
        dato = difusiones()
        sin_entidad = {**fila(3179)}
        del sin_entidad["cifEntidadFormadora"]
        otra_fecha = {**fila(3180), "fechaPreinscripcionFin": "31/10/2026"}
        dato["centrosRFO"] += [sin_entidad, otra_fecha]
        self.api[ediciones.url_difusiones(CODIGO)] = (200, dato)
        preparado = self.ciclo((CODIGO,), None)
        self.assertEqual([e["id"] for e in preparado["conjunto"]["ediciones"]], [str(ABIERTA)])
        self.assertEqual(
            [(d["id"], d["motivo"][:20]) for d in preparado["descartadas"]][0], ("3179", "difusión sin entidad")
        )
        self.assertEqual(preparado["descartadas"][1]["id"], "3180")
        self.assertTrue(self.admitido(preparado))

    def test_una_fila_del_indice_con_areas_de_otra_forma_se_descarta_sin_parar(self) -> None:
        """Las áreas de una especialidad con otra forma la dejan fuera con su motivo; la del ámbito sigue."""
        self.api_completa()
        canal = self.fundae / "catalogos"
        dato = indice(CODIGO)
        dato["respuesta"].append(
            {"idRecursoFormativoBuscador": 51, "idCatalogo": 3, "codigoTitulacion": "IFCT0099", "idModalidad": 2}
            | {"inscripcionAbierta": True, "listaAreasInteres": {"idAreaInteres": 38}}
        )
        captura = conservar(canal, adquisicion.URLS["subvencionada"], dato, 200, self.fin)
        guardar_json(canal / "procedencia.json", {"auxiliares": {"subvencionada": captura}})
        descarga.descargar(self.fundae, self.recibir)
        documento = leer_json(self.fundae / ediciones.CARPETA / "procedencia.json")
        preparado = fundae.componer_preparado(ediciones.leer(self.fundae, documento), None)
        self.assertEqual([e["id"] for e in preparado["conjunto"]["ediciones"]], [str(ABIERTA)])
        self.assertEqual(preparado["descartadas"][0]["especialidad"], "IFCT0099")
        self.assertNotIn(ediciones.url_difusiones("IFCT0099"), self.pedidas)

    def test_un_area_renombrada_para_la_validacion_y_lo_excluido_se_avisa(self) -> None:
        """Si el índice publica otro nombre para el área 38, no se admite; lo excluido que habla de IA se lista."""
        self.api_completa()
        bien = self.ciclo((CODIGO,), None)
        self.assertEqual(bien["areas"], {38: [IA], 46: [DIGITAL]})
        canal = self.fundae / "catalogos"
        dato = indice(CODIGO)
        dato["respuesta"][0]["listaAreasInteres"][0]["descripcionAreasInteres"] = "Robótica"
        dato["respuesta"].append(
            {"idRecursoFormativoBuscador": 50, "idCatalogo": 3, "codigoTitulacion": "COMT0001", "idModalidad": 2}
            | {"inscripcionAbierta": True, "listaAreasInteres": [], "denominacion": "ANÁLISIS DE DATOS EN VENTAS"}
        )
        captura = conservar(canal, adquisicion.URLS["subvencionada"], dato, 200, self.fin)
        guardar_json(canal / "procedencia.json", {"auxiliares": {"subvencionada": captura}})
        descarga.descargar(self.fundae, self.recibir)
        documento = leer_json(self.fundae / ediciones.CARPETA / "procedencia.json")
        renombrada = fundae.componer_preparado(ediciones.leer(self.fundae, documento), None)
        self.assertFalse(self.admitido(renombrada))
        self.assertEqual(renombrada["a_revisar"], [{"codigo": "COMT0001", "nombre": "ANÁLISIS DE DATOS EN VENTAS"}])

    def test_la_preinscripcion_cerrada_en_su_ficha_no_se_publica(self) -> None:
        """Si su ficha publica un plazo que ya acabó, la edición anterior se retira por esa fecha."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        cerrada = difusiones()
        cerrada["centrosRFO"][0]["fechaPreinscripcionFin"] = "2026-10-22T00:00:00"
        self.api[ediciones.url_difusiones(CODIGO)] = (200, cerrada)
        segundo = self.ciclo((CODIGO,), self.previa(primero))
        self.assertEqual(segundo["conjunto"]["ediciones"], [])
        self.assertEqual(segundo["retiradas"], [{"id": str(ABIERTA), "motivo": "plazo-no-abierto-en-su-ficha"}])

    def test_no_queda_ninguna_edicion_sin_evidencia_de_su_ficha(self) -> None:
        """Una edición anterior sin evidencia se retira, y una evidencia alterada no se admite."""
        self.api_completa()
        primero = self.ciclo((CODIGO,), None)
        sin_pruebas = self.previa(primero)
        sin_pruebas["evidencias"] = {}
        segundo = self.ciclo(("IFCT0050",), sin_pruebas)
        self.assertEqual(segundo["retiradas"], [{"id": str(ABIERTA), "motivo": "sin-evidencia-de-sus-fichas"}])
        alterado = copy.deepcopy(primero)
        alterado["evidencias"][str(ABIERTA)]["centro"]["cuerpo"]["sha256"] = "0" * 64
        self.assertFalse(self.admitido(alterado))

    def test_la_descarga_diaria_consulta_las_fichas_tras_el_indice(self) -> None:
        """El registro común de adquisiciones encadena índice y fichas; las fichas van tras enlazar el canal."""
        orden: list[str] = []
        # Cada descarga devuelve los problemas de su lectura, que la adquisición entrega juntos.
        with (
            patch.object(
                adquisicion, "descargar", lambda *_: orden.append("indice") or SimpleNamespace(problemas=("a",))
            ),
            patch.object(operacion_fuente, "enlazar_canal", lambda *_: orden.append("enlace")),
            patch.object(
                descarga,
                "descargar",
                lambda casa: orden.append(f"fichas:{casa.name}") or SimpleNamespace(problemas=("b",)),
            ),
        ):
            problemas = ADQUIRIENTES["fundae"]({}, self.fundae / "catalogos", {}, self.fundae.parent)
        self.assertEqual(orden, ["indice", "enlace", "fichas:fundae"])
        self.assertEqual(problemas, ("a", "b"))


if __name__ == "__main__":
    unittest.main()
