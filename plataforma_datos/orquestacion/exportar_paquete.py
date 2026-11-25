"""Exporta en datos/ los paquetes admitidos y su manifiesto, sin red ni regeneración de recursos opcionales.

Reutiliza los compositores de exportacion/. Primero prepara todas las salidas, las copias de herramientas y el
manifiesto en un temporal del mismo disco. Antes de sustituir nombres gestionados, guarda sus versiones previas.
Ante una excepción durante promoción o retirada intenta restaurarlas; si restaurar también falla, conserva el
respaldo y explica su ruta. No garantiza una transacción atómica ante caídas del proceso/sistema ni otros escritores.
README.md, globales/ y cualquier otro archivo ajeno permanecen fuera de esa operación.
Biblioteca se exporta con su productor y recuperación comunes, sin incorporarse al manifiesto ocupacional.

Los datos globales se publican aparte. Nombres y derechos se exportan, aunque no sean partes del cargador común.
Las entradas de herramientas se copian solo si conservan bytes y procedencia local comprobable.
Los recursos históricos fijados se cotejan además con su captura admitida; no se regeneran embeddings ni peticiones.

Uso: python3 -m plataforma_datos.orquestacion.exportar_paquete [--destino <carpeta>] [--completar-renombres]
(por defecto, datos/). `--completar-renombres` solo lo pasa el ciclo operativo (ordenes_de_la_actualizacion).
"""

import argparse
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.lector import exportar as exportar_observaciones_lecturas
from plataforma_datos.biblioteca.fuentes.lecturas.lector import exportar as exportar_lecturas
from plataforma_datos.comun.entrada_salida import guardar_json, relativa, sha256, sha256_bytes
from plataforma_datos.comun.fuentes.catalan.exportacion import paquete_catalan
from plataforma_datos.comun.nucleo import (
    PAQUETE,
    RAIZ,
    ArchivoFaltante,
    ErrorFuente,
    ValidacionFallida,
    exigir,
)
from plataforma_datos.cursos.fuentes.acreditacion.exportacion import paquete_acreditacion
from plataforma_datos.cursos.fuentes.formacion.exportacion import paquete_correspondencia_eures, paquete_formacion
from plataforma_datos.cursos.retirada_en_el_paquete import sin_las_retiradas
from plataforma_datos.derechos.fuentes.derechos.exportacion import paquete_derechos
from plataforma_datos.ia_y_trabajo.fuentes.cambra.exportacion import paquete_cambra
from plataforma_datos.ia_y_trabajo.fuentes.tich.exportacion import paquete_tich
from plataforma_datos.ocupaciones.fuentes.esco.exportacion import paquete_esco
from plataforma_datos.ocupaciones.fuentes.textos.exportacion import paquete_textos
from plataforma_datos.orquestacion.exportacion.comun import Paquete, escribir
from plataforma_datos.orquestacion.exportacion.contexto_empresarial import paquete_empresas, paquete_sectores
from plataforma_datos.orquestacion.exportacion.mercado import paquete_mercado
from plataforma_datos.orquestacion.exportacion.metodos import paquete_metodos
from plataforma_datos.orquestacion.exportacion.validados import paquete_validado
from plataforma_datos.orquestacion.ordenes import con_motivo
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import SUCESORES

# El formato de cada paquete se conserva; los grandes van compactos, sin salto final.
COMPACTOS = (
    "esco.json",
    "formacion.json",
    "correspondencia-eures.json",
    "consorci.json",
    "acreditacion.json",
    "nombres.json",
    "ocupados.json",
    "censo.json",
    "observatori.json",
    "sepe-necesidades.json",
    "perfiles-sepe.json",
    "certificados-sepe-2016.json",
    "mercado.json",
    "empresas.json",
    "sectores.json",
    "metodos.json",
)

