"""FUNDAE: la descarga diaria de las fichas de las ediciones, con su presupuesto, su rotación y su refresco.

Cada día se pide la ficha de difusiones de cada especialidad acotada (`ediciones.especialidades`), empezando por una
posición que rota con el día para que un corte por tope no deje siempre fuera las mismas. La ficha de la entidad y la
de colectivos solo se piden para las ediciones abiertas que son nuevas o cuya fila de difusiones cambió de huella; las
demás reutilizan las conservadas, con su propia fecha. Para que ningún hecho publicado se quede viejo para siempre,
cada día se refrescan además, dentro del presupuesto, las fichas reutilizadas más antiguas (`REFRESCO_DIARIO`).

El presupuesto propio (consultas y tiempo) queda por debajo de los 45 minutos de la orden diaria, y el plazo de red de
cada consulta no pasa de lo que queda. Si se agota antes de terminar las especialidades, la descarga se corta y el
documento lo dice (`corte`); lo no consultado queda como consulta parcial, nunca como ausencia. Un índice caído no
consulta ninguna ficha. El documento se guarda aunque una consulta se corte, para no perder los intentos conservados.
"""

import hashlib
import json
import time
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.fuentes.fundae import (
    adquisicion,
    ediciones,
    hechos,
    lectura,
    lectura_preinscripcion,
    tramite,
)

CONSULTAS_TRAMITE = 3
MAX_CONSULTAS = 600
PLAZO_S = 30 * 60
# Fichas reutilizadas que se vuelven a pedir cada día, de la más antigua a la más reciente.
REFRESCO_DIARIO = 60
# Por qué se corta una descarga; los dos llegan al panel en `salidaParcial`.
TOPE, PLAZO = "tope-de-consultas", "plazo-de-la-descarga"
MOTIVOS = frozenset({TOPE, PLAZO})
Recibir = Callable[[str, Path, int], dict[str, Any]]


def _recibir(url: str, carpeta: Path, segundos: int) -> dict[str, Any]:
    pagina = url.startswith(tramite.ORIGEN + "ficha-curso/")
    return comun.recibir_url(
        url,
        carpeta,
        None,
        perfil="pagina" if pagina else "datos",
        segundos=segundos,
        seguir_redirecciones=not url.startswith(tramite.ORIGEN),
    )


class Agotado(Exception):
    """Se alcanzó el tope de consultas o el plazo propio de la descarga de fichas."""


class Presupuesto:
    """Cuenta las consultas y el tiempo de una descarga de fichas, por debajo del límite de la orden diaria."""

    def __init__(
        self,
        recibir: Recibir,
        *,
        consultas: int = MAX_CONSULTAS,
        plazo_s: float = PLAZO_S,
        reloj: Callable[[], float] = time.monotonic,
    ) -> None:
        self.recibir, self.restantes, self.reloj = recibir, consultas, reloj
        self.limite = reloj() + plazo_s

    def __call__(self, url: str, carpeta: Path) -> dict[str, Any]:
        """Hace una consulta si queda presupuesto, con un plazo de red que no pasa del tiempo que queda.

        Returns:
            La captura conservada.

        Raises:
            Agotado: Si ya no quedan consultas o se pasó el plazo.
        """
        queda = self.limite - self.reloj()
        if self.restantes <= 0:
            raise Agotado(TOPE)
        if queda < 1:
            raise Agotado(PLAZO)
        self.restantes -= 1
        try:
            return self.recibir(url, carpeta, int(min(red.SEGUNDOS_DESCARGA, queda)))
        except red.PlazoSinEnvio as error:
            raise Agotado(PLAZO) from error


