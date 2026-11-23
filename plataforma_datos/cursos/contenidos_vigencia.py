"""Contenido lógico compartido y eventos separados dentro de la misma SQLite.

Los nodos inmutables conservan texto, soportes y estructuras por SHA. Fechas e
identidades de consulta permanecen en cada evento; reconstruir no reevalúa ni
interpreta fuentes. El formato físico no modifica el contrato lógico de vigencia.
"""

import hashlib
import json
import re
import sqlite3
from copy import deepcopy

from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

TAMANO_NODO = 2
VERSION = 1
MAX_PROFUNDIDAD = 128
MAX_PARAMETROS = 10000
MAX_BYTES_LOGICOS = 16 * 1024 * 1024
MAX_VALORES_LOGICOS = 1_000_000
FECHA = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)")
ESQUEMA = """
CREATE TABLE contenidos_vigencia (
 id INTEGER PRIMARY KEY,
 sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256)=64),
 contenido TEXT NOT NULL CHECK(json_valid(contenido)));
"""


class ErrorContenido(ValueError):
    """Una referencia física no conserva el contenido lógico protegido."""


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorContenido(motivo)


def _json(valor: ValorJson) -> str:
    return json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _guardar(conexion: sqlite3.Connection, nodo: list) -> int:
    cuerpo = _json(nodo)
    sha = hashlib.sha256(cuerpo.encode()).hexdigest()
    fila = conexion.execute("SELECT id,contenido FROM contenidos_vigencia WHERE sha256=?", (sha,)).fetchone()
    if fila is not None:
        _exigir(fila[1] == cuerpo, "Colisión de contenido inmutable")
        return fila[0]
    return conexion.execute("INSERT INTO contenidos_vigencia(sha256,contenido) VALUES(?,?)", (sha, cuerpo)).lastrowid


def verificar_esquema(conexion: sqlite3.Connection) -> None:
    """Exige la tabla e índice únicos conocidos antes de usar las referencias.

    Raises:
        ErrorContenido: Si el esquema contiene una sustitución o trigger no declarado.
    """
    fila = conexion.execute("SELECT type,sql FROM sqlite_master WHERE name='contenidos_vigencia'").fetchone()
    esperado = " ".join(ESQUEMA.strip().rstrip(";").split())
    _exigir(
        fila is not None and fila[0] == "table" and " ".join(fila[1].split()) == esperado,
        "Esquema de contenido compartido incompatible",
    )
    _exigir(
        conexion.execute(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name='contenidos_vigencia'"
        ).fetchone()
        is None,
        "Trigger de contenido no declarado",
    )


def codificar(
    conexion: sqlite3.Connection,
    valor: ValorJson,
    *,
    identidades: set[str],
    variables: frozenset[tuple[str | int, ...]] = frozenset(),
) -> ObjetoJson:
    """Conserva cada contenido estable una vez y devuelve referencias y datos del evento.

    Las fechas se guardan literalmente: reconocer su forma solo separa almacenamiento,
    no valida su significado ni cambia zona, precisión o fecha comercial.

    Returns:
        Envoltorio físico exacto; llamador conserva y sella su registro lógico.
    """
    parametros, vistos = [], {}

    def parametro(dato: ValorJson) -> list:
        clave = _json(dato)
        if clave not in vistos:
            _exigir(len(parametros) < MAX_PARAMETROS, "Evento de contenido excesivo")
            vistos[clave] = len(parametros)
            parametros.append(dato)
        return ["p", vistos[clave]]

    def es_variable(dato: ValorJson, ruta: tuple) -> bool:
        return ruta in variables or isinstance(dato, str) and (dato in identidades or FECHA.fullmatch(dato))

    def nodo(dato: ValorJson, ruta: tuple, profundidad: int) -> list:
        _exigir(profundidad <= MAX_PROFUNDIDAD, "Contenido demasiado profundo")
        if es_variable(dato, ruta):
            return parametro(dato)
        if isinstance(dato, dict):
            pares = []
            for clave in sorted(dato):
                llave = parametro(clave) if es_variable(clave, ()) else ["k", clave]
                pares.append([llave, nodo(dato[clave], (*ruta, clave), profundidad + 1)])
            contenido = ["o", pares]
        elif isinstance(dato, list):
            contenido = ["a", [nodo(v, (*ruta, i), profundidad + 1) for i, v in enumerate(dato)]]
        else:
            contenido = ["v", dato]
        return ["r", _guardar(conexion, contenido)]

    raiz = nodo(valor, (), 0)
    _Decodificador(conexion, parametros, None).presupuesto(raiz, None, 0)
    return {"formato_contenido": VERSION, "raiz": raiz, "variables": parametros}