# Recursos opcionales ya existentes: se copian y registran; no se regeneran en esta orden.
ESCRITOS_POR_HERRAMIENTAS = {
    "vectores-formacion.json": "vectores de significado de la formación",
    "vectores-oit.json": "vectores de tareas de la OIT",
    # Herramientas de Node (herramientas/vectores-movil y herramientas/clasificador-movil): su entrada lleva los
    # orígenes con que se comprueban; si los bytes no han cambiado, se conserva tal cual (ver la función de abajo).
    "vectores-movil.json": "tabla de vectores del recorrido en el dispositivo",
    "clasificador-movil.json": "clasificador del recorrido en el dispositivo",
    # La hoja de ruta personal (plataforma_datos/cursos/fuentes/hoja_de_ruta/lector.py): comarca de cada municipio
    # (Idescat) y «Qué aprenderás» de cada especialidad (fichas oficiales del SEPE, el Consorci y FUNDAE).
    "comarcas.json": "comarca de cada municipio, del Idescat",
    "temarios.json": "temario oficial de cada especialidad",
}

# Fuentes sin consumidor del paquete: solo se retiran estos nombres antiguos.
PREPARADOS_SIN_USO = {
    "formacion-faro": "recursos del selector anterior sin consumidor",
    "accidentes": "accidentes de trabajo por ocupación (Ministerio de Trabajo)",
    "eaes": "subida del salario medio desde 2022 (EAES)",
    "fpcat": "oferta de FP y certificados con centro y municipio (Agència FP.CAT)",
    "afiliacion": "afiliados que viven en Cornellà, el Baix Llobregat y Cataluña (Idescat)",
    "orientacion": "fichas oficiales de la acreditación y servicios de orientación de Cornellà",
}


ENLACES_COMPROBADOS = "enlaces-comprobados.json"


def _enlaces_comprobados() -> dict[str, Paquete]:
    """El archivo de enlaces con el conjunto validado de la fuente `enlaces`, si lo tiene admitido.

    Es un archivo de apoyo (oculta o recupera enlaces): si el conjunto falta o su última validación no lo admite, no se
    detiene la exportación, que conserva el archivo publicado (`enlaces_publicados`). Un conjunto admitido que no se
    puede leer (JSON inválido, validación ilegible) sí la detiene, como en cualquier otra fuente.

    Returns:
        El paquete por su nombre de archivo; vacío si la fuente no tiene un conjunto admitido.
    """
    try:
        return {ENLACES_COMPROBADOS: paquete_validado("enlaces")}
    except (ArchivoFaltante, ValidacionFallida) as error:
        print(f"Aviso: sin conjunto admitido de enlaces ({error}); se conserva el archivo publicado.", file=sys.stderr)
        return {}


def enlaces_publicados(carpeta: Path = PAQUETE) -> dict[str, Any] | None:
    """Conserva el archivo de enlaces ya publicado, en la forma que tenga, con su entrada del manifiesto vigente.

    Args:
        carpeta: Carpeta del paquete que se prepara.

    Returns:
        La entrada del manifiesto, o None si no hay archivo publicado que conservar.
    """
    origen = PAQUETE / ENLACES_COMPROBADOS
    anterior = _entrada_vigente(ENLACES_COMPROBADOS)
    if not origen.exists() or anterior is None:
        return None
    exigir(
        sha256(origen) == anterior.get("sha256"),
        f"{ENLACES_COMPROBADOS}: los bytes publicados no coinciden con su procedencia",
        ValidacionFallida,
    )
    if carpeta != PAQUETE:
        shutil.copyfile(origen, carpeta / ENLACES_COMPROBADOS)
    return anterior


