"""Registro privado acotado de comprobaciones; el llamador conserva el cerrojo de actualizar.

No adquiere otro cerrojo ni acredita tráfico activo. Las escrituras son atómicas; un ciclo abierto tras un corte
queda pendiente hasta una nueva ejecución. Ensayos y recibos públicos usan contratos independientes.
"""

import hashlib
import json
import os
import re
import stat
import uuid
from collections.abc import Sequence
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from plataforma_datos.comun.entrada_salida import temporal_hermano
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado
from plataforma_datos.comun.observacion_remota import MAX_PETICIONES, validar_recepcion
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS

ARCHIVO = f"{DATOS_RELATIVOS.as_posix()}/ejecuciones/comprobaciones.json"
VERSION_REGISTRO = 2
VERSION_LEGADA = 1
MAX_REGISTRO_BYTES = 256 * 1024
ERROR = "Registro de comprobaciones no verificable."
INSTANTE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{6})?Z")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
SHA256 = re.compile(r"[0-9a-f]{64}")
CONJUNTO_FUENTE = {conjunto.id: conjunto.fuente for conjunto in CONJUNTOS}
FUENTES = {fuente for fuente in CONJUNTO_FUENTE.values() if fuente is not None}
# Los topes del registro son los del plan: una fuente nueva en planificacion_de_comprobaciones no obliga a tocarlos.
MAX_CONJUNTOS = len(CONJUNTO_FUENTE)
MAX_FUENTES = len(FUENTES)
CONJUNTOS_REMOTOS = frozenset(c.id for c in CONJUNTOS if c.operacion == "descargar")
# «completa»: consulta remota sin unidades caídas de una fuente de cobertura limitada; no acredita sus conjuntos.
# «parcial»: la consulta terminó, pero faltaron unidades o no cubrió lo declarado.
RESULTADOS_FUENTE = ("en-curso", "interrumpido", "comprobada", "completa", "parcial", "fallo", "local")
RESULTADOS_EXITOSOS = ("comprobada", "completa", "parcial")
RESULTADOS_CICLO = ("en-curso", "preparado", "sin-cambios", "fallo")
# Un intento remoto fallido o cortado adelanta el reintento; uno terminado, aunque parcial, vuelve a la cadencia.
RESULTADOS_FALLIDOS = ("fallo", "interrumpido")
MAX_FALLOS_SEGUIDOS = (1 << 31) - 1
type ResultadoFuente = Literal["comprobada", "completa", "parcial", "fallo", "local"]


