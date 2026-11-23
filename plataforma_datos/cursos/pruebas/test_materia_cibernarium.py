"""Evidencia de materia Cibernàrium sin red ni textos en la salida."""

import hashlib
import shutil
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado
from plataforma_datos.cursos import (
    almacen_catalogo,
    contenido_aprendizaje,
    materia_censos_cibernarium,
    registro_vigencia,
)
from plataforma_datos.cursos import (
    materia_cibernarium as materia,
)
from plataforma_datos.cursos.fuentes.barcelonactiva import actualizacion, adquisicion, ambitos, censo_ia, ficha_edicion
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as recepcion
from plataforma_datos.cursos.pruebas import test_cibernarium_ia as prueba_ia
from plataforma_datos.cursos.pruebas import test_contenido_cibernarium as contenido
from plataforma_datos.orquestacion import evidencias_censos, recuperar_ediciones


def seleccion() -> dict:
    """Una selección sintética con la forma de la selección verificada de entrega.

    Returns:
        Selección con actividad, edición y apoyos de identidad.
    """
    prueba = {"url": "https://ejemplo.test/api", "sha256": "a" * 64, "capturado_utc": "2026-11-15T12:00:00Z"}
    return {
        "actividad": {
            "activityId": "1",
            "title": "Curso",
            "description": "Contenido publicado",
            "category": "Digital",
            "categoryId": 2,
            "subCategoryId": None,
        },
        "identidad": {"actividad_id": "1", "programa_id": "cibernarium:1"},
        "edicion": {"activityId": "3"},
        "observacion": {
            "evidencias": [
                {
                    "alcance": "identidad",
                    **prueba,
                    "localizador": {"tipo": "campo", "valor": "/activities/0/activityId"},
                },
                {
                    "alcance": "identidad",
                    **prueba,
                    "localizador": {"tipo": "campo", "valor": "/activities/0/listEditions/0/activityId"},
                },
            ]
        },
    }


class MateriaCibernarium(unittest.TestCase):
    """La pertenencia al ámbito y el contenido tienen soportes independientes."""

    def setUp(self) -> None:
        """Prepara capturas e identidades para cada caso."""
        self.id = "cibernarium-edicion:3"
        self.selecciones = {self.id: seleccion()}
        self.evidencia = {
            "ambito": "ia",
            "url": "https://ejemplo.test/censo?scopeIds=22",
            "sha256": "b" * 64,
            "capturado_utc": "2026-11-15T11:00:00Z",
            "localizador": "activities[0]",
        }

    def test_censo_completo_con_id_exacto_y_contenido(self) -> None:
        """Comprueba censo completo con id exacto y contenido."""
        dato = materia.proyectar(self.selecciones, {"1": self.evidencia}, {})[self.id]
        self.assertEqual(dato["censo_ia"], self.evidencia)
        self.assertEqual(dato["contenido"]["sha256"], sha256_json(["Curso", "Contenido publicado", "Digital", 2, None]))
        self.assertNotIn("Contenido publicado", str(dato))
        self.assertEqual(dato["edicion_id"], self.id)

    def test_roles_no_dependen_del_orden_y_rechazan_otra_captura(self) -> None:
        """Comprueba roles no dependen del orden y rechazan otra captura."""
        original = materia.proyectar(self.selecciones, {"1": self.evidencia}, {})
        cambiada = deepcopy(self.selecciones)
        cambiada[self.id]["observacion"]["evidencias"].reverse()
        self.assertEqual(materia.proyectar(cambiada, {"1": self.evidencia}, {}), original)
        cambiada[self.id]["observacion"]["evidencias"][0]["sha256"] = "f" * 64
        with self.assertRaises(FormatoInesperado):
            materia.proyectar(cambiada, {"1": self.evidencia}, {})

    def test_censo_completo_sin_id_no_sustituye_el_contenido(self) -> None:
        """Comprueba censo completo sin id no sustituye el contenido."""
        dato = materia.proyectar(self.selecciones, {"2": self.evidencia}, {})[self.id]
        self.assertIsNone(dato["censo_ia"])
        self.assertIsNotNone(dato["contenido"])

    def test_censo_parcial_conserva_soporte_anterior_sin_renovar(self) -> None:
        """Comprueba censo parcial conserva soporte anterior sin renovar."""
        anterior = materia.proyectar(self.selecciones, {"1": self.evidencia}, {})
        dato = materia.proyectar(self.selecciones, None, anterior)[self.id]
        self.assertEqual(dato["censo_ia"], self.evidencia)
        ajena = deepcopy(anterior)
        ajena[self.id]["actividad_id"] = "2"
        self.assertIsNone(materia.proyectar(self.selecciones, None, ajena)[self.id]["censo_ia"])
        self.assertIsNone(materia.proyectar(self.selecciones, None, {})[self.id]["censo_ia"])

    def test_cabecera_nueva_no_acredita_ia_por_la_edicion_anterior(self) -> None:
        """Comprueba cabecera nueva no acredita ia por la edicion anterior."""
        anterior = materia.proyectar(self.selecciones, {"1": self.evidencia}, {})
        nueva = deepcopy(self.selecciones)
        nueva[self.id]["actividad"]["activityId"] = "2"
        nueva[self.id]["identidad"]["actividad_id"] = "2"
        actual = materia.proyectar(nueva, None, anterior)[self.id]
        self.assertIsNone(actual["censo_ia"])
        self.assertEqual(actual["estado_censo"], "parcial")

    def test_cambio_de_contenido_cambia_huella_sin_borrar_censo(self) -> None:
        """Comprueba cambio de contenido cambia huella sin borrar censo."""
        antes = materia.proyectar(self.selecciones, {"1": self.evidencia}, {})[self.id]
        nuevas = deepcopy(self.selecciones)
        nuevas[self.id]["actividad"]["description"] = "Contenido distinto"
        despues = materia.proyectar(nuevas, {"1": self.evidencia}, {})[self.id]
        self.assertNotEqual(antes["contenido"]["sha256"], despues["contenido"]["sha256"])
        self.assertEqual(antes["censo_ia"], despues["censo_ia"])

    def test_sin_descripcion_no_inventa_contenido_ni_pierde_censo(self) -> None:
        """Comprueba sin descripcion no inventa contenido ni pierde censo."""
        self.selecciones[self.id]["actividad"]["description"] = ""
        dato = materia.proyectar(self.selecciones, {"1": self.evidencia}, {})[self.id]
        self.assertIsNone(dato["contenido"])
        self.assertEqual(dato["censo_ia"], self.evidencia)


