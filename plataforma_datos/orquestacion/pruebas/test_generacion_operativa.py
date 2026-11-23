"""Transferencias de fixtures pequeños: bytes, confianza externa y fallos sin restos; ninguna fuente por red."""

import hashlib
import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import chdir, redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.cursos import trozos_catalogo
from plataforma_datos.orquestacion import comprobaciones_remotas as comprobaciones
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.estado_de_la_actualizacion import SIN_INTENTO, VERSION_REGISTRO
from plataforma_datos.orquestacion.modulos import ENTRADAS_EXTERNAS, FUENTES_CATALOGO, IDS, MODULOS, carpetas
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES
from plataforma_datos.orquestacion.sustitucion import cerrojo, huellas_del_arbol

REVISION = "a" * 40
OTRA_REVISION = "b" * 40
ADMISION = {"estado": "Admitido", "controles": [{"control": "fixture", "resultado": "correcto"}]}


def escribir(raiz: Path, ruta: str, contenido: object) -> None:
    """Crea únicamente entradas sintéticas de una generación pequeña."""
    guardar_json(raiz / ruta, contenido)


def preparar(raiz: Path) -> None:
    """Generación mínima con todas las raíces del registro, no originales reales."""
    for modulo in MODULOS:
        if modulo.id in FUENTES_CATALOGO:
            continue
        for ruta in carpetas(modulo)[1:]:
            escribir(raiz, f"{ruta}/conjunto.json", {"fixture": modulo.id})
        escribir(raiz, f"{carpetas(modulo)[2]}/validacion.json", ADMISION)
    originales = (
        {f.originales for f in FUENTES.values() if f.originales and f.originales not in FUENTES_CATALOGO}
        | {"sepe"}
        | set(generacion.ORIGINALES_DE_RECONSTRUCCION)
    )
    for fuente in originales:
        base = f"var/actualizacion/originales/{fuente}"
        escribir(raiz, f"{base}/edición.json", {"edicion": "fija"})
        escribir(
            raiz,
            f"{base}/procedencia.json",
            {
                "archivos": [{"archivo": "edición.json", "sha256": sha256(raiz / base / "edición.json")}],
                "fecha": "2026-10-01",
            },
        )
    for ruta in ENTRADAS_EXTERNAS:
        (raiz / ruta).mkdir(parents=True, exist_ok=True)
    escribir(raiz, "var/actualizacion/revisiones/decision.json", {"revision": "fixture"})
    for fuente in ("ia-nacional", "encuestas-isco4"):
        base = f"var/actualizacion/validados/{fuente}"
        escribir(raiz, f"{base}/{fuente}.json", {"agregado": True})
        escribir(raiz, f"{base}/validacion.json", ADMISION)
    escribir(raiz, "var/actualizacion/preparados/abierta/fichas.json", {"fichas": [], "plataformas": {}})
    escribir(raiz, generacion.HISTORIAL, [{"fecha": "2026-10-01", "version": "conservar"}])
    escribir(
        raiz,
        f"{CARPETA_DE_INFORMES}/2026-10-01-000000.json",
        {"utc": "2026-10-01T00:00:00Z", "veredicto": "verde"},
    )
    (raiz / CARPETA_DE_INFORMES / "2026-10-01-000000.md").write_text("Informe sintético\n", encoding="utf-8")
    escribir(
        raiz,
        generacion.ESTADO,
        {
            "version": VERSION_REGISTRO,
            "origen_migracion": None,
            "actualizacion": {
                "huella_resultados": "b" * 64,
                "integridad_resultados": "huella_conservada",
                "comienzo_utc": "2026-10-01T00:00:00+00:00",
                "veredicto": "verde",
                "informe": f"{CARPETA_DE_INFORMES}/2026-10-01-000000.md",
            },
            "modulos": {nombre: dict(SIN_INTENTO) for nombre in IDS},
        },
    )
    escribir(raiz, "datos/uno.json", {"dato": 1})
    escribir(raiz, "datos/manifiesto.json", {"uno.json": {"sha256": sha256(raiz / "datos/uno.json")}})
    for nombre in generacion.AUXILIARES:
        ruta = raiz / "datos" / nombre
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text("{}" if nombre.endswith(".json") else "Licencia fixture", encoding="utf-8")


