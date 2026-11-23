"""Dos lecturas seguidas del censo de ediciones de Cibernàrium, construidas como las emitirá su adquisición."""

import hashlib

from plataforma_datos.cursos.clasificacion.contrato import Regla
from plataforma_datos.cursos.lecturas.contrato_lectura import (
    HuellaForma,
    Lectura,
    Salida,
    huella_de_campos,
    huella_de_ids,
)

FUENTE = "barcelonactiva"
AMBITO = "cibernarium:edicion"
CAMPOS = ("edicion.fecha_fin", "edicion.fecha_inicio", "edicion.id", "edicion.titulo", "programa.id")
PRIMER_CENSO = ("cibernarium:edicion:40112", "cibernarium:edicion:40187", "cibernarium:edicion:40203")
SEGUNDO_CENSO = ("cibernarium:edicion:40187", "cibernarium:edicion:40203", "cibernarium:edicion:40311")
REGLA = Regla(id="salud-lectura", version=1, sha256=hashlib.sha256(b"salud-lectura v1").hexdigest())


def forma() -> HuellaForma:
    """La forma de una captura de ediciones sin valores nuevos.

    Returns:
        La huella de sus campos y su nivel.
    """
    return HuellaForma(campos_sha256=huella_de_campos(CAMPOS), niveles=("edicion",))


def primera(**cambios: object) -> Lectura:
    """La primera lectura de la fuente: todo su censo entra.

    Returns:
        La lectura, con los campos cambiados que se pidan.
    """
    datos = {
        "fuente": FUENTE,
        "ambito": AMBITO,
        "anterior": None,
        "observado_utc": "2026-11-15T05:12:40Z",
        "completa": True,
        "recuento_bruto": 3,
        "recuento_vigente": 3,
        "total_declarado": 3,
        "ids_sha256": huella_de_ids(PRIMER_CENSO),
        "entradas": PRIMER_CENSO,
        "huella_forma": forma(),
        "estado": "sana",
        "regla": REGLA,
    }
    return Lectura(**{**datos, **cambios})


def segunda(**cambios: object) -> Lectura:
    """La lectura siguiente: entra una edición y sale otra cuyo fin publicado ya llegó.

    Returns:
        La lectura, con los campos cambiados que se pidan.
    """
    datos = {
        "fuente": FUENTE,
        "ambito": AMBITO,
        "anterior": primera().a_json()["lectura_id"],
        "observado_utc": "2026-11-18T05:09:03Z",
        "completa": True,
        "recuento_bruto": 3,
        "recuento_vigente": 2,
        "total_declarado": 3,
        "ids_sha256": huella_de_ids(SEGUNDO_CENSO),
        "entradas": ("cibernarium:edicion:40311",),
        "salidas": (Salida(id="cibernarium:edicion:40112", explicada_por="fin_publicado"),),
        "huella_forma": forma(),
        "estado": "sana",
        "regla": REGLA,
    }
    return Lectura(**{**datos, **cambios})
