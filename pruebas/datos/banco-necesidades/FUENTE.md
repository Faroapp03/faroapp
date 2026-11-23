# Procedencia de los modelos citados por el banco de necesidades

Este documento conserva la procedencia histórica citada por el banco; la prueba no ejecuta estos modelos ni convierte sus predicciones en etiquetas de utilidad. Los recursos generados de este selector no se distribuyen en el paquete actual.

- `vectores-cursos.json` y `vectores-tareas.json`: vectores de Faro IA Vectores 1 (EmbeddingGemma 2 de Google DeepMind,
  ajustado por Faro) de cada curso de la bolsa (catálogo del SEPE, Consorci per a la Formació Contínua y UNED Abierta:
  nombre y familia) y de cada tarea oficial de la OIT, calculados en Kaggle (cuaderno faro-vectores-cursos-1).
- `modelo-oficio.json` y `modelo-ia.json`: el ordenador de cursos por carril (dos regresiones logísticas y su
  calibración sigmoide), entrenado en Kaggle (cuaderno faro-ordenador-cursos-1, versión 7) con valoraciones de jueces
  según la rúbrica v2 de evaluación de formación.
- `juez-oficio.json` (cuando está): la valoración precalculada del juez Qwen3-8B (Apache-2.0) de los cursos del oficio
  de cada ocupación ESCO (cuaderno faro-precalculo-juez-1).

Los recursos se calcularon con datos oficiales y públicos, sin datos personales. Su procedencia se conserva para interpretar el banco histórico; no constituye un productor ni una capacidad del selector actual.

## Licencia de los vectores

El modelo de origen es `google/embeddinggemma-2`, revisión `914f7f89142e33e77833254d9c9b90c3cef7303b`, cuya ficha
identifica la licencia Apache-2.0 y exige respetar la política de usos prohibidos de Gemma. Ambos textos oficiales se
comprobaron el 21/10/2026; la procedencia, la copia de la licencia y los avisos de modificación de Faro están documentados
en [`../vectores-movil/LICENCIA.md`](../../../datos/vectores-movil/LICENCIA.md) y se distribuyen en
`web/terceros/embeddinggemma/`, enlazados desde los créditos. Esta atribución se refiere a los vectores derivados;
no atribuye a Google los ordenadores de cursos ni extiende esa licencia al código de Faro o a los temarios originales.
