"""Entradas de la SQLite que tres censos necesitan para reproducir una admisión después de componer."""

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.cursos.tipos_json import ObjetoJson

FUENTES = frozenset({"fundae", "barcelonactiva", "cibervoluntarios"})
CAMPO = "identidades_del_calculo"
HUELLA = "identidades_sha256"
type Programas = list[ObjetoJson] | ObjetoJson


def _exigir(condicion: bool) -> None:
    exigir(condicion, "Identidades de la admisión ajenas o mal formadas", FormatoInesperado)


def _programa(fuente: str, fila: ObjetoJson) -> ObjetoJson:
    _exigir(isinstance(fila, dict) and isinstance(fila.get("id"), str) and bool(fila["id"]))
    programa = {"id": fila["id"]}
    if fuente == "barcelonactiva":
        return programa
    datos = fila.get("datos", {})
    _exigir(isinstance(datos, dict))
    if fuente == "cibervoluntarios":
        from plataforma_datos.cursos.fuentes.cibervoluntarios.destinos import destino_registrado

        programa["datos"] = {"material_publicado": {"moodleLink": destino_registrado(fila)}}
        return programa
    proveedor = fila.get("proveedor_id")
    _exigir(proveedor in ("fundae:publicador:catalogo:1", "fundae:publicador:catalogo:3"))
    entidad = datos.get("entidad_publicada")
    empresa = entidad.get("id") if isinstance(entidad, dict) else None
    recurso, especialidad = datos.get("id_recurso_fuente"), datos.get("codigo_especialidad")
    _exigir(empresa is None or type(empresa) is int)
    _exigir(recurso is None or type(recurso) is int)
    _exigir(especialidad is None or isinstance(especialidad, str))
    programa.update(
        proveedor_id=proveedor,
        datos={"id_recurso_fuente": recurso, "codigo_especialidad": especialidad, "entidad_publicada": {"id": empresa}},
    )
    return programa


def proyectar(fuente: str, identidades: Programas) -> Programas:
    """Conserva en su orden solo los campos que el lector usa para contrastar los cuerpos originales.

    Returns:
        La entrada del cálculo privado del censo. Se admite una base sembrada sin programas previos.
    """
    _exigir(fuente in FUENTES)
    if fuente == "fundae":
        _exigir(
            isinstance(identidades, dict)
            and type(identidades.get("schema_version")) is int
            and identidades["schema_version"] == 1
            and identidades.get("fuente_id") == fuente
        )
        filas = identidades.get("programas")
    else:
        filas = identidades
    _exigir(isinstance(filas, list))
    programas = [_programa(fuente, fila) for fila in filas]
    _exigir(len({programa["id"] for programa in programas}) == len(programas))
    if fuente == "fundae":
        return {"schema_version": 1, "fuente_id": fuente, "programas": programas}
    return programas


def sellar(fuente: str, identidades: Programas) -> ObjetoJson:
    """Vincula el contexto privado al mismo informe que admite el conjunto y sus controles.

    Returns:
        Contexto y huella que el escritor instala juntos en un único archivo de validación.
    """
    contexto = {"version": 1, "fuente": fuente, "programas": proyectar(fuente, identidades)}
    return {CAMPO: contexto, HUELLA: sha256_json(contexto)}


def leer(fuente: str, informe: ObjetoJson) -> Programas | None:
    """Comprueba procedencia, forma y huella del contexto guardado en el informe.

    Returns:
        Las identidades de esa admisión, o None para un informe del formato histórico.
    """
    if CAMPO not in informe and HUELLA not in informe:
        return None
    contexto = informe.get(CAMPO)
    _exigir(
        isinstance(contexto, dict)
        and set(contexto) == {"version", "fuente", "programas"}
        and type(contexto["version"]) is int
        and contexto["version"] == 1
        and contexto["fuente"] == fuente
    )
    _exigir(sha256_json(contexto) == informe.get(HUELLA))
    programas = proyectar(fuente, contexto["programas"])
    _exigir(programas == contexto["programas"])
    return programas