class SeleccionAdmitida(unittest.TestCase):
    """Recibos y candidatas reales sobre una fuente sintética sin red."""

    CORTE = "2026-10-23T22:10:00Z"

    def setUp(self) -> None:
        """Prepara capturas e identidades para cada caso."""
        self.caso = contenido.ContenidoCibernarium()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.raiz = self.caso.ciclo.raiz
        self.actividad = self.caso.ciclo.actividad
        self.conjunto = self.caso.ciclo.conjunto(self.actividad)

        def quitar(cap: dict) -> dict:
            return {k: v for k, v in cap.items() if k != "lectura"}

        self.general = {
            "schema_version": 1,
            "fuente_id": "barcelonactiva",
            "canal": "cibernarium",
            "capturas": [quitar(c) for c in self.conjunto["recepciones"]],
            "auxiliares": {k: quitar(c) for k, c in self.conjunto["auxiliares"].items()},
            "fichas": {},
            "historial": [],
        }
        self.original = self.raiz / DATOS_RELATIVOS / "originales" / "barcelonactiva" / censo_ia.CARPETA
        self.general_original = self.original.parent / "cibernarium"
        shutil.copytree(self.caso.ciclo.original, self.general_original)
        self.carpeta = (
            self.raiz / DATOS_RELATIVOS / "validados" / "barcelonactiva" / "cibernarium" / materia.CARPETA_CENSOS
        )
        self.entrada = self.entrada_de(self.caso.primera)

    def entrada_de(self, destino: Path) -> almacen_catalogo.EntradaCatalogo:
        """Obtiene la entrada admitida de una candidata.

        Returns:
            Resultado de la operación sintética.
        """
        solicitud = almacen_catalogo.solicitud(destino)
        return almacen_catalogo.EntradaCatalogo(
            admision=solicitud, sha256_admision=hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest()
        )

    def recibir(
        self,
        *,
        instante: str = "2026-10-23T21:45:01Z",
        id_ia: str | None = None,
        parcial: bool = False,
        comprobado: str | None = None,
    ) -> dict:
        """Archiva un censo sintético con sus capturas verificables.

        Returns:
            Resultado de la operación sintética.
        """
        id_ia = self.actividad["activityId"] if id_ia is None else id_ia
        filtros = prueba_ia.conservar(self.original, ambitos.FILTROS, prueba_ia.RECORTE_FILTROS.encode(), 200, instante)
        filas = prueba_ia.paginas([prueba_ia.fila(id_ia)])[0] if not parcial else {}
        pagina = prueba_ia.conservar(self.original, censo_ia.url_pagina(0), filas, 503 if parcial else 200, instante)
        documento = {
            "schema_version": 1,
            "fuente_id": "barcelonactiva",
            "ambito": censo_ia.AMBITO_IA,
            "filtros": filtros,
            "portlet": "cAct_INSTANCE_uhcx",
            "paginas": [pagina],
            "fichas": {},
        }
        lectura = censo_ia.leer(self.original.parent, documento)
        informe = {"estado": "Admitido", "evidencias": lectura["paginas"], "comprobado_utc": comprobado or instante}
        if parcial:
            informe["consulta_parcial"] = {"motivo": "censo-ia-parcial"}
        preparada = {"censo_sha256": self.conjunto["procedencia_sha256"], "evidencias": lectura["paginas"]}
        archivos = (
            (self.original / "procedencia.json", documento),
            (self.general_original / "procedencia.json", self.general),
            (self.raiz / DATOS_RELATIVOS / "preparados" / "barcelonactiva" / "cibernarium.json", preparada),
        )
        for ruta, dato in archivos:
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_bytes(materia.operacion_fuente.json_bytes(dato))
        with (
            patch.object(materia_censos_cibernarium, "exigir_admitido", return_value=informe),
            patch.object(materia.operacion_fuente, "leer_validado", return_value=self.conjunto),
        ):
            materia.guardar_censo_admitido(self.raiz)
        return pagina

    def incorporar(
        self,
        entrada: almacen_catalogo.EntradaCatalogo,
        nombre: str,
        *,
        pendiente: bool = False,
        corte: str | None = None,
    ) -> Path | None:
        """Incorpora el censo a una candidata admitida.

        Returns:
            Resultado de la operación sintética.
        """
        destino = self.raiz / nombre
        creada = materia.incorporar(
            entrada,
            raiz=self.raiz,
            ciclo_materia=materia.CicloMateria(self.conjunto, pendiente),
            destino=destino,
            corte=corte or self.CORTE,
        )
        return destino if creada else None

    def dato(self, destino: Path) -> dict:
        """Lee la evidencia de la edición desde la candidata.

        Returns:
            Resultado de la operación sintética.
        """
        return materia.actuales(almacen_catalogo.solicitud(destino), {self.caso.id}, self.CORTE)[self.caso.id]

    def general_nueva(
        self, entrada: almacen_catalogo.EntradaCatalogo, *, contenido_nuevo: bool = False
    ) -> almacen_catalogo.EntradaCatalogo:
        """Aplica otra recepción general con corte posterior.

        Returns:
            Resultado de la operación sintética.
        """
        actividad = deepcopy(self.actividad)
        if contenido_nuevo:
            actividad["description"] = "Descripción nueva y verificable"
            actividad.update(category="Digital", categoryId=2, subCategoryId=None)
        api = self.caso.ciclo.captura(actividad, "2026-10-23T21:46:00Z")
        self.general = {
            "schema_version": 1,
            "fuente_id": "barcelonactiva",
            "canal": "cibernarium",
            "capturas": [api],
            "auxiliares": {"normas": self.caso.ciclo.normas},
            "fichas": {},
            "historial": [],
        }
        self.conjunto = adquisicion.calcular(self.caso.ciclo.original, self.general, [self.caso.ciclo.programa])
        shutil.copytree(self.caso.ciclo.original, self.general_original, dirs_exist_ok=True)
        destino = self.raiz / "general-nueva"
        actualizacion.aplicar(
            entrada,
            conjunto=self.conjunto,
            original=self.caso.ciclo.original,
            destino=destino,
            corte="2026-10-23T22:01:00Z",
        )
        return self.entrada_de(destino)

    def test_una_observacion_distinta_no_autoriza_evidencia(self) -> None:
        """Comprueba una observacion distinta no autoriza evidencia."""
        solicitud = self.entrada.admision
        refs = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud)
        evaluacion = deepcopy(registro_vigencia.consultar_edicion(solicitud.snapshot.ruta, self.caso.id)["evaluacion"])
        argumentos = (solicitud, {self.caso.id}, refs, {self.caso.id: evaluacion}, self.CORTE)
        self.assertIn(self.caso.id, materia.contenido_cibernarium.selecciones_verificadas(*argumentos))
        evaluacion["entradas"]["observaciones"][0]["detalle"]["acceso_abierto"] = True
        self.assertEqual(materia.contenido_cibernarium.selecciones_verificadas(*argumentos), {})

    def test_recibo_y_candidata_persisten_y_clonan_por_sha(self) -> None:
        """Comprueba recibo y candidata persisten y clonan por sha."""
        pagina = self.recibir()
        destino = self.incorporar(self.entrada, "materia")
        guardada = self.dato(destino)
        self.assertEqual(guardada["estado_censo"], "completo")
        self.assertEqual(guardada["censo_ia"]["sha256"], pagina["cuerpo"]["sha256"])
        self.assertIsNone(self.incorporar(self.entrada_de(destino), "repetida"))
        copia = self.raiz / "clon-otra-fuente"
        almacen_catalogo.conservar(self.entrada_de(destino), destino=copia)
        self.assertEqual(self.dato(copia), guardada)

    def test_censo_archivado_reproduce_la_ficha_de_una_edicion_ausente(self) -> None:
        """La materia de la edición presente se reproduce con la ficha individual de la ausente."""
        nueva = deepcopy(self.actividad)
        ausente = self.actividad["listEditions"][0]["activityId"]
        nueva["listEditions"][0]["activityId"] = "789"
        original = self.caso.ciclo.original
        self.general["capturas"] = [self.caso.ciclo.captura(nueva, "2026-10-23T21:46:00Z")]
        ficha = recepcion._captura(
            original, ficha_edicion.url(ausente), b"Sin servicio", id=self.caso.id, http=503, fin="2026-10-23T21:47:01Z"
        )
        self.general["fichas_de_ediciones"] = {ausente: ficha}
        self.conjunto = adquisicion.calcular(original, self.general, [self.caso.ciclo.programa])
        shutil.copytree(original, self.general_original, dirs_exist_ok=True)
        general = self.raiz / "general-con-ficha"
        actualizacion.aplicar(
            self.entrada, conjunto=self.conjunto, original=original, destino=general, corte=self.CORTE
        )
        pagina = self.recibir(instante="2026-10-23T21:50:01Z")
        destino = self.incorporar(self.entrada_de(general), "materia-con-ficha")
        solicitud = almacen_catalogo.solicitud(destino)
        refs = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud)
        sha_recibo = ficha["recibo"]["sha256"]
        self.assertIn(sha_recibo, refs)
        presente = "cibernarium-edicion:789"
        dato = materia.actuales(solicitud, {presente}, self.CORTE)[presente]
        self.assertEqual(dato["censo_ia"]["sha256"], pagina["cuerpo"]["sha256"])
        control = almacen_catalogo.leer_documento_indexado(solicitud.procedencia[materia.CONTROL], refs)
        ciclo = next(iter(control["fuentes"].values()))
        del refs[sha_recibo]
        with self.assertRaisesRegex(FormatoInesperado, "Prueba IA fuera del inventario"):
            materia_censos_cibernarium._censo_en_almacen(refs, ciclo, self.CORTE)

    def test_ficha_de_actividad_ausente_se_reproduce_sin_incluirla_en_ia(self) -> None:
        """La autorización histórica viaja con el censo y solo la actividad presente acredita su materia."""
        original = self.caso.ciclo.original
        ficha = recepcion._captura(
            original, adquisicion.robot.url_ficha("998"), b"Sin servicio", id="cibernarium:998", http=503
        )
        self.general["fichas"] = {"998": ficha}
        conocidas = [self.caso.ciclo.programa, {"id": "cibernarium:998"}, {"id": "cibernarium:999"}]
        self.conjunto = adquisicion.calcular(original, self.general, conocidas)
        shutil.copytree(original, self.general_original, dirs_exist_ok=True)
        self.recibir(id_ia="998")
        ciclo = materia.leer_censo_archivado(self.raiz, self.conjunto, self.CORTE)
        self.assertEqual(ciclo["censo"], {})
        resumen = materia_censos_cibernarium._resumen_canal(self.conjunto)
        self.assertEqual(resumen["censo"].pop("conocidos_ausentes"), ["cibernarium:998"])
        with self.assertRaisesRegex(FormatoInesperado, "Ficha ajena al censo"):
            materia_censos_cibernarium._reproducir_general(self.general_original, self.general, resumen)

    def test_copia_sella_las_pruebas_de_ambos_censos_y_repone_el_original_historico(self) -> None:
        """Cada recibo y cuerpo viaja en la copia, también cuando reside en otra ruta del sello anterior."""
        pagina = self.recibir()
        rutas = evidencias_censos.referencias(self.raiz)
        self.assertEqual(evidencias_censos.archivos(self.raiz), set(rutas))
        self.assertEqual({Path(ruta).parts[4] for ruta in rutas}, {"cibernarium", "cibernarium-ia"})
        sha = pagina["recibo"]["sha256"]
        original = self.original / pagina["recibo"]["archivo"]
        alternativo = self.raiz / "prueba-del-sello.json"
        original.rename(alternativo)
        with self.assertRaises(FileNotFoundError):
            evidencias_censos.archivos(self.raiz)
        ausentes = {original.relative_to(self.raiz).as_posix(): sha}
        recuperar_ediciones.reponer_desde_sello(self.raiz, ausentes, {sha: alternativo.name})
        self.assertFalse(ausentes)
        self.assertEqual(evidencias_censos.archivos(self.raiz), set(rutas))

    def test_revalidar_mismas_capturas_mantiene_huella(self) -> None:
        """Comprueba revalidar mismas capturas mantiene huella."""
        self.recibir(comprobado="2026-10-23T22:00:00Z")
        antes = {p.name for p in self.carpeta.glob("*.json")}
        self.recibir(comprobado="2026-10-23T23:00:00Z")
        self.assertEqual({p.name for p in self.carpeta.glob("*.json")}, antes)
        destino = self.incorporar(self.entrada, "materia")
        self.assertIsNone(self.incorporar(self.entrada_de(destino), "repetida"))

    def test_censo_completo_sin_actividad_no_afirma_ia(self) -> None:
        """Comprueba censo completo sin actividad no afirma ia."""
        self.recibir(id_ia="999999")
        destino = self.incorporar(self.entrada, "materia")
        dato = self.dato(destino)
        self.assertEqual(dato["estado_censo"], "completo")
        self.assertIsNone(dato["censo_ia"])

    def test_parcial_tras_nueva_recepcion_conserva_positivo_anterior(self) -> None:
        """Comprueba parcial tras nueva recepcion conserva positivo anterior."""
        self.recibir()
        primera = self.incorporar(self.entrada, "primera-materia")
        antes = self.dato(primera)
        entrada_nueva = self.general_nueva(self.entrada_de(primera))
        self.assertEqual(materia.actuales(entrada_nueva.admision, {self.caso.id}, self.CORTE), {})
        self.recibir(instante="2026-10-23T21:50:01Z", parcial=True)
        segunda = self.incorporar(entrada_nueva, "parcial")
        despues = self.dato(segunda)
        self.assertEqual(despues["estado_censo"], "parcial")
        self.assertEqual(despues["censo_ia"], antes["censo_ia"])
        self.assertNotEqual(despues["vinculo"], antes["vinculo"])

    def test_contenido_cambiado_usa_huella_nueva_y_censo_previo(self) -> None:
        """Comprueba contenido cambiado usa huella nueva y censo previo."""
        self.recibir()
        primera = self.incorporar(self.entrada, "primera-materia")
        antes = self.dato(primera)
        entrada_nueva = self.general_nueva(self.entrada_de(primera), contenido_nuevo=True)
        self.recibir(instante="2026-10-23T21:50:01Z", parcial=True)
        despues = self.dato(self.incorporar(entrada_nueva, "contenido-nuevo"))
        self.assertIsNone(antes["contenido"])
        self.assertIsNotNone(despues["contenido"]["sha256"])
        self.assertEqual(antes["censo_ia"], despues["censo_ia"])

    def test_solo_ia_nueva_cambia_candidata_sin_recepcion_general(self) -> None:
        """Comprueba solo ia nueva cambia candidata sin recepcion general."""
        self.recibir(id_ia="999999")
        primera = self.incorporar(self.entrada, "primera-materia")
        self.assertIsNone(self.dato(primera)["censo_ia"])
        self.recibir(instante="2026-10-23T21:50:01Z")
        segunda = self.incorporar(self.entrada_de(primera), "ia-nueva")
        self.assertIsNotNone(segunda)
        self.assertIsNotNone(self.dato(segunda)["censo_ia"])

    def test_pendiente_no_toma_censo_futuro_ni_decide_entre_dos_ciclos(self) -> None:
        """Comprueba pendiente no toma censo futuro ni decide entre dos ciclos."""
        self.recibir()
        self.recibir(instante="2026-10-23T21:50:01Z", id_ia="999999")
        ciclo = materia.leer_censo_archivado(
            self.raiz,
            self.conjunto,
            "2026-10-23T21:47:00Z",
            pendiente=True,
        )
        self.assertEqual(ciclo["corte_utc"], "2026-10-23T21:45:01Z")
        self.assertIsNone(materia.leer_censo_archivado(self.raiz, self.conjunto, self.CORTE, pendiente=True))


if __name__ == "__main__":
    unittest.main()
