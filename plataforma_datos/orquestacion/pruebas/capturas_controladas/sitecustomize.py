"""Respuestas externas controladas para los procesos del ensayo del circuito de actualización.

Lo carga Python al arrancar cualquier intérprete con esta carpeta al principio de `PYTHONPATH` y
`FARO_CAPTURAS_CONTROLADAS` apuntando a un plan de respuestas. Sustituye solo la apertura HTTP del transporte común
(`red.abrir_peticion`): identidad, turnos, límites, lectura, observación de la consulta y conservación siguen siendo
los del producto. Además pone la guardia de red de la batería, así que nada sale de este equipo aunque falte una
respuesta.

El plan es un JSON: `{"registro": ruta, "respuestas": {url: respuesta}, "cortar_en": url | null}`. Cada respuesta es
`{"estado": código HTTP, "cuerpo": ruta | null, "tipo": Content-Type}`, con `"cortada": true` si la conexión se corta
antes de completar el cuerpo que anuncia, o `{"fallo": "tiempo"}` (sin respuesta). Una
URL sin respuesta en el plan recibe un 404: el ensayo debe declarar todo lo que consulta. `cortar_en` mata con
SIGKILL el proceso de la actualización y el propio lector al pedir esa URL, como un corte real de la máquina.
"""

import http.client
import io
import json
import os
import signal
import sys
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request

VARIABLE = "FARO_CAPTURAS_CONTROLADAS"
CODIGO = Path(__file__).resolve().parents[4]


class _Conexion:
    """Lo mínimo de un socket que `http.client.HTTPResponse` necesita para leer una respuesta ya escrita."""

    def __init__(self, bytes_http: bytes) -> None:
        self._archivo = io.BytesIO(bytes_http)

    def makefile(self, *_argumentos: object, **_opciones: object) -> io.BytesIO:
        return self._archivo


def _respuesta(url: str, estado: int, cuerpo: bytes, tipo: str, *, cortada: bool) -> http.client.HTTPResponse:
    # Una respuesta cortada anuncia más bytes de los que llegan, como una conexión que se cae a mitad.
    longitud = len(cuerpo) + (1024 if cortada else 0)
    cabecera = f"HTTP/1.1 {estado} Respuesta capturada\r\nContent-Type: {tipo}\r\nContent-Length: {longitud}\r\n\r\n"
    respuesta = http.client.HTTPResponse(_Conexion(cabecera.encode("latin-1") + cuerpo), method="GET", url=url)
    respuesta.begin()
    respuesta.url = url  # urllib la fija igual tras abrir la petición
    return respuesta


def _abrir_capturada(plan: dict):  # noqa: ANN202 - mismo contrato que red.abrir_peticion
    def abrir(peticion: Request, timeout: float) -> http.client.HTTPResponse:
        del timeout
        url = peticion.full_url
        with Path(plan["registro"]).open("a", encoding="utf-8") as registro:
            registro.write(json.dumps({"url": url, "pid": os.getpid()}) + "\n")
        if plan.get("cortar_en") == url:
            # Corte real: ni la actualización ni el lector ejecutan manejadores, `finally` ni cierres.
            os.kill(os.getppid(), signal.SIGKILL)
            os.kill(os.getpid(), signal.SIGKILL)
        dato = plan["respuestas"].get(url, {"estado": 404, "cuerpo": None, "tipo": "text/html"})
        if dato.get("fallo") == "tiempo":
            raise TimeoutError("sin respuesta en la captura controlada")
        cuerpo = Path(dato["cuerpo"]).read_bytes() if dato["cuerpo"] else b""
        respuesta = _respuesta(url, dato["estado"], cuerpo, dato["tipo"], cortada=dato.get("cortada", False))
        if dato["estado"] >= 400:  # noqa: PLR2004 - urllib convierte en HTTPError todo estado de error
            raise HTTPError(url, dato["estado"], "Respuesta capturada", respuesta.headers or Message(), respuesta)
        return respuesta

    return abrir


def _instalar() -> None:
    sys.path.insert(0, str(CODIGO / "scripts" / "sin_red"))
    import guardia_red

    guardia_red.aplicar()
    ruta = os.environ.get(VARIABLE)
    if not ruta:
        return
    plan = json.loads(Path(ruta).read_text(encoding="utf-8"))
    # El código que se importa es el del directorio de trabajo (la raíz o el área del ensayo), como en `python -m`.
    sys.path.insert(0, str(Path.cwd()))
    from plataforma_datos.comun import red

    red.abrir_peticion = _abrir_capturada(plan)
    # Las pausas por dominio protegen servidores reales; aquí solo alargarían el ensayo.
    red.PAUSAS = red.PausasPorDominio(dormir=lambda _segundos: None)


_instalar()
