"""Vincula consultas observadas con módulos admitidos; reconstruir una copia nunca renueva su consulta remota."""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.cobertura import comprobada as enlaces_comprobados
from plataforma_datos.comun.entrada_salida import entradas_procedencia, leer_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado, ValidacionFallida
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.cursos.cobertura_catalogo import comprobada as catalogo_comprobado
from plataforma_datos.cursos.fuentes.acreditacion.cobertura import comprobada as acreditacion_comprobada
from plataforma_datos.cursos.fuentes.actic.cobertura import comprobada as actic_comprobada
from plataforma_datos.cursos.fuentes.citilab.cobertura import comprobada as citilab_comprobada
from plataforma_datos.cursos.fuentes.consorci.cobertura import comprobada as consorci_comprobada
from plataforma_datos.cursos.fuentes.enlaces.cobertura import comprobada as enlaces_de_la_formacion_comprobados
from plataforma_datos.cursos.fuentes.formacion.constantes import PATRON_CURSOS
from plataforma_datos.cursos.fuentes.formacion.lector import MAX_OFERTA_SOC_BYTES, URL_OFERTA_SOC
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion import pasos_del_ciclo
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.cobertura_derechos import comprobada as derechos_comprobados
from plataforma_datos.orquestacion.cobertura_ediciones import comprobada as edicion_comprobada
from plataforma_datos.orquestacion.cobertura_empresas import comprobada as empresas_comprobada
from plataforma_datos.orquestacion.cobertura_referencias import comprobada as referencia_comprobada
from plataforma_datos.orquestacion.cobertura_series import comprobada as serie_comprobada
from plataforma_datos.orquestacion.cobertura_visor import comprobada as visor_comprobado
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente, intento_de_fuente
from plataforma_datos.orquestacion.estado_de_la_actualizacion import VERDE, ResultadoDelModulo
from plataforma_datos.orquestacion.modulos import MODULOS, Modulo
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import (
    CONJUNTOS,
    Plan,
    dias_hasta_consultar,
    planificar,
)

COBERTURAS_COMPLETAS = {
    "hp_life": catalogo_comprobado,
    "cibervoluntarios": catalogo_comprobado,
    "claude_academy": catalogo_comprobado,
    "enlaces_lecturas": enlaces_comprobados,
    # Acredita el turno que consultó el ciclo; el resto de los enlaces espera a los siguientes, por diseño.
    "enlaces": enlaces_de_la_formacion_comprobados,
    "consorci": consorci_comprobada,
    "citilab": citilab_comprobada,
    "mundo_eurostat": serie_comprobada,
    "ue_eurostat": serie_comprobada,
    "ilostat": serie_comprobada,
    "ocupados": serie_comprobada,
    "empresas": empresas_comprobada,
    "cataluna": visor_comprobado,
    "observatori": visor_comprobado,
    "tich": edicion_comprobada,
    "tic_llars": edicion_comprobada,
    "salarios": edicion_comprobada,
    "nombres": edicion_comprobada,
    "ia_nacional_gbr": edicion_comprobada,
    "ia_nacional_bra": edicion_comprobada,
    # Consultar la referencia identificada no acredita una edición sucesora ni retira su revisión.
    "oit": referencia_comprobada,
    "clasificaciones": referencia_comprobada,
    "idescat": referencia_comprobada,
    "territorios": referencia_comprobada,
    "decada_digital": referencia_comprobada,
    # Completa se refiere a los recursos declarados; estos tres alcances conservan su revisión en el plan.
    "acreditacion": acreditacion_comprobada,
    "derechos": derechos_comprobados,
    "actic": actic_comprobada,
}

# Fuentes cuya consulta, aun completa, no puede acreditar la fuente entera; el motivo es un código cerrado del panel.
# Su consulta completa queda «completa»: ni incidencia ni comprobación del conjunto.
COBERTURAS_LIMITADAS = {
    # El censo de Cibernàrium y el de su ámbito de IA se renuevan; el catálogo ocupacional conserva su fecha.
    "barcelonactiva": "censo-con-copias-fijadas",
    # Los índices públicos no son un censo completo: una ausencia no prueba una baja. Las ediciones se renuevan
    # desde las fichas que descubre el índice de formación subvencionada.
    "fundae": "indices-sin-censo",
}
# Señal propia de consulta sin unidades caídas en el último conjunto admitido de cada fuente de cobertura limitada.
CONSULTA_SIN_CAIDAS = {
    "barcelonactiva": lambda admitido: admitido.get("censo_completo") is True,
    "fundae": lambda admitido: admitido.get("fallos") == [],
}

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from plataforma_datos.orquestacion.actualizar import Ejecutor, Resultado


