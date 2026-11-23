"""Acreditación de competencias: certificados profesionales y relaciones con ocupaciones comprobadas por revisión.

Cadena oficial, sin IA:
- los certificados que imparte el SOC, con sus unidades de competencia y sus módulos, de los datos abiertos de la
  Generalitat (ODC-BY) que ya guarda `cursos/fuentes/formacion/lector.py`;
- el anexo de cada certificado en su real decreto (BOE), con la lista «Ocupaciones o puestos de trabajo relacionados»
  (boe.py): del texto consolidado o, si no trae el anexo (los de 2008 y algunos de 2009), del PDF original (pdf.py);
- la correspondencia CNO-94 / CNO-11 del INE, para los códigos anteriores a 2011, que solo relacionan el grupo;
- el anexo XIII-a del Real Decreto 151/2022, que da las unidades actuales de las que suprimió (atención
  sociosanitaria), y los textos del Real Decreto 659/2023 y la Ley Orgánica 3/2022, cuyos requisitos y plazos se
  comprueban literales.
Las páginas de la Generalitat (Tràmits gencat y la Agència FP.CAT) y la Sindicatura de Comptes van en una lista
registrada a mano, con su fecha y, si se pudo leer, su huella (PAGINAS_REGISTRADAS): fp.gencat.cat prohíbe la lectura
automática en su robots.txt. Lo que depende de un permiso pendiente (fichas de TodoFP, catálogo del INCUAL) no se usa.
Las horas de experiencia del nivel 1 en Cataluña (HORAS_NIVEL_1) son las de la guía de la Agència FP.CAT
(`cursos/fuentes/agencia/lector.py`).

El enlace de cada ocupación ESCO y grupo ISCO-08 con sus certificados es una elaboración de Faro apoyada en los anexos
oficiales y en una revisión con cita literal. relaciones.py propone los enlaces y la revisión decide cuáles se enseñan;
viajan hechos en el paquete y el motor solo los consulta (src/dominio/acreditacion.ts). La regla propone «ocupacion» si
el anexo nombra uno de sus códigos, y «grupo» si nombra una ocupación de su grupo que es la suya con otras palabras. Los
certificados de las cualificaciones que la Agència FP.CAT da como no disponibles (profesiones sanitarias reguladas, Real
Decreto 659/2023, art. 175.2; `cursos/fuentes/agencia/lector.py`) no se acreditan por esta vía; los demás de Sanidad,
sí. Las relaciones que la regla da y el texto del anexo desmiente se quitan (DESCARTADAS). Se enseña cada relación
admitida por la revisión cuya ocupación y cuyo certificado están en el paquete, la proponga la regla o no; los descartes
mandan sobre todo. La lista ADMITIDAS registra la cita, la fecha y la huella de la regla de revisión, y la procedencia
de cada relación viaja en el conjunto. Sin esa lista no se exporta ninguna relación. Los certificados van todos, con
relación o sin ella: son el catálogo oficial. La validación comprueba que la regla da los ejemplos (EJEMPLOS), que todo
lo que se enseña está admitido y que no aparece ninguna relación descartada.

Cada descarga respeta el robots.txt de su sitio (robots.py) y espera PAUSA_ENTRE_PETICIONES_S entre peticiones.
Depende de las validaciones de clasificaciones (CNO-11 e ISCO-08), formación (EURES y datos del SOC) y cataluna
(personas ocupadas, solo para la cobertura).

El código vive en piezas/, por responsabilidad: constantes.py (fuentes, umbrales y listas
revisadas), descarga.py, preparacion.py (textos del BOE, códigos y certificados), relacion_con_ocupaciones.py,
revision.py, validacion.py y conjunto.py (lo que exporta el paquete). Aquí quedan las etapas y la orden, que es la
que citan las procedencias; quien necesita una pieza la importa de su módulo.

Uso: python3 -m plataforma_datos.cursos.fuentes.acreditacion.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import sys
from collections import Counter, defaultdict
from datetime import date
from typing import Any

from plataforma_datos.comun import boe
from plataforma_datos.comun.boe import TablasDeClasificacion
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    controles_de_huella,
    guardar_json,
    guardar_jsonl,
    hoy_utc,
    leer_json,
    leer_jsonl,
    original,
    procedencia,
)
from plataforma_datos.comun.estadisticas import RESUMEN_LICENCIA_INE as LICENCIA_INE
from plataforma_datos.comun.nucleo import Controles
from plataforma_datos.cursos.fuentes.acreditacion.piezas.conjunto import conjunto_validado
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    ADMITIDAS,
    ARCHIVO_DEL_INDICE,
    CERTIFICADOS,
    CITA_BOE,
    CITA_INE,
    CORRESPONDENCIA,
    EJEMPLOS,
    FUENTE,
    HUELLA_DE_LA_REGLA,
    LICENCIA_BOE,
    NOMBRE_FUENTE,
    NORMAS,
    ORIGINAL,
    PAGINAS_REGISTRADAS,
    PENDIENTES,
    PROCEDENCIA,
    REGISTRO_A_MANO,
    RESUMEN,
    Texto,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.descarga import (
    Lector,
    certificados_del_soc,
    complementarias,
    disposiciones,
    numero_del_archivo,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.preparacion import (
    Encontrado,
    anexos_del_certificado,
    anexos_por_codigo,
    certificado_preparado,
    correspondencia_cno94,
    normas_preparadas,
    textos_de_los_reales_decretos,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.relacion_con_ocupaciones import (
    Relaciones,
    leer_cadena,
    todas_las_relaciones,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.revision import (
    leer_admitidas,
    lo_que_se_ensena,
    procedencia_de_la_revision,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.validacion import (
    EJEMPLOS_DE_CATALUNA,
    avisos_de_paginas,
    cobertura,
    controles_de_codigos,
    controles_de_ejemplos,
    controles_de_horas,
    controles_de_lectura,
    controles_de_normas,
    controles_de_revision,
    controles_del_punto_de_informacion,
    de_cataluna,
    resumen_de_cobertura,
    resumen_de_revision,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, exigir_admitido, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# La copia de las especialidades del SOC (`cursos/fuentes/formacion/lector.py`) de la que salen los certificados.
ARCHIVO_DEL_SOC = "soc-especialidades.json"

# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def _controles_de_cataluna(controles: Controles, cataluna: dict[str, Any]) -> None:
    """Los ejemplos de Sanidad, y que ningún certificado esté a la vez en la oferta y en la lista de no disponibles."""
    en_la_oferta, fuera = set(cataluna["en_la_oferta"]), cataluna["no_disponibles"]
    for ejemplo, esperado in EJEMPLOS_DE_CATALUNA.items():
        visto = "sin comprobar"
        if ejemplo in en_la_oferta:
            visto = "en la oferta"
        elif ejemplo in fuera:
            visto = "no disponible"
        controles.comprobar(visto == esperado, f"{ejemplo}: {esperado} en Cataluña ({visto})")
    controles.comprobar(not (en_la_oferta & set(fuera)), "ningún certificado en la oferta y no disponible a la vez")


def _certificados_del_soc() -> dict[str, Any]:
    """Lee los certificados del SOC de la copia guardada de sus especialidades.

    Returns:
        Por código del SOC, sus datos y filas (`descarga.certificados_del_soc`).
    """
    return certificados_del_soc(leer_json(original("formacion", ARCHIVO_DEL_SOC)))


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga los textos oficiales y registra su procedencia, con el robots.txt de cada sitio."""
    certificados = _certificados_del_soc()
    lector = Lector(aceptar_cambio)
    registros = disposiciones(lector, certificados)
    for pagina in complementarias():
        registro, _contenido = lector.descargar(pagina)
        registros.append(registro)
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": NOMBRE_FUENTE,
            "licencia": f"BOE: {LICENCIA_BOE} INE: {LICENCIA_INE}",
            "cita": f"{CITA_BOE} {CITA_INE}",
            "robots": lector.robots,
            "nota": "Los PDF de 2008 se piden por su ELI (/eli/…/dof/spa/pdf), que el robots.txt del BOE permite; "
            "algunos días de /boe/dias/ están cerrados enteros. Las páginas de la Generalitat y de la Sindicatura no "
            "se descargan: van en PAGINAS_REGISTRADAS "
            "(plataforma_datos/cursos/fuentes/acreditacion/piezas/constantes.py).",
            "archivos": registros,
        },
    )


