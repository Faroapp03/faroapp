"""Contrato de la instantánea administrativa: lectura real sin mutaciones y fallos cerrados sin diagnóstico sensible."""

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.cursos.pruebas.test_abierta import documento as fichas_abiertas
from plataforma_datos.ia_y_trabajo.fuentes.tich.ediciones import edicion_del_catalogo
from plataforma_datos.ia_y_trabajo.pruebas.test_ediciones_tich import catalogo as catalogo_tich
from plataforma_datos.orquestacion import almacen_trabajos
from plataforma_datos.orquestacion import estado_panel as panel
from plataforma_datos.orquestacion.estado_de_la_actualizacion import SIN_INTENTO
from plataforma_datos.orquestacion.estado_de_los_datos import plazo, revision_pendiente_de_la_formacion_abierta
from plataforma_datos.orquestacion.instantanea_del_recibo import validar_instantanea
from plataforma_datos.orquestacion.modulos import IDS
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES, fecha_de_la_fuente

AHORA = datetime(2026, 10, 18, 12, tzinfo=UTC)
ANTES = "2026-10-16T10:00:00+00:00"
DESPUES = "2026-10-17T10:00:00+00:00"
HUELLA = "a" * 64


def documento() -> dict:
    """Construye el formato exacto del escritor vigente con todos sus módulos.

    Returns:
        Estado interno de prueba, con un módulo fallido y otro verde.
    """
    modulos = {nombre: dict(SIN_INTENTO) for nombre in IDS}
    modulos["consorci"] = {
        "ultimo_intento_utc": ANTES,
        "veredicto": "ámbar",
        "motivo": "/privado/secreto",
        "ultima_version_buena": {"publicada_utc": ANTES, "huella": HUELLA},
        "fallos_seguidos": 1,
        "proximo_reintento_utc": DESPUES,
    }
    modulos["paquete"] = {**SIN_INTENTO, "ultimo_intento_utc": ANTES, "veredicto": "verde"}
    return {
        "version": 5,
        "origen_migracion": None,
        "actualizacion": {
            "huella_resultados": "b" * 64,
            "integridad_resultados": "huella_conservada",
            "comienzo_utc": ANTES,
            "veredicto": "ámbar (/privado/secreto)",
            "informe": "/privado/secreto",
        },
        "modulos": modulos,
    }


class PruebaInstanteUtcDelPanel(unittest.TestCase):
    """La migración y el lector comparten la frontera temporal del panel."""

    def test_instante_utc_y_entradas_invalidas(self) -> None:
        """Convierte un instante UTC válido y rechaza zonas, formatos y tipos ajenos."""
        instante = panel.instante_utc("2026-10-23T20:00:01Z")
        self.assertEqual(instante.isoformat(), "2026-10-23T20:00:01+00:00")
        for valor in (None, "", "2026-10-23", "2026-10-23T20:00:01+01:00"):
            with self.subTest(valor=valor), self.assertRaises(panel.EstadoPanelInvalido):
                panel.instante_utc(valor)