class PruebaGeneracionOperativa(unittest.TestCase):
    """Exportación, verificación y restauración de dos árboles, con fuente coherente propia."""

    def setUp(self) -> None:
        """Una instalación Unicode y destinos hermanos exclusivos por prueba."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.temporal = Path(temporal.name).resolve()
        self.raiz = self.temporal / "Mis documentos" / "Año 2026"
        preparar(self.raiz)
        self.bundle = self.temporal / "generación"
        self.destino = self.temporal / "restaurada"

    def exportar(self) -> dict:
        """Exporta fixture y devuelve su recibo.

        Returns:
            Recibo sin rutas o campos libres de procedencia.
        """
        return generacion.exportar_generacion(self.raiz, self.bundle, REVISION)

    def originales_troceados(self) -> tuple[dict[str, bytes], set[str]]:
        """Dos cuerpos grandes comparten trozos y siguen citados por sus huellas lógicas.

        Returns:
            Contenidos lógicos por ruta y los trozos físicos comunes a ambos.
        """
        base = "var/actualizacion/originales/epa"
        cuerpo = b"0123456789abcdef" * (trozos_catalogo.UMBRAL // 16 + 1)
        cuerpos = {f"{base}/cuerpos/uno.body": cuerpo, f"{base}/cuerpos/dos.body": cuerpo[:-16] + b"fedcba9876543210"}
        referencias = []
        compartidos = None
        for relativa, contenido in cuerpos.items():
            ruta = self.raiz / relativa
            huella = hashlib.sha256(contenido).hexdigest()
            trozos_catalogo.conservar(ruta, contenido, huella)
            manifiesto = trozos_catalogo.manifiesto_de(ruta, huella, limite=trozos_catalogo.MAX_CUERPO)
            self.assertIsNotNone(manifiesto)
            trozos = {
                trozos_catalogo.ruta_trozo(ruta, sha).relative_to(self.raiz).as_posix() for sha, _ in manifiesto.trozos
            }
            compartidos = trozos if compartidos is None else compartidos & trozos
            referencias.append({"archivo": ruta.relative_to(self.raiz / base).as_posix(), "sha256": huella})
        escribir(self.raiz, f"{base}/procedencia.json", {"archivos": referencias})
        # También ejercita los orígenes declarados por un reconstructor en datos/.
        paquete = json.loads((self.raiz / "datos/manifiesto.json").read_bytes())
        paquete["uno.json"]["origenes"] = {
            relativa: hashlib.sha256(contenido).hexdigest() for relativa, contenido in cuerpos.items()
        }
        escribir(self.raiz, "datos/manifiesto.json", paquete)
        self.assertTrue(compartidos)
        return cuerpos, compartidos

    def test_originales_troceados_exportan_y_restauran_sin_expandir_ni_duplicar(self) -> None:
        """La procedencia lógica y cada descriptor/trozo físico sobreviven al traslado."""
        cuerpos, compartidos = self.originales_troceados()
        antes = {relativa: (self.raiz / relativa).read_bytes() for relativa in cuerpos}
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        nombres = [r["ruta"] for r in manifiesto["archivos"]]
        for relativa in compartidos:
            self.assertEqual(nombres.count(relativa), 1)
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        for relativa, contenido in cuerpos.items():
            self.assertEqual((self.destino / relativa).read_bytes(), antes[relativa])
            self.assertLess(len(antes[relativa]), len(contenido))
            self.assertEqual(
                trozos_catalogo.leer(
                    self.destino / relativa, hashlib.sha256(contenido).hexdigest(), limite=trozos_catalogo.MAX_CUERPO
                ),
                contenido,
            )
        self.assertEqual(
            (self.destino / "datos/manifiesto.json").read_bytes(), (self.raiz / "datos/manifiesto.json").read_bytes()
        )
        self.assertEqual(
            (self.destino / "var/actualizacion/originales/epa/procedencia.json").read_bytes(),
            (self.raiz / "var/actualizacion/originales/epa/procedencia.json").read_bytes(),
        )

    def test_original_troceado_con_trozo_faltante_o_corrupto_no_exporta(self) -> None:
        """El descriptor no acredita un cuerpo cuyos bytes ya no se reconstruyen."""
        _cuerpos, compartidos = self.originales_troceados()
        ruta = self.raiz / sorted(compartidos)[0]
        original = ruta.read_bytes()
        for contenido in (None, b"alterado"):
            with self.subTest(contenido=contenido):
                if contenido is None:
                    ruta.unlink()
                else:
                    ruta.write_bytes(contenido)
                with self.assertRaises((OSError, ValueError, ErrorFuente)):
                    self.exportar()
                self.assertFalse(self.bundle.exists())
                ruta.write_bytes(original)

    def test_original_troceado_rechaza_trozo_con_enlace_y_ruta_en_descriptor(self) -> None:
        """Los trozos se resuelven por SHA en la casa local, sin rutas ni alias."""
        cuerpos, compartidos = self.originales_troceados()
        ruta = self.raiz / sorted(compartidos)[0]
        original = ruta.read_bytes()
        externo = self.temporal / "externo.trozo"
        externo.write_bytes(original)
        ruta.unlink()
        ruta.symlink_to(externo)
        with self.assertRaises(ValueError):
            self.exportar()
        ruta.unlink()
        ruta.write_bytes(original)
        descriptor = self.raiz / next(iter(cuerpos))
        dato = json.loads(descriptor.read_bytes()[len(trozos_catalogo.MAGIA) :])
        dato["trozos"][0][0] = "../externo"
        descriptor.write_bytes(
            trozos_catalogo.MAGIA + (json.dumps(dato, sort_keys=True, separators=(",", ":")) + "\n").encode()
        )
        with self.assertRaises(ValueError):
            self.exportar()
        self.assertFalse(self.bundle.exists())

    def test_trozo_alterado_no_se_restaura_aunque_rehagan_manifiesto_fisico(self) -> None:
        """Una envoltura reidentificada no sustituye el SHA lógico de la fuente."""
        _cuerpos, compartidos = self.originales_troceados()
        self.exportar()
        relativa = sorted(compartidos)[0]
        trozo = self.bundle / "contenido" / relativa
        trozo.write_bytes(b"alterado")
        ruta = self.bundle / "manifiesto.json"
        manifiesto = json.loads(ruta.read_bytes())
        for registro in manifiesto["archivos"]:
            if registro["ruta"] == relativa:
                registro.update(bytes=trozo.stat().st_size, sha256=sha256(trozo))
        manifiesto["bytesTotales"] = sum(r["bytes"] for r in manifiesto["archivos"])
        escribir(self.bundle, "manifiesto.json", manifiesto)
        with self.assertRaises(ValueError):
            generacion.restaurar_generacion(self.bundle, self.destino, REVISION, sha256(ruta))
        self.assertFalse(self.destino.exists())

    def test_cli_relativa_exporta_verifica_restaura_y_lee_identidades_del_snapshot(self) -> None:
        """El origen documentado '.' llega con una base absoluta a los lectores SQLite nativos."""
        from plataforma_datos.cursos import almacen_catalogo as almacen
        from plataforma_datos.cursos import operacion_fuente
        from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
        from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as fixtures

        caso = fixtures.ActualizacionHpLifePruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        hp.preparar(caso.solicitud)
        entrada = hp.solicitud_admision(caso.solicitud.area)
        almacen.conservar(
            almacen.EntradaCatalogo(admision=entrada, sha256_admision=caso.ref(entrada.validacion_destino).sha256),
            destino=self.raiz / almacen.RUTA,
        )
        admisiones = generacion._admitidos

        def comprobar_catalogo(raiz: Path) -> None:
            admisiones(raiz)
            self.assertEqual(operacion_fuente.conocidos("hp_life", raiz)[0]["id"], caso.entrada.id)

        with mock.patch.object(generacion, "_admitidos", side_effect=comprobar_catalogo):
            with chdir(self.raiz), redirect_stdout(io.StringIO()) as salida:
                self.assertEqual(
                    generacion.main(["exportar", ".", "--destino", str(self.bundle), "--revision-codigo", REVISION]), 0
                )
            recibo = json.loads(salida.getvalue())
            with chdir(self.temporal), redirect_stdout(io.StringIO()):
                argumentos = ["--revision-codigo", REVISION, "--sha256-manifiesto", recibo["sha256Manifiesto"]]
                self.assertEqual(generacion.main(["verificar", self.bundle.name, *argumentos]), 0)
                self.assertEqual(
                    generacion.main(["restaurar", self.bundle.name, "--destino", self.destino.name, *argumentos]), 0
                )
        self.assertEqual(operacion_fuente.conocidos("hp_life", self.destino)[0]["id"], caso.entrada.id)

    def test_origen_relativo_symlink_sigue_rechazado_sin_resolverlo(self) -> None:
        """Absolutizar la base no convierte un enlace suministrado en una raíz autorizada."""
        alias = self.temporal / "alias"
        alias.symlink_to(self.raiz, target_is_directory=True)
        with chdir(self.temporal), redirect_stderr(io.StringIO()) as errores:
            self.assertEqual(
                generacion.main(["exportar", alias.name, "--destino", str(self.bundle), "--revision-codigo", REVISION]),
                1,
            )
        self.assertEqual(errores.getvalue(), generacion.ERROR_GENERICO + "\n")
        self.assertFalse(self.bundle.exists())

    def test_roundtrip_bytes_estado_historial_y_paquete(self) -> None:
        """La restauración preserva bytes exactos sin crear web, mapa o código."""
        estado = (self.raiz / generacion.ESTADO).read_bytes()
        historial = (self.raiz / generacion.HISTORIAL).read_bytes()
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        resultado = generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual(resultado, recibo)
        self.assertEqual({r.name for r in self.destino.iterdir()}, {"datos", "var"})
        self.assertEqual((self.destino / generacion.ESTADO).read_bytes(), estado)
        self.assertEqual((self.destino / generacion.HISTORIAL).read_bytes(), historial)
        for registro in manifiesto["archivos"]:
            self.assertEqual(
                (self.raiz / registro["ruta"]).read_bytes(), (self.destino / registro["ruta"]).read_bytes()
            )
        self.assertNotIn("interno", json.dumps(recibo))

    def test_productor_solo_validacion_no_exige_preparacion_inexistente(self) -> None:
        """Un registro editorial viaja admitido sin inventar una etapa de preparación."""
        preparada = self.raiz / "var/actualizacion/preparados/hechos_informe"
        for p in preparada.iterdir():
            p.unlink()
        preparada.rmdir()
        recibo = self.exportar()
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertFalse((self.destino / "var/actualizacion/preparados/hechos_informe").exists())
        traduccion = Path("var/actualizacion/preparados/catalan/conjunto.json")
        self.assertEqual((self.destino / traduccion).read_bytes(), (self.raiz / traduccion).read_bytes())
        self.assertTrue((self.destino / "var/actualizacion/validados/hechos_informe/validacion.json").is_file())
        (self.raiz / "var/actualizacion/validados/hechos_informe/validacion.json").unlink()
        with self.assertRaisesRegex(ErrorFuente, "hechos_informe/validacion.json"):
            generacion.exportar_generacion(self.raiz, self.temporal / "sin admisión editorial", REVISION)

    def test_traducciones_externas_ausentes_no_viajan_con_validacion_previa(self) -> None:
        """La admisión previa no sustituye el insumo que el validador debe poder releer."""
        shutil.rmtree(self.raiz / "var/actualizacion/preparados/catalan")
        with self.assertRaises((OSError, generacion.GeneracionInvalida)):
            self.exportar()

    def test_catalogo_admitido_viaja_y_actualiza_desde_destino_sin_originales_sin_intento(self) -> None:
        """Traslada la SQLite cerrada y reanuda HP desde sus identidades y evidencias."""
        from dataclasses import replace

        from plataforma_datos.cursos import almacen_catalogo as almacen
        from plataforma_datos.cursos import operacion_fuente
        from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
        from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as fixtures

        caso = fixtures.ActualizacionHpLifePruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        hp.preparar(caso.solicitud)
        entrada = hp.solicitud_admision(caso.solicitud.area)
        almacen.conservar(
            almacen.EntradaCatalogo(admision=entrada, sha256_admision=caso.ref(entrada.validacion_destino).sha256),
            destino=self.raiz / almacen.RUTA,
        )
        antes = huellas_del_arbol(self.raiz / almacen.RUTA)
        recibo = self.exportar()
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual(huellas_del_arbol(self.destino / almacen.RUTA), antes)
        for id in FUENTES_CATALOGO:
            self.assertFalse((self.destino / f"var/actualizacion/originales/{id}").exists())
        self.assertEqual(operacion_fuente.conocidos("hp_life", self.destino)[0]["id"], caso.entrada.id)
        adm = almacen.solicitud(self.destino / almacen.RUTA)
        siguiente = replace(
            caso.solicitud,
            admision=adm,
            sha256_admision=caso.ref(adm.validacion_destino).sha256,
            raiz_evidencias=self.destino / almacen.RUTA / "evidencias",
            recepciones=(caso.guardar_recepcion(fecha="2026-10-23T03:00:00Z"),),
            area=caso.raiz / "Siguiente desde traslado",
            corte_utc="2026-10-23T04:00:00Z",
        )
        self.assertTrue(hp.preparar(siguiente)["archivos_conservados"])
        self.assertEqual(huellas_del_arbol(self.destino / almacen.RUTA), antes)
        (self.raiz / almacen.RUTA / "catalogo.sqlite3-wal").write_bytes("transacción no cerrada".encode())
        with self.assertRaises(ValueError):
            generacion.exportar_generacion(self.raiz, self.temporal / "con WAL", REVISION)

    def test_respaldo_de_migracion_de_estado_viaja_con_su_origen_y_huella(self) -> None:
        """La transferencia no deja huérfano el original histórico ni acepta un respaldo alterado."""
        from plataforma_datos.orquestacion import migrar_estado_actualizacion as migracion
        from plataforma_datos.orquestacion.pruebas.test_migrar_estado_actualizacion import historico

        ruta = self.raiz / generacion.ESTADO
        documento = historico()
        documento["actualizacion"]["informe"] = f"{CARPETA_DE_INFORMES}/2026-10-01-000000.md"
        ruta.write_text(json.dumps(documento), encoding="utf-8")
        original = ruta.read_bytes()
        huella = sha256(ruta)
        migracion.migrar(self.raiz, sha256_estado=huella)
        respaldo = migracion._respaldo(self.raiz, huella)
        relativo = respaldo.relative_to(self.raiz)
        recibo = self.exportar()
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual((self.destino / relativo).read_bytes(), original)
        self.assertEqual((self.destino / generacion.ESTADO).read_bytes(), ruta.read_bytes())
        migracion.migrar(self.destino, sha256_estado=huella)
        respaldo.write_bytes(b"respaldo alterado")
        with self.assertRaises(generacion.GeneracionInvalida):
            generacion.exportar_generacion(self.raiz, self.temporal / "otro-bundle", REVISION)

    def test_observaciones_biblioteca_se_respaldan_y_restauran_con_su_huella(self) -> None:
        """El auxiliar nuevo no entra en el manifiesto ocupacional y viaja íntegro con la generación."""
        relativa = "datos/observaciones-lecturas.json"
        contenido = b'{"version":1,"verificados":0,"objetivos":[]}'
        (self.raiz / relativa).write_bytes(contenido)
        manifiesto_ocupacional = (self.raiz / "datos/manifiesto.json").read_bytes()
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        entrada = next(r for r in manifiesto["archivos"] if r["ruta"] == relativa)
        self.assertEqual(entrada["sha256"], sha256(self.raiz / relativa))
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual((self.destino / relativa).read_bytes(), contenido)
        self.assertEqual((self.destino / "datos/manifiesto.json").read_bytes(), manifiesto_ocupacional)
        (self.bundle / "contenido" / relativa).write_bytes(b'{"verificados":75}')
        with self.assertRaises((ValueError, ErrorFuente)):
            generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])

    def test_entrega_sin_observaciones_no_fabrica_fechas_al_respaldar(self) -> None:
        """El auxiliar todavía no activado conserva su ausencia, no una comprobación vacía."""
        relativa = "datos/observaciones-lecturas.json"
        self.assertFalse((self.raiz / relativa).exists())
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        self.assertNotIn(relativa, {r["ruta"] for r in manifiesto["archivos"]})
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertFalse((self.destino / relativa).exists())

    def test_revision_y_huella_de_confianza_son_argumentos_obligatorios(self) -> None:
        """El contenido no se autoriza a sí mismo ni cambia la revisión esperada."""
        recibo = self.exportar()
        for revision, huella in ((OTRA_REVISION, recibo["sha256Manifiesto"]), (REVISION, "0" * 64)):
            with self.subTest(revision=revision), self.assertRaises((ValueError, ErrorFuente)):
                generacion.verificar_generacion(self.bundle, revision, huella)

    def test_excluye_secretos_microdatos_y_archivos_no_declarados(self) -> None:
        """La exportación selecciona entradas y no copia el resto de la instalación."""
        escribir(self.raiz, "var/actualizacion/originales/encuestas-isco4/no-autorizado.json", {"microdato": True})
        escribir(self.raiz, "var/actualizacion/originales/esco/no-declarado.json", {"privado": True})
        escribir(self.raiz, "var/actualizacion/validados/encuestas-isco4/no-autorizado.json", {"microdato": True})
        (self.raiz / ".dev.vars").write_text("NO-EXPORTAR", encoding="utf-8")
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        nombres = {r["ruta"] for r in manifiesto["archivos"]}
        self.assertFalse(any("no-autorizado" in n or "no-declarado" in n or ".dev.vars" in n for n in nombres))

    def test_ausencia_original_de_estado_se_preserva_sin_fabricar_intentos(self) -> None:
        """Una instalación sin intentos conserva su ausencia exacta y verificable."""
        (self.raiz / generacion.ESTADO).unlink()
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        self.assertIsNone(manifiesto["estadoSha256"])
        self.assertNotIn(generacion.ESTADO, {r["ruta"] for r in manifiesto["archivos"]})
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertFalse((self.destino / generacion.ESTADO).exists())
        escribir(self.bundle / "contenido", generacion.ESTADO, {})
        with self.assertRaises(ValueError):
            generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])

    def test_registro_remoto_opcional_se_transfiere_integro_y_bajo_manifiesto(self) -> None:
        """La generación nueva preserva el registro privado sin añadir campos al manifiesto v1."""
        ahora = datetime(2026, 10, 17, 12, tzinfo=UTC)
        with cerrojo(self.raiz):
            ciclo = comprobaciones.iniciar_ciclo(self.raiz, ahora, "programada")
            comprobaciones.cerrar_ciclo(self.raiz, ciclo, ahora, resultado="preparado", paquete_preparado=True)
        contenido = (self.raiz / comprobaciones.ARCHIVO).read_bytes()
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        entrada = next(r for r in manifiesto["archivos"] if r["ruta"] == comprobaciones.ARCHIVO)
        self.assertEqual(entrada["sha256"], sha256(self.raiz / comprobaciones.ARCHIVO))
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual((self.destino / comprobaciones.ARCHIVO).read_bytes(), contenido)
        self.assertEqual(comprobaciones.leer_registro(self.destino), comprobaciones.leer_registro(self.raiz))

    def test_cuarentena_viaja_al_exportar_y_al_restaurar(self) -> None:
        """Lo que conserva su versión anterior y las aceptaciones pendientes llegan íntegros al destino."""
        registro = {
            "version": 1,
            "archivos": {
                "cambra.json": {
                    "grupo": ["cambra.json"],
                    "perdidas": [{"archivo": "cambra.json", "medida": "entradas", "antes": 5, "despues": 2}],
                    "desde_utc": "2026-11-13T06:00:00+00:00",
                    "ultima_utc": "2026-11-14T06:00:00+00:00",
                    "vigente_sha256": "a" * 64,
                    "exportado_sha256": "b" * 64,
                    "aceptada_utc": None,
                }
            },
        }
        escribir(self.raiz, generacion.CUARENTENA, registro)
        contenido = (self.raiz / generacion.CUARENTENA).read_bytes()
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        self.assertIn(generacion.CUARENTENA, {r["ruta"] for r in manifiesto["archivos"]})
        generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual((self.destino / generacion.CUARENTENA).read_bytes(), contenido)

    def test_cuarentena_rota_no_se_traslada(self) -> None:
        """Un estado de cuarentena defectuoso impide exportar la generación."""
        escribir(self.raiz, generacion.CUARENTENA, {"version": 1, "archivos": {"cambra.json": {}}})
        with self.assertRaises(generacion.GeneracionInvalida):
            generacion._seleccion(self.raiz)
        (self.raiz / generacion.CUARENTENA).write_text("{no es json", encoding="utf-8")
        with self.assertRaises(generacion.GeneracionInvalida):
            generacion._seleccion(self.raiz)

    def test_registro_ausente_no_se_fabrica_y_presente_corrupto_rechaza(self) -> None:
        """El legado conserva ausencia; la nueva presencia se valida antes de exportar."""
        self.assertFalse((self.raiz / comprobaciones.ARCHIVO).exists())
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        self.assertNotIn(comprobaciones.ARCHIVO, {r["ruta"] for r in manifiesto["archivos"]})
        ruta = self.raiz / comprobaciones.ARCHIVO
        ruta.write_text("{}", encoding="utf-8")
        with self.assertRaises(ValueError):
            generacion._seleccion(self.raiz)

    def test_estado_presente_roto_y_historial_faltante_rechazan(self) -> None:
        """Un estado presente inválido no se convierte en ausencia ni en un historial vacío."""
        ruta = self.raiz / generacion.ESTADO
        original = ruta.read_bytes()
        for contenido in (b"null", b"{}"):
            with self.subTest(contenido=contenido):
                ruta.write_bytes(contenido)
                with self.assertRaises((OSError, ValueError, ErrorFuente)):
                    self.exportar()
                self.assertFalse(self.bundle.exists())
                ruta.write_bytes(original)
        (self.raiz / generacion.HISTORIAL).unlink()
        with self.assertRaises(OSError):
            self.exportar()

    def test_contenedor_de_esco_no_exige_sus_paginas_como_archivos_sueltos(self) -> None:
        """La captura original vincula sus entradas mediante la huella del contenedor registrado."""
        base = "var/actualizacion/originales/esco"
        archivo = self.raiz / base / "biblioteca-api.zip"
        archivo.write_bytes(b"captura fixture")
        escribir(
            self.raiz,
            f"{base}/procedencia.json",
            {
                "archivo": archivo.name,
                "sha256": sha256(archivo),
                "fecha": "2026-10-01",
                "entradas": [{"archivo": "occupation-000.json", "sha256": "a" * 64}],
            },
        )
        recibo = self.exportar()
        manifiesto = generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])
        nombres = {r["ruta"] for r in manifiesto["archivos"]}
        self.assertIn(f"{base}/biblioteca-api.zip", nombres)
        self.assertNotIn(f"{base}/occupation-000.json", nombres)
        archivo.unlink()
        with self.assertRaises(OSError):
            generacion._seleccion(self.raiz)

    def test_original_faltante_o_otra_edicion_no_se_descarga(self) -> None:
        """Las entradas declaradas se exigen localmente con su SHA vigente."""
        ruta = self.raiz / "var/actualizacion/originales/esco/edición.json"
        original = ruta.read_bytes()
        for contenido in (None, b"otra edicion"):
            with self.subTest(contenido=contenido):
                if contenido is None:
                    ruta.unlink()
                else:
                    ruta.write_bytes(contenido)
                with self.assertRaises((OSError, ValueError, ErrorFuente)):
                    self.exportar()
                ruta.write_bytes(original)
        self.assertFalse(self.bundle.exists())

    def test_recuperacion_pendiente_y_bloqueo_rechazan_sin_limpiar(self) -> None:
        """La herramienta no repara diarios ni retira respaldos de otra operación."""
        diario = self.raiz / CARPETA_DE_INFORMES / "diario-paquete.json"
        diario.write_text('{"fase":"preparado"}', encoding="utf-8")
        with self.assertRaises(ValueError):
            self.exportar()
        self.assertTrue(diario.exists())
        diario.unlink()
        with cerrojo(self.raiz), self.assertRaises(RuntimeError):
            self.exportar()
        self.assertFalse(self.bundle.exists())

    def test_cli_cerrojo_ocupado_error_generico_y_sin_destino(self) -> None:
        """El conflicto esperado se comunica sin traceback ni rutas internas."""
        with cerrojo(self.raiz), redirect_stdout(io.StringIO()) as salida, redirect_stderr(io.StringIO()) as errores:
            codigo = generacion.main(
                [
                    "exportar",
                    str(self.raiz),
                    "--destino",
                    str(self.bundle),
                    "--revision-codigo",
                    REVISION,
                ]
            )
        self.assertEqual(codigo, 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertEqual(errores.getvalue(), generacion.ERROR_GENERICO + "\n")
        self.assertFalse(self.bundle.exists())

    def test_destino_existente_y_solapado_no_se_tocan(self) -> None:
        """No hay force, merge ni promoción sobre una raíz existente."""
        recibo = self.exportar()
        self.destino.mkdir()
        testigo = self.destino / "conservar"
        testigo.write_text("igual", encoding="utf-8")
        with self.assertRaises(ValueError):
            generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual(testigo.read_text(), "igual")
        with self.assertRaises(ValueError):
            generacion.exportar_generacion(self.raiz, self.raiz / "interna", REVISION)

    def test_fallo_copia_no_deja_destino_ni_staging(self) -> None:
        """Una copia interrumpida retira solo el temporal de esta invocación."""
        original = generacion.shutil.copyfile
        llamadas = 0

        def interrumpir(origen: Path, destino: Path, *, follow_symlinks: bool) -> Path:
            nonlocal llamadas
            llamadas += 1
            if llamadas % 2 == 0:
                raise OSError("fallo tras copiar un archivo")
            return original(origen, destino, follow_symlinks=follow_symlinks)

        antes = set(self.temporal.iterdir())
        with mock.patch.object(generacion.shutil, "copyfile", side_effect=interrumpir), self.assertRaises(OSError):
            self.exportar()
        self.assertEqual(set(self.temporal.iterdir()), antes)
        recibo = self.exportar()
        antes = set(self.temporal.iterdir())
        with mock.patch.object(generacion.shutil, "copyfile", side_effect=interrumpir), self.assertRaises(OSError):
            generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_enlaces_hardlinks_y_fifo_rechazados(self) -> None:
        """El archivo debe ser propio y regular, no una referencia a otro lugar."""
        ruta = self.raiz / "datos/uno.json"
        original = ruta.read_bytes()
        otro = self.temporal / "otro.json"
        otro.write_bytes(original)
        for tipo in ("symlink", "hardlink", "fifo"):
            with self.subTest(tipo=tipo):
                ruta.unlink()
                if tipo == "symlink":
                    ruta.symlink_to(otro)
                elif tipo == "hardlink":
                    os.link(otro, ruta)
                else:
                    os.mkfifo(ruta)
                with self.assertRaises(ValueError):
                    self.exportar()
                ruta.unlink()
                ruta.write_bytes(original)

    def test_traversal_extras_duplicados_y_tamanos_rechazan(self) -> None:
        """Una huella externa correcta no hace válido un esquema o inventario ajeno."""
        self.exportar()
        ruta = self.bundle / "manifiesto.json"
        original = ruta.read_text()
        for relativa in ("../fuera", "/absoluta", "datos\\uno.json", "C:/archivo", "datos//uno.json"):
            with self.subTest(ruta=relativa):
                manifiesto = json.loads(original)
                manifiesto["archivos"][0]["ruta"] = relativa
                ruta.write_text(json.dumps(manifiesto), encoding="utf-8")
                with self.assertRaises(ValueError):
                    generacion.verificar_generacion(self.bundle, REVISION, sha256(ruta))
        for defecto in ("extra", "duplicado", "booleano", "estado"):
            with self.subTest(defecto=defecto):
                manifiesto = json.loads(original)
                if defecto == "extra":
                    manifiesto["libre"] = "no admitido"
                elif defecto == "duplicado":
                    manifiesto["archivos"].append(manifiesto["archivos"][0])
                elif defecto == "booleano":
                    manifiesto["archivos"][0]["bytes"] = True
                else:
                    manifiesto["estadoSha256"] = None
                ruta.write_text(json.dumps(manifiesto), encoding="utf-8")
                with self.assertRaises(ValueError):
                    generacion.verificar_generacion(self.bundle, REVISION, sha256(ruta))
        ruta.write_text(original, encoding="utf-8")
        with mock.patch.object(generacion, "MAX_TOTAL_BYTES", 1), self.assertRaises(ValueError):
            generacion.verificar_generacion(self.bundle, REVISION, sha256(ruta))

    def test_archivo_extra_faltante_o_alterado_no_se_restaura(self) -> None:
        """El manifiesto corresponde al árbol exacto, incluido lo no declarado."""
        recibo = self.exportar()
        ruta = self.bundle / "contenido/datos/uno.json"
        original = ruta.read_bytes()
        for contenido in (None, b"alterado"):
            with self.subTest(contenido=contenido):
                if contenido is None:
                    ruta.unlink()
                else:
                    ruta.write_bytes(contenido)
                with self.assertRaises((OSError, ValueError, ErrorFuente)):
                    generacion.restaurar_generacion(self.bundle, self.destino, REVISION, recibo["sha256Manifiesto"])
                self.assertFalse(self.destino.exists())
                ruta.write_bytes(original)
        escribir(self.bundle / "contenido", "var/actualizacion/originales/encuestas-isco4/extra.json", {})
        with self.assertRaises(ValueError):
            generacion.verificar_generacion(self.bundle, REVISION, recibo["sha256Manifiesto"])

    def test_cli_error_generico_y_origen_conservado(self) -> None:
        """El recibo y el error no contienen rutas internas; exportar no cambia los bytes de datos/estado."""
        antes = huellas_del_arbol(self.raiz)
        with redirect_stdout(io.StringIO()) as salida:
            self.assertEqual(
                generacion.main(
                    ["exportar", str(self.raiz), "--destino", str(self.bundle), "--revision-codigo", REVISION]
                ),
                0,
            )
        recibo = json.loads(salida.getvalue())
        despues = huellas_del_arbol(self.raiz)
        despues.pop(f"{CARPETA_DE_INFORMES}/.cerrojo", None)
        self.assertEqual(antes, despues)
        with redirect_stderr(io.StringIO()) as errores:
            self.assertEqual(
                generacion.main(
                    [
                        "verificar",
                        str(self.bundle),
                        "--revision-codigo",
                        OTRA_REVISION,
                        "--sha256-manifiesto",
                        recibo["sha256Manifiesto"],
                    ]
                ),
                1,
            )
        self.assertEqual(errores.getvalue(), generacion.ERROR_GENERICO + "\n")


if __name__ == "__main__":
    unittest.main()