def _empresas_requiere_revalidacion(raiz: Path) -> bool:
    """Una admisión contractual ausente o antigua requiere recomposición, no una descarga nueva.

    Returns:
        True si el guardián común rechaza la admisión conservada de empresas.
    """
    informe = raiz / DATOS_RELATIVOS / "validados/empresas/validacion.json"
    if not informe.exists():
        return False
    try:
        exigir_admitido("empresas", ruta=informe)
    except (OSError, ValueError, FormatoInesperado, ValidacionFallida):
        return True
    return False


def plan_desde_registro(raiz: Path, ahora: datetime, *, forzar: bool = False) -> Plan:
    """Selecciona consultas y recompone todos los módulos a demanda o tras una interrupción.

    La búsqueda manual conserva la reconstrucción completa, también de entradas locales: el código
    de sus preparadores puede haber cambiado sin que se hayan publicado datos oficiales nuevos.
    Una ejecución programada solo recompone su selección y los consumidores que cambien.

    Tras un intento remoto fallido o cortado, la fuente se reintenta con espera escalonada y nunca más tarde que su
    cadencia; sus fallos no cuentan para otras fuentes.

    Returns:
        Plan basado en intentos reales registrados; nunca en el verde de una validación local.
    """
    documento = registro.leer_registro(raiz)
    intentos = {
        conjunto: datetime.fromisoformat(fila["ultimo_intento_remoto_utc"])
        for fila in documento["fuentes"].values()
        if fila["ultimo_intento_remoto_utc"] is not None
        for conjunto in fila["conjuntos"]
    }
    fallos = {
        conjunto: registro.fallos_remotos_seguidos(documento, fuente)
        for fuente, fila in documento["fuentes"].items()
        if fila["ultimo_intento_remoto_utc"] is not None
        for conjunto in fila["conjuntos"]
    }
    recomponer = (
        tuple(modulo.id for modulo in MODULOS)
        if forzar or documento["reconstruccion_pendiente"]
        else (("empresas",) if _empresas_requiere_revalidacion(raiz) else ())
    )
    return planificar(ahora, intentos, forzar=forzar, recomponer=recomponer, fallos_seguidos=fallos)


def proxima_consulta(documento: dict, fuente: str) -> date | None:
    """Fecha UTC desde la que el plan vuelve a permitir descargar la fuente, con la misma regla que planificar.

    Returns:
        None si la fuente no tiene intento remoto registrado (ya consultable) o no descarga.
    """
    fila = documento["fuentes"].get(fuente)
    if fila is None or fila["ultimo_intento_remoto_utc"] is None:
        return None
    fallos = registro.fallos_remotos_seguidos(documento, fuente)
    dias = [dias_hasta_consultar(c, fallos) for c in CONJUNTOS if c.fuente == fuente and c.operacion == "descargar"]
    if not dias:
        return None
    return datetime.fromisoformat(fila["ultimo_intento_remoto_utc"]).date() + timedelta(days=min(dias))


def _recuento_parcial(fuente: str, admitido: dict) -> dict | None:
    """Cuenta las unidades de consulta sin respuesta: lo que se pidió, no lo que dejó de verse.

    Cibernàrium pide páginas del censo y FUNDAE pide índices; una actividad conocida que no aparece no es una
    unidad sin respuesta. Las demás fuentes piden una URL por unidad.

    Returns:
        {"unidades_fallidas": n, "unidades_esperadas": N} o None si el conjunto no declara consulta parcial.

    Raises:
        FormatoInesperado: Si la marca no tiene la forma declarada por su fuente.
    """
    marca = admitido.get("consulta_parcial")
    if marca is None:
        return None
    if type(marca) is not dict:
        raise FormatoInesperado(f"{fuente}: consulta parcial no válida")
    if fuente == "barcelonactiva":
        campos = {"unidades_fallidas", "unidades_esperadas", "paginas_fallidas", "paginas_esperadas"}
        fallidas, esperadas = marca.get("paginas_fallidas"), marca.get("paginas_esperadas")
    elif fuente == "fundae":
        campos = {"canales_fallidos", "unidades_fallidas", "unidades_esperadas"}
        fallidas, respondidos = marca.get("canales_fallidos"), admitido.get("cobertura")
        esperadas = len(fallidas) + len(respondidos) if type(fallidas) is list and type(respondidos) is dict else None
    else:
        campos = {"unidades_fallidas", "unidades_esperadas"}
        fallidas, esperadas = marca.get("unidades_fallidas"), marca.get("unidades_esperadas")
    if (
        set(marca) != campos
        or type(fallidas) is not list
        or type(esperadas) is not int
        or not 0 < len(fallidas) <= esperadas
    ):
        raise FormatoInesperado(f"{fuente}: consulta parcial no válida")
    return {"unidades_fallidas": len(fallidas), "unidades_esperadas": esperadas}


