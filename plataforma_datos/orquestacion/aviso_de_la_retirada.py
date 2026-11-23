"""Los avisos del panel sobre la regla de retirada de una fuente: cuando cambia de modo y cuando retira mucho de golpe.

El cambio de modo (se activó o volvió a modo de prueba) sale del último cambio que guarda el estado de la fuente
(estado_de_la_retirada). La retirada amplia sale de las decisiones del último ciclo de una fuente activa: si retira
más de PERDIDA_MAXIMA de los cursos que leyó, el panel lo dice con su cifra para que una persona lo vea, como en la
primera activación de una fuente. Los dos viajan en el seguimiento de la fuente del estado del panel solo cuando
tienen valor. Son avisos: el umbral no decide nada y lo que se publica no cambia, porque cada retirada ya tiene su
evidencia comprobada (decisiones_retirada no admite una retirada sin evidencias suficientes).
"""

from datetime import datetime, timedelta
from pathlib import Path

from plataforma_datos.cursos.activacion_de_la_retirada import ACTIVA
from plataforma_datos.cursos.decisiones_retirada import cargar_registro
from plataforma_datos.cursos.estado_de_la_retirada import ultimo_registro
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import PERDIDA_MAXIMA

# Una semana: el aviso pide atención a quien entra en el panel al menos una vez por semana y después se retira solo.
# Es solo el plazo del aviso: el modo de la regla no depende de ningún número de días.
DIAS_DEL_AVISO = 7


def aviso_de_la_retirada(raiz: Path, fuente: str, ahora: datetime) -> dict[str, object] | None:
    """El último cambio de modo de la regla de la fuente, si es de la última semana.

    Returns:
        `cambio` (`activada` o `vuelta-a-sombra`), `decisiones` (las comprobadas que la sostienen) y `en` (cuándo),
        o `None` si la regla de la fuente no ha cambiado de modo en la última semana.
    """
    registro = ultimo_registro(raiz, fuente)
    cambio = None if registro is None else registro["ultimo_cambio"]
    if cambio is None:
        return None
    en = datetime.fromisoformat(cambio["observado_utc"])
    if ahora - en > timedelta(days=DIAS_DEL_AVISO):
        return None
    return {"cambio": cambio["cambio"], "decisiones": cambio["decisiones"], "en": cambio["observado_utc"]}


def retirada_amplia(raiz: Path, fuente: str) -> dict[str, object] | None:
    """Cuánto retira la regla activa de la fuente en su último ciclo, si supera PERDIDA_MAXIMA de lo que leyó.

    Los cursos leídos son todos los que la regla decidió en las lecturas del ciclo: los que retira, los pendientes y
    los que mantiene. Dura lo que dura el ciclo: el siguiente lo renueva o lo quita.

    Returns:
        `retiradas`, `cursos` y `en` (la hora del ciclo), o `None` si la fuente está en sombra o retira menos.
    """
    registro = ultimo_registro(raiz, fuente)
    if registro is None or registro["estado"] != ACTIVA:
        return None
    decisiones = [cargar_registro(raiz, fuente, lectura_id) for lectura_id in registro["lecturas"]]
    retiradas = sum(d["decision"] == "retirar" for lectura in decisiones for d in lectura["decisiones"])
    cursos = sum(len(lectura["decisiones"]) + lectura["mantenidas"] for lectura in decisiones)
    if retiradas <= PERDIDA_MAXIMA * cursos:
        return None
    return {"retiradas": retiradas, "cursos": cursos, "en": registro["observado_utc"]}
