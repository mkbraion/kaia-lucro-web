'use strict';

// Service worker do KAIA Lucro.
//
// O Flutter 3.44 aposentou o dele: o flutter_service_worker.js que ele
// gera hoje só se auto-desregistra. Sem service worker o app não abre
// offline e o navegador não oferece "instalar", que é o ponto de ter um
// app que se atualiza sozinho em vez de baixar APK toda hora.
//
// Estratégia por tipo de arquivo:
//   navegação e código do app  → rede primeiro (atualização chega na hora)
//   motor gráfico e fontes     → cache primeiro, revalidando em segundo plano
//   Supabase e qualquer API    → nunca passa por aqui

const CACHE = 'kaia-lucro-v2';

// Casa com main.dart.js, flutter_bootstrap.js, flutter.js, manifest.json
// e o próprio index — tudo que muda a cada publicação.
const CODIGO = /\/(index\.html|flutter_bootstrap\.js|flutter\.js|main\.dart\.js|manifest\.json)$/;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['./', './index.html']).catch(() => {})),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE);
  try {
    // 'no-cache' obriga a revalidar com o servidor (manda o ETag e aceita
    // 304). Sem isto o Cache-Control de 10 minutos do GitHub Pages faria o
    // navegador devolver o código antigo de dentro do cache HTTP, e a
    // "rede primeiro" seria mentira: o index viria novo e o main.dart.js
    // velho — versões misturadas, pior que não atualizar.
    //
    // A Request é montada da URL em vez de reaproveitar a original porque
    // pedido de navegação tem mode 'navigate', que o construtor recusa.
    const resp = await fetch(new Request(req.url, {
      cache: 'no-cache',
      credentials: 'same-origin',
    }));
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (_) {
    // Offline: serve o que tiver guardado. Para navegação, cai no index,
    // senão o app não abre nem estando tudo em cache.
    const guardado = await cache.match(req);
    if (guardado) return guardado;
    if (req.mode === 'navigate') {
      const raiz = await cache.match('./index.html');
      if (raiz) return raiz;
    }
    throw _;
  }
}

async function cacheComRevalidacao(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req);
  const rede = fetch(req)
    .then((resp) => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => guardado);
  return guardado || rede;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase, Storage, WhatsApp: sempre direto na rede. Guardar resposta
  // de API em cache faria o app mostrar estoque e saldo velhos.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || CODIGO.test(url.pathname)) {
    e.respondWith(redePrimeiro(req));
    return;
  }

  e.respondWith(cacheComRevalidacao(req));
});