def consulta_parcial(raiz: Path, fuente: str) -> dict | None:
    """Recuentos de la consulta parcial que conserva el último conjunto admitido de un catálogo de cursos.

    Returns:
        {"unidades_fallidas": n, "unidades_esperadas": N} o None si la fuente no la declara o la consulta fue completa.

    Raises:
        FormatoInesperado: Si la marca del conjunto admitido no tiene la forma declarada.
    """
    if fuente not in operacion_fuente.FUENTES:
        return None
    admitido = operacion_fuente.leer_validado(fuente, raiz)
    return None if admitido is None else _recuento_parcial(fuente, admitido)


def _consulta_completa_limitada(raiz: Path, fuente: str) -> bool:
    """Una fuente de cobertura limitada terminó su consulta sin unidades caídas en el conjunto admitido.

    Returns:
        False si la fuente no es de cobertura limitada, si no hay conjunto admitido o si declara consulta parcial.
    """
    sin_caidas = CONSULTA_SIN_CAIDAS.get(fuente)
    if sin_caidas is None:
        return False
    admitido = operacion_fuente.leer_validado(fuente, raiz)
    return admitido is not None and _recuento_parcial(fuente, admitido) is None and sin_caidas(admitido)


def reintentos_remotos_vencidos(raiz: Path, ahora: datetime) -> tuple[str, ...]:
    """Fuentes cuyo último intento remoto falló o se cortó y cuyo reintento escalonado ya ha llegado.

    Completa `actualizar --pendientes`: un corte no llega a escribir estado.json, pero sí deja su intento aquí.

    Returns:
        IDs de fuente (iguales a su módulo) en el orden del registro de módulos.
    """
    documento = registro.leer_registro(raiz)
    vencidas = []
    for modulo in MODULOS:
        for fuente in modulo.fuentes:
            fila = documento["fuentes"].get(fuente)
            fallos = registro.fallos_remotos_seguidos(documento, fuente)
            if fila is None or fila["ultimo_intento_remoto_utc"] is None or not fallos:
                continue
            dias = (ahora.date() - datetime.fromisoformat(fila["ultimo_intento_remoto_utc"]).date()).days
            conjuntos = [c for c in CONJUNTOS if c.fuente == fuente and c.operacion == "descargar"]
            if any(dias >= dias_hasta_consultar(conjunto, fallos) for conjunto in conjuntos):
                vencidas.append(modulo.id)
                break
    return tuple(vencidas)


def _oferta_soc_comprobada(raiz: Path, evidencia: dict) -> bool:
    """Exige el recurso de oferta completo y los mismos bytes en el original admitido.

    Returns:
        True solo para la oferta; los catálogos locales de formación no reciben esta comprobación.
    """
    peticiones = evidencia["peticiones"]
    if len(peticiones) != 1 or not _es_oferta_soc(peticiones[0]):
        return False
    peticion = peticiones[0]
    carpeta = raiz / DATOS_RELATIVOS / "originales/formacion"
    procedencia = carpeta / "procedencia.json"
    if not procedencia.is_file():
        return False
    copias = [
        entrada
        for entrada in entradas_procedencia(leer_json(procedencia))
        if re.fullmatch(PATRON_CURSOS, entrada["archivo"])
    ]
    if not copias:
        return False
    ultima = max(copias, key=lambda entrada: entrada["archivo"])
    ruta = carpeta / ultima["archivo"]
    if ruta.is_symlink() or not ruta.is_file() or ruta.stat().st_size > MAX_OFERTA_SOC_BYTES:
        return False
    with ruta.open("rb") as archivo:
        contenido = archivo.read(MAX_OFERTA_SOC_BYTES + 1)
    try:
        # La procedencia conserva segundos enteros; la recepción conserva también sus fracciones.
        comienzo = datetime.fromisoformat(evidencia["comienzo_utc"]).replace(microsecond=0)
        fin = datetime.fromisoformat(evidencia["fin_utc"])
        comprobada = datetime.fromisoformat(ultima.get("comprobado_remoto_utc", ""))
        fecha_coherente = comienzo <= comprobada <= fin
    except (TypeError, ValueError):
        return False
    return (
        0 < len(contenido) <= MAX_OFERTA_SOC_BYTES
        and len(contenido) == peticion["bytes"]
        and hashlib.sha256(contenido).hexdigest() == ultima["sha256"] == peticion["respuesta_sha256"]
        and fecha_coherente
    )