def paquetes() -> dict[str, Paquete]:
    """Construye todos los paquetes, en el orden del manifiesto; la traducción al catalán, al final y solo si existe.

    Returns:
        Cada paquete por su nombre de archivo.
    """
    construidos = {
        "esco.json": paquete_esco(),
        "oit.json": paquete_validado("oit"),
        "clasificaciones.json": paquete_validado("clasificaciones"),
        "exposicion-cambra.json": paquete_cambra(),
        "textos.json": paquete_textos(),
        # Formación: cadena oficial ocupación → especialidades → cursos
        # (plataforma_datos/cursos/fuentes/formacion/lector.py).
        "formacion.json": paquete_formacion(),
        # La correspondencia EURES de formacion.json, en su propio archivo: la lee la búsqueda de ocupaciones con el
        # núcleo del paquete, y formacion.json queda solo para el motor de cursos
        # (src/plataforma/archivos-del-paquete.ts).
        "correspondencia-eures.json": paquete_correspondencia_eures(),
        # Cursos gratuitos para personas que trabajan, con fecha y contacto
        # (plataforma_datos/cursos/fuentes/consorci/lector.py). Su archivo es independiente de formacion.json,
        # que conserva la entrada fijada de los análisis publicados.
        "consorci.json": paquete_validado("consorci"),
        # Webs, fichas y programas que la formación enseña, con la última observación de cada enlace
        # (plataforma_datos/cursos/fuentes/enlaces/lector.py): solo lo que ocultan o enlazan sus observaciones.
        **_enlaces_comprobados(),
        # Acreditación de competencias: certificados del SOC y las ocupaciones que les relaciona su real decreto
        # (plataforma_datos/cursos/fuentes/acreditacion/lector.py), con su revisión y si cada uno está en la oferta de
        # la Agència FP.CAT.
        "acreditacion.json": paquete_acreditacion(),
        # Cursos de Citilab en Cornellà, solo hechos con el enlace a su ficha
        # (plataforma_datos/cursos/fuentes/citilab/lector.py).
        "citilab.json": paquete_validado("citilab"),
        # Citas literales del BOE de los derechos de formación y ante la tecnología
        # (plataforma_datos/derechos/fuentes/derechos/lector.py): las pintan los dos grupos de derechos del informe.
        "derechos.json": paquete_derechos(),
        # Formación abierta en línea, fichas redactadas por Faro con su criterio
        # (plataforma_datos/cursos/fuentes/abierta/lector.py).
        # Va aparte: el motor la usa solo si FARO_FORMACION_ABIERTA lo permite, y sin el archivo funciona igual.
        "formacion-abierta.json": paquete_validado("abierta"),
        # Cataluña por ocupación: censo del INE y contratación del Observatori
        # (plataforma_datos/mercado/fuentes/cataluna/lector.py).
        "cataluna.json": paquete_validado("cataluna"),
        # Nombres de pila y apellidos de los residentes en España, del INE
        # (plataforma_datos/comun/fuentes/nombres/lector.py).
        "nombres.json": paquete_validado("nombres"),
        # Contexto del grupo de ocupación, aparte de la nota: personas ocupadas del censo anual (Idescat e INE),
        # municipios y perfil del Censo 2021, uso declarado de la IA generativa (TIC-H 2025; quienes no saben usarla,
        # del Idescat) y salarios (EES 2022).
        "ocupados.json": paquete_validado("ocupados"),
        "censo.json": paquete_validado("censo"),
        "tich.json": paquete_tich(),
        "salarios.json": paquete_validado("salarios"),
        # Contratos de cada ocupación por provincia y comarca, en series (Observatori del Treball,
        # plataforma_datos/mercado/fuentes/observatori/lector.py): los lee el bloque del grupo.
        "observatori.json": paquete_validado("observatori"),
        # Necesidades formativas por ocupación del SEPE: competencias con su porcentaje publicado y las que nombran la
        # IA (plataforma_datos/mercado/fuentes/necesidades/lector.py).
        # Las lee el apartado de lo que se pide del informe.
        "sepe-necesidades.json": paquete_validado("sepe-necesidades"),
        # Certificados que el SEPE relaciona con cada ocupación ESCO en sus perfiles de la oferta de empleo, aparte de
        # los comprobados por Faro (plataforma_datos/mercado/fuentes/perfiles/lector.py).
        # Los lee el bloque de acreditación.
        "perfiles-sepe.json": paquete_validado("perfiles"),
        # Los que el SEPE relacionó con cada ocupación en su informe de necesidades formativas de 2016, sin lo que ya
        # enseñan lo comprobado y los perfiles (plataforma_datos/cursos/fuentes/certificados2016/lector.py).
        "certificados-sepe-2016.json": paquete_validado("certificados2016"),
        # La acreditación oficial de competencias digitales de la Generalitat (ACTIC): niveles, áreas, cómo se obtiene
        # y de qué disposición sale cada dato (plataforma_datos/cursos/fuentes/actic/lector.py). La lee el bloque
        # digital transversal.
        "actic.json": paquete_validado("actic"),
        # Barcelona Activa, solo enlaces (plataforma_datos/cursos/fuentes/barcelonactiva/lector.py): la ficha de cada
        # ocupación en su Catàleg d'ocupacions, por código ESCO, y las formaciones de IA con fecha y modalidad.
        "barcelonactiva.json": paquete_validado("barcelonactiva"),
        # FUNDAE: ediciones en teleformación de la oferta estatal para personas trabajadoras, solo hechos y enlaces
        # (plataforma_datos/cursos/fuentes/fundae/lector.py). La hoja de ruta las da como convocatoria de su programa
        # del SEPE.
        "fundae.json": paquete_validado("fundae"),
        # Cifras de mercado del informe breve de cualquier ocupación
        # (plataforma_datos/orquestacion/exportacion/mercado.py): empleo
        # de la EPA por gran grupo, salarios de la EAES por grupo, contratación por año y por comarca del Observatori.
        "mercado.json": paquete_mercado(),
        # Señal general de empresas: conserva su población y clasificación propias.
        "empresas.json": paquete_empresas(),
        # Contexto censal independiente: nunca pondera el porcentaje de empresas.
        "sectores.json": paquete_sectores(),
        # Consenso de métodos de exposición a la IA por ocupación ISCO-08
        # (plataforma_datos/orquestacion/exportacion/metodos.py): la
        # confianza de la exposición en el informe breve.
        "metodos.json": paquete_metodos(),
    }
    periodo_cataluna = construidos["cataluna.json"].datos.get("periodo_contratacion")
    periodo_observatori = construidos["observatori.json"].datos.get("periodo")
    # Ambos conjuntos pueden estar admitidos por separado tras una actualización interrumpida.
    exigir(
        isinstance(periodo_cataluna, str)
        and bool(periodo_cataluna.strip())
        and periodo_cataluna == periodo_observatori,
        "Cataluña y Observatori deben compartir un periodo de contratación válido: "
        f"{periodo_cataluna!r} frente a {periodo_observatori!r}",
        ValidacionFallida,
    )
    # Traducción de Faro al catalán, hecha con IA (plataforma_datos/comun/fuentes/catalan/lector.py):
    # opcional, como los vectores.
    catalan = paquete_catalan()
    if catalan is not None:
        construidos["catalan.json"] = catalan
    return construidos


