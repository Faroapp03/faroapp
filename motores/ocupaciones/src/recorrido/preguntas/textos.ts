// Textos de las preguntas, en castellano y en catalán. Las opciones de jerarquía son paráfrasis en lenguaje llano de
// los títulos oficiales de la CIUO-08 (gran grupo y subgrupo principal); los campos son los amplios de la ISCED-F 2013
// que ESCO asigna a sus conocimientos; las tareas usan el texto corto de Faro de cada tarea de la OIT (atributos.json).

import type { Idioma, TipoPregunta } from './tipos.ts';

type PorIdioma = Readonly<Record<Idioma, string>>;
const t = (es: string, ca: string): PorIdioma => ({ es, ca });

export const ENUNCIADOS: Readonly<Record<TipoPregunta, PorIdioma>> = {
  precision: t(
    '¿{palabra} de qué? Elige el área que más se parece',
    '{palabra} de què? Tria l’àmbit que s’hi assembla més',
  ),
  nivel1: t('¿Qué se parece más a tu trabajo?', 'Què s’assembla més a la teva feina?'),
  nivel2: t('¿Cuál de estas describe mejor tu trabajo?', 'Quina d’aquestes descriu millor la teva feina?'),
  nivel3: t('¿En cuál de estos grupos encaja tu trabajo?', 'En quin d’aquests grups encaixa la teva feina?'),
  tarea: t('¿Esto forma parte de tu trabajo? «{tarea}»', 'Això forma part de la teva feina? «{tarea}»'),
  grupo: t('¿Cuál de estos es tu trabajo?', 'Quina d’aquestes és la teva feina?'),
  area: t('¿Qué haces sobre todo en {area}?', 'Què fas sobretot a {area}?'),
  trato: t('¿Con qué trabajas más?', 'Amb què treballes més?'),
  campo: t('¿De qué tema es tu trabajo?', 'De quin àmbit és la teva feina?'),
  universidad: t('¿Tienes estudios universitarios?', 'Tens estudis universitaris?'),
  cuenta_propia: t('¿Trabajas por tu cuenta (autónomo o autónoma)?', 'Treballes pel teu compte (autònom o autònoma)?'),
  ocupacion: t('¿Cuál de estos es tu puesto?', 'Quin d’aquests és el teu lloc de feina?'),
};

/** La pregunta del área cuando el área trae su frase («en la hostelería», «amb gent gran»: AreaDeTexto.frase). */
export const ENUNCIADO_DEL_AREA_CON_FRASE: PorIdioma = t('¿Qué haces sobre todo {frase}?', 'Què fas sobretot {frase}?');

export const OPCIONES_FIJAS: Readonly<Record<string, PorIdioma>> = {
  si: t('Sí', 'Sí'),
  no: t('No', 'No'),
  otra: t('Otra cosa', 'Una altra cosa'),
  ninguna: t('Ninguna de estas', 'Cap d’aquestes'),
  no_lo_se: t('No lo sé', 'No ho sé'),
};

export const BUSCAR_YO = t('Prefiero buscarla yo', 'Prefereixo buscar-la jo');

/** Gran grupo de la CIUO-08 (1 cifra). */
export const NIVEL1: Readonly<Record<string, PorIdioma>> = {
  '0': t('Ejército (fuerzas armadas)', 'Exèrcit (forces armades)'),
  '1': t(
    'Dirijo una empresa, un departamento o un equipo grande',
    'Dirigeixo una empresa, un departament o un equip gran',
  ),
  '2': t(
    'Un trabajo de carrera universitaria (salud, enseñanza, derecho, ingeniería…)',
    'Una feina de carrera universitària (salut, ensenyament, dret, enginyeria…)',
  ),
  '3': t(
    'Técnico o técnica de un área: sanidad, informática, laboratorio, gestión…',
    'Tècnic o tècnica d’una àrea: sanitat, informàtica, laboratori, gestió…',
  ),
  '4': t('Trabajo en oficina con papeles, datos o trámites', 'Treballo en una oficina amb papers, dades o tràmits'),
  '5': t(
    'Atiendo a personas: venta, hostelería, cuidados o seguridad',
    'Atenc persones: venda, hostaleria, cures o seguretat',
  ),
  '6': t('Trabajo en el campo, con animales o en la pesca', 'Treballo al camp, amb animals o a la pesca'),
  '7': t(
    'Un oficio manual: construcción, electricidad, mecánica, alimentación…',
    'Un ofici manual: construcció, electricitat, mecànica, alimentació…',
  ),
  '8': t('Manejo máquinas, monto piezas o conduzco vehículos', 'Faig anar màquines, munto peces o condueixo vehicles'),
  '9': t('Limpieza, carga, reparto u otras tareas de apoyo', 'Neteja, càrrega, repartiment o altres tasques de suport'),
};

