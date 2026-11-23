"""Nivel explícito de la actividad contenedora de un material admitido."""

from plataforma_datos.cursos.fuentes.cibervoluntarios.lector import MaterialCiber

NIVELES = {"Básico": "inicial", "Intermedio": "intermedio", "Avanzado": "avanzado"}


def extraer(material: MaterialCiber) -> dict | None:
    """Emite la declaración de la actividad, no un nivel propio del material.

    Returns:
        Dato y captura causal, o None si la fuente no declara una categoría conocida.
    """
    literal = material.actividad_publicada.get("level")
    valor = NIVELES.get(literal) if isinstance(literal, str) else None
    if valor is None or material.borrado or not material.disponible:
        return None
    cap = material.captura
    actividad_ruta = material.localizador.split("/activityCatalogMaterials/", 1)[0]
    return {
        "valor": valor,
        "literal": literal,
        "actividad_id": str(material.actividad_id),
        "material_id": str(material.id),
        "url": cap.url,
        "sha256": cap.sha256,
        "capturado_utc": cap.recibido_utc,
        "localizador": actividad_ruta + "/level",
    }
