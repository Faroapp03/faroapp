"""La composición y la entrega conservan el contexto de un censo admitido con el formato antiguo."""

import copy
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from collections.abc import Sequence
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import RAIZ, FormatoInesperado
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo, identidades_de_admision, operacion_fuente
from plataforma_datos.cursos.pruebas import test_censo_digitalizate as capturas
from plataforma_datos.orquestacion import actualizar, ensayo_por_partes, estado_panel, generacion_operativa
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion.modulos import MODULOS, carpetas
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import ADMISION, preparar

FUENTE = "fundae"
REVISION = "a" * 40
ALTA = "fundae:1:1880"
CORTE = capturas.CORTES[0]
PRIMER_INTENTO = datetime(2026, 11, 15, tzinfo=UTC)
INTENTO_FALLIDO = datetime(2026, 11, 16, tzinfo=UTC)
OBSERVADO = datetime(2026, 11, 17, tzinfo=UTC)


class MigracionDeCensos(unittest.TestCase):
    """Usa la SQLite, los recibos y los controles reales con un recorte del censo de Digitalízate."""

    def setUp(self) -> None:
        """Prepara la raíz, el conjunto previo y una versión buena seguida de un intento en ámbar."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.repeticion = Path(temporal.name).resolve()
        self.raiz = self.repeticion / "candidato"
        self.area = self.repeticion / "area"
        preparar(self.raiz)

        caso = capturas.CensoDigitalizatePruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        documento = copy.deepcopy(caso.caso.rx.documento)
        documento["censo"] = caso.censo([capturas.recurso(id) for id in (1, 2, 1880)])
        self.indice = caso.caso.rx.captura(
            "digitalizate",
            {
                "respuesta": [
                    {"idRecursoFormativoBuscador": i, "idRecursoFormativo": id, "idCatalogo": 1}
                    for i, id in enumerate((1, 2, 1880), start=1)
                ]
            },
        )
        documento["auxiliares"]["digitalizate"] = self.indice
        documento.setdefault("historial", [])
        original, preparado, validado = operacion_fuente.rutas_de_la_fuente(FUENTE, self.raiz)
        validado.mkdir(parents=True, exist_ok=True)
        shutil.copytree(caso.carpeta, original, dirs_exist_ok=True)
        guardar_json(original / "procedencia.json", documento)
        guardar_json(original.parent / "procedencia.json", {"archivos": []})
        operacion_fuente.enlazar_canal(FUENTE, self.raiz)
        guardar_json(validado.parent / "validacion.json", {**ADMISION, "evidencias": {}})
        guardar_json(validado.parent / "fundae.json", {"ediciones": []})
        guardar_json(preparado.parent / "ediciones.json", {"ediciones": []})
        almacen.conservar(caso.caso.entrada, destino=self.raiz / almacen.RUTA)

        # Guarda un informe del formato anterior y reproduce su conjunto con el catálogo aún sin el alta.
        self.conjunto = operacion_fuente.calcular_recepciones_de_fuente(FUENTE, self.raiz)
        self.assertEqual(self.conjunto["censo"]["altas"], [1880])
        (validado / "fundae.json").write_bytes(operacion_fuente.json_bytes(self.conjunto))
        (validado / "procedencia-admitida.json").write_bytes((original / "procedencia.json").read_bytes())
        self.informe = validado / "validacion.json"
        self.legado = {
            **ADMISION,
            "schema_version": 1,
            "conjunto_sha256": sha256(validado / "fundae.json"),
            "comprobado_utc": "2026-11-15T00:30:41Z",
        }
        guardar_json(self.informe, self.legado)
        self.assertEqual(operacion_fuente.leer_validado(FUENTE, self.raiz), self.conjunto)

        web = self.raiz / "web"
        web.mkdir()
        (web / "index.html").write_text("<!doctype html>", encoding="utf-8")
        self._registrar_ambar()
        self.snapshot = self.raiz / almacen.RUTA / "catalogo.sqlite3"
        self.sha_antes = sha256(self.snapshot)

    def _registrar_ambar(self) -> None:
        modulo = next(m for m in MODULOS if m.id == FUENTE)
        self.version = actualizar.huella(self.raiz, carpetas(modulo))
        informe_ejecucion = self.raiz / estado.CARPETA_DE_INFORMES / "2026-10-01-000000.md"
        estado.registrar_estado(
            self.raiz,
            {FUENTE: estado.ResultadoDelModulo(estado.VERDE, publicado=self.version)},
            estado.Intento(PRIMER_INTENTO, estado.VERDE, informe_ejecucion),
        )
        estado.registrar_estado(
            self.raiz,
            {FUENTE: estado.ResultadoDelModulo(estado.AMBAR, motivo="se conserva la admisión anterior")},
            estado.Intento(INTENTO_FALLIDO, estado.AMBAR, informe_ejecucion),
            aviso=lambda *_args: None,
        )
        self.antes = (self.raiz / estado.CARPETA_DE_INFORMES / estado.ARCHIVO).read_bytes()

    def _comprobar_migrado(self) -> None:
        informe = json.loads(self.informe.read_bytes())
        campos = {identidades_de_admision.CAMPO, identidades_de_admision.HUELLA}
        self.assertEqual({k: v for k, v in informe.items() if k not in campos}, self.legado)
        self.assertIsNotNone(identidades_de_admision.leer(FUENTE, informe))
        self.assertEqual(operacion_fuente.leer_validado(FUENTE, self.raiz), self.conjunto)
        panel = estado_panel.estado_panel(self.raiz, OBSERVADO)
        fila = next(m for m in panel["modulos"] if m["id"] == FUENTE)
        self.assertEqual(fila["veredicto"], estado.AMBAR)
        self.assertEqual(fila["ultimoIntento"], "2026-11-16T00:00:00Z")
        self.assertEqual(fila["ultimaVersionBuena"], {"fecha": "2026-11-15T00:00:00Z", "huella": self.version})
        self.assertEqual((self.raiz / estado.CARPETA_DE_INFORMES / estado.ARCHIVO).read_bytes(), self.antes)
        with closing(sqlite3.connect(self.snapshot.as_uri() + "?mode=ro&immutable=1", uri=True)) as sql:
            self.assertIsNotNone(sql.execute("SELECT id FROM programas WHERE id=?", (ALTA,)).fetchone())

    def test_la_cli_sella_antes_del_alta_y_repite_sin_reescribir_el_informe(self) -> None:
        """La CLI real puede partir de un legado sin un paso anterior de preparar/validar."""
        shutil.copytree(
            RAIZ / "plataforma_datos", self.raiz / "plataforma_datos", ignore=shutil.ignore_patterns("__pycache__")
        )
        shutil.copytree(RAIZ / "config" / "formacion", self.raiz / "config" / "formacion")
        shutil.copytree(RAIZ / "src" / "catalogo-cursos", self.raiz / "src" / "catalogo-cursos")
        entorno = {"PATH": os.environ["PATH"], "TMPDIR": "/private/tmp", "FARO_INSTANTE": CORTE}
        for repeticion in range(2):
            resultado = subprocess.run(
                [sys.executable, "-B", "-m", "plataforma_datos.cursos.componer_catalogo"],
                env=entorno,
                cwd=self.raiz,
                timeout=30,
                capture_output=True,
                check=False,
            )
            self.assertEqual(resultado.returncode, 0, resultado.stderr)
            self.assertIsNone(json.loads(resultado.stdout)["publicacion_confirmada"])
            if repeticion == 0:
                mtime = self.informe.stat().st_mtime_ns
            else:
                self.assertEqual(self.informe.stat().st_mtime_ns, mtime)
        self._comprobar_migrado()

    def test_paquete_con_fuente_ambar_coteja_la_raiz_hidratada_antes_de_sustituir(self) -> None:
        """El historial ámbar, su versión buena y la huella del negocio conservan su cronología."""
        origen = self.repeticion / "generacion-base"
        recibo = generacion_operativa.exportar_generacion(self.raiz, origen, REVISION)
        anterior = self.repeticion / "anterior"
        self.raiz.rename(anterior)
        generacion_operativa.restaurar_base_candidata(origen, self.raiz, REVISION, recibo["sha256Manifiesto"], RAIZ)
        shutil.copytree(anterior / "web", self.raiz / "web")
        self.assertEqual(json.loads(self.informe.read_bytes()), self.legado)
        shutil.copytree(self.raiz, self.area)

        def ejecutar(orden: Sequence[str], area: Path) -> actualizar.Resultado:
            if tuple(orden) == tuple(actualizar.COMPONER_EL_CATALOGO.orden):
                componer_catalogo.componer(raiz=area, corte_utc=CORTE)
                self.assertEqual(sha256(self.snapshot), self.sha_antes)
                self.assertEqual(json.loads(self.informe.read_bytes()), self.legado)
            return actualizar.Resultado(0, "")

        with actualizar.sustitucion.cerrojo(self.raiz):
            _, _, resultado = actualizar.ejecutar_paquete(self.raiz, self.area, ejecutar, actualizar.Opciones())
        self.assertEqual(resultado.veredicto, estado.VERDE, resultado.motivo)
        self.assertEqual(resultado.publicado, actualizar.huella(self.raiz, actualizar.RUTAS_DE_LA_ENTREGA))
        self._comprobar_migrado()

    def test_reanudar_desde_area_compuesta_conserva_el_legado_en_la_generacion(self) -> None:
        """El cierre de un tramo usa el mismo sellado, aunque no vuelva a ejecutar componer."""
        shutil.copytree(self.raiz, self.area)
        componer_catalogo.componer(raiz=self.area, corte_utc=CORTE)
        codigo = self.repeticion / ensayo_por_partes.CARPETA_DE_PASOS / ensayo_por_partes.CODIGO
        guardar_json(codigo, {"revision": REVISION})
        resultado = ensayo_por_partes.publicar_y_exportar(self.repeticion, True)
        self._comprobar_migrado()
        self.assertEqual(resultado["estado"], "conservada", resultado)
        restaurada = self.repeticion / "restaurada"
        generacion_operativa.restaurar_generacion(
            self.repeticion / "generacion-resultado", restaurada, REVISION, resultado["sha256Manifiesto"]
        )
        self.assertEqual(operacion_fuente.leer_validado(FUENTE, restaurada), self.conjunto)

    def test_original_alterado_en_la_raiz_no_instala_el_area_preparada(self) -> None:
        """La admisión antigua de la raíz se comprueba de nuevo y nunca se toma del área al instalar."""
        shutil.copytree(self.raiz, self.area)
        componer_catalogo.componer(raiz=self.area, corte_utc=CORTE)
        ruta = operacion_fuente.rutas_de_la_fuente(FUENTE, self.raiz)[0] / self.indice["cuerpo"]["archivo"]
        ruta.write_bytes(ruta.read_bytes() + b" ")
        with actualizar.sustitucion.cerrojo(self.raiz):
            _, _, resultado = actualizar.ejecutar_paquete(
                self.raiz, self.area, lambda _orden, _area: actualizar.Resultado(0, ""), actualizar.Opciones()
            )
        self.assertEqual(resultado.veredicto, estado.AMBAR)
        self.assertIn("admisión de censo no reproducible", resultado.motivo)
        self.assertIsNone(resultado.publicado)
        self.assertEqual(sha256(self.snapshot), self.sha_antes)
        self.assertEqual(json.loads(self.informe.read_bytes()), self.legado)

    def test_ensayo_con_area_compuesta_no_sella_el_informe_de_la_raiz(self) -> None:
        """El ensayo puede validar una composición conservando los bytes de la raíz."""
        shutil.copytree(self.raiz, self.area)
        componer_catalogo.componer(raiz=self.area, corte_utc=CORTE)
        with actualizar.sustitucion.cerrojo(self.raiz):
            resultado = actualizar.publicar_paquete(self.raiz, self.area, ensayo=True)
        self.assertEqual(resultado.veredicto, estado.VERDE)
        self.assertIsNone(resultado.publicado)
        self.assertEqual(sha256(self.snapshot), self.sha_antes)
        self.assertEqual(json.loads(self.informe.read_bytes()), self.legado)

    def test_el_sello_rechaza_un_informe_citado_por_el_manifiesto(self) -> None:
        """Señalar el informe como origen mantiene intactas la huella publicada y la SQLite."""
        manifiesto = self.raiz / "datos/manifiesto.json"
        documento = json.loads(manifiesto.read_bytes())
        documento["uno.json"]["origenes"] = {self.informe.relative_to(self.raiz).as_posix(): sha256(self.informe)}
        guardar_json(manifiesto, documento)
        with self.assertRaisesRegex(FormatoInesperado, "El paquete cita el informe"):
            componer_catalogo.componer(raiz=self.raiz, corte_utc=CORTE)
        self.assertEqual(sha256(self.snapshot), self.sha_antes)
        self.assertEqual(json.loads(self.informe.read_bytes()), self.legado)

    def test_el_sello_rechaza_citas_al_informe_por_una_ruta_alternativa(self) -> None:
        """La cita de paquete protege el mismo informe también con otra grafía o enlace."""
        manifiesto = self.raiz / "datos/manifiesto.json"
        documento = json.loads(manifiesto.read_bytes())
        relativa = self.informe.relative_to(self.raiz)
        enlace = self.raiz / "alias.json"
        enlace.symlink_to(relativa)
        alias = ["./" + relativa.as_posix(), enlace.name]
        mayusculas = relativa.with_name(relativa.name.upper())
        if (self.raiz / mayusculas).exists():
            alias.append(mayusculas.as_posix())
        for origen in alias:
            with self.subTest(origen=origen):
                documento["uno.json"]["origenes"] = {origen: sha256(self.informe)}
                guardar_json(manifiesto, documento)
                anterior = manifiesto.read_bytes()
                with self.assertRaises(FormatoInesperado):
                    componer_catalogo.componer(raiz=self.raiz, corte_utc=CORTE)
                self.assertEqual(manifiesto.read_bytes(), anterior)
                self.assertEqual(sha256(self.snapshot), self.sha_antes)
                self.assertEqual(json.loads(self.informe.read_bytes()), self.legado)
