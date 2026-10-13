/* PWA 2026-10-13: network-only, sem cache e sem recarregar formulários abertos. */
/* Atualização de segurança: nenhum HTML privado, dado ou API é cacheado. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('falou-anotou-'))await caches.delete(key);await self.clients.claim();})());});
// Sem handler fetch: todas as solicitações dependem do servidor e da sessão.