def _es_oferta_soc(peticion: dict) -> bool:
    return (
        peticion["recurso_sha256"] == identidad_recurso(URL_OFERTA_SOC)
        and peticion["url_final_sha256"] == hashlib.sha256(URL_OFERTA_SOC.encode()).hexdigest()
    )


class Seguimiento:
    """Observa etapas del ejecutor y solo confirma una fuente después de admitir su módulo completo."""

    def __init__(self, raiz: Path, ciclo: str, ejecutor: Ejecutor, reloj: Callable[[], datetime]) -> None:
        self.raiz = raiz
        self.ciclo = ciclo
        self.ejecutor = ejecutor
        self.reloj = reloj
        self.etapas: dict[str, dict[str, Resultado]] = {}
        self.remotas: dict[str, bool] = {}
        # Los pasos que no son etapas de fuente dejan su hora real: si el ciclo se corta, se sabe en cuál iba.
        self.pasos = pasos_del_ciclo.observar(raiz, ejecutor, lambda resultado: resultado.codigo)

    def ejecutar(self, orden: Sequence[str], area: Path) -> Resultado:
        """Registra cada intento antes de ejecutar; el resumen de etapa no sustituye su diario técnico.

        Returns:
            El resultado original, sin interpretar su salida de texto como evidencia.
        """
        identificada = etapa_de_fuente(orden)
        if identificada is None:
            return self.pasos(orden, area)
        fuente, etapa = identificada
        if fuente not in self.etapas:
            remota = etapa == "descargar" and FUENTES[fuente].red
            registro.iniciar_fuente(
                self.raiz,
                self.ciclo,
                fuente,
                tuple(conjunto.id for conjunto in CONJUNTOS if conjunto.fuente == fuente),
                self.reloj(),
                remoto=remota,
            )
            self.etapas[fuente] = {}
            self.remotas[fuente] = remota
        with intento_de_fuente(self.raiz, self.ciclo, fuente, etapa) as intento:
            resultado = self.ejecutor(orden, area)
            intento.terminar(resultado.codigo, resultado.evidencia, resultado.salida)
        self.etapas[fuente][etapa] = resultado
        return resultado

    def terminar_modulo(self, modulo: Modulo, resultado: ResultadoDelModulo) -> None:
        """Conserva la consulta aunque falle el paquete posterior; no la confunde con activación."""
        for fuente in modulo.fuentes:
            if fuente in self.etapas:
                self._terminar_fuente(fuente, resultado.veredicto == VERDE)

    def _terminar_fuente(self, fuente: str, admitida: bool) -> None:
        etapas = self.etapas[fuente]
        descarga = etapas.get("descargar")
        evidencia = descarga.evidencia if descarga is not None else None
        comprobados: tuple[str, ...] = ()
        if not admitida or not all(etapa.codigo == 0 for etapa in etapas.values()):
            resultado = "fallo"
        elif not self.remotas[fuente]:
            resultado = "local"
        else:
            resultado = "parcial"
            if set(etapas) == {"descargar", "preparar", "validar"} and evidencia is not None:
                if fuente == "formacion" and _oferta_soc_comprobada(self.raiz, evidencia):
                    comprobados = ("soc-oferta",)
                cobertura = COBERTURAS_COMPLETAS.get(fuente)
                # Una consulta con unidades sin respuesta conserva lo válido, pero nunca acredita la fuente entera.
                if (
                    cobertura is not None
                    and cobertura(self.raiz, evidencia)
                    and not consulta_parcial(self.raiz, fuente)
                ):
                    comprobados = (fuente,)
                    resultado = "comprobada"
                elif evidencia.get("peticiones") and _consulta_completa_limitada(self.raiz, fuente):
                    resultado = "completa"
        registro.terminar_fuente(
            self.raiz,
            self.ciclo,
            fuente,
            self.reloj(),
            resultado=resultado,
            evidencia=evidencia,
            comprobados=comprobados,
        )
