// Revisión editorial, hecha a mano, de las afirmaciones de requisito de las fichas de aprendizaje observadas. Una
// decisión juzga una frase: vale para su programa y su afirmación mientras el texto literal sea el mismo
// (requisitos.ts). La huella de la captura sobre la que se revisó queda como constancia; que el proveedor cambie otra
// parte de su página no anula una revisión de una frase que sigue igual.
import type { TextoRevisado } from './contrato.ts';

/** Condición específica del curso, con un resumen fiel en los dos idiomas de Faro. */
interface DecisionCondicion {
  readonly tipo: 'condicion';
  /** Huella (sha256) de la captura de la página sobre la que se revisó la frase. */
  readonly revisadaSobre: string;
  readonly literal: string;
  readonly resumen: TextoRevisado;
  readonly razon: TextoRevisado;
}
/** Descripción del curso o texto general del proveedor: se lee, pero no es una condición para seguirlo. */
interface DecisionInformativa {
  readonly tipo: 'descripcion' | 'informacion-general';
  readonly revisadaSobre: string;
  readonly literal: string;
  /** Lo informativo se enseña con su texto publicado: un resumen lo haría pasar por una condición revisada. */
  readonly resumen?: never;
  readonly razon: TextoRevisado;
}
export type DecisionRequisito = DecisionCondicion | DecisionInformativa;

const RAZON_CONDICION: TextoRevisado = {
  es: 'Condición específica publicada; el resumen conserva su alcance.',
  ca: 'Condició específica publicada; el resum en conserva l’abast.',
};
const RAZON_INFORMATIVA: TextoRevisado = {
  es: 'Información de acceso, descripción o recomendación; no añade una barrera obligatoria al curso.',
  ca: 'Informació d’accés, descripció o recomanació; no afegeix una barrera obligatòria al curs.',
};

