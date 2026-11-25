"""Resumen pequeño y cerrado del diario de una ejecución, para leerlo sin descargar el diario completo.

El diario completo puede ocupar hasta 8 MiB; el panel solo puede leer una pieza pequeña. El resumen se compone
a partir de las líneas del diario y solo copia campos de una lista cerrada, cada uno con su forma validada:
nunca lleva direcciones, rutas, credenciales, cuerpos de respuesta ni texto libre.
"""

import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from plataforma_datos.orquestacion.causas_del_ciclo import (
    ARCHIVO_DEL_PAQUETE,
    CAUSAS_DE_LA_GENERACION_NO_CONSERVADA,
    CLASES_DE_ERROR,
    COMPROBACIONES_DE_LA_GENERACION,
    MAX_ALARMAS,
    PASOS,
    TIPOS_DE_ALARMA,
)
from plataforma_datos.orquestacion.ejecucion_observada import ETAPAS
from plataforma_datos.orquestacion.estado_de_la_actualizacion import AMBAR, ROJO, VERDE
from plataforma_datos.orquestacion.fallo_del_candidato import CLASES, ERRORES_DEL_RECIBO, FUNCION, OTRA
from plataforma_datos.orquestacion.fallo_del_paso import CLASES as CLASES_DEL_PASO
from plataforma_datos.orquestacion.fallo_del_paso import ERRNOS, MOTIVOS_DEL_ALMACEN, TRAMOS
from plataforma_datos.orquestacion.formas_del_diario import (
    CURSO,
    MAX_RESUMEN,
    NOMBRE,
    OPERACIONES,
    es_causa,
    es_salud_valida,
)
from plataforma_datos.orquestacion.modulos import IDS
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.salud_del_resumen import parte_de_salud

# La versión 2 añade `salud`; los campos de la versión 1 conservan su nombre y su forma, de modo que quien lee por
# presencia de campo no se rompe. Ningún lector debe decidir por el número de versión.
VERSION = 2
MAX_MUESTRA = 50
# Los campos de la línea de fallo del paso del paquete en rojo, con la lista de cada uno (más `otra`).
FALLO_DEL_PASO = {"tramo": TRAMOS, "clase": CLASES_DEL_PASO, "errno": ERRNOS, "motivoAlmacen": MOTIVOS_DEL_ALMACEN}
# Un cambio de curso nombra como mucho los cinco campos que compara la proyección de cursos.
MAX_CAMPOS = 5
# Reserva para que los recuentos de lo omitido quepan aunque crezcan sus cifras al recortar.
MARGEN_RECORTE = 512
CAMBIOS = {"alta": "altas", "retirada": "retiradas", "modificacion": "modificaciones"}
SERVICIOS = ("oidc", "autoridad")
COMPARACIONES_DE_CLAIM = ("coincide", "distinto", "ausente")
VEREDICTOS = (VERDE, AMBAR, ROJO)
# Orden de recorte: primero lo que menos explica cómo terminó la ejecución.
LISTAS_RECORTABLES = ("muestra", "fuentes", "fases", "modulos", "respuestasRechazadas")

NUMERO = re.compile(r"[1-9][0-9]{0,15}")
REVISION = re.compile(r"[0-9a-f]{40}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
UTC = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)")
ABRE, SIGUE, CIERRAN = "inicio", "reintento", ("confirmado", "error")


