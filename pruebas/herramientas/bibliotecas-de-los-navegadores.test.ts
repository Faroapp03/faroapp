// Las bibliotecas de los navegadores se piden solo al archivo oficial de Ubuntu, y cada intento de instalarlas tiene
// su tope: lo que llega a cuentagotas se corta limpio, con todo su grupo de procesos, y se repite.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { configuracionFuentes, fuentesOficiales, suiteDelSistema } from '../../herramientas/red/configurar-apt.ts';

const CON_TOPE = fileURLToPath(new URL('../../herramientas/mantenimiento/apt-con-tope.sh', import.meta.url));
const LLAVE = 'signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg';
const COMPONENTES = 'main restricted universe multiverse';
const UBUNTU_NOBLE =
  'PRETTY_NAME="Ubuntu 24.04.3 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nUBUNTU_CODENAME=noble\n';
/** Topes de ensayo, en segundos: un intento que no termina en 1 s se corta; TERM tiene 1 s antes de KILL. */
const TOPE_S = '1';
const GRACIA_S = '1';
/** La suite, sus actualizaciones y su seguridad. */
const FUENTES_OFICIALES = 3;
const MODO_EJECUTABLE = 0o755;
/** Un estado de salida propio de la orden, distinto del de un corte. */
const ESTADO_PROPIO = 3;

test('la suite sale del os-release de un Ubuntu y cualquier otro sistema se rechaza', () => {
  assert.equal(suiteDelSistema(UBUNTU_NOBLE), 'noble');
  assert.throws(() => suiteDelSistema(UBUNTU_NOBLE.replace('ID=ubuntu', 'ID=debian')), /no es un Ubuntu/);
  assert.throws(() => suiteDelSistema('ID=ubuntu\nVERSION_CODENAME="no ble"\n'), /no es un Ubuntu/);
});

test('APT lee solo la suite, sus actualizaciones y su seguridad del archivo oficial, firmadas por Ubuntu', () => {
  const opciones = `[arch=amd64 ${LLAVE}]`;
  assert.equal(
    fuentesOficiales('noble', 'amd64'),
    [
      `deb ${opciones} https://archive.ubuntu.com/ubuntu/ noble ${COMPONENTES}`,
      `deb ${opciones} https://archive.ubuntu.com/ubuntu/ noble-updates ${COMPONENTES}`,
      `deb ${opciones} https://security.ubuntu.com/ubuntu/ noble-security ${COMPONENTES}`,
      '',
    ].join('\n'),
  );
  const puertos = fuentesOficiales('noble', 'arm64').trim().split('\n');
  assert.equal(puertos.length, FUENTES_OFICIALES);
  assert.ok(puertos.every((l) => l.startsWith(`deb [arch=arm64 ${LLAVE}] https://ports.ubuntu.com/ubuntu-ports/ `)));
  assert.throws(() => fuentesOficiales('noble', 'amd64 x'), /nombres simples/);
  // Ni la lista del sistema ni sus piezas: solo la lista oficial y una carpeta de piezas propia.
  assert.equal(
    configuracionFuentes('/p/fuentes-oficiales.list', '/p/fuentes.d'),
    'Dir::Etc::sourcelist "/p/fuentes-oficiales.list";\nDir::Etc::sourceparts "/p/fuentes.d";\n',
  );
});

interface Ensayo {
  carpeta: string;
  orden: string;
  registro: string;
  limpiar(): void;
}
/**
 * Una orden de ensayo que imita install-deps: su primera llamada se queda colgada en un proceso hijo (como apt-get
 * esperando a un espejo) hasta `colgadas` veces; las demás terminan con `estado`. `sordo` hace que el hijo no atienda
 * TERM, como un dpkg que no sale por su cuenta. El hijo suelta la salida y dura mucho más que la prueba: si el corte
 * no alcanzara a todo el grupo, seguiría vivo al terminar y la prueba lo vería. dpkg y lslocks de ensayo anotan sus
 * llamadas.
 */
