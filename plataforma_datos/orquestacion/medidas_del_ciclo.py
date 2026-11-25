"""Lo que tardan de verdad las partes del ciclo, para decidir los plazos con medidas.

Las fuentes salen del diario privado del último ciclo real completo de producción (las líneas `motor` de inicio y el
fin de la última etapa de fuente). El paquete sale de su medida en el Mac con el código vigente
(`medir_paquete`), parte por parte, llevada al runner de GitHub más lento medido con el factor de cada tipo de
trabajo. Las fuentes esperan sobre todo a la red (las pausas por dominio), así que su tiempo apenas depende del runner;
el paquete es cálculo. Se actualizan a mano con cada medida que tarde más. Dos guardias derivan los plazos de estas
cifras con el mismo margen: `pruebas/test_plazo_del_motor.py` fija el plazo del motor
(`ejecutor_operativo.PLAZO_CANDIDATO_S`) y `pruebas/herramientas/workflow-presupuesto.test.ts` fija el tope del job
del candidato, que debe cubrir lo que hace el supervisor antes del motor, el motor y lo que hace después.
"""

# Ciclo real 44984285818 del 22/11/2026, acción comprobar-programada, revisión 40451384: el primero completo.
CICLO_MEDIDO = "44984285818"
# Del inicio del motor (04:26:17,571 UTC) al fin de la última etapa de fuente (06:21:15,756 UTC): las fuentes, 115,0
# minutos.
FUENTES_S = 6_898
# Ciclo 45698389914 del 25/11/2026, del inicio del supervisor (20:49:40,790 UTC) al del motor (21:00:14,143 UTC):
# 633,353 s, redondeados arriba. La descarga de la base ocupó 372,104 s y su restauración 255,650 s.
ANTES_DEL_MOTOR_S = 634
# Margen sobre lo medido, en tanto por ciento, fijado por la coordinación del cierre de la V1. Con un solo ciclo
# completo no hay dispersión que medir, y el ciclo varía: las fuentes tardaron 115 minutos el 22/11 y 85 el 23/11.
MARGEN_POR_CIENTO = 20

# El ensayo integrado del 25/11 sobre la generación y las recepciones del día midió 23,95 minutos al componer Cursos.
# El paquete completo de cc96de82 midió 23,86 para ese mismo paso. Se conserva la mayor medida de composición.
COMPONER_EN_EL_MAC_S = 23.95 * 60
# Las otras fases conservan las medidas del paquete del 23/11/2026 con código 3676ef4d: 42,92 minutos totales,
# 21,06 de composición, 1129,301 s de pruebas de Python, 162 s de Node y el resto para ensamblado y construcción.
PRUEBAS_PYTHON_EN_EL_MAC_S = 1_129.301
PRUEBAS_NODE_EN_EL_MAC_S = 162
RESTO_EN_EL_MAC_S = 20.299
PAQUETE_EN_EL_MAC_S = COMPONER_EN_EL_MAC_S + PRUEBAS_PYTHON_EN_EL_MAC_S + PRUEBAS_NODE_EN_EL_MAC_S + RESTO_EN_EL_MAC_S

# Cuánto más lento es el runner que el Mac, por tipo de trabajo, con la misma batería en las dos máquinas: la
# verificación del Mac del código 3676ef4d (Python 826,468 s en dos procesos; unidad de Node 259,799 s) frente a las
# calidades de GitHub 45080492072 (22/11, runner normal: Python 1.089,989 s; unidad 582,351 s) y 45114904107 (23/11,
# runner lento: unidad 892,481 s; no llegó a las pruebas de Python).
PYTHON_EN_EL_RUNNER_NORMAL = 1_089.989 / 826.468
NODE_EN_EL_RUNNER_LENTO = 892.481 / 259.799
# Cuánto más lento fue el runner lento que el normal: mediana de 1,54 en los 218 archivos de unidad que tardaron más
# de 0,5 s en esas dos calidades. Es la misma medida que `scripts/plazos-de-las-suites.ts`;
# pruebas/herramientas/workflow-presupuesto.test.ts exige que las dos coincidan.
VARIACION_DEL_RUNNER = 1.54
# La calidad lenta no tiene medida de Python, así que se lleva la del runner normal al lento con esa variación.
PYTHON_EN_EL_RUNNER_LENTO = PYTHON_EN_EL_RUNNER_NORMAL * VARIACION_DEL_RUNNER

# El paquete en el runner lento, parte por parte: Python × 2,03 y Node × 3,44. Lo demás mezcla Python, Node y disco,
# y se cuenta con el factor mayor. Son 5.838 segundos (97,3 minutos).
PYTHON_DEL_PAQUETE_EN_EL_MAC_S = COMPONER_EN_EL_MAC_S + PRUEBAS_PYTHON_EN_EL_MAC_S
NODE_Y_RESTO_DEL_PAQUETE_EN_EL_MAC_S = PRUEBAS_NODE_EN_EL_MAC_S + RESTO_EN_EL_MAC_S
PAQUETE_EN_EL_RUNNER_LENTO_S = (
    PYTHON_DEL_PAQUETE_EN_EL_MAC_S * PYTHON_EN_EL_RUNNER_LENTO
    + NODE_Y_RESTO_DEL_PAQUETE_EN_EL_MAC_S * NODE_EN_EL_RUNNER_LENTO
)
