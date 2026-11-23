"""Recibos exactos, cortes entre fases y CAS concurrente sin motor, red ni credenciales."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import almacen_trabajos as trabajos
from plataforma_datos.orquestacion import candidato
from plataforma_datos.orquestacion import instantanea_del_recibo as instantanea

SOLICITUD = "12345678-1234-4234-8234-123456789abc"
OTRA = "87654321-1234-4234-8234-123456789abc"
CODIGO = "a" * 40
INSTANTE = "2026-10-16T12:00:00Z"


def serializar(valor: dict) -> bytes:
    """Produce bytes de fixture.

    Returns:
        JSON con espacios y salto final que deben conservarse literalmente.
    """
    return (json.dumps(valor, ensure_ascii=False, indent=1) + "\n").encode()


def snapshot() -> dict:
    """Crea un DTO mínimo real.

    Returns:
        Una fuente y los dos módulos correspondientes.
    """
    modulo = {
        "ultimoIntento": INSTANTE,
        "veredicto": "verde",
        "ultimaVersionBuena": None,
        "fallos": 0,
        "proximoReintento": None,
    }
    return {
        "version": 1,
        "observadoEn": INSTANTE,
        "formacionAbiertaCaduca": None,
        "fuentes": [{"id": "fuente", "politica": "fija", "fecha": None, "plazoDias": None}],
        "modulos": [{"id": "fuente", **modulo}, {"id": "paquete", **modulo}],
    }


def recibo(
    revision: int = 1,
    solicitud: str = SOLICITUD,
    resultado: str = "validado",
    version: int = trabajos.VERSION_RECIBO_CONSERVADOS,
) -> bytes:
    """Crea con el productor del candidato un cuerpo completo que aceptaría el receptor.

    Args:
        revision: Revisión de la reserva que completa el ejecutor operativo.
        solicitud: Identificador de la solicitud que completa el ejecutor operativo.
        resultado: Resultado del candidato.
        version: Versión del recibo; las anteriores a la 4 (sin «conservados») y la 1 (sin catálogo) solo para leer
            recibos ya conservados.

    Returns:
        Bytes estables para reenviar.
    """
    validado = resultado == "validado"
    cuerpo = candidato._recibo(
        "actualizar-datos", resultado, snapshot() if validado else None, "verde" if validado else None
    )
    cuerpo.update(
        terminadoEn=INSTANTE,
        huellaPaquete="b" * 16 if validado else None,
        error=None if validado else "candidato_no_verificable",
        solicitudId=solicitud,
        revisionReserva=revision,
    )
    if version < trabajos.VERSION_RECIBO_CONSERVADOS:
        del cuerpo["conservados"]
    if version == 1:
        del cuerpo["catalogo"]
    cuerpo["version"] = version
    return serializar(cuerpo)


class Memoria:
    """Objetos con creación exclusiva y CAS; permite perder la respuesta después del commit."""

    def __init__(self) -> None:
        self.objetos: dict[str, bytes] = {}
        self.etags: dict[str, str] = {}
        self.eventos: list[tuple[str, str]] = []
        self.corte: tuple[str, str] | None = None
        self.contador = 0

    def guardar(self, clave: str, origen: Path, sha256: str, bytes: int) -> None:
        """Comprueba y guarda un blob sin sobrescribir bytes diferentes.

        Raises:
            ValueError: Si los bytes no son los esperados.
        """
        contenido = origen.read_bytes()
        if len(contenido) != bytes or hashlib.sha256(contenido).hexdigest() != sha256:
            raise ValueError("fixture no íntegra")
        if clave in self.objetos and self.objetos[clave] != contenido:
            raise ValueError("objeto distinto")
        self.objetos[clave] = contenido
        self.eventos.append(("guardar", clave))

    def recuperar(self, clave: str, destino_nuevo: Path, sha256: str, bytes_maximos: int) -> None:
        """Recupera bytes íntegros a un archivo exclusivo.

        Raises:
            FileNotFoundError: Si no existe el objeto, como el 404 del adaptador real.
            OSError: Si falta la carpeta local de destino.
            ValueError: Si fallan la cota o la huella.
        """
        if clave not in self.objetos:
            raise FileNotFoundError("objeto ausente")
        contenido = self.objetos[clave]
        if len(contenido) > bytes_maximos or hashlib.sha256(contenido).hexdigest() != sha256:
            raise ValueError("objeto no íntegro")
        try:
            with destino_nuevo.open("xb") as archivo:
                archivo.write(contenido)
        except FileNotFoundError as error:
            # Una carpeta local ausente no es un objeto ausente del almacén, como en el adaptador real.
            raise OSError("carpeta local ausente") from error
        self.eventos.append(("recuperar", clave))

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        """Lee el control.

        Returns:
            Bytes y ETag, o None solo si no existe.

        Raises:
            ValueError: Si supera la cota.
        """
        self.eventos.append(("leer", clave))
        if clave not in self.objetos:
            return None
        contenido = self.objetos[clave]
        if len(contenido) > bytes_maximos:
            raise ValueError("control excesivo")
        return contenido, self.etags[clave]

    def guardar_control(self, clave: str, contenido: bytes, etag_esperado: str | None) -> bool:
        """Simula la CAS atómica.

        Returns:
            False exclusivamente cuando no coincide la precondición.

        Raises:
            OSError: Si se pierde la respuesta, antes o después del commit.
        """
        self.eventos.append(("control", clave))
        if self.corte == (clave, "antes"):
            raise OSError("respuesta incierta")
        if self.etags.get(clave) != etag_esperado:
            return False
        self.contador += 1
        self.objetos[clave] = contenido
        self.etags[clave] = f'"opaco-{self.contador}"'
        if self.corte == (clave, "despues"):
            raise OSError("respuesta perdida")
        return True

    def generacion(self, marca: str, paquete_sha: str = "b" * 64) -> dict:
        """Crea metadatos de descubrimiento; la conservación íntegra corresponde a guardar_generacion75.

        Returns:
            Referencia al manifiesto válido sintético.
        """
        sha = hashlib.sha256(marca.encode()).hexdigest()
        contenido = serializar(
            {
                "version": 1,
                "revisionCodigo": CODIGO,
                "manifiestoPaqueteSha256": paquete_sha,
                "estadoSha256": None,
                "bytesTotales": 2,
                "archivos": [
                    {"ruta": "datos/manifiesto.json", "bytes": 1, "sha256": paquete_sha},
                    {"ruta": "datos/uno.json", "bytes": 1, "sha256": sha},
                ],
            }
        )
        huella = hashlib.sha256(contenido).hexdigest()
        self.objetos[f"generaciones/{huella}.json"] = contenido
        return {"revisionCodigo": CODIGO, "sha256Manifiesto": huella}

    def artefacto(self, paquete_sha: str = "b" * 64, revision: str = CODIGO) -> dict:
        """Crea solo metadatos válidos para TS; no pretende acreditar payload recuperable.

        Returns:
            Referencia privada al marcador de fixture.
        """
        contenido = serializar(
            {
                "version": 1,
                "revisionCodigo": revision,
                "huellaPaquete": paquete_sha[:16],
                "sha256ManifiestoPaquete": paquete_sha,
                "sha256ManifiestoDispositivo": "c" * 64,
                "archivos": [{"ruta": "worker/worker.mjs", "bytes": 1, "sha256": "d" * 64}],
            }
        )
        huella = hashlib.sha256(contenido).hexdigest()
        self.objetos[f"artefactos/{huella}.json"] = contenido
        return {"revisionCodigo": revision, "huellaPaquete": paquete_sha[:16], "sha256Artefacto": huella}


class PruebaAlmacenTrabajos(unittest.TestCase):
    """La publicación de un índice no acredita por sí sola el avance de la base operativa."""

    def setUp(self) -> None:
        """Inicializa un almacén privado nuevo por caso."""
        self.almacen = Memoria()
        self.base = self.almacen.generacion("base")
        self.nueva = self.almacen.generacion("nueva")
        self.artefacto = self.almacen.artefacto()
        self.inicial = trabajos.inicializar_referencia(self.base, self.almacen)
        self.almacen.eventos.clear()

    def conservar(
        self, contenido: bytes | None = None, base: dict | None = None, generacion: dict | None = None, run: str = "123"
    ) -> dict:
        """Invoca la frontera real sin motor.

        Returns:
            Descriptor inmutable confirmado.
        """
        cuerpo = contenido or recibo()
        try:
            validado = json.loads(cuerpo).get("resultado") == "validado"
        except ValueError:
            validado = True  # Los cuerpos malformados deben llegar a la frontera real.
        return trabajos.conservar_trabajo(
            cuerpo,
            run,
            CODIGO,
            base or self.inicial,
            generacion or self.nueva,
            artefacto=self.artefacto if validado else None,
            almacen=self.almacen,
        )

    def test_bootstrap_explicito_y_ausencia_no_reinicializa(self) -> None:
        """La lectura no fabrica una base; bootstrap repetido solo confirma los mismos bytes."""
        almacen = Memoria()
        with self.assertRaises(ValueError):
            trabajos.leer_referencia(almacen)
        self.assertEqual(almacen.objetos, {})
        self.assertEqual(trabajos.inicializar_referencia(self.base, self.almacen), self.inicial)
        with self.assertRaises(trabajos.ConflictoReferencia):
            trabajos.inicializar_referencia(self.nueva, self.almacen)
        self.almacen.objetos[trabajos.REFERENCIA] = b"{}"
        with self.assertRaises(ValueError):
            trabajos.leer_referencia(self.almacen)
        with self.assertRaises(trabajos.ConflictoReferencia):
            trabajos.inicializar_referencia(self.base, self.almacen)
        self.assertEqual(self.almacen.objetos[trabajos.REFERENCIA], b"{}")

    def test_recibo_v1_conservado_se_sigue_leyendo_literal(self) -> None:
        """Mientras haya almacenes con recibos v1, se conservan y releen sin convertirlos."""
        contenido = recibo(version=1)
        descriptor = self.conservar(contenido)
        self.assertEqual(trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen), (descriptor, contenido))
        self.assertEqual(json.loads(contenido)["version"], 1)

    def test_nuevo_validado_sin_artefacto_no_publica_indice(self) -> None:
        """El verde público no acredita por sí solo una construcción conservada."""
        with self.assertRaises(ValueError):
            trabajos.conservar_trabajo(recibo(), "123", CODIGO, self.inicial, self.nueva, almacen=self.almacen)
        self.assertFalse(any(e[0] in ("guardar", "control") for e in self.almacen.eventos))

    def test_recibo_exacto_contenido_indice_cas_y_relectura(self) -> None:
        """No reserializa el recibo; el índice se confirma antes de cambiar la referencia."""
        contenido = recibo()
        descriptor = self.conservar(contenido)
        self.assertEqual(descriptor["version"], 2)
        self.assertEqual(descriptor["artefacto"], self.artefacto)
        indice = f"trabajos/{SOLICITUD}/1/123.json"
        blob = "blobs/" + hashlib.sha256(contenido).hexdigest()
        eventos = self.almacen.eventos
        self.assertLess(eventos.index(("guardar", blob)), eventos.index(("control", indice)))
        self.assertLess(
            eventos.index(("leer", indice), eventos.index(("control", indice))),
            eventos.index(("control", trabajos.REFERENCIA)),
        )
        referencia = trabajos.leer_referencia(self.almacen)
        self.assertEqual(referencia["baseOperativa"], self.nueva)
        self.assertEqual(referencia["ultimaValidada"], self.nueva)
        self.assertFalse(referencia["bloqueoOperativo"])
        self.assertEqual(trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen), (descriptor, contenido))

    def test_repeticion_exacta_no_escribe_y_distinta_no_sobrescribe(self) -> None:
        """Cambiar espacios/fecha altera el hash aunque la semántica parezca la misma."""
        descriptor = self.conservar()
        guardados = dict(self.almacen.objetos)
        self.almacen.eventos.clear()
        self.assertEqual(self.conservar(base=trabajos.leer_referencia(self.almacen)), descriptor)
        self.assertFalse(any(e[0] in ("guardar", "control") for e in self.almacen.eventos))
        with self.assertRaises(ValueError):
            self.conservar(recibo().rstrip())
        self.assertEqual(self.almacen.objetos, guardados)

    def test_respuestas_put_perdidas_se_resuelven_con_lectura_exacta(self) -> None:
        """Índice y CAS pueden haber quedado confirmados aunque su respuesta se pierda."""
        for clave in (f"trabajos/{SOLICITUD}/1/123.json", trabajos.REFERENCIA):
            with self.subTest(clave=clave):
                self.setUp()
                self.almacen.corte = (clave, "despues")
                self.conservar()
                self.assertEqual(trabajos.leer_referencia(self.almacen)["revisionReserva"], 1)

    def test_corte_despues_indice_reanuda_cas_sin_motor(self) -> None:
        """Recuperar el índice no confunde una CAS pendiente con una llamada de retorno permitida."""
        self.almacen.corte = (trabajos.REFERENCIA, "antes")
        with self.assertRaises(trabajos.ConflictoReferencia):
            self.conservar()
        descriptor, contenido = trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen)
        self.assertEqual(trabajos.leer_referencia(self.almacen), self.inicial)
        self.almacen.corte = None
        self.assertEqual(self.conservar(contenido, generacion=descriptor["generacion"]), descriptor)
        self.assertEqual(trabajos.leer_referencia(self.almacen)["revisionReserva"], 1)

    def test_dos_reservas_con_misma_base_no_reemplazan_valor_concurrente(self) -> None:
        """Un ETag reciente no autoriza a una reserva vieja; no hace rollback de otra base."""
        self.conservar(recibo(2, OTRA))
        antes = dict(self.almacen.objetos)
        with self.assertRaises(trabajos.ConflictoReferencia):
            self.conservar()
        self.assertEqual(self.almacen.objetos[trabajos.REFERENCIA], antes[trabajos.REFERENCIA])
        self.assertEqual(trabajos.leer_referencia(self.almacen)["revisionReserva"], 2)

    def test_reenvio_antiguo_confirmado_es_conflicto_tras_nuevo_trabajo(self) -> None:
        """El índice sigue recuperable, pero una reserva superada no acredita CAS vigente ni llamada de retorno."""
        primero = self.conservar()
        segunda_base = trabajos.leer_referencia(self.almacen)
        self.conservar(recibo(2, OTRA), base=segunda_base)
        ultima = trabajos.leer_referencia(self.almacen)
        with self.assertRaises(trabajos.ConflictoReferencia):
            self.conservar(base=ultima)
        self.assertEqual(trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen), (primero, recibo()))
        self.assertEqual(trabajos.leer_referencia(self.almacen), ultima)

    def test_indice_antes_cas_no_autoriza_reenvio_si_otra_reserva_lo_supera(self) -> None:
        """No atribuye confirmación histórica a un índice creado antes de perder su CAS."""
        self.almacen.corte = (trabajos.REFERENCIA, "antes")
        with self.assertRaises(trabajos.ConflictoReferencia):
            self.conservar()
        self.almacen.corte = None
        self.conservar(recibo(2, OTRA))
        ultima = trabajos.leer_referencia(self.almacen)
        self.almacen.eventos.clear()
        with self.assertRaises(trabajos.ConflictoReferencia):
            self.conservar(base=ultima)
        self.assertFalse(any(e[0] in ("guardar", "control") for e in self.almacen.eventos))
        self.assertEqual(trabajos.leer_referencia(self.almacen), ultima)

    def test_rechazo_integro_avanza_operativa_pero_no_ultima_validada(self) -> None:
        """La generación de intento no equivale a activa ni a validada."""
        self.conservar(recibo(resultado="rechazado"))
        ref = trabajos.leer_referencia(self.almacen)
        self.assertEqual(ref["baseOperativa"], self.nueva)
        self.assertEqual(ref["ultimaValidada"], self.base)
        self.assertFalse(ref["bloqueoOperativo"])

    def test_replay_rechazo_no_acredita_ultima_validada_alterada(self) -> None:
        """El índice conserva la última validada anterior para cotejar el documento completo."""
        contenido = recibo(resultado="rechazado")
        descriptor = self.conservar(contenido)
        self.assertEqual(descriptor["ultimaValidadaAnterior"], self.base)
        ref = trabajos.leer_referencia(self.almacen)
        ref["ultimaValidada"] = self.nueva
        self.almacen.objetos[trabajos.REFERENCIA] = serializar(ref)
        with self.assertRaises(ValueError):
            self.conservar(contenido, base=ref)

    def test_replay_no_acepta_un_bloqueo_que_su_trabajo_no_dejo(self) -> None:
        """Solo el bloqueo que dejó el propio trabajo puede aparecer apagado al repetir; nunca encendido de más."""
        contenido = recibo(resultado="rechazado")
        self.conservar(contenido)
        ref = trabajos.leer_referencia(self.almacen)
        self.assertFalse(ref["bloqueoOperativo"])
        ref["bloqueoOperativo"] = True
        self.almacen.objetos[trabajos.REFERENCIA] = serializar(ref)
        self.almacen.eventos.clear()
        with self.assertRaises(ValueError):
            self.conservar(contenido, base=ref)
        self.assertFalse(any(e[0] == "control" for e in self.almacen.eventos))

    def test_doble_distingue_objeto_ausente_de_carpeta_local_ausente(self) -> None:
        """Como el adaptador real, solo un objeto que no existe es FileNotFoundError; la carpeta que falta no."""
        clave = f"generaciones/{self.base['sha256Manifiesto']}.json"
        with tempfile.TemporaryDirectory() as nombre:
            with self.assertRaises(FileNotFoundError):
                self.almacen.recuperar("blobs/" + "0" * 64, Path(nombre) / "uno", "0" * 64, 8)
            with self.assertRaises(OSError) as fallo:
                self.almacen.recuperar(
                    clave, Path(nombre) / "no-existe" / "m.json", self.base["sha256Manifiesto"], 2**20
                )
            self.assertNotIsInstance(fallo.exception, FileNotFoundError)

    def test_run_fuera_entero_seguro_rechaza_antes_de_io(self) -> None:
        """La identidad numérica mantiene el mismo dominio que OIDC y SQL del servidor."""
        for run in ("01", "0", "9007199254740992", "10000000000000000", "../1"):
            with self.subTest(run=run), self.assertRaises(ValueError):
                self.conservar(run=run)
        self.assertEqual(self.almacen.eventos, [])

    def test_rechazo_sin_generacion_deja_la_base_como_estaba_y_sin_bloqueo(self) -> None:
        """El intento fallido se conserva en su recibo; la base sigue verificada y el trabajo siguiente avanza."""
        cuerpo = recibo(resultado="rechazado")
        d = trabajos.conservar_trabajo(cuerpo, "123", CODIGO, self.inicial, None, almacen=self.almacen)
        ref = trabajos.leer_referencia(self.almacen)
        self.assertFalse(ref["bloqueoOperativo"])
        self.assertEqual(ref["baseOperativa"], self.base)
        self.assertEqual(ref["ultimaValidada"], self.base)
        self.assertEqual(trabajos.conservar_trabajo(cuerpo, "123", CODIGO, ref, None, almacen=self.almacen), d)
        self.conservar(recibo(2, OTRA), base=ref)
        self.assertEqual(trabajos.leer_referencia(self.almacen)["revisionReserva"], 2)

    def test_sin_pendientes_referencia_base_sin_nueva_generacion(self) -> None:
        """No exporta una generación vacía ni altera la última validada al no ejecutar módulos."""
        o = json.loads(recibo())
        o.update(accion="reintentar-pendientes", resultado="sin-pendientes", veredicto=None, huellaPaquete=None)
        self.conservar(serializar(o), generacion=self.base)
        ref = trabajos.leer_referencia(self.almacen)
        self.assertEqual(ref["baseOperativa"], self.base)
        self.assertEqual(ref["ultimaValidada"], self.base)

    def test_generacion_dict_no_acredita_manifiesto_remoto(self) -> None:
        """Una etiqueta de generación inexistente nunca permite publicar índice o referencia."""
        falsa = {"revisionCodigo": CODIGO, "sha256Manifiesto": "0" * 64}
        with self.assertRaises(OSError):
            self.conservar(generacion=falsa)
        self.assertFalse(any(e[0] in ("guardar", "control") for e in self.almacen.eventos))
        self.assertEqual(trabajos.leer_referencia(self.almacen), self.inicial)

    def test_json_correlacion_fecha_y_snapshot_invalidos_no_escriben(self) -> None:
        """La frontera no conserva cuerpos abiertos, duplicados, no finitos ni DTO con campos libres."""
        malos = [b'{"version":1,"version":1}', b'{"x":NaN}', b"x" * (trabajos.MAX_RECIBO_BYTES + 1)]
        for campo, valor in (
            ("solicitudId", "../otra"),
            ("revisionReserva", True),
            ("terminadoEn", "2026-02-30T00:00:00Z"),
            ("resultado", "activo"),
        ):
            o = json.loads(recibo())
            o[campo] = valor
            malos.append(serializar(o))
        o = json.loads(recibo())
        o["estado"]["fuentes"][0]["ruta"] = "/interna"
        malos.append(serializar(o))
        for cuerpo in malos:
            with self.subTest(bytes=len(cuerpo)), self.assertRaises(ValueError):
                self.conservar(cuerpo)
        self.assertEqual(self.almacen.eventos, [])

    def test_indice_ausente_o_corrupto_no_inventa_recibo(self) -> None:
        """La recuperación distingue falta de índice de contenido/correlación inválidos."""
        self.assertIsNone(trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen))
        self.conservar()
        clave = f"trabajos/{SOLICITUD}/1/123.json"
        original = self.almacen.objetos[clave]
        for mutar in (lambda d: d.update(solicitudId=OTRA), lambda d: d["recibo"].update(bytes=1)):
            d = json.loads(original)
            mutar(d)
            self.almacen.objetos[clave] = serializar(d)
            with self.assertRaises(ValueError):
                trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen)

    def test_vinculo_completo_no_acepta_otro_manifiesto_con_igual_prefijo(self) -> None:
        """La huella de paquete de 16 caracteres del recibo no sustituye la igualdad de los SHA256 completos."""
        otro = self.almacen.artefacto("b" * 16 + "c" * 48)
        with self.assertRaises(ValueError):
            trabajos.conservar_trabajo(
                recibo(), "123", CODIGO, self.inicial, self.nueva, artefacto=otro, almacen=self.almacen
            )
        self.assertFalse(any(e[0] in ("guardar", "control") for e in self.almacen.eventos))

    def test_artefacto_de_otro_codigo_paquete_o_inexistente_no_publica(self) -> None:
        """La referencia cerrada no acredita un marcador que falta o pertenece a otro candidato."""
        casos = [
            self.artefacto | {"revisionCodigo": "c" * 40},
            self.artefacto | {"huellaPaquete": "c" * 16},
            self.artefacto | {"sha256Artefacto": "0" * 64},
            self.artefacto | {"ruta": "privada"},
            self.almacen.artefacto(revision="c" * 40) | {"revisionCodigo": CODIGO},
        ]
        for artefacto in casos:
            with self.subTest(artefacto=artefacto), self.assertRaises(ValueError):
                trabajos.conservar_trabajo(
                    recibo(), "123", CODIGO, self.inicial, self.nueva, artefacto=artefacto, almacen=self.almacen
                )
        self.assertFalse(any(e[0] in ("guardar", "control") for e in self.almacen.eventos))
        self.assertEqual(trabajos.leer_referencia(self.almacen), self.inicial)

    def test_rechazo_y_sin_pendientes_no_pueden_atribuir_artefacto(self) -> None:
        """La referencia del artefacto solo tiene significado para un resultado validado nuevo."""
        pendiente = json.loads(recibo())
        pendiente.update(accion="reintentar-pendientes", resultado="sin-pendientes", veredicto=None, huellaPaquete=None)
        for cuerpo, generacion in ((recibo(resultado="rechazado"), self.nueva), (serializar(pendiente), self.base)):
            with self.subTest(resultado=json.loads(cuerpo)["resultado"]), self.assertRaises(ValueError):
                trabajos.conservar_trabajo(
                    cuerpo, "123", CODIGO, self.inicial, generacion, artefacto=self.artefacto, almacen=self.almacen
                )
        self.assertFalse(any(e[0] in ("guardar", "control") for e in self.almacen.eventos))

    def test_recuperar_v2_coteja_marcadores_sin_payload_y_rechaza_perdida(self) -> None:
        """Reenvío solo necesita metadatos y recibo, nunca descarga archivos del Worker o de los datos."""
        descriptor = self.conservar()
        self.almacen.eventos.clear()
        self.assertEqual(trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen), (descriptor, recibo()))
        lecturas = [clave for accion, clave in self.almacen.eventos if accion == "recuperar"]
        self.assertEqual(
            lecturas,
            [
                f"blobs/{hashlib.sha256(recibo()).hexdigest()}",
                f"generaciones/{self.nueva['sha256Manifiesto']}.json",
                f"artefactos/{self.artefacto['sha256Artefacto']}.json",
            ],
        )
        self.almacen.objetos.pop(lecturas[-1])
        antes = dict(self.almacen.objetos)
        with self.assertRaises(ValueError):
            trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen)
        self.assertEqual(self.almacen.objetos, antes)

    def test_v2_esquema_cerrado_y_replay_con_artefacto_distinto_no_escriben(self) -> None:
        """Ni retirar el vínculo ni variar su hash permite reinterpretar el mismo índice."""
        self.conservar()
        clave = f"trabajos/{SOLICITUD}/1/123.json"
        original = self.almacen.objetos[clave]
        for mutar in (
            lambda d: d.pop("artefacto"),
            lambda d: d.update(artefacto=None),
            lambda d: d["artefacto"].update(sha256Artefacto="../otro"),
            lambda d: d.update(version=True),
        ):
            d = json.loads(original)
            mutar(d)
            self.almacen.objetos[clave] = serializar(d)
            with self.subTest(indice=d), self.assertRaises(ValueError):
                trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen)
        self.almacen.objetos[clave] = original
        antes = dict(self.almacen.objetos)
        with self.assertRaises(ValueError):
            trabajos.conservar_trabajo(
                recibo(), "123", CODIGO, self.inicial, self.nueva, artefacto=None, almacen=self.almacen
            )
        self.assertEqual(self.almacen.objetos, antes)

    def test_indice_v1_confirmado_o_cas_pendiente_conserva_bytes_sin_artefacto(self) -> None:
        """No migra el legado ni inventa capacidad de activación al reenviar su recibo exacto."""
        for pendiente in (False, True):
            with self.subTest(cas_pendiente=pendiente):
                self.setUp()
                if pendiente:
                    self.almacen.corte = (trabajos.REFERENCIA, "antes")
                    with self.assertRaises(trabajos.ConflictoReferencia):
                        self.conservar()
                    self.almacen.corte = None
                else:
                    self.conservar()
                clave = f"trabajos/{SOLICITUD}/1/123.json"
                legado = json.loads(self.almacen.objetos[clave])
                legado.update(version=1)
                legado.pop("artefacto")
                exacto = serializar(legado)
                self.almacen.objetos[clave] = exacto
                self.almacen.objetos.pop(f"artefactos/{self.artefacto['sha256Artefacto']}.json")
                self.almacen.eventos.clear()
                self.assertEqual(trabajos.recuperar_trabajo(SOLICITUD, 1, "123", self.almacen), (legado, recibo()))
                conservado = trabajos.conservar_trabajo(
                    recibo(), "123", CODIGO, trabajos.leer_referencia(self.almacen), self.nueva, almacen=self.almacen
                )
                self.assertEqual(conservado, legado)
                self.assertEqual(self.almacen.objetos[clave], exacto)
                self.assertEqual(trabajos.leer_referencia(self.almacen)["revisionReserva"], 1)
                self.assertFalse(any(e == ("control", clave) or e[0] == "guardar" for e in self.almacen.eventos))
                self.assertFalse(any(e[1].startswith("artefactos/") for e in self.almacen.eventos))
                with self.assertRaises(ValueError):
                    trabajos.conservar_trabajo(
                        recibo(),
                        "123",
                        CODIGO,
                        self.inicial,
                        self.nueva,
                        artefacto=self.artefacto,
                        almacen=self.almacen,
                    )

    def test_fallo_lector_de_marcador_no_degrada_validado(self) -> None:
        """Un problema remoto no convierte en ausente el artefacto requerido."""
        with (
            mock.patch.object(trabajos, "leer_descriptor_artefacto", side_effect=OSError("privado")),
            self.assertRaises(OSError),
        ):
            self.conservar()
        self.assertFalse(any(e[0] in ("guardar", "control") for e in self.almacen.eventos))


class PruebaPoliticaDeLasFuentesDelRecibo(unittest.TestCase):
    """El recibo de un trabajo admite la política diaria de las fichas y rechaza una política desconocida."""

    def test_politica_diaria_admitida_y_desconocida_rechazada(self) -> None:
        """Una fuente diaria con plazo de un día es válida; «cada-tanto» no lo es."""
        instantanea._fuente({"id": "formacion", "politica": "diaria", "fecha": None, "plazoDias": 1})
        with self.assertRaises(trabajos.AlmacenTrabajoInvalido):
            instantanea._fuente({"id": "formacion", "politica": "cada-tanto", "fecha": None, "plazoDias": 1})

    def test_codigo_del_almacen_solo_en_el_paquete_y_fuera_de_verde(self) -> None:
        """La instantánea conservada admite el código cerrado en un paquete en ámbar; en otro caso, se rechaza."""
        base = snapshot()
        ambar = {"veredicto": "ámbar", "fallos": 1, "proximoReintento": "2026-10-16T14:20:01Z"}
        instantanea.validar_instantanea(base)
        valido = {
            **base,
            "modulos": [base["modulos"][0], {**base["modulos"][1], **ambar, "motivoAlmacen": "almacen-vacio"}],
        }
        instantanea.validar_instantanea(valido)
        for modulos in (
            [base["modulos"][0], {**base["modulos"][1], "motivoAlmacen": "almacen-vacio"}],
            [base["modulos"][0], {**base["modulos"][1], **ambar, "motivoAlmacen": "almacen-roto"}],
            [base["modulos"][0], {**base["modulos"][1], **ambar, "motivoAlmacen": None}],
            [{**base["modulos"][0], **ambar, "motivoAlmacen": "almacen-vacio"}, base["modulos"][1]],
        ):
            with self.subTest(modulos=modulos), self.assertRaises(trabajos.AlmacenTrabajoInvalido):
                instantanea.validar_instantanea({**base, "modulos": modulos})

    def test_edicion_nueva_solo_en_una_fuente_por_ediciones_y_con_su_forma(self) -> None:
        """La fila de una fuente por ediciones admite la observación cerrada; sin ella conserva su forma anterior."""
        base = snapshot()
        fuente = {**base["fuentes"][0], "politica": "edición"}
        nueva = {
            "estado": "publicada-sin-microdatos",
            "anio": "2026",
            "observadoEn": INSTANTE,
            "huellaCatalogo": "a" * 64,
        }
        instantanea.validar_instantanea({**base, "fuentes": [fuente]})
        instantanea.validar_instantanea({**base, "fuentes": [{**fuente, "edicionNueva": nueva}]})
        con_descarte = {**fuente, "edicionNueva": nueva, "avisoEdicion": "observacion-anterior-descartada"}
        instantanea.validar_instantanea({**base, "fuentes": [con_descarte]})
        instantanea.validar_instantanea({**base, "fuentes": [{**fuente, "gruposEnSuGranGrupo": 2}]})
        for aviso in ("edicion-no-verificable", "sin-contraste-con-la-tich"):
            instantanea.validar_instantanea({**base, "fuentes": [{**fuente, "avisoEdicion": aviso}]})
        for fila in (
            {**base["fuentes"][0], "edicionNueva": nueva},
            {**fuente, "edicionNueva": None},
            {**fuente, "edicionNueva": {**nueva, "estado": "fallo"}},
            {**fuente, "edicionNueva": {**nueva, "anio": "26"}},
            {**fuente, "edicionNueva": {**nueva, "observadoEn": "2026-10-16"}},
            {**fuente, "edicionNueva": {**nueva, "observadoEn": "2099-01-01T00:00:00Z"}},
            {**fuente, "edicionNueva": {**nueva, "huellaCatalogo": "y" * 64}},
            {**fuente, "edicionNueva": {**nueva, "extra": 1}},
            {**fuente, "avisoEdicion": "otro"},
            {**fuente, "avisoEdicion": None},
            {**base["fuentes"][0], "avisoEdicion": "sin-contraste-con-la-tich"},
            {**fuente, "edicionNueva": nueva, "avisoEdicion": "edicion-no-verificable"},
            {**fuente, "avisoEdicion": "observacion-anterior-descartada"},
            {**fuente, "gruposEnSuGranGrupo": 0},
            {**fuente, "gruposEnSuGranGrupo": True},
            {**base["fuentes"][0], "gruposEnSuGranGrupo": 1},
        ):
            with self.subTest(fila=fila), self.assertRaises(trabajos.AlmacenTrabajoInvalido):
                instantanea.validar_instantanea({**base, "fuentes": [fila]})


if __name__ == "__main__":
    unittest.main()
