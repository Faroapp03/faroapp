# Búsqueda de ocupaciones

El buscador propone ocupaciones del catálogo ESCO por sus nombres, variantes y descripciones. La persona confirma
su elección. Los puntos expresan coincidencia léxica; no son una probabilidad ni una estimación de impacto de IA.

`palabras.ts` define las formas comunes y las coincidencias de prefijos. `indice.ts` prepara y conserva índices por
paquete de datos; `consulta.ts` prepara las palabras de cada búsqueda y sus pesos. `puntuacion.ts` calcula la
coincidencia y `ocupaciones.ts` ordena, limita y combina las candidatas. `palabras-de-nombre.ts` evita que un nombre
personal o de lugar se confunda con una palabra del oficio, según su contexto y la lista oficial de nombres.

Las consultas reconocen «guías», «jefes» y «jefas» mediante expansiones específicas que conservan la frase escrita.
Estas expansiones solo se aplican a la consulta; el vocabulario del catálogo mantiene sus formas y pesos.
Los títulos propuestos siguen siendo los oficiales del catálogo.

Funciones del buscador:

- `contexto.ts` separa el lugar de trabajo del oficio («en la Generalitat», «a l'hospital»): sus palabras pesan
  `FACTOR_LUGAR` (1 por validación cruzada: el lugar suele llevar la especialidad), no se corrigen por faltas ni
  cuentan para reconocer un nombre idéntico, y un nombre que solo coincide con el lugar se queda con
  `FACTOR_SOLO_LUGAR` de sus puntos. Las palabras
  de lugar o institución dan **pistas de sector**, que se devuelven aparte y suman `BONO_SECTOR` a las candidatas de
  esos grupos.
- `denominaciones.ts` añade los títulos del SEPE (CO-SISPE, enlaces exactos y estrechos de la correspondencia EURES de
  `correspondencia-eures.json`) como nombres de búsqueda y completa los títulos partidos por «/» («técnico/técnica de X»).
- `genericas.ts` rebaja la rareza de las palabras de rango («técnico», «auxiliar»…) y reconoce la búsqueda de una sola
  palabra genérica (`necesitaPrecision`).
- `correccion.ts` busca las palabras del oficio que no están en el vocabulario como la más parecida (faltas).
- Con la página en catalán, o si el texto tiene palabras que solo existen en catalán, se busca en los dos índices y se
  junta lo mejor de cada ocupación, rebajando el índice que no conoce las palabras del oficio.
- `analisis.ts` (`buscarConContexto`) da la salida completa para el motor de preguntas, tipada como
  `ResultadoDeBusqueda` en ese mismo archivo. `/api/clasificar` añade `busqueda`
  (opcional) con las pistas y la precisión que falta.

`prepararBuscador(datos)` permite construir los índices antes de atender peticiones. Las búsquedas posteriores
reutilizan esos índices mientras se conserva el mismo objeto de datos. Un paquete actualizado debe entregarse como
un objeto nuevo. `buscarOcupaciones`, `buscarVarias` y `buscarEnElRelato` cubren consultas simples, combinadas y relatos.

Las pruebas propias usan el paquete oficial y casos sintéticos para comprobar palabras, puntuación, nombres,
plurales y resultados completos. Los bancos de evaluación y sus comparaciones independientes no forman parte
del producto.
