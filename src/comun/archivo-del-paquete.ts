// Un archivo JSON del paquete de datos (datos/) importado como módulo, leído igual en Node y en Cloudflare.
// En Node, `import … with { type: 'json' }` lo entrega ya leído, como objeto. En el Worker, wrangler lo sube aparte
// como módulo de datos (config/cloudflare/wrangler.example.jsonc, «rules») y lo entrega como bytes en un ArrayBuffer.
// Así el paquete no va dentro del código del Worker, donde V8 lo guardaría como texto del código y como objeto,
// además de utilizar dos bytes por carácter. Aquí se leen esos bytes una sola vez y se sueltan.

/**
 * Un archivo del paquete que llega como sus bytes ya se ha leído y guardado, o se leyó su texto y no era JSON: sus bytes
 * ya no están. Quien lo lee guarda el resultado; una segunda lectura es un error de programación.
 */
export class ArchivoDelPaqueteYaLeido extends Error {
  override name = 'ArchivoDelPaqueteYaLeido';
}

/**
 * El texto de cada archivo cuyos bytes ya se soltaron y cuya lectura no se ha dado por guardada. Si el aislado se corta
 * mientras se analiza o se prepara (por memoria o por tiempo, sin excepción que capturar), la siguiente lectura parte de
 * este texto en lugar de encontrar los bytes vacíos.
 */
const textosPendientes = new WeakMap<ArrayBuffer, string>();

/**
 * El contenido de un archivo del paquete importado como módulo. Si llega como sus bytes, los decodifica, guarda el texto
 * aparte, suelta los bytes (deja vacío el ArrayBuffer que guarda el módulo) y lee el JSON: en el Worker nunca están a la
 * vez los bytes, el texto y el objeto. El texto se conserva hasta que quien lee da la lectura por guardada con
 * {@link soltarArchivoDelPaquete}; así, una lectura cortada se puede repetir. Un texto que no es JSON se suelta al fallar.
 *
 * @param importado - Lo que entrega el import del archivo: el objeto ya leído (Node) o sus bytes (Worker).
 * @returns El contenido del archivo: en Node, lo recibido tal cual; con los bytes, el JSON leído.
 * @throws {ArchivoDelPaqueteYaLeido} Si sus bytes ya se leyeron y la lectura se dio por guardada.
 * @throws {TypeError} Si los bytes no son UTF-8 (no se leen con sustituciones).
 * @throws {SyntaxError} Si el texto no es JSON.
 */
export function leerArchivoDelPaquete(importado: unknown): unknown {
  if (!(importado instanceof ArrayBuffer)) {
    return importado;
  }
  let texto = textosPendientes.get(importado);
  if (texto === undefined) {
    if (importado.detached) {
      throw new ArchivoDelPaqueteYaLeido('Este archivo del paquete ya se ha leído: se lee una vez y se guarda');
    }
    texto = new TextDecoder('utf-8', { fatal: true }).decode(importado);
    textosPendientes.set(importado, texto);
    importado.transfer(0);
  }
  try {
    return JSON.parse(texto);
  } catch (error) {
    textosPendientes.delete(importado);
    throw error;
  }
}

/**
 * Da por guardada la lectura de un archivo del paquete: suelta el texto que permitía repetirla. Quien lo lee lo llama
 * después de guardar lo leído; desde entonces, leerlo otra vez es un error.
 *
 * @param importado - Lo mismo que recibió {@link leerArchivoDelPaquete}.
 */
export function soltarArchivoDelPaquete(importado: unknown): void {
  if (importado instanceof ArrayBuffer) {
    textosPendientes.delete(importado);
  }
}