class _RecuperacionIncompleta(ErrorFuente):
    """La promoción falló y no se pudo restaurar todo; el mensaje conserva la ruta del respaldo."""


def entrada_escrita_por_herramienta(nombre: str, carpeta: Path = PAQUETE) -> dict[str, Any] | None:
    """Copia un recurso opcional a otro destino y registra la huella de los bytes de esa copia.

    Args:
        nombre: Nombre de ESCRITOS_POR_HERRAMIENTAS.
        carpeta: Carpeta del paquete que se prepara.

    Returns:
        La entrada de manifiesto, o None con aviso si el recurso no existe.
    """
    origen = PAQUETE / nombre
    if not origen.exists():
        print(
            f"Aviso: falta {relativa(origen)}; recurso opcional de {ESCRITOS_POR_HERRAMIENTAS[nombre]}, "
            "generado por una herramienta específica; consultar la documentación",
            file=sys.stderr,
        )
        return None
    huella = sha256(origen)
    anterior = _entrada_vigente(nombre)
    exigir(
        anterior is not None and anterior.get("sha256") == huella,
        f"{nombre}: falta la procedencia vigente o los bytes han cambiado; admitir con su productor",
        ValidacionFallida,
    )
    assert anterior is not None
    _comprobar_origenes(nombre, anterior)
    if nombre in RECURSOS_FIJADOS:
        _comprobar_captura(nombre, huella)
    destino = carpeta / nombre
    if carpeta != PAQUETE:
        shutil.copyfile(origen, destino)
    exigir(sha256(destino) == huella, f"{nombre}: la copia no conserva su huella", ValidacionFallida)
    return anterior


