# Motores

Cada motor mantiene su entrada, implementación, recursos y pruebas. La aplicación los invoca mediante
adaptadores; ninguno importa la implementación del otro.

| Motor | Contrato y documentación |
| --- | --- |
| Ocupaciones | [Contrato, componentes y sello](ocupaciones/README.md). |
| Cursos | [Entrada, planificación y trabajador](cursos/README.md). |

Los contratos comunes viven en [compartido](../compartido/README.md). Los datos que utilizan los motores
proceden de la entrega identificada en [datos](../datos/README.md); las fuentes se mantienen en la plataforma
de datos. Los modelos y sus huellas acompañan al componente que los ejecuta.

El sello del motor de ocupaciones comprueba la identidad de sus archivos protegidos. Cambiar un archivo
protegido no se resuelve recalculando su huella: requiere comprobar el comportamiento con su banco de evaluación.
Las pruebas de independencia y las pruebas de cada motor se incluyen en `npm run verificar`.