def _resumen_de_lectura(
    indice: dict[str, boe.Disposicion],
    titulos: dict[str, str | None],
    textos: list[Texto],
    encontrados: dict[str, list[Encontrado]],
    certificados: list[dict[str, Any]],
) -> dict[str, Any]:
    """Resume lo que dejó la lectura del BOE, para revisarlo de un vistazo en el preparado.

    Args:
        indice: Los reales decretos del índice (referencias anteriores del Real Decreto 189/2013).
        titulos: El número de real decreto que dice el título de cada archivo leído.
        textos: Los textos leídos del BOE (consolidados en HTML y PDF originales).
        encontrados: Los anexos encontrados, por código de certificado.
        certificados: Los certificados del SOC ya preparados.

    Returns:
        Recuentos, títulos que no cuadran con su archivo, certificados sin anexo, erratas de código, unidades con
        código irregular y clases de código de las ocupaciones.
    """
    return {
        "reales_decretos_del_indice": len(indice),
        "titulos_que_no_cuadran": sorted(
            archivo for archivo, numero in titulos.items() if numero != numero_del_archivo(archivo)
        ),
        "textos_consolidados": sum(1 for del_boe in textos if del_boe.archivo.endswith(".html")),
        "pdf_originales": sum(1 for del_boe in textos if del_boe.archivo.endswith(".pdf")),
        "certificados_leidos_en_el_boe": len(encontrados),
        "certificados_del_soc": len(certificados),
        "sin_anexo": [certificado["codigo"] for certificado in certificados if not certificado["anexo"]],
        "erratas_de_codigo": {
            certificado["codigo"]: certificado["anexo"]["codigo_en_el_boe"]
            for certificado in certificados
            if certificado["anexo"] and certificado["anexo"]["codigo_en_el_boe"] != certificado["codigo_oficial"]
        },
        "unidades_con_codigo_irregular": {
            certificado["codigo"]: certificado["anexo"]["unidades_con_codigo_irregular"]
            for certificado in certificados
            if certificado["anexo"] and certificado["anexo"]["unidades_con_codigo_irregular"]
        },
        "clases_de_codigo": dict(
            sorted(
                Counter(
                    ocupacion["clase"]
                    for certificado in certificados
                    if certificado["anexo"]
                    for ocupacion in certificado["anexo"]["ocupaciones"]
                ).items()
            )
        ),
    }


