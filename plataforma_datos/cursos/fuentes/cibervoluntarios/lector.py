"""Lee negocio de API Cibervoluntarios; cada material mantiene identidad y tipo.

No lee archivos, red, reloj ni cuentas. Actividad, material, idioma y formato se
conservan separados; Disponible es literal de origen, nunca oferta acreditada.
No incorpora imágenes, comentarios ni información de participantes.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from http import HTTPStatus
from urllib.parse import urlsplit

from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

ACTIVIDAD = ("title", "type", "status", "area", "format", "level", "totalDuration", "languages")
MATERIAL = (
    "title",
    "type",
    "status",
    "slug",
    "lang",
    "erased",
    "description",
    "aprenderContent",
    "paraTiContent",
    "descriptionContent",
    "moodleLink",
    "storyLineFile",
)


FUENTE = "cibervoluntarios"
# Los estados que trae el catálogo real, con su grafía exacta. Cualquier otro texto es un estado que Faro no conoce.
ESTADOS_CONOCIDOS = ("Disponible", "Descatalogado", "Pendiente")


class ErrorLecturaCiber(ValueError):
    """La captura no permite identificar un material íntegro de esta fuente."""


@dataclass(frozen=True, kw_only=True)
class CapturaCiber:
    """Recepción real causal y huella del cuerpo completo, sin rutas personales."""

    url: str
    sha256: str
    bytes_cuerpo: int
    inicio_utc: str
    recibido_utc: str
    http: int
    completo: bool
    localizador: str


@dataclass(frozen=True)
class MaterialCiber:
    """Material fuente y actividad contenedora; ninguno es una edición inventada."""

    id: int
    actividad_id: int
    tipo_actividad: str | None
    tipo_material: str | None
    idioma_publicado: str | None
    slug: str | None
    titulo: str | None
    actividad_publicada: ObjetoJson
    material_publicado: ObjetoJson
    captura: CapturaCiber
    localizador: str
    actividad_borrada: bool = False

    @property
    def borrado(self) -> bool:
        """Indica si el proveedor declara borrado el material o la actividad que lo contiene."""
        return self.actividad_borrada or self.material_publicado.get("erased") is True

    @property
    def disponible(self) -> bool:
        """Indica si el proveedor lo publica como disponible y no lo declara borrado; no acredita oferta."""
        publicado = self.material_publicado
        return (
            publicado.get("status") == "Disponible"
            and publicado.get("erased") is False
            and not self.actividad_borrada
            and self.actividad_publicada.get("status", "Disponible") == "Disponible"
        )

    @property
    def estado_desconocido(self) -> bool:
        """Indica si el material o su actividad traen un `status` de texto que Faro no conoce."""
        estados = (self.material_publicado.get("status"), self.actividad_publicada.get("status"))
        return any(isinstance(e, str) and e not in ESTADOS_CONOCIDOS for e in estados)

    @property
    def baja_declarada(self) -> tuple[str, str, str, str] | None:
        """Dice por qué el proveedor ya no ofrece el material, si lo declara: borrado o un estado que no es Disponible.

        Un campo ausente no es una declaración: solo cuenta un `erased` verdadero o un `status` que es texto.

        Returns:
            Motivo («borrado», «descatalogado» u «otro-estado»), valor literal del proveedor, campo y objeto
            («material» o «actividad») que lo dice; None si no declara ninguna baja.
        """
        if self.material_publicado.get("erased") is True:
            return "borrado", "true", "erased", "material"
        if self.actividad_borrada:
            return "borrado", "true", "erased", "actividad"
        for estado, objeto in (
            (self.material_publicado.get("status"), "material"),
            (self.actividad_publicada.get("status"), "actividad"),
        ):
            if isinstance(estado, str) and estado != "Disponible":
                return ("descatalogado" if estado == "Descatalogado" else "otro-estado"), estado, "status", objeto
        return None


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorLecturaCiber(motivo)


def _fecha(valor: str) -> datetime:
    try:
        fecha = datetime.fromisoformat(valor)
    except (ValueError, TypeError) as error:
        raise ErrorLecturaCiber("Fecha UTC inválida") from error
    _exigir(fecha.utcoffset() == timedelta(0), "Fecha sin UTC explícito")
    return fecha


def _texto(objeto: ObjetoJson, campo: str) -> str | None:
    valor = objeto.get(campo)
    _exigir(valor is None or isinstance(valor, str), "Texto fuente inválido: " + campo)
    return valor


def _pares(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
    objeto = {}
    for clave, valor in pares:
        _exigir(clave not in objeto, "Clave JSON repetida: " + clave)
        objeto[clave] = valor
    return objeto


def _constante(valor: str) -> ValorJson:
    raise ErrorLecturaCiber("Número JSON no finito: " + valor)


def extraer_materiales(cuerpo: bytes, captura: CapturaCiber) -> tuple[MaterialCiber, ...]:
    """Devuelve solo campos de negocio de una página completa verificada.

    No promete catálogo completo: el llamador valida paginación/censo y selecciona
    identidad nativa, idioma y tipo. El mismo título no autoriza fusionar nada.

    Returns:
        Materiales en orden fuente, incluidos tipos/estados desconocidos literales.

    Raises:
        ErrorLecturaCiber: Si identidad, integridad o procedencia no son verificables.
    """
    url = urlsplit(captura.url)
    _exigir(
        url.scheme == "https"
        and url.netloc == "www.cibervoluntarios.org"
        and url.path == "/api/public/activity_catalogs"
        and not url.fragment,
        "URL ajena a API Cibervoluntarios",
    )
    _exigir(
        type(captura.http) is int and captura.http == HTTPStatus.OK and captura.completo is True,
        "Captura no completa HTTP200",
    )
    _exigir(
        type(cuerpo) is bytes and type(captura.bytes_cuerpo) is int and captura.bytes_cuerpo == len(cuerpo),
        "Tamaño de captura incoherente",
    )
    _exigir(hashlib.sha256(cuerpo).hexdigest() == captura.sha256, "Huella de captura incoherente")
    _exigir(_fecha(captura.recibido_utc) >= _fecha(captura.inicio_utc), "Recepción anterior al intento")
    _exigir(bool(captura.localizador.strip()), "Localizador de captura ausente")
    try:
        pagina: ValorJson = json.loads(cuerpo.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ErrorLecturaCiber("JSON UTF8 inválido") from error
    _exigir(isinstance(pagina, dict) and isinstance(pagina.get("hydra:member"), list), "Página Hydra no reconocida")
    salida = []
    vistos = set()
    for i, actividad in enumerate(pagina["hydra:member"]):
        _exigir(
            isinstance(actividad, dict) and type(actividad.get("id")) is int and actividad["id"] > 0,
            "Falta identidad de actividad",
        )
        materiales = actividad.get("activityCatalogMaterials")
        _exigir(isinstance(materiales, list), "Lista de materiales ausente")
        for j, material in enumerate(materiales):
            _exigir(
                isinstance(material, dict) and type(material.get("id")) is int and material["id"] > 0,
                "Falta identidad de material",
            )
            _exigir(material["id"] not in vistos, "Material con identidad repetida en la página")
            vistos.add(material["id"])
            salida.append(
                MaterialCiber(
                    id=material["id"],
                    actividad_id=actividad["id"],
                    tipo_actividad=_texto(actividad, "type"),
                    tipo_material=_texto(material, "type"),
                    idioma_publicado=_texto(material, "lang"),
                    slug=_texto(material, "slug"),
                    titulo=_texto(material, "title"),
                    actividad_publicada={k: actividad[k] for k in ACTIVIDAD if k in actividad},
                    material_publicado={k: material[k] for k in MATERIAL if k in material},
                    captura=captura,
                    localizador=f"/hydra:member/{i}/activityCatalogMaterials/{j}",
                    actividad_borrada=actividad.get("erased") is True,
                )
            )
    return tuple(salida)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la operación registrada conservando las APIs puras de lectura.

    Returns:
        Código de las etapas comunes de esta fuente.
    """
    from plataforma_datos.cursos.operacion_fuente import main as operacion

    return operacion(FUENTE, argv)


if __name__ == "__main__":
    raise SystemExit(main())
