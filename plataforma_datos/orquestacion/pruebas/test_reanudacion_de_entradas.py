"""La reanudación usa el mismo motor después de recuperar las entradas del rechazo anterior."""

import json
import shutil
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import AbstractContextManager, ExitStack, contextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from plataforma_datos.orquestacion import (
    actualizar,
    almacen_generaciones,
    almacen_trabajos,
    comprobaciones_remotas,
    diario_mantenimiento,
    estado_panel,
    observacion_de_entradas,
    seguimiento_de_comprobaciones,
)
from plataforma_datos.orquestacion import lotes_de_entradas as lotes
from plataforma_datos.orquestacion import reanudacion_de_entradas as reanudar
from plataforma_datos.orquestacion.entradas_por_fuente import IdentidadEntradas
from plataforma_datos.orquestacion.modulos import MODULOS, Modulo, carpetas
from plataforma_datos.orquestacion.pruebas import test_lotes_de_entradas as fixture_lotes
from plataforma_datos.orquestacion.pruebas.test_comprobaciones_remotas import evidencia

OBSERVADA = "2026-11-26T14:00:00Z"
AHORA = datetime(2026, 11, 26, 18, tzinfo=UTC)
BASE = {"revisionCodigo": "1" * 40, "sha256Manifiesto": "2" * 64}
LOTES = {m.id: m for m in MODULOS}