class PruebaEstadoPanel(unittest.TestCase):
    """Productor v2 frente a datos operativos y documentos defectuosos."""

    def setUp(self) -> None:
        """Prepara solo una instalación sintética portátil fuera del producto."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        fichas = self.raiz / "var" / "actualizacion" / "preparados" / "abierta" / "fichas.json"
        fichas.parent.mkdir(parents=True)
        fichas.write_text('{"fichas": [], "plataformas": {}}', encoding="utf-8")
        self.ruta = self.raiz / CARPETA_DE_INFORMES / "estado.json"
        self.ruta.parent.mkdir()

    def guardar(self, valor: object) -> None:
        """Escribe un documento de prueba en el área propia."""
        self.ruta.write_text(json.dumps(valor), encoding="utf-8")

    def test_ausente_da_defaults_completos_sin_crear_archivo(self) -> None:
        """Solo la ausencia real admite SIN_INTENTO y conserva todos los IDs."""
        estado = panel.estado_panel(self.raiz, AHORA)
        self.assertEqual(estado["observadoEn"], "2026-10-18T12:00:00Z")
        self.assertEqual([f["id"] for f in estado["fuentes"]], list(FUENTES))
        self.assertEqual([m["id"] for m in estado["modulos"]], list(IDS))
        self.assertTrue(all(m["veredicto"] is None and m["fallos"] == 0 for m in estado["modulos"]))
        self.assertFalse(self.ruta.exists())
        self.assertIsNone(estado["formacionAbiertaRevisionPendiente"])

    def test_la_edicion_nueva_de_la_tich_llega_a_su_fila_solo_cuando_se_observa(self) -> None:
        """Con la observación en la procedencia, la fila de la TIC-H la lleva; sin ella, la fila no cambia de forma.

        Una observación mal formada, que no casa con su catálogo o posterior a la instantánea no se pinta: esa fila
        queda sin la edición nueva y con su aviso, y el resto de la instantánea sigue.
        """
        cuerpo = catalogo_tich(2026, 2025).encode()
        procedencia = self.raiz / "var" / "actualizacion" / "originales" / "tich" / "procedencia.json"
        procedencia.parent.mkdir(parents=True)
        observada = {
            "estado": "publicada-sin-microdatos",
            "anio": "2026",
            "observado_utc": "2026-10-17T22:30:00.123456+00:00",
            "sha256_catalogo": sha256_bytes(cuerpo),
        }
        base = {
            "archivos": [],
            "edicion": edicion_del_catalogo(cuerpo.decode()),
            "descubrimiento": [{"archivo": "ine-tich-resultados.html", "sha256": sha256_bytes(cuerpo)}],
        }

        def fila(contenido: dict) -> dict:
            procedencia.write_text(json.dumps(contenido), encoding="utf-8")
            estado = panel.estado_panel(self.raiz, AHORA)
            validar_instantanea(estado)
            return next(f for f in estado["fuentes"] if f["id"] == "tich")

        self.assertEqual(
            fila({**base, "edicion_nueva": observada})["edicionNueva"],
            {
                "estado": "publicada-sin-microdatos",
                "anio": "2026",
                "observadoEn": "2026-10-17T22:30:00Z",
                "huellaCatalogo": sha256_bytes(cuerpo),
            },
        )
        actual = catalogo_tich().encode()
        sin_observacion = {
            **base,
            "edicion": edicion_del_catalogo(actual.decode()),
            "descubrimiento": [{"archivo": "ine-tich-resultados.html", "sha256": sha256_bytes(actual)}],
        }
        descartada = fila({**base, "edicion_nueva": observada, "edicion_nueva_descartada": "TIC-H: mal formada"})
        self.assertEqual(descartada["avisoEdicion"], "observacion-anterior-descartada")
        self.assertIn("edicionNueva", descartada)
        limpia = fila(sin_observacion)
        self.assertNotIn("edicionNueva", limpia)
        self.assertNotIn("avisoEdicion", limpia)
        for mala in (
            {**base, "edicion_nueva": {**observada, "anio": "2026x"}},
            {**base, "edicion_nueva": {**observada, "observado_utc": "2026-10-19T00:00:00+00:00"}},
            base,
        ):
            with self.subTest(mala=mala):
                con_aviso = fila(mala)
                self.assertNotIn("edicionNueva", con_aviso)
                self.assertEqual(con_aviso["avisoEdicion"], "edicion-no-verificable")

    def test_los_grupos_que_la_tich_da_en_su_gran_grupo_se_avisan_en_su_fila(self) -> None:
        """Si la EPA no confirma algún grupo, la fila de la TIC-H dice cuántos se dan en su gran grupo; si no, nada."""
        validado = self.raiz / "var" / "actualizacion" / "validados" / "tich" / "tich.json"
        validado.parent.mkdir(parents=True)
        for bajados, esperado in (({"26": "reparto-distinto-de-la-epa"}, 1), ({}, None)):
            with self.subTest(bajados=bajados):
                validado.write_text(json.dumps({"grupos_en_su_gran_grupo": bajados}), encoding="utf-8")
                estado = panel.estado_panel(self.raiz, AHORA)
                validar_instantanea(estado)
                fila = next(f for f in estado["fuentes"] if f["id"] == "tich")
                self.assertEqual(fila.get("gruposEnSuGranGrupo"), esperado)

    def test_tic_llars_validada_sin_contraste_lleva_su_aviso_en_el_panel(self) -> None:
        """Con la TIC-H de otra edición, la fila de TIC a les llars lo dice; con la misma, no lleva aviso."""
        validado = self.raiz / "var" / "actualizacion" / "validados" / "tic_llars" / "tic_llars.json"
        validado.parent.mkdir(parents=True)
        for contenido, esperado in (
            (json.dumps({"contraste_con_la_tich": "edicion-distinta"}), "sin-contraste-con-la-tich"),
            (json.dumps({"contraste_con_la_tich": "misma-edicion"}), None),
            (json.dumps({"contraste_con_la_tich": "motivo-sin-calculo"}), "sin-contraste-del-motivo"),
            ('{"contraste_con_la_tich": "edicion-dis', None),
            ("", None),
        ):
            with self.subTest(contenido=contenido):
                validado.write_text(contenido, encoding="utf-8")
                estado = panel.estado_panel(self.raiz, AHORA)
                validar_instantanea(estado)
                fila = next(f for f in estado["fuentes"] if f["id"] == "tic_llars")
                self.assertEqual(fila.get("avisoEdicion"), esperado)

    def test_v5_publica_la_revision_pendiente_con_su_nombre_y_acepta_recibos_v4(self) -> None:
        """La v5 solo renombra la clave: un recibo v4 con el nombre antiguo sigue valiendo; mezclarlos, no."""
        self.guardar(documento())
        estado = panel.estado_panel(self.raiz, AHORA)
        self.assertEqual(estado["version"], 5)
        self.assertIn("formacionAbiertaRevisionPendiente", estado)
        self.assertNotIn("formacionAbiertaCaduca", estado)
        validar_instantanea(estado)
        anterior = {
            ("formacionAbiertaCaduca" if k == "formacionAbiertaRevisionPendiente" else k): v for k, v in estado.items()
        }
        validar_instantanea({**anterior, "version": 4})
        for mezcla in ({**anterior, "version": 5}, {**estado, "version": 4}):
            with self.subTest(version=mezcla["version"]), self.assertRaises(almacen_trabajos.AlmacenTrabajoInvalido):
                validar_instantanea(mezcla)

    def test_proyecta_sin_motivo_informe_o_campos_libres(self) -> None:
        """El archivo se lee una vez y no salen los textos privados que contiene."""
        self.guardar(documento())
        with mock.patch.object(panel, "_leer_registro", wraps=panel._leer_registro) as leer:
            estado = panel.estado_panel(self.raiz, AHORA)
        leer.assert_called_once_with(self.raiz)
        self.assertNotIn("privado", json.dumps(estado))
        modulo = next(m for m in estado["modulos"] if m["id"] == "consorci")
        self.assertEqual(modulo["ultimoIntento"], "2026-10-16T10:00:00Z")
        self.assertEqual(modulo["ultimaVersionBuena"], {"fecha": "2026-10-16T10:00:00Z", "huella": HUELLA})
        self.assertEqual(modulo["proximoReintento"], "2026-10-17T10:00:00Z")

    def test_v5_misma_proyeccion_y_huella_estricta_sin_reescribir(self) -> None:
        """La procedencia del replay es interna: el DTO público conserva su contrato y guardas."""
        self.guardar(documento())
        anterior = panel.estado_panel(self.raiz, AHORA)
        nuevo = documento()
        nuevo["version"] = 5
        nuevo["actualizacion"]["huella_resultados"] = "b" * 64
        self.guardar(nuevo)
        antes = self.ruta.read_bytes()
        self.assertEqual(panel.estado_panel(self.raiz, AHORA), anterior)
        self.assertEqual(self.ruta.read_bytes(), antes)
        for huella in (None, "b" * 63, "B" * 64, True):
            with self.subTest(huella=huella):
                nuevo["actualizacion"]["huella_resultados"] = huella
                self.guardar(nuevo)
                with self.assertRaises(panel.EstadoPanelInvalido):
                    panel.estado_panel(self.raiz, AHORA)
        del nuevo["actualizacion"]["huella_resultados"]
        self.guardar(nuevo)
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)

    def test_archivo_presente_incompleto_o_ids_ajenos_no_se_reparan(self) -> None:
        """Documento vacío, módulo perdido o desconocido y campos extra fallan cerrados."""
        incompleto, ajeno, extra = (documento() for _ in range(3))
        del incompleto["modulos"]["esco"]
        ajeno["modulos"]["../privado"] = dict(SIN_INTENTO)
        extra["modulos"]["esco"]["ruta"] = "privado"
        for valor in (None, {}, [], {"modulos": {}}, incompleto, ajeno, extra):
            with self.subTest(valor=type(valor)):
                self.guardar(valor)
                with self.assertRaises(panel.EstadoPanelInvalido):
                    panel.estado_panel(self.raiz, AHORA)

    def test_registros_anteriores_exigen_migracion_explicita_sin_reescribir(self) -> None:
        """El panel no incluye ya un lector histórico ni añade módulos durante una consulta."""
        from plataforma_datos.orquestacion.pruebas.test_migrar_estado_actualizacion import historico

        for version in (None, 2, 3, 4):
            with self.subTest(version=version):
                self.guardar(historico(version))
                antes = self.ruta.read_bytes()
                with self.assertRaises(panel.EstadoPanelInvalido):
                    panel.estado_panel(self.raiz, AHORA)
                self.assertEqual(self.ruta.read_bytes(), antes)

    def test_migrado_conserva_la_proyeccion_publica_sin_falsos_intentos(self) -> None:
        """La procedencia y huella desconocidas permanecen internas; los hechos no se renuevan."""
        from plataforma_datos.orquestacion import migrar_estado_actualizacion as migracion
        from plataforma_datos.orquestacion.pruebas.test_migrar_estado_actualizacion import historico

        migrado = migracion._convertir(historico(), "a" * 64)
        self.guardar(migrado)
        antes = self.ruta.read_bytes()
        snapshot = panel.estado_panel(self.raiz, AHORA)
        modulos = {m["id"]: m for m in snapshot["modulos"]}
        self.assertEqual(modulos["consorci"]["ultimoIntento"], "2026-10-16T10:00:00Z")
        self.assertEqual(modulos["consorci"]["fallos"], 1)
        for nombre in ("lecturas", "enlaces_lecturas"):
            self.assertIsNone(modulos[nombre]["ultimoIntento"])
            self.assertIsNone(modulos[nombre]["veredicto"])
        self.assertNotIn("origen_migracion", json.dumps(snapshot))
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_registro_versionado_no_repara_un_modulo_perdido(self) -> None:
        """La excepción de migración no acepta perder Biblioteca después de versionar."""
        datos = {"version": 3, **documento()}
        self.guardar(datos)
        self.assertEqual(len(panel.estado_panel(self.raiz, AHORA)["modulos"]), len(IDS))
        del datos["modulos"]["lecturas"]
        self.guardar(datos)
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)

    def test_registro_sin_version_no_admite_inventario_nuevo(self) -> None:
        """El inventario legado es fijo; no hereda los módulos de versiones futuras."""
        datos = documento()
        del datos["version"]
        self.guardar(datos)
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)

    def test_version_del_registro_desconocida_se_rechaza(self) -> None:
        """El lector no adivina contratos nuevos ni confunde booleanos con versiones."""
        for version in (1, 6, True, "5", None):
            with self.subTest(version=version):
                self.guardar({**documento(), "version": version})
                with self.assertRaises(panel.EstadoPanelInvalido):
                    panel.estado_panel(self.raiz, AHORA)

    def test_fechas_y_coherencia_del_modulo_son_estrictas(self) -> None:
        """No se admiten futuros, UTC inválido, huellas falsas ni contadores booleanos."""
        cambios = [
            ("ultimo_intento_utc", "2026-02-30T10:00:00Z"),
            ("ultimo_intento_utc", "2026-10-16"),
            ("ultimo_intento_utc", "2026-10-16T10:00:00+01:00"),
            ("ultimo_intento_utc", "2026-10-19T10:00:00Z"),
            ("fallos_seguidos", True),
            ("fallos_seguidos", -1),
            ("veredicto", "error privado"),
            ("veredicto", "verde"),
            ("proximo_reintento_utc", ANTES),
            ("ultima_version_buena", {"publicada_utc": DESPUES, "huella": HUELLA}),
            ("ultima_version_buena", {"publicada_utc": ANTES, "huella": "secreto"}),
        ]
        for campo, valor in cambios:
            with self.subTest(campo=campo, valor=valor):
                datos = documento()
                datos["modulos"]["consorci"][campo] = valor
                self.guardar(datos)
                with self.assertRaises(panel.EstadoPanelInvalido):
                    panel.estado_panel(self.raiz, AHORA)
        datos = documento()
        datos["modulos"]["esco"]["fallos_seguidos"] = False
        self.guardar(datos)
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)

    def test_json_invalido_duplicado_no_finito_y_desmedido_no_da_defaults(self) -> None:
        """La lectura de estado está acotada y JSON ambiguo o roto se rechaza."""
        for contenido in (b"{", b'{"modulos":{},"modulos":{}}', b'{"x":NaN}', b" " * (panel.MAX_ESTADO_BYTES + 1)):
            with self.subTest(bytes=len(contenido)):
                self.ruta.write_bytes(contenido)
                with self.assertRaises(panel.EstadoPanelInvalido):
                    panel.estado_panel(self.raiz, AHORA)

    def test_symlink_archivo_directorio_o_fifo_no_se_lee(self) -> None:
        """Enlaces, directorios y FIFO fallan sin bloquear ni aparecer como estado ausente."""
        destino = self.raiz / "otro.json"
        destino.write_text(json.dumps(documento()), encoding="utf-8")
        self.ruta.symlink_to(destino)
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)
        self.ruta.unlink()
        self.ruta.mkdir()
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)
        self.ruta.rmdir()
        os.mkfifo(self.ruta)
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)
        self.ruta.unlink()
        self.ruta.parent.rmdir()
        self.ruta.parent.symlink_to(self.raiz / "ausente")
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)

    def test_fecha_original_y_reloj_invalidos_fallan_sin_reparar(self) -> None:
        """Las fechas de procedencia se comprueban con la regla original y un reloj UTC."""
        carpeta = self.raiz / "var" / "actualizacion" / "originales" / "cambra"
        carpeta.mkdir(parents=True)
        ruta = carpeta / "procedencia.json"
        ruta.write_text('{"fecha":"2026-02-30"}', encoding="utf-8")
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA)
        ruta.unlink()
        with self.assertRaises(panel.EstadoPanelInvalido):
            panel.estado_panel(self.raiz, AHORA.replace(tzinfo=None))

    def comprobar_conservacion(self, raiz: Path, ahora: datetime) -> None:
        """Contrasta los bytes presentes y la ausencia, con fechas según las reglas reales."""
        fichas = raiz / "var" / "actualizacion" / "preparados" / "abierta" / "fichas.json"
        estado = raiz / CARPETA_DE_INFORMES / "estado.json"
        archivos = [*sorted((raiz / "var" / "actualizacion").glob("originales/*/procedencia.json")), fichas, estado]
        antes = {r: r.read_bytes() if r.exists() else None for r in archivos}
        observado = None
        if antes[fichas] is None:
            with self.assertRaises(panel.EstadoPanelInvalido):
                panel.estado_panel(raiz, ahora)
        else:
            observado = panel.estado_panel(raiz, ahora)
        despues = {r: r.read_bytes() if r.exists() else None for r in archivos}
        self.assertEqual(antes, despues)
        if observado is not None:
            self.assertEqual(
                observado["formacionAbiertaRevisionPendiente"],
                revision_pendiente_de_la_formacion_abierta(raiz, ahora.date()),
            )
            for fila in observado["fuentes"]:
                fecha = fecha_de_la_fuente(raiz, fila["id"])
                self.assertEqual(fila["fecha"], fecha.isoformat() if fecha else None)
                self.assertEqual(fila["plazoDias"], plazo(fila["id"]))

    def test_datos_conservados_y_mismas_fechas_reglas(self) -> None:
        """Una instalación aislada conserva las entradas y proyecta sus fechas y revisión pendiente."""
        fichas = self.raiz / "var" / "actualizacion" / "preparados" / "abierta" / "fichas.json"
        fichas.write_text(json.dumps(fichas_abiertas()), encoding="utf-8")
        for fuente, fecha in (("cambra", "2026-10-12"), ("epa", "2026-10-15")):
            procedencia = self.raiz / "var" / "actualizacion" / "originales" / fuente / "procedencia.json"
            procedencia.parent.mkdir(parents=True)
            procedencia.write_text(json.dumps({"fecha": fecha}), encoding="utf-8")
        self.guardar(documento())
        self.comprobar_conservacion(self.raiz, AHORA)
        estado = panel.estado_panel(self.raiz, AHORA)
        fechas = {fila["id"]: fila["fecha"] for fila in estado["fuentes"]}
        self.assertEqual(fechas["cambra"], "2026-10-12")
        self.assertEqual(fechas["epa"], "2026-10-15")
        self.assertIsNone(fechas["eaes"])
        self.assertEqual(estado["formacionAbiertaRevisionPendiente"], "2027-01-05")
        self.assertEqual(next(m for m in estado["modulos"] if m["id"] == "consorci")["veredicto"], "ámbar")

    def test_raiz_con_var_enlazado_se_rechaza_sin_leer_destino(self) -> None:
        """Un enlace en cualquier componente de la ruta del registro falla cerrado."""
        self.guardar(documento())
        antes = self.ruta.read_bytes()
        with tempfile.TemporaryDirectory(prefix="Panel enlace ") as nombre:
            raiz = Path(nombre)
            (raiz / "var").symlink_to(self.raiz / "var", target_is_directory=True)
            with mock.patch.object(panel.os, "open", wraps=panel.os.open) as abrir:
                with self.assertRaises(panel.EstadoPanelInvalido):
                    panel.estado_panel(raiz, AHORA)
                abrir.assert_not_called()
            self.assertEqual(list(raiz.iterdir()), [raiz / "var"])
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_raiz_vacia_conserva_ausencias_y_rechaza_snapshot_sin_fichas(self) -> None:
        """Un clon sin entradas operativas falla cerrado sin crear fichas, estado ni directorios."""
        with tempfile.TemporaryDirectory(prefix="CI limpia Año ") as nombre:
            raiz = Path(nombre)
            self.assertEqual(list(raiz.iterdir()), [])
            self.comprobar_conservacion(raiz, AHORA)
            self.assertEqual(list(raiz.iterdir()), [])

    def test_cli_json_o_error_generico_sin_rutas(self) -> None:
        """La salida de fallo no filtra la excepción, la carpeta ni un secreto."""
        with mock.patch.object(panel, "RAIZ", self.raiz), redirect_stdout(io.StringIO()) as salida:
            self.assertEqual(panel.main(), 0)
        self.assertEqual(json.loads(salida.getvalue())["version"], 5)
        self.ruta.write_text("privado", encoding="utf-8")
        with (
            mock.patch.object(panel, "RAIZ", self.raiz),
            redirect_stdout(io.StringIO()) as salida,
            redirect_stderr(io.StringIO()) as errores,
        ):
            self.assertEqual(panel.main(), 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertEqual(errores.getvalue(), panel.ERROR_GENERICO + "\n")


if __name__ == "__main__":
    unittest.main()
