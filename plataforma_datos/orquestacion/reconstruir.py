"""Reconstruye las fuentes del paquete del motor en orden de dependencias y exporta el paquete.

Quedan fuera `contraste` (solo sirve al laboratorio) y `admitidas` (parte de revisiones, no de descargas).

Las estadísticas nacionales conjuntas (`ia_nacional`) y las encuestas de empleo (`encuestas_isco4`) se producen
aparte: sus conjuntos admitidos son entradas externas, no etapas de este registro.

Orden (las dependencias entre fuentes del registro van antes):
  1. esco             independiente
  2. oit              independiente
  3. clasificaciones  contrasta los grupos ISCO-08 con la validación de la OIT
  4. cambra           comprueba sus códigos contra la CNO-11 validada
  5. hechos_informe   registro editorial de afirmaciones del informe; solo contrato/plazo, sin renovar revisión
  6. cataluna         usa la CNO-11 y se contrasta con la Cambra
  7. ocupados         serie del censo (Idescat e INE); se contrasta con la Cambra y con cataluna
  8. censo            Censo 2021 por municipio y perfil del grupo; se contrasta con cataluna y con ocupados
  9. tich             uso de IA generativa por ocupación (TIC-H admitida); pasa a la CNO-11 con las clasificaciones
 10. salarios         salario medio por gran grupo en Cataluña y por subgrupo en España (EES 2022)
 11. formacion        parte de las ocupaciones ESCO validadas
 12. consorci         cursos para personas que trabajan; cuenta cuántos llegan al catálogo del SEPE de formación
 13. agencia          oferta de la Agència FP.CAT y cualificaciones no disponibles; la lee acreditacion
 14. acreditacion     certificados del SOC y su anexo del BOE; relaciona ocupaciones con EURES, la CNO-11 y cataluna
 15. citilab          cursos de Citilab en Cornellà, solo hechos con el enlace a su ficha; independiente
 16. abierta          formación abierta en línea: fichas redactadas por Faro con su criterio; independiente
 17. lecturas         catálogo editorial local de Biblioteca; conserva fechas y no comprueba enlaces
 18. enlaces_lecturas comprobación remota de enlaces de Biblioteca; conserva identidad y fechas por recurso
 19. derechos         citas literales de los derechos de formación y ante la tecnología (BOE); independiente
 20. textos           registra la procedencia de los textos de tareas y los contrasta con las tareas de la OIT
 21. idescat          nombres oficiales en catalán de los grupos (CIUO-2008 y CCO-2011); contrasta con clasificaciones
 22. catalan          solo validar (sin IA): la traducción frente al castellano y al Idescat; la lee nombres
 23. nombres          nombres y apellidos del INE; marca los que son también un oficio con las ocupaciones ESCO
 24. sectores         sectores de actividad de cada grupo (Censo 2021); se contrasta con cataluna
 25. empresas         uso de la IA en las empresas por sector (ETICCE y Eurostat); cruza con sectores
 26. observatori      contratación y demanda por comarca y en series; lee la copia vigente de cataluna
 27. necesidades      necesidades formativas por ocupación del SEPE; comprueba sus códigos contra la CNO-11 validada
 28. perfiles         certificados que el SEPE relaciona con cada ocupación; usa acreditacion y cataluna
 29. certificados2016 certificados que el SEPE relacionó con cada ocupación en 2016; usa acreditacion y perfiles
 30. actic            acreditación oficial de competencias digitales (ACTIC) del DOGC y su portal; independiente
 31. barcelonactiva   fichas del Catàleg d'ocupacions y formaciones de IA del Cibernàrium (enlaces); usa catalan
 32. fundae           ediciones en teleformación de FUNDAE (copia a mano, sin contactos); independiente
 33. memoria          escala del servei d'acreditació (Memòria del Sistema FPCAT 2025); independiente
 34. hp_life          fichas de identidades conocidas, recepción y control propios; composición HP en el paquete común
 35. cibervoluntarios canales conocidos del catálogo público; recepción y control sin inferir ofertas o censo completo
 36. claude_academy   fichas conocidas de Academy; recepción y control sin confirmar acceso a lecciones
 37. territorios      nombres de los países en castellano y en catalán y sus códigos ISO (Unicode CLDR); independiente
 38. mundo_eurostat   IA en empresas y personas por país europeo (Eurostat); se contrasta con tich y empresas
 39. ilostat          empleo por gran grupo ISCO-08 en cada país (OIT); usa territorios; contrasta con mundo_eurostat
 40. tic_llars        la IA generativa en Cataluña, base usuarios de internet (Idescat, TIC-H del INE); usa tich
 41. clima_empresarial  la IA y las competencias en los establecimientos de Cataluña (Idescat); independiente
 42. ue_eurostat      la UE-27 en conjunto: IA, capacidades digitales y especialistas en TIC (Eurostat); independiente
 43. decada_digital   texto literal de las metas para 2030 (Decisión (UE) 2022/2481, art. 4); independiente
 44. eurobarometro    opinión: Eurobarómetro especial 554 (QB5 y QB6.1), UE-27, ES, DE, FR, IT; independiente
 45. ceo_panel        opinión de Cataluña: Panel Ciutadà del CEO 2025, pregunta 26 (microdatos); independiente
 46. ia_nacional_isl  empresas que usan IA en Islandia (Statistics Iceland, STI03266), medida nacional; independiente
 47. ia_nacional_gbr  empresas de 10 o más que usan IA en el Reino Unido (ONS, BICS), medida nacional; independiente
 48. ia_nacional_bra  empresas de 10 o más que usan IA en Brasil (Cetic.br, TIC Empresas, H9), un mínimo; independiente
 49. ia_nacional_che  empresas de 5 o más que usan IA en Suiza (BFS, encuesta de innovación del KOF); independiente
 50. ia_nacional_isr  empresas de 10 o más asalariados que usan IA en Israel (CBS, junio de 2025); independiente
 51. ia_nacional_kor  personas que han usado alguna vez IA generativa en Corea del Sur (MSIT); independiente
 52. epa              personas ocupadas en Cataluña por gran grupo (INE, EPA, tabla 65314); independiente
 53. eaes             ganancia media anual por grupo de ocupación y sexo en España (INE, EAES 28186); independiente
 54. ofertas          puestos ofertados del SOC y Feina Activa, libro mensual del Observatori del Treball; independiente
 55. enlaces          webs del Consorci, fichas del SOC y programas del SEPE, con su código HTTP; tras consorci
 56. datos_globales   compone datos-globales.json con mundo_eurostat, ue_eurostat, decada_digital, eurobarometro…
 57. plataforma_datos/orquestacion/exportar_paquete.py  exige todas las validaciones anteriores
Por defecto solo ejecuta las etapas locales (preparar y validar), sin red. Con --descargar, ejecuta antes la etapa
descargar de cada fuente: las que tienen descarga automática consultan sus direcciones oficiales; las demás comprueban
sus originales y explican cómo se obtienen. Un original que ya no coincide con su procedencia detiene la descarga: se
revisa la versión nueva y se acepta a propósito ejecutando esa fuente sola con --aceptar-cambio.

Uso: python3 -m plataforma_datos.orquestacion.reconstruir [--descargar] [--sin-paquete]
"""

