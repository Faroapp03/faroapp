"""Composición Git/generación/validador reales; motor interceptado sin descargas ni secretos."""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import ejecutor_operativo as ejecutor
from plataforma_datos.orquestacion.actualizar import ENTORNO_HEREDADO
from plataforma_datos.orquestacion.almacen_generaciones import guardar_generacion, recuperar_generacion
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3NoDisponible
from plataforma_datos.orquestacion.almacen_trabajos import (
    REFERENCIA,
    inicializar_referencia,
    leer_referencia,
)
from plataforma_datos.orquestacion.cliente_mantenimiento import ErrorMantenimiento
from plataforma_datos.orquestacion.contrato_de_trabajos import _bytes
from plataforma_datos.orquestacion.controles_confirmados import escribir_confirmado
from plataforma_datos.orquestacion.generacion_operativa import ESTADO, exportar_generacion, restaurar_generacion
from plataforma_datos.orquestacion.hora_limite_del_motor import ARCHIVO as PARADA
from plataforma_datos.orquestacion.hora_limite_del_motor import VARIABLE as HORA_LIMITE
from plataforma_datos.orquestacion.levantar_bloqueo import levantar_bloqueo
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COMPLETAR_RENOMBRES, SI
from plataforma_datos.orquestacion.pruebas.test_almacen_artefactos import serializar, sha
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import SOLICITUD, Memoria, snapshot
from plataforma_datos.orquestacion.pruebas.test_aprovisionar_candidato import git
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import preparar
from plataforma_datos.orquestacion.salud_mantenimiento import diagnostico

INDICE = f"trabajos/{SOLICITUD}/1/123.json"

REVISION_BASE = "b" * 40


def privadas(entorno: dict, prefijos: tuple[str, ...]) -> list[str]:
    """Las variables de esos prefijos que llegan a una orden sin que el producto las declare heredables.

    Returns:
        Sus nombres; vacío si solo llegan las de ENTORNO_HEREDADO.
    """
    return [nombre for nombre in entorno if nombre.startswith(prefijos) and nombre not in ENTORNO_HEREDADO]


class Cliente:
    """Solo confirma tras la referencia durable; puede perder el acuse de la llamada de retorno."""

    def __init__(self, almacen: Memoria) -> None:
        self.almacen = almacen
        self.inicios: list[tuple] = []
        self.recibos: list[bytes] = []
        self.cierres: list[dict] = []
        self.inicio = "aplicado"
        self.perder = False
        self.cierre_falla = False

    def confirmar_inicio(self, *argumentos: object) -> str:
        """Registra una llamada de permiso.

        Returns:
            Respuesta controlada del receptor.
        """
        self.inicios.append(argumentos)
        return self.inicio

    def enviar_resultado(self, recibo: bytes) -> str:
        """Comprueba que la CAS precede a la llamada de retorno.

        Returns:
            Acuse confirmado cuando no se pierde la respuesta.

        Raises:
            OSError: Respuesta incierta después del envío.
            ErrorMantenimiento: Si se pide que falle el cierre sin recibo.
        """
        if "ultimoFallo" in json.loads(recibo):
            # El cierre sin recibo no va precedido de ninguna conservación: solo dice por qué no terminó.
            self.cierres.append(json.loads(recibo))
            if self.cierre_falla:
                raise ErrorMantenimiento("sin respuesta")
            return "aplicado"
        documento = leer_referencia(self.almacen)
        assert documento["trabajo"]["solicitudId"] == json.loads(recibo)["solicitudId"]
        self.recibos.append(recibo)
        if self.perder:
            raise OSError("respuesta incierta")
        return "aplicado"


