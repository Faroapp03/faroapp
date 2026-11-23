"""Consorci per a la Formació Contínua de Catalunya: cursos gratuitos para personas que trabajan, con fecha y contacto.

Cuatro conjuntos de Dades Obertes de Catalunya, leídos por su API pública (Socrata), nunca rastreando páginas:
- qv5z-dgk3 «Accions formatives programades»: cada edición con su inicio, su fin, su modalidad, su municipio y el
  contacto de la entidad que la imparte, con la que se hace la inscripción. Es lo que ve la persona.
- jdcj-za6r «Cursos programats i en programació»: el código de especialidad de cada curso, la llave con que Faro
  relaciona la formación con la ocupación (`cursos/fuentes/formacion/lector.py`: ocupación → especialidades del SEPE), y
  cuántas ediciones de cada especialidad están programadas pero aún sin fecha.
- 7vig-4syr «Oferta formativa FPCAT (nou)», solo las filas del Consorci: contraste de la oferta con la versión de
  jdcj-za6r en vigor cuando se actualizó (oferta_emparejada.py), de a quién se dirige y del precio.
- hhvr-cedj «Accions formatives previstes»: las acciones que cada entidad puede programar, sin fecha («suele
  ofrecerse: pregunta a la entidad»).
Las ediciones se unen con su código por el nombre del curso y su fecha de inicio. Cada copia lleva en el nombre el día
en que se descargó; una descarga del mismo día con otro contenido no sustituye la copia sin --aceptar-cambio. Depende de
la validación de formación (catálogo del SEPE).

Uso: python3 -m plataforma_datos.cursos.fuentes.consorci.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import sys
from collections import Counter, defaultdict
from datetime import date
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    guardar_json,
    guardar_jsonl,
    leer_json,
    original,
    procedencia,
)
from plataforma_datos.comun.lugares import comarca_en_cataluna, municipio_legible
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.comun.socrata import (
    Conjunto,
    RutasDeLaCopia,
    actualizado_utc,
    nombre_de_datos,
    nombre_de_metadatos,
    registrar_copia,
)
from plataforma_datos.comun.socrata import leer_copia as leer_conjuntos
from plataforma_datos.comun.textos_y_cifras import texto
from plataforma_datos.cursos.fuentes.consorci import lectura
from plataforma_datos.cursos.fuentes.consorci.conjunto import (
    cobertura_de_preparados,
    comprobar_preparados,
    conjunto_validado,
    contraste_de_la_oferta,
    leer_preparados,
)
from plataforma_datos.cursos.fuentes.consorci.constantes import (
    ACCIONES,
    ACCIONES_PREVISTAS,
    CONJUNTOS,
    CONTACTO_OFICIAL,
    CURSOS,
    EDICIONES,
    EN_PROGRAMACION,
    FUENTE,
    LICENCIA,
    MODALIDADES_A_DISTANCIA,
    NOMBRE_FUENTE,
    OFERTA,
    ORGANISMO,
    ORIGINAL,
    PATRON_MODULO,
    PREVISTAS,
    PROCEDENCIA,
    RESUMEN,
    SIN_FECHA,
    TELEFORMACION,
    UNION_CERTIFICADO,
    UNION_EDICIONES_DE_LA_ACCION,
    UNION_NOMBRE,
    UNION_NOMBRE_Y_FECHA,
    UNION_SIN_CODIGO,
    VERSIONES_DE_LOS_CURSOS,
    Copia,
    IndiceDeCursos,
)
from plataforma_datos.cursos.fuentes.consorci.contactos import ContactoPublicado, contacto
from plataforma_datos.cursos.fuentes.consorci.filas_publicadas import (
    clave_de_edicion,
    fecha_iso,
    id_de_edicion,
    modalidad_de_la_edicion,
)
from plataforma_datos.cursos.fuentes.consorci.oferta_emparejada import (
    NO_COMPARABLE,
    historial_con,
    version_de_la_oferta,
)
from plataforma_datos.cursos.fuentes.formacion.lector import clave_nombre
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# Piezas internas de preparar: lectura.


def _fecha_de_la_copia() -> str:
    """Día de la copia vigente, el que registra la procedencia.

    Returns:
        La fecha AAAA-MM-DD de la copia.
    """
    return str(procedencia(FUENTE)["copia"])


def leer_copia() -> Copia:
    """Lee los originales de la copia vigente, cada uno comprobado contra su huella.

    Returns:
        La fecha de la copia y, por conjunto, sus filas y sus metadatos.
    """
    fecha = _fecha_de_la_copia()
    filas, metadatos = leer_conjuntos(FUENTE, CONJUNTOS, fecha)
    return Copia(fecha, filas, metadatos)


# Piezas internas de preparar: cada campo.


def partes_del_nombre(nombre: str) -> tuple[str | None, str | None, str]:
    """Certificado, módulo y nombre de un curso: «B_SSCS0108_MF0249_Higiene…» da SSCS0108, MF0249 y «Higiene…».

    Returns:
        El certificado y el módulo (None si el nombre no los lleva) y el nombre limpio.
    """
    limpio = texto(nombre)
    coincidencia = PATRON_MODULO.match(limpio)
    if not coincidencia:
        return None, None, limpio
    return coincidencia.group(1), coincidencia.group(2), texto(coincidencia.group(3))


def _contacto_de_la_edicion(fila: dict[str, Any]) -> tuple[dict[str, str | None], dict[str, bool]]:
    """Contacto de la entidad de una edición de qv5z-dgk3.

    Returns:
        Los datos de contacto que se guardan y, por motivo, si se retiró algo.
    """
    publicado = ContactoPublicado(
        nif=texto(fila.get("nif_entitat_formaci")),
        nombre=texto(fila.get("nom_entitat_formaci")),
        web=texto(fila.get("web")),
        correo=texto(fila.get("email")),
        telefono=texto(fila.get("tel_fon")),
    )
    return contacto(publicado, CONTACTO_OFICIAL)


def _contacto_de_la_prevista(fila: dict[str, Any]) -> tuple[dict[str, str | None], dict[str, bool]]:
    """Contacto de la entidad de una acción prevista de hhvr-cedj (sus campos tienen otros nombres).

    Returns:
        Los datos de contacto que se guardan y, por motivo, si se retiró algo.
    """
    publicado = ContactoPublicado(
        nif=texto(fila.get("nif_entitat_formaci")),
        nombre=texto(fila.get("entitat")),
        web=texto(fila.get("web")),
        correo=texto(fila.get("correu_electr_nic")),
        telefono=texto(fila.get("tel_fon")),
    )
    return contacto(publicado, CONTACTO_OFICIAL)


# Piezas internas de preparar: la unión, las ediciones y las acciones previstas.


def indice_de_cursos(cursos: list[dict[str, Any]]) -> IndiceDeCursos:
    """Los códigos de especialidad de jdcj-za6r por nombre y fecha de inicio (solo los que la tienen) y por nombre.

    Returns:
        Los códigos por (nombre, fecha de inicio) y por nombre.
    """
    por_nombre_y_fecha: dict[tuple[str, str], set[str]] = defaultdict(set)
    por_nombre: dict[str, set[str]] = defaultdict(set)
    for curso in cursos:
        clave = clave_nombre(partes_del_nombre(curso["nom_del_curs"])[2])
        por_nombre[clave].add(curso["codicurs"])
        inicio = fecha_iso(curso.get("data_inici_oferta_curs_centre", ""))
        if inicio:
            por_nombre_y_fecha[(clave, inicio)].add(curso["codicurs"])
    return IndiceDeCursos(dict(por_nombre_y_fecha), dict(por_nombre))


def _unico(codigos: set[str] | None) -> str | None:
    """El código si la unión da uno solo; None si no da ninguno o es ambigua.

    Returns:
        El código, o None.
    """
    return next(iter(codigos)) if codigos and len(codigos) == 1 else None


def codigo_de_especialidad(
    nombre: str, inicio: str, certificado: str | None, indice: IndiceDeCursos
) -> tuple[str | None, str]:
    """Código de especialidad de una edición y cómo se ha encontrado.

    Por orden: el certificado que lleva en el nombre; el curso de jdcj-za6r con el mismo nombre y la misma fecha de
    inicio; o, si no, el único código que tiene ese nombre en todo el conjunto. Un nombre con varios códigos no se
    resuelve: la edición se queda sin código («sin-codigo»).

    Returns:
        El código (None si no se encuentra) y la forma de la unión (UNION_*).
    """
    if certificado:
        return certificado, UNION_CERTIFICADO
    clave = clave_nombre(nombre)
    por_fecha = _unico(indice.por_nombre_y_fecha.get((clave, inicio)))
    if por_fecha:
        return por_fecha, UNION_NOMBRE_Y_FECHA
    por_nombre = _unico(indice.por_nombre.get(clave))
    return (por_nombre, UNION_NOMBRE) if por_nombre else (None, UNION_SIN_CODIGO)


def edicion(fila: dict[str, Any], indice: IndiceDeCursos) -> tuple[dict[str, Any], dict[str, bool]]:
    """Una edición de qv5z-dgk3 tal como la guarda Faro, y lo que se ha retirado de su contacto.

    Returns:
        La edición y, por motivo, si se retiró algo de su contacto.
    """
    certificado, modulo, nombre = partes_del_nombre(fila["denominacio"])
    inicio, fin = fecha_iso(fila["data_inici"]), fecha_iso(fila["data_final"])
    especialidad, union = codigo_de_especialidad(nombre, inicio or "", certificado, indice)
    modalidad = modalidad_de_la_edicion(fila)
    datos_de_contacto, retirados = _contacto_de_la_edicion(fila)
    return {
        "id": id_de_edicion(fila),
        "accion": texto(fila.get("identificador")),
        "nombre": nombre,
        "certificado": certificado,
        "modulo": modulo,
        "especialidad": especialidad,
        "union": union,
        "modalidad": modalidad,
        "a_distancia": modalidad in MODALIDADES_A_DISTANCIA,
        "municipio": municipio_legible(fila["nom_municipi"]),
        # Fuera de Cataluña (entidades de teleformación de otras comunidades) no hay comarca.
        "comarca": comarca_en_cataluna(fila.get("codi_municipi", ""), fila.get("codi_comarca", "")),
        "inicio": inicio,
        "fin": fin,
        "horas": texto(fila.get("hores")),
        **datos_de_contacto,
    }, retirados


def ediciones_de_la_copia(
    copia: Copia, indice: IndiceDeCursos | None = None
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Las ediciones de la copia, sin repetidas ni terminadas antes de la copia, y los recuentos de lo descartado.

    Los contactos retirados se cuentan antes de excluir las terminadas: el recuento abarca todas las filas únicas.

    Returns:
        Las ediciones ordenadas por id y los recuentos de filas repetidas, terminadas y datos retirados.
    """
    if indice is None:
        indice = indice_de_cursos(copia.filas[CURSOS.identificador])
    vistas: set[tuple[str, ...]] = set()
    ediciones: list[dict[str, Any]] = []
    recuentos: Counter[str] = Counter()
    for fila in copia.filas[ACCIONES.identificador]:
        clave = clave_de_edicion(fila)
        if clave in vistas:
            recuentos["filas_repetidas"] += 1
            continue
        vistas.add(clave)
        edicion_preparada, retirados = edicion(fila, indice)
        recuentos.update(motivo for motivo, retirado in retirados.items() if retirado)
        if edicion_preparada["fin"] and edicion_preparada["fin"] < copia.fecha:
            recuentos["terminadas_antes_de_la_copia"] += 1
            continue
        ediciones.append(edicion_preparada)
    return sorted(ediciones, key=lambda edicion: edicion["id"]), dict(recuentos)


