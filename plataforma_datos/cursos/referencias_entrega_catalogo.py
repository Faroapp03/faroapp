"""Fecha y naturaleza por referencia exacta; no transforma derivados en originales HTTP."""

from plataforma_datos.cursos.tipos_json import ObjetoJson

NATURALEZAS_FECHA = ("no_acreditada", "declarada_historica", "recepcion_conservada")
NATURALEZAS_DOCUMENTO = ("no_acreditada", "derivado_negocio")
type ClaveReferencia = tuple[str, str, str, str]


def naturalezas(conversion: ObjetoJson) -> dict[ClaveReferencia, ObjetoJson]:
    """Identifica el soporte principal exacto; auxiliares no heredan su naturaleza.

    Returns:
        Mapa por ID/URL/SHA/fecha de referencias explícitamente relacionadas.
    """
    resultado = {}
    for item in conversion["mapa_acceso"]:
        principal, soporte = item["prueba_principal"], item["soporte"]
        fecha = principal["capturado_utc"]
        tipo_fecha = "no_acreditada"
        if soporte.get("recibido_utc") == fecha:
            tipo_fecha = "recepcion_conservada"
        elif soporte.get("recibido_utc") is None and soporte.get("fecha_declarada_utc") == fecha:
            tipo_fecha = "declarada_historica"
        derivado = (
            soporte.get("canal") == "negocio_curso" and soporte.get("respuesta_http_original_conservada") is False
        )
        clave = (item["catalogo_id"], principal["url"], principal["sha256"], fecha)
        naturaleza = {
            "naturaleza_fecha": tipo_fecha,
            "naturaleza_documento": "derivado_negocio" if derivado else "no_acreditada",
        }
        if clave in resultado and resultado[clave] != naturaleza:
            # Ninguna atribución contradictoria se convierte en recibo u original.
            naturaleza = dict.fromkeys(naturaleza, "no_acreditada")
        resultado[clave] = naturaleza
    return resultado