class PruebaEjecutorOperativo(unittest.TestCase):
    """El motor no se repite y cada resultado espera conservación verificable."""

    def setUp(self) -> None:
        """Checkout Git pequeño, dependencias privadas y generación sintética completa."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve()
        self.checkout = self.raiz / "Código Año 2026"
        self.checkout.mkdir()
        git(self.checkout, "init", "-q")
        validador = self.checkout / ejecutor.VALIDADOR
        validador.parent.mkdir(parents=True)
        validador.write_text(
            f"import {{ comprobarRecibo }} from {json.dumps((RAIZ / ejecutor.VALIDADOR).as_uri())};\n"
            "comprobarRecibo(process.argv[2]);\n",
            encoding="utf-8",
        )
        exportador = self.checkout / ejecutor.EXPORTADOR
        exportador.parent.mkdir(parents=True)
        exportador.write_text("// La prueba intercepta solo la construcción, no sus verificadores.\n", encoding="utf-8")
        git(self.checkout, "add", ".")
        git(self.checkout, "commit", "-qm", "Fixture privada")
        revision = git(self.checkout, "rev-parse", "HEAD")
        (self.checkout / ".venv/bin").mkdir(parents=True)
        (self.checkout / ".venv/bin/python").symlink_to(sys.executable)
        (self.checkout / "node_modules").mkdir()
        self.trabajo = self.raiz / "Trabajo separado"
        self.trabajo.mkdir()
        self.config = ejecutor.ConfiguracionEjecutorOperativo(
            checkout=self.checkout,
            directorio_trabajo=self.trabajo,
            revision_codigo=revision,
            solicitud_id=SOLICITUD,
            revision_reserva=1,
            run_id="123",
            run_attempt="1",
            accion="actualizar-datos",
            variante_cloudflare="oficial",
        )
        self.almacen = Memoria()
        origen = self.raiz / "base original"
        preparar(origen)
        generacion = self.raiz / "base exportada"
        resumen = exportar_generacion(origen, generacion, REVISION_BASE)
        guardar_generacion(generacion, REVISION_BASE, resumen["sha256Manifiesto"], self.almacen)
        self.base = {"revisionCodigo": REVISION_BASE, "sha256Manifiesto": resumen["sha256Manifiesto"]}
        self.inicial = inicializar_referencia(self.base, self.almacen)
        self.cliente = Cliente(self.almacen)
        self.motores: list[Path] = []
        self.exportaciones: list[Path] = []
        self.resultado = "validado"
        self.version_recibo = 1
        self.parada: str | None = None
        self.proceso_real = ejecutor.ejecutar_con_plazo
        parche = mock.patch.object(ejecutor, "ejecutar_con_plazo", side_effect=self.proceso)
        parche.start()
        self.addCleanup(parche.stop)

    def proceso(self, orden: list[str], cwd: Path, plazo: float, entorno: dict) -> subprocess.CompletedProcess:
        """Intercepta motor/construcción; los validadores y transferencias son reales.

        Returns:
            Resultado del motor sintético o del validador real.
        """
        if len(orden) > 1 and orden[1] == str(cwd / ejecutor.EXPORTADOR):
            return self.exportar_artefacto(orden, cwd, plazo, entorno)
        if "plataforma_datos.orquestacion.candidato" not in orden:
            return self.proceso_real(orden, cwd, plazo, entorno)
        self.motores.append(cwd)
        self.assertEqual(plazo, ejecutor.PLAZO_CANDIDATO_S)
        # Solo llegan las dos señales que el supervisor declara para el motor: la hora límite (la de ahora más su
        # plazo) y la del ciclo operativo, con su valor propio aunque el runner trajera otra.
        self.assertEqual(privadas(entorno, ("FARO_", "AWS_", "ACTIONS_")), [HORA_LIMITE, COMPLETAR_RENOMBRES])
        self.assertEqual(entorno[COMPLETAR_RENOMBRES], SI)
        self.assertLessEqual(abs(int(entorno[HORA_LIMITE]) - time.time() - ejecutor.PLAZO_CANDIDATO_S), 5)
        self.assertTrue(Path(entorno["HOME"]).is_relative_to(self.config.directorio_trabajo))
        self.assertNotIn("SECRETO-SENTINELA", json.dumps(orden + list(entorno.values())))
        self.assertEqual((cwd / ".venv").resolve(), self.checkout / ".venv")
        rechazo = self.resultado == "rechazado"
        cuerpo = {
            "version": self.version_recibo,
            "accion": self.config.accion,
            "resultado": self.resultado,
            "veredicto": "ámbar" if rechazo else "verde",
            "terminadoEn": snapshot()["observadoEn"],
            "estado": snapshot(),
            "huellaPaquete": None if rechazo else sha((cwd / "datos/manifiesto.json").read_bytes())[:16],
            "error": "actualizacion_no_admitida" if rechazo else None,
        }
        if self.resultado == "sin-pendientes":
            cuerpo.update(veredicto=None, huellaPaquete=None)
        if rechazo:
            estado = json.loads((cwd / ESTADO).read_bytes())
            estado["modulos"]["paquete"]["fallos_seguidos"] = 1
            estado["actualizacion"]["comienzo_utc"] = "2026-10-16T12:00:00+00:00"
            # Estado coherente real para demostrar que el siguiente intento conserva el rechazo.
            estado["modulos"]["paquete"].update(
                ultimo_intento_utc="2026-10-16T12:00:00+00:00",
                veredicto="ámbar",
                proximo_reintento_utc="2026-10-17T12:00:00+00:00",
            )
            (cwd / ESTADO).write_text(json.dumps(estado), encoding="utf-8")
        if self.parada is not None:
            parada = {
                "causa": "plazo-insuficiente",
                "paso": self.parada,
                "quedanSegundos": 60,
                "necesariosSegundos": 900,
            }
            (cwd / PARADA).parent.mkdir(parents=True, exist_ok=True)
            (cwd / PARADA).write_text(json.dumps(parada), encoding="utf-8")
        Path(orden[-1]).write_text(json.dumps(cuerpo), encoding="utf-8")
        return subprocess.CompletedProcess(orden, int(rechazo), "", "")

    def exportar_artefacto(
        self, orden: list[str], cwd: Path, plazo: float, entorno: dict
    ) -> subprocess.CompletedProcess:
        """Construcción pequeña con los mismos bytes del candidato; no compila otro Worker.

        Returns:
            Resumen del descriptor que comprobarán las CLI TS reales.
        """
        self.exportaciones.append(cwd)
        self.assertEqual(cwd, self.motores[-1])
        self.assertEqual(plazo, ejecutor.PLAZO_ARTEFACTO_S)
        self.assertEqual(privadas(entorno, ("FARO_", "AWS_", "ACTIONS_", "NODE_")), [])
        self.assertEqual(orden[1], str(cwd / "herramientas/web/construir.ts"))
        esperado = sha((cwd / "datos/manifiesto.json").read_bytes())[:16]
        self.assertEqual(
            orden[2:],
            [
                "--destino",
                str(cwd.parent / "artefacto"),
                "--revision-codigo",
                self.config.revision_codigo,
                "--huella-paquete",
                esperado,
                "--solo-nuevo",
                "--destino-cloudflare",
                self.config.variante_cloudflare,
            ],
        )
        self.assertTrue(
            any(
                k.startswith("generaciones/") and k != f"generaciones/{self.base['sha256Manifiesto']}.json"
                for k in self.almacen.objetos
            )
        )
        self.assertFalse(any(k.startswith("trabajos/") for k in self.almacen.objetos))
        manifiesto = (cwd / "datos/manifiesto.json").read_bytes()
        paquete = sha(manifiesto)[:16]
        motor = b"export const motor = 1;\n"
        archivos = {
            "worker/worker.mjs": b"import datos from './datos/uno.json'; export default datos;\n",
            "worker/datos/uno.json": (cwd / "datos/uno.json").read_bytes(),
            f"web/paquete/{paquete}/uno.json": (cwd / "datos/uno.json").read_bytes(),
            f"web/paquete/{paquete}/manifiesto.json": manifiesto,
            "web/motor/entrada.js": motor,
        }
        archivos["web/firmas/manifiesto.json"] = serializar(
            {
                "formato": 1,
                "paquete": paquete,
                "archivos": {r.removeprefix("web/"): sha(c) for r, c in archivos.items() if r.startswith("web/")},
            }
        )
        descriptor = {
            "version": 1,
            "destino": orden[-1],
            "revisionCodigo": self.config.revision_codigo,
            "huellaPaquete": paquete,
            "sha256ManifiestoPaquete": sha(manifiesto),
            "sha256ManifiestoDispositivo": sha(archivos["web/firmas/manifiesto.json"]),
            "archivos": [{"ruta": r, "bytes": len(c), "sha256": sha(c)} for r, c in sorted(archivos.items())],
        }
        destino = Path(orden[3])
        destino.mkdir()
        for relativa, contenido in archivos.items():
            ruta = destino / relativa
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_bytes(contenido)
        contenido = serializar(descriptor)
        (destino / "artefacto.json").write_bytes(contenido)
        resumen = {
            "version": 1,
            "revisionCodigo": self.config.revision_codigo,
            "huellaPaquete": paquete,
            "sha256Artefacto": sha(contenido),
            "archivos": len(archivos),
            "bytesTotales": sum(len(c) for c in archivos.values()),
        }
        return subprocess.CompletedProcess(orden, 0, json.dumps(resumen), "")

    def ejecutar(self, *, reanudar: bool = False) -> dict:
        """Ejecuta el núcleo con capacidades privadas.

        Returns:
            Resumen cerrado tras la llamada de retorno.
        """
        return ejecutor.ejecutar_trabajo(self.config, self.cliente, self.almacen, reanudar=reanudar)

    def test_validado_conserva_antes_callback_y_entorno_sin_secretos(self) -> None:
        """La composición usa revisiones distintas y confirma contenido, índice y CAS antes de la llamada de retorno."""
        # FARO_HUMO_CHROMIUM es heredable a propósito (así se apaga el humo del ciclo); los secretos, no.
        privado = {"FARO_SECRETO": "SECRETO-SENTINELA", "AWS_SECRET": "oculto", "FARO_HUMO_CHROMIUM": "0"}
        with mock.patch.dict(os.environ, privado):
            resumen = self.ejecutar()
        referencia = leer_referencia(self.almacen)
        self.assertEqual(resumen["resultado"], "validado")
        self.assertNotEqual(referencia["baseOperativa"], self.base)
        self.assertEqual(referencia["baseOperativa"], referencia["ultimaValidada"])
        self.assertEqual(len(self.motores), 1)
        self.assertEqual(json.loads(self.cliente.recibos[0])["revisionReserva"], 1)
        self.assertEqual(git(self.checkout, "rev-parse", "HEAD"), self.config.revision_codigo)
        clave = f"trabajos/{SOLICITUD}/1/123.json"
        descriptor = json.loads(self.almacen.objetos[clave])
        self.assertEqual(descriptor["version"], 2)
        artefacto = descriptor["artefacto"]
        self.assertEqual(artefacto["revisionCodigo"], self.config.revision_codigo)
        self.assertEqual(artefacto["huellaPaquete"], json.loads(self.cliente.recibos[0])["huellaPaquete"])
        self.assertIn(f"artefactos/{artefacto['sha256Artefacto']}.json", self.almacen.objetos)

    def sin_respuesta_tras_el_motor(self, fallos: int) -> None:
        """El almacén no responde a las primeras `fallos` lecturas de trabajos que llegan después del motor."""
        leer = self.almacen.leer_control
        pendientes = [fallos]

        def leer_control(clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
            if self.motores and clave.startswith("trabajos/") and pendientes[0] > 0:
                pendientes[0] -= 1
                raise AlmacenS3NoDisponible("Almacén privado no disponible.")
            return leer(clave, bytes_maximos)

        self.almacen.leer_control = leer_control

    def recibo_en_el_diario(self) -> tuple[dict, list[tuple[str, str | None]]]:
        """Ejecuta el trabajo con el diario abierto, sin las pausas de los reintentos.

        Returns:
            El resumen y los estados del paso «conservar-recibo» con su causa.
        """
        ruta = self.raiz / "diario.jsonl"
        try:
            with diario.abrir(ruta, {"run": "1"}, consola=False), mock.patch.object(diario, "PAUSAS", (0, 0)):
                resumen = self.ejecutar()
        finally:
            eventos = [json.loads(linea) for linea in ruta.read_text(encoding="utf-8").splitlines()]
            self.recibo = [(e["estado"], e.get("causa")) for e in eventos if e["fase"] == "conservar-recibo"]
        return resumen, self.recibo

    def test_un_recibo_sin_respuesta_tras_el_motor_se_reintenta_y_se_conserva(self) -> None:
        """La primera petición tras el motor no responde: el paso se repite y el recibo queda conservado una vez."""
        self.sin_respuesta_tras_el_motor(1)
        resumen, recibo = self.recibo_en_el_diario()
        self.assertEqual(resumen["resultado"], "validado")
        self.assertEqual(recibo, [("inicio", None), ("reintento", "almacen-no-disponible"), ("confirmado", None)])
        self.assertEqual(leer_referencia(self.almacen)["revisionReserva"], 1)
        self.assertEqual(len(self.cliente.recibos), 1)
        self.assertEqual(len(self.motores), 1)

    def test_un_almacen_caido_tras_el_motor_no_confirma_el_recibo(self) -> None:
        """Si el almacén sigue sin responder tras los intentos, el paso falla y no se llama al servidor."""
        self.sin_respuesta_tras_el_motor(10)
        with self.assertRaises(AlmacenS3NoDisponible):
            self.recibo_en_el_diario()
        self.assertEqual(self.recibo[-1], ("error", "almacen-no-disponible"))
        self.assertEqual([estado for estado, _ in self.recibo].count("reintento"), 2)
        self.assertEqual(self.cliente.recibos, [])
        self.assertEqual(leer_referencia(self.almacen), self.inicial)

    def no_disponible_una_vez(self, metodo: str, cuando: Callable[[str], bool], *, tras_escribir: bool = False) -> None:
        """La primera llamada de `metodo` del almacén que cumple `cuando` tras el motor no obtiene respuesta.

        Con `tras_escribir`, la escritura sí llega al almacén y solo se pierde su respuesta.
        """
        original = getattr(self.almacen, metodo)
        pendiente = [True]

        def llamada(clave: str, *argumentos: object) -> object:
            if not (self.motores and pendiente[0] and cuando(clave)):
                return original(clave, *argumentos)
            pendiente[0] = False
            if tras_escribir:
                original(clave, *argumentos)
            raise AlmacenS3NoDisponible("Almacén privado no disponible.")

        setattr(self.almacen, metodo, llamada)

    def referencia_avanzada(self) -> bool:
        """Si la referencia del almacén ya apunta a este trabajo.

        Returns:
            Verdadero tras la CAS del trabajo de la reserva 1.
        """
        return json.loads(self.almacen.objetos[REFERENCIA])["revisionReserva"] == 1

    def confirmado_una_vez(self) -> None:
        """Tras el reintento: el recibo se conservó con un solo índice, una CAS y una sola llamada al servidor."""
        self.assertEqual(self.recibo, [("inicio", None), ("reintento", "almacen-no-disponible"), ("confirmado", None)])
        self.assertEqual(leer_referencia(self.almacen)["revisionReserva"], 1)
        self.assertEqual([clave for clave in self.almacen.objetos if clave.startswith("trabajos/")], [INDICE])
        self.assertEqual(len(self.cliente.recibos), 1)
        self.assertEqual(len(self.motores), 1)

    def test_la_cas_sin_respuesta_que_no_llego_se_reintenta_y_se_conserva(self) -> None:
        """El PUT de la referencia no obtiene respuesta ni se escribe: es indisponibilidad, no conflicto."""
        self.no_disponible_una_vez("guardar_control", lambda clave: clave == REFERENCIA)
        self.recibo_en_el_diario()
        self.confirmado_una_vez()

    def test_sin_respuesta_tras_escribir_el_indice_se_repite_sin_duplicar(self) -> None:
        """El índice ya está escrito cuando el almacén deja de responder: el reintento lo reconoce y avanza la CAS."""
        self.no_disponible_una_vez("leer_control", lambda clave: clave == REFERENCIA and INDICE in self.almacen.objetos)
        self.recibo_en_el_diario()
        self.confirmado_una_vez()

    def test_el_indice_que_llega_sin_respuesta_se_confirma_por_lectura_sin_repetir(self) -> None:
        """El PUT del índice llega al almacén y su respuesta se pierde: la relectura lo confirma, sin reintento."""
        self.no_disponible_una_vez("guardar_control", lambda clave: clave == INDICE, tras_escribir=True)
        self.recibo_en_el_diario()
        self.assertEqual(self.recibo, [("inicio", None), ("confirmado", None)])
        self.assertEqual(leer_referencia(self.almacen)["revisionReserva"], 1)
        self.assertEqual([clave for clave in self.almacen.objetos if clave.startswith("trabajos/")], [INDICE])
        self.assertEqual(len(self.cliente.recibos), 1)

    def test_sin_respuesta_en_la_relectura_de_la_cas_se_repite_sin_duplicar(self) -> None:
        """La CAS ya se escribió y falla su relectura: el reintento la encuentra avanzada y no escribe nada más."""
        self.no_disponible_una_vez("leer_control", lambda clave: clave == REFERENCIA and self.referencia_avanzada())
        self.recibo_en_el_diario()
        self.confirmado_una_vez()

    def test_la_senal_del_ciclo_operativo_heredada_del_runner_se_ignora(self) -> None:
        """Solo el candidato recibe la señal, con el valor del supervisor; el resto de órdenes no la ven nunca."""
        with mock.patch.dict(os.environ, {COMPLETAR_RENOMBRES: "heredada"}):
            self.assertEqual(self.ejecutar()["resultado"], "validado")
        # El arnés (proceso y exportar_artefacto) ya comprobó el entorno de cada orden.
        self.assertEqual(len(self.motores), 1)
        self.assertEqual(len(self.exportaciones), 1)

    def test_callback_incierto_reanuda_bytes_exactos_sin_inicio_ni_motor(self) -> None:
        """El índice durable permite reenvío literal desde otra carpeta sin volver a pedir inicio."""
        self.cliente.perder = True
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.perder = False
        nueva = self.raiz / "reanudar aparte"
        nueva.mkdir()
        self.config = replace(self.config, directorio_trabajo=nueva)
        self.ejecutar(reanudar=True)
        self.assertEqual(self.cliente.recibos[0], self.cliente.recibos[1])
        self.assertEqual(len(self.motores), 1)
        self.assertEqual(len(self.cliente.inicios), 1)
        self.assertEqual(len(self.exportaciones), 1)

    def test_indice_antes_cas_reanuda_y_confirma_referencia(self) -> None:
        """Un índice ya publicado no salta la CAS que se interrumpió."""
        self.almacen.corte = (REFERENCIA, "antes")
        with self.assertRaises(ValueError):
            self.ejecutar()
        self.assertEqual(self.cliente.recibos, [])
        self.assertEqual(leer_referencia(self.almacen), self.inicial)
        self.almacen.corte = None
        self.ejecutar(reanudar=True)
        self.assertEqual(len(self.motores), 1)
        self.assertEqual(leer_referencia(self.almacen)["revisionReserva"], 1)
        self.assertEqual(len(self.exportaciones), 1)

    def test_repetido_sin_indice_no_autoriza_motor_en_otra_carpeta(self) -> None:
        """El permiso repetido puede esconder un comienzo remoto: otra carpeta no crea autorización."""
        self.cliente.inicio = "repetido"
        for nombre in ("primero", "segundo"):
            carpeta = self.raiz / nombre
            carpeta.mkdir()
            self.config = replace(self.config, directorio_trabajo=carpeta)
            with self.assertRaises(ValueError):
                self.ejecutar()
        self.assertEqual(self.motores, [])
        self.assertEqual(leer_referencia(self.almacen), self.inicial)

    def test_exportacion_fallida_no_publica_indice_cas_ni_callback(self) -> None:
        """Timeout, salida grande o contrato roto no degradan verde ni vuelven a ejecutar el motor."""
        respuestas = [
            subprocess.TimeoutExpired("privado", 1),
            subprocess.CompletedProcess([], 1, "", "SECRETO-SENTINELA"),
            subprocess.CompletedProcess([], 0, "x" * (ejecutor.MAX_RESUMEN_ARTEFACTO_BYTES + 1), ""),
            subprocess.CompletedProcess([], 0, "{}", ""),
        ]
        for numero, respuesta in enumerate(respuestas):
            carpeta = self.raiz / f"fallo-exportar-{numero}"
            carpeta.mkdir()
            self.config = replace(self.config, directorio_trabajo=carpeta)
            opciones = {"side_effect": respuesta} if isinstance(respuesta, Exception) else {"return_value": respuesta}
            with (
                self.subTest(numero=numero),
                mock.patch.object(self, "exportar_artefacto", **opciones),
                mock.patch.object(ejecutor, "guardar_artefacto") as guardar,
                self.assertRaisesRegex(ValueError, ejecutor.ERROR),
            ):
                self.ejecutar()
            guardar.assert_not_called()
            self.assertEqual(leer_referencia(self.almacen), self.inicial)
            self.assertEqual(self.cliente.recibos, [])
            self.assertFalse(any(k.startswith("trabajos/") for k in self.almacen.objetos))
            motores = len(self.motores)
            with self.assertRaises(FileExistsError):
                self.ejecutar()
            self.assertEqual(len(self.motores), motores)

    def test_resumen_otra_identidad_no_guarda_artefacto(self) -> None:
        """No toma como expectativa una revisión que declare la salida del constructor."""
        real = self.exportar_artefacto

        def cambiar(orden: list[str], cwd: Path, plazo: float, entorno: dict) -> subprocess.CompletedProcess:
            resultado = real(orden, cwd, plazo, entorno)
            resumen = json.loads(resultado.stdout)
            resumen["revisionCodigo"] = REVISION_BASE
            return subprocess.CompletedProcess(orden, 0, json.dumps(resumen), "")

        with (
            mock.patch.object(self, "exportar_artefacto", side_effect=cambiar),
            mock.patch.object(ejecutor, "guardar_artefacto") as guardar,
            self.assertRaises(ValueError),
        ):
            self.ejecutar()
        guardar.assert_not_called()
        self.assertEqual(self.cliente.recibos, [])
        self.assertEqual(leer_referencia(self.almacen), self.inicial)

    def test_resumen_otra_huella_no_guarda_artefacto_ni_cambia_recibo(self) -> None:
        """La construcción común debe coincidir con el paquete del recibo antes de conservarse."""
        real = self.exportar_artefacto

        def cambiar(orden: list[str], cwd: Path, plazo: float, entorno: dict) -> subprocess.CompletedProcess:
            resultado = real(orden, cwd, plazo, entorno)
            resumen = json.loads(resultado.stdout)
            resumen["huellaPaquete"] = "0" * 16
            return subprocess.CompletedProcess(orden, 0, json.dumps(resumen), "")

        with (
            mock.patch.object(self, "exportar_artefacto", side_effect=cambiar),
            mock.patch.object(ejecutor, "guardar_artefacto") as guardar,
            self.assertRaisesRegex(ValueError, ejecutor.ERROR),
        ):
            self.ejecutar()
        guardar.assert_not_called()
        self.assertEqual(self.cliente.recibos, [])
        self.assertEqual(leer_referencia(self.almacen), self.inicial)
        self.assertFalse(any(k.startswith(("artefactos/", "trabajos/")) for k in self.almacen.objetos))
        recibo = json.loads((self.trabajo / "run-123-1/recibo-callback.json").read_bytes())
        manifiesto = (self.trabajo / "run-123-1/candidato/datos/manifiesto.json").read_bytes()
        self.assertEqual(recibo["resultado"], "validado")
        self.assertEqual(recibo["huellaPaquete"], sha(manifiesto)[:16])
        self.assertEqual(len(self.motores), 1)

    def test_fallo_conservar_artefacto_no_indexa_ni_degrada_resultado(self) -> None:
        """Una generación guardada no sustituye la conservación completa del artefacto."""
        with (
            mock.patch.object(ejecutor, "guardar_artefacto", side_effect=OSError("no disponible")),
            self.assertRaises(OSError),
        ):
            self.ejecutar()
        self.assertEqual(self.cliente.recibos, [])
        self.assertEqual(leer_referencia(self.almacen), self.inicial)
        self.assertFalse(any(k.startswith("trabajos/") for k in self.almacen.objetos))
        recibo = json.loads((self.trabajo / "run-123-1/recibo-callback.json").read_bytes())
        self.assertEqual(recibo["resultado"], "validado")
        with self.assertRaises(FileExistsError):
            self.ejecutar()
        self.assertEqual(len(self.motores), 1)

    def test_reanudar_indice_v1_conserva_literal_sin_inventar_artefacto(self) -> None:
        """Un recibo previo conserva su índice v1; no adquiere una construcción que nunca acreditó."""
        self.ejecutar()
        clave = f"trabajos/{SOLICITUD}/1/123.json"
        descriptor = json.loads(self.almacen.objetos[clave])
        descriptor["version"] = 1
        descriptor.pop("artefacto")
        anterior = serializar(descriptor)
        self.almacen.objetos[clave] = anterior
        with (
            mock.patch.object(ejecutor, "_conservar_artefacto") as construir,
            mock.patch.object(ejecutor, "_candidato") as motor,
        ):
            self.ejecutar(reanudar=True)
        construir.assert_not_called()
        motor.assert_not_called()
        self.assertEqual(self.almacen.objetos[clave], anterior)
        self.assertEqual(self.cliente.recibos[0], self.cliente.recibos[1])
        self.assertEqual(len(self.cliente.inicios), 1)

    def test_sin_pendientes_conserva_base_sin_exportar(self) -> None:
        """No fabrica otra generación ni cambia la última validada cuando no se ejecutó una actualización."""
        self.config = replace(self.config, accion="reintentar-pendientes")
        self.resultado = "sin-pendientes"
        with mock.patch.object(ejecutor, "exportar_generacion") as exportar:
            self.ejecutar()
        exportar.assert_not_called()
        self.assertEqual(self.exportaciones, [])
        referencia = leer_referencia(self.almacen)
        self.assertEqual(referencia["baseOperativa"], self.base)
        self.assertEqual(referencia["ultimaValidada"], self.base)

    def test_validado_sin_exportacion_falla_sin_indice_cas_ni_callback(self) -> None:
        """Un recibo verde local no acredita conservación durable y queda disponible para diagnóstico."""
        with (
            mock.patch.object(ejecutor, "exportar_generacion", side_effect=ValueError("no exportable")),
            self.assertRaises(ValueError),
        ):
            self.ejecutar()
        self.assertEqual(self.cliente.recibos, [])
        self.assertEqual(leer_referencia(self.almacen), self.inicial)
        self.assertTrue((self.trabajo / "run-123-1/recibo-callback.json").is_file())
        self.assertTrue((self.trabajo / "run-123-1/motor-iniciado").is_file())
        self.assertFalse(any(k.startswith("trabajos/") for k in self.almacen.objetos))

    def test_error_transporte_no_degrada_rechazado_a_generacion_ausente(self) -> None:
        """La indisponibilidad remota no confirma un rechazo aparentemente conservado."""
        self.resultado = "rechazado"
        with (
            mock.patch.object(ejecutor, "guardar_generacion", side_effect=OSError("no disponible")),
            self.assertRaises(OSError),
        ):
            self.ejecutar()
        self.assertEqual(self.cliente.recibos, [])
        self.assertEqual(leer_referencia(self.almacen), self.inicial)

    def test_rechazado_no_exportable_no_bloquea_y_el_siguiente_arranca(self) -> None:
        """Sin generación completa se conservan ambas bases, sin bloqueo, y el ciclo siguiente arranca solo."""
        self.resultado = "rechazado"
        with mock.patch.object(ejecutor, "exportar_generacion", side_effect=ValueError("no exportable")):
            self.ejecutar()
        referencia = leer_referencia(self.almacen)
        self.assertFalse(referencia["bloqueoOperativo"])
        self.assertEqual(referencia["baseOperativa"], self.base)
        self.assertEqual(referencia["ultimaValidada"], self.base)
        self.config = replace(self.config, revision_reserva=2, run_id="124")
        self.assertEqual(self.ejecutar()["resultado"], "rechazado")
        self.assertEqual(len(self.motores), 2)
        self.assertEqual(self.exportaciones, [])

    def bloquear_por_rechazo(self) -> dict:
        """Rechazo sin generación conservable y referencia bloqueada por su trabajo, como la que hay en producción.

        Returns:
            Tupla del trabajo que ha dejado el bloqueo.
        """
        self.resultado = "rechazado"
        with mock.patch.object(ejecutor, "exportar_generacion", side_effect=ValueError("no exportable")):
            self.ejecutar()
        bloqueada = {**leer_referencia(self.almacen), "bloqueoOperativo": True}
        escribir_confirmado(REFERENCIA, _bytes(bloqueada), self.almacen.etags[REFERENCIA], self.almacen)
        self.config = replace(self.config, revision_reserva=2, run_id="124")
        return {"solicitudId": SOLICITUD, "revisionReserva": 1, "runId": "123"}

    def test_bloqueo_puesto_y_base_verificable_el_ciclo_lo_levanta_deja_el_acta_y_sigue(self) -> None:
        """El ciclo verifica la base entera, deja la misma acta que la orden manual y arranca el motor."""
        trabajo = self.bloquear_por_rechazo()
        self.assertEqual(self.ejecutar()["resultado"], "rechazado")
        self.assertEqual(len(self.motores), 2)
        acta = json.loads(self.almacen.objetos[f"desbloqueos/{SOLICITUD}/1/123.json"])
        self.assertEqual((acta["trabajo"], acta["generacion"]), (trabajo, self.base))
        self.assertEqual(acta["transicion"], "levantar-bloqueo")
        self.assertFalse(leer_referencia(self.almacen)["bloqueoOperativo"])

    def test_bloqueo_levantado_por_la_orden_admite_un_trabajo_nuevo(self) -> None:
        """Rechazo, bloqueo, negativa, orden y un trabajo nuevo que arranca sobre la misma base operativa."""
        trabajo = self.bloquear_por_rechazo()
        self.assertEqual(levantar_bloqueo(trabajo, self.almacen), "levantado")
        # La orden manual sigue valiendo; después, un rechazo con generación conservable avanza la referencia.
        self.assertEqual(self.ejecutar()["resultado"], "rechazado")
        self.assertEqual(len(self.motores), 2)
        referencia = leer_referencia(self.almacen)
        self.assertEqual(referencia["revisionReserva"], 2)
        self.assertFalse(referencia["bloqueoOperativo"])
        self.assertNotEqual(referencia["baseOperativa"], self.base)

    def test_reenvio_del_trabajo_bloqueado_se_completa_tras_levantar(self) -> None:
        """Después de la orden, el recibo del rechazo se reenvía sin motor, sin escribir ni volver a bloquear."""
        trabajo = self.bloquear_por_rechazo()
        self.assertEqual(levantar_bloqueo(trabajo, self.almacen), "levantado")
        levantada = self.almacen.objetos[REFERENCIA]
        self.config = replace(self.config, revision_reserva=1, run_id="123")
        self.almacen.eventos.clear()
        self.assertEqual(self.ejecutar(reanudar=True)["resultado"], "rechazado")
        self.assertEqual(self.cliente.recibos[0], self.cliente.recibos[1])
        self.assertEqual(len(self.motores), 1)
        self.assertNotIn(("control", REFERENCIA), self.almacen.eventos)
        self.assertEqual(self.almacen.objetos[REFERENCIA], levantada)

    def test_base_que_no_verifica_mantiene_el_bloqueo_y_la_negativa(self) -> None:
        """Con un archivo de la base alterado la orden no levanta y el ejecutor sigue sin arrancar el motor."""
        trabajo = self.bloquear_por_rechazo()
        manifiesto = json.loads(self.almacen.objetos[f"generaciones/{self.base['sha256Manifiesto']}.json"])
        clave = f"blobs/{manifiesto['archivos'][0]['sha256']}"
        self.almacen.objetos[clave] += b" "
        self.assertEqual(levantar_bloqueo(trabajo, self.almacen), "no-verificable")
        self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])
        self.config = replace(self.config, revision_reserva=3, run_id="125")
        # El ciclo hace la misma verificación: no arranca, no escribe y dice por qué.
        with self.assertRaisesRegex(ValueError, "base-no-verificable"):
            self.ejecutar()
        self.assertEqual(len(self.motores), 1)
        self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])
        self.assertNotIn(f"desbloqueos/{SOLICITUD}/1/123.json", self.almacen.objetos)

    def test_rechazado_exportable_conserva_estado_sin_avanzar_ultima_validada(self) -> None:
        """El intento rechazado recupera sus contadores completos manteniendo la última base verde."""
        self.resultado = "rechazado"
        self.ejecutar()
        referencia = leer_referencia(self.almacen)
        self.assertFalse(referencia["bloqueoOperativo"])
        self.assertEqual(referencia["ultimaValidada"], self.base)
        base = referencia["baseOperativa"]
        generacion = self.raiz / "recuperada"
        recuperar_generacion(generacion, base["revisionCodigo"], base["sha256Manifiesto"], self.almacen)
        restaurada = self.raiz / "restaurada"
        restaurar_generacion(generacion, restaurada, base["revisionCodigo"], base["sha256Manifiesto"])
        self.assertEqual(json.loads((restaurada / ESTADO).read_bytes())["modulos"]["paquete"]["fallos_seguidos"], 1)
        self.assertEqual(self.exportaciones, [])
        # Un rechazo que no se debe al tiempo no lleva cierre: el recibo ya dice lo que pasó.
        self.assertEqual(self.cliente.cierres, [])

    def test_rechazo_por_falta_de_tiempo_envia_el_cierre_tras_el_recibo(self) -> None:
        """El motor no empezó un paso por su hora límite: tras el recibo, el servidor sabe la causa y el paso."""
        self.resultado = "rechazado"
        self.parada = "paquete"
        self.ejecutar()
        self.assertEqual(len(self.cliente.recibos), 1)
        self.assertEqual(
            self.cliente.cierres,
            [
                {
                    "solicitudId": SOLICITUD,
                    "revisionReserva": 1,
                    "accion": self.config.accion,
                    "ultimoFallo": {"causa": "plazo-insuficiente", "paso": "paquete"},
                }
            ],
        )

    def test_plazo_motor_no_callback_ni_segundo_intento_local(self) -> None:
        """El marcador se conserva después del timeout y el mismo directorio no autoriza otro comienzo."""
        with (
            mock.patch.object(ejecutor, "ejecutar_con_plazo", side_effect=subprocess.TimeoutExpired("privado", 1)),
            self.assertRaisesRegex(ValueError, ejecutor.ERROR),
        ):
            self.ejecutar()
        with self.assertRaises(FileExistsError):
            self.ejecutar()
        self.assertEqual(len(self.cliente.inicios), 1)
        self.assertEqual(self.cliente.recibos, [])
        # Sin recibo, el servidor recibe solo por qué no terminó: el plazo, en el paso del motor.
        self.assertEqual(
            [c["ultimoFallo"] for c in self.cliente.cierres], [{"causa": "plazo-agotado", "paso": "motor"}]
        )

    def test_cierre_que_no_llega_se_anota_y_el_fallo_del_motor_sigue(self) -> None:
        """Si el servidor no confirma el cierre, el diario lo dice y el supervisor termina con el fallo del motor."""
        ruta = self.raiz / "diario.jsonl"
        self.cliente.cierre_falla = True
        muerto = subprocess.CompletedProcess(["/privado/python"], -9, "", "")
        with (
            mock.patch.object(ejecutor, "ejecutar_con_plazo", return_value=muerto),
            diario.abrir(ruta, {"run": "1"}, consola=False),
            self.assertRaisesRegex(ValueError, ejecutor.ERROR),
        ):
            self.ejecutar()
        eventos = [(x["fase"], x["estado"]) for x in map(json.loads, ruta.read_text().splitlines())]
        self.assertIn(("cierre-sin-recibo", "no-confirmado"), eventos)
        self.assertIn(("motor", "error"), eventos)
        self.assertEqual(len(self.cliente.cierres), 1)
        # El diagnóstico del diario sigue señalando al motor, no al aviso que no llegó.
        with ruta.open(encoding="utf-8") as lineas:
            self.assertEqual(diagnostico(lineas)["fase"], "motor")

    def test_plazo_motor_queda_en_el_diario_como_plazo_agotado(self) -> None:
        """El ciclo real del 23/11: el diario dice que el motor se pasó de su plazo, sin la orden ni sus rutas."""
        ruta = self.raiz / "diario.jsonl"
        agotado = subprocess.TimeoutExpired(["/privado/python", "-m", "candidato"], 1)
        with (
            mock.patch.object(ejecutor, "ejecutar_con_plazo", side_effect=agotado),
            diario.abrir(ruta, {"run": "1"}, consola=False),
            self.assertRaisesRegex(ValueError, ejecutor.ERROR),
        ):
            self.ejecutar()
        motor = [
            x for x in map(json.loads, ruta.read_text().splitlines()) if (x["fase"], x["estado"]) == ("motor", "error")
        ]
        self.assertEqual(
            [(x["causa"], x["tipo"], x["origen"], x["pasoDeOrigen"], x["plazoSegundos"]) for x in motor],
            [("plazo-agotado", "ErrorEjecucionOperativa", "TimeoutExpired", "motor", 1)],
        )
        self.assertNotIn("privado", ruta.read_text())

    def test_un_motor_que_muere_sin_recibo_dice_como_termino(self) -> None:
        """Una señal o una salida sin recibo se anotan con su causa en el paso del motor, no como «entrada-salida»."""
        for codigo, causa in ((-9, "motor-terminado-por-senal"), (1, "motor-sin-recibo")):
            with self.subTest(codigo=codigo):
                self.setUp()
                ruta = self.raiz / "diario.jsonl"
                muerto = subprocess.CompletedProcess(["/privado/python"], codigo, "", "")
                with (
                    mock.patch.object(ejecutor, "ejecutar_con_plazo", return_value=muerto),
                    diario.abrir(ruta, {"run": "1"}, consola=False),
                    self.assertRaisesRegex(ValueError, ejecutor.ERROR),
                ):
                    self.ejecutar()
                eventos = [json.loads(linea) for linea in ruta.read_text().splitlines()]
                motor = [x for x in eventos if (x["fase"], x["estado"]) == ("motor", "error")]
                self.assertEqual([(x["causa"], x["pasoDeOrigen"]) for x in motor], [(causa, "motor")])
                self.assertEqual(self.cliente.recibos, [])
                self.assertEqual([c["ultimoFallo"] for c in self.cliente.cierres], [{"causa": causa, "paso": "motor"}])

    def test_reanudar_ausente_y_referencia_corrupta_fallan_antes_inicio(self) -> None:
        """La ausencia de índice o un control roto no se transforma en una ejecución nueva."""
        with self.assertRaises(ValueError):
            self.ejecutar(reanudar=True)
        self.almacen.objetos[REFERENCIA] = b"{}"
        with self.assertRaises(ValueError):
            self.ejecutar()
        self.assertEqual(self.cliente.inicios, [])

    def test_inicio_incierto_no_recupera_ni_ejecuta_motor(self) -> None:
        """La ausencia de acuse de inicio no concede permiso, aunque el servidor pudiera haberlo guardado."""
        with (
            mock.patch.object(self.cliente, "confirmar_inicio", side_effect=OSError("incierto")),
            mock.patch.object(ejecutor, "recuperar_generacion") as recuperar,
            self.assertRaises(OSError),
        ):
            self.ejecutar()
        recuperar.assert_not_called()
        self.assertEqual(self.motores, [])
        self.assertEqual(self.cliente.recibos, [])

    def test_recibo_invalido_se_rechaza_por_validador_real_antes_conservar(self) -> None:
        """El motor no puede inventar un resultado que el receptor público rechazaría."""
        real = self.proceso

        def invalido(orden: list[str], cwd: Path, plazo: float, entorno: dict) -> subprocess.CompletedProcess:
            resultado = real(orden, cwd, plazo, entorno)
            if "plataforma_datos.orquestacion.candidato" in orden:
                ruta = Path(orden[-1])
                cuerpo = json.loads(ruta.read_bytes())
                cuerpo["estado"]["modulos"][1]["veredicto"] = "rojo"
                ruta.write_text(json.dumps(cuerpo), encoding="utf-8")
            return resultado

        with (
            mock.patch.object(ejecutor, "ejecutar_con_plazo", side_effect=invalido),
            self.assertRaises(ValueError),
        ):
            self.ejecutar()
        self.assertEqual(leer_referencia(self.almacen), self.inicial)
        self.assertEqual(self.cliente.recibos, [])

    def test_identidad_de_recuperacion_nunca_entra_al_motor_o_callback(self) -> None:
        """El ejecutor rechaza expresamente una identidad válida solo para activación."""
        config = replace(self.config, run_attempt="2", recuperacion_activacion=True)
        cliente, almacen = mock.Mock(), mock.Mock()
        with self.assertRaises(ejecutor.ErrorEjecucionOperativa):
            ejecutor.ejecutar_trabajo(config, cliente, almacen)
        self.assertEqual(cliente.mock_calls, [])
        self.assertEqual(almacen.mock_calls, [])

    def test_configuracion_invalida_rechazada_sin_capacidades(self) -> None:
        """Identificadores y acciones tienen el mismo dominio cerrado del servidor."""
        for cambio in (
            {"revision_reserva": True},
            {"run_attempt": "2"},
            {"run_id": "01"},
            {"solicitud_id": "../otra"},
            {"accion": "desplegar"},
            {"variante_cloudflare": "unificado"},
            {"variante_cloudflare": ""},
            {"variante_cloudflare": None},
        ):
            with self.subTest(cambio=cambio), self.assertRaises(ValueError):
                replace(self.config, **cambio)

    def test_variante_de_la_instalacion_sin_valor_por_omision(self) -> None:
        """Sin la variante declarada no hay configuración: nunca se exporta la privada por omisión."""
        campos = {campo: getattr(self.config, campo) for campo in self.config.__dataclass_fields__}
        del campos["variante_cloudflare"]
        with self.assertRaises(TypeError):
            ejecutor.ConfiguracionEjecutorOperativo(**campos)

    def test_artefacto_exportado_con_la_variante_de_la_instalacion(self) -> None:
        """La variante declarada llega al exportador y queda en el descriptor conservado."""
        self.config = replace(self.config, variante_cloudflare="privado")
        self.ejecutar()
        artefacto = json.loads(self.almacen.objetos[f"trabajos/{SOLICITUD}/1/123.json"])["artefacto"]
        descriptor = json.loads(self.almacen.objetos[f"artefactos/{artefacto['sha256Artefacto']}.json"])
        self.assertEqual(descriptor["destino"], "privado")
        self.assertEqual(len(self.exportaciones), 1)


if __name__ == "__main__":
    unittest.main()