class RegistroComprobacionesInvalido(ValueError):
    """Datos, cronología o transición que no permiten afirmar una comprobación."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise RegistroComprobacionesInvalido(ERROR)


def _objeto(valor: object, campos: str) -> dict[str, Any]:
    _exigir(type(valor) is dict and set(valor) == set(campos.split(",")))
    return valor


def _utc(ahora: datetime) -> str:
    _exigir(isinstance(ahora, datetime) and ahora.tzinfo is not None and ahora.utcoffset() == UTC.utcoffset(ahora))
    return ahora.isoformat().replace("+00:00", "Z")


def _instante(valor: object) -> datetime:
    _exigir(isinstance(valor, str) and INSTANTE.fullmatch(valor) is not None)
    instante = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    _exigir(_utc(instante) == valor)
    return instante


def _id_ciclo(valor: object) -> None:
    _exigir(isinstance(valor, str) and UUID.fullmatch(valor) is not None)


def _ids(valores: object, fuente: str, *, vacio: bool = False) -> list[str]:
    _exigir(isinstance(valores, (list, tuple)) and (vacio or bool(valores)) and len(valores) <= MAX_CONJUNTOS)
    _exigir(all(isinstance(valor, str) and CONJUNTO_FUENTE.get(valor) == fuente for valor in valores))
    _exigir(len(set(valores)) == len(valores))
    return list(valores)


def _vacio(version: int = VERSION_REGISTRO) -> dict[str, Any]:
    documento = {
        "version": version,
        "reloj_utc": None,
        "ultimo_ciclo": None,
        "fuentes": {},
        "conjuntos": {},
        "reconstruccion_pendiente": False,
    }
    if version == VERSION_REGISTRO:
        documento["seguimiento_remoto"] = {}
    return documento


def _validar_resumen(valor: object, inicio: datetime, fin: datetime) -> dict[str, Any]:
    resumen = _objeto(valor, "intento,sha256,peticiones,bytes,comienzo_utc,fin_utc")
    _exigir(
        isinstance(resumen["intento"], str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", resumen["intento"]) is not None
    )
    _exigir(isinstance(resumen["sha256"], str) and SHA256.fullmatch(resumen["sha256"]) is not None)
    _exigir(type(resumen["peticiones"]) is int and 0 <= resumen["peticiones"] <= MAX_PETICIONES)
    _exigir(type(resumen["bytes"]) is int and 0 <= resumen["bytes"] <= (1 << 53) - 1)
    _exigir(resumen["peticiones"] > 0 or resumen["bytes"] == 0)
    _exigir(inicio <= _instante(resumen["comienzo_utc"]) <= _instante(resumen["fin_utc"]) <= fin)
    return resumen


def _validar_fuente(fuente: str, valor: object, reloj: datetime) -> None:
    fila = _objeto(
        valor, "ciclo,conjuntos,inicio_utc,fin_utc,resultado,evidencia,comprobados,remoto,ultimo_intento_remoto_utc"
    )
    _exigir(fuente in FUENTES)
    _exigir(type(fila["remoto"]) is bool)
    _id_ciclo(fila["ciclo"])
    inicio = _instante(fila["inicio_utc"])
    _exigir(inicio <= reloj and fila["resultado"] in RESULTADOS_FUENTE)
    ultimo_remoto = fila["ultimo_intento_remoto_utc"]
    _exigir(ultimo_remoto is None or _instante(ultimo_remoto) <= inicio)
    _exigir(not fila["remoto"] or ultimo_remoto == fila["inicio_utc"])
    conjuntos = _ids(fila["conjuntos"], fuente)
    comprobados = _ids(fila["comprobados"], fuente, vacio=True)
    _exigir(set(comprobados) <= set(conjuntos))
    if fila["resultado"] == "en-curso":
        _exigir(fila["fin_utc"] is None and fila["evidencia"] is None and not comprobados)
        return
    fin = _instante(fila["fin_utc"])
    _exigir(inicio <= fin <= reloj)
    resumen = None if fila["evidencia"] is None else _validar_resumen(fila["evidencia"], inicio, fin)
    if fila["resultado"] == "comprobada":
        _exigir(bool(comprobados) and set(comprobados) == set(conjuntos))
    if fila["resultado"] == "parcial":
        _exigir(set(comprobados) != set(conjuntos))
    if fila["resultado"] in ("fallo", "local", "interrumpido", "completa"):
        _exigir(not comprobados)
    if fila["resultado"] == "completa":
        _exigir(fila["remoto"] and resumen is not None and resumen["peticiones"] > 0)
    _exigir(not comprobados or (fila["remoto"] and resumen is not None and resumen["peticiones"] > 0))


def _validar_ciclo(valor: object, reloj: datetime) -> dict[str, Any]:
    ciclo = _objeto(valor, "id,modo,inicio_utc,fin_utc,resultado,paquete_preparado")
    _id_ciclo(ciclo["id"])
    _exigir(ciclo["modo"] in ("manual", "programada", "vencidas") and ciclo["resultado"] in RESULTADOS_CICLO)
    _exigir(type(ciclo["paquete_preparado"]) is bool)
    inicio = _instante(ciclo["inicio_utc"])
    _exigir(inicio <= reloj)
    if ciclo["resultado"] == "en-curso":
        _exigir(ciclo["fin_utc"] is None and not ciclo["paquete_preparado"])
    else:
        _exigir(inicio <= _instante(ciclo["fin_utc"]) <= reloj)
        _exigir(_instante(ciclo["fin_utc"]) == reloj)
        _exigir(ciclo["resultado"] != "fallo" or not ciclo["paquete_preparado"])
        _exigir(ciclo["resultado"] != "preparado" or ciclo["paquete_preparado"])
    return ciclo


def _validar_conjunto(identificador: str, valor: object, fuentes: dict[str, Any], reloj: datetime) -> None:
    fila = _objeto(valor, "fuente,ciclo,comprobado_utc,sha256_evidencia")
    _exigir(identificador in CONJUNTO_FUENTE and isinstance(fila["fuente"], str) and fila["fuente"] in fuentes)
    _exigir(CONJUNTO_FUENTE[identificador] == fila["fuente"])
    _id_ciclo(fila["ciclo"])
    comprobado = _instante(fila["comprobado_utc"])
    _exigir(comprobado <= reloj)
    _exigir(isinstance(fila["sha256_evidencia"], str) and SHA256.fullmatch(fila["sha256_evidencia"]) is not None)
    fuente = fuentes[fila["fuente"]]
    if fuente["ciclo"] == fila["ciclo"]:
        _exigir(identificador in fuente["comprobados"] and fuente["evidencia"] is not None)
        _exigir(fila["sha256_evidencia"] == fuente["evidencia"]["sha256"])
        _exigir(comprobado == _instante(fuente["fin_utc"]))
    else:
        _exigir(comprobado <= _instante(fuente["inicio_utc"]))


def _fallos_conocidos(seguimiento: dict[str, Any]) -> int:
    """Fallos remotos seguidos que el registro acredita, también si se escribió antes de contarlos.

    Un registro sin la cuenta solo conserva el último intento: si falló o se interrumpió, la racha demostrable es
    uno. La cuenta decide cuándo reintentar; nunca cambia lo publicado ni lo que se muestra.

    Returns:
        La cuenta guardada o, sin ella, 1 si el último intento remoto falló o se interrumpió y 0 en otro caso.
    """
    if "fallos_seguidos" in seguimiento:
        return seguimiento["fallos_seguidos"]
    ultimo = seguimiento["ultimo_intento"]
    return int(ultimo is not None and ultimo["resultado"] in RESULTADOS_FALLIDOS)


def fallos_registrados(registro: dict[str, Any], fuente: str) -> int:
    """Fallos remotos seguidos ya cerrados de la fuente, sin suponer nada de una fila «en-curso».

    Returns:
        La cuenta conservada; 0 si la fuente nunca tuvo un intento remoto.
    """
    seguimiento = registro.get("seguimiento_remoto", {}).get(fuente)
    return 0 if seguimiento is None else _fallos_conocidos(seguimiento)


def fallos_remotos_seguidos(registro: dict[str, Any], fuente: str) -> int:
    """Intentos remotos seguidos sin éxito de la fuente, contando como interrumpido uno que quedó «en-curso».

    Se consulta con el cerrojo de actualizar y antes de abrir otro ciclo: una fila «en-curso» solo puede ser de un
    proceso cortado, que el ciclo siguiente marcará «interrumpido».

    Returns:
        0 tras un éxito o sin intentos remotos; 1, 2, 3… tras fallos o cortes seguidos.
    """
    seguimiento = registro.get("seguimiento_remoto", {}).get(fuente)
    if seguimiento is None:
        return 0
    fallos = _fallos_conocidos(seguimiento)
    ultimo = seguimiento["ultimo_intento"]
    return fallos + 1 if ultimo is not None and ultimo["resultado"] == "en-curso" else fallos


def _seguir_remoto(registro: dict[str, object], fuente: str, fila: dict[str, object]) -> None:
    """Conserva recepción, pendientes por conjunto y fallos seguidos; una operación local no los resuelve."""
    seguimiento = registro["seguimiento_remoto"].setdefault(
        fuente, {"ultimo_intento": None, "incidencias_pendientes": {}, "fallos_seguidos": 0}
    )
    seguimiento["fallos_seguidos"] = _fallos_conocidos(seguimiento)
    if not fila["remoto"]:
        return
    seguimiento["ultimo_intento"] = deepcopy(fila)
    if fila["resultado"] in RESULTADOS_FALLIDOS:
        seguimiento["fallos_seguidos"] += 1
    elif fila["resultado"] in RESULTADOS_EXITOSOS:
        seguimiento["fallos_seguidos"] = 0
    pendientes = seguimiento["incidencias_pendientes"]
    # Una consulta completa resuelve las incidencias previas aunque la cobertura de la fuente no acredite el conjunto.
    for conjunto in fila["conjuntos"] if fila["resultado"] == "completa" else fila["comprobados"]:
        pendientes.pop(conjunto, None)
    if fila["resultado"] in ("fallo", "parcial", "interrumpido"):
        for conjunto in set(fila["conjuntos"]) & CONJUNTOS_REMOTOS - set(fila["comprobados"]):
            if fila["resultado"] != "fallo":
                pendientes.setdefault(conjunto, deepcopy(fila))
            else:
                pendientes[conjunto] = deepcopy(fila)


def _validar_incidencia(fuente: str, conjunto: str, fila: dict[str, object], registro: dict[str, object]) -> None:
    """Comprueba que la incidencia remota no esté ya resuelta por una comprobación posterior."""
    _validar_fuente(fuente, fila, _instante(registro["reloj_utc"]))
    _exigir(fila["remoto"] and fila["resultado"] in ("fallo", "parcial", "interrumpido"))
    _exigir(conjunto in CONJUNTOS_REMOTOS and conjunto in fila["conjuntos"] and conjunto not in fila["comprobados"])
    positiva = registro["conjuntos"].get(conjunto)
    _exigir(
        positiva is None
        or (positiva["ciclo"] != fila["ciclo"] and _instante(positiva["comprobado_utc"]) <= _instante(fila["fin_utc"]))
    )


def _validar_seguimiento(registro: dict[str, object], reloj: datetime) -> None:
    """Contrasta los dos planos y sus relaciones sin deducir historia ausente."""
    seguimientos = registro["seguimiento_remoto"]
    _exigir(type(seguimientos) is dict and set(seguimientos) == set(registro["fuentes"]))
    for fuente, entrada in seguimientos.items():
        # La cuenta de fallos falta en los registros escritos antes de existir; la siguiente escritura la añade.
        _exigir(type(entrada) is dict)
        campos = "ultimo_intento,incidencias_pendientes" + (",fallos_seguidos" if "fallos_seguidos" in entrada else "")
        fila = _objeto(entrada, campos)
        ultimo, pendientes = fila["ultimo_intento"], fila["incidencias_pendientes"]
        _exigir(type(pendientes) is dict and len(pendientes) <= MAX_CONJUNTOS)
        actual = registro["fuentes"][fuente]
        fallos = fila.get("fallos_seguidos", 0)
        _exigir(type(fallos) is int and 0 <= fallos <= MAX_FALLOS_SEGUIDOS)
        if ultimo is None:
            _exigir(not pendientes and not actual["remoto"] and fallos == 0)
            continue
        _validar_fuente(fuente, ultimo, reloj)
        if ultimo["resultado"] in RESULTADOS_EXITOSOS:
            _exigir(fallos == 0)
        if ultimo["resultado"] == "completa":
            _exigir(not pendientes)
        if ultimo["resultado"] in RESULTADOS_FALLIDOS and "fallos_seguidos" in fila:
            _exigir(fallos >= 1)
        _exigir(ultimo["remoto"] and ultimo["inicio_utc"] == actual["ultimo_intento_remoto_utc"])
        _exigir(not actual["remoto"] or actual == ultimo)
        if not actual["remoto"]:
            _exigir(ultimo["fin_utc"] is not None and _instante(ultimo["fin_utc"]) <= _instante(actual["inicio_utc"]))
        for conjunto, incidencia in pendientes.items():
            _exigir(CONJUNTO_FUENTE.get(conjunto) == fuente)
            _exigir(conjunto not in ultimo["comprobados"])
            _validar_incidencia(fuente, conjunto, incidencia, registro)
            _exigir(_instante(incidencia["fin_utc"]) <= _instante(ultimo["fin_utc"] or ultimo["inicio_utc"]))


def migrar_registro(raiz: Path) -> dict[str, object]:
    """Migra explícitamente v1 a v2 sin reconstruir resultados que el legado ya perdió.

    La última fila local conserva su fecha remota conocida, pero su resultado
    remoto previo queda desconocido (ultimo_intento=None). El llamador mantiene
    el cerrojo de actualización, igual que en las otras escrituras. Una fila realmente
    remota permite copiar solo ese intento, nunca incidentes anteriores.

    Returns:
        Registro conservado o migrado; repetir v2 no escribe ni renueva fechas.
    """
    registro = leer_registro(raiz)
    if registro["version"] == VERSION_REGISTRO:
        return registro
    registro = deepcopy(registro)
    registro["version"] = VERSION_REGISTRO
    registro["seguimiento_remoto"] = {}
    for fuente, fila in registro["fuentes"].items():
        _seguir_remoto(registro, fuente, fila)
    _guardar(raiz, registro)
    return registro


def validar_registro(entrada: object) -> dict[str, Any]:
    """Valida documento cerrado sin fabricar éxitos o interpretar textos libres.

    Returns:
        El documento admitido, sin alterar la entrada.
    """
    _exigir(
        type(entrada) is dict
        and type(entrada.get("version")) is int
        and entrada["version"] in (VERSION_LEGADA, VERSION_REGISTRO)
    )
    version = entrada["version"]
    campos = "version,reloj_utc,ultimo_ciclo,fuentes,conjuntos,reconstruccion_pendiente"
    registro = _objeto(entrada, campos + (",seguimiento_remoto" if version == VERSION_REGISTRO else ""))
    _exigir(type(registro["reconstruccion_pendiente"]) is bool)
    fuentes, conjuntos = registro["fuentes"], registro["conjuntos"]
    _exigir(
        type(fuentes) is dict
        and len(fuentes) <= MAX_FUENTES
        and type(conjuntos) is dict
        and len(conjuntos) <= MAX_CONJUNTOS
    )
    if registro["ultimo_ciclo"] is None:
        _exigir(registro == _vacio(version))
        return registro
    reloj = _instante(registro["reloj_utc"])
    ciclo = _validar_ciclo(registro["ultimo_ciclo"], reloj)
    _exigir(registro["reconstruccion_pendiente"] is not ciclo["paquete_preparado"])
    for fuente, fila in fuentes.items():
        _validar_fuente(fuente, fila, reloj)
        if fila["ciclo"] == ciclo["id"]:
            _exigir(_instante(fila["inicio_utc"]) >= _instante(ciclo["inicio_utc"]))
            _exigir(ciclo["resultado"] == "en-curso" or fila["resultado"] != "en-curso")
        else:
            _exigir(fila["resultado"] != "en-curso")
            _exigir(_instante(fila["fin_utc"]) <= _instante(ciclo["inicio_utc"]))
    for identificador, valor in conjuntos.items():
        _validar_conjunto(identificador, valor, fuentes, reloj)
    if version == VERSION_REGISTRO:
        _validar_seguimiento(registro, reloj)
    return registro


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado: dict[str, Any] = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante(_valor: str) -> None:
    raise RegistroComprobacionesInvalido(ERROR)


def _ruta(raiz: Path, *, crear: bool = False) -> Path:
    ruta = raiz
    _exigir(stat.S_ISDIR(ruta.lstat().st_mode))
    for parte in Path(ARCHIVO).parts[:-1]:
        ruta /= parte
        try:
            _exigir(stat.S_ISDIR(ruta.lstat().st_mode))
        except FileNotFoundError:
            if crear:
                ruta.mkdir()
    return ruta / Path(ARCHIVO).name


def leer_registro(raiz: Path) -> dict[str, Any]:
    """Lee un archivo regular acotado; solo ausencia real admite el esquema vacío.

    Returns:
        Registro privado validado o esquema inicial sin crear archivos.

    Raises:
        RegistroComprobacionesInvalido: Si el archivo presente o su ruta no son verificables.
    """
    try:
        ruta = _ruta(raiz)
        try:
            descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return _vacio()
        with os.fdopen(descriptor, "rb") as archivo:
            informacion = os.fstat(archivo.fileno())
            _exigir(stat.S_ISREG(informacion.st_mode) and informacion.st_nlink == 1)
            _exigir(informacion.st_size <= MAX_REGISTRO_BYTES)
            contenido = archivo.read(MAX_REGISTRO_BYTES + 1)
        _exigir(len(contenido) <= MAX_REGISTRO_BYTES)
        documento = json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante)
        return validar_registro(documento)
    except (OSError, ValueError, TypeError, RecursionError) as error:
        raise RegistroComprobacionesInvalido(ERROR) from error


def _guardar(raiz: Path, registro: dict[str, Any]) -> None:
    validar_registro(registro)
    contenido = json.dumps(registro, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    _exigir(len(contenido) <= MAX_REGISTRO_BYTES)
    ruta = _ruta(raiz, crear=True)
    temporal: Path | None = None
    try:
        with temporal_hermano(ruta.parent, prefijo=".comprobaciones-", sufijo=".tmp") as archivo:
            temporal = Path(archivo.name)
            archivo.write(contenido)
            archivo.flush()
            os.fsync(archivo.fileno())
        temporal.replace(ruta)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def _avanzar(registro: dict[str, Any], ahora: datetime) -> str:
    if registro["version"] != VERSION_REGISTRO:
        raise RegistroComprobacionesInvalido("Registro v1: requiere migrar_registro explícitamente antes de escribir")
    instante = _utc(ahora)
    _exigir(registro["reloj_utc"] is None or ahora >= _instante(registro["reloj_utc"]))
    registro["reloj_utc"] = instante
    return instante


def _abierto(registro: dict[str, Any], identificador: str) -> dict[str, Any]:
    _id_ciclo(identificador)
    ciclo = registro["ultimo_ciclo"]
    _exigir(ciclo is not None and ciclo["id"] == identificador and ciclo["resultado"] == "en-curso")
    return ciclo


def _interrumpir(registro: dict[str, Any], instante: str) -> None:
    for fuente, fila in registro["fuentes"].items():
        if fila["resultado"] == "en-curso":
            fila.update(fin_utc=instante, resultado="interrumpido")
            _seguir_remoto(registro, fuente, fila)


def iniciar_ciclo(raiz: Path, ahora: datetime, modo: str) -> str:
    """Reserva el ciclo antes de efectos; el llamador ya posee el cerrojo existente.

    Returns:
        UUID de esta intención, separado del intento HTTP de cada evidencia.
    """
    _exigir(modo in ("manual", "programada", "vencidas"))
    registro = leer_registro(raiz)
    instante = _avanzar(registro, ahora)
    _interrumpir(registro, instante)
    identificador = str(uuid.uuid4())
    registro["ultimo_ciclo"] = {
        "id": identificador,
        "modo": modo,
        "inicio_utc": instante,
        "fin_utc": None,
        "resultado": "en-curso",
        "paquete_preparado": False,
    }
    registro["reconstruccion_pendiente"] = True
    _guardar(raiz, registro)
    return identificador


def iniciar_fuente(  # noqa: PLR0913 - Identidad y selección explícitas; remoto es una propiedad independiente.
    raiz: Path, ciclo: str, fuente: str, conjuntos: Sequence[str], ahora: datetime, *, remoto: bool = False
) -> None:
    """Marca antes de descargar o publicar; no concede permiso de frescura a la selección."""
    registro = leer_registro(raiz)
    _abierto(registro, ciclo)
    _exigir(type(remoto) is bool)
    _exigir(fuente in FUENTES and registro["fuentes"].get(fuente, {}).get("ciclo") != ciclo)
    identificadores = _ids(conjuntos, fuente)
    instante = _avanzar(registro, ahora)
    remoto_anterior = registro["fuentes"].get(fuente, {}).get("ultimo_intento_remoto_utc")
    registro["fuentes"][fuente] = {
        "ciclo": ciclo,
        "conjuntos": identificadores,
        "inicio_utc": instante,
        "fin_utc": None,
        "resultado": "en-curso",
        "evidencia": None,
        "comprobados": [],
        "remoto": remoto,
        "ultimo_intento_remoto_utc": instante if remoto else remoto_anterior,
    }
    registro["reconstruccion_pendiente"] = True
    _seguir_remoto(registro, fuente, registro["fuentes"][fuente])
    _guardar(raiz, registro)


def _resumir(evidencia: dict[str, Any], fuente: str, inicio: str, fin: datetime) -> dict[str, Any]:
    _exigir(type(evidencia) is dict)
    try:
        recibo = validar_recepcion(evidencia, fuente, evidencia.get("intento"))
    except FormatoInesperado as error:
        raise RegistroComprobacionesInvalido(ERROR) from error
    comienzo, terminado = (
        datetime.fromisoformat(recibo[clave].replace("Z", "+00:00")) for clave in ("comienzo_utc", "fin_utc")
    )
    _exigir(_instante(inicio) <= comienzo <= terminado <= fin)
    contenido = json.dumps(recibo, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    return {
        "intento": recibo["intento"],
        "sha256": hashlib.sha256(contenido).hexdigest(),
        "peticiones": len(recibo["peticiones"]),
        "bytes": sum(p["bytes"] for p in recibo["peticiones"]),
        "comienzo_utc": _utc(comienzo),
        "fin_utc": _utc(terminado),
    }


def terminar_fuente(  # noqa: PLR0913 - Contrato del motor con identidad, reloj y resultado separados de la evidencia.
    raiz: Path,
    ciclo: str,
    fuente: str,
    ahora: datetime,
    *,
    resultado: ResultadoFuente,
    evidencia: dict | None,
    comprobados: Sequence[str] = (),
) -> None:
    """Registra únicamente conjuntos explícitos tras la admisión completa del módulo por el llamador."""
    registro = leer_registro(raiz)
    _abierto(registro, ciclo)
    fila = registro["fuentes"].get(fuente)
    _exigir(fila is not None and fila["ciclo"] == ciclo and fila["resultado"] == "en-curso")
    _exigir(resultado in ("comprobada", "completa", "parcial", "fallo", "local"))
    instante = _avanzar(registro, ahora)
    resumen = None if evidencia is None else _resumir(evidencia, fuente, fila["inicio_utc"], ahora)
    fila.update(
        fin_utc=instante, resultado=resultado, evidencia=resumen, comprobados=_ids(comprobados, fuente, vacio=True)
    )
    _validar_fuente(fuente, fila, ahora)
    for identificador in fila["comprobados"]:
        registro["conjuntos"][identificador] = {
            "fuente": fuente,
            "ciclo": ciclo,
            "comprobado_utc": instante,
            "sha256_evidencia": resumen["sha256"],
        }
    _seguir_remoto(registro, fuente, fila)
    _guardar(raiz, registro)


def cerrar_ciclo(raiz: Path, ciclo: str, ahora: datetime, *, resultado: str, paquete_preparado: bool) -> None:
    """Cierra el candidato; paquete preparado puede retirar recomposición, nunca acredita versión activa."""
    _exigir(resultado in ("preparado", "sin-cambios", "fallo") and type(paquete_preparado) is bool)
    registro = leer_registro(raiz)
    fila = _abierto(registro, ciclo)
    instante = _avanzar(registro, ahora)
    if resultado == "fallo":
        _interrumpir(registro, instante)
    _exigir(not any(f["resultado"] == "en-curso" for f in registro["fuentes"].values()))
    fila.update(fin_utc=instante, resultado=resultado, paquete_preparado=paquete_preparado)
    if paquete_preparado:
        registro["reconstruccion_pendiente"] = False
    _guardar(raiz, registro)
