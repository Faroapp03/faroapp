"""Método revisado del componente público: selección española y acceso con cuenta.

Los cuerpos del proveedor se conservan como evidencia y nunca se ejecutan. Una
versión distinta del componente o del selector de idioma no hereda la revisión.
"""

import hashlib
import re
from urllib.parse import urljoin

from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.cibervoluntarios.declaraciones_publicadas import RUTA_CURSO

ORIGEN = "https://frontend.cibervoluntarios.org/vite/assets/"
METODO = "ciber-oferta-autoformacion-publicada:1"
PRINCIPAL_SHA256 = "f577c44e3d031592b6e4fbbe0949599a58526ab18bb61ceab41b1cf51dbeabaa"
COMPONENTE_SHA256 = "82fc509b9f353b5439d34b83177a0c0906ea91f1aeacd632416038cf1fb4978b"
IDIOMA_SHA256 = "a8ad41c163dca02663fdea8e3bdd489d0174d8896c668e96fd927bbcefbee323"
# Cada pareja conserva el módulo que resuelve los imports de ese componente.
# Los tres componentes revisados contienen el mismo cuerpo funcional del visor.
VERSIONES_REVISADAS = {
    (PRINCIPAL_SHA256, COMPONENTE_SHA256),
    (
        "3fc8e6374151e8b4215f4f5b75648c61d8a382a312fdbdeff1f32b0dfcfe77eb",
        "a77d945e58716aee8b740deeb78ba0ef6a6e23f6d44f78f99c14b9c8a40de2e9",
    ),
    (
        "82a6494ce2c3dd6e5b67c0cef2ec99cc58877edce1b0bfd1fd28e132d2aa1c6b",
        "0f33196b2b59c431c3b10df994e2b80b414684e1a563dbe083ae92f85b01b204",
    ),
}


def url_componente(codigo: bytes) -> str:
    """Exige componente inequívoco de la ruta española de autoformación.

    Returns:
        URL pública del único módulo enlazado por esa ruta concreta.
    """
    texto = codigo.decode("utf-8")
    patron = re.escape('path:"' + RUTA_CURSO + '",name:"es.training-atyourpace-course",component:')
    coincidencias = re.findall(patron + r'[^;]{0,80}?import\("\./(TrainingCourseView-[A-Za-z0-9_-]+\.js)"\)', texto)
    exigir(len(coincidencias) == 1, "Componente Ciber no vinculado a ruta española")
    return urljoin(ORIGEN, coincidencias[0])


def url_idioma(componente: bytes) -> str:
    """Selecciona el helper de idioma importado, nunca otro destino arbitrario.

    Returns:
        URL pública de la única dependencia de selección por idioma.
    """
    encontrados = re.findall(r'from"\./(useCatalogMaterialByLocale-[A-Za-z0-9_-]+\.js)"', componente.decode("utf-8"))
    exigir(len(encontrados) == 1, "Selector de idioma Ciber ambiguo")
    return urljoin(ORIGEN, encontrados[0])


def confirmado(componente: bytes, idioma: bytes, url_modulo: str, codigo: bytes) -> bool:
    """No ejecuta el método ni acepta un código distinto como si estuviera revisado.

    Returns:
        True solo para los tres cuerpos revisados y su import del módulo observado.
    """
    return (
        (hashlib.sha256(codigo).hexdigest(), hashlib.sha256(componente).hexdigest()) in VERSIONES_REVISADAS
        and hashlib.sha256(idioma).hexdigest() == IDIOMA_SHA256
        and ('from"./' + url_modulo.rsplit("/", 1)[1] + '"').encode() in componente
        and codigo.count(
            b'path:"formacion-gratuita/aprende-a-tu-ritmo/comenzar",name:"es.training-atyourpace-registry"'
        )
        == 1
    )