/** Las decisiones por identificador compuesto: JSON.stringify([programa_id, afirmacion.id]). */
export const REVISION_REQUISITOS: Readonly<Record<string, DecisionRequisito>> = Object.freeze({
  '["claude-academy:claude-101","claude-101-requisito-1"]': {
    tipo: 'condicion',
    revisadaSobre: 'c81650b8d6ff02145d9b3cf20348123c3e057f21bd1ac19d06590b91e21c0576',
    literal: 'A Claude account on any plan (Free, Pro, Max, Team, or Enterprise)',
    resumen: {
      es: 'Tener una cuenta de Claude en cualquiera de sus planes, incluido el gratuito.',
      ca: 'Tenir un compte de Claude en qualsevol dels seus plans, inclòs el gratuït.',
    },
    razon: RAZON_CONDICION,
  },
  '["claude-academy:claude-101","claude-101-requisito-2"]': {
    tipo: 'descripcion',
    revisadaSobre: 'c81650b8d6ff02145d9b3cf20348123c3e057f21bd1ac19d06590b91e21c0576',
    literal: 'No prior experience with Claude or other AI assistants needed',
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:claude-101","claude-101-requisito-3"]': {
    tipo: 'informacion-general',
    revisadaSobre: 'c81650b8d6ff02145d9b3cf20348123c3e057f21bd1ac19d06590b91e21c0576',
    literal:
      'A few features covered here require a paid plan to try hands-on: Cowork and Research (Pro, Max, Team, and Enterprise plans) and Enterprise Search (Team and Enterprise plans). On Team and Enterprise, your admin controls whether designs, decks, and documents are available. Each lesson notes where this applies.',
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:claude-101","academy-inscripcion-progreso-1"]': {
    tipo: 'informacion-general',
    revisadaSobre: '02cb110d617e9017aef8154de55fca5aefe51e73a34dedb48253d16301f44dc9',
    literal:
      'Enrollment and progress: a free Claude account saves course progress and enables completion badges. This does not establish a login requirement for reading all material.',
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:introduction-to-claude-tag","introduction-to-claude-tag-requisito-1"]': {
    tipo: 'condicion',
    revisadaSobre: 'b1429a3f2cdb7d68da84e0c75b24edcdc68a2a84e86925f9b2dc610e46a71544',
    literal: "Claude Tag is installed in your team's workspace, so it can join channels there.",
    resumen: {
      es: 'Claude Tag debe estar instalado en el espacio de trabajo de tu equipo.',
      ca: 'Claude Tag ha d’estar instal·lat a l’espai de treball del teu equip.',
    },
    razon: RAZON_CONDICION,
  },
  '["claude-academy:introduction-to-claude-tag","introduction-to-claude-tag-requisito-2"]': {
    tipo: 'condicion',
    revisadaSobre: 'b1429a3f2cdb7d68da84e0c75b24edcdc68a2a84e86925f9b2dc610e46a71544',
    literal:
      'You have access to Claude Tag in one or more channels. Some organizations limit it to certain roles(opens in new tab), so if tagging it returns an access message, ask your admin.',
    resumen: {
      es: 'Tener acceso a Claude Tag en uno o más canales; puede depender del permiso de tu organización.',
      ca: 'Tenir accés a Claude Tag en un o més canals; pot dependre del permís de la teva organització.',
    },
    razon: RAZON_CONDICION,
  },
  '["claude-academy:introduction-to-claude-tag","introduction-to-claude-tag-requisito-3"]': {
    tipo: 'descripcion',
    revisadaSobre: 'b1429a3f2cdb7d68da84e0c75b24edcdc68a2a84e86925f9b2dc610e46a71544',
    literal: 'Helpful, not required: you have used Claude in a chat.',
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:introduction-to-claude-tag","academy-inscripcion-progreso-1"]': {
    tipo: 'informacion-general',
    revisadaSobre: '02cb110d617e9017aef8154de55fca5aefe51e73a34dedb48253d16301f44dc9',
    literal:
      'Enrollment and progress: a free Claude account saves course progress and enables completion badges. This does not establish a login requirement for reading all material.',
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:ai-capabilities-and-limitations","claude-academy-ai-capabilities-and-limitations-requisito-1"]': {
    tipo: 'descripcion',
    revisadaSobre: 'fbc419851ab477247e0ee796248fa73487d675a4aeca0920e7e786191aca98d9',
    literal:
      "None. This course assumes no technical background and no prior experience with AI tools. If you've already completed AI Fluency: Framework & Foundations, you'll recognize where each property connects to the 4Ds — but it's not required.",
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:ai-capabilities-and-limitations","academy-inscripcion-progreso-1"]': {
    tipo: 'informacion-general',
    revisadaSobre: '02cb110d617e9017aef8154de55fca5aefe51e73a34dedb48253d16301f44dc9',
    literal:
      'Enrollment and progress: a free Claude account saves course progress and enables completion badges. This does not establish a login requirement for reading all material.',
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:ai-native-sdlc-playbook","claude-academy-ai-native-sdlc-playbook-requisito-1"]': {
    tipo: 'condicion',
    revisadaSobre: '9032c8b836fcbe049f0052b2d9485ef1dc56110d932f2e9c94def1b01ef4856d',
    literal:
      'To run the plays, you should be comfortable working in Claude Code day to day, and have a Git repository and CI pipeline you are allowed to change. Each play names its own prerequisites under Getting started, and several have none.',
    resumen: {
      es: 'Para ejecutar las prácticas: manejar Claude Code habitualmente y disponer de un repositorio Git y un entorno de integración continua que puedas modificar. Cada práctica concreta sus condiciones.',
      ca: 'Per executar les pràctiques: fer servir Claude Code habitualment i disposar d’un repositori Git i un entorn d’integració contínua que puguis modificar. Cada pràctica concreta les condicions.',
    },
    razon: RAZON_CONDICION,
  },
  '["claude-academy:ai-native-sdlc-playbook","academy-inscripcion-progreso-1"]': {
    tipo: 'informacion-general',
    revisadaSobre: '02cb110d617e9017aef8154de55fca5aefe51e73a34dedb48253d16301f44dc9',
    literal:
      'Enrollment and progress: a free Claude account saves course progress and enables completion badges. This does not establish a login requirement for reading all material.',
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:claude-code-101","claude-academy-claude-code-101-requisito-1"]': {
    tipo: 'condicion',
    revisadaSobre: 'edfa306b399fde4e78ce1324e8498b4a4158cb76b4c67007993f6bda21c3bd44',
    literal:
      "Basic familiarity with a code editor and the command line. You'll also need a Claude account (Pro, Max, Team, or Enterprise) or an API key. No prior experience with AI tools is assumed.",
    resumen: {
      es: 'Conocer un editor de código y la línea de comandos. Para las prácticas, tener una cuenta de Claude Pro, Max, Team o Enterprise, o una clave de API. No exige experiencia previa con IA.',
      ca: 'Conèixer un editor de codi i la línia d’ordres. Per a les pràctiques, tenir un compte de Claude Pro, Max, Team o Enterprise, o una clau d’API. No exigeix experiència prèvia amb IA.',
    },
    razon: RAZON_CONDICION,
  },
  '["claude-academy:claude-code-101","academy-inscripcion-progreso-1"]': {
    tipo: 'informacion-general',
    revisadaSobre: '02cb110d617e9017aef8154de55fca5aefe51e73a34dedb48253d16301f44dc9',
    literal:
      'Enrollment and progress: a free Claude account saves course progress and enables completion badges. This does not establish a login requirement for reading all material.',
    razon: RAZON_INFORMATIVA,
  },
  '["claude-academy:claude-platform-101","claude-academy-claude-platform-101-requisito-1"]': {
    tipo: 'condicion',
    revisadaSobre: '181d75013aff9d9955c12a854da70bcdb2a703959eceffd8db9519525b9ccfc0',
    literal:
      'Comfort reading and writing code in at least one language, plus basic command-line familiarity. Most demos use the Python SDK (anthropic, installed with pip). The lessons "Your first API call", "What is tool use?" and "Building with Claude Code" use the TypeScript SDK (@anthropic-ai/sdk) with Node and npm. You don\'t need to be an expert in either language, but you should be able to follow along and run a script. You\'ll need a Claude Console account and an API key from platform.claude.com. New accounts get a small amount of free credit to test the API. After that, you add credit under Settings > Billing. You don\'t need prior experience building with LLMs.',
    resumen: {
      es: 'Poder leer, escribir y ejecutar código y usar la línea de comandos. Para practicar, tener una cuenta de Claude Console y una clave de API; tras el crédito inicial, la API puede tener coste.',
      ca: 'Poder llegir, escriure i executar codi i fer servir la línia d’ordres. Per practicar, tenir un compte de Claude Console i una clau d’API; després del crèdit inicial, l’API pot tenir cost.',
    },
    razon: RAZON_CONDICION,
  },
  '["claude-academy:claude-platform-101","academy-inscripcion-progreso-1"]': {
    tipo: 'informacion-general',
    revisadaSobre: '02cb110d617e9017aef8154de55fca5aefe51e73a34dedb48253d16301f44dc9',
    literal:
      'Enrollment and progress: a free Claude account saves course progress and enables completion badges. This does not establish a login requirement for reading all material.',
    razon: RAZON_INFORMATIVA,
  },
  '["cibervoluntarios:material:9927659354","cibervoluntarios-material-9927659354-requisito-1"]': {
    tipo: 'descripcion',
    revisadaSobre: '9e55efcc2f4fb2b1a868273b4acb994ebd94edb66905837289253762e289550b',
    literal:
      'Este curso te ayudará a ganar autonomía digital a través del uso de la inteligencia artificial. Aprenderás de forma sencilla cómo aprovechar herramientas como asistentes virtuales, traductores, correctores de texto o generadores de imágenes para comunicarte mejor, organizarte, crear contenidos y aprender a tu propio ritmo. También conocerás los riesgos de depender demasiado de estas tecnologías y cómo usarlas con seguridad, protegiendo tus datos y desarrollando un pensamiento crítico. No necesitas experiencia previa, solo un dispositivo con conexión a Internet y ganas de descubrir cómo la IA puede hacer tu día a día más fácil.',
    razon: {
      es: 'Describe la propuesta del curso y declara que no se necesita experiencia previa. El dispositivo y la conexión son información de acceso, no una condición excluyente añadida.',
      ca: 'Descriu la proposta del curs i declara que no cal experiència prèvia. El dispositiu i la connexió són informació d’accés, no una condició excloent afegida.',
    },
  },
  '["cibervoluntarios:material:9927659354","cibervoluntarios-material-9927659354-requisito-2"]': {
    tipo: 'informacion-general',
    revisadaSobre: 'f577c44e3d031592b6e4fbbe0949599a58526ab18bb61ceab41b1cf51dbeabaa',
    literal:
      'Tus ganas de aprender y una conexión a Internet son lo único que necesitas para empezar a aprender. Puedes hacer el curso que más te interese desde casa, el autobús, la playa o la universidad',
    razon: {
      es: 'Texto general de motivación y acceso por Internet; no define una condición específica del curso.',
      ca: 'Text general de motivació i accés per Internet; no defineix una condició específica del curs.',
    },
  },
  '["cibervoluntarios:material:10059787763","cibervoluntarios-material-10059787763-requisito-1"]': {
    tipo: 'condicion',
    revisadaSobre: '9e55efcc2f4fb2b1a868273b4acb994ebd94edb66905837289253762e289550b',
    literal: 'Ya usas ChatGPT o Gemini de forma puntual y quieres pasar a un uso más estratégico.',
    resumen: {
      es: 'Haber usado ChatGPT o Gemini de forma puntual.',
      ca: 'Haver fet servir ChatGPT o Gemini puntualment.',
    },
    razon: {
      es: 'La ficha se dirige expresamente a personas con uso puntual previo. El resumen conserva esa condición, sin añadir dominio, cuenta de pago ni admisión.',
      ca: 'La fitxa s’adreça expressament a persones amb ús puntual previ. El resum conserva aquesta condició, sense afegir domini, compte de pagament ni admissió.',
    },
  },
  '["cibervoluntarios:material:10059787763","cibervoluntarios-material-10059787763-requisito-2"]': {
    tipo: 'informacion-general',
    revisadaSobre: 'f577c44e3d031592b6e4fbbe0949599a58526ab18bb61ceab41b1cf51dbeabaa',
    literal:
      'Tus ganas de aprender y una conexión a Internet son lo único que necesitas para empezar a aprender. Puedes hacer el curso que más te interese desde casa, el autobús, la playa o la universidad',
    razon: {
      es: 'Texto general de motivación y acceso por Internet; no define una condición específica del curso.',
      ca: 'Text general de motivació i accés per Internet; no defineix una condició específica del curs.',
    },
  },
  '["cibervoluntarios:material:10059787295","cibervoluntarios-material-10059787295-requisito-1"]': {
    tipo: 'informacion-general',
    revisadaSobre: 'f577c44e3d031592b6e4fbbe0949599a58526ab18bb61ceab41b1cf51dbeabaa',
    literal:
      'Tus ganas de aprender y una conexión a Internet son lo único que necesitas para empezar a aprender. Puedes hacer el curso que más te interese desde casa, el autobús, la playa o la universidad',
    razon: RAZON_INFORMATIVA,
  },
  '["cibervoluntarios:material:10059787708","cibervoluntarios-material-10059787708-requisito-1"]': {
    tipo: 'condicion',
    revisadaSobre: '9e55efcc2f4fb2b1a868273b4acb994ebd94edb66905837289253762e289550b',
    literal: 'Ya conoces lo básico sobre desinformación y buscas dar el salto a un análisis técnico y argumentable.',
    resumen: {
      es: 'Conocer las bases de la desinformación antes de pasar al análisis técnico.',
      ca: 'Conèixer les bases de la desinformació abans de passar a l’anàlisi tècnica.',
    },
    razon: RAZON_CONDICION,
  },
  '["cibervoluntarios:material:10059787708","cibervoluntarios-material-10059787708-requisito-2"]': {
    tipo: 'informacion-general',
    revisadaSobre: 'f577c44e3d031592b6e4fbbe0949599a58526ab18bb61ceab41b1cf51dbeabaa',
    literal:
      'Tus ganas de aprender y una conexión a Internet son lo único que necesitas para empezar a aprender. Puedes hacer el curso que más te interese desde casa, el autobús, la playa o la universidad',
    razon: RAZON_INFORMATIVA,
  },
});