/** Subgrupo principal de la CIUO-08 (2 cifras). */
export const NIVEL2: Readonly<Record<string, PorIdioma>> = {
  '01': t('Oficial del ejército', 'Oficial de l’exèrcit'),
  '02': t('Suboficial del ejército', 'Suboficial de l’exèrcit'),
  '03': t('Tropa o marinería', 'Tropa o marineria'),
  '11': t('Alta dirección o cargo político', 'Alta direcció o càrrec polític'),
  '12': t(
    'Dirección de administración, finanzas, personal o ventas',
    'Direcció d’administració, finances, personal o vendes',
  ),
  '13': t(
    'Dirección de producción, obras, logística o informática',
    'Direcció de producció, obres, logística o informàtica',
  ),
  '14': t(
    'Gerencia de un hotel, restaurante, tienda u otro servicio',
    'Gerència d’un hotel, restaurant, botiga o un altre servei',
  ),
  '21': t('Ciencias o ingeniería, con carrera', 'Ciències o enginyeria, amb carrera'),
  '22': t(
    'Medicina, enfermería u otra profesión sanitaria con carrera',
    'Medicina, infermeria o una altra professió sanitària amb carrera',
  ),
  '23': t('Enseñanza: maestro o profesora', 'Ensenyament: mestre o professora'),
  '24': t(
    'Gestión de empresas o de la administración: economía, personal, marketing',
    'Gestió d’empreses o de l’administració: economia, personal, màrqueting',
  ),
  '25': t('Informática y telecomunicaciones, con carrera', 'Informàtica i telecomunicacions, amb carrera'),
  '26': t('Derecho, ciencias sociales, cultura o comunicación', 'Dret, ciències socials, cultura o comunicació'),
  '31': t(
    'Técnico de ciencias o ingeniería: laboratorio, obra, industria',
    'Tècnic de ciències o enginyeria: laboratori, obra, indústria',
  ),
  '32': t('Técnico sanitario o de apoyo a la salud', 'Tècnic sanitari o de suport a la salut'),
  '33': t(
    'Técnico de finanzas, ventas o administración: gestoría, comercial, secretaría',
    'Tècnic de finances, vendes o administració: gestoria, comercial, secretaria',
  ),
  '34': t(
    'Técnico de servicios jurídicos, sociales, deportivos o culturales',
    'Tècnic de serveis jurídics, socials, esportius o culturals',
  ),
  '35': t('Técnico de informática o telecomunicaciones', 'Tècnic d’informàtica o telecomunicacions'),
  '41': t(
    'Oficina en general: administrativo, secretaría, grabar datos',
    'Oficina en general: administratiu, secretaria, enregistrar dades',
  ),
  '42': t(
    'Atención directa al público: caja, recepción, información, teléfono',
    'Atenció directa al públic: caixa, recepció, informació, telèfon',
  ),
  '43': t('Contabilidad, nóminas o control de almacén', 'Comptabilitat, nòmines o control de magatzem'),
  '44': t('Otras tareas de oficina: correo, archivo, personal', 'Altres tasques d’oficina: correu, arxiu, personal'),
  '51': t(
    'Servicios a personas: hostelería, cocina, peluquería, viajes',
    'Serveis a persones: hostaleria, cuina, perruqueria, viatges',
  ),
  '52': t('Venta: tienda, mercado o caja', 'Venda: botiga, mercat o caixa'),
  '53': t('Cuidado de personas: niños, mayores o enfermos', 'Cura de persones: infants, gent gran o malalts'),
  '54': t(
    'Seguridad y protección: policía, bomberos, vigilancia',
    'Seguretat i protecció: policia, bombers, vigilància',
  ),
  '61': t('Agricultura o ganadería', 'Agricultura o ramaderia'),
  '62': t('Trabajo forestal, pesca o caza', 'Treball forestal, pesca o caça'),
  '63': t('Agricultura o pesca para el propio consumo', 'Agricultura o pesca per al consum propi'),
  '71': t('Construcción: albañilería, fontanería, pintura…', 'Construcció: paleta, lampisteria, pintura…'),
  '72': t('Metal y mecánica: soldadura, taller de vehículos…', 'Metall i mecànica: soldadura, taller de vehicles…'),
  '73': t('Artesanía o artes gráficas', 'Artesania o arts gràfiques'),
  '74': t('Electricidad y electrónica', 'Electricitat i electrònica'),
  '75': t('Alimentación, confección, madera u otros oficios', 'Alimentació, confecció, fusta o altres oficis'),
  '81': t('Manejar máquinas o instalaciones de una fábrica', 'Fer anar màquines o instal·lacions d’una fàbrica'),
  '82': t('Montaje de productos', 'Muntatge de productes'),
  '83': t('Conducción de vehículos o maquinaria pesada', 'Conducció de vehicles o maquinària pesant'),
  '91': t('Limpieza o ayuda en casas, oficinas u hoteles', 'Neteja o ajuda en cases, oficines o hotels'),
  '92': t('Peón del campo, de la pesca o forestal', 'Peó del camp, de la pesca o forestal'),
  '93': t(
    'Peón de obra, de fábrica o de transporte (carga, almacén)',
    'Peó d’obra, de fàbrica o de transport (càrrega, magatzem)',
  ),
  '94': t('Ayuda en cocina o comida rápida', 'Ajuda a la cuina o menjar ràpid'),
  '95': t('Venta ambulante o servicios en la calle', 'Venda ambulant o serveis al carrer'),
  '96': t('Recogida de residuos u otras tareas de apoyo', 'Recollida de residus o altres tasques de suport'),
};