def preparar() -> None:
    """Lee cada texto del BOE, encuentra el anexo de cada certificado del SOC y guarda lo que comprueba validar."""
    clasificaciones = leer_validado("clasificaciones")
    tablas = TablasDeClasificacion(
        grupos_cno11={grupo for grupo, datos in clasificaciones["cno11"].items() if datos["nivel"] == "4"},
        correspondencia_cno94=correspondencia_cno94(),
    )
    textos, titulos = textos_de_los_reales_decretos()
    encontrados = anexos_por_codigo(textos)
    normas = normas_preparadas()
    exigir_admitido("formacion")
    del_soc = _certificados_del_soc()
    por_real_decreto: dict[str, list[Encontrado]] = defaultdict(list)
    for lista in encontrados.values():
        for encontrado in lista:
            por_real_decreto[encontrado.texto.numero].append(encontrado)
    certificados = [
        certificado_preparado(
            codigo_soc,
            datos["filas"],
            anexos_del_certificado({"codigo": codigo_soc, **datos}, encontrados, por_real_decreto),
            tablas,
            normas["equivalencias"],
        )
        for codigo_soc, datos in del_soc.items()
    ]
    indice = boe.referencias_anteriores(original(FUENTE, ARCHIVO_DEL_INDICE).read_bytes())
    resumen = _resumen_de_lectura(indice, titulos, textos, encontrados, certificados)
    guardar_jsonl(CERTIFICADOS, certificados)
    guardar_json(CORRESPONDENCIA, tablas.correspondencia_cno94)
    guardar_json(NORMAS, normas)
    guardar_json(REGISTRO_A_MANO, PAGINAS_REGISTRADAS)
    guardar_json(RESUMEN, resumen)
    print(f"{len(textos)} textos del BOE · {len(encontrados)} anexos de certificado · {resumen['sin_anexo']} sin anexo")


