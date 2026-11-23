"""Contacto de una entidad de formación: lo que llega a Faro para que la persona se inscriba, sin datos de personas.

Los conjuntos del Consorci publican, por cada curso, el NIF, el nombre, la web, el correo y el teléfono de la entidad
que lo imparte, con la que se hace la inscripción. Faro guarda la web, los buzones de la entidad y los teléfonos fijos.
No guarda los correos que pueden ser de una persona, los móviles ni nada del contacto de una entidad que es una persona
física (su nombre, web, correo y teléfono la identifican): la licencia de la Generalitat exige declarar otra finalidad
para reutilizar datos personales, y Faro no los necesita. En su lugar, el curso de una persona física lleva la
página de contacto oficial de la fuente (`contacto_oficial`). En la duda, el campo no se guarda. Python estándar.
"""

import re
from typing import NamedTuple

from plataforma_datos.comun.textos_y_cifras import texto

# Prefijos que admite la regla de contacto; el primer carácter basta y no se valida el resto del NIF.
LETRAS_NIF_DE_ENTIDAD = "ABCDEFGHJNPQRSUVW"
# Un correo es un buzón de la entidad si la parte anterior a la arroba es el nombre de su dominio, o si cada una de sus
# palabras empieza por el nombre de una función (información, cursos, formación…) o es el nombre del dominio, y al menos
# una es una función. Basta una palabra que no sea ninguna de las dos («maria.secretaria») para que pueda ser de una
# persona.
FUNCIONES_DE_BUZON = (
    "info",
    "curso",
    "formaci",
    "admin",
    "secretari",
    "general",
    "contact",
    "atenci",
    "alumn",
    "inscripci",
    "matricul",
    "consult",
    "comercial",
    "publicitat",
    "subvenci",
    "escola",
    "academia",
    "campus",
    "consorci",
    "institucional",
    "oficina",
    "recepci",
)
PATRON_CORREO = re.compile(r"[^@\s]+@[^@\s]+\.(?ai:[a-z]{2,})")
PATRON_WEB = re.compile(r"(?ai:(https?://)?([a-z0-9-]+\.)+[a-z]{2,})(/\S*)?")
# La regla admite nueve cifras que empiezan por 8 o 9, incluidos 80x y 905; excluye móviles y el prefijo +34.
PATRON_TELEFONO_FIJO = re.compile(r"[89][0-9]{8}")


class ContactoPublicado(NamedTuple):
    """Lo que publica un conjunto de una entidad, tal cual."""

    nif: str
    nombre: str
    web: str
    correo: str
    telefono: str


def _letras(valor: str) -> str:
    """Solo las letras de un texto, en minúsculas.

    Returns:
        Las letras de `valor` de la «a» a la «z», sin tildes ni otros signos.
    """
    return re.sub(r"[^a-z]", "", valor.lower())


def es_entidad_juridica(nif: str) -> bool:
    """Si el NIF es el de una persona jurídica (empresa, fundación, asociación…), no el de una persona física.

    Returns:
        `True` si el NIF empieza por una de LETRAS_NIF_DE_ENTIDAD.
    """
    valor = texto(nif).upper()
    return bool(valor) and valor[0] in LETRAS_NIF_DE_ENTIDAD


def es_correo_de_la_entidad(correo: str) -> bool:
    """Si un correo es un buzón de la entidad (funciones o nombre de su dominio) y no puede ser el de una persona.

    Que el dominio empiece o acabe como la parte anterior a la arroba no basta: por ejemplo,
    «nombre@nombreapellido.example» puede identificar a quien da nombre al dominio.

    Returns:
        `True` solo si el correo es un buzón de la entidad; en la duda, `False`.
    """
    if not PATRON_CORREO.fullmatch(correo):
        return False
    local, _, dominio = correo.lower().partition("@")
    nombre, marca = _letras(local), _letras(dominio.split(".")[0])
    if nombre and nombre == marca:
        return True
    palabras = [palabra for palabra in re.split(r"[^a-z]+", local) if palabra]
    de_funcion = [palabra.startswith(FUNCIONES_DE_BUZON) for palabra in palabras]
    return any(de_funcion) and all(
        funcion or palabra == marca for funcion, palabra in zip(de_funcion, palabras, strict=True)
    )


def web_de_la_entidad(web: str) -> str | None:
    """Web publicada como dirección completa («www.idfo.com» da «https://www.idfo.com»); None si no es una web.

    Returns:
        La web con su protocolo, o `None` si el valor no es una web.
    """
    valor = texto(web)
    if not PATRON_WEB.fullmatch(valor):
        return None
    return valor if re.match(r"https?://", valor, re.IGNORECASE) else f"https://{valor}"


def es_telefono_fijo(telefono: str) -> bool:
    """Si un teléfono (solo cifras) es fijo o de atención, no un móvil.

    Returns:
        `True` si empieza por 8 o 9 y tiene nueve cifras.
    """
    return PATRON_TELEFONO_FIJO.fullmatch(telefono) is not None


def contacto(publicado: ContactoPublicado, contacto_oficial: str) -> tuple[dict[str, str | None], dict[str, bool]]:
    """Contacto de la entidad que llega a Faro y lo que se ha retirado, por motivo, por poder ser de una persona.

    De una persona física (o sin NIF de persona jurídica) no llega nada: su web, su correo y su teléfono, aunque sea
    fijo, son datos de esa persona; llega solo `contacto_oficial`, la página de contacto oficial de la fuente.
    Cada motivo de retirada se cuenta por sí mismo, también cuando coincide con otro.

    Returns:
        Los campos de contacto que llegan a Faro y, por cada motivo de retirada, si se aplicó.
    """
    correo = texto(publicado.correo)
    telefono = re.sub(r"\D", "", texto(publicado.telefono))
    juridica = es_entidad_juridica(publicado.nif)
    correo_de_la_entidad = es_correo_de_la_entidad(correo)
    fijo = es_telefono_fijo(telefono)
    datos = {
        "entidad": texto(publicado.nombre) if juridica else None,
        "web": web_de_la_entidad(publicado.web) if juridica else None,
        "correo": correo.lower() if juridica and correo_de_la_entidad else None,
        "telefono": telefono if juridica and fijo else None,
        "contacto_oficial": None if juridica else contacto_oficial,
    }
    retirados = {
        "correos_que_pueden_ser_de_una_persona": bool(correo) and not correo_de_la_entidad,
        "telefonos_moviles": bool(telefono) and not fijo,
        "entidades_que_son_personas_fisicas": not juridica,
    }
    return datos, retirados
