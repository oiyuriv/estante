// Estante — service worker: app offline + recebe livros compartilhados (Android).
const VERSION = 'estante-v1'
const INBOX = 'estante-inbox'
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'lib/foliate/view.js', 'lib/foliate/epub.js', 'lib/foliate/epubcfi.js',
  'lib/foliate/mobi.js', 'lib/foliate/fb2.js', 'lib/foliate/comic-book.js',
  'lib/foliate/paginator.js', 'lib/foliate/fixed-layout.js', 'lib/foliate/progress.js',
  'lib/foliate/overlayer.js', 'lib/foliate/text-walker.js', 'lib/foliate/search.js',
  'lib/foliate/tts.js', 'lib/foliate/footnotes.js',
  'lib/foliate/vendor/zip.js', 'lib/foliate/vendor/fflate.js',
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== VERSION && k !== INBOX && k.startsWith('estante-')).map(k => caches.delete(k))
  )).then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Livro compartilhado pelo menu "Compartilhar" do Android
  if (e.request.method === 'POST' && url.pathname.endsWith('/compartilhar')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData()
        const files = form.getAll('livros').filter(f => f && f.size)
        const inbox = await caches.open(INBOX)
        let i = 0
        for (const f of files) {
          const key = `./inbox/${Date.now()}-${i++}`
          await inbox.put(key, new Response(f, {
            headers: { 'x-name': encodeURIComponent(f.name || 'livro'), 'content-type': f.type || 'application/octet-stream' },
          }))
        }
      } catch (err) { /* segue para o app mesmo assim */ }
      return Response.redirect('./?recebido=1', 303)
    })())
    return
  }

  if (e.request.method !== 'GET') return

  // Fontes do Google: guarda na primeira vez
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(e.request)
      if (hit) return hit
      const res = await fetch(e.request)
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone())
      return res
    }).catch(() => fetch(e.request)))
    return
  }

  if (url.origin !== location.origin) return

  // Página: tenta a rede primeiro (pega atualizações), cai pro cache offline
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put('./', copy)) }
      return res
    }).catch(() => caches.match('./')))
    return
  }

  // Arquivos do app: responde do cache na hora e atualiza em segundo plano
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true })
    const rede = fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone())
      return res
    }).catch(() => hit)
    if (hit) { e.waitUntil(rede); return hit }
    return rede
  }))
})
