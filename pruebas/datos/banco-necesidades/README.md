# Banco inicial de necesidades por persona

20 perfiles sintéticos, en 10 pares controlados, sobre la base `edef33e`. Es material de desarrollo y revisión: no mide aún el selector, no contiene etiquetas nuevas de utilidad y no acredita precisión. No modifica el banco de 240 personas ni exige incorporar funcionalidades para completar casos propuestos.

| Par | Anclaje | Única variación |
| --- | --- | --- |
| n01 | oficina-ia | Conocimiento actual de IA inicial / avanzado (supuesto sintético) |
| n02 | oficina-cuesta | Dominio de facturación: cuesta / domino |
| n03 | cocina-cuesta | Tarea objetivo: coordinar equipo / higiene |
| n04 | cocina-ia | Objetivo: IA / mejorar |
| n05 | enfermeria-paro | Situación: paro / trabaja |
| n06 | electricidad-cuesta | Modalidad: presencial / en línea |
| n07 | c022-p2 y c022-p3 | Territorio: Tarragona / Girona |
| n08 | c018-p1 y c018-p4 | Horas semanales: 2 / 5 |
| n09 | electricidad-ia | Conocimiento actual de IA avanzado / no lo sé (supuesto sintético) |
| n10 | oficina-paro | Situación: paro / no lo sé |

`personas.json` guarda entradas y referencias a expectativas; `contrato.json` define los campos, condiciones y evidencia necesaria. `anclajes.json` conserva solo los doce registros sintéticos utilizados, con su procedencia. No contiene los pares ni las claves del etiquetado ciego. `procedencia.json` registra las huellas de doce archivos del catálogo con el que se revisó el banco (incluido Citilab) y fija las de los perfiles, el contrato y los archivos de origen, separando fuentes del producto y originales externos. `procedencia.json.intervenciones` distingue la proyección histórica de los supuestos sintéticos de conocimiento actual. La prueba no depende de carpetas externas de trabajo: comprueba su instantánea incorporada y las referencias ESCO/OIT de los datos vigentes.

Los contrafactuales se construyen después de proyectar el anclaje al contrato. En n02 y n10 se neutralizan previamente descripciones que delataban el dominio o el empleo que varía; ambos miembros conservan exactamente esa misma descripción. No se infiere nivel de IA o dominio por tarea a partir del nivel genérico del banco 240. En n07, las comarcas son las de las capitales provinciales: es una hipótesis del banco, no una residencia publicada.

## Núcleo y ampliaciones

El núcleo del contrato de necesidades es tarea objetivo, dominio por tarea, niveles de IA actual y deseado separados, objetivo y acceso declarado (incluidos los valores desconocidos). En la proyección del anclaje histórico el conocimiento actual no está acreditado. Para n01 y n09 se declara explícitamente como intervención sintética: inicial/avanzado y avanzado/null, respectivamente. El deseo queda null en ambos miembros de esos pares. Estos supuestos de diseño no se recuperan ni se infieren del anclaje o del anexo, y no asignan etiquetas de utilidad. En los demás anclajes, el nivel elegido/pedido histórico se conserva como deseado, sin acreditar el actual. Algunos campos aún pueden no estar soportados por el selector de la base: una futura medición debe publicar cuáles consume realmente. Un campo descartado no se presenta como personalización ensayada. Esta prueba comprueba el banco, no fuerza resultados del motor actual ni implementa el selector.

Destino profesional y CAP/acreditación están fuera de los veinte casos. Sus datos históricos pueden aparecer en la instantánea de procedencia, pero no en las entradas ni en expectativas que obliguen a desarrollar esa funcionalidad. Incorporarlos requiere acordar el contrato y sus fuentes. No hay cuotas mínimas de tres IA o una ciberseguridad, ni obligación de llenar hojas o de producir ids distintos para perfiles diferentes.

## Uso y mantenimiento

Control pequeño, sin modelos ni escritura en el producto: `node --test pruebas/formacion/banco-necesidades.test.ts`. Las comprobaciones están en `pruebas/ayudas/banco-necesidades.ts` y se aplican al producto y a copias alteradas. Comprueban identidad de perfiles y pares, diferencia exclusiva del campo declarado, ocupaciones ESCO con su código ISCO-08 y tareas OIT de los datos vigentes, reglas del contrato, anclajes y huellas de la referencia histórica. No ejecutan recomendaciones ni valoran su utilidad.

La referencia histórica (el propio `procedencia.json`, cuya huella fija la prueba, más perfiles, contrato, instantánea de anclajes y banco 240) no cambia sin revisar el banco y registrar la revisión. No actualizar huellas ni cifras para mantener verde. La instantánea debe conservarse o sustituirse explícitamente con trazabilidad; no hay regeneración silenciosa de expectativas.

Las etiquetas antiguas son material pendiente de revisión, no expectativas heredadas. El banco 240 es ocupación|curso. Veinte-perfiles sí tiene persona|curso, pero su anexo antiguo incluye la cuota de tres IA y reglas que deben revisarse. Los identificadores PA/PB/PC no prueban que fueran personas; no constan sus modelos en lo revisado ni está acreditada su independencia respecto del entrenamiento o del juez productivo.

La rúbrica y las mediciones propuestas están en `RUBRICA.md`. Las metas de entrega y cobertura las fija la coordinación después de revisar la rúbrica y antes de ajustar el ranking. Este banco no fija un porcentaje de aprobación.

### Revisión explícita del catálogo · 22/10/2026

La versión 2 de `procedencia.json` incorpora el paquete `e89d976`: hechos de 45 fichas de Cibernàrium (44 vinculadas y una pendiente), con horas, modalidad, sesiones, ventana de acceso, inscripción, plazas y procedencia. Solo cambian `barcelonactiva.json` y el manifiesto. La instantánea anterior y ambas huellas por archivo se conservan en `revisionesCatalogo`; los perfiles, la rúbrica y las expectativas no cambian. Hay que medir de nuevo selección, acceso y calendario. Las etiquetas de contenido del piloto conservan sus propias fichas y no prueban acceso con este catálogo.

### Catálogo histórico y datos vigentes · 25/10/2026

La versión 3 de `procedencia.json` separa la integridad de la referencia histórica de la validación con los datos vigentes. Las huellas de `catalogo` y `revisionesCatalogo` se conservan sin cambios como procedencia: documentan el catálogo con el que se revisó y midió el banco, y la prueba ya no exige que el catálogo publicado coincida con ellas. Así una actualización de cursos se publica sin tocar perfiles ni expectativas. Las mediciones hechas con ese catálogo no se atribuyen al catálogo nuevo: medir con otro catálogo es una medición nueva que debe registrarse. La prueba demuestra con copias que una actualización válida de cursos pasa, que una ocupación o tarea inválida se detecta y que alterar la referencia protegida hace fallar su comprobación.