def codigo_de_la_prevista(
    nombre: str, certificado: str | None, de_su_accion: str | None, indice: IndiceDeCursos
) -> tuple[str | None, str]:
    """Código de especialidad de una acción prevista y cómo se ha encontrado.

    Por orden: el certificado que lleva en el nombre; el de las ediciones de esa misma acción (qv5z-dgk3 y hhvr-cedj
    comparten el identificador de la acción); o el único código que tiene ese nombre en jdcj-za6r.

    Returns:
        El código (None si no se encuentra) y la forma de la unión (UNION_*).
    """
    if certificado:
        return certificado, UNION_CERTIFICADO
    if de_su_accion:
        return de_su_accion, UNION_EDICIONES_DE_LA_ACCION
    por_nombre = _unico(indice.por_nombre.get(clave_nombre(nombre)))
    return (por_nombre, UNION_NOMBRE) if por_nombre else (None, UNION_SIN_CODIGO)


def prevista(
    fila: dict[str, Any], indice: IndiceDeCursos, codigos_de_las_acciones: dict[str, str]
) -> tuple[dict[str, Any], dict[str, bool]]:
    """Una acción prevista de hhvr-cedj tal como la guarda Faro, y lo que se ha retirado de su contacto.

    Returns:
        La acción prevista y, por motivo, si se retiró algo de su contacto.
    """
    certificado, _, nombre = partes_del_nombre(fila["nom_de_l_acci"])
    accion = texto(fila["identificador"])
    especialidad, union = codigo_de_la_prevista(nombre, certificado, codigos_de_las_acciones.get(accion), indice)
    modalidad = texto(fila["modalitat"])
    datos_de_contacto, retirados = _contacto_de_la_prevista(fila)
    return {
        "id": accion,
        "nombre": nombre,
        "especialidad": especialidad,
        "union": union,
        "modalidad": modalidad,
        "a_distancia": modalidad == TELEFORMACION,
        "municipio": municipio_legible(fila["nom_municipi"]),
        "horas": texto(fila.get("hores")),
        **datos_de_contacto,
    }, retirados