def huella_fila(fila: dict[str, Any]) -> str:
    """La huella de la fila de una difusión: si no cambia, sus fichas de entidad y colectivos se reutilizan.

    Returns:
        SHA-256 de la fila canónica.
    """
    return hashlib.sha256(json.dumps(fila, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _respondida(carpeta: Path, captura: dict[str, Any] | None, url: str) -> bool:
    return captura is not None and ediciones.respuesta(carpeta, captura, url)[0] is not None


def _abierta_con_entidad(fila: dict[str, Any], dia: str) -> bool:
    """Si una difusión está abierta y trae su entidad; una fila con otra forma se deja para que la lectura la diga.

    Returns:
        True si su plazo está abierto el día `dia` y trae el CIF de su entidad.
    """
    try:
        return hechos.abierta(fila, dia) and isinstance(fila.get("cifEntidadFormadora"), str)
    except FormatoInesperado:
        return False


def _consultar_especialidad(
    carpeta: Path, codigo: str, consultar: Presupuesto, previa: dict[str, Any] | None, reutilizadas: list[tuple]
) -> dict[str, Any]:
    url = ediciones.url_difusiones(codigo)
    entrada: dict[str, Any] = {"codigo": codigo, "difusiones": consultar(url, carpeta)}
    entrada.update(centros={}, colectivos={}, filas={})
    dato, meta = ediciones.respuesta(carpeta, entrada["difusiones"], url)
    try:
        filas = hechos.difusiones(dato) if dato is not None else []
    except FormatoInesperado:
        return entrada
    previa = previa or {"centros": {}, "colectivos": {}, "filas": {}}
    for fila in filas:
        if not _abierta_con_entidad(fila, hechos.dia_civil(meta["fin_utc"])):
            continue
        cif, id = fila["cifEntidadFormadora"], str(fila["idDifusionAccionFormativa"])
        entrada["filas"][id] = huella_fila(fila)
        igual = previa["filas"].get(id) == entrada["filas"][id]
        for tipo, clave, url_ficha in (
            ("centros", cif, ediciones.url_centro(codigo, cif)),
            ("colectivos", id, ediciones.url_colectivos(int(id))),
        ):
            if clave in entrada[tipo]:
                continue
            anterior = previa[tipo].get(clave)
            if igual and _respondida(carpeta, anterior, url_ficha):
                entrada[tipo][clave] = anterior
                reutilizadas.append((comun.leer_recibo(carpeta, anterior)["fin_utc"], codigo, tipo, clave, url_ficha))
            else:
                entrada[tipo][clave] = consultar(url_ficha, carpeta)
    return entrada


def _refrescar(carpeta: Path, documento: dict[str, Any], reutilizadas: list[tuple], consultar: Presupuesto) -> int:
    """Vuelve a pedir las fichas reutilizadas más antiguas, hasta `REFRESCO_DIARIO` o lo que quede de presupuesto.

    Returns:
        Cuántas se refrescaron.
    """
    por_codigo = {e["codigo"]: e for e in documento["especialidades"]}
    refrescadas = 0
    for _, codigo, tipo, clave, url in sorted(reutilizadas)[:REFRESCO_DIARIO]:
        try:
            por_codigo[codigo][tipo][clave] = consultar(url, carpeta)
        except Agotado:
            break
        refrescadas += 1
    return refrescadas


def descargar(fundae: Path, recibir: Recibir = _recibir, presupuesto: Presupuesto | None = None) -> lectura.Resultado:
    """Consulta, en serie, las fichas de las especialidades que publica el último índice recibido por catalogos/.

    Al final emite la lectura de las ediciones; si no se puede emitir, el resultado lo dice y nada más cambia.

    Returns:
        La lectura emitida y los problemas que impidieron emitirla, si los hubo.
    """
    canal = fundae / comun.CANALES["fundae"]
    indice = leer_json(canal / "procedencia.json")["auxiliares"]["subvencionada"]
    dato, meta = adquisicion.pagina(canal, indice, "subvencionada")
    carpeta = fundae / ediciones.CARPETA
    carpeta.mkdir(parents=True, exist_ok=True)
    anterior = leer_json(carpeta / "procedencia.json") if (carpeta / "procedencia.json").is_file() else {}
    previas = {e["codigo"]: e for e in anterior.get("especialidades", []) if "filas" in e}
    consultar = presupuesto or Presupuesto(recibir)
    codigos = ediciones.especialidades(dato) if dato is not None else []
    inicio = ediciones.inicio_rotado(codigos, hechos.dia_civil(meta["fin_utc"]))
    documento = {"schema_version": 1, "fuente_id": "fundae", "indice": indice, "inicio": inicio, "especialidades": []}
    reutilizadas: list[tuple] = []
    # Comprueba el recorrido público antes de que las fichas o el refresco agoten la vuelta.
    if codigos and consultar.restantes >= CONSULTAS_TRAMITE:
        with suppress(Agotado):
            tramite.descargar(fundae / "tramite", codigos[0], recibir=consultar)
    # El refresco tiene su parte del presupuesto: un corte por tope no lo deja sin avanzar.
    reserva = min(REFRESCO_DIARIO, consultar.restantes // 2)
    consultar.restantes -= reserva
    try:
        try:
            for codigo in ediciones.en_orden_del_dia(codigos, inicio):
                entrada = _consultar_especialidad(carpeta, codigo, consultar, previas.get(codigo), reutilizadas)
                documento["especialidades"].append(entrada)
        except Agotado as agotado:
            documento["corte"] = {"motivo": str(agotado), "consultadas": len(documento["especialidades"])}
        consultar.restantes += reserva
        documento["refrescadas"] = _refrescar(carpeta, documento, reutilizadas, consultar)
    finally:
        guardar_json(carpeta / "procedencia.json", documento)
    return lectura_preinscripcion.emitir(fundae, documento)
