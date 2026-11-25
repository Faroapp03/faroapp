"""Levantamiento del bloqueo operativo: solo con bloqueo, hacia una base verificada, con CAS y acta inmutable."""

import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from botocore.exceptions import EndpointConnectionError
from botocore.httpsession import URLLib3Session
from botocore.response import StreamingBody

from plataforma_datos.comun import perfil_web, red
from plataforma_datos.orquestacion import levantar_bloqueo as levantar
from plataforma_datos.orquestacion.almacen_generaciones import AlmacenGeneracionesNoDisponible, guardar_generacion
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3NoDisponible
from plataforma_datos.orquestacion.almacen_trabajos import (
    REFERENCIA,
    conservar_trabajo,
    inicializar_referencia,
    leer_referencia,
)
from plataforma_datos.orquestacion.generacion_operativa import exportar_generacion
from plataforma_datos.orquestacion.pruebas.test_almacen_s3 import BUCKET, PREFIJO, http
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import (
    CODIGO,
    OTRA,
    SOLICITUD,
    Memoria,
    recibo,
    serializar,
)
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import preparar

REVISION_BASE = "b" * 40
TRABAJO = {"solicitudId": SOLICITUD, "revisionReserva": 1, "runId": "123"}
ACTA = f"desbloqueos/{SOLICITUD}/1/123.json"


def escrituras(almacen: Memoria) -> list[str]:
    """Claves de control que la orden ha intentado escribir.

    Returns:
        Las claves, en orden.
    """
    return [clave for evento, clave in almacen.eventos if evento == "control"]


