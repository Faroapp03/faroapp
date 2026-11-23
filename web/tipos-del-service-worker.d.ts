// Lo que el service worker (src/service-worker/, publicado como web/service-worker.js) usa del ámbito global de un
// Worker y las bibliotecas de TypeScript (`webworker`) no declaran en WorkerGlobalScope ni en sus eventos. Solo lo lee
// tsconfig.service-worker.json.

/** Los eventos del ciclo de vida y de las peticiones, que el ámbito de un Worker no relaciona con su nombre. */
interface WorkerGlobalScope {
  readonly clients: Clients;
  readonly registration: ServiceWorkerRegistration;
  skipWaiting(): Promise<void>;
  addEventListener(tipo: 'install' | 'activate' | 'periodicsync', oyente: (evento: ExtendableEvent) => void): void;
  addEventListener(tipo: 'message', oyente: (evento: ExtendableMessageEvent) => void): void;
  addEventListener(tipo: 'fetch', oyente: (evento: FetchEvent) => void): void;
}