RECURSOS_FIJADOS = ("vectores-formacion.json", "vectores-oit.json")


def _comprobar_origenes(nombre: str, entrada: dict[str, Any]) -> None:
    """Rechaza entradas vacías, ajenas al producto, autorreferencias y fuentes ausentes o alteradas."""
    origenes = entrada.get("origenes")
    exigir(isinstance(origenes, dict) and bool(origenes), f"{nombre}: procedencia sin orígenes", ValidacionFallida)
    for ruta, esperada in origenes.items():
        exigir(isinstance(ruta, str) and isinstance(esperada, str), f"{nombre}: origen inválido", ValidacionFallida)
        relativa_al_producto = Path(ruta)
        exigir(
            not relativa_al_producto.is_absolute() and ".." not in relativa_al_producto.parts,
            f"{nombre}: origen fuera del producto",
            ValidacionFallida,
        )
        origen = (RAIZ / relativa_al_producto).resolve()
        exigir(
            origen.is_relative_to(RAIZ.resolve()) and origen != (PAQUETE / nombre).resolve(),
            f"{nombre}: origen fuera del producto o autorreferencia",
            ValidacionFallida,
        )
        exigir(
            origen.is_file() and sha256(origen) == esperada,
            f"{nombre}: origen ausente o alterado: {ruta}",
            ValidacionFallida,
        )


def _comprobar_captura(nombre: str, huella: str) -> None:
    """La captura fija los bytes admitidos; no declara regeneración desde el proveedor ni la red."""
    fuentes = RAIZ / "datos/fuentes/recursos-fijados"
    registro = json.loads((fuentes / "registro.json").read_text(encoding="utf-8"))
    exigir(
        isinstance(registro, dict)
        and isinstance(registro.get(nombre), dict)
        and registro[nombre].get("sha256") == huella,
        f"{nombre}: no coincide con la captura admitida",
        ValidacionFallida,
    )
    with zipfile.ZipFile(fuentes / "captura.zip") as captura:
        exigir(
            sha256_bytes(captura.read(nombre)) == huella, f"{nombre}: entrada de la captura alterada", ValidacionFallida
        )


def _entrada_vigente(nombre: str) -> dict[str, Any] | None:
    """La entrada de un nombre en el manifiesto vigente de datos/.

    Args:
        nombre: Nombre de ESCRITOS_POR_HERRAMIENTAS.

    Returns:
        Su entrada tal como está escrita, o None si no hay manifiesto, no se puede leer o no registra ese nombre.
    """
    vigente = PAQUETE / "manifiesto.json"
    if not vigente.exists():
        return None
    try:
        entrada = json.loads(vigente.read_text(encoding="utf-8")).get(nombre)
    except (OSError, ValueError, AttributeError):
        return None
    return entrada if isinstance(entrada, dict) else None