/** Campos amplios de la ISCED-F 2013 (los de los conocimientos de ESCO). */
export const CAMPOS: Readonly<Record<string, PorIdioma>> = {
  '01': t('Educación', 'Educació'),
  '02': t('Arte, idiomas o humanidades', 'Art, idiomes o humanitats'),
  '03': t('Ciencias sociales, comunicación o documentación', 'Ciències socials, comunicació o documentació'),
  '04': t('Empresa, administración o derecho', 'Empresa, administració o dret'),
  '05': t('Ciencias, matemáticas o laboratorio', 'Ciències, matemàtiques o laboratori'),
  '06': t('Informática', 'Informàtica'),
  '07': t('Ingeniería, industria o construcción', 'Enginyeria, indústria o construcció'),
  '08': t('Campo, animales o pesca', 'Camp, animals o pesca'),
  '09': t('Salud o servicios sociales', 'Salut o serveis socials'),
  '10': t(
    'Servicios: hostelería, transporte, seguridad, cuidado personal',
    'Serveis: hostaleria, transport, seguretat, cura personal',
  ),
};

/** Las tres respuestas de «¿Con qué trabajas más?», en el orden de `tr` en atributos.json. */
export const TRATO: readonly (readonly [string, PorIdioma])[] = [
  [
    'personas',
    t('Con personas: atender, cuidar, enseñar o convencer', 'Amb persones: atendre, cuidar, ensenyar o convèncer'),
  ],
  ['informacion', t('Con papeles, datos u ordenador', 'Amb papers, dades o ordinador')],
  ['manos', t('Con las manos, herramientas o máquinas', 'Amb les mans, eines o màquines')],
];

/** Palabras genéricas de rango que el buscador marca con `necesitaPrecision`. */
export const PALABRAS_GENERICAS: Readonly<Record<string, PorIdioma>> = {
  tecnico: t('técnico', 'tècnic'),
  auxiliar: t('auxiliar', 'auxiliar'),
  ayudante: t('ayudante', 'ajudant'),
  responsable: t('responsable', 'responsable'),
  empleado: t('empleado', 'empleat'),
  operario: t('operario', 'operari'),
  especialista: t('especialista', 'especialista'),
  asistente: t('asistente', 'assistent'),
  trabajador: t('trabajador', 'treballador'),
  profesional: t('profesional', 'professional'),
  encargado: t('encargado', 'encarregat'),
  oficial: t('oficial', 'oficial'),
  agente: t('agente', 'agent'),
  gestor: t('gestor', 'gestor'),
  gerente: t('gerente', 'gerent'),
  director: t('director', 'director'),
  jefe: t('jefe', 'cap'),
  coordinador: t('coordinador', 'coordinador'),
  supervisor: t('supervisor', 'supervisor'),
  cientifico: t('científico', 'científic'),
  investigador: t('investigador', 'investigador'),
  ingeniero: t('ingeniero', 'enginyer'),
};

/** Textos de la propuesta («¿Tu ocupación es X?»). */
export const PROPUESTA = {
  ocupacion: t('¿Tu ocupación es «{titulo}»?', 'La teva ocupació és «{titulo}»?'),
  grupo: t('¿Tu trabajo es de este tipo: «{titulo}»?', 'La teva feina és d’aquest tipus: «{titulo}»?'),
  si: t('Sí, es esta', 'Sí, és aquesta'),
  parecida: t('Se parece, pero no', 'S’hi assembla, però no'),
  no: t('No', 'No'),
} as const;