import argparse
import sys
from types import ModuleType

import plataforma_datos.biblioteca.fuentes.enlaces_lecturas.lector as enlaces_lecturas
import plataforma_datos.biblioteca.fuentes.lecturas.lector as lecturas
import plataforma_datos.comun.fuentes.catalan.lector as catalan
import plataforma_datos.comun.fuentes.idescat.lector as idescat
import plataforma_datos.comun.fuentes.nombres.lector as nombres
import plataforma_datos.comun.fuentes.territorios.lector as territorios
import plataforma_datos.cursos.fuentes.abierta.lector as abierta
import plataforma_datos.cursos.fuentes.acreditacion.lector as acreditacion
import plataforma_datos.cursos.fuentes.actic.lector as actic
import plataforma_datos.cursos.fuentes.agencia.lector as agencia
import plataforma_datos.cursos.fuentes.barcelonactiva.lector as barcelonactiva
import plataforma_datos.cursos.fuentes.certificados2016.lector as certificados2016
import plataforma_datos.cursos.fuentes.cibervoluntarios.lector as cibervoluntarios
import plataforma_datos.cursos.fuentes.citilab.lector as citilab
import plataforma_datos.cursos.fuentes.claude_academy.lector as claude_academy
import plataforma_datos.cursos.fuentes.consorci.lector as consorci
import plataforma_datos.cursos.fuentes.enlaces.lector as enlaces
import plataforma_datos.cursos.fuentes.formacion.lector as formacion
import plataforma_datos.cursos.fuentes.fundae.lector as fundae
import plataforma_datos.cursos.fuentes.hp_life.lector as hp_life
import plataforma_datos.cursos.fuentes.memoria.lector as memoria
import plataforma_datos.derechos.fuentes.derechos.lector as derechos
import plataforma_datos.derivados.fuentes.datos_globales.lector as datos_globales
import plataforma_datos.ia_y_trabajo.fuentes.cambra.lector as cambra
import plataforma_datos.ia_y_trabajo.fuentes.ceo_panel.lector as ceo_panel
import plataforma_datos.ia_y_trabajo.fuentes.clima_empresarial.lector as clima_empresarial
import plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector as decada_digital
import plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector as eurobarometro
import plataforma_datos.ia_y_trabajo.fuentes.hechos_informe.lector as hechos_informe
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector as ia_nacional_bra
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector as ia_nacional_che
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector as ia_nacional_gbr
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector as ia_nacional_isl
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector as ia_nacional_isr
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector as ia_nacional_kor
import plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector as mundo_eurostat
import plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector as tic_llars
import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
import plataforma_datos.ia_y_trabajo.fuentes.ue_eurostat.lector as ue_eurostat
import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
import plataforma_datos.mercado.fuentes.censo.lector as censo
import plataforma_datos.mercado.fuentes.eaes.lector as eaes
import plataforma_datos.mercado.fuentes.empresas.lector as empresas
import plataforma_datos.mercado.fuentes.epa.lector as epa
import plataforma_datos.mercado.fuentes.ilostat.lector as ilostat
import plataforma_datos.mercado.fuentes.necesidades.lector as necesidades
import plataforma_datos.mercado.fuentes.observatori.lector as observatori
import plataforma_datos.mercado.fuentes.ocupados.lector as ocupados
import plataforma_datos.mercado.fuentes.ofertas.lector as ofertas
import plataforma_datos.mercado.fuentes.perfiles.lector as perfiles
import plataforma_datos.mercado.fuentes.salarios.lector as salarios
import plataforma_datos.mercado.fuentes.sectores.lector as sectores
import plataforma_datos.ocupaciones.fuentes.clasificaciones.lector as clasificaciones
import plataforma_datos.ocupaciones.fuentes.esco.lector as esco
import plataforma_datos.ocupaciones.fuentes.oit.lector as oit
import plataforma_datos.ocupaciones.fuentes.textos.lector as textos
from plataforma_datos.comun.nucleo import ETAPAS
from plataforma_datos.orquestacion import exportar_paquete

