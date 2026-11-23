// Plantilla neutra, que nunca se reescribe: en las fuentes vale ''. La construcción del Worker la sustituye por las
// huellas de los mapas de la web construida (herramientas/cloudflare/comprobar-construccion.ts, mapaDeLaWeb), y el
// servidor local toma las de la web que sirve (su construccion.json o, con FARO_WEB_DE_PRUEBA, sus páginas).
// npm run web:comprobar exige que siga neutra.

export const HUELLA_DEL_MAPA_DE_MODULOS = '';