class _Decodificador:
    """Una reconstrucción: caché de nodos, presupuesto y parámetros propios."""

    def __init__(self, conexion: sqlite3.Connection, parametros: list, cache: dict | None) -> None:
        self.conexion = conexion
        self.parametros = parametros
        self.cache = {} if cache is None else cache
        self.usados = set()
        self.costes = {}

    def cargar(self, ref: ValorJson, limite: int | None) -> tuple[str, int, ValorJson]:
        _exigir(isinstance(ref, list) and len(ref) == TAMANO_NODO, "Referencia de contenido inválida")
        tipo, id = ref
        _exigir(type(id) is int and id >= 0, "Referencia no entera")
        if tipo == "p":
            _exigir(id < len(self.parametros), "Variable de contenido ausente")
            self.usados.add(id)
            return tipo, id, self.parametros[id]
        _exigir(tipo == "r" and id > 0 and (limite is None or id < limite), "Referencia cíclica o incompatible")
        clave = (self.conexion, id)
        if clave not in self.cache:
            fila = self.conexion.execute(
                "SELECT sha256,contenido FROM contenidos_vigencia WHERE id=?", (id,)
            ).fetchone()
            _exigir(fila is not None, "Contenido inmutable ausente")
            _exigir(isinstance(fila[1], str), "Nodo de contenido no textual")
            _exigir(len(fila[1].encode()) <= MAX_BYTES_LOGICOS, "Nodo de contenido excesivo")
            _exigir(hashlib.sha256(fila[1].encode()).hexdigest() == fila[0], "Contenido inmutable alterado")
            self.cache[clave] = json.loads(fila[1])
        nodo = self.cache[clave]
        _exigir(isinstance(nodo, list) and len(nodo) == TAMANO_NODO, "Nodo de contenido incompatible")
        _exigir(nodo[0] in ("v", "a", "o"), "Clase de nodo almacenado incompatible")
        return nodo[0], id, nodo[1]

    def clave(self, llave: ValorJson, limite: int) -> str:
        _exigir(
            isinstance(llave, list) and len(llave) == TAMANO_NODO and llave[0] in ("k", "p"),
            "Clave de contenido inválida",
        )
        valor = llave[1] if llave[0] == "k" else self.cargar(llave, limite)[2]
        _exigir(isinstance(valor, str), "Clave no textual")
        return valor

    @staticmethod
    def bytes_escalar(dato: ValorJson) -> int:
        _exigir(not isinstance(dato, (list, dict)), "Valor de contenido no escalar")
        try:
            return len(_json(dato).encode())
        except (ValueError, TypeError, UnicodeError) as error:
            raise ErrorContenido("Valor no JSON en contenido") from error

    @staticmethod
    def comprobar_cotas(tamano: int, valores: int) -> None:
        _exigir(tamano <= MAX_BYTES_LOGICOS and valores <= MAX_VALORES_LOGICOS, "Contenido expandido excesivo")

    def presupuesto_lista(self, dato: list, id: int, profundidad: int) -> tuple[int, int, int]:
        _exigir(len(dato) <= MAX_VALORES_LOGICOS, "Contenido expandido excesivo")
        tamano, valores, altura = 2 + max(0, len(dato) - 1), 1, 0
        for hijo in dato:
            b, n, h = self.presupuesto(hijo, id, profundidad + 1)
            tamano, valores, altura = tamano + b, valores + n, max(altura, h + 1)
            self.comprobar_cotas(tamano, valores)
        return tamano, valores, altura

    def presupuesto_objeto(self, dato: list, id: int, profundidad: int) -> tuple[int, int, int]:
        _exigir(len(dato) <= MAX_VALORES_LOGICOS, "Contenido expandido excesivo")
        tamano, valores, altura = 2 + max(0, len(dato) - 1), 1, 0
        claves = set()
        for par in dato:
            _exigir(isinstance(par, list) and len(par) == TAMANO_NODO, "Campo de contenido inválido")
            llave = self.clave(par[0], id)
            _exigir(llave not in claves, "Clave repetida")
            claves.add(llave)
            b, n, h = self.presupuesto(par[1], id, profundidad + 1)
            tamano, valores, altura = tamano + self.bytes_escalar(llave) + 1 + b, valores + n, max(altura, h + 1)
            self.comprobar_cotas(tamano, valores)
        return tamano, valores, altura

    def presupuesto(self, ref: ValorJson, limite: int | None, profundidad: int) -> tuple[int, int, int]:
        _exigir(profundidad <= MAX_PROFUNDIDAD, "Contenido demasiado profundo")
        clase, id, dato = self.cargar(ref, limite)
        if clase != "p" and id in self.costes:
            tamano, valores, altura = self.costes[id]
            _exigir(profundidad + altura <= MAX_PROFUNDIDAD, "Contenido demasiado profundo")
            return tamano, valores, altura
        if clase in ("v", "p"):
            coste = (self.bytes_escalar(dato), 1, 0)
        elif clase == "a":
            _exigir(isinstance(dato, list), "Lista de contenido inválida")
            coste = self.presupuesto_lista(dato, id, profundidad)
        else:
            _exigir(clase == "o" and isinstance(dato, list), "Objeto de contenido inválido")
            coste = self.presupuesto_objeto(dato, id, profundidad)
        self.comprobar_cotas(coste[0], coste[1])
        if clase != "p":
            self.costes[id] = coste
        return coste

    def expandir(self, ref: ValorJson, limite: int | None) -> ValorJson:
        clase, id, dato = self.cargar(ref, limite)
        if clase == "p":
            return deepcopy(dato)
        if clase == "v":
            return dato
        if clase == "a":
            return [self.expandir(r, id) for r in dato]
        return {self.clave(llave, id): self.expandir(valor, id) for llave, valor in dato}