# Cada fuente con su módulo, en el orden de la cabecera. Las importaciones son estáticas: lo que
# se ejecuta es lo que se lee aquí.
FUENTES_EN_ORDEN: tuple[tuple[str, ModuleType], ...] = (
    ("esco", esco),
    ("oit", oit),
    ("clasificaciones", clasificaciones),
    ("cambra", cambra),
    ("hechos_informe", hechos_informe),
    ("cataluna", cataluna),
    ("ocupados", ocupados),
    ("censo", censo),
    ("tich", tich),
    ("salarios", salarios),
    ("formacion", formacion),
    ("consorci", consorci),
    ("agencia", agencia),
    ("acreditacion", acreditacion),
    ("citilab", citilab),
    ("abierta", abierta),
    ("lecturas", lecturas),
    ("enlaces_lecturas", enlaces_lecturas),
    ("derechos", derechos),
    ("textos", textos),
    ("idescat", idescat),
    ("catalan", catalan),
    ("nombres", nombres),
    ("sectores", sectores),
    ("empresas", empresas),
    ("observatori", observatori),
    ("necesidades", necesidades),
    ("perfiles", perfiles),
    ("certificados2016", certificados2016),
    ("actic", actic),
    ("barcelonactiva", barcelonactiva),
    ("fundae", fundae),
    ("memoria", memoria),
    ("hp_life", hp_life),
    ("cibervoluntarios", cibervoluntarios),
    ("claude_academy", claude_academy),
    ("territorios", territorios),
    ("mundo_eurostat", mundo_eurostat),
    ("ilostat", ilostat),
    ("tic_llars", tic_llars),
    ("clima_empresarial", clima_empresarial),
    ("ue_eurostat", ue_eurostat),
    ("decada_digital", decada_digital),
    ("eurobarometro", eurobarometro),
    ("ceo_panel", ceo_panel),
    ("ia_nacional_isl", ia_nacional_isl),
    ("ia_nacional_gbr", ia_nacional_gbr),
    ("ia_nacional_bra", ia_nacional_bra),
    ("ia_nacional_che", ia_nacional_che),
    ("ia_nacional_isr", ia_nacional_isr),
    ("ia_nacional_kor", ia_nacional_kor),
    ("epa", epa),
    ("eaes", eaes),
    ("ofertas", ofertas),
    ("enlaces", enlaces),
    ("datos_globales", datos_globales),
)
ORDEN = tuple(nombre for nombre, _ in FUENTES_EN_ORDEN)
# Fuentes que la reconstrucción solo valida, con el motivo: no se descargan ni se preparan aquí.
SOLO_VALIDAR = {
    "hechos_informe": "registro editorial en git; validar comprueba contrato y plazo, sin renovar su revisión",
    "catalan": (
        "las traducciones se preparan y revisan por separado con "
        "plataforma_datos.comun.fuentes.catalan.lector; aquí solo se comprueban"
    ),
}


