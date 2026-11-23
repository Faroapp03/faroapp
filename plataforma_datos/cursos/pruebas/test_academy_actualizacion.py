"""Academy vertical sin red: descubrimiento, SQLite, admisión y oferta pública real."""

import hashlib
import json
import shutil
import sqlite3
import unittest
from copy import deepcopy
from dataclasses import replace
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, recepciones_catalogo
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos import seleccion_entrega_catalogo as seleccion
from plataforma_datos.cursos.fuentes.claude_academy import actualizacion as academy
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.pruebas import test_academy_observaciones_vigencia as recepciones
from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as antecedentes
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.pruebas import test_generacion_operativa as traslado

CORTE = "2026-10-23T10:05:00Z"
ID = "claude-academy:nuevo"


class AcademyActualizacionPruebas(unittest.TestCase):
    """No toca catálogos reales ni sustituye controles por mocks de admisión."""

    def setUp(self) -> None:
        """Añade Academy a una instantánea admitida que ya conserva otra fuente viva."""
        self.rx = recepciones.AcademyObservacionesPruebas()
        self.rx.setUp()
        self.addCleanup(self.rx.doCleanups)
        self.hp = antecedentes.ActualizacionHpLifePruebas()
        self.hp.setUp()
        self.addCleanup(self.hp.doCleanups)
        hp.preparar(self.hp.solicitud)
        entrada = hp.solicitud_admision(self.hp.solicitud.area)
        self.raiz = self.rx.raiz
        almacen.conservar(
            almacen.EntradaCatalogo(admision=entrada, sha256_admision=self.hp.ref(entrada.validacion_destino).sha256),
            destino=self.raiz / almacen.RUTA,
        )
        self.rx.ciclo()

    def inventario(self) -> dict:
        """Fija SHA y mtime de los resultados públicos y operativos.

        Returns:
            Inventario cerrado para comprobar no-op y fallo sin falsa renovación.
        """
        return {
            p.relative_to(self.raiz).as_posix(): (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            for carpeta in (self.raiz / almacen.RUTA, self.raiz / "web")
            for p in carpeta.rglob("*")
            if p.is_file()
        }

    def componer(self, corte: str = CORTE) -> tuple[dict, dict]:
        """Ejecuta etapas productivas comunes y lee los bytes públicos generados.

        Returns:
            Resultado operativo y DTO2 publicado de esta candidata sin tráfico.
        """
        resultado = componer.componer(raiz=self.raiz, corte_utc=corte)
        dto = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
        return resultado, dto

    def legado(self, *, soporte: bool = True) -> None:
        """Reproduce un recurso V2 con canal histórico y captura conocida, sin evaluarlo."""
        base = self.raiz / almacen.RUTA
        conjunto = fuente.leer_validado("claude_academy", self.raiz)
        original, _, _ = fuente.rutas_de_la_fuente("claude_academy", self.raiz)
        fila = next(f for f in conjunto["recepciones"] if f["id"] == ID)
        cuerpo, meta = fuente.pagina_academy(original, fila)
        ficha = academy.lector.extraer_ficha(cuerpo, meta, url_esperada=meta["url_solicitada"])
        control = json.loads((base / almacen.CONTROL).read_bytes())
        inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
        pruebas = academy._conservar(original, fila, base, inventario)
        datos = {
            "identidad_fuente": {"slug": ficha.id},
            "contenido_publicado": ficha.contenido,
            "coste_formacion_tipo": "gratis_formacion",
            "campo_desconocido": None,
        }
        if soporte:
            datos["soporte_acceso"] = {
                "http": 200,
                "HTML_completo": True,
                "recibido_utc": meta["recibido_utc"],
                "url": ficha.url,
            }
        programa = {
            "id": ID,
            "proveedor_id": "anthropic",
            "titulo": ficha.titulo,
            "url": ficha.url,
            "tipo_unidad": "curso",
            "datos": datos,
        }
        lote = academy._lote(programa, pruebas, meta["recibido_utc"])
        lote["proveedores"] = [{"id": "anthropic", "nombre": "Anthropic", "naturaleza": None, "territorio": None}]
        catalogo.cargar_lote(
            base / "catalogo.sqlite3",
            lote,
            True,
            base / "evidencias",
            canales_temporales=[
                {"entidad": "programa", "id": ID, "canal": "documento-historico", "evidencias": pruebas}
            ],
        )
        control["snapshot_sha256"] = academy._sha(base / "catalogo.sqlite3")
        control["archivos_conservados"] = [{"archivo": n, "sha256": h} for n, h in sorted(inventario.items())]
        guardar_json(base / almacen.CONTROL, control)
        admision.admitir_snapshot(almacen.solicitud(base))

    def test_legado_ancla_captura_historica_antes_de_aplicar_cambio_actual(self) -> None:
        """No exige congelar contenido para siempre ni atribuye datos antiguos a la nueva consulta."""
        self.legado()
        self.rx.extra = "<p>Provider changed the published content.</p>"
        self.rx.ciclo()
        _, dto = self.componer()
        self.assertIn(ID, {o["unidad"]["id"] for o in dto["ofertas"]})
        with sqlite3.connect(self.raiz / almacen.RUTA / "catalogo.sqlite3") as conexion:
            datos = json.loads(conexion.execute("SELECT datos FROM programas WHERE id=?", (ID,)).fetchone()[0])
            self.assertIn("Provider changed", datos["contenido_publicado"])
            self.assertIsNone(datos["campo_desconocido"])
            self.assertIn("soporte_acceso", datos)
            self.assertEqual(
                conexion.execute("SELECT nombre FROM proveedores WHERE id='anthropic'").fetchone()[0], "Anthropic"
            )

    def test_legado_cambiado_sin_ancla_no_se_promueve_por_tener_precio_historico(self) -> None:
        """Conserva antecedentes y registra pendiente concreto, sin fabricar prueba histórica."""
        self.legado(soporte=False)
        self.rx.extra = "<p>Provider changed the published content.</p>"
        self.rx.ciclo()
        _, dto = self.componer()
        self.assertNotIn(ID, {o["unidad"]["id"] for o in dto["ofertas"]})
        base = self.raiz / almacen.RUTA
        control = json.loads((base / almacen.CONTROL).read_bytes())
        recibo = almacen.leer_documento(base, control["procedencia"]["recibo-academy"])
        self.assertEqual(
            next(r["pendiente"] for r in recibo["resultados"] if r["id"] == ID),
            "contenido_cambiado_sin_ancla_historica_acreditada",
        )

    def test_error_403_posterior_no_renueva_confirmacion_o_publicacion(self) -> None:
        """Una denegación nueva conserva el intento; no sustituye el admitido ni da baja."""
        self.componer()
        antes = self.inventario()
        recibir = self.rx.recibir

        def denegada(url: str, **opciones: object) -> recepciones_catalogo.RespuestaCatalogo:
            return replace(recibir(url, **opciones), http=403)

        with patch.object(fuente, "consultar", side_effect=denegada), self.assertRaises(FormatoInesperado):
            self.rx.ciclo()
        self.componer("2026-10-23T10:06:00Z")
        self.assertEqual(self.inventario(), antes)

    def test_alta_descubierta_llega_a_oferta_y_repeticion_no_es_consulta(self) -> None:
        """La nueva identidad se importa una vez y conserva desconocidos sin inventar edición."""
        resultado, dto = self.componer()
        oferta = next(o for o in dto["ofertas"] if o["unidad"]["id"] == ID)
        coste = oferta["hechos"]["coste_formacion_tipo"]
        self.assertEqual(coste["valor"], "gratis_formacion")
        self.assertEqual(coste["alcance"], "declaracion_general")
        self.assertTrue(any(r["url"] == "https://academy.claude.com/" for r in oferta["referencias"]))
        with sqlite3.connect(self.raiz / almacen.RUTA / "catalogo.sqlite3") as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM programas WHERE id=?", (ID,)).fetchone()[0], 1)
            self.assertEqual(
                conexion.execute("SELECT count(*) FROM ediciones WHERE programa_id=?", (ID,)).fetchone()[0], 0
            )
            datos = json.loads(conexion.execute("SELECT datos FROM programas WHERE id=?", (ID,)).fetchone()[0])
            self.assertNotIn("aprendizaje", datos)
            self.assertNotIn("idiomas", datos)
        antes = self.inventario()
        repetido, _ = self.componer("2026-10-23T11:05:00Z")
        self.assertEqual(repetido, resultado)
        self.assertEqual(self.inventario(), antes)

    def test_cambio_real_actualiza_solo_campos_propios_y_preserva_hp(self) -> None:
        """Una segunda captura renueva contenido bajo su mapa sin duplicar ni borrar historia."""
        _, anterior = self.componer()
        hp_antes = [o for o in anterior["ofertas"] if o["proveedor_id"] == "hp-life"]
        self.rx.extra = "<p>New lesson content added by the provider.</p>"
        self.rx.ciclo()
        _, nuevo = self.componer("2026-10-23T10:06:00Z")
        self.assertEqual([o for o in nuevo["ofertas"] if o["proveedor_id"] == "hp-life"], hp_antes)
        with sqlite3.connect(self.raiz / almacen.RUTA / "catalogo.sqlite3") as conexion:
            datos = json.loads(conexion.execute("SELECT datos FROM programas WHERE id=?", (ID,)).fetchone()[0])
            self.assertIn("New lesson content", datos["contenido_publicado"])
            self.assertIn("contenido_huella", datos)
            self.assertEqual(conexion.execute("SELECT count(*) FROM programas WHERE id=?", (ID,)).fetchone()[0], 1)
        estado = registro.consultar_unidad(self.raiz / almacen.RUTA / "catalogo.sqlite3", tipo="recurso", id=ID)
        self.assertEqual(len(estado["evaluacion"]["entradas"]["observaciones"]), 2)

    def test_fallo_de_aplicacion_no_publica_ni_muta_antecedente(self) -> None:
        """Una excepción antes de cerrar la candidata conserva la última salida íntegra."""
        self.componer()
        antes = self.inventario()
        self.rx.ciclo()
        with (
            patch.object(academy, "_evaluar", side_effect=RuntimeError("corte sintético")),
            self.assertRaisesRegex(RuntimeError, "corte sintético"),
        ):
            self.componer("2026-10-23T10:06:00Z")
        self.assertEqual(self.inventario(), antes)
        self.componer("2026-10-23T10:06:00Z")

    def test_compacto_sin_bytes_historicos_se_completa_por_indice_explicito_sin_cambiar_sqlite(self) -> None:
        """La admisión de integridad no inventa archivos; la entrada V2 debe conservarlos."""
        self.legado()
        base = self.raiz / almacen.RUTA
        with sqlite3.connect(base / "catalogo.sqlite3") as conexion:
            conexion.row_factory = sqlite3.Row
            pruebas = [p for canal in academy._canales(conexion, ID) for p in canal["evidencias"]]
        control = json.loads((base / almacen.CONTROL).read_bytes())
        huellas = {p["sha256"] for p in pruebas}
        control["archivos_conservados"] = [p for p in control["archivos_conservados"] if p["sha256"] not in huellas]
        indice_compacto = self.raiz / "indice-compacto.json"
        guardar_json(indice_compacto, control)
        entrada = almacen.solicitud(base)
        ref = self.hp.ref(indice_compacto)
        compacta = replace(
            entrada,
            procedencia={**entrada.procedencia, "control-catalogo": ref},
            indices_evidencias={"catalogo-evidencias": admision.IndiceEvidencias(archivo=ref, raiz=base)},
            validacion_destino=self.raiz / "admision-compacta.json",
        )
        admision.admitir_snapshot(compacta)
        destino = self.raiz / "Compacto sin originales"
        almacen.conservar(
            almacen.EntradaCatalogo(admision=compacta, sha256_admision=academy._sha(compacta.validacion_destino)),
            destino=destino,
        )
        self.assertTrue(all(not (destino / "evidencias" / p["archivo"]).exists() for p in pruebas))
        historicas = self.raiz / "indice-historicas.json"
        guardar_json(
            historicas,
            {
                "schema_version": 1,
                "archivos_conservados": [
                    {"archivo": "evidencias/" + p["archivo"], "sha256": p["sha256"]} for p in pruebas
                ],
            },
        )
        ref = self.hp.ref(historicas)
        anterior = almacen.solicitud(destino)
        solicitud = replace(
            anterior,
            procedencia={**anterior.procedencia, "historicas-v2": ref},
            indices_evidencias={
                **anterior.indices_evidencias,
                "historicas-v2-evidencias": admision.IndiceEvidencias(archivo=ref, raiz=base),
            },
            validacion_destino=self.raiz / "admision-con-historicas.json",
        )
        admision.admitir_snapshot(solicitud)
        completo = self.raiz / "Completo portable"
        almacen.conservar(
            almacen.EntradaCatalogo(admision=solicitud, sha256_admision=academy._sha(solicitud.validacion_destino)),
            destino=completo,
        )
        self.assertEqual((completo / "catalogo.sqlite3").read_bytes(), (destino / "catalogo.sqlite3").read_bytes())
        for prueba in pruebas:
            self.assertEqual(academy._sha(completo / "evidencias" / prueba["archivo"]), prueba["sha256"])

    def test_readmision_sin_recepcion_nueva_no_duplica_observaciones_nativas(self) -> None:
        """Cambiar la firma obliga a evaluar, pero no vuelve a ingresar la misma captura."""
        self.componer()
        base = self.raiz / almacen.RUTA / "catalogo.sqlite3"
        with sqlite3.connect(base) as conexion:
            antes = conexion.execute("SELECT count(*) FROM observaciones WHERE programa_id=?", (ID,)).fetchone()[0]
        with patch.object(academy, "firma", return_value="e" * 64):
            self.componer("2026-10-23T10:06:00Z")
        with sqlite3.connect(base) as conexion:
            despues = conexion.execute("SELECT count(*) FROM observaciones WHERE programa_id=?", (ID,)).fetchone()[0]
        self.assertEqual(antes, despues)

    def test_consultas_nuevas_identicas_conservan_historia_sin_archivar_indices_acumulados(self) -> None:
        """Cada consulta guarda recibos únicos; cuerpo y código se conservan una sola vez."""
        medidas = []
        anteriores = set()
        for ciclo in range(4):
            if ciclo:
                self.rx.ciclo()
            self.componer(f"2026-10-23T10:{5 + ciclo:02d}:00Z")
            base = self.raiz / almacen.RUTA
            control = json.loads((base / almacen.CONTROL).read_bytes())
            recibo = base / control["procedencia"]["recibo-academy"]["archivo"]
            huellas = {p["sha256"] for p in control["archivos_conservados"]}
            self.assertTrue(anteriores <= huellas)
            anteriores = huellas
            medidas.append(
                {
                    "ciclo": ciclo + 1,
                    "recibo_bytes": recibo.stat().st_size,
                    "cuerpos": len(
                        list((self.raiz / "var/actualizacion/originales/claude_academy/cuerpos").glob("*.body"))
                    ),
                    "pruebas": len(control["archivos_conservados"]),
                    "control_bytes": (base / almacen.CONTROL).stat().st_size,
                    "sqlite_bytes": (base / "catalogo.sqlite3").stat().st_size,
                }
            )
        print("MEDICION_ACADEMY=" + json.dumps(medidas, sort_keys=True))
        self.assertEqual(len({m["cuerpos"] for m in medidas}), 1)
        self.assertLess(max(m["recibo_bytes"] for m in medidas) - min(m["recibo_bytes"] for m in medidas), 128)
        deltas = [b["pruebas"] - a["pruebas"] for a, b in zip(medidas, medidas[1:], strict=False)]
        # El segundo ciclo fija las plantillas conservadas del informe y del
        # selector actual. Después: siete eventos HTTP (incluida FAQ), dos admisiones y un
        # selector de referencias; ningún cuerpo o índice histórico acumulado.
        self.assertEqual(deltas, [12, 10, 10])

    def test_traslado_comun_y_siguiente_ciclo_desde_destino(self) -> None:
        """El exportador común conserva la instantánea y los originales; destino renueva sin casa adicional."""
        self.componer()
        traslado.preparar(self.raiz)
        paquete = self.raiz.parent / (self.raiz.name + "-paquete")
        destino = self.raiz.parent / (self.raiz.name + "-restaurada")
        self.addCleanup(lambda: shutil.rmtree(paquete, ignore_errors=True))
        self.addCleanup(lambda: shutil.rmtree(destino, ignore_errors=True))
        recibo = generacion.exportar_generacion(self.raiz, paquete, traslado.REVISION)
        generacion.restaurar_generacion(paquete, destino, traslado.REVISION, recibo["sha256Manifiesto"])
        self.assertEqual(
            (destino / almacen.RUTA / "catalogo.sqlite3").read_bytes(),
            (self.raiz / almacen.RUTA / "catalogo.sqlite3").read_bytes(),
        )
        repetido = componer.componer(raiz=destino, corte_utc="2026-10-23T10:06:00Z")
        self.assertTrue(repetido["referencia"])
        self.rx.raiz = destino
        self.raiz = destino
        self.rx.extra = "<p>Content observed after moving the operational generation.</p>"
        with patch.object(fuente, "RAIZ", destino):
            self.rx.ciclo()
            _, dto = self.componer("2026-10-23T10:07:00Z")
        self.assertIn(ID, {o["unidad"]["id"] for o in dto["ofertas"]})
        with sqlite3.connect(destino / almacen.RUTA / "catalogo.sqlite3") as conexion:
            datos = json.loads(conexion.execute("SELECT datos FROM programas WHERE id=?", (ID,)).fetchone()[0])
            self.assertIn("after moving", datos["contenido_publicado"])

    def test_consumo_rechaza_apoyos_ausentes_alterados_y_regla_desconocida(self) -> None:
        """El resultado positivo guardado no suple el contrato de sus entradas."""
        self.componer()
        estado = registro.consultar_unidad(self.raiz / almacen.RUTA / "catalogo.sqlite3", tipo="recurso", id=ID)
        evaluacion = estado["evaluacion"]
        self.assertIsNone(seleccion.comprobar_soporte(evaluacion))
        for cambio in ("sin_apoyo", "apoyo_alterado", "otra_version", "otra_fuente", "otra_politica"):
            with self.subTest(cambio=cambio):
                copia = deepcopy(evaluacion)
                entradas = copia["entradas"]
                if cambio == "sin_apoyo":
                    entradas["observaciones"][-1]["detalle"]["oferta_publicada_continua"]["criterios"][
                        "cta_identificado"
                    ]["apoyos"] = []
                elif cambio == "apoyo_alterado":
                    entradas["observaciones"][-1]["evidencias"][-1]["alcance"] = "diagnostico"
                elif cambio == "otra_version":
                    entradas["observaciones"][-1]["detalle"]["oferta_publicada_continua"]["version"] = 2
                elif cambio == "otra_fuente":
                    entradas["politica"]["fuente_id"] = "desconocida"
                    entradas["oferta"]["fuente_id"] = "desconocida"
                else:
                    entradas["politica"]["version"] = "999"
                self.assertIsNotNone(seleccion.comprobar_soporte(copia))


if __name__ == "__main__":
    unittest.main()
