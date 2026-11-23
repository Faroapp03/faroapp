/** Los dobles de ClientRequest no abren sockets: contrastan cabeceras y delegación. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { configuracionApt } from '../../herramientas/red/configurar-apt.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

const PRELOAD = fileURLToPath(new URL('../../herramientas/red/identidad-http.cjs', import.meta.url));
test('preload sustituye solo identidad conservando ambas firmas, destino, TLS, autorización y callback sin red', () => {
  const codigo = `
const assert=require('node:assert/strict');
const http=require('node:http'),https=require('node:https');
const llamadas=[];
for(const transporte of [http,https]) transporte.request=function(...args){
 const headers={Authorization:'Bearer sintetico'};
 const resultado={headers,setHeader(n,v){headers[n]=v;},end(){this.terminada=true;}};
 llamadas.push({args,resultado});return resultado;
};
require(${JSON.stringify(PRELOAD)});
const callback=()=>{};
const opciones={ca:'CA sintetica',rejectUnauthorized:true,headers:{Authorization:'Bearer sintetico','User-Agent':'no debe salir'}};
const url=new URL('https://example.invalid/recurso');
const a=https.request(url,opciones,callback);const b=http.get({hostname:'example.invalid',headers:opciones.headers},callback);
for(const {resultado} of llamadas) assert.deepEqual(resultado.headers,{Authorization:'Bearer sintetico',...${JSON.stringify(IDENTIDAD_WEB)}});
assert.equal(llamadas[0].args[0],url);assert.equal(llamadas[0].args[1],opciones);assert.equal(llamadas[0].args[2],callback);
assert.equal(opciones.rejectUnauthorized,true);assert.equal(opciones.headers['User-Agent'],'no debe salir');
assert.equal(b.terminada,true);assert.equal(a.terminada,undefined);
`;
  assert.doesNotThrow(() => execFileSync(process.execPath, ['-e', codigo], { timeout: 5000, stdio: 'pipe' }));
});

test('APT declara únicamente su UA genérica, sin simular soporte de pistas o cabeceras HTML', () => {
  assert.equal(
    configuracionApt(),
    `${['http', 'https'].map((protocolo) => `Acquire::${protocolo}::User-Agent "${IDENTIDAD_WEB['User-Agent']}";`).join('\n')}\n`,
  );
  assert.doesNotMatch(configuracionApt(), /sec-ch-ua|Accept-Language|Sec-Fetch|DataReader/);
});
