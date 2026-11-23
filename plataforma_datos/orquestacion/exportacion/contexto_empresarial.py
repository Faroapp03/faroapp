"""Contexto empresarial y censal con consumidores separados, sin unir sus clasificaciones."""

from plataforma_datos.comun.entrada_salida import carpetas, original, procedencia, ruta_del_conjunto
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion.comun import Paquete


def paquete_empresas() -> Paquete:
    """Exporta el total catalán admitido y su definición; no una estimación por ocupación.

    Returns:
        Señal INE con periodo, población, ruptura y capturas propias. Eurostat y plantilla TIC no se exportan.
    """
    datos = leer_validado("empresas")
    registrada = procedencia("empresas")
    edicion = registrada["edicion"]
    exigir(edicion["nombre"] == datos["encuesta"]["edicion"], "empresas: edición validada y procedencia distintas")
    nombre = f"ine-eticce-{edicion['anio']}-comunidades"
    nombres = [nombre + ".json"]
    if datos["encuesta"].get("denominador") is not None:
        nombres.append(nombre + "-notas.html")
    originales = [original("empresas", n) for n in nombres]
    registros = {r["archivo"]: r for r in registrada["archivos"]}
    encuesta = datos["encuesta"]
    ambito = encuesta.get("ambito_ine_cnae2025")
    salida = {
        "fuente": datos["fuentes"]["ine"],
        "vigencia": datos["vigencia"],
        "encuesta": {
            **{k: encuesta[k] for k in ("edicion", "medida", "poblacion", "periodo", "error")},
            **{k: encuesta.get(k) for k in ("denominador", "clasificacion", "ruptura")},
            "ambito": ambito["nota"] if isinstance(ambito, dict) else None,
        },
        "cataluna": {"total": datos["cataluna"]["total"]},
        "capturas": [
            {
                "tipo": "tabla" if n == nombre + ".json" else "notas",
                **{k: registros[n][k] for k in ("archivo", "url", "sha256", "descargado_utc")},
            }
            for n in nombres
        ],
    }
    return Paquete(
        salida,
        [
            ruta_del_conjunto("empresas"),
            carpetas("empresas").validacion,
            carpetas("empresas").original / "procedencia.json",
            *originales,
        ],
    )


def paquete_sectores() -> Paquete:
    """Conserva el reparto censal catalán con sus remisiones, mínimos y otros publicados.

    Returns:
        Actividades CNAE-2009 y grupos CNO-11 del Censo 2021; no cruces con CNAE-2025 ni porcentajes de empresas.
    """
    datos = leer_validado("sectores")
    salida = {
        "fuente": datos["fuentes"]["sectores"],
        "vigencia": datos["vigencia"],
        "fecha_de_referencia": datos["fecha_de_referencia"],
        "lugar": datos["lugar"],
        "clasificacion_actividad": "CNAE-2009",
        "clasificacion_ocupacion": "CNO-11",
        **{k: datos[k] for k in ("min_personas_sector", "min_pct_sector", "min_personas_grupo", "actividades")},
        "cataluna": datos["territorios"]["cataluna"],
    }
    return Paquete(salida, [ruta_del_conjunto("sectores"), carpetas("sectores").validacion])