def previstas_de_la_copia(
    copia: Copia, ediciones: list[dict[str, Any]], indice: IndiceDeCursos | None = None
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Las acciones previstas de la copia, con su código, y lo que se ha retirado de su contacto.

    Returns:
        Las acciones previstas ordenadas por id y los recuentos de datos retirados.
    """
    if indice is None:
        indice = indice_de_cursos(copia.filas[CURSOS.identificador])
    # Con varias especialidades de una acción, prevalece la última edición en el orden de entrada.
    codigos_de_las_acciones = {
        edicion["accion"]: edicion["especialidad"] for edicion in ediciones if edicion["especialidad"]
    }
    previstas: list[dict[str, Any]] = []
    recuentos: Counter[str] = Counter()
    for fila in copia.filas[ACCIONES_PREVISTAS.identificador]:
        prevista_preparada, retirados = prevista(fila, indice, codigos_de_las_acciones)
        recuentos.update(motivo for motivo, retirado in retirados.items() if retirado)
        previstas.append(prevista_preparada)
    return sorted(previstas, key=lambda accion: accion["id"]), dict(recuentos)


def programadas_sin_fecha(cursos: list[dict[str, Any]]) -> dict[str, int]:
    """Por código de especialidad, cuántas ediciones de jdcj-za6r están programadas pero aún sin fecha.

    Returns:
        Por código de especialidad, el número de ediciones programadas sin fecha.

    Raises:
        FormatoInesperado: Si una fila no publica el campo de inicio.
    """
    sin_fecha: Counter[str] = Counter()
    for numero, curso in enumerate(cursos, start=1):
        exigir(
            "data_inici_oferta_curs_centre" in curso,
            f"{CURSOS.identificador}: fila {numero} sin data_inici_oferta_curs_centre",
        )
        if curso["data_inici_oferta_curs_centre"] == EN_PROGRAMACION:
            sin_fecha[curso["codicurs"]] += 1
    return dict(sorted(sin_fecha.items()))


def _valores(filas: list[dict[str, Any]], campo: str) -> list[str]:
    """Los valores distintos de un campo, ordenados.

    Returns:
        Los valores distintos, normalizados y ordenados.
    """
    return sorted({texto(fila.get(campo)) for fila in filas})


def pares_de_la_oferta(filas: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(código de la oferta, fecha de inicio) de cada fila con fecha; en 7vig-4syr todas la llevan.

    Returns:
        Los pares (código de la oferta, fecha de inicio).
    """
    pares = []
    for fila in filas:
        inicio = fecha_iso(fila.get("data_inici_oferta_curs_centre", ""))
        if inicio:
            pares.append((texto(fila.get("codi_oferta_curs_centre")), inicio))
    return pares


def pares_de_la_fpcat(filas: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(código de la oferta, fecha de inicio) de cada fila de 7vig-4syr.

    Una fila sin fecha legible entra con su valor tal cual: nunca coincide con un curso con fecha, y el contraste falla.

    Returns:
        Los pares (código de la oferta, fecha de inicio o el valor tal cual).
    """
    pares = []
    for fila in filas:
        valor = fila.get("data_inici_oferta_curs_centre", "")
        pares.append((texto(fila.get("codi_oferta_curs_centre")), fecha_iso(valor) or texto(valor)))
    return pares


def _version_de_la_oferta(copia: Copia, conjunto: Conjunto, pares: list[tuple[str, str]]) -> dict[str, Any]:
    """La versión de la oferta de un conjunto en la copia: su actualización exacta y cuándo se descargaron sus filas.

    Returns:
        La versión de la oferta, con su actualización y su descarga.
    """
    contenido = leer_json(original(FUENTE, nombre_de_metadatos(conjunto, copia.fecha)))
    descargas = {archivo["archivo"]: archivo["descargado_utc"] for archivo in procedencia(FUENTE)["archivos"]}
    return version_de_la_oferta(pares, actualizado_utc(contenido), descargas[nombre_de_datos(conjunto, copia.fecha)])


def _resumen_de_conjuntos(copia: Copia) -> dict[str, dict[str, Any]]:
    """Por conjunto: filas descargadas y lo que dicen sus metadatos; de jdcj-za6r y 7vig-4syr, su oferta con fecha.

    Returns:
        Por conjunto, sus filas y sus metadatos; en los dos de la oferta, también la oferta con fecha.
    """
    resumen: dict[str, dict[str, Any]] = {}
    for conjunto in CONJUNTOS:
        filas = copia.filas[conjunto.identificador]
        resumen[conjunto.identificador] = {"filas": len(filas), **copia.metadatos[conjunto.identificador]}
    cursos = copia.filas[CURSOS.identificador]
    pares_de_los_cursos = pares_de_la_oferta(cursos)
    resumen[CURSOS.identificador]["con_fecha"] = len(pares_de_los_cursos)
    resumen[CURSOS.identificador]["con_fecha_o_en_programacion"] = len(pares_de_los_cursos) + sum(
        1 for curso in cursos if curso.get("data_inici_oferta_curs_centre") == EN_PROGRAMACION
    )
    resumen[CURSOS.identificador]["oferta"] = _version_de_la_oferta(copia, CURSOS, pares_de_los_cursos)
    resumen[OFERTA.identificador]["oferta"] = _version_de_la_oferta(
        copia, OFERTA, pares_de_la_fpcat(copia.filas[OFERTA.identificador])
    )
    return resumen


def resumen_de_la_copia(
    copia: Copia, ediciones: list[dict[str, Any]], previstas: list[dict[str, Any]], descartes: dict[str, Any]
) -> dict[str, Any]:
    """Lo que la validación contrasta: recuentos frente a los metadatos, unión, destinatarios, precios y modalidades.

    Returns:
        El resumen de la copia que lee la validación.
    """
    cursos, oferta = copia.filas[CURSOS.identificador], copia.filas[OFERTA.identificador]
    return {
        "copia": copia.fecha,
        "conjuntos": _resumen_de_conjuntos(copia),
        "union": dict(sorted(Counter(edicion["union"] for edicion in ediciones).items())),
        "union_de_las_previstas": dict(sorted(Counter(accion["union"] for accion in previstas).items())),
        "descartes": descartes,
        "destinatarios": sorted(
            set(_valores(cursos, "persones_destinat_ries") + _valores(oferta, "persones_destinat_ries"))
        ),
        "precios": {
            CURSOS.identificador: _valores(cursos, "preu_oferta_curs_centre"),
            OFERTA.identificador: _valores(oferta, "preu_oferta_curs_centre"),
        },
        "financiacion_publica": _valores(cursos, "finan_p_blic_oferta_curs"),
        "modalidades": sorted({edicion["modalidad"] for edicion in ediciones}),
        "modalidades_de_las_previstas": sorted({accion["modalidad"] for accion in previstas}),
    }


# Etapas.


def descargar(aceptar_cambio: bool = False, hoy: date | None = None) -> lectura.Resultado:
    """Descarga la copia del día por la API, con una pausa entre peticiones, y registra su procedencia.

    Una copia del mismo día que ya no coincide con su procedencia detiene la descarga, salvo con `aceptar_cambio`.
    La copia conservada deja sus lecturas antes de que la validación decida si se admite; si no se pueden emitir, el
    resultado lo dice y nada más cambia.

    Returns:
        Las lecturas emitidas y los problemas que impidieron emitirlas, si los hubo.
    """
    registrar_copia(
        CONJUNTOS,
        RutasDeLaCopia(ORIGINAL, PROCEDENCIA),
        {"fuente": NOMBRE_FUENTE, "licencia": LICENCIA, "cita": ORGANISMO},
        aceptar_cambio,
        hoy,
    )
    return lectura.emitir(ORIGINAL)


def preparar() -> None:
    """Une las ediciones y las acciones previstas con su código y guarda lo que valida validar."""
    copia = leer_copia()
    sin_fecha = programadas_sin_fecha(copia.filas[CURSOS.identificador])
    indice = indice_de_cursos(copia.filas[CURSOS.identificador])
    ediciones, descartes_ediciones = ediciones_de_la_copia(copia, indice)
    previstas, descartes_previstas = previstas_de_la_copia(copia, ediciones, indice)
    descartes = {
        "ediciones": dict(sorted(descartes_ediciones.items())),
        "previstas": dict(sorted(descartes_previstas.items())),
    }
    guardar_jsonl(EDICIONES, ediciones)
    guardar_jsonl(PREVISTAS, previstas)
    guardar_json(SIN_FECHA, sin_fecha)
    guardar_json(RESUMEN, resumen_de_la_copia(copia, ediciones, previstas, descartes))
    print(f"Copia del {copia.fecha}: {len(ediciones)} ediciones y {len(previstas)} acciones previstas; {descartes}")


def validar() -> None:
    """Comprueba la copia y guarda su validación y, si se admite, el conjunto que exporta el paquete."""
    preparados = leer_preparados()
    controles = comprobar_preparados(preparados)
    contraste = contraste_de_la_oferta(preparados)
    resumen = preparados.resumen
    informe = {
        "estado": "Admitido" if controles.admitido else "Con errores",
        "comprobado_utc": ahora_utc(),
        "copia": resumen["copia"],
        "cobertura": cobertura_de_preparados(preparados),
        "union": resumen["union"],
        "union_de_las_previstas": resumen["union_de_las_previstas"],
        "descartes": resumen["descartes"],
        "limites": "Solo ediciones con fecha: los conjuntos cubren una ventana móvil de unos dos meses y se "
        "actualizan con frecuencias distintas (jdcj-za6r, cada día; 7vig-4syr, cuando cambia); las acciones "
        "previstas no tienen fecha ni dicen cuándo se programarán. Los certificados de profesionalidad (como "
        "SSCS0108) no están en el catálogo del SEPE que usa Faro y sus módulos no se "
        "relacionan con ocupaciones. La inscripción es con la entidad; en teleformación y aula virtual el municipio es "
        "el de la entidad. No se guardan correos ni móviles que puedan ser de una persona, ni el nombre ni el contacto "
        "de una entidad que es una persona física: su curso lleva la página de contacto del Consorci.",
        "contraste_de_la_oferta": contraste,
        "controles": controles.lista,
    }
    if contraste["resultado"] == NO_COMPARABLE:
        print(
            f"Oferta FPCAT no comparable: {OFERTA.identificador} actualizada el {contraste['oferta_actualizada']}, "
            f"{CURSOS.identificador} el {contraste['cursos_actualizados']} ({contraste['desfase_dias']} días)"
        )
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto_validado(preparados), compacto=True)
    # Solo se llega aquí si la copia queda admitida: su versión de jdcj-za6r pasa a ser candidata a pareja.
    version = resumen["conjuntos"][CURSOS.identificador]["oferta"]
    guardar_json(VERSIONES_DE_LOS_CURSOS, historial_con(list(preparados.versiones), version))


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si cada etapa termina bien.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