def renombres_por_completar(carpeta: Path, manifiesto: dict[str, Any]) -> list[str]:
    """Los nombres antiguos de SUCESORES que el paquete de `carpeta` publicaba y el nuevo sustituye por su sucesor.

    Un archivo renombrado a propósito deja de publicarse con su nombre antiguo; si siguiera en la carpeta, el paquete
    tendría un archivo que su manifiesto no nombra. Solo se retira si es el archivo que publicaba el paquete: el
    manifiesto vigente de esa misma carpeta lo nombra y sus bytes tienen la huella que ese manifiesto registra. Si no,
    el archivo es ajeno y no se toca: así ocurre con la tabla privada de la Cambra (`tabla_privada`), que lleva el
    nombre antiguo en las instalaciones cuyo manifiesto ya publica el sucesor, y también si alguien restaura a mano un
    manifiesto antiguo junto a la tabla privada.

    Args:
        carpeta: Carpeta del paquete, todavía con su manifiesto vigente.
        manifiesto: El manifiesto nuevo.

    Returns:
        Los nombres antiguos que hay que retirar con la exportación.
    """
    vigente = _manifiesto_vigente(carpeta)
    return [
        antiguo
        for antiguo, sucesor in SUCESORES.items()
        if antiguo not in manifiesto
        and sucesor in manifiesto
        and _es_el_publicado(carpeta / antiguo, vigente.get(antiguo))
    ]


