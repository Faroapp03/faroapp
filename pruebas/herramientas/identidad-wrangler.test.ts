/** Compatibilidad privada con el bundle fijado. Todos los dispatchers de prueba carecen de red. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

const PRELOAD = fileURLToPath(new URL('../../herramientas/red/identidad-wrangler.cjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../node_modules/wrangler/wrangler-dist/cli.js', import.meta.url));
function ejecutar(codigo: string) {
  const temporal = mkdtempSync(join(tmpdir(), 'wrangler-identidad-'));
  try {
    return execFileSync(
      process.execPath,
      [
        '-e',
        `require('node:net').Socket.prototype.connect=()=>{throw new Error('Red prohibida en esta prueba');};${codigo}`,
      ],
      {
        timeout: 10000,
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: temporal,
        env: {
          PATH: process.env.PATH,
          HOME: temporal,
          TMPDIR: temporal,
          WRANGLER_SEND_METRICS: 'false',
          CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
        },
      },
    );
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}
test('ambas publicaciones conservan agente, this, argumentos, descriptor y operaciones ajenas sin red', () => {
  const resultado = ejecutar(`
const assert=require('node:assert/strict');require(${JSON.stringify(PRELOAD)});
const originales=[];const agente={secreto:17,dispatch(opciones,handler){assert.equal(this,agente);originales.push({opciones,handler});return 123;},cerrar(){return this.secreto;}};
const ajeno={};Object.defineProperty(ajeno,'x',{value:7});assert.equal(ajeno.x,7);
const opciones={origin:'https://example.invalid',path:'/v4',method:'POST',body:Buffer.from('cuerpo'),headers:['Authorization','Bearer sintetico','uSeR-aGeNt','wrangler/4.151.1','sec-ch-ua','hostil','Accept','application/json']};
const handler={};
for(const n of [1,2]){
 const clave=Symbol.for('undici.globalDispatcher.'+n);
 Object.defineProperty(globalThis,clave,{value:agente,writable:true,enumerable:false,configurable:false});
 const activo=globalThis[clave];assert.equal(activo.dispatch(opciones,handler),123);assert.equal(activo.cerrar(),17);
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,clave);assert.equal(descriptor.writable,true);assert.equal(descriptor.configurable,false);assert.equal(descriptor.enumerable,false);
}
assert.equal(originales.length,2);
for(const {opciones:actual,handler:h} of originales){assert.equal(h,handler);assert.equal(actual.body,opciones.body);assert.equal(actual.origin,opciones.origin);assert.equal(actual.path,opciones.path);assert.equal(actual.method,'POST');
 const entradas=[];for(let i=0;i<actual.headers.length;i+=2)entradas.push([actual.headers[i],actual.headers[i+1]]);
 assert.deepEqual(Object.fromEntries(entradas),{Authorization:'Bearer sintetico',Accept:'application/json',...${JSON.stringify(IDENTIDAD_WEB)}});
}
assert.equal(opciones.headers[3],'wrangler/4.151.1');
assert.throws(()=>globalThis[Symbol.for('undici.globalDispatcher.1')].dispatch({...opciones,headers:{Authorization:{invalido:true}}},handler),/incompatibles/);assert.equal(originales.length,2);
const delFetch={Authorization:'Bearer sintetico','user-agent':'wrangler/4.151.1',Accept:'application/json'};
globalThis[Symbol.for('undici.globalDispatcher.1')].dispatch({...opciones,headers:delFetch},handler);
assert.deepEqual(originales[2].opciones.headers,{Authorization:'Bearer sintetico',Accept:'application/json',...${JSON.stringify(IDENTIDAD_WEB)}});
assert.equal(delFetch['user-agent'],'wrangler/4.151.1');
console.log('sin red');
`);
  assert.match(resultado, /sin red/);
});
test('el bundle real publica ambos dispatchers bajo la adaptación antes de usarlos', () => {
  assert.doesNotThrow(() =>
    ejecutar(`
const assert=require('node:assert/strict');require(${JSON.stringify(PRELOAD)});
require(${JSON.stringify(CLI)});
for(const n of [1,2]){const d=globalThis[Symbol.for('undici.globalDispatcher.'+n)];assert.equal(typeof d.dispatch,'function');assert.match(d.dispatch.toString(),/cabeceras/);}
`),
  );
});
test('cambio de versión o bundle se rechaza antes de cualquier dispatch', () => {
  assert.doesNotThrow(() =>
    ejecutar(`
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {comprobarWrangler}=require(${JSON.stringify(PRELOAD)});
const r=fs.mkdtempSync(path.join(os.tmpdir(),'compatibilidad-wrangler-'));
try{fs.writeFileSync(path.join(r,'package.json'),JSON.stringify({version:'otra'}));assert.throws(()=>comprobarWrangler(r),/incompatible/);
fs.writeFileSync(path.join(r,'package.json'),JSON.stringify({version:'4.151.1'}));fs.mkdirSync(path.join(r,'bin'));fs.writeFileSync(path.join(r,'bin/wrangler.js'),'cambiado');assert.throws(()=>comprobarWrangler(r),/no comprobado/);
}finally{fs.rmSync(r,{recursive:true,force:true});}
`),
  );
});