function ensayo({ colgadas = 0, estado = 0, sordo = false, dpkgAMedias = false } = {}): Ensayo {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'apt con tope '));
  const registro = join(carpeta, 'registro');
  const ejecutable = (nombre: string, cuerpo: string) => {
    writeFileSync(join(carpeta, nombre), `#!/bin/bash\n${cuerpo}\n`);
    chmodSync(join(carpeta, nombre), MODO_EJECUTABLE);
  };
  ejecutable(
    'install-deps',
    `n=$(( $(cat "${carpeta}/llamadas" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${carpeta}/llamadas"
echo "install-deps $*" >> "${registro}"
if (( n <= ${colgadas} )); then
  ${sordo ? "trap '' TERM" : ':'}
  sleep 300 > /dev/null 2>&1 &
  echo $! >> "${carpeta}/colgados"
  wait
fi
exit ${estado}`,
  );
  ejecutable('lslocks', `echo "lslocks $*" >> "${registro}"\necho /var/lib/otra/lock`);
  ejecutable(
    'dpkg',
    `echo "dpkg $*" >> "${registro}"
if [[ "$1" == --audit ]]; then ${dpkgAMedias ? "echo 'El paquete libgtk-4-1 está a medio configurar.'" : ':'}; fi`,
  );
  return {
    carpeta,
    orden: join(carpeta, 'install-deps'),
    registro,
    limpiar: () => {
      for (const pid of colgadosVivos(carpeta)) {
        process.kill(pid, 'SIGKILL');
      }
      rmSync(carpeta, { recursive: true, force: true });
    },
  };
}
function conTope(e: Ensayo, intentos: string) {
  return spawnSync('bash', [CON_TOPE, TOPE_S, intentos, GRACIA_S, e.orden, 'chromium', 'firefox'], {
    encoding: 'utf8',
    env: { PATH: `${e.carpeta}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
  });
}
function llamadas(e: Ensayo): string[] {
  return existsSync(e.registro) ? readFileSync(e.registro, 'utf8').trim().split('\n') : [];
}
/** Ninguno de los procesos colgados sigue vivo: el corte alcanzó a todo el grupo, no solo a la orden. */
function colgadosVivos(carpeta: string): number[] {
  const ruta = join(carpeta, 'colgados');
  const pids = existsSync(ruta) ? readFileSync(ruta, 'utf8').trim().split('\n').map(Number) : [];
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
}

test('sin cuelgue, la orden corre una vez, como siempre, sin cortes ni limpieza', (t) => {
  const e = ensayo();
  t.after(e.limpiar);
  const r = conTope(e, '3');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /quedaron instaladas en \d+ s \(intento 1 de 3\)/);
  assert.deepEqual(llamadas(e), ['install-deps chromium firefox']);
});

test('un fallo propio de la orden no se repite y conserva su estado', (t) => {
  const e = ensayo({ estado: ESTADO_PROPIO });
  t.after(e.limpiar);
  const r = conTope(e, '3');
  assert.equal(r.status, ESTADO_PROPIO);
  assert.deepEqual(llamadas(e), ['install-deps chromium firefox']);
});

test('un intento colgado se corta en su tope con todo su grupo y el segundo intento termina', (t) => {
  const e = ensayo({ colgadas: 1 });
  t.after(e.limpiar);
  const r = conTope(e, '3');
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stderr,
    /El espejo de Ubuntu no envía datos a ritmo útil \(más de 1 s\): se corta y se reintenta, intento 2 de 3\./,
  );
  assert.match(r.stdout, /\(intento 2 de 3\)/);
  assert.deepEqual(colgadosVivos(e.carpeta), []);
  // Entre los dos intentos se comprueba que nadie retiene los cerrojos y que dpkg no quedó a medias.
  assert.deepEqual(llamadas(e), [
    'install-deps chromium firefox',
    'lslocks --noheadings --output PATH',
    'dpkg --audit',
    'install-deps chromium firefox',
  ]);
});

test('si el corte deja dpkg a medias, se terminan de configurar sus paquetes antes de reintentar', (t) => {
  const e = ensayo({ colgadas: 1, dpkgAMedias: true });
  t.after(e.limpiar);
  const r = conTope(e, '2');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /dpkg quedó a medias con el corte/);
  assert.deepEqual(llamadas(e).slice(1, -1), [
    'lslocks --noheadings --output PATH',
    'dpkg --audit',
    'dpkg --configure -a',
  ]);
});

test('lo que no atiende TERM recibe KILL y, si todos los intentos se cuelgan, la preparación falla', (t) => {
  const e = ensayo({ colgadas: 2, sordo: true });
  t.after(e.limpiar);
  const r = conTope(e, '2');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /intento 2 de 2\./);
  assert.match(r.stderr, /no envió datos a ritmo útil en ninguno de los 2 intentos de 1 s/);
  assert.deepEqual(colgadosVivos(e.carpeta), []);
  assert.equal(llamadas(e).filter((l) => l.startsWith('install-deps')).length, 2);
});

test('si otro proceso retiene un cerrojo de APT tras el corte, no se reintenta', (t) => {
  const e = ensayo({ colgadas: 1 });
  t.after(e.limpiar);
  writeFileSync(join(e.carpeta, 'lslocks'), '#!/bin/bash\necho /var/lib/dpkg/lock-frontend\n');
  const r = conTope(e, '3');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /APT o dpkg siguen ocupados por otro proceso tras el corte/);
  assert.equal(llamadas(e).filter((l) => l.startsWith('install-deps')).length, 1);
});
