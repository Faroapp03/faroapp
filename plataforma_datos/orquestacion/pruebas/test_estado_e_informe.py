"""Regresiones de estado/informe con archivos propios, sin datos operativos ni avisos externos."""

import json
import os
import shlex
import signal
import tempfile
import time
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion import estado_de_los_datos as doctor
from plataforma_datos.orquestacion import informe_de_la_actualizacion as informe
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, Comparacion
from plataforma_datos.orquestacion.pruebas.test_estado_panel import documento


class PruebaEstadoEInforme(unittest.TestCase):
    """Un estado defectuoso no sustituye el anterior ni altera los reintentos silenciosamente."""

    def setUp(self) -> None:
        """Una raíz Unicode exclusiva de cada prueba."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        self.carpeta = self.raiz / CARPETA_DE_INFORMES
        self.carpeta.mkdir(parents=True)
        self.ruta = self.carpeta / estado.ARCHIVO
        self.ahora = datetime(2026, 10, 15, 5, tzinfo=UTC)

    def escribir(self, datos: object) -> None:
        """El documento que leerá la API pública."""
        self.ruta.write_text(json.dumps(datos), encoding="utf-8")

    def test_escritor_versiona_y_conserva_modulos_sin_ejecutar(self) -> None:
        """Una escritura nueva declara contrato y no inventa actualización de Biblioteca."""
        estado.registrar_estado(
            self.raiz, {}, estado.Intento(self.ahora, estado.VERDE, self.carpeta / "previo.md"), mock.Mock()
        )
        intento = estado.Intento(self.ahora, estado.VERDE, self.carpeta / "informe.md")
        estado.registrar_estado(self.raiz, {}, intento, lambda *_args: None)
        datos = json.loads(self.ruta.read_text())
        self.assertEqual(datos["version"], estado.VERSION_REGISTRO)
        self.assertEqual(datos["modulos"]["lecturas"], estado.SIN_INTENTO)
        self.assertEqual(datos["modulos"]["tich"], estado.SIN_INTENTO)

    def test_repetir_mismo_intento_no_cuenta_ni_escribe_ni_avisa(self) -> None:
        """Reanudar la misma operación conserva su contador, plazo y bytes ya publicados."""
        intento = estado.Intento(self.ahora, estado.AMBAR, self.carpeta / "informe.md")
        resultados = {"tich": estado.ResultadoDelModulo(estado.AMBAR, "fallo sintético")}
        aviso = mock.Mock()
        estado.registrar_estado(self.raiz, resultados, intento, aviso)
        antes = self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns
        with mock.patch.object(estado, "escribir_atomico", wraps=estado.escribir_atomico) as escribir:
            estado.registrar_estado(self.raiz, resultados, intento, aviso)
        self.assertEqual((self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns), antes)
        self.assertEqual(estado.leer_estado(self.raiz)["tich"]["fallos_seguidos"], 1)
        self.assertEqual(aviso.call_count, 1)
        escribir.assert_not_called()

    def test_mismo_intento_con_resultado_contradictorio_no_modifica_estado(self) -> None:
        """La identidad de una operación no admite sustituir el resultado ya aplicado."""
        intento = estado.Intento(self.ahora, estado.AMBAR, self.carpeta / "informe.md")
        estado.registrar_estado(
            self.raiz, {"tich": estado.ResultadoDelModulo(estado.AMBAR, "primero")}, intento, mock.Mock()
        )
        antes = self.ruta.read_bytes()
        for resultado in (
            estado.ResultadoDelModulo(estado.AMBAR, "otro motivo"),
            estado.ResultadoDelModulo(estado.VERDE),
            estado.ResultadoDelModulo(estado.AMBAR, "primero", "a" * 64),
        ):
            with self.subTest(resultado=resultado), self.assertRaisesRegex(FormatoInesperado, "mismo intento"):
                estado.registrar_estado(self.raiz, {"tich": resultado}, intento, mock.Mock())
            self.assertEqual(self.ruta.read_bytes(), antes)
        with self.assertRaisesRegex(FormatoInesperado, "mismo intento"):
            estado.registrar_estado(self.raiz, {}, intento._replace(veredicto=estado.ROJO), mock.Mock())
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_mismo_intento_no_admite_omitir_resultados_o_publicacion(self) -> None:
        """Replay significa la misma entrada completa, no una proyección parcial compatible."""
        intento = estado.Intento(self.ahora, estado.VERDE, self.carpeta / "informe.md")
        originales = {"tich": estado.ResultadoDelModulo(estado.VERDE, publicado="a" * 64)}
        estado.registrar_estado(self.raiz, originales, intento, mock.Mock())
        antes = self.ruta.read_bytes()
        for parciales in ({}, {"tich": estado.ResultadoDelModulo(estado.VERDE)}):
            with self.subTest(parciales=parciales), self.assertRaisesRegex(FormatoInesperado, "mismo intento"):
                estado.registrar_estado(self.raiz, parciales, intento, mock.Mock())
            self.assertEqual(self.ruta.read_bytes(), antes)

    def test_legacy_no_se_lee_ni_se_migra_al_registrar_otro_intento(self) -> None:
        """La actualización no altera un documento histórico ni inventa su huella."""
        from plataforma_datos.orquestacion.pruebas.test_migrar_estado_actualizacion import historico

        self.escribir(historico(3))
        antes = self.ruta.read_bytes()
        intento = estado.Intento(self.ahora, estado.AMBAR, self.carpeta / "informe.md")
        with self.assertRaisesRegex(FormatoInesperado, "migrar explícitamente"):
            estado.registrar_estado(self.raiz, {}, intento, mock.Mock())
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_estado_v5_sin_huella_valida_no_se_repara(self) -> None:
        """Un documento v5 no puede volver a un estado legado al perder su huella del payload."""
        intento = estado.Intento(self.ahora, estado.VERDE, self.carpeta / "informe.md")
        estado.registrar_estado(self.raiz, {}, intento, mock.Mock())
        valido = json.loads(self.ruta.read_text())
        for huella in (None, "a" * 63, "A" * 64, True):
            with self.subTest(huella=huella):
                datos = {**valido, "actualizacion": {**valido["actualizacion"], "huella_resultados": huella}}
                self.escribir(datos)
                antes = self.ruta.read_bytes()
                with self.assertRaisesRegex(FormatoInesperado, "huella"):
                    estado.registrar_estado(self.raiz, {}, intento, mock.Mock())
                self.assertEqual(self.ruta.read_bytes(), antes)

    def test_payload_canonico_no_depende_del_orden_de_modulos(self) -> None:
        """Reordenar claves no es otra operación; omitir un valor sí lo es."""
        resultados = {"tich": estado.ResultadoDelModulo(estado.VERDE), "censo": estado.ResultadoDelModulo(estado.VERDE)}
        intento = estado.Intento(self.ahora, estado.VERDE, self.carpeta / "informe.md")
        estado.registrar_estado(self.raiz, resultados, intento, mock.Mock())
        antes = self.ruta.read_bytes()
        estado.registrar_estado(self.raiz, dict(reversed(tuple(resultados.items()))), intento, mock.Mock())
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_otro_informe_mismo_segundo_es_otro_intento(self) -> None:
        """No se deduplican dos operaciones reales por coincidir sus instantes o contenido."""
        resultados = {"tich": estado.ResultadoDelModulo(estado.AMBAR, "mismo fallo")}
        for nombre in ("primero.md", "segundo.md"):
            estado.registrar_estado(
                self.raiz, resultados, estado.Intento(self.ahora, estado.AMBAR, self.carpeta / nombre), mock.Mock()
            )
        self.assertEqual(estado.leer_estado(self.raiz)["tich"]["fallos_seguidos"], 2)
        self.assertEqual(
            json.loads(self.ruta.read_text())["actualizacion"]["informe"],
            (self.carpeta / "segundo.md").relative_to(self.raiz).as_posix(),
        )

    def test_escritor_rechaza_version_desconocida_sin_modificarla(self) -> None:
        """Una actualización no convierte un contrato nuevo en un registro conocido."""
        intento = estado.Intento(self.ahora, estado.VERDE, self.carpeta / "informe.md")
        for version in (1, 6, True, "5", None):
            with self.subTest(version=version):
                self.escribir({"version": version, "modulos": {}})
                antes = self.ruta.read_bytes()
                with self.assertRaisesRegex(FormatoInesperado, "versión"):
                    estado.registrar_estado(self.raiz, {}, intento, lambda *_args: None)
                self.assertEqual(self.ruta.read_bytes(), antes)

    def test_escritor_no_repara_inventario_versionado_incompleto(self) -> None:
        """Perder un módulo o su veredicto no borra el incidente rellenando SIN_INTENTO."""
        from plataforma_datos.orquestacion.pruebas.test_estado_panel import documento

        intento = estado.Intento(self.ahora, estado.VERDE, self.carpeta / "informe.md")
        for caso in ("tich", "lecturas", "enlaces_lecturas", "ajeno", "campo"):
            with self.subTest(caso=caso):
                datos = {"version": 3, **documento()}
                if caso in ("tich", "lecturas", "enlaces_lecturas"):
                    del datos["modulos"][caso]
                elif caso == "ajeno":
                    datos["modulos"]["ajeno"] = dict(estado.SIN_INTENTO)
                else:
                    del datos["modulos"]["tich"]["veredicto"]
                self.escribir(datos)
                antes = self.ruta.read_bytes()
                with self.assertRaises(FormatoInesperado):
                    estado.registrar_estado(self.raiz, {}, intento, lambda *_args: None)
                self.assertEqual(self.ruta.read_bytes(), antes)

    def test_estado_migrado_conserva_fallos_fechas_y_reintentos_al_registrar_otro_intento(self) -> None:
        """Una operación real nueva conserva los módulos omitidos del estado migrado."""
        from plataforma_datos.orquestacion import migrar_estado_actualizacion as migracion
        from plataforma_datos.orquestacion.pruebas.test_migrar_estado_actualizacion import historico

        anterior = migracion._convertir(historico(2), "a" * 64)
        self.escribir(anterior)
        intento = estado.Intento(self.ahora + timedelta(days=2), estado.VERDE, self.carpeta / "informe.md")
        avisos = []
        estado.registrar_estado(self.raiz, {}, intento, lambda *args: avisos.append(args))
        despues = json.loads(self.ruta.read_text())
        self.assertEqual(despues["version"], estado.VERSION_REGISTRO)
        self.assertEqual(despues["modulos"], anterior["modulos"])
        self.assertEqual(avisos, [])

    def test_migracion_v2_no_repara_perdidas_del_registro_anterior(self) -> None:
        """La ampliación permitida no oculta un módulo antiguo ausente o uno nuevo espurio."""
        from plataforma_datos.orquestacion.pruebas.test_estado_panel import documento

        for caso in ("lecturas", "consorci", "enlaces_lecturas"):
            with self.subTest(caso=caso):
                anterior = documento()
                anterior["version"] = 2
                if caso != "enlaces_lecturas":
                    del anterior["modulos"]["enlaces_lecturas"]
                    del anterior["modulos"][caso]
                self.escribir(anterior)
                antes = self.ruta.read_bytes()
                with self.assertRaises(FormatoInesperado):
                    estado.leer_estado(self.raiz)
                self.assertEqual(self.ruta.read_bytes(), antes)

    def test_json_roto_tiene_ruta_y_motivo(self) -> None:
        """El estado roto se diagnostica como fuente, con el archivo implicado."""
        self.ruta.write_text("{roto", encoding="utf-8")
        with self.assertRaisesRegex(FormatoInesperado, "estado.json"):
            estado.leer_estado(self.raiz)

    def test_estructuras_de_estado_se_diagnostican(self) -> None:
        """No se ignoran listas/vacíos que sustituyen el documento, los módulos o un registro."""
        for datos in ([], None, {"modulos": []}, {"modulos": {"tich": []}}):
            with self.subTest(datos=datos):
                self.escribir(datos)
                with self.assertRaisesRegex(FormatoInesperado, "estado.json"):
                    estado.leer_estado(self.raiz)

    def test_contador_defectuoso_no_sustituye_estado(self) -> None:
        """-1 eliminaba el siguiente reintento; bool/fracción/texto no son cuentas de fallos."""
        for cuenta in (-1, True, 1.5, "1"):
            with self.subTest(cuenta=cuenta):
                datos = documento()
                datos["modulos"]["tich"]["fallos_seguidos"] = cuenta
                self.escribir(datos)
                antes, avisos = self.ruta.read_bytes(), []
                intento = estado.Intento(self.ahora, estado.AMBAR, self.carpeta / "informe.md")
                with self.assertRaisesRegex(FormatoInesperado, "fallos_seguidos"):
                    estado.registrar_estado(
                        self.raiz,
                        {"tich": estado.ResultadoDelModulo(estado.AMBAR)},
                        intento,
                        lambda _raiz, mensaje, avisos=avisos: avisos.append(mensaje),
                    )
                self.assertEqual(self.ruta.read_bytes(), antes)
                self.assertEqual(avisos, [])

    def test_version_buena_defectuosa_no_rompe_doctor(self) -> None:
        """El doctor no indexa una versión buena que sea una lista o un texto."""
        for buena in ([], "huella"):
            with self.subTest(buena=buena):
                datos = documento()
                datos["modulos"]["tich"].update(veredicto=estado.AMBAR, ultima_version_buena=buena)
                self.escribir(datos)
                with self.assertRaisesRegex(FormatoInesperado, "ultima_version_buena"):
                    doctor.conservados(self.raiz)

    def test_reintento_incompleto_o_imposible_tiene_contexto(self) -> None:
        """La selección requiere un instante comparable, no una fecha sin zona ni valores ilegibles."""
        for fecha in ("2026-10-11", "2026-02-30T05:00:00+00:00", "mañana", [], 1):
            with self.subTest(fecha=fecha):
                datos = documento()
                datos["modulos"]["tich"]["proximo_reintento_utc"] = fecha
                self.escribir(datos)
                with self.assertRaisesRegex(FormatoInesperado, "tich.*proximo_reintento_utc"):
                    estado.pendientes(self.raiz, self.ahora)

    def test_espera_exige_una_cuenta_positiva(self) -> None:
        """Una cuenta nula/negativa/bool no se convierte en una espera de ocho días."""
        for cuenta in (0, -1, True, 1.5):
            with self.subTest(cuenta=cuenta), self.assertRaises(ValueError):
                estado.espera(cuenta)

    def test_informe_crea_ruta_anidada(self) -> None:
        """La escritura directa funciona también antes del primer cerrojo de la actualización."""
        with mock.patch.object(informe, "CARPETA_DE_INFORMES", "nivel uno/ejecuciones"):
            resumen = informe.Resumen("verde", [], Comparacion(None, [], []), [], 0.0)
            ruta = informe.escribir_informe(self.raiz, resumen, self.ahora)
        self.assertTrue(ruta.is_file())
        self.assertTrue(ruta.with_suffix(".json").is_file())

    def test_informe_doctor_defectuoso_tiene_contexto(self) -> None:
        """El último informe debe llevar los dos campos públicos que lee el doctor."""
        ruta = self.carpeta / "2026-10-15-050000.json"
        for datos in ([], {}, {"veredicto": [], "utc": 7}):
            with self.subTest(datos=datos):
                ruta.write_text(json.dumps(datos), encoding="utf-8")
                with self.assertRaisesRegex(FormatoInesperado, ruta.name):
                    doctor.ultima_actualizacion(self.raiz)

    def test_aviso_con_plazo_cierra_su_hijo(self) -> None:
        """Un aviso sintético que agota el plazo no deja a su hijo ejecutándose."""
        archivo_pid = self.raiz / "hijo.json"
        gancho = self.raiz / "aviso sintético.sh"
        gancho.write_text(
            "#!/bin/sh\n/bin/sleep 20 </dev/null >/dev/null 2>&1 &\nhijo=$!\n"
            f'printf \'{{"padre":%s,"hijo":%s}}\' "$$" "$hijo" > {shlex.quote(str(archivo_pid))}\n'
            'wait "$hijo"\n',
            encoding="utf-8",
        )
        gancho.chmod(0o700)

        def vivo(pid: int) -> bool:
            """Consulta exclusivamente el PID propio que escribió el gancho de esta prueba.

            Returns:
                True si el PID sigue presente.
            """
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return False
            return True

        hijo = None
        try:
            with (
                mock.patch.dict(os.environ, {estado.VARIABLE_DEL_AVISO: str(gancho)}),
                mock.patch.object(estado, "SEGUNDOS_DEL_AVISO", 3.0),
            ):
                estado.avisar(self.raiz, "aviso sintético local")
            datos = json.loads(archivo_pid.read_text())
            self.pid_del_aviso, self.pid_hijo_del_aviso = datos["padre"], datos["hijo"]
            hijo = self.pid_hijo_del_aviso
            limite = time.monotonic() + 3
            while vivo(hijo) and time.monotonic() < limite:
                time.sleep(0.02)
            self.assertFalse(vivo(self.pid_del_aviso))
            self.assertFalse(vivo(hijo), "El descendiente del aviso sobrevivió a su plazo")
            texto = (self.carpeta / estado.ARCHIVO_DE_AVISOS).read_text()
            self.assertTrue(texto.startswith("aviso sintético local (la orden de aviso falló: "))
            self.assertIn("timed out", texto)
        finally:
            # También en rojo se retira únicamente el hijo identificado por el gancho propio.
            if hijo is not None and vivo(hijo):
                os.kill(hijo, signal.SIGKILL)