def _resumen_de_cataluna(
    cataluna: dict[str, Any], certificados: list[dict[str, Any]], todas: Relaciones
) -> dict[str, Any]:
    """Cuenta cuántos certificados del catálogo y de los que tienen relación admitida constan en la oferta de Cataluña.

    Args:
        cataluna: Lo validado de la oferta de la Agència FP.CAT («en_la_oferta»).
        certificados: Los certificados preparados.
        todas: Las relaciones admitidas.

    Returns:
        Los recuentos de la cobertura en Cataluña.
    """
    en_la_oferta = set(cataluna["en_la_oferta"])
    relacionados = {certificado for lista in todas.ocupaciones.values() for certificado in lista}
    relacionados |= {certificado for lista in todas.grupos.values() for certificado in lista}
    de_ocupaciones = [certificado for lista in todas.ocupaciones.values() for certificado in lista]
    return {
        "oferta_actualizada": cataluna["oferta_actualizada"],
        "catalogo": {"certificados": len(certificados), "en_la_oferta": len(en_la_oferta)},
        "con_relacion_admitida": {
            "certificados": len(relacionados),
            "en_la_oferta": len(relacionados & en_la_oferta),
            "relaciones_de_ocupaciones": len(de_ocupaciones),
            "relaciones_en_la_oferta": sum(1 for certificado in de_ocupaciones if certificado in en_la_oferta),
        },
        "no_disponibles": cataluna["no_disponibles"],
        "en_la_oferta": cataluna["en_la_oferta"],
    }


def validar(hoy: date | None = None) -> None:
    """Comprueba lectura, códigos, ejemplos, revisión y normas, y guarda la validación con su cobertura.

    La lista de admitidas se lee lo primero: sin ella, o con un fallo, no se calcula ni se guarda nada.
    """
    admitidas = leer_admitidas(ADMITIDAS, HUELLA_DE_LA_REGLA)
    certificados, normas, resumen = leer_jsonl(CERTIFICADOS), leer_json(NORMAS), leer_json(RESUMEN)
    cadena = leer_cadena()
    propuestas = todas_las_relaciones(cadena, certificados)
    catalogo = {certificado["codigo"] for certificado in certificados if certificado["anexo"]}
    todas = lo_que_se_ensena(cadena, propuestas, admitidas, catalogo)
    censo = leer_validado("cataluna")
    calculada = cobertura(cadena, certificados, todas, censo)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia(FUENTE))
    controles_de_lectura(controles, certificados, resumen)
    controles_de_codigos(controles, certificados)
    controles_de_horas(controles, certificados)
    controles_de_ejemplos(controles, propuestas)
    controles_de_revision(controles, cadena, todas, admitidas, catalogo)
    controles_de_normas(controles, normas)
    controles_del_punto_de_informacion(controles, leer_json(REGISTRO_A_MANO))
    cataluna = de_cataluna(certificados)
    _controles_de_cataluna(controles, cataluna)
    avisos = avisos_de_paginas(leer_json(REGISTRO_A_MANO), hoy or hoy_utc())
    informe = {
        "estado": "Admitido" if controles.admitido else "Con errores",
        "comprobado_utc": ahora_utc(),
        "cobertura": resumen_de_cobertura(calculada),
        "cobertura_propuesta": resumen_de_cobertura(cobertura(cadena, certificados, propuestas, censo)),
        "revision": resumen_de_revision(propuestas, todas, admitidas),
        "oferta_cataluna": _resumen_de_cataluna(cataluna, certificados, todas),
        "ejemplos": {esco: todas.ocupaciones[esco] for esco in sorted({esco for esco, _, _ in EJEMPLOS})},
        "palabras_que_no_distinguen": sorted(cadena.genericas),
        "lectura": resumen,
        "avisos": avisos,
        "pendientes": PENDIENTES,
        "limites": "La relación es la de los anexos de los reales decretos: por grupo, solo si una línea del anexo de "
        "ese grupo nombra la ocupación con otras palabras (relaciones.py), y las líneas sin código no relacionan nada. "
        "No se acreditan los certificados de las cualificaciones que la Agència FP.CAT da como no disponibles "
        "(febrero de 2025). Un certificado solo consta en la oferta de Cataluña si casa con seguridad con su lista "
        "(cursos/fuentes/agencia/lector.py); los demás quedan sin comprobar. Faro no comprueba los requisitos de la "
        "persona: el bloque remite a la página del trámite.",
        "controles": controles.lista,
    }
    for aviso in avisos:
        print(f"Aviso: {aviso}", file=sys.stderr)
    print("Cobertura:", informe["cobertura"]["ocupaciones_esco"], informe["cobertura"]["personas_ocupadas"]["parte"])
    revision = procedencia_de_la_revision(todas, admitidas)
    cerrar_validacion(
        FUENTE, informe, controles, lambda: conjunto_validado(certificados, normas, todas, revision), compacto=True
    )


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar=descargar, preparacion_y_validacion=etapas, argumentos=argv)


if __name__ == "__main__":
    sys.exit(main())