class ResumenNoValido(ValueError):
    """El diario no cumple la forma que el resumen sabe leer; el diario completo sigue siendo la referencia."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ResumenNoValido("Diario no resumible")


def _texto(valor: object, patron: re.Pattern[str]) -> str:
    _exigir(isinstance(valor, str) and patron.fullmatch(valor) is not None)
    return valor


def _opcional(valor: object, patron: re.Pattern[str]) -> str | None:
    return None if valor is None else _texto(valor, patron)


def _causa(valor: object) -> str | None:
    _exigir(valor is None or (isinstance(valor, str) and es_causa(valor)))
    return valor


def _de_lista(valor: object, admitidos: Iterable[str]) -> str:
    _exigir(isinstance(valor, str) and valor in admitidos)
    return valor


def _entero(valor: object, minimo: int, maximo: int) -> int:
    _exigir(type(valor) is int and minimo <= valor <= maximo)
    return valor


def _bytes(valor: object) -> bytes:
    return json.dumps(valor, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def _alarma(alarma: object) -> dict[str, str | None]:
    _exigir(isinstance(alarma, dict))
    return {
        "tipo": _de_lista(alarma.get("tipo"), TIPOS_DE_ALARMA),
        "archivo": _opcional(alarma.get("archivo"), ARCHIVO_DEL_PAQUETE),
    }


class _Composicion:
    """Recorre los hechos del diario en orden y reparte cada uno en su apartado del resumen."""

    def __init__(self, operacion: str, run: str, intento: str) -> None:
        self.identidad: dict[str, str | None] = {
            "operacion": _de_lista(operacion, OPERACIONES),
            "run": _texto(run, NUMERO),
            "intento": _texto(intento, NUMERO),
            "revisionCodigo": None,
            "reserva": None,
        }
        self.periodo: dict[str, str | None] = {"desde": None, "hasta": None}
        self.resultado: dict[str, str | None] = {"operacion": None, "faseFinal": None, "candidato": None}
        self.fases: list[dict[str, Any]] = []
        self.abiertas: dict[str, dict[str, Any]] = {}
        self.fuentes: list[dict[str, Any]] = []
        self.modulos: list[dict[str, Any]] = []
        self.cursos: dict[str, Any] = {
            "comparacion": "ausente",
            "antes": None,
            "despues": None,
            "altas": None,
            "retiradas": None,
            "modificaciones": None,
            "muestra": [],
        }
        self.respuestas: list[dict[str, Any]] = []
        self.identidad_oidc: dict[str, Any] | None = None
        # Por qué se retuvo el paquete, por qué no se conservó la generación del intento y con qué error y qué
        # excepción se rechazó el candidato, si pasó en este ciclo.
        self.retenciones: dict[str, Any] = {"paquete": None, "generacion": None, "candidato": None}

    def _identidad(self, evento: dict[str, Any]) -> None:
        # Algunos hechos reutilizan «operacion» o «intento» para su propio dato; la ejecución la fijan run,
        # revisión y reserva, que nadie reutiliza.
        if "run" in evento:
            _exigir(evento["run"] == self.identidad["run"])
        for campo, patron in (("revisionCodigo", REVISION), ("reserva", NUMERO)):
            if campo in evento:
                valor = _texto(evento[campo], patron)
                _exigir(self.identidad[campo] in (None, valor))
                self.identidad[campo] = valor

    def anadir(self, evento: dict[str, Any]) -> None:
        _exigir(type(evento.get("version")) is int and evento["version"] == 1)
        self._identidad(evento)
        utc = _texto(evento.get("utc"), UTC)
        self.periodo["desde"] = self.periodo["desde"] or utc
        self.periodo["hasta"] = utc
        fase, estado = _texto(evento.get("fase"), NOMBRE), _texto(evento.get("estado"), NOMBRE)
        especial = {
            "etapa-fuente": self._fuente,
            "modulo": self._modulo,
            "curso-candidato": self._curso,
            "cambios-cursos": self._cambios,
            "respuesta-http": self._respuesta,
            "paquete": self._paquete,
            "generacion": self._generacion,
        }.get(fase)
        if especial is not None:
            especial(estado, evento)
        elif (fase, estado) == ("identidad-oidc", "metadatos"):
            self._oidc(evento)
        elif (fase, estado) == ("operacion", "resultado"):
            self.resultado["operacion"] = _opcional(evento.get("resultado"), NOMBRE)
            self.resultado["faseFinal"] = _opcional(evento.get("faseFinal"), NOMBRE)
        elif (fase, estado) == ("candidato", "resultado"):
            self.resultado["candidato"] = _opcional(evento.get("resultado"), NOMBRE)
            if evento.get("error") is not None:
                self._candidato()["error"] = _de_lista(evento["error"], (*ERRORES_DEL_RECIBO, OTRA))
        elif (fase, estado) == ("candidato", "excepcion"):
            funcion = OTRA if evento.get("funcion") == OTRA else _texto(evento.get("funcion"), FUNCION)
            self._candidato().update(clase=_de_lista(evento.get("clase"), (*CLASES, OTRA)), funcion=funcion)
        else:
            self._fase(fase, estado, _causa(evento.get("causa")), utc)

    def _candidato(self) -> dict[str, str | None]:
        # El error llega con el recibo y la excepción, antes, al terminar el motor: los dos van a la misma retención.
        if self.retenciones["candidato"] is None:
            self.retenciones["candidato"] = {"error": None, "clase": None, "funcion": None}
        return self.retenciones["candidato"]

    def _fase(self, fase: str, estado: str, causa: str | None, utc: str) -> None:
        # Un paso abierto recoge sus reintentos y su cierre; el resto de hechos iguales y seguidos se cuentan.
        abierta = self.abiertas.get(fase)
        if abierta is not None and (estado == SIGUE or estado in CIERRAN):
            abierta.update(estado=estado, causa=causa, fin=utc, eventos=abierta["eventos"] + 1)
            if estado in CIERRAN:
                del self.abiertas[fase]
            return
        ultima = next((f for f in reversed(self.fases) if f["fase"] == fase), None)
        repetida = (
            ultima is not None and ultima is not abierta and (ultima["estado"], ultima["causa"]) == (estado, causa)
        )
        if estado != ABRE and repetida:
            ultima.update(fin=utc, eventos=ultima["eventos"] + 1)
            return
        entrada = {"fase": fase, "estado": estado, "causa": causa, "inicio": utc, "fin": utc, "eventos": 1}
        self.fases.append(entrada)
        if estado == ABRE:
            self.abiertas[fase] = entrada

    def _fuente(self, estado: str, evento: dict[str, Any]) -> None:
        self.fuentes.append(
            {
                "fuente": _de_lista(evento.get("fuente"), FUENTES),
                "etapa": _de_lista(evento.get("etapa"), ETAPAS),
                "intentoFuente": _texto(evento.get("intentoFuente"), UUID),
                "estado": estado,
                "inicio": _opcional(evento.get("inicio"), UTC),
                "fin": _opcional(evento.get("fin"), UTC),
                "codigo": None if evento.get("codigo") is None else _entero(evento["codigo"], -255, 255),
                "causa": _causa(evento.get("causa")),
            }
        )

    def _modulo(self, estado: str, evento: dict[str, Any]) -> None:
        _exigir(estado == "observado")
        veredicto = evento.get("veredicto")
        self.modulos.append(
            {
                "id": _de_lista(evento.get("id"), IDS),
                "veredicto": None if veredicto is None else _de_lista(veredicto, VEREDICTOS),
                "ultimoIntento": _opcional(evento.get("ultimoIntento"), UTC),
                "proximoReintento": _opcional(evento.get("proximoReintento"), UTC),
            }
        )

    def _curso(self, estado: str, evento: dict[str, Any]) -> None:
        cambio = _de_lista(estado, CAMBIOS)
        campos = evento.get("campos")
        _exigir(isinstance(campos, list) and len(campos) <= MAX_CAMPOS)
        if len(self.cursos["muestra"]) < MAX_MUESTRA:
            self.cursos["muestra"].append(
                {
                    "curso": _texto(evento.get("curso"), CURSO),
                    "cambio": cambio,
                    "campos": [_texto(campo, NOMBRE) for campo in campos],
                }
            )

    def _cambios(self, estado: str, evento: dict[str, Any]) -> None:
        self.cursos["comparacion"] = _de_lista(estado, ("comparado", "sin-comparacion"))
        if estado == "comparado":
            for campo in ("antes", "despues", *CAMBIOS):
                self.cursos[CAMBIOS.get(campo, campo)] = _entero(evento.get(campo), 0, 2**53 - 1)

    def _respuesta(self, estado: str, evento: dict[str, Any]) -> None:
        _exigir(estado == "rechazada")
        self.respuestas.append(
            {
                "servicio": _de_lista(evento.get("servicio"), SERVICIOS),
                "http": _entero(evento.get("http"), 100, 599),
            }
        )

    def _paquete(self, estado: str, evento: dict[str, Any]) -> None:
        if _de_lista(estado, ("retenido", "ilegible")) == "ilegible":
            self.retenciones["paquete"] = {
                "paso": None,
                "codigo": None,
                "alarmas": [],
                "legible": False,
                **dict.fromkeys(FALLO_DEL_PASO),
            }
            return
        alarmas = evento.get("alarmas")
        _exigir(isinstance(alarmas, list) and len(alarmas) <= MAX_ALARMAS)
        self.retenciones["paquete"] = {
            "paso": None if evento.get("paso") is None else _de_lista(evento["paso"], PASOS),
            "codigo": None if evento.get("codigo") is None else _entero(evento["codigo"], -255, 255),
            "alarmas": [_alarma(alarma) for alarma in alarmas],
            "legible": True,
            # Lo que dijo la línea de fallo del paso en rojo (`fallo_del_paso`); None si no la dejó.
            **{
                campo: None if evento.get(campo) is None else _de_lista(evento[campo], (*admitidos, OTRA))
                for campo, admitidos in FALLO_DEL_PASO.items()
            },
        }

    def _generacion(self, estado: str, evento: dict[str, Any]) -> None:
        _exigir(estado == "no-conservada")
        comprobaciones = (*COMPROBACIONES_DE_LA_GENERACION, "otra")
        self.retenciones["generacion"] = {
            "clase": _de_lista(evento.get("clase"), (*CLASES_DE_ERROR, "otra")),
            "comprobacion": _de_lista(evento.get("comprobacion"), comprobaciones),
            "causa": _de_lista(evento.get("causa"), CAUSAS_DE_LA_GENERACION_NO_CONSERVADA),
        }

    def _oidc(self, evento: dict[str, Any]) -> None:
        # Cada petición pide un token nuevo; vale el último, que es el de la petición que cerró la ejecución.
        audiencia = evento.get("audienciaEsperada")
        _exigir(type(audiencia) is bool)
        self.identidad_oidc = {
            "audienciaEsperada": audiencia,
            "referenciaDeJob": _de_lista(evento.get("referenciaDeJob"), COMPARACIONES_DE_CLAIM),
            "revisionDeJob": _de_lista(evento.get("revisionDeJob"), COMPARACIONES_DE_CLAIM),
        }

    def estado_final(self) -> str:
        if self.resultado["operacion"] is not None:
            return "terminado"
        if any(fase["estado"] == "error" for fase in self.fases):
            return "fallido"
        return "sin-cierre"

    def documento(self, salud: dict[str, Any]) -> dict[str, Any]:
        return {
            "version": VERSION,
            "identidad": self.identidad,
            "periodo": self.periodo,
            "resultado": {"estado": self.estado_final(), **self.resultado},
            "fases": self.fases,
            "fuentes": self.fuentes,
            "modulos": self.modulos,
            "cursos": self.cursos,
            "respuestasRechazadas": self.respuestas,
            "identidadOidc": self.identidad_oidc,
            "retenciones": self.retenciones,
            "salud": salud,
            "recorte": {"aplicado": False, "omitidos": dict.fromkeys(LISTAS_RECORTABLES, 0)},
        }


def _lista(resumen: dict[str, Any], nombre: str) -> list[dict[str, Any]]:
    return resumen["cursos"]["muestra"] if nombre == "muestra" else resumen[nombre]


def _recortar(resumen: dict[str, Any]) -> None:
    """Quita entradas desde el principio de cada lista, en un orden fijo, hasta que el resumen cabe.

    El mismo diario da siempre el mismo recorte, y el resumen dice cuántas entradas omitió de cada lista.
    """
    tamano = len(_bytes(resumen))
    omitidos = resumen["recorte"]["omitidos"]
    for nombre in LISTAS_RECORTABLES:
        lista = _lista(resumen, nombre)
        while tamano > MAX_RESUMEN - MARGEN_RECORTE and lista:
            quitada = lista.pop(0)
            # Al quitar una entrada desaparece también su coma, salvo si era la última de la lista.
            tamano -= len(_bytes(quitada)) + (1 if lista else 0)
            omitidos[nombre] += 1
    resumen["recorte"]["aplicado"] = any(omitidos.values())


def componer(lineas: Iterable[str], operacion: str, run: str, intento: str, raiz: Path | None = None) -> bytes:
    """Compone el resumen de una ejecución a partir de las líneas JSON de su diario.

    El bloque `salud` se compone con las lecturas que la instalación `raiz` guarda de este ciclo; sin `raiz` el parte
    dice que no se calculó, nunca que todo está sano.

    Returns:
        Documento JSON en UTF-8 de como mucho MAX_RESUMEN bytes.

    Raises:
        ResumenNoValido: Si una línea no tiene la forma cerrada que escribe el diario.
    """
    composicion = _Composicion(operacion, run, intento)
    for linea in lineas:
        if not linea.strip():
            continue
        try:
            evento = json.loads(linea)
        except ValueError:
            raise ResumenNoValido("Diario no resumible") from None
        _exigir(isinstance(evento, dict))
        composicion.anadir(evento)
    resumen = composicion.documento(parte_de_salud(raiz, composicion.periodo, composicion.fuentes))
    _exigir(es_salud_valida(resumen["salud"]))
    _recortar(resumen)
    contenido = _bytes(resumen)
    _exigir(len(contenido) <= MAX_RESUMEN)
    return contenido
