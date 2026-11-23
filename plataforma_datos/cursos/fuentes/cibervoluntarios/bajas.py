"""Bajas de Cibervoluntarios: qué materiales conocidos retira el proveedor, con su censo completo como evidencia.

La página pública de un curso responde igual exista o no, así que no prueba nada. Afirma la baja el censo (la API
pública), que declara `erased` en cada actividad y en cada material, y el destino registrado del material
(`https://e-learning.cibervoluntarios.org/course/view.php?id=N`, sin seguir redirecciones) lo corrobora o lo contradice:

- el censo completo (todas sus páginas con la forma esperada, al menos un material disponible y ningún estado que
  Faro no conozca) trae el material con `erased`
  verdadero en él o en su actividad: retirado, sin consultar su destino;
- el censo completo trae el material con un `status` distinto de «Disponible», en él o en su actividad (por ejemplo
  «Descatalogado» o «Pendiente»): deja de ofrecerse igual que uno borrado; el motivo (`borrado`, `descatalogado` u
  `otro-estado`) y el valor literal quedan en la evidencia, y vuelve cuando el censo lo trae otra vez «Disponible»;
- el censo completo no trae el material y su destino responde 404 con la página de error de la plataforma: retirado;
- el censo completo no trae el material y su destino responde 303 al inicio de sesión: el curso existe, sigue vigente
  y la contradicción llega al panel;
- cualquier otra respuesta del destino (corte, 5xx, otro destino, otro cuerpo): sin cambio, con su aviso.

Los estados conocidos son «Disponible», «Descatalogado» y «Pendiente», con esa grafía exacta: con cualquier otro
texto de estado (otra grafía, un valor nuevo) ese día no hay ninguna baja, ni por estado ni por ausencia, y el panel lo
avisa; las renovaciones y las altas de lo que viene «Disponible» siguen.

Un material ya retirado que sigue ausente no se vuelve a consultar: se consulta el día en que se observa la ausencia y,
mientras el registro lo tenga retirado, no se repite. Un censo parcial no produce ninguna baja. Un material retirado
que vuelve a un censo completo, disponible y sin borrar, se ofrece de nuevo.
"""

from http import HTTPStatus

from plataforma_datos.cursos.fuentes.cibervoluntarios import direcciones
from plataforma_datos.cursos.tipos_json import ObjetoJson

MENSAJE_DE_ERROR = "No se puede encontrar el registro de datos en la base de datos."
TITULO_DE_ERROR = "<title>Error | Cibervoluntarios</title>"
RETIRADO, VIGENTE, SIN_NOTICIA = "retirado", "vigente", "sin-noticia"
# Códigos cerrados que la validación entrega al panel (`salidaParcial`).
AVISO_CURSO_ACTIVO = "curso-fuera-del-catalogo-con-su-pagina"
AVISO_SIN_CONFIRMAR = "curso-fuera-del-catalogo-sin-confirmar"
AVISO_ESTADO_DESCONOCIDO = "estado-desconocido-en-el-catalogo"
MOTIVOS = frozenset({AVISO_CURSO_ACTIVO, AVISO_SIN_CONFIRMAR, AVISO_ESTADO_DESCONOCIDO})
FICHAS = "fichas"
# Ausentes que el registro ya tiene como retirados: no se vuelve a pedir su destino y siguen retirados.
YA_RETIRADOS = "ya_retirados"


def pagina_de_error(cuerpo: bytes) -> bool:
    """Reconoce la página de error de la plataforma de cursos para un curso que no existe.

    Returns:
        True si el cuerpo es una página «Error | Cibervoluntarios» con el mensaje de registro no encontrado.
    """
    try:
        texto = cuerpo.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return TITULO_DE_ERROR in texto and MENSAJE_DE_ERROR in texto


def veredicto(lectura: ObjetoJson) -> str:
    """Interpreta la lectura del destino registrado de un material ausente del censo.

    Returns:
        `retirado` (404 con la página de error), `vigente` (303 al inicio de sesión) o `sin-noticia`.
    """
    if "fallo" in lectura or lectura["completo"] is not True:
        return SIN_NOTICIA
    if lectura["http"] == HTTPStatus.NOT_FOUND and lectura["pagina_de_error"] is True:
        return RETIRADO
    if lectura["http"] == HTTPStatus.SEE_OTHER and lectura["redireccion"] == direcciones.INICIO_DE_SESION:
        return VIGENTE
    return SIN_NOTICIA


def censo_apto(conjunto: ObjetoJson) -> bool:
    """Indica si el censo del conjunto permite dar bajas.

    Debe ser completo, traer al menos un material disponible y ningún estado que Faro no conozca.

    Returns:
        False ante un censo parcial, sin materiales disponibles o con un estado desconocido.
    """
    censo = conjunto["censo"]
    return (
        conjunto.get("censo_completo") is True
        and bool(censo["materiales"])
        and censo.get("disponibles", 0) > 0
        and not censo.get("estado_desconocido")
    )


def decidir(conjunto: ObjetoJson) -> dict[str, str]:
    """Decide qué ha dicho el destino de cada material conocido ausente del censo.

    Returns:
        Veredicto por identidad de programa; vacío si el censo no permite bajas. Un ausente sin lectura de su
        destino (no tiene destino registrado o no se pudo pedir) queda sin noticia.
    """
    if not censo_apto(conjunto):
        return {}
    lecturas, retirados = conjunto.get(FICHAS, {}), conjunto.get(YA_RETIRADOS, [])
    return {
        id: RETIRADO if id in retirados else veredicto(lecturas[id]["lectura"]) if id in lecturas else SIN_NOTICIA
        for id in conjunto["censo"]["conocidos_ausentes"]
    }


def avisos(conjunto: ObjetoJson) -> list[ObjetoJson]:
    """Avisos del panel de una consulta: un estado desconocido, y los ausentes que su destino contradice o no confirma.

    Returns:
        Un aviso por motivo, con el código cerrado en `motivo`.
    """
    veredictos = set(decidir(conjunto).values())
    desconocido = [{"motivo": AVISO_ESTADO_DESCONOCIDO}] if conjunto["censo"].get("estado_desconocido") else []
    return desconocido + [
        {"motivo": motivo}
        for motivo, estado in ((AVISO_CURSO_ACTIVO, VIGENTE), (AVISO_SIN_CONFIRMAR, SIN_NOTICIA))
        if estado in veredictos
    ]
