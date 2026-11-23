"""Varios lotes conservan su tiempo de origen y se confirman juntos o ninguno."""

import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.tipos_json import ObjetoJson

LOTES_HASTA_FALLO = 2
DIA_ENTRADA_DISCREPANTE = 23


def programa(identidad: str, dia: int) -> ObjetoJson:
    """Crea un lote de una entidad observado en el día indicado.

    Returns:
        Lote individual con la identidad y observación indicadas.
    """
    lote = lote_base()
    lote["observado_utc"] = f"2026-10-{dia:02d}T08:00:00Z"
    lote["fuente_lote"] = "captura-" + identidad
    lote["proveedores"] = []
    lote["ediciones"] = []
    dato = lote["programas"][0]
    dato["id"] = identidad
    dato["titulo"] = f"{identidad} del día {dia}"
    dato["evidencias"][0]["capturado_utc"] = lote["observado_utc"]
    return lote


def publicador() -> ObjetoJson:
    """Crea únicamente la identidad estática del publicador de prueba.

    Returns:
        Lote sin programas ni ediciones, limitado al publicador.
    """
    lote = lote_base()
    lote["programas"] = []
    lote["ediciones"] = []
    lote["observado_utc"] = "2026-10-20T08:00:00Z"
    return lote


class CargaLotesTest(unittest.TestCase):
    """Transacciones de varios lotes con observaciones propias por entidad."""

    def setUp(self) -> None:
        """Prepara una candidata aislada y registra su limpieza."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.base = Path(self.temporal.name) / "candidata.sqlite"

    def test_cada_entidad_conserva_su_observacion_y_no_se_retrocede(self) -> None:
        """Regresión: cada entidad conserva su observacion y no se retrocede."""
        inicial = [publicador(), programa("A", 21), programa("B", 23)]
        resultados = catalogo.cargar_lotes(self.base, inicial)
        self.assertEqual(len(resultados), 3)
        with sqlite3.connect(self.base) as con:
            fechas = con.execute(
                "SELECT o.programa_id,e.observado_utc FROM observaciones o "
                "JOIN ejecuciones e ON o.ejecucion_id=e.id WHERE o.programa_id IS NOT NULL "
                "ORDER BY o.programa_id"
            ).fetchall()
        self.assertEqual(fechas, [("A", "2026-10-21T08:00:00Z"), ("B", "2026-10-23T08:00:00Z")])
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "última observación.*B"):
            catalogo.cargar_lotes(self.base, [publicador(), programa("A", 22), programa("B", 22)])
        self.assertEqual(self.base.read_bytes(), antes)

    def test_segunda_importacion_no_duplica_entidades_versiones_ni_evidencias(self) -> None:
        """Regresión: segunda importacion no duplica entidades versiones ni evidencias."""
        lotes = [publicador(), programa("A", 21), programa("B", 23)]
        catalogo.cargar_lotes(self.base, lotes)
        antes = catalogo.resumen(self.base)
        catalogo.cargar_lotes(self.base, lotes)
        despues = catalogo.resumen(self.base)
        for campo in ("proveedores", "programas", "ediciones", "versiones", "evidencias"):
            self.assertEqual(despues[campo], antes[campo], campo)
        self.assertEqual(despues["ejecuciones"], antes["ejecuciones"] + 3)

    def test_valida_todos_antes_de_abrir_la_base(self) -> None:
        """Regresión: valida todos antes de abrir la base."""
        invalido = programa("A", 22)
        invalido["programas"][0]["url"] = "https://127.0.0.1/"
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lotes(self.base, [publicador(), invalido])
        self.assertFalse(self.base.exists())

    def test_error_de_referencia_en_ultimo_lote_revierte_los_anteriores(self) -> None:
        """Regresión: error de referencia en ultimo lote revierte los anteriores."""
        catalogo.cargar_lotes(self.base, [publicador(), programa("A", 21)])
        antes = self.base.read_bytes()
        invalido = programa("B", 22)
        invalido["programas"][0]["proveedor_id"] = "inexistente"
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lotes(self.base, [programa("A", 22), invalido])
        self.assertEqual(self.base.read_bytes(), antes)

    def test_fallo_tras_cargar_lote_no_deja_importacion_parcial(self) -> None:
        """Regresión: fallo tras cargar lote no deja importacion parcial."""
        catalogo.cargar_lotes(self.base, [publicador(), programa("A", 21)])
        antes = self.base.read_bytes()
        original = catalogo._cargar_en_conexion
        llamadas = []

        def cargar(conexion: sqlite3.Connection, lote: ObjetoJson) -> dict[str, int]:
            """Carga las entradas con sus canales y verifica sus capturas locales.

            Returns:
                Recuentos de las importaciones confirmadas en una transacción.

            Raises:
                RuntimeError: Se alcanza el lote de fallo tras escribirlo.
            """
            resultado = original(conexion, lote)
            llamadas.append(lote)
            if len(llamadas) == LOTES_HASTA_FALLO:
                raise RuntimeError("Fallo después de escribir")
            return resultado

        with (
            patch.object(catalogo, "_cargar_en_conexion", cargar),
            self.assertRaisesRegex(RuntimeError, "después de escribir"),
        ):
            catalogo.cargar_lotes(self.base, [programa("A", 22), programa("B", 22)])
        self.assertEqual(self.base.read_bytes(), antes)

    def test_base_existente_admite_contrato_ampliado_sin_rehacerse(self) -> None:
        """Una base V10 ya poblada recibe lotes de contrato 1 y 2 en la misma transacción."""
        catalogo.cargar_lotes(self.base, [publicador(), programa("A", 21)])
        ampliado = programa("B", 22)
        ampliado.update(schema_version=2, variantes=[], centros=[], anuncios=[])
        recuentos = catalogo.cargar_lotes(self.base, [programa("A", 22), ampliado])
        self.assertEqual([r["programas_observados"] for r in recuentos], [1, 1])
        self.assertEqual(recuentos[1]["variantes_observados"], 0)
        with sqlite3.connect(self.base) as con:
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], catalogo.VERSION_SQLITE_CONTENIDOS)
            self.assertEqual(con.execute("SELECT count(*) FROM programas").fetchone()[0], 2)

    def test_nueva_base_admite_varios_contratos_sin_mutar_entradas(self) -> None:
        """Regresión: nueva base admite varios contratos sin mutar entradas."""
        ampliado = programa("B", 22)
        ampliado.update(schema_version=2, variantes=[], centros=[], anuncios=[])
        lotes = [publicador(), programa("A", 21), ampliado]
        antes = deepcopy(lotes)
        catalogo.cargar_lotes(self.base, lotes)
        self.assertEqual(lotes, antes)
        with sqlite3.connect(self.base) as con:
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], catalogo.VERSION_SQLITE_CONTENIDOS)
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_lote_vacio_o_tipo_incorrecto_no_crea_base(self) -> None:
        """Regresión: lote vacio o tipo incorrecto no crea base."""
        for entrada in ([], {}, None, "ruta.json", (publicador(),)):
            with self.subTest(tipo=type(entrada)), self.assertRaises(catalogo.ErrorCatalogo):
                catalogo.cargar_lotes(self.base, entrada)
            self.assertFalse(self.base.exists())


class CanalesTemporalesTest(unittest.TestCase):
    """Identidad de capturas y sucesión demostrada de cada canal."""

    def setUp(self) -> None:
        """Prepara una candidata aislada y registra su limpieza."""
        import hashlib

        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.raiz = Path(self.temporal.name)
        self.base = self.raiz / "canales.sqlite"
        self.sha = hashlib.sha256

    def entrada(
        self, identidad: str = "A", dia: int = 22, auxiliar: int = 22, titulo: str | None = None
    ) -> tuple[ObjetoJson, list[ObjetoJson]]:
        """Crea negocio y capturas físicas de dos canales independientes.

        Returns:
            Lote de negocio y canales con sus capturas físicas.
        """
        lote = programa(identidad, dia)
        lote["programas"][0]["titulo"] = titulo or identidad
        pruebas = []
        for rol, fecha in [("ficha", dia), ("normas", auxiliar)]:
            nombre = f"{identidad}-{rol}-{fecha}.txt"
            cuerpo = f"{identidad}/{rol}/{fecha}".encode()
            (self.raiz / nombre).write_bytes(cuerpo)
            pruebas.append(
                {
                    "url": f"https://example.org/{rol}/{identidad}",
                    "capturado_utc": f"2026-10-{fecha:02d}T08:00:00Z",
                    "sha256": self.sha(cuerpo).hexdigest(),
                    "archivo": nombre,
                }
            )
        lote["programas"][0]["evidencias"] = pruebas
        canales = [
            {"entidad": "programa", "id": identidad, "canal": rol, "evidencias": [e]}
            for rol, e in zip(("ficha", "normas"), pruebas, strict=False)
        ]
        return lote, canales

    def cargar(self, *entradas: tuple[ObjetoJson, list[ObjetoJson]]) -> list[dict[str, int]]:
        """Carga las entradas con sus canales y verifica sus capturas locales.

        Returns:
            Recuentos de las importaciones confirmadas en una transacción.
        """
        return catalogo.cargar_lotes(
            self.base, [x[0] for x in entradas], True, self.raiz, canales_temporales=[x[1] for x in entradas]
        )

    def iniciar(self, *entradas: tuple[ObjetoJson, list[ObjetoJson]]) -> None:
        """Crea una base temporal protegida con las entradas iniciales."""
        catalogo.cargar_lote(self.base, publicador())
        self.cargar(*entradas)

    def rechazo_intacto(self, *entradas: tuple[ObjetoJson, list[ObjetoJson]]) -> None:
        """Comprueba el rechazo estructurado y la igualdad de bytes de la base."""
        antes = self.base.read_bytes()
        with self.assertRaises(catalogo.ErrorTemporal) as fallo:
            self.cargar(*entradas)
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertIn("motivo", fallo.exception.detalle)

    def test_auxiliar_nueva_no_rejuvenece_ficha_antigua(self) -> None:
        """Regresión: auxiliar nueva no rejuvenece ficha antigua."""
        self.iniciar(self.entrada())
        self.rechazo_intacto(self.entrada(dia=21, auxiliar=23, titulo="antiguo"))

    def test_a1_b3_a_a2_b2_revierte_tambien_a(self) -> None:
        """Regresión: a1 b3 a a2 b2 revierte tambien a."""
        self.iniciar(self.entrada("A", 21, 21), self.entrada("B", 23, 23))
        self.rechazo_intacto(self.entrada("A", 22, 22), self.entrada("B", 22, 22))

    def test_omitir_canales_y_omitir_rol_protegido_no_elude_control(self) -> None:
        """Regresión: omitir canales y omitir rol protegido no elude control."""
        self.iniciar(self.entrada())
        lote, canales = self.entrada(dia=23, auxiliar=23)
        antes = self.base.read_bytes()
        with self.assertRaises(catalogo.ErrorTemporal):
            catalogo.cargar_lote(self.base, lote)
        with self.assertRaises(catalogo.ErrorTemporal):
            catalogo.cargar_lote(self.base, lote, True, self.raiz, canales_temporales=canales[:1])
        self.assertEqual(self.base.read_bytes(), antes)

    def test_repetir_no_cambia_negocio_pero_misma_prueba_no_justifica_otro_titulo(self) -> None:
        """Regresión: repetir no cambia negocio pero misma prueba no justifica otro titulo."""
        entrada = self.entrada()
        self.iniciar(entrada)
        antes = catalogo.resumen(self.base)
        self.cargar(entrada)
        self.assertEqual(catalogo.resumen(self.base)["versiones"], antes["versiones"])
        lote, canales = deepcopy(entrada)
        lote["programas"][0]["titulo"] = "otro"
        self.rechazo_intacto((lote, canales))

    def test_intervalo_solapado_no_acredita_sucesion(self) -> None:
        """Regresión: intervalo solapado no acredita sucesion."""
        lote, canales = self.entrada()
        canales = [dict(canales[0], evidencias=lote["programas"][0]["evidencias"])]
        self.iniciar((lote, canales))
        nuevo, prueba = self.entrada(dia=23, auxiliar=21)
        self.rechazo_intacto((nuevo, [dict(prueba[0], evidencias=nuevo["programas"][0]["evidencias"])]))

    def test_carga_sin_canales_no_inventa_historia_ni_la_adopta_despues(self) -> None:
        """Una entidad cargada sin canales no recibe después canales retroactivos."""
        lote, canales = self.entrada()
        lote["proveedores"] = publicador()["proveedores"]
        catalogo.cargar_lote(self.base, lote, True, self.raiz)
        with sqlite3.connect(self.base) as con:
            antes = con.execute("SELECT * FROM programas").fetchall()
            self.assertEqual(con.execute("SELECT count(*) FROM canales_temporales").fetchone()[0], 0)
        self.rechazo_intacto((lote, canales))
        with sqlite3.connect(self.base) as con:
            self.assertEqual(con.execute("SELECT * FROM programas").fetchall(), antes)
            self.assertEqual(con.execute("SELECT count(*) FROM canales_temporales").fetchone()[0], 0)

    def test_capturas_de_canales_siempre_verificadas(self) -> None:
        """Una captura alterada en disco se rechaza por huella sin escribir la base."""
        catalogo.cargar_lote(self.base, publicador())
        lote, canales = self.entrada()
        (self.raiz / canales[0]["evidencias"][0]["archivo"]).write_text("manipulada")
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "huella"):
            self.cargar((lote, canales))
        self.assertEqual(self.base.read_bytes(), antes)

    def test_actualizacion_parcial_legitima_pendiente_sin_mapa_de_campos(self) -> None:
        """Regresión: actualizacion parcial legitima pendiente sin mapa de campos."""
        self.iniciar(self.entrada(dia=22, auxiliar=22, titulo="Título anterior"))
        self.rechazo_intacto(self.entrada(dia=23, auxiliar=22, titulo="Título nuevo publicado"))
        # La misma revisión sí puede entrar con recaptura completa posterior.
        self.cargar(self.entrada(dia=23, auxiliar=23, titulo="Título nuevo publicado"))
        # Negocio idéntico admite nueva ficha aunque las normas sean la misma captura.
        self.cargar(self.entrada(dia=24, auxiliar=23, titulo="Título nuevo publicado"))

    def test_censo_protegido_no_admite_conciliacion_sin_sus_pruebas(self) -> None:
        """Regresión: censo protegido no admite conciliacion sin sus pruebas."""
        lote, canales = self.entrada()
        lote["proveedores"] = publicador()["proveedores"]
        censo = [
            {
                "entidad": "catalogo",
                "id": '["proveedor-1","web"]',
                "canal": "enumeracion",
                "evidencias": [lote["programas"][0]["evidencias"][0]],
            }
        ]
        catalogo.importar_y_conciliar(
            self.base,
            lote,
            catalogo.InstantaneaCatalogo(
                proveedor_id="proveedor-1",
                ambito="web",
                ids_programas=["A"],
                total_publicado=1,
                completa=True,
                errores=[],
                observado_utc=lote["observado_utc"],
            ),
            opciones=catalogo.OpcionesCiclo(
                comprobar_capturas=True, raiz_evidencias=self.raiz, canales_temporales=canales, canales_censo=censo
            ),
        )
        antes = self.base.read_bytes()
        with self.assertRaises(catalogo.ErrorTemporal):
            catalogo.conciliar_instantanea(
                self.base,
                catalogo.InstantaneaCatalogo(
                    proveedor_id="proveedor-1",
                    ambito="web",
                    ids_programas=[],
                    total_publicado=0,
                    completa=True,
                    errores=[],
                    observado_utc="2026-10-24T08:00:00Z",
                ),
            )
        self.assertEqual(self.base.read_bytes(), antes)

    def test_sello_es_del_estado_persistido_si_aprendizaje_conserva_decision(self) -> None:
        """Regresión: sello es del estado persistido si aprendizaje conserva decision."""
        import json

        from plataforma_datos.cursos.pruebas.test_contrato_aprendizaje import (
            HUELLA,
            REGISTRO,
            lote_aprendizaje,
            revisar,
        )

        lote = lote_aprendizaje()
        lote["ediciones"] = []
        afirmacion = lote["programas"][0]["datos"]["aprendizaje"]["afirmaciones"][0]
        revisar(afirmacion)
        with patch("plataforma_datos.cursos.catalogo.cargar_registro", return_value=(deepcopy(REGISTRO), HUELLA)):
            for dia in (22, 23):
                fichero = self.raiz / f"captura-{dia}.html"
                fichero.write_text(f"Captura factual del día {dia}")
                prueba = {
                    "url": lote["programas"][0]["url"],
                    "capturado_utc": f"2026-10-{dia}T08:00:00Z",
                    "sha256": self.sha(fichero.read_bytes()).hexdigest(),
                    "archivo": fichero.name,
                }
                lote["observado_utc"] = prueba["capturado_utc"]
                lote["programas"][0]["evidencias"] = [prueba]
                afirmacion["evidencias"][0].update({k: prueba[k] for k in ("url", "capturado_utc", "sha256")})
                if dia == DIA_ENTRADA_DISCREPANTE:
                    afirmacion["descripcion"] = "Conclusión discrepante entrante"
                canal = [{"entidad": "programa", "id": "programa-1", "canal": "ficha", "evidencias": [prueba]}]
                catalogo.cargar_lote(self.base, lote, True, self.raiz, canales_temporales=canal)
            with sqlite3.connect(self.base) as con:
                con.row_factory = sqlite3.Row
                dato = dict(con.execute("SELECT * FROM programas").fetchone())
                sello = con.execute(
                    "SELECT huella_negocio FROM canales_temporales ORDER BY id DESC LIMIT 1"
                ).fetchone()[0]
                self.assertEqual(con.execute("SELECT count(*) FROM conflictos_aprendizaje").fetchone()[0], 1)
            dato.pop("huella")
            dato["datos"] = json.loads(dato["datos"])
            self.assertEqual(
                dato["datos"]["aprendizaje"]["afirmaciones"][0]["descripcion"], "Objetivo publicado de prueba"
            )
            canonico = json.dumps(dato, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
            self.assertEqual(sello, self.sha(canonico.encode()).hexdigest())
            # La entrada contradictoria no se hace pasar por el estado sellado.
            antes = self.base.read_bytes()
            with self.assertRaises(catalogo.ErrorTemporal):
                catalogo.cargar_lote(self.base, lote, True, self.raiz, canales_temporales=canal)
            self.assertEqual(self.base.read_bytes(), antes)


if __name__ == "__main__":
    unittest.main()
