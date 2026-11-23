# Licencia y atribución · paquete de vectores para el móvil (Faro)

- **Modelo de origen:** EmbeddingGemma 2 de Google DeepMind (`google/embeddinggemma-2`, revisión
  `914f7f89142e33e77833254d9c9b90c3cef7303b`). La [ficha fijada](https://huggingface.co/google/embeddinggemma-2/blob/914f7f89142e33e77833254d9c9b90c3cef7303b/README.md)
  declara **Apache-2.0** y enlaza el [texto oficial de la licencia](https://ai.google.dev/gemma/docs/gemma_4_license),
  comprobados el 21/10/2026. La ficha exige también respetar la [política de usos prohibidos de Gemma](https://ai.google.dev/gemma/prohibited_use_policy),
  leída en la misma comprobación. No se ha encontrado un archivo NOTICE en esa revisión.
- **Distribución:** la web incorpora el texto íntegro de Apache-2.0 en `web/terceros/embeddinggemma/LICENSE`, los avisos
  de atribución y modificación en `AVISOS.txt`, y los enlaza desde `creditos.html#f-embeddinggemma`. Las URL consultadas,
  la revisión y sus SHA-256 están en `web/terceros/embeddinggemma/procedencia.json`. El hash del HTML identifica la
  consulta conservada, no obliga a que la web externa mantenga los mismos bytes.
- **Modificaciones de Faro:** ajuste fino de la parte de texto con datos oficiales («Faro IA Vectores 1», 08/10/2026) y
  destilación a una tabla estática palabra → vector (PCA a 256 dimensiones, peso SIF, ajuste por mínimos cuadrados con
  textos del paquete, int8). La tabla derivada se distribuye con Apache-2.0, con este aviso de modificación. Esto no aplica esa licencia
  al resto de `datos/` ni al código propio de Faro; las fuentes conservan sus condiciones.
- **Textos de origen de los vectores de documentos y del vocabulario:**
  - ESCO v1.2.1 (© Unión Europea, https://esco.ec.europa.eu, CC BY 4.0).
  - Tareas de la CIUO-08 con nota de exposición de la OIT (Gmyrek et al., ILO Working Paper 140, 2025, © OIT). Sus
    traducciones al castellano y al catalán son de Faro, hechas con IA: «This is a translation of a copyrighted work of
    the International Labour Organization (ILO). This translation has not been prepared, reviewed or endorsed by the
    ILO and should not be considered an official ILO translation. The ILO disclaims all responsibility for its content
    and accuracy. Responsibility rests solely with the author(s) of the translation.»
  - Títulos CIUO-08 en castellano (INE) y en catalán (Idescat), con sus avisos legales, como en el resto del paquete.
- **Código** (`herramientas/vectores-movil/empaquetar.ts`, que empaqueta la tabla, y
  `motores/ocupaciones/src/recorrido/fusion/vectores-movil.ts`, que la lee en el dispositivo): de Faro, con la
  licencia del producto.
- **Atribución que debe verse en «Fuentes y licencias»:** «Vectores: tabla derivada de EmbeddingGemma 2 (Google
  DeepMind, Apache-2.0), ajustada y destilada por Faro con datos de ESCO (UE, CC BY 4.0) y de la OIT.»
