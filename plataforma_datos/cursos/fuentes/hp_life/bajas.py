"""Bajas de HP LIFE: qué cursos conocidos retira el proveedor, con el índice completo como evidencia que lo afirma.

La ficha de HP LIFE no distingue un curso que ya no existe de un fallo del servidor: ambos responden 500. Por eso
quien afirma la baja es el censo completo del índice; la ficha solo lo corrobora o lo contradice:

- ausente del censo y ficha 404, 410 o 500 con la página de error de la aplicación, y en esta misma consulta más de la
  mitad de las fichas de los cursos que el índice lista respondieron bien (el servidor funciona): retirado;
- ausente del censo y ficha íntegra del curso: contradicción, sigue vigente;
- cualquier otra respuesta (corte, 502, 503, 504, otro cuerpo, 500 sin esa forma, ninguna ficha buena): sin noticia.

Un curso ausente cuya página no se pudo comprobar avisa en el panel. Un censo parcial no produce ninguna baja ni
contradicción. La declaración de gratuidad de la ayuda tiene su control en `gratuidad.py`; su aviso va con los demás.
"""

from http import HTTPStatus

from plataforma_datos.cursos.fuentes.hp_life import gratuidad
from plataforma_datos.cursos.tipos_json import ObjetoJson

RESPUESTAS_DE_RETIRADA = (HTTPStatus.NOT_FOUND, HTTPStatus.GONE)
# Una caída parcial de la aplicación puede dar la página de error a cursos que existen. Solo se da el servidor por sano
# si responde bien más de la mitad de las fichas de los cursos que el listado incluye (buenas * 2 > listadas). No
# limita cuántos cursos se retiran, solo cuándo se fía Faro del servidor.
SERVIDOR_SANO_SOBRE = 2
# Códigos cerrados que la consulta admitida entrega al panel (`salidaParcial`).
AVISO_INDICE_SIN_COMPLETAR = "indice-de-hp-life-sin-completar"
AVISO_FICHA_FUERA_DEL_LISTADO = "ficha-integra-fuera-del-listado"
AVISO_AUSENTE_SIN_CONFIRMAR = "ausente-del-listado-sin-confirmar"
MOTIVOS = frozenset(
    {AVISO_INDICE_SIN_COMPLETAR, AVISO_FICHA_FUERA_DEL_LISTADO, AVISO_AUSENTE_SIN_CONFIRMAR, gratuidad.AVISO}
)


def _integra(lectura: ObjetoJson, id: str) -> bool:
    return lectura["ids"] == [id]


def _corrobora(lectura: ObjetoJson) -> bool:
    if lectura.get("pagina_de_error") is True:
        return True
    return lectura["completo"] is True and lectura["http"] in RESPUESTAS_DE_RETIRADA and "fallo" not in lectura


def decidir(censo: ObjetoJson, filas: list[ObjetoJson]) -> ObjetoJson:
    """Aplica la regla a las lecturas de fichas de una consulta.

    Returns:
        `retiradas` (id y respuesta que lo corrobora), `contradicciones` y `sin_noticia`; vacíos si el censo no es
        completo.
    """
    resultado: ObjetoJson = {"retiradas": {}, "contradicciones": [], "sin_noticia": []}
    if not censo["completo"]:
        return resultado
    listados = set(censo["cursos"])
    de_listados = [f for f in filas if f["id"] in listados]
    buenas = sum(_integra(f["lectura"], f["id"]) for f in de_listados)
    servidor_responde = SERVIDOR_SANO_SOBRE * buenas > len(de_listados)
    for fila in sorted((f for f in filas if f["id"] not in listados), key=lambda f: f["id"]):
        lectura = fila["lectura"]
        if _integra(lectura, fila["id"]):
            resultado["contradicciones"].append(fila["id"])
        elif servidor_responde and _corrobora(lectura):
            resultado["retiradas"][fila["id"]] = {
                "http": lectura["http"],
                "pagina_de_error": lectura.get("pagina_de_error") is True,
            }
        else:
            resultado["sin_noticia"].append(fila["id"])
    return resultado


def avisos(conjunto: ObjetoJson) -> list[ObjetoJson]:
    """Avisos del panel de una consulta: el listado sin completar, los cursos que su ficha contradice y la gratuidad.

    Returns:
        Un aviso por motivo, con el código cerrado en `motivo`.
    """
    resultado = [{"motivo": gratuidad.AVISO}] if (conjunto.get("gratuidad") or {}).get("intacta") is False else []
    censo = conjunto.get("indice")
    if censo is None:
        return resultado
    if not censo["completo"]:
        resultado.append({"motivo": AVISO_INDICE_SIN_COMPLETAR})
    if conjunto["bajas"]["contradicciones"]:
        resultado.append({"motivo": AVISO_FICHA_FUERA_DEL_LISTADO})
    if conjunto["bajas"]["sin_noticia"]:
        resultado.append({"motivo": AVISO_AUSENTE_SIN_CONFIRMAR})
    return resultado
