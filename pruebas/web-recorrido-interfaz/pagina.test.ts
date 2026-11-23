import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base, documento, entorno, evento, html, nodo } from './dom.ts';

function pendiente() {
  let resolver: (v: string) => void = () => assert.fail('sin promesa');
  let rechazar: (e: Error) => void = () => assert.fail('sin promesa');
  const promesa = new Promise<string>((si, no) => {
    resolver = si;
    rechazar = no;
  });
  return { promesa, resolver, rechazar };
}

test('retirar espera y empezar otra impide que éxito/fallo/finally viejos liberen el turno nuevo', async (t) => {
  entorno(t);
  base();
  const p = await import('../../web/scripts/recorrido/pagina.js');
  for (const fallo of [false, true]) {
    p.soltarEspera();
    const formulario = nodo('form');
    const boton = nodo('button', '', formulario);
    const volver = nodo('button', '', formulario);
    volver.dataset.volver = '1';
    const vieja = pendiente();
    const nueva = pendiente();
    let fallos = 0;
    const antes = p.enEspera({
      boton: html(boton),
      aviso: 'Vieja',
      trabajo: () => vieja.promesa,
      alFallar: () => {
        fallos += 1;
      },
    });
    assert.equal(formulario.getAttribute('aria-busy'), 'true');
    assert.equal(boton.getAttribute('aria-disabled'), 'true');
    assert.equal(volver.hasAttribute('aria-disabled'), false);
    assert.equal(
      await p.enEspera({ boton: null, aviso: '', trabajo: async () => assert.fail('doble envío') }),
      undefined,
    );
    p.soltarEspera();
    assert.equal(formulario.hasAttribute('aria-busy'), false);
    const despues = p.enEspera({ boton: html(boton), aviso: 'Nueva', trabajo: () => nueva.promesa });
    if (fallo) {
      vieja.rechazar(new Error('tardío'));
    } else {
      vieja.resolver('tardío');
    }
    assert.equal(await antes, undefined);
    assert.equal(fallos, 0);
    assert.equal(p.hayPeticionEnCurso(), true);
    assert.equal(formulario.getAttribute('aria-busy'), 'true');
    assert.ok(documento.getElementById('conversacion')?.textContent.includes('Nueva'));
    nueva.resolver('vigente');
    assert.equal(await despues, 'vigente');
    assert.equal(p.hayPeticionEnCurso(), false);
    assert.equal(formulario.hasAttribute('aria-busy'), false);
  }
});

test('cancelación no anuncia error; fallo vigente informa y recupera controles', async (t) => {
  entorno(t);
  base();
  const p = await import('../../web/scripts/recorrido/pagina.js');
  p.soltarEspera();
  const { errorDeCancelacion } = await import('../../web/scripts/recorrido/api/errores.js');
  let fallos = 0;
  const error = new Error('fallo');
  await p.enEspera({
    boton: null,
    aviso: 'Espera',
    trabajo: async () => {
      throw error;
    },
    alFallar: (e) => {
      assert.equal(e, error);
      fallos += 1;
    },
  });
  await p.enEspera({
    boton: null,
    aviso: 'Espera',
    trabajo: async () => {
      throw errorDeCancelacion();
    },
    alFallar: () => {
      fallos += 1;
    },
  });
  assert.equal(fallos, 1);
  assert.equal(p.hayPeticionEnCurso(), false);
  assert.equal(documento.getElementById('conversacion')?.children.length, 0);
});

test('error de campo sustituible conserva ayudas y se retira al corregir, sin perder foco', async (t) => {
  entorno(t);
  base();
  const p = await import('../../web/scripts/recorrido/pagina.js');
  const campo = nodo('textarea');
  campo.setAttribute('aria-describedby', 'ayuda');
  campo.focus();
  const uno = p.mostrarErrorDe(campo as unknown as HTMLTextAreaElement, 'Primero');
  const dos = p.mostrarErrorDe(campo as unknown as HTMLTextAreaElement, 'Segundo');
  assert.equal(campo.getAttribute('aria-describedby'), `ayuda ${dos.id}`);
  assert.notEqual(uno.id, dos.id);
  assert.equal(campo.getAttribute('aria-invalid'), 'true');
  campo.dispatchEvent(evento('input'));
  assert.equal(campo.getAttribute('aria-describedby'), 'ayuda');
  assert.equal(campo.hasAttribute('aria-invalid'), false);
  assert.equal(documento.activeElement, campo);
});