def decodificar(conexion: sqlite3.Connection, contenido: ObjetoJson, *, cache: dict | None = None) -> ValorJson:
    """Reconstruye solo tras comprobar presupuesto lógico memoizado y sellos.

    Primero mide bytes JSON canónicos, número de valores y altura, sin expandir
    el DAG. Un árbol lógico exponencial no obtiene memoria por tener pocos nodos.

    Returns:
        JSON independiente, con sus valores originales exactos dentro de las cotas.
    """
    _exigir(set(contenido) == {"formato_contenido", "raiz", "variables"}, "Envoltorio de contenido incompatible")
    _exigir(
        type(contenido["formato_contenido"]) is int and contenido["formato_contenido"] == VERSION,
        "Formato de contenido desconocido",
    )
    parametros = contenido["variables"]
    _exigir(isinstance(parametros, list) and len(parametros) <= MAX_PARAMETROS, "Variables de contenido inválidas")
    _exigir(all(not isinstance(v, (list, dict)) for v in parametros), "Variable no escalar")
    lector = _Decodificador(conexion, parametros, cache)
    lector.presupuesto(contenido["raiz"], None, 0)
    _exigir(lector.usados == set(range(len(parametros))), "Variables ajenas al contenido")
    return lector.expandir(contenido["raiz"], None)