class PruebaLevantarBloqueo(unittest.TestCase):
    """Un rechazo sin generación conservable bloquea; la orden solo apaga ese bloqueo cuando es seguro."""

    def setUp(self) -> None:
        """Generación base real en un almacén en memoria y una referencia bloqueada por un rechazo."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        raiz = Path(temporal.name)
        self.carpeta = raiz
        preparar(raiz / "origen")
        resumen = exportar_generacion(raiz / "origen", raiz / "generacion", REVISION_BASE)
        self.almacen = Memoria()
        guardar_generacion(raiz / "generacion", REVISION_BASE, resumen["sha256Manifiesto"], self.almacen)
        self.base = {"revisionCodigo": REVISION_BASE, "sha256Manifiesto": resumen["sha256Manifiesto"]}
        self.inicial = inicializar_referencia(self.base, self.almacen)
        self.rechazo = recibo(resultado="rechazado")
        conservar_trabajo(self.rechazo, "123", CODIGO, self.inicial, None, almacen=self.almacen)
        # Referencia que bloqueó un rechazo sin generación, como la que hay en el almacén de producción.
        bloqueada = levantar._bytes({**leer_referencia(self.almacen), "bloqueoOperativo": True})
        levantar.escribir_confirmado(
            levantar.REFERENCIA, bloqueada, self.almacen.etags[levantar.REFERENCIA], self.almacen
        )
        self.bloqueada = leer_referencia(self.almacen)
        self.assertTrue(self.bloqueada["bloqueoOperativo"])
        self.almacen.eventos.clear()

    def levantar(self, trabajo: dict | None = None) -> str:
        """Ejecuta la orden sobre el almacén de la prueba.

        Returns:
            Resultado cerrado de la orden.
        """
        return levantar.levantar_bloqueo(trabajo or TRABAJO, self.almacen)

    def blob_de_la_base(self) -> str:
        """Clave de un archivo de contenido de la generación base.

        Returns:
            Clave `blobs/<sha256>` del primer archivo de su manifiesto.
        """
        manifiesto = json.loads(self.almacen.objetos[f"generaciones/{self.base['sha256Manifiesto']}.json"])
        return f"blobs/{manifiesto['archivos'][0]['sha256']}"

    def test_sin_bloqueo_no_escribe_y_repetir_es_inocuo(self) -> None:
        """Con la referencia libre responde «sin-bloqueo» y no escribe; tras levantar, repetir tampoco escribe."""
        self.assertEqual(self.levantar(), "levantado")
        objetos = dict(self.almacen.objetos)
        self.almacen.eventos.clear()
        for _ in range(2):
            self.assertEqual(self.levantar(), "sin-bloqueo")
        self.assertEqual(escrituras(self.almacen), [])
        self.assertEqual(self.almacen.objetos, objetos)

    def test_solo_levanta_hacia_una_base_que_verifica_entera(self) -> None:
        """Un manifiesto íntegro no basta: un archivo alterado o truncado mantiene el bloqueo sin escribir nada."""
        clave = self.blob_de_la_base()
        original = self.almacen.objetos[clave]
        for nombre, cambiar in (
            ("alterado", lambda: self.almacen.objetos.__setitem__(clave, original + b" ")),
            ("truncado", lambda: self.almacen.objetos.__setitem__(clave, original[:-1])),
            ("ausente", lambda: self.almacen.objetos.pop(clave)),
        ):
            with self.subTest(nombre):
                cambiar()
                antes = dict(self.almacen.objetos)
                self.almacen.eventos.clear()
                self.assertEqual(self.levantar(), "no-verificable")
                self.assertEqual(escrituras(self.almacen), [])
                self.assertEqual(self.almacen.objetos, antes)
                self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])
                self.almacen.objetos[clave] = original

    def test_almacen_sin_respuesta_no_es_base_no_verificable(self) -> None:
        """Si la descarga de la base se corta, la orden falla sin resultado y sin escribir: se puede repetir."""
        clave = self.blob_de_la_base()
        real = self.almacen.recuperar

        def cortar(destino_clave: str, *argumentos: object) -> None:
            if destino_clave == clave:
                raise OSError("sin respuesta")
            real(destino_clave, *argumentos)

        antes = dict(self.almacen.objetos)
        with (
            mock.patch.object(self.almacen, "recuperar", side_effect=cortar),
            self.assertRaises(AlmacenGeneracionesNoDisponible),
        ):
            self.levantar()
        self.assertEqual(escrituras(self.almacen), [])
        self.assertEqual(self.almacen.objetos, antes)
        self.assertEqual(self.levantar(), "levantado")

    def test_verifica_con_la_recuperacion_integra_del_ejecutor(self) -> None:
        """La comprobación es la misma recuperación de generación que precede al aprovisionamiento del candidato."""
        with mock.patch.object(levantar, "recuperar_generacion", wraps=levantar.recuperar_generacion) as recuperar:
            self.assertEqual(self.levantar(), "levantado")
        argumentos = recuperar.call_args.args
        self.assertEqual(argumentos[1:], (REVISION_BASE, self.base["sha256Manifiesto"], self.almacen))
        recuperados = [clave for evento, clave in self.almacen.eventos if evento == "recuperar"]
        manifiesto = json.loads(self.almacen.objetos[f"generaciones/{self.base['sha256Manifiesto']}.json"])
        self.assertEqual(
            set(recuperados) - {f"generaciones/{self.base['sha256Manifiesto']}.json"},
            {f"blobs/{r['sha256']}" for r in manifiesto["archivos"]},
        )

    def test_referencia_cambiada_durante_la_verificacion_es_conflicto_sin_escribir(self) -> None:
        """Otra escritura mientras se descarga la base deja la referencia ajena intacta y ninguna acta."""
        ajena = serializar(self.bloqueada)
        real = levantar.recuperar_generacion

        def recuperar_y_cambiar(*argumentos: object) -> dict:
            resumen = real(*argumentos)
            etag = self.almacen.etags[REFERENCIA]
            self.almacen.guardar_control(REFERENCIA, ajena, etag)
            return resumen

        with mock.patch.object(levantar, "recuperar_generacion", side_effect=recuperar_y_cambiar):
            self.assertEqual(self.levantar(), "conflicto")
        self.assertEqual(self.almacen.objetos[REFERENCIA], ajena)
        self.assertNotIn(ACTA, self.almacen.objetos)

    def test_cas_perdida_frente_a_otra_escritura_es_conflicto_sin_reintento(self) -> None:
        """If-Match del ETag de su lectura: otra escritura después de releer no se sobrescribe ni se repite la CAS."""
        ajena = serializar(self.bloqueada)
        real = self.almacen.guardar_control

        def adelantarse(clave: str, contenido: bytes, etag: str | None) -> bool:
            # Llega mientras se crea el acta: después de la relectura y antes de la escritura de la referencia.
            if clave == ACTA:
                self.almacen.objetos[REFERENCIA] = ajena
                self.almacen.etags[REFERENCIA] = '"ajeno"'
            return real(clave, contenido, etag)

        with mock.patch.object(self.almacen, "guardar_control", side_effect=adelantarse):
            self.assertEqual(self.levantar(), "conflicto")
        self.assertEqual(self.almacen.objetos[REFERENCIA], ajena)
        self.assertEqual(escrituras(self.almacen).count(REFERENCIA), 1)

    def test_respuesta_perdida_se_confirma_con_la_lectura_exacta(self) -> None:
        """La CAS aplicada cuya respuesta se pierde cuenta como levantada tras releer sus bytes."""
        self.almacen.corte = (REFERENCIA, "despues")
        self.assertEqual(self.levantar(), "levantado")
        self.assertFalse(leer_referencia(self.almacen)["bloqueoOperativo"])

    def test_solo_apaga_el_bloqueo_y_ningun_trabajo_antiguo_lo_mueve(self) -> None:
        """Mismas bases, revisión y trabajo; ni el reenvío del trabajo bloqueado ni esta orden con otro lo cambian."""
        otro = {**TRABAJO, "runId": "124"}
        self.assertEqual(self.levantar(otro), "conflicto")
        self.assertEqual(escrituras(self.almacen), [])
        self.assertEqual(self.levantar(), "levantado")
        levantada = leer_referencia(self.almacen)
        self.assertEqual(levantada, {**self.bloqueada, "bloqueoOperativo": False})
        self.almacen.eventos.clear()
        descriptor = conservar_trabajo(self.rechazo, "123", CODIGO, levantada, None, almacen=self.almacen)
        self.assertEqual(descriptor["generacion"], None)
        self.assertEqual(escrituras(self.almacen), [])
        self.assertEqual(leer_referencia(self.almacen), levantada)
        segundo = recibo(2, OTRA, resultado="rechazado")
        conservar_trabajo(segundo, "200", CODIGO, levantada, None, almacen=self.almacen)
        # El rechazo siguiente sin generación deja la base como estaba y no vuelve a bloquear.
        sin_bloqueo = self.almacen.objetos[REFERENCIA]
        self.assertFalse(leer_referencia(self.almacen)["bloqueoOperativo"])
        self.almacen.eventos.clear()
        self.assertEqual(self.levantar(), "sin-bloqueo")
        self.assertEqual(escrituras(self.almacen), [])
        self.assertEqual(self.almacen.objetos[REFERENCIA], sin_bloqueo)

    def test_reenvio_del_trabajo_bloqueado_solo_admite_la_referencia_levantada_exacta(self) -> None:
        """Otra base o última validada con el mismo trabajo no se acepta al repetir, con o sin bloqueo."""
        self.assertEqual(self.levantar(), "levantado")
        levantada = leer_referencia(self.almacen)
        otra = {"revisionCodigo": "c" * 40, "sha256Manifiesto": "d" * 64}
        for cambio in (
            {"baseOperativa": otra},
            {"ultimaValidada": otra},
            {"baseOperativa": otra, "bloqueoOperativo": True},
        ):
            with self.subTest(cambio=cambio):
                distinta = {**levantada, **cambio}
                self.almacen.objetos[REFERENCIA] = serializar(distinta)
                self.almacen.eventos.clear()
                with self.assertRaises(ValueError):
                    conservar_trabajo(self.rechazo, "123", CODIGO, distinta, None, almacen=self.almacen)
                self.assertEqual(escrituras(self.almacen), [])
                self.assertEqual(leer_referencia(self.almacen), distinta)

    def test_conserva_la_evidencia_y_deja_un_acta_cerrada_antes_de_la_referencia(self) -> None:
        """Recibo, índice y generación intactos; el acta es la única clave nueva y se crea antes de la CAS."""
        antes = dict(self.almacen.objetos)
        with mock.patch.object(levantar, "_instante_utc", return_value="2026-11-15T03:00:00Z"):
            self.assertEqual(self.levantar(), "levantado")
        self.assertEqual(set(self.almacen.objetos) - set(antes), {ACTA})
        conservados = {k: v for k, v in self.almacen.objetos.items() if k not in (ACTA, REFERENCIA)}
        self.assertEqual(conservados, {k: v for k, v in antes.items() if k != REFERENCIA})
        self.assertTrue(any(k.startswith("trabajos/") for k in conservados))
        self.assertIn("blobs/" + hashlib.sha256(self.rechazo).hexdigest(), conservados)
        self.assertEqual(escrituras(self.almacen), [ACTA, REFERENCIA])
        acta = json.loads(self.almacen.objetos[ACTA])
        self.assertEqual(
            acta,
            {
                "version": 1,
                "instante": "2026-11-15T03:00:00Z",
                "trabajo": TRABAJO,
                "sha256ReferenciaAnterior": hashlib.sha256(antes[REFERENCIA]).hexdigest(),
                "sha256ReferenciaNueva": hashlib.sha256(self.almacen.objetos[REFERENCIA]).hexdigest(),
                "generacion": self.base,
                "transicion": "levantar-bloqueo",
            },
        )

    def test_corte_entre_acta_y_referencia_se_completa_sin_duplicar_el_acta(self) -> None:
        """Un corte al escribir la referencia no es conflicto: repetir reutiliza el acta y termina el levantamiento."""
        self.almacen.corte = (REFERENCIA, "antes")
        with (
            mock.patch.object(levantar, "_instante_utc", return_value="2026-11-15T03:00:00Z"),
            self.assertRaises(levantar.EscrituraNoConfirmada),
        ):
            self.levantar()
        acta = self.almacen.objetos[ACTA]
        self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])
        self.almacen.corte = None
        with mock.patch.object(levantar, "_instante_utc", return_value="2026-11-15T04:00:00Z"):
            self.assertEqual(self.levantar(), "levantado")
        self.assertEqual(self.almacen.objetos[ACTA], acta)
        self.assertFalse(leer_referencia(self.almacen)["bloqueoOperativo"])

    def test_un_put_de_la_referencia_sin_respuesta_pide_repetir_y_repetir_levanta(self) -> None:
        """Sin respuesta del almacén al escribir la referencia, la orden no afirma un conflicto: pide repetirla."""
        guardar = self.almacen.guardar_control
        pendiente = [True]

        def sin_respuesta(clave: str, contenido: bytes, etag: str | None) -> bool:
            if clave == REFERENCIA and pendiente[0]:
                pendiente[0] = False
                raise AlmacenS3NoDisponible("Almacén privado no disponible.")
            return guardar(clave, contenido, etag)

        self.almacen.guardar_control = sin_respuesta
        with self.assertRaises(AlmacenS3NoDisponible) as contexto:
            self.levantar()
        self.assertNotIsInstance(contexto.exception, levantar.EscrituraNoConfirmada)
        acta = self.almacen.objetos[ACTA]
        self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])
        self.assertEqual(self.levantar(), "levantado")
        self.assertEqual(self.almacen.objetos[ACTA], acta)
        self.assertFalse(leer_referencia(self.almacen)["bloqueoOperativo"])

    def test_corte_al_crear_el_acta_no_escribe_y_repetir_levanta(self) -> None:
        """Si la creación del acta no se confirma, la referencia sigue intacta; repetir la orden la completa."""
        self.almacen.corte = (ACTA, "antes")
        antes = dict(self.almacen.objetos)
        with self.assertRaises(levantar.EscrituraNoConfirmada):
            self.levantar()
        self.assertEqual(self.almacen.objetos, antes)
        self.almacen.corte = None
        self.assertEqual(self.levantar(), "levantado")

    def test_dos_ordenes_a_la_vez_la_segunda_ve_el_bloqueo_levantado(self) -> None:
        """La segunda pierde el acta frente a la primera, que ya levantó: termina sin bloqueo y sin escribir más."""
        real = self.almacen.guardar_control
        primera: list[str] = []

        def adelantarse(clave: str, contenido: bytes, etag: str | None) -> bool:
            if clave == ACTA and not primera:
                primera.append("en curso")
                with mock.patch.object(levantar, "_instante_utc", return_value="2026-11-15T03:00:00Z"):
                    primera[0] = levantar.levantar_bloqueo(TRABAJO, self.almacen)
            return real(clave, contenido, etag)

        with (
            mock.patch.object(self.almacen, "guardar_control", side_effect=adelantarse),
            mock.patch.object(levantar, "_instante_utc", return_value="2026-11-15T03:00:01Z"),
        ):
            self.assertEqual(self.levantar(), "sin-bloqueo")
        self.assertEqual(primera, ["levantado"])
        self.assertEqual(json.loads(self.almacen.objetos[ACTA])["instante"], "2026-11-15T03:00:00Z")
        self.assertEqual(escrituras(self.almacen).count(REFERENCIA), 1)

    def test_acta_ajena_para_el_mismo_trabajo_es_conflicto(self) -> None:
        """Un acta que describe otra transición no se acepta ni se sobrescribe, aunque solo cambie un tipo."""
        with mock.patch.object(levantar, "_instante_utc", return_value="2026-11-15T03:00:00Z"):
            nueva = levantar._bytes({**self.bloqueada, "bloqueoOperativo": False})
            esperada = levantar._acta(self.bloqueada, self.almacen.objetos[REFERENCIA], nueva)
        ajena = serializar({**esperada, "version": True})
        self.almacen.objetos[ACTA] = ajena
        self.almacen.etags[ACTA] = '"acta"'
        self.assertEqual(self.levantar(), "conflicto")
        self.assertEqual(self.almacen.objetos[ACTA], ajena)
        self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])

    def transporte_s3(self, fallo: object) -> list[str]:
        """Dobla solo el HTTP del adaptador S3 real sobre los objetos de la prueba.

        Args:
            fallo: Respuesta del primer blob de la base: None la sirve; un número es su estado; una excepción, un corte.

        Returns:
            Los métodos HTTP enviados, en orden.
        """
        pausas = red.PausasPorDominio(lambda: 0.0, lambda _segundos: None)
        identidad = Path(tempfile.mkdtemp(dir=self.carpeta)) / "identidad-web.json"
        identidad.write_text(
            json.dumps({"version": 1, "identidad": perfil_web.identidad_publica(perfil_web.perfil_chrome())})
        )
        metodos: list[str] = []
        inicio = f"/{BUCKET}/{PREFIJO}/"
        blob = self.blob_de_la_base()

        def enviar(request: object) -> object:
            metodos.append(request.method)
            clave = request.url.split(inicio, 1)[1]
            if request.method == "PUT":
                cabeceras = {nombre.lower(): valor for nombre, valor in request.headers.items()}
                condicion = cabeceras.get("if-match")
                etag = None if condicion is None else condicion.decode()
                aplicado = self.almacen.guardar_control(clave, request.body.read(), etag)
                return http(request, 200 if aplicado else 412)
            if clave == blob and fallo is not None:
                if isinstance(fallo, Exception):
                    raise fallo
                return http(request, fallo)
            if clave not in self.almacen.objetos:
                return http(request, 404)
            respuesta = http(request, 200, self.almacen.objetos[clave])
            respuesta.headers["etag"] = self.almacen.etags.get(clave, '"objeto"')
            return respuesta

        entorno = {
            "FARO_ALMACEN_S3": json.dumps(
                {
                    "version": 1,
                    "endpoint": "https://almacen.example",
                    "bucket": BUCKET,
                    "prefijo": PREFIJO,
                    "region": "auto",
                }
            ),
            "FARO_ALMACEN_ACCESS_KEY_ID": "AKIDSINTETICA",
            "FARO_ALMACEN_SECRET_ACCESS_KEY": "secreto-sintetico-no-real",
        }
        for parche in (
            mock.patch.object(red, "PAUSAS", pausas),
            mock.patch.object(perfil_web, "RUTA_IDENTIDAD", identidad),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
            mock.patch.object(URLLib3Session, "send", side_effect=enviar),
            mock.patch.dict(os.environ, entorno),
        ):
            parche.start()
            self.addCleanup(parche.stop)
        return metodos

    def ordenar_con_s3(self, fallo: object = None) -> tuple[int, str, str, list[str]]:
        """Ejecuta `main` entera, con la configuración del entorno y el adaptador S3 real; solo el HTTP está doblado.

        Returns:
            Código, salida estándar, salida de errores y métodos HTTP enviados.
        """
        metodos = self.transporte_s3(fallo)
        salida, errores = io.StringIO(), io.StringIO()
        argv = ["--solicitud-id", SOLICITUD, "--revision-reserva", "1", "--run-id", "123"]
        with redirect_stdout(salida), redirect_stderr(errores):
            codigo = levantar.main(argv)
        return codigo, salida.getvalue(), errores.getvalue(), metodos

    def comprobar_sin_escribir_y_repetible(self, codigo: int, salida: str, errores: str, metodos: list[str]) -> None:
        """Código 1 con el aviso de repetir, ningún PUT y la referencia todavía bloqueada."""
        self.assertEqual((codigo, salida, errores), (1, "", levantar.ERROR_ALMACEN + "\n"))
        self.assertNotIn("PUT", metodos)
        self.assertNotIn(ACTA, self.almacen.objetos)
        self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])

    def test_con_s3_la_carpeta_local_que_desaparece_no_es_base_ausente(self) -> None:
        """Si la carpeta de un archivo desaparece antes de descargarlo, el almacén no ha fallado: se repite."""
        manifiesto = json.loads(self.almacen.objetos[f"generaciones/{self.base['sha256Manifiesto']}.json"])
        carpeta = "contenido/" + str(Path(manifiesto["archivos"][0]["ruta"]).parent)
        real = Path.lstat
        cortes: list[Path] = []

        def lstat(ruta: Path) -> object:
            if not cortes and ruta.as_posix().endswith(carpeta):
                cortes.append(ruta)
                raise FileNotFoundError(ruta)
            return real(ruta)

        metodos = self.transporte_s3(None)
        salida, errores = io.StringIO(), io.StringIO()
        argv = ["--solicitud-id", SOLICITUD, "--revision-reserva", "1", "--run-id", "123"]
        with (
            mock.patch.object(Path, "lstat", autospec=True, side_effect=lstat),
            redirect_stdout(salida),
            redirect_stderr(errores),
        ):
            codigo = levantar.main(argv)
        self.assertEqual(len(cortes), 1)
        self.comprobar_sin_escribir_y_repetible(codigo, salida.getvalue(), errores.getvalue(), metodos)

    def test_con_s3_el_temporal_que_desaparece_no_tapa_el_fallo(self) -> None:
        """Si el temporal de un archivo desaparece antes de promoverlo, el fallo es local y sale con 1, no con 4."""
        blob = self.blob_de_la_base()
        borrados: list[Path] = []
        metodos = self.transporte_s3(None)
        enviar = URLLib3Session.send.side_effect

        def borrar_temporal(request: object) -> object:
            respuesta = enviar(request)
            if request.method == "GET" and request.url.endswith(blob) and not borrados:
                borrados.extend(self.carpeta.glob(".levantar-bloqueo-*/**/.objeto-*"))
                for temporal in borrados:
                    temporal.unlink()
            return respuesta

        salida, errores = io.StringIO(), io.StringIO()
        argv = ["--solicitud-id", SOLICITUD, "--revision-reserva", "1", "--run-id", "123"]
        with (
            mock.patch.object(tempfile, "tempdir", str(self.carpeta)),
            mock.patch.object(URLLib3Session, "send", side_effect=borrar_temporal),
            redirect_stdout(salida),
            redirect_stderr(errores),
        ):
            codigo = levantar.main(argv)
        self.assertEqual(len(borrados), 1)
        self.comprobar_sin_escribir_y_repetible(codigo, salida.getvalue(), errores.getvalue(), metodos)

    def test_con_s3_levanta_con_acta_y_referencia_condicionales(self) -> None:
        """El camino entero con el adaptador real: acta con If-None-Match, referencia con If-Match y código 0."""
        codigo, salida, errores, metodos = self.ordenar_con_s3()
        self.assertEqual((codigo, salida, errores), (0, levantar.MENSAJES["levantado"] + "\n", ""))
        self.assertEqual(metodos.count("PUT"), 2)
        self.assertIn(ACTA, self.almacen.objetos)
        self.assertEqual(leer_referencia(self.almacen), {**self.bloqueada, "bloqueoOperativo": False})

    def test_con_s3_un_blob_ausente_es_base_no_verificable(self) -> None:
        """Un 404 del adaptador real termina con 4 y pide restaurar la base: repetir no lo arreglaría."""
        antes = dict(self.almacen.objetos)
        codigo, salida, errores, metodos = self.ordenar_con_s3(404)
        self.assertEqual((codigo, salida, errores), (4, levantar.MENSAJES["no-verificable"] + "\n", ""))
        self.assertNotIn("PUT", metodos)
        self.assertEqual(self.almacen.objetos, antes)
        self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])

    def test_con_s3_un_503_o_un_corte_es_almacen_sin_respuesta(self) -> None:
        """En el mismo punto, un 503 o una conexión cortada terminan con 1 y piden repetir la orden."""
        for fallo in (503, EndpointConnectionError(endpoint_url="https://almacen.example")):
            with self.subTest(fallo=fallo):
                antes = dict(self.almacen.objetos)
                codigo, salida, errores, metodos = self.ordenar_con_s3(fallo)
                self.assertEqual((codigo, salida, errores), (1, "", levantar.ERROR_ALMACEN + "\n"))
                self.assertNotIn("PUT", metodos)
                self.assertEqual(self.almacen.objetos, antes)
                self.assertTrue(leer_referencia(self.almacen)["bloqueoOperativo"])


class PruebaOrdenLevantarBloqueo(unittest.TestCase):
    """Una línea legible y un código de salida distinto por resultado, con el almacén de la instalación."""

    def ejecutar(self, resultado: object, argv: list[str] | None = None) -> tuple[int, str, str]:
        """Ejecuta `main` con el almacén y la orden sustituidos.

        Returns:
            Código, salida estándar y salida de errores.
        """
        salida, errores = io.StringIO(), io.StringIO()
        argumentos = argv or ["--solicitud-id", SOLICITUD, "--revision-reserva", "1", "--run-id", "123"]
        with (
            mock.patch.object(levantar, "configuracion_privada"),
            mock.patch.object(levantar, "AlmacenS3"),
            mock.patch.object(levantar, "levantar_bloqueo", side_effect=[resultado]) as orden,
            redirect_stdout(salida),
            redirect_stderr(errores),
        ):
            codigo = levantar.main(argumentos)
        self.assertEqual(orden.call_args.args[0], TRABAJO)
        return codigo, salida.getvalue(), errores.getvalue()

    def test_codigo_y_linea_por_resultado(self) -> None:
        """Cada resultado tiene su código; la salida es una sola línea, sin rutas ni huellas."""
        for resultado, codigo in (("levantado", 0), ("sin-bloqueo", 3), ("no-verificable", 4), ("conflicto", 5)):
            with self.subTest(resultado):
                obtenido, salida, errores = self.ejecutar(resultado)
                self.assertEqual(obtenido, codigo)
                self.assertEqual(salida, levantar.MENSAJES[resultado] + "\n")
                self.assertEqual(errores, "")

    def test_fallo_sin_resultado_y_argumentos_no_admitidos(self) -> None:
        """Sin resultado cerrado termina con 1 y el error genérico; un argumento inválido, con 2 y sin almacén."""
        codigo, salida, errores = self.ejecutar(ValueError("referencia no válida"))
        self.assertEqual((codigo, salida, errores), (1, "", levantar.ERROR_GENERICO + "\n"))
        for sin_respuesta in (OSError("sin respuesta"), AlmacenGeneracionesNoDisponible("cortada")):
            with self.subTest(sin_respuesta=sin_respuesta):
                codigo, salida, errores = self.ejecutar(sin_respuesta)
                self.assertEqual((codigo, salida, errores), (1, "", levantar.ERROR_ALMACEN + "\n"))
        for argv in (
            ["--solicitud-id", "no-uuid", "--revision-reserva", "1", "--run-id", "123"],
            ["--solicitud-id", SOLICITUD, "--revision-reserva", "0", "--run-id", "123"],
            ["--solicitud-id", SOLICITUD, "--revision-reserva", "1", "--run-id", "9007199254740992"],
        ):
            with (
                self.subTest(argv=argv),
                mock.patch.object(levantar, "AlmacenS3") as almacen,
                redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit) as salida_forzada,
            ):
                levantar.main(argv)
            self.assertEqual(salida_forzada.exception.code, 2)
            almacen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
