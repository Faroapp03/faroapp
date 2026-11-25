"""Retención de fuente en una composición real con capturas sintéticas y sin red."""

import json
import shutil
import sqlite3
import unittest
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos import admision_catalogo, retencion_composicion
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion
from plataforma_datos.cursos.pruebas import test_academy_observaciones_vigencia as academy
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as recepciones
from plataforma_datos.cursos.pruebas import test_materia_cibernarium as materia
from plataforma_datos.orquestacion import actualizar, estado_panel, indices_operativos, retencion_paquete_cursos
from plataforma_datos.orquestacion.archivos_de_generacion import GeneracionInvalida

BARCELONA = "barcelonactiva"
ACADEMY = "claude_academy"
CORTE = "2026-10-23T22:20:00Z"
SIGUIENTE = "2026-10-23T22:30:00Z"
FECHA_IA_ANTERIOR = "2026-10-23T22:05:01Z"
ORIGEN_EXPORTADO = (DATOS_RELATIVOS / "validados/barcelonactiva/barcelonactiva.json").as_posix()
EVENTO_MATERIA = frozenset({"ediciones", "ciclos", "fuentes"})
NUEVA_EDICION = "910000001"


class RetencionEnLaComposicion(unittest.TestCase):
    """SQLite, admisión, aplicación, proyección, conservación del paquete y avisos reales."""

    def setUp(self) -> None:
        """Instala un antecedente íntegro del Cibernàrium y prepara la otra fuente sin abrir la red."""
        self.barcelona = materia.SeleccionAdmitida()
        self.barcelona.setUp()
        self.addCleanup(self.barcelona.doCleanups)
        self.barcelona.recibir(instante=FECHA_IA_ANTERIOR)
        admitido = self.barcelona.incorporar(self.barcelona.entrada, "materia-admitida")
        conocidos = fuente.conocidos
        self.academy = academy.AcademyObservacionesPruebas()
        self.academy.setUp()
        self.addCleanup(self.academy.doCleanups)
        self.raiz = self.academy.raiz
        self.base = self.raiz / almacen.RUTA
        self.base.parent.mkdir(parents=True)
        (self.raiz / DATOS_RELATIVOS / "ejecuciones").mkdir()
        guardar_json(self.raiz / DATOS_RELATIVOS / "preparados/abierta/fichas.json", {"fichas": []})
        shutil.copytree(admitido, self.base)
        shutil.copytree(
            self.barcelona.raiz / DATOS_RELATIVOS / "originales",
            self.raiz / DATOS_RELATIVOS / "originales",
        )
        shutil.copytree(
            self.barcelona.carpeta, fuente.rutas_de_la_fuente(BARCELONA, self.raiz)[2] / materia.materia.CARPETA_CENSOS
        )
        parche = patch.object(
            fuente,
            "conocidos",
            side_effect=lambda id, raiz: self.academy.programas if id == ACADEMY else conocidos(id, raiz),
        )
        parche.start()
        self.addCleanup(parche.stop)
        self._archivar = almacen.archivar_documento
        self._destinos_de_materia = []

    def _admitir_barcelona(self, *, alta: bool, hora: str) -> None:
        actividad = deepcopy(self.barcelona.actividad)
        if alta:
            nueva = deepcopy(actividad["listEditions"][0])
            nueva["activityId"] = NUEVA_EDICION
            actividad["listEditions"].append(nueva)
        actividad["title"] = "Barcelona sintética " + hora
        original, _, _ = fuente.rutas_de_la_fuente(BARCELONA, self.raiz)
        cuerpo = fuente.json_bytes({"numActivities": 1, "start": 0, "end": 15, "activities": [actividad]})
        pagina = recepciones._captura(
            original, adquisicion.url_pagina(0), cuerpo, fin=f"2026-10-23T{hora}:00Z", tipo="application/json"
        )
        guardar_json(original / "procedencia.json", {**self.barcelona.general, "capturas": [pagina]})
        fuente.preparar(BARCELONA, raiz=self.raiz)
        fuente.validar(BARCELONA, raiz=self.raiz)

    def _fallar_solo_el_archivo_del_intento(
        self, contenido: bytes, destino: Path, inventario: dict, *, campos_evento: frozenset[str]
    ) -> dict:
        if campos_evento != EVENTO_MATERIA:
            return self._archivar(contenido, destino, inventario, campos_evento=campos_evento)
        self._destinos_de_materia.append(destino)
        if any(parte.startswith("pendiente-") for parte in destino.parts):
            return self._archivar(contenido, destino, inventario, campos_evento=campos_evento)
        # Solo se reduce la cota de este documento nuevo. La base y las demás fuentes se readmiten de verdad.
        with patch.object(admision_catalogo, "MAX_DOCUMENTO", 1):
            return self._archivar(contenido, destino, inventario, campos_evento=campos_evento)

    def _paquete(self, raiz: Path, *, nuevo: bool) -> None:
        carpeta = raiz / "datos"
        guardar_json(carpeta / "barcelonactiva.json", {"ocupaciones": [], "consulta": "nueva" if nuevo else "previa"})
        guardar_json(carpeta / "otro.json", {"hecho": "nuevo" if nuevo else "previo"})
        huella = sha256(carpeta / "barcelonactiva.json")
        guardar_json(
            carpeta / "manifiesto.json",
            {
                "barcelonactiva.json": {"sha256": huella, "origenes": {ORIGEN_EXPORTADO: huella}},
                "otro.json": {"sha256": sha256(carpeta / "otro.json"), "origenes": {}},
            },
        )

    def _programas_y_ediciones(self, raiz: Path) -> tuple[set[str], set[str]]:
        with sqlite3.connect((raiz / almacen.RUTA / "catalogo.sqlite3").as_uri() + "?mode=ro", uri=True) as conexion:
            return tuple(
                {f[0] for f in conexion.execute(f"SELECT id FROM {tabla}")} for tabla in ("programas", "ediciones")
            )

    def _ejecutar_paquete_retencion(self, area: Path, salida_previa: str) -> actualizar.ResultadoDelModulo:
        def ejecutar(orden: list[str], candidata: Path) -> actualizar.Resultado:
            if tuple(orden) == tuple(actualizar.EXPORTAR_EL_PAQUETE.orden):
                self._paquete(candidata, nuevo=True)
            elif tuple(orden) == tuple(actualizar.COMPONER_EL_CATALOGO.orden):
                with patch.object(almacen, "archivar_documento", side_effect=self._fallar_solo_el_archivo_del_intento):
                    resultado = componer.componer(raiz=candidata, corte_utc=CORTE)
                self.assertIsNone(resultado["publicacion_confirmada"])
                self.assertEqual(resultado["fuentes_retenidas"][BARCELONA]["versionEn"], FECHA_IA_ANTERIOR)
            elif tuple(orden) == tuple(actualizar.ENSAMBLADO[0].orden):
                # El ensamblado y sus comprobaciones trabajan con el paquete que se sustituirá.
                self.assertEqual(sha256(candidata / "datos" / "barcelonactiva.json"), salida_previa)
                manifiesto = json.loads((candidata / "datos/manifiesto.json").read_bytes())
                retencion_paquete_cursos.comprobar(candidata, manifiesto)
                origen_previo = next(iter(manifiesto["barcelonactiva.json"]["origenes"]))
                self.assertEqual(sha256(candidata / origen_previo), salida_previa)
                self.assertNotEqual(origen_previo, ORIGEN_EXPORTADO)
            return actualizar.Resultado(0, "")

        _, _, resultado = actualizar.ejecutar_paquete(self.raiz, area, ejecutar, actualizar.Opciones())
        return resultado

    def _comprobar_referencia_retenida(self) -> None:
        manifiesto = json.loads((self.raiz / "datos/manifiesto.json").read_bytes())
        origen = self.raiz / next(iter(manifiesto["barcelonactiva.json"]["origenes"]))
        contenido = origen.read_bytes()
        origen.write_bytes(b"entrada alterada")
        try:
            with self.assertRaises(GeneracionInvalida):
                indices_operativos.comprobar_indices_operativos(self.raiz, manifiesto, set())
        finally:
            origen.write_bytes(contenido)

    def test_conserva_salida_de_barcelona_y_admite_academy_y_reintenta_altas(self) -> None:
        """Importa cambios sanos, descarta pendientes parciales y recupera las altas en el siguiente ciclo."""
        self._paquete(self.raiz, nuevo=False)
        cortes = retencion_composicion.fecha_admitida(self.base, BARCELONA, CORTE)
        self.assertEqual(cortes, FECHA_IA_ANTERIOR)
        componer.componer(raiz=self.raiz, corte_utc=CORTE)
        salida_previa = sha256(self.raiz / "datos" / "barcelonactiva.json")
        control_previo = almacen.solicitud(self.base).procedencia["recibo-cibernarium"].sha256
        # Dos conjuntos nuevos antes de aplicar: solo el pendiente contiene la nueva edición.
        self._admitir_barcelona(alta=True, hora="22:10")
        self._admitir_barcelona(alta=False, hora="22:12")
        self.academy.ciclo()
        original, _, validado = fuente.rutas_de_la_fuente(BARCELONA, self.raiz)
        self.assertEqual(len(fuente.leer_pendientes(BARCELONA, self.raiz)), 1)
        huellas = {p: sha256(p) for carpeta in (original, validado) for p in carpeta.rglob("*") if p.is_file()}
        # El productor general ya promovió el validado nuevo y el paquete vivo todavía cita los bytes previos.
        guardar_json(self.raiz / ORIGEN_EXPORTADO, {"ocupaciones": [], "consulta": "nueva"})
        area = self.barcelona.raiz / "candidata-retencion"
        shutil.copytree(self.raiz, area)
        self.addCleanup(shutil.rmtree, area, ignore_errors=True)

        resultado = self._ejecutar_paquete_retencion(area, salida_previa)
        self.assertEqual(resultado.veredicto, actualizar.VERDE, resultado.motivo)
        self.assertEqual(sha256(self.raiz / "datos" / "barcelonactiva.json"), salida_previa)
        self._comprobar_referencia_retenida()
        self.assertEqual(json.loads((self.raiz / "datos" / "otro.json").read_bytes())["hecho"], "nuevo")
        programas, ediciones = self._programas_y_ediciones(self.raiz)
        self.assertIn("claude-academy:nuevo", programas)
        self.assertNotIn("cibernarium-edicion:" + NUEVA_EDICION, ediciones)
        self.assertEqual(almacen.solicitud(self.base).procedencia["recibo-cibernarium"].sha256, control_previo)
        self.assertTrue(any("pendiente-0" in p.parts for p in self._destinos_de_materia))
        self.assertEqual({p: sha256(p) for p in huellas}, huellas)

        panel = estado_panel.estado_panel(self.raiz, datetime.fromisoformat(SIGUIENTE))
        fila = next(f for f in panel["seguimientoRemoto"] if f["fuente"] == BARCELONA)
        self.assertEqual(
            fila["retencionComposicion"],
            {"motivo": "documento-excesivo", "desde": CORTE, "versionEn": FECHA_IA_ANTERIOR},
        )
        with patch.object(almacen, "archivar_documento", side_effect=self._fallar_solo_el_archivo_del_intento):
            repetido = componer.componer(raiz=self.raiz, corte_utc=SIGUIENTE)
        self.assertEqual(repetido["fuentes_retenidas"][BARCELONA], fila["retencionComposicion"])

        # Una admisión posterior vuelve a apartar lo que seguía pendiente. Ninguna alta depende de repetir red.
        self._admitir_barcelona(alta=False, hora="22:25")
        self.assertEqual(len(fuente.leer_pendientes(BARCELONA, self.raiz)), 2)
        recuperado = componer.componer(raiz=self.raiz, corte_utc=SIGUIENTE)
        self.assertNotIn("fuentes_retenidas", recuperado)
        self.assertIn("cibernarium-edicion:" + NUEVA_EDICION, self._programas_y_ediciones(self.raiz)[1])

    def test_sin_respaldo_de_una_fuente_o_con_error_compartido_no_se_proyecta(self) -> None:
        """La falta de base propia, SQLite, la coherencia y el fallo común salen del tramo."""
        antes = sha256(self.base / almacen.CONTROL)
        excesivo = almacen.DocumentoArchivadoExcesivo("Documento de Academy excesivo")
        with (
            patch.object(componer, "_aplicar_academy", side_effect=excesivo),
            self.assertRaises(almacen.DocumentoArchivadoExcesivo),
        ):
            componer.componer(raiz=self.raiz, corte_utc=CORTE)
        for error in (sqlite3.DatabaseError("SQLite ilegible"), ValueError("Datos mezclados")):
            with (
                self.subTest(error=error),
                patch.object(componer, "_aplicar_cibernarium", side_effect=error),
                self.assertRaises(type(error)),
            ):
                componer.componer(raiz=self.raiz, corte_utc=CORTE)
        self.assertEqual(sha256(self.base / almacen.CONTROL), antes)
        self.assertEqual(retencion_composicion.leer(self.base), {})
        self.assertFalse((self.raiz / "web").exists())

    def test_dos_fuentes_independientes_conservan_su_version(self) -> None:
        """Dos productores con respaldo propio pueden conservarse en una misma composición."""
        self.academy.ciclo()
        componer.componer(raiz=self.raiz, corte_utc=CORTE)
        entrada = almacen.solicitud(self.base)
        recibos = {n: entrada.procedencia[n].sha256 for n in ("recibo-academy", "recibo-cibernarium")}
        self.academy.ids_indice = [*self.academy.ids_indice, "otra-alta"]
        self.academy.ciclo()
        self._admitir_barcelona(alta=True, hora="22:25")

        def fallar_dos(contenido: bytes, destino: Path, inventario: dict, *, campos_evento: frozenset[str]) -> dict:
            if json.loads(contenido).get("fuente_id") == ACADEMY:
                with patch.object(admision_catalogo, "MAX_DOCUMENTO", 1):
                    return self._archivar(contenido, destino, inventario, campos_evento=campos_evento)
            return self._fallar_solo_el_archivo_del_intento(contenido, destino, inventario, campos_evento=campos_evento)

        with patch.object(almacen, "archivar_documento", side_effect=fallar_dos):
            resultado = componer.componer(raiz=self.raiz, corte_utc=SIGUIENTE)
        self.assertEqual(set(resultado["fuentes_retenidas"]), {BARCELONA, ACADEMY})
        vigente = almacen.solicitud(self.base)
        self.assertEqual({n: vigente.procedencia[n].sha256 for n in recibos}, recibos)
        self.assertEqual(retencion_composicion.leer(self.base), resultado["fuentes_retenidas"])
        recuperado = componer.componer(raiz=self.raiz, corte_utc=SIGUIENTE)
        self.assertNotIn("fuentes_retenidas", recuperado)
        self.assertIn("claude-academy:otra-alta", self._programas_y_ediciones(self.raiz)[0])

    def test_paquete_con_otro_consumidor_del_mismo_origen_se_retiene(self) -> None:
        """El ensamblado se detiene si reemplazar solo la salida retenida mezclaría entradas incompatibles."""
        self._paquete(self.raiz, nuevo=False)
        area = self.barcelona.raiz / "composicion-incompatible"
        shutil.copytree(self.raiz, area)
        self.addCleanup(shutil.rmtree, area, ignore_errors=True)

        def ejecutar(orden: list[str], candidata: Path) -> actualizar.Resultado:
            if tuple(orden) == tuple(actualizar.EXPORTAR_EL_PAQUETE.orden):
                self._paquete(candidata, nuevo=True)
                ruta = candidata / "datos/manifiesto.json"
                documento = json.loads(ruta.read_bytes())
                documento["otro.json"]["origenes"] = documento["barcelonactiva.json"]["origenes"]
                guardar_json(ruta, documento)
            elif tuple(orden) == tuple(actualizar.COMPONER_EL_CATALOGO.orden):
                retencion_composicion.guardar(
                    candidata / almacen.RUTA,
                    {BARCELONA: {"motivo": "documento-excesivo", "desde": CORTE, "versionEn": FECHA_IA_ANTERIOR}},
                )
            else:
                self.fail("El ensamblado no debe leer el paquete incompatible")
            return actualizar.Resultado(0, "")

        vigente = sha256(self.raiz / "datos/manifiesto.json")
        with patch.object(actualizar, "publicar") as publicar:
            _, _, resultado = actualizar.ejecutar_paquete(self.raiz, area, ejecutar, actualizar.Opciones())
        publicar.assert_not_called()
        self.assertEqual(resultado.veredicto, actualizar.AMBAR)
        self.assertIn("comparte procedencia", resultado.motivo)
        self.assertEqual(sha256(self.raiz / "datos/manifiesto.json"), vigente)