class ReanudacionDeEntradasTest(unittest.TestCase):
    """Comprueba la identidad, la selección y la publicación local de entradas admitidas."""

    def setUp(self) -> None:
        """Prepara árboles propios para un trabajo y un área de ejecución."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.trabajo = Path(self.temporal.name).resolve()
        self.raiz = self.trabajo / "candidato"
        self.area = self.trabajo / "area"
        (self.raiz / "var/actualizacion/ejecuciones").mkdir(parents=True)
        self.area.mkdir()
        self.plan = self.trabajo / reanudar.CARPETA
        self.lectores = dict.fromkeys(reanudar._FUENTES, "3" * 64)

    def lote(self, raiz: Path, modulo: Modulo, texto: str) -> None:
        """Construye las tres casas de un módulo sintético."""
        for ruta in carpetas(modulo):
            (raiz / ruta).mkdir(parents=True, exist_ok=True)
            (raiz / ruta / "datos").write_text(texto)

    def plan_para(self, modulo: Modulo) -> None:
        """Prepara un kit del formato que el supervisor entrega al motor."""
        fuente = modulo.fuentes[0]
        destino = self.plan / fuente
        destino.mkdir(parents=True)
        self.lote(self.plan / "contenido", modulo, "recibido")
        (destino / "entrada.json").write_text(
            json.dumps(
                {
                    "dependencias": reanudar.dependencias(self.raiz, modulo, self.lectores),
                    "lectorSha256": self.lectores[fuente],
                    "observadoEn": OBSERVADA,
                }
            )
        )
        (self.plan / "lectores.json").write_text(json.dumps(self.lectores))

    def test_la_ronda_publica_lo_admitido_y_no_repite_la_descarga(self) -> None:
        """El mismo módulo publica el lote aceptado sin invocar otra etapa de fuente."""
        modulo = LOTES["oit"]
        self.lote(self.raiz, modulo, "vigente")
        self.lote(self.area, modulo, "vigente")
        self.plan_para(modulo)
        ejecutor = mock.Mock(side_effect=AssertionError("No debe descargar ni recalcular el lote idéntico"))
        with mock.patch.object(actualizar, "MODULOS", (modulo,)):
            pasos, resultados = actualizar.ejecutar_modulos(
                self.raiz,
                self.area,
                ejecutor,
                actualizar.Opciones(solo=(modulo.id,), entradas_recuperadas=self.plan),
            )
        self.assertEqual(resultados[modulo.id].veredicto, "verde")
        self.assertEqual(pasos[0].salida, OBSERVADA)
        self.assertEqual((self.plan / "oit/usada").read_text().strip(), OBSERVADA)
        for ruta in carpetas(modulo):
            self.assertEqual((self.raiz / ruta / "datos").read_text(), "recibido")
        ejecutor.assert_not_called()

    def test_un_kit_aplicado_a_medias_bloquea_el_paquete_aunque_sea_de_apoyo(self) -> None:
        """La publicación, la recepción histórica y la nota de uso forman un paso del motor."""
        from plataforma_datos.orquestacion.pruebas.test_candidato import EjecutorCandidato, preparar

        modulo = LOTES["enlaces"]
        for fase in ("area", "publicar", "observacion", "marca"):
            with self.subTest(fase=fase), tempfile.TemporaryDirectory(dir=self.trabajo) as nombre, ExitStack() as stack:
                trabajo = Path(nombre).resolve()
                self.raiz, self.plan = trabajo / "candidato", trabajo / reanudar.CARPETA
                area = trabajo / "area"
                preparar(self.raiz)
                self.lote(self.raiz, modulo, "vigente")
                self.plan_para(modulo)
                self._guardar_observacion_de_enlaces(trabajo / "trabajo-anterior")
                stack.enter_context(mock.patch.object(actualizar, "MODULOS", (modulo,)))
                stack.enter_context(mock.patch.object(actualizar.instante_del_ciclo, "ahora", return_value=AHORA))
                ejecutar_paquete = stack.enter_context(mock.patch.object(actualizar, "ejecutar_paquete"))
                marcar_y_esperar = stack.enter_context(mock.patch.object(reanudar, "marcar_y_esperar"))
                stack.enter_context(self._fallo_al_instalar(fase))
                opciones = actualizar.Opciones(
                    area=area,
                    solo=(modulo.id,),
                    entradas_recuperadas=self.plan,
                    punto_de_corte_entradas=trabajo / reanudar.PUNTO_DE_CORTE,
                )
                resultado = actualizar.actualizar_con_resultado(self.raiz, opciones, EjecutorCandidato())
                self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
                self.assertEqual(resultado.resultados[modulo.id].veredicto, actualizar.ROJO)
                self.assertEqual(resultado.resultados[actualizar.PAQUETE].veredicto, actualizar.ROJO)
                ejecutar_paquete.assert_not_called()
                marcar_y_esperar.assert_not_called()
                validada = Path(carpetas(modulo)[2]) / "datos"
                self.assertEqual((area / validada).read_text(), "recibido")
                self.assertEqual(
                    (self.raiz / validada).read_text(), "vigente" if fase in ("area", "publicar") else "recibido"
                )
                registro = comprobaciones_remotas.leer_registro(self.raiz)
                self.assertEqual("enlaces" in registro["conjuntos"], fase == "marca")
                self.assertFalse((self.plan / "enlaces/usada").exists())

    def _guardar_observacion_de_enlaces(self, origen: Path) -> None:
        origen.mkdir()
        instante = datetime.fromisoformat(OBSERVADA)
        ciclo = comprobaciones_remotas.iniciar_ciclo(origen, instante, "manual")
        comprobaciones_remotas.iniciar_fuente(origen, ciclo, "enlaces", ("enlaces",), instante, remoto=True)
        recibo = evidencia()
        recibo.update(fuente="enlaces", comienzo_utc=OBSERVADA, fin_utc=OBSERVADA)
        recibo["peticiones"][0]["completado_utc"] = OBSERVADA
        comprobaciones_remotas.terminar_fuente(
            origen, ciclo, "enlaces", instante, resultado="comprobada", evidencia=recibo, comprobados=("enlaces",)
        )
        archivo = self.plan / "enlaces/entrada.json"
        entrada = json.loads(archivo.read_bytes())
        entrada["observacionRemota"] = comprobaciones_remotas.leer_registro(origen)["fuentes"]["enlaces"]
        archivo.write_text(json.dumps(entrada))

    def _fallo_al_instalar(self, fase: str) -> AbstractContextManager[object]:
        if fase == "area":
            sustituir = reanudar.sustitucion.sustituir

            def sin_confirmacion(raiz: Path, copia: Path, rutas: tuple[str, ...], diario: str | Path) -> None:
                sustituir(raiz, copia, rutas, diario)
                if diario == self.plan / "diario-enlaces.json":
                    raise OSError("la sustitución del área no confirmó su fin")

            return mock.patch.object(reanudar.sustitucion, "sustituir", side_effect=sin_confirmacion)
        if fase == "publicar":
            return mock.patch.object(actualizar, "publicar", side_effect=OSError("falló publicación"))
        if fase == "observacion":
            return mock.patch.object(
                observacion_de_entradas, "recuperar_observacion_remota", side_effect=OSError("falló observación")
            )
        escribir = Path.write_text
        marca = self.plan / "enlaces/usada"

        def sin_marca(ruta: Path, *args: str, **kwargs: str) -> int:
            if ruta == marca:
                raise OSError("falló nota de uso")
            return escribir(ruta, *args, **kwargs)

        return mock.patch.object(Path, "write_text", autospec=True, side_effect=sin_marca)

    def test_cambia_la_entrada_el_consumidor_vuelve_a_sus_etapas_normales(self) -> None:
        """Una huella distinta de una dependencia devuelve el consumidor a su camino ordinario."""
        modulo = LOTES["clasificaciones"]
        self.lote(self.raiz, LOTES["oit"], "antes")
        self.plan_para(modulo)
        self.lote(self.raiz, LOTES["oit"], "nueva versión")
        resultado = actualizar.ResultadoDelModulo(actualizar.VERDE)
        with mock.patch.object(actualizar, "ejecutar_modulo", return_value=([], resultado)) as paso:
            actualizar.ejecutar_modulos(
                self.raiz,
                self.area,
                mock.Mock(),
                actualizar.Opciones(solo=(modulo.id,), entradas_recuperadas=self.plan),
            )
        self.assertEqual(paso.call_args.args[2], modulo)
        self.assertFalse((self.plan / "clasificaciones/usada").exists())

    def test_la_firma_no_depende_de_componer_y_descarta_solo_el_lector_modificado(self) -> None:
        """Componer no afecta a los lectores y cada lector conserva identidad propia."""
        raices = [
            Path(modulo.__file__).resolve().parent.relative_to(reanudar.RUNTIME)
            for _, modulo in reanudar.FUENTES_EN_ORDEN
        ]
        filas = [f"100644 blob {'1' * 40}\t{raiz}/lector.py" for raiz in raices]
        filas.append(f"100644 blob {'1' * 40}\tplataforma_datos/comun/nucleo.py")
        filas.append(f"100644 blob {'1' * 40}\tplataforma_datos/cursos/componer_catalogo.py")
        configuracion = SimpleNamespace(checkout=self.raiz, revision_codigo="a" * 40)
        with mock.patch.object(reanudar.subprocess, "check_output") as arbol:
            arbol.return_value = "\0".join(filas).encode()
            antes = reanudar._codigo_de_lectores(configuracion)
            filas[-1] = filas[-1].replace("1" * 40, "2" * 40)
            arbol.return_value = "\0".join(filas).encode()
            self.assertEqual(antes, reanudar._codigo_de_lectores(configuracion))
            arbol.return_value = "\0".join(
                fila.replace("1" * 40, "2" * 40) if "/barcelonactiva/" in fila else fila for fila in filas
            ).encode()
            despues = reanudar._codigo_de_lectores(configuracion)
            ordenes = actualizar.ordenes_de_la_fuente

            def sin_preparar(fuente: str, sin: tuple[str, ...]) -> list:
                orden = ordenes(fuente, sin)
                return [item for item in orden if item.etapa != "preparar"] if fuente == "oit" else orden

            with mock.patch.object(actualizar, "ordenes_de_la_fuente", sin_preparar):
                otra_politica = reanudar._codigo_de_lectores(configuracion)
        self.assertEqual([f for f in antes if antes[f] != despues[f]], ["barcelonactiva"])
        self.assertEqual([f for f in despues if despues[f] != otra_politica[f]], ["oit"])

    def test_contratos_web_invalidan_solo_sus_lectores_declarados(self) -> None:
        """Los cuatro imports de Hechos firman su lector, incluido JSON compartido con Lecturas."""
        from plataforma_datos.ia_y_trabajo.fuentes.hechos_informe.lector import CONTRATOS

        rutas = {
            (Path(modulo.__file__).resolve().parent.relative_to(reanudar.RUNTIME) / "lector.py").as_posix()
            for _, modulo in reanudar.FUENTES_EN_ORDEN
        }
        rutas.update(CONTRATOS)
        rutas.add("plataforma_datos/comun/entrada_salida.py")
        config = SimpleNamespace(checkout=self.raiz, revision_codigo="a" * 40)
        with mock.patch.object(reanudar.subprocess, "check_output") as arbol:
            arbol.return_value = "\0".join(f"100644 blob {'1' * 40}\t{ruta}" for ruta in sorted(rutas)).encode()
            antes = reanudar._codigo_de_lectores(config)
            for ruta in (ruta for ruta in CONTRATOS if ruta.endswith(".ts")):
                with self.subTest(ruta=ruta):
                    arbol.return_value = "\0".join(
                        f"100644 blob {('2' if nombre == ruta else '1') * 40}\t{nombre}" for nombre in sorted(rutas)
                    ).encode()
                    despues = reanudar._codigo_de_lectores(config)
                    esperadas = {"hechos_informe", "lecturas"} if ruta == "src/comun/json.ts" else {"hechos_informe"}
                    self.assertEqual({f for f in antes if antes[f] != despues[f]}, esperadas)

    def test_preparar_rechaza_repeticion_de_reserva(self) -> None:
        """La misma reserva no puede volver a empezar su propio motor."""
        config = SimpleNamespace(run_id="101", revision_reserva=8, solicitud_id="nueva", reanudar_entradas=True)
        identidad = IdentidadEntradas(
            "101", "1", "nueva", 8, BASE["revisionCodigo"], BASE["sha256Manifiesto"], AHORA.date().isoformat()
        )
        with (
            mock.patch.object(lotes, "leer_ultimo_lote", return_value=identidad),
            mock.patch.object(lotes, "recuperar_lote") as recuperar,
            mock.patch.object(reanudar, "datetime", wraps=datetime) as reloj,
            self.assertRaisesRegex(ValueError, "nueva reserva"),
        ):
            reloj.now.return_value = AHORA
            reanudar.preparar_si_pedida(config, self.trabajo, {"baseOperativa": BASE}, object())
        recuperar.assert_not_called()

    def test_una_composicion_cortada_deja_el_lote_usable_sin_recibo(self) -> None:
        """El supervisor confirma el lote antes del corte, y otra reserva recupera los bytes exactos."""
        fixture = fixture_lotes.PruebaLotesDeEntradas()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        base_sellada, identidad_base = fixture._copia_base()
        base = {"revisionCodigo": identidad_base.revision_base, "sha256Manifiesto": identidad_base.sha256_base}
        modulo = LOTES["tich"]
        shutil.copytree(fixture.caso.raiz, self.raiz, dirs_exist_ok=True)
        admitido = b'{"anio":"2027"}'
        (self.raiz / carpetas(modulo)[2] / "tich.json").write_bytes(admitido)
        shutil.copytree(base_sellada, self.trabajo / "generacion-base")
        punto = self.trabajo / reanudar.PUNTO_DE_CORTE
        trabajo_nuevo = self.trabajo / "segunda-reserva"
        shutil.copytree(base_sellada, trabajo_nuevo / "generacion-base")
        primero = SimpleNamespace(run_id="100", revision_reserva=7, solicitud_id=identidad_base.solicitud_id)
        luego = SimpleNamespace(
            run_id="101",
            revision_reserva=8,
            solicitud_id="e94ce173-13c4-410b-8c45-a19c524da027",
            reanudar_entradas=True,
        )
        referencia = {"baseOperativa": base, "trabajo": None}
        almacen = fixture.caso.almacen
        observada = datetime.fromisoformat(OBSERVADA)
        ciclo = comprobaciones_remotas.iniciar_ciclo(self.raiz, observada, "manual")
        comprobaciones_remotas.iniciar_fuente(self.raiz, ciclo, "tich", ("tich",), observada, remoto=True)
        recibo = evidencia()
        recibo.update(fuente="tich", comienzo_utc=OBSERVADA, fin_utc=OBSERVADA)
        recibo["peticiones"][0]["completado_utc"] = OBSERVADA
        comprobaciones_remotas.terminar_fuente(
            self.raiz,
            ciclo,
            "tich",
            observada + timedelta(seconds=1),
            resultado="comprobada",
            evidencia=recibo,
            comprobados=("tich",),
        )
        with (
            mock.patch.object(reanudar, "datetime", wraps=datetime) as reloj,
            mock.patch.object(reanudar, "segundos_hasta_la_hora_limite", return_value=9000),
            mock.patch.object(reanudar, "_codigo_de_lectores", return_value=self.lectores),
        ):
            reloj.now.return_value = AHORA
            with (
                self.assertRaisesRegex(InterruptedError, "componiendo"),
                reanudar.conservar_antes_del_paquete(primero, self.trabajo, base, almacen),
            ):
                reanudar.marcar_y_esperar(punto, {"tich": actualizar.ResultadoDelModulo("verde")})
                self._cortar_composicion()
            reanudar.preparar_si_pedida(luego, trabajo_nuevo, referencia, almacen)
        recuperada = trabajo_nuevo / reanudar.CARPETA
        lectura = json.loads((recuperada / "tich/entrada.json").read_text())
        self.assertEqual((lectura["runId"], lectura["observadoEn"]), ("100", OBSERVADA))
        self.assertEqual((recuperada / "contenido" / carpetas(modulo)[2] / "tich.json").read_bytes(), admitido)
        self.assertFalse((self.trabajo / "recibo-candidato.json").exists())
        self._publicar_la_observacion_original(trabajo_nuevo, modulo, ciclo)

    def _publicar_la_observacion_original(self, trabajo: Path, modulo: Modulo, ciclo_original: str) -> None:
        raiz, area = trabajo / "candidato", trabajo / "area"
        base = trabajo / "generacion-base" / "contenido"
        shutil.copytree(base, raiz)
        shutil.copytree(base, area)
        ciclo_nuevo = comprobaciones_remotas.iniciar_ciclo(raiz, AHORA, "manual")
        self.assertIn("tich", seguimiento_de_comprobaciones.plan_desde_registro(raiz, AHORA).fuentes)
        ejecutor = mock.Mock(side_effect=AssertionError("La consulta ya ocurrió"))
        with mock.patch.object(actualizar, "MODULOS", (modulo,)):
            actualizar.ejecutar_modulos(
                raiz, area, ejecutor, actualizar.Opciones(entradas_recuperadas=trabajo / reanudar.CARPETA)
            )
        ejecutor.assert_not_called()
        registro = comprobaciones_remotas.leer_registro(raiz)
        self.assertEqual(registro["ultimo_ciclo"]["id"], ciclo_nuevo)
        self.assertEqual(registro["fuentes"]["tich"]["ciclo"], ciclo_original)
        self.assertEqual(registro["fuentes"]["tich"]["evidencia"]["fin_utc"], OBSERVADA)
        self.assertEqual(registro["fuentes"]["tich"]["comprobados"], ["tich"])
        fichas = raiz / "var/actualizacion/preparados/abierta/fichas.json"
        fichas.parent.mkdir(parents=True)
        fichas.write_text('{"fichas":[],"plataformas":{}}')
        panel = estado_panel.estado_panel(raiz, AHORA)
        conjuntos = {fila["id"]: fila for fila in panel["comprobaciones"]["conjuntos"]}
        comprobacion = conjuntos["tich"]["ultimaComprobacion"]
        self.assertEqual(comprobacion["fecha"], "2026-11-26T14:00:01Z")
        self.assertEqual(comprobacion["ciclo"], ciclo_original)
        self.assertNotIn("tich", seguimiento_de_comprobaciones.plan_desde_registro(raiz, AHORA).fuentes)

    @staticmethod
    def _cortar_composicion() -> None:
        raise InterruptedError("componiendo")

    def test_no_se_compone_si_no_se_confirma_el_lote(self) -> None:
        """Una negativa del supervisor para el candidato antes del paquete."""
        punto = self.trabajo / reanudar.PUNTO_DE_CORTE
        with (
            mock.patch.object(reanudar, "segundos_hasta_la_hora_limite", return_value=9000),
            mock.patch.object(reanudar, "_conservar", side_effect=OSError()),
            reanudar.conservar_antes_del_paquete(
                SimpleNamespace(run_id="100", revision_reserva=7, solicitud_id="vieja"),
                self.trabajo,
                BASE,
                mock.Mock(),
            ),
            self.assertRaisesRegex(ValueError, "antes del paquete"),
        ):
            reanudar.marcar_y_esperar(punto, {"oit": actualizar.ResultadoDelModulo("verde")})

    def test_el_checkpoint_respeta_el_menor_plazo(self) -> None:
        """El candidato expira a los ocho minutos o antes si solo queda el margen del motor."""
        for disponibles, espera in ((9000, 480), (90, 75), (10, 0)):
            punto = self.trabajo / reanudar.PUNTO_DE_CORTE
            with (
                self.subTest(segundos_disponibles=disponibles),
                mock.patch.object(reanudar, "segundos_hasta_la_hora_limite", return_value=disponibles),
                mock.patch.object(reanudar.time, "monotonic", side_effect=(20, 20 + espera)),
                self.assertRaisesRegex(ValueError, "antes del paquete"),
            ):
                reanudar.marcar_y_esperar(punto, {"oit": actualizar.ResultadoDelModulo("verde")})
            self.assertEqual(json.loads(punto.read_text())["plazo"], 20 + espera)

    def test_la_etapa_verde_sin_peticiones_guarda_admision_y_no_frescura(self) -> None:
        """Una recepción vacía conserva la entrada admitida sin acreditar frescura de un conjunto."""
        instante = datetime.fromisoformat(OBSERVADA)
        ciclo = comprobaciones_remotas.iniciar_ciclo(self.raiz, instante, "manual")
        comprobaciones_remotas.iniciar_fuente(self.raiz, ciclo, "formacion", ("soc-oferta",), instante, remoto=True)
        recibo = evidencia(peticiones=False)
        recibo.update(comienzo_utc=OBSERVADA, fin_utc=OBSERVADA)
        terminado = instante + timedelta(seconds=1)
        comprobaciones_remotas.terminar_fuente(
            self.raiz, ciclo, "formacion", terminado, resultado="parcial", evidencia=recibo
        )
        filas = reanudar._fuentes_observadas(self.trabajo, ["formacion"], instante.date().isoformat())
        self.assertEqual(filas, {"formacion": reanudar.Observacion("2026-11-26T14:00:01Z", None, False)})
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz)["conjuntos"], {})

    def test_observacion_parcial_no_amplia_cobertura_ni_retrocede_una_consulta(self) -> None:
        """Mantiene solo los conjuntos acreditados y no pisa una consulta posterior de la misma fuente."""
        origen = self.trabajo / "origen"
        origen.mkdir()
        instante = datetime.fromisoformat(OBSERVADA)
        conjuntos = ("soc-oferta", "formacion-catalogos")
        ciclo = comprobaciones_remotas.iniciar_ciclo(origen, instante, "manual")
        comprobaciones_remotas.iniciar_fuente(origen, ciclo, "formacion", conjuntos, instante, remoto=True)
        recibo = evidencia()
        recibo.update(comienzo_utc=OBSERVADA, fin_utc=OBSERVADA)
        recibo["peticiones"][0]["completado_utc"] = OBSERVADA
        comprobaciones_remotas.terminar_fuente(
            origen, ciclo, "formacion", instante, resultado="parcial", evidencia=recibo, comprobados=("soc-oferta",)
        )
        historica = comprobaciones_remotas.leer_registro(origen)["fuentes"]["formacion"]
        nuevo = comprobaciones_remotas.iniciar_ciclo(self.raiz, AHORA, "manual")
        observacion_de_entradas.recuperar_observacion_remota(self.raiz, "formacion", historica, OBSERVADA)
        registro = comprobaciones_remotas.leer_registro(self.raiz)
        self.assertEqual(set(registro["conjuntos"]), {"soc-oferta"})
        self.assertEqual(registro["fuentes"]["formacion"]["resultado"], "parcial")
        comprobaciones_remotas.iniciar_fuente(self.raiz, nuevo, "formacion", conjuntos, AHORA, remoto=True)
        comprobaciones_remotas.terminar_fuente(self.raiz, nuevo, "formacion", AHORA, resultado="fallo", evidencia=None)
        anterior = comprobaciones_remotas.leer_registro(self.raiz)
        observacion_de_entradas.recuperar_observacion_remota(self.raiz, "formacion", historica, OBSERVADA)
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz), anterior)

    def test_base_de_un_rechazo_conservado_se_comprueba_en_un_solo_plazo(self) -> None:
        """La referencia puede haber avanzado a ese rechazado; solo su propia base y lote habilitan reusar."""
        solicitud = "e94ce173-13c4-410b-8c45-a19c524da027"
        identidad = IdentidadEntradas(
            "100", "1", solicitud, 7, BASE["revisionCodigo"], BASE["sha256Manifiesto"], AHORA.date().isoformat()
        )
        avance = {"revisionCodigo": "5" * 40, "sha256Manifiesto": "6" * 64}
        referencia = {
            "trabajo": {"solicitudId": solicitud, "revisionReserva": 7, "runId": "100"},
            "baseOperativa": avance,
            "ultimaValidada": BASE,
        }
        config = SimpleNamespace(run_id="101", revision_reserva=8, solicitud_id="nueva", reanudar_entradas=True)
        descriptor = {"base": BASE, "generacion": avance}
        entrada = {"observadoEn": OBSERVADA, "lectorSha256": self.lectores["oit"]}
        ambitos = []

        @contextmanager
        def limitar(plazo: float) -> Iterator[None]:
            ambitos.append(plazo)
            self.assertEqual(len(ambitos), 1)
            yield

        almacen = SimpleNamespace(limitar_hasta=limitar)
        with (
            mock.patch.object(reanudar, "datetime", wraps=datetime) as reloj,
            mock.patch.object(reanudar.time, "monotonic", return_value=40),
            mock.patch.object(reanudar, "_codigo_de_lectores", return_value=self.lectores),
            mock.patch.object(lotes, "leer_ultimo_lote", side_effect=[None, identidad]) as leer_lote,
            mock.patch.object(
                almacen_trabajos, "recuperar_trabajo", return_value=(descriptor, b'{"resultado":"rechazado"}')
            ) as leer_recibo,
            mock.patch.object(almacen_generaciones, "recuperar_generacion") as recuperar_base,
            mock.patch.object(lotes, "recuperar_lote", return_value={"oit": entrada}) as recuperar,
        ):
            reloj.now.return_value = AHORA
            reanudar.preparar_si_pedida(config, self.trabajo, referencia, almacen)
        self.assertEqual(ambitos, [40 + 480 - 15])
        leer_recibo.assert_called_once_with(solicitud, 7, "100", almacen)
        self.assertEqual(leer_lote.call_args.args[:2], (identidad.revision_base, identidad.sha256_base))
        base = self.trabajo / "generacion-base-entradas"
        recuperar_base.assert_called_once_with(base, identidad.revision_base, identidad.sha256_base, almacen)
        self.assertEqual(recuperar.call_args.kwargs["base_sellada"], base)
        with (
            mock.patch.object(lotes, "leer_ultimo_lote", side_effect=[None, replace(identidad, run_id="99")]),
            mock.patch.object(
                almacen_trabajos, "recuperar_trabajo", return_value=(descriptor, b'{"resultado":"rechazado"}')
            ),
        ):
            self.assertEqual(reanudar._buscar_lote(referencia, identidad.dia, almacen), (None, avance))

    def test_candidato_reanudado_pasa_las_mismas_guardias_del_paquete(self) -> None:
        """Reutilizar la entrada omite su descarga pero no el cotejo que autoriza un candidato."""
        from plataforma_datos.orquestacion import candidato
        from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
        from plataforma_datos.orquestacion.pruebas.test_candidato import EjecutorCandidato, preparar

        raiz = self.trabajo / "entrega"
        preparar(raiz)
        self.plan_para(LOTES["oit"])
        (self.plan / "contenido" / carpetas(LOTES["oit"])[2] / "v.json").write_text("admitido oit")
        ejecutor = EjecutorCandidato()
        with mock.patch.object(actualizar.time, "sleep"):
            recibo = candidato.ejecutar_candidato(raiz, "actualizar-datos", ejecutor, entradas_recuperadas=self.plan)
        self.assertEqual(recibo["resultado"], "validado")
        self.assertNotIn(("oit", "descargar"), map(etapa_de_fuente, ejecutor.ordenes))
        ordenes = [tuple(orden) for orden in ejecutor.ordenes]
        for paso in (
            actualizar.EXPORTAR_EL_PAQUETE,
            actualizar.COMPONER_EL_CATALOGO,
            actualizar.COTEJO_DE_ARTEFACTOS,
            actualizar.COMPROBACIONES[0],
        ):
            self.assertIn(tuple(paso.orden), ordenes)

    def test_una_ronda_solo_local_sigue_hasta_el_paquete_sin_almacenar_lote(self) -> None:
        """El motor valida el paquete aunque la ronda no admita originales remotos elegibles."""
        from plataforma_datos.orquestacion import candidato
        from plataforma_datos.orquestacion.pruebas.test_candidato import EjecutorCandidato, preparar

        raiz = self.trabajo / "entrega-local"
        preparar(raiz)
        ejecutor = EjecutorCandidato()
        configuracion = SimpleNamespace(run_id="100", revision_reserva=7, solicitud_id="sin-remotos")
        with (
            mock.patch.object(actualizar, "MODULOS", (LOTES["hechos_informe"],)),
            mock.patch.object(reanudar, "segundos_hasta_la_hora_limite", return_value=None),
            mock.patch.object(diario_mantenimiento, "anotar") as anotar,
            mock.patch.object(lotes, "guardar_lote") as guardar,
            reanudar.conservar_antes_del_paquete(configuracion, self.trabajo, BASE, object()),
        ):
            recibo = candidato.ejecutar_candidato(
                raiz,
                "actualizar-datos",
                ejecutor,
                punto_de_corte_entradas=self.trabajo / reanudar.PUNTO_DE_CORTE,
            )
        self.assertEqual(recibo["resultado"], "validado")
        self.assertIn(actualizar.COMPONER_EL_CATALOGO.orden, [tuple(orden) for orden in ejecutor.ordenes])
        guardar.assert_not_called()
        anotar.assert_any_call("lote-entradas", "omitido", motivo="sin-fuentes-remotas-elegibles")
