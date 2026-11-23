// Textos de errores y reparación del recorrido.

/** @type {Readonly<Record<string, string>>} */
export const ERRORES_RECORRIDO = {
  'recorrido.error.actualizar':
    'Aquesta pàgina de Faro necessita actualitzar-se. Recarrega-la per continuar; en recarregar s’esborra el que has fet.',
  'recorrido.error.formato': 'No he pogut llegir les tasques. Revisa-les i torna-ho a provar.',
  'recorrido.error.contenido':
    'Faro no ha pogut fer servir aquest text. Escriu-lo d’una altra manera, explicant què fas a la feina, i torna’l a enviar.',
  'recorrido.error.cancelada': 'Petició cancel·lada.',
  'recorrido.error.generico': 'Alguna cosa ha fallat a Faro. Torna-ho a provar.',
  'recorrido.error.motor-no-coincide':
    'Cal reparar la còpia de Faro desada en aquest dispositiu. Connecta’t a Internet i prem «Reparar Faro». Les teves preferències es conservaran. Quan s’acabi la reparació, aquesta conversa tornarà a començar.',
  'recorrido.reparar': 'Reparar Faro',
  'recorrido.reparando': 'Faro s’està reparant…',
  'recorrido.reparado': 'Faro ja està reparat.',
  'recorrido.error.reparar-sin-completar': 'No s’ha pogut reparar Faro. Comprova la connexió i torna-ho a provar.',
  'recorrido.error.reparar-no-coincide': 'No s’ha pogut reparar Faro ara. Torna-ho a provar més tard.',
  'recorrido.error.instalacion-no-coincide':
    'Faro no s’ha pogut carregar correctament en aquest dispositiu. Torna-ho a provar més tard.',
  'recorrido.error.motor-local':
    'Faro no ha pogut respondre en aquest dispositiu. Torna-ho a provar. Si continua sense respondre, torna a carregar la pàgina; en recarregar s’esborra el que has fet.',
  'recorrido.error.reloj-atrasado':
    'La data d’aquest dispositiu sembla endarrerida: és anterior a la de les dades de Faro. Corregeix la data i l’hora del dispositiu i torna-ho a provar.',
  'recorrido.error.sin-datos': 'Faro encara no ha acabat de preparar-se. Torna-ho a provar d’aquí a un moment.',
  'recorrido.error.bloqueo': 'Faro no ha pogut preparar-se. Torna-ho a provar.',
  'recorrido.error.service-worker-no-disponible':
    'Aquest navegador no permet preparar Faro. Fes servir un navegador compatible per continuar.',
  'recorrido.error.sin-service-worker':
    'No he pogut preparar Faro en aquest navegador. Torna a carregar la pàgina per tornar-ho a provar.',
  'recorrido.error.sin-resultado': 'Faro no ha pogut obtenir un resultat aquesta vegada. Torna-ho a provar.',
  'recorrido.error.sin-limpieza':
    'No he pogut preparar el text en aquest dispositiu. Pots cercar la teva ocupació a la classificació oficial o tornar a carregar la pàgina i tornar-ho a provar. En recarregar s’esborra el que has fet.',
  'recorrido.error.tarda': 'Faro triga massa a respondre. Torna-ho a provar d’aquí a uns minuts.',
};