def exportador() -> ModuleType:
    """El exportador del paquete del motor (exportar_paquete.py); lo usan también las pruebas.

    Returns:
        El módulo exportador.
    """
    return exportar_paquete


def etapas(descargar: bool, fuente: str = "") -> tuple[str, ...]:
    """Etapas que se ejecutan en una fuente; las de SOLO_VALIDAR, solo la validación.

    Returns:
        Los nombres de las etapas, en su orden.
    """
    if fuente in SOLO_VALIDAR:
        return ETAPAS[-1:]
    return ETAPAS if descargar else ETAPAS[1:]


def reconstruir(descargar: bool = False, paquete: bool = True) -> int:
    """Ejecuta la cadena completa; se detiene en la primera fuente que falle y devuelve su código de salida.

    Returns:
        El código de salida: 0 si todas las fuentes terminan bien; si no, el de la que falla.
    """
    for nombre, fuente in FUENTES_EN_ORDEN:
        for etapa in etapas(descargar, nombre):
            print(f"\n== {nombre} · {etapa}", flush=True)
            codigo = fuente.main([etapa])
            if codigo:
                print(f"Reconstrucción detenida en {nombre} · {etapa}.", file=sys.stderr)
                return codigo
    if not paquete:
        return 0
    print("\n== paquete del motor", flush=True)
    return exportador().main([])


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes del orquestador.

    Returns:
        El código de salida del proceso.
    """
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("--descargar", action="store_true", help="descargar antes de preparar (necesita red)")
    analizador.add_argument("--sin-paquete", action="store_true", help="no exportar el paquete del motor al final")
    opciones = analizador.parse_args(argv)
    return reconstruir(descargar=opciones.descargar, paquete=not opciones.sin_paquete)


if __name__ == "__main__":
    sys.exit(main())