def _manifiesto_vigente(carpeta: Path) -> dict[str, Any]:
    """El manifiesto vigente de una carpeta.

    Returns:
        Sus entradas por nombre; ninguna si no hay manifiesto o no se puede leer.
    """
    try:
        vigente = json.loads((carpeta / "manifiesto.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return vigente if isinstance(vigente, dict) else {}


def _es_el_publicado(ruta: Path, entrada: object) -> bool:
    """Si un archivo es el que registra una entrada del manifiesto: propio y con su misma huella.

    Returns:
        Verdadero solo si la entrada existe y los bytes del archivo tienen su huella.
    """
    return (
        isinstance(entrada, dict) and ruta.is_file() and not ruta.is_symlink() and sha256(ruta) == entrada.get("sha256")
    )


def _restaurar(carpeta: Path, respaldo: Path, afectados: list[str]) -> None:
    """Restaura únicamente los nombres intentados, conservando las copias de respaldo."""
    for nombre in reversed(afectados):
        anterior = respaldo / nombre
        if anterior.exists():
            shutil.copyfile(anterior, carpeta / nombre)
        else:
            (carpeta / nombre).unlink(missing_ok=True)


def _promover(carpeta: Path, nuevo: Path, respaldo: Path, nombres: list[str], obsoletos: list[str]) -> None:
    """Respalda antes de sustituir; ante un fallo restaura o informa de dónde recuperar.

    Raises:
        _RecuperacionIncompleta: Si la restauración falla también; conserva la excepción original como causa.
    """
    for nombre in (*nombres, *obsoletos):
        anterior = carpeta / nombre
        if anterior.exists():
            shutil.copyfile(anterior, respaldo / nombre)
    afectados: list[str] = []
    try:
        for nombre in nombres:
            afectados.append(nombre)
            (nuevo / nombre).replace(carpeta / nombre)
        for nombre in obsoletos:
            afectados.append(nombre)
            (carpeta / nombre).unlink(missing_ok=True)
    except BaseException as error:
        # Se captura también una interrupción solo para intentar recuperar y relanzar; nunca para continuar.
        try:
            _restaurar(carpeta, respaldo, afectados)
        except BaseException as recuperacion:
            raise _RecuperacionIncompleta(
                f"Exportación fallida: {error}; restauración incompleta: {recuperacion}; respaldo: {respaldo}"
            ) from error
        raise


def _limpiar_tras_error(temporal: Path, error: BaseException) -> None:
    """Retira el temporal sin ocultar el error de exportación si también falla la limpieza."""
    try:
        shutil.rmtree(temporal)
    except OSError as limpieza:
        aviso = f"No se pudo retirar el temporal {temporal}: {limpieza}"
        error.add_note(aviso)
        print(aviso, file=sys.stderr)


def exportar(carpeta: Path = PAQUETE, *, completar_renombres: bool = False) -> dict[str, Any]:
    """Prepara todo, respalda y sustituye solo archivos gestionados, con recuperación ante excepciones observadas.

    Args:
        carpeta: Carpeta del paquete; ningún archivo ajeno se elimina.
        completar_renombres: Retirar también el nombre antiguo de cada renombre (`renombres_por_completar`); solo en
            el ciclo operativo.

    Returns:
        El manifiesto completo escrito, con las huellas de salidas y sus orígenes.

    Raises:
        _RecuperacionIncompleta: Si falla la recuperación; el respaldo queda disponible en la ruta indicada.
    """
    # Los cursos del SOC, del Consorci y de Citilab que retira la regla activa de su fuente no se publican.
    construidos = {nombre: sin_las_retiradas(RAIZ, nombre, paquete) for nombre, paquete in paquetes().items()}
    carpeta.parent.mkdir(parents=True, exist_ok=True)
    temporal = Path(tempfile.mkdtemp(dir=carpeta.parent, prefix=f".{carpeta.name}-exportando-"))
    nuevo, respaldo = temporal / "nuevo", temporal / "respaldo"
    try:
        nuevo.mkdir()
        respaldo.mkdir()
        manifiesto = {
            nombre: escribir(nombre, paquete, nuevo, formato="compacto" if nombre in COMPACTOS else "sangrado")
            for nombre, paquete in construidos.items()
        }
        for nombre in ESCRITOS_POR_HERRAMIENTAS:
            entrada = entrada_escrita_por_herramienta(nombre, nuevo)
            if entrada is not None:
                manifiesto[nombre] = entrada
        if ENLACES_COMPROBADOS not in manifiesto:
            conservada = enlaces_publicados(nuevo)
            if conservada is not None:
                manifiesto[ENLACES_COMPROBADOS] = conservada
        exportar_lecturas(nuevo / "lecturas.json")
        exportar_observaciones_lecturas(nuevo / "observaciones-lecturas.json")
        guardar_json(nuevo / "manifiesto.json", manifiesto)
        obsoletos = [
            nombre
            for nombre in (
                *(f"{fuente}.json" for fuente in PREPARADOS_SIN_USO),
                "catalan.json",
                *ESCRITOS_POR_HERRAMIENTAS,
                ENLACES_COMPROBADOS,
            )
            if nombre not in manifiesto
        ] + (renombres_por_completar(carpeta, manifiesto) if completar_renombres else [])
        carpeta.mkdir(exist_ok=True)
        _promover(
            carpeta,
            nuevo,
            respaldo,
            [*manifiesto, "lecturas.json", "observaciones-lecturas.json", "manifiesto.json"],
            obsoletos,
        )
    except _RecuperacionIncompleta:
        # No se borra el temporal: contiene la última copia recuperable de los archivos anteriores.
        raise
    except BaseException as error:
        _limpiar_tras_error(temporal, error)
        raise
    else:
        shutil.rmtree(temporal)
        return manifiesto


def exportar_y_contar(carpeta: Path = PAQUETE, *, completar_renombres: bool = False) -> None:
    """Exporta el paquete y muestra el tamaño de cada archivo registrado."""
    for nombre in exportar(carpeta, completar_renombres=completar_renombres):
        print(nombre, (carpeta / nombre).stat().st_size, "bytes")


def main(argv: list[str] | None = None) -> int:
    """Interfaz local de exportación, con errores legibles y sin red.

    Returns:
        0 si exporta, 1 si falla una entrada o una operación del disco.
    """
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("--destino", type=Path, default=PAQUETE, help="carpeta del paquete (datos/)")
    analizador.add_argument(
        "--completar-renombres",
        action="store_true",
        help="retirar el nombre antiguo de cada archivo renombrado; solo lo pasa el ciclo operativo",
    )
    argumentos = analizador.parse_args(argv)
    return con_motivo(
        lambda: exportar_y_contar(argumentos.destino, completar_renombres=argumentos.completar_renombres),
        linea_de_fallo=True,
    )


if __name__ == "__main__":
    sys.exit(main())
