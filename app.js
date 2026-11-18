import { makeBook } from './lib/foliate/view.js'

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]

/* ================= Banco (IndexedDB) ================= */
const DB_NAME = 'estante'
let dbp
const db = () => dbp ??= new Promise((ok, err) => {
  const r = indexedDB.open(DB_NAME, 1)
  r.onupgradeneeded = () => {
    r.result.createObjectStore('livros', { keyPath: 'id' })
    r.result.createObjectStore('arquivos')
  }
  r.onsuccess = () => ok(r.result)
  r.onerror = () => err(r.error)
})
const tx = async (store, mode, fn) => {
  const d = await db()
  return new Promise((ok, err) => {
    const t = d.transaction(store, mode)
    const res = fn(t.objectStore(store))
    t.oncomplete = () => ok(res?.result)
    t.onerror = () => err(t.error)
    t.onabort = () => err(t.error)
  })
}
const Livros = {
  todos: () => tx('livros', 'readonly', s => s.getAll()),
  um: id => tx('livros', 'readonly', s => s.get(id)),
  salvar: l => tx('livros', 'readwrite', s => s.put(l)),
  remover: async id => {
    await tx('livros', 'readwrite', s => s.delete(id))
    await tx('arquivos', 'readwrite', s => s.delete(id))
  },
  arquivo: id => tx('arquivos', 'readonly', s => s.get(id)),
  salvarArquivo: (id, blob) => tx('arquivos', 'readwrite', s => s.put(blob, id)),
}

/* ================= Preferências de leitura ================= */
const PADRAO = { tamanho: 19, tema: 'noite', cor: 'auto', fonte: 'literata', linha: '1.6', margem: '7', rolagem: false, virar: 'bordas', ordem: 'recentes', v: 2 }
let prefs = { ...PADRAO }
try {
  const salvo = JSON.parse(localStorage.getItem('estante-prefs') || '{}')
  // versão 2: o padrão passou a ser o modo noturno
  if (!salvo.v) { salvo.tema = 'noite'; salvo.v = 2 }
  prefs = { ...PADRAO, ...salvo }
} catch {}
const salvarPrefs = () => { try { localStorage.setItem('estante-prefs', JSON.stringify(prefs)) } catch {} }

/* ================= Utilidades ================= */
const textoDe = x => {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (Array.isArray(x)) return x.map(textoDe).filter(Boolean).join(', ')
  if (x.name) return textoDe(x.name)
  const k = Object.keys(x)
  return k.length ? textoDe(x[k[0]]) : ''
}
const semExtensao = n => n.replace(/\.(epub|mobi|azw3?|kf8|fb2|fbz|cbz|prc)$/i, '').replace(/[_]+/g, ' ').trim()
const hueDe = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const pct = f => `${Math.round((f || 0) * 100)}%`
const tamanhoArq = b => b > 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`
const EXT_OK = /\.(epub|mobi|azw3?|kf8|prc|fb2|fbz|cbz)$/i

let avisoT
function aviso(msg, ms = 2600) {
  const el = $('#aviso')
  el.textContent = msg
  el.classList.add('on')
  clearTimeout(avisoT)
  avisoT = setTimeout(() => el.classList.remove('on'), ms)
}

/* ================= Capa ================= */
const urls = new Map()
function capaHTML(l) {
  if (l.capa) {
    let u = urls.get(l.id)
    if (!u) { u = URL.createObjectURL(l.capa); urls.set(l.id, u) }
    return `<div class="capa"><img src="${u}" alt="" loading="lazy"></div>`
  }
  return `<div class="capa capa-g" style="--h:${hueDe(l.titulo)}"><b>${esc(l.titulo)}</b><i></i><small>${esc(l.autor)}</small></div>`
}

/* ================= Importar livros ================= */
async function importar(arquivos) {
  arquivos = [...arquivos].filter(Boolean)
  if (!arquivos.length) return
  navigator.storage?.persist?.().catch(() => {})
  const existentes = await Livros.todos()
  let ok = 0, repetidos = 0, ruins = []
  let ultimo
  aviso(arquivos.length > 1 ? `Adicionando ${arquivos.length} livros…` : 'Adicionando livro…', 60000)
  for (const f of arquivos) {
    const nome = f.name || 'livro'
    if (existentes.some(e => e.nome === nome && e.tamanho === f.size)) { repetidos++; continue }
    try {
      const book = await makeBook(new File([f], nome, { type: f.type }))
      let capa = null
      try { capa = await book.getCover?.() } catch {}
      if (capa && !(capa instanceof Blob)) capa = null
      if (capa && capa.size > 3e6) capa = null
      const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())
      const livro = {
        id, nome, tamanho: f.size, tipo: f.type || '',
        titulo: textoDe(book.metadata?.title) || semExtensao(nome),
        autor: textoDe(book.metadata?.author) || '',
        capa, adicionado: Date.now(), aberto: 0, progresso: 0, cfi: null,
      }
      book.destroy?.()
      await Livros.salvarArquivo(id, f)
      await Livros.salvar(livro)
      existentes.push(livro)
      ultimo = livro
      ok++
    } catch (e) {
      console.error(e)
      ruins.push(nome)
    }
  }
  await desenharEstante()
  const partes = []
  if (ok) partes.push(ok === 1 ? `“${ultimo.titulo}” entrou na estante` : `${ok} livros adicionados`)
  if (repetidos) partes.push(repetidos === 1 ? '1 já estava na estante' : `${repetidos} já estavam na estante`)
  if (ruins.length) partes.push(ruins.length === 1 ? `não consegui abrir “${ruins[0]}”` : `${ruins.length} arquivos não abriram`)
  aviso(partes.join(' · ') || 'Nada adicionado', 3800)
}

$('#arquivo').addEventListener('change', e => { importar(e.target.files); e.target.value = '' })
const escolher = () => $('#arquivo').click()
$('#btn-add').addEventListener('click', escolher)
$('#btn-add-vazio').addEventListener('click', escolher)

// arrastar e soltar (computador)
addEventListener('dragover', e => e.preventDefault())
addEventListener('drop', e => {
  e.preventDefault()
  const fs = [...(e.dataTransfer?.files || [])].filter(f => EXT_OK.test(f.name))
  if (fs.length) importar(fs)
})

// "Abrir com" (File Handling)
if ('launchQueue' in window) {
  launchQueue.setConsumer(async p => {
    if (!p.files?.length) return
    const fs = await Promise.all(p.files.map(h => h.getFile()))
    importar(fs)
  })
}

// Compartilhado pelo Android (o service worker guardou na caixa de entrada)
async function receberCompartilhados() {
  if (!('caches' in window)) return
  const inbox = await caches.open('estante-inbox')
  const reqs = await inbox.keys()
  if (!reqs.length) return
  const fs = []
  for (const r of reqs) {
    const res = await inbox.match(r)
    const nome = decodeURIComponent(res.headers.get('x-name') || 'livro')
    fs.push(new File([await res.blob()], nome, { type: res.headers.get('content-type') || '' }))
    await inbox.delete(r)
  }
  history.replaceState(null, '', location.pathname)
  await importar(fs)
}

/* ================= Estante ================= */
let livrosCache = []
function colunas() {
  const w = Math.min(innerWidth, 980) - 36
  if (w < 380) return 3
  if (w < 560) return 4
  if (w < 760) return 5
  return 6
}

async function desenharEstante() {
  livrosCache = await Livros.todos()
  const vazio = !livrosCache.length
  $('#vazio').hidden = !vazio
  $('#lista').hidden = vazio

  // continuar lendo
  const emLeitura = livrosCache.filter(l => l.aberto && l.progresso < 0.995).sort((a, b) => b.aberto - a.aberto)[0]
  const cont = $('#continuar')
  if (emLeitura) {
    cont.hidden = false
    cont.dataset.id = emLeitura.id
    cont.innerHTML = `${capaHTML(emLeitura)}
      <div>
        <p class="cont-rot">Continuar lendo</p>
        <h2 class="cont-tit">${esc(emLeitura.titulo)}</h2>
        <p class="cont-aut">${esc(emLeitura.autor)}</p>
        <div class="barra"><i style="width:${pct(emLeitura.progresso)}"></i></div>
        <div class="cont-pct"><span>${esc(emLeitura.capitulo || '')}</span><b>${pct(emLeitura.progresso)}</b></div>
      </div>`
  } else cont.hidden = true

  desenharMetaHoje(vazio)
  if (vazio) return atualizarEspaco()

  $('#contagem').textContent = livrosCache.length === 1 ? '1 livro' : `${livrosCache.length} livros`
  $('#busca-wrap').hidden = livrosCache.length < 7
  $$('.ordem button').forEach(b => b.classList.toggle('on', b.dataset.ordem === prefs.ordem))

  const q = $('#busca').value.trim().toLowerCase()
  let lista = livrosCache.filter(l => !q || `${l.titulo} ${l.autor}`.toLowerCase().includes(q))
  const cmp = new Intl.Collator('pt-BR', { sensitivity: 'base' })
  if (prefs.ordem === 'titulo') lista.sort((a, b) => cmp.compare(a.titulo, b.titulo))
  else if (prefs.ordem === 'autor') lista.sort((a, b) => cmp.compare(a.autor || '~', b.autor || '~') || cmp.compare(a.titulo, b.titulo))
  else lista.sort((a, b) => Math.max(b.aberto, b.adicionado) - Math.max(a.aberto, a.adicionado))

  const cols = colunas()
  let html = ''
  for (let i = 0; i < lista.length; i += cols) {
    html += `<div class="prateleira" style="--cols:${cols}">`
    for (const l of lista.slice(i, i + cols)) {
      const p = l.progresso >= 0.995 ? '<span class="livro-pct lido">Lido</span>' : l.progresso > 0.005 ? `<span class="livro-pct">${pct(l.progresso)}</span>` : ''
      html += `<div class="livro">
        <button class="livro-btn" data-ler="${l.id}" aria-label="Ler ${esc(l.titulo)}">${capaHTML(l)}</button>
        ${p}
        <button class="livro-mais" data-info="${l.id}" aria-label="Opções de ${esc(l.titulo)}"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="19" cy="12" r=".8"/></svg></button>
      </div>`
    }
    html += '</div>'
  }
  if (!lista.length) html = `<p style="color:var(--tinta-2);text-align:center;padding:30px 0">Nenhum livro com “${esc(q)}”.</p>`
  $('#prateleiras').innerHTML = html
  atualizarEspaco()
}

async function atualizarEspaco() {
  const est = await navigator.storage?.estimate?.().catch(() => null)
  const total = livrosCache.reduce((s, l) => s + (l.tamanho || 0), 0)
  $('#espaco').textContent = livrosCache.length
    ? `Seus livros ocupam ${tamanhoArq(total)} neste aparelho.` + (est?.quota ? ` Espaço livre para o app: ${tamanhoArq(Math.max(0, est.quota - est.usage))}.` : '')
    : ''
}

$('#prateleiras').addEventListener('click', e => {
  const ler = e.target.closest('[data-ler]')
  const info = e.target.closest('[data-info]')
  if (info) abrirModal(info.dataset.info)
  else if (ler) abrirLeitor(ler.dataset.ler)
})
$('#continuar').addEventListener('click', e => abrirLeitor(e.currentTarget.dataset.id))
$$('.ordem button').forEach(b => b.addEventListener('click', () => { prefs.ordem = b.dataset.ordem; salvarPrefs(); desenharEstante() }))
$('#busca').addEventListener('input', () => desenharEstante())
let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if ($('#leitor').hidden) desenharEstante() }, 150) })

const h = new Date().getHours()
$('#saudacao').textContent = h < 5 ? 'Boa leitura, coruja' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'

/* ================= Modal do livro ================= */
let modalId
async function abrirModal(id) {
  const l = await Livros.um(id)
  if (!l) return
  modalId = id
  $('#ml-capa').outerHTML = capaHTML(l).replace('class="capa', 'id="ml-capa" class="capa')
  $('#ml-titulo').textContent = l.titulo
  $('#ml-autor').textContent = l.autor || 'Autor desconhecido'
  const formato = (l.nome.match(/\.(\w+)$/)?.[1] || '').toUpperCase()
  $('#ml-meta').textContent = [formato, tamanhoArq(l.tamanho), l.progresso > 0.005 ? `${pct(l.progresso)} lido` : 'Não começado'].filter(Boolean).join(' · ')
  $('#ml-ler').textContent = l.progresso > 0.005 && l.progresso < 0.995 ? 'Continuar leitura' : 'Ler'
  $('#ml-zerar').hidden = !(l.progresso > 0.005)
  $('#modal-livro').hidden = false
}
const fecharModal = () => { $('#modal-livro').hidden = true }
$('#modal-livro').addEventListener('click', e => { if (e.target.id === 'modal-livro' || e.target.closest('[data-fechar]')) fecharModal() })
$('#ml-ler').addEventListener('click', () => { fecharModal(); abrirLeitor(modalId) })
$('#ml-zerar').addEventListener('click', async () => {
  const l = await Livros.um(modalId)
  Object.assign(l, { progresso: 0, cfi: null, capitulo: '' })
  await Livros.salvar(l)
  fecharModal(); abrirLeitor(modalId)
})
$('#ml-remover').addEventListener('click', async () => {
  const l = await Livros.um(modalId)
  if (!confirm(`Remover “${l.titulo}” da estante? O arquivo sai deste app (o original no seu celular continua onde estava).`)) return
  await Livros.remover(modalId)
  const u = urls.get(modalId); if (u) { URL.revokeObjectURL(u); urls.delete(modalId) }
  fecharModal()
  await desenharEstante()
  aviso('Livro removido')
})

/* ================= Leitor ================= */
const TEMAS = {
  papel: { fundo: '#F6F0E4', tinta: '#2B241E', link: '#9A4A24', escuro: false },
  branco: { fundo: '#FFFFFF', tinta: '#1A1A1A', link: '#9A4A24', escuro: false },
  sepia: { fundo: '#EADBC0', tinta: '#46372A', link: '#8A3F1C', escuro: false },
  noite: { fundo: '#1A1816', tinta: '#D8D0C4', link: '#E8956A', escuro: true },
  preto: { fundo: '#000000', tinta: '#E6E6E6', link: '#E8956A', escuro: true },
}
// cor da letra (independente do fundo)
const CORES = {
  auto: null,
  branca: '#FFFFFF', creme: '#F1E6D2', cinza: '#B9B4AC',
  marrom: '#4A3727', preta: '#111111',
}
// fontes de leitura; as do Google são carregadas só quando escolhidas
const FONTES = {
  original: { nome: 'Do livro', css: null },
  sistema: { nome: 'Georgia', css: "'Iowan Old Style', Georgia, 'Palatino Linotype', serif" },
  literata: { nome: 'Literata', css: "'Literata', Georgia, serif", g: 'Literata:ital,wght@0,400;0,600;1,400' },
  lora: { nome: 'Lora', css: "'Lora', Georgia, serif", g: 'Lora:ital,wght@0,400;0,600;1,400' },
  merriweather: { nome: 'Merriweather', css: "'Merriweather', Georgia, serif", g: 'Merriweather:ital,wght@0,300;0,400;0,700;1,400' },
  garamond: { nome: 'Garamond', css: "'EB Garamond', Garamond, serif", g: 'EB+Garamond:ital,wght@0,400;0,600;1,400' },
  crimson: { nome: 'Crimson', css: "'Crimson Pro', Georgia, serif", g: 'Crimson+Pro:ital,wght@0,400;0,600;1,400' },
  atkinson: { nome: 'Atkinson', css: "'Atkinson Hyperlegible', system-ui, sans-serif", g: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400' },
  nunito: { nome: 'Nunito Sans', css: "'Nunito Sans', system-ui, sans-serif", g: 'Nunito+Sans:ital,wght@0,400;0,700;1,400' },
  sans: { nome: 'Sistema', css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
}
if (!FONTES[prefs.fonte]) prefs.fonte = prefs.fonte === 'serif' ? 'literata' : 'original'
if (!(prefs.cor in CORES)) prefs.cor = 'auto'
if (!TEMAS[prefs.tema]) prefs.tema = 'papel'
if (!['1.4', '1.6', '1.85'].includes(prefs.linha)) prefs.linha = '1.6'
if (!['bordas', 'deslizar'].includes(prefs.virar)) prefs.virar = 'bordas'
// botões de fonte, cada um escrito na própria fonte
$('#aa-fonte').innerHTML = Object.entries(FONTES).map(([k, f]) =>
  `<button data-v="${k}" style="font-family:${(f.css || 'inherit').replace(/"/g, "'")}">${f.nome}</button>`).join('')

// carrega as fontes na página principal para a prévia dos botões
{
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = 'https://fonts.googleapis.com/css2?' + Object.values(FONTES).filter(f => f.g).map(f => 'family=' + f.g.split(':')[0]).join('&') + '&display=swap'
  document.head.append(l)
}

const corDaLetra = () => CORES[prefs.cor] || (TEMAS[prefs.tema] || TEMAS.papel).tinta

const cssLeitura = () => {
  const t = TEMAS[prefs.tema] || TEMAS.papel
  const f = FONTES[prefs.fonte] || FONTES.original
  const tinta = corDaLetra()
  return `${f.g ? `@import url('https://fonts.googleapis.com/css2?family=${f.g}&display=swap');` : ''}
    @namespace epub "http://www.idpf.org/2007/ops";
    html { font-size: ${prefs.tamanho}px !important; color: ${tinta} !important; background: ${t.fundo} !important; color-scheme: ${t.escuro ? 'dark' : 'light'}; }
    body { font-size: 1rem !important; color: ${tinta} !important; background: transparent !important; }
    body * { color: inherit !important; background-color: transparent !important; }
    p, li, blockquote, dd, div, span { font-size: inherit; }
    p, li, blockquote, dd {
      line-height: ${prefs.linha} !important;
      text-align: start !important; -webkit-hyphens: auto; hyphens: auto;
      widows: 2; orphans: 2;
    }
    ${f.css ? `body, p, li, blockquote, dd, div, span, td, h1, h2, h3, h4, h5, h6 { font-family: ${f.css} !important; }` : ''}
    a:link, a:visited { color: ${t.link} !important; }
    img, svg, video { max-width: 100%; height: auto; }
    ${t.escuro ? 'img { opacity: .9; }' : ''}
    pre { white-space: pre-wrap !important; }
    [align="center"] { text-align: center; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"] { display: none; }
  `
}

let view = null, livroAtual = null, salvarT = null, secoes = []

function aplicarAparencia() {
  const lt = $('#leitor')
  lt.dataset.tema = prefs.tema
  lt.style.setProperty('--l-letra', corDaLetra())
  document.querySelector('meta[name="theme-color"]:not([media])')?.remove()
  if (!lt.hidden) {
    const m = document.createElement('meta'); m.name = 'theme-color'; m.content = (TEMAS[prefs.tema] || TEMAS.papel).fundo
    document.head.append(m)
  }
  // painel Aa
  $('#aa-slider').value = prefs.tamanho
  $('#aa-slider').style.setProperty('--p', `${((prefs.tamanho - 14) / 18) * 100}%`)
  $('#aa-valor').textContent = `${prefs.tamanho} px`
  $$('#aa-temas button').forEach(b => b.classList.toggle('on', b.dataset.tema === prefs.tema))
  $$('#aa-cores button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.cor))
  $$('#aa-fonte button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.fonte))
  $$('#aa-linha button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.linha))
  $$('#aa-margem button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.margem))
  $$('#aa-virar button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.virar))
  $('#aa-rolagem').checked = !!prefs.rolagem
  $('#aa-virar-wrap').hidden = !!prefs.rolagem
  if (!view?.renderer) return
  view.renderer.setAttribute('flow', prefs.rolagem ? 'scrolled' : 'paginated')
  view.renderer.setAttribute('gap', `${prefs.margem}%`)
  view.renderer.setAttribute('margin', '0px')
  view.renderer.setAttribute('max-inline-size', '680px')
  view.renderer.setAttribute('max-column-count', '2')
  view.renderer.setStyles?.(cssLeitura())
}

async function abrirLeitor(id) {
  const l = await Livros.um(id)
  const blob = l && await Livros.arquivo(id)
  if (!blob) return aviso('Não achei o arquivo desse livro')
  livroAtual = l
  atividade(); mostrarMeta()
  const lt = $('#leitor')
  lt.hidden = false
  lt.classList.remove('ui')
  document.body.style.overflow = 'hidden'
  $('#l-titulo').textContent = l.titulo
  $('#l-autor').textContent = l.autor
  $('#l-capitulo-mini').textContent = l.titulo
  $('#l-pct-mini').textContent = ''
  const palco = $('#l-palco')
  palco.innerHTML = '<div class="carregando">Abrindo o livro…</div>'
  if (history.state?.leitor !== id) history.pushState({ leitor: id }, '')
  aplicarAparencia()

  try {
    view = document.createElement('foliate-view')
    const file = new File([blob], l.nome, { type: l.tipo || blob.type })
    await view.open(file)
    palco.innerHTML = ''
    palco.append(view)
    view.addEventListener('relocate', aoMover)
    view.addEventListener('load', aoCarregarSecao)
    view.addEventListener('external-link', e => { e.preventDefault(); window.open(e.detail.a.href, '_blank', 'noopener') })
    secoes = view.getSectionFractions?.() || []
    montarSumario()
    aplicarAparencia()
    await view.init({ lastLocation: l.cfi || null, showTextStart: !l.cfi })
    l.aberto = Date.now()
    Livros.salvar(l)
  } catch (e) {
    console.error(e)
    palco.innerHTML = '<div class="carregando">Não consegui abrir este arquivo.</div>'
  }
}

function aoMover({ detail }) {
  atividade()
  const { fraction, tocItem } = detail
  const f = fraction ?? 0
  const cap = tocItem?.label?.trim() || ''
  $('#l-slider').value = f
  $('#l-slider').style.setProperty('--p', `${f * 100}%`)
  $('#l-pct').textContent = pct(f)
  $('#l-pct-mini').textContent = pct(f)
  $('#l-capitulo').textContent = cap
  $('#l-capitulo-mini').textContent = cap || livroAtual?.titulo || ''
  if (tocItem?.href) $$('#sumario button').forEach(b => b.classList.toggle('atual', b.dataset.href === tocItem.href))
  if (!livroAtual) return
  Object.assign(livroAtual, { progresso: f, cfi: detail.cfi || livroAtual.cfi, capitulo: cap, aberto: Date.now() })
  clearTimeout(salvarT)
  salvarT = setTimeout(() => Livros.salvar(livroAtual), 400)
}

// Toques. Para não virar página sem querer:
// - só as faixas das bordas (20% de cada lado) viram; o meio mostra/esconde os controles
// - "Só deslizando": nenhum toque vira página
// - toque que arrastou, demorou (segurar/selecionar) ou veio logo depois de outro é ignorado
let toqueIni = null, ultimaVirada = 0
function aoCarregarSecao({ detail: { doc } }) {
  doc.addEventListener('touchstart', e => {
    const t = e.touches[0]
    toqueIni = t ? { x: t.screenX, y: t.screenY, t: Date.now(), n: e.touches.length } : null
    atividade()
  }, { passive: true })
  doc.addEventListener('click', e => {
    if (e.defaultPrevented || e.target.closest?.('a[href]')) return
    if (doc.getSelection()?.toString()) return
    if (toqueIni) {
      const andou = Math.hypot(e.screenX - toqueIni.x, e.screenY - toqueIni.y)
      const demorou = Date.now() - toqueIni.t
      const multi = toqueIni.n > 1
      toqueIni = null
      if (andou > 12 || demorou > 450 || multi) return
    }
    const fr = doc.defaultView?.frameElement
    const x = (fr?.getBoundingClientRect().left || 0) + e.clientX
    toque(x)
  })
  doc.addEventListener('keydown', teclas)
}
function toque(x) {
  const lt = $('#leitor')
  atividade()
  if (!$('#folha-aa').hidden || !$('#folha-sumario').hidden) return fecharFolhas()
  if (lt.classList.contains('ui')) return lt.classList.remove('ui')
  const w = innerWidth
  const borda = prefs.rolagem || prefs.virar === 'deslizar' ? 0 : Math.min(w * 0.2, 120)
  if (x > borda && x < w - borda) return lt.classList.add('ui')
  if (Date.now() - ultimaVirada < 350) return // toque duplo não vira duas
  ultimaVirada = Date.now()
  if (x <= borda) view?.goLeft()
  else view?.goRight()
}

/* ================= Meta de leitura diária ================= */
// Conta o tempo com o livro aberto e a tela ligada; pausa se ficar 4 min sem mexer.
const META_MIN = 30
const OCIOSO = 4 * 60 * 1000
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
let leitura = { dias: {}, avisado: '' }
try { leitura = { ...leitura, ...JSON.parse(localStorage.getItem('estante-leitura') || '{}') } } catch {}
const salvarLeitura = () => { try { localStorage.setItem('estante-leitura', JSON.stringify(leitura)) } catch {} }
let ultimaAtividade = Date.now(), ultimoTique = Date.now()
function atividade() { ultimaAtividade = Date.now() }
const minutosHoje = () => Math.floor((leitura.dias[hoje()] || 0) / 60)
function sequencia() {
  let n = 0
  const d = new Date()
  if ((leitura.dias[hoje()] || 0) < META_MIN * 60) d.setDate(d.getDate() - 1) // hoje ainda não conta, mas não quebra
  for (;;) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if ((leitura.dias[k] || 0) >= META_MIN * 60) { n++; d.setDate(d.getDate() - 1) } else break
  }
  return n
}
function mostrarMeta() {
  const m = Math.min(minutosHoje(), META_MIN)
  const p = m / META_MIN
  const ok = minutosHoje() >= META_MIN
  const txt = ok ? 'Meta de hoje feita' : `${m} de ${META_MIN} min hoje`
  $('#l-meta').textContent = txt
  $('#l-meta-mini').textContent = ok ? '✓ 30 min' : `${m} min`
  $('#l-meta-anel').style.setProperty('--p', p)
  $('#leitor').classList.toggle('meta-ok', ok)
}
setInterval(() => {
  const agora = Date.now()
  const passou = Math.min(agora - ultimoTique, 15000)
  ultimoTique = agora
  if ($('#leitor').hidden || document.hidden || !view) return
  if (agora - ultimaAtividade > OCIOSO) return
  const k = hoje()
  const antes = leitura.dias[k] || 0
  leitura.dias[k] = antes + passou / 1000
  // guarda só os últimos 400 dias
  const chaves = Object.keys(leitura.dias)
  if (chaves.length > 400) chaves.sort().slice(0, chaves.length - 400).forEach(c => delete leitura.dias[c])
  if (antes < META_MIN * 60 && leitura.dias[k] >= META_MIN * 60 && leitura.avisado !== k) {
    leitura.avisado = k
    comemorar()
  }
  salvarLeitura()
  mostrarMeta()
}, 5000)

function desenharMetaHoje(vazio) {
  const el = $('#meta-hoje')
  el.hidden = vazio
  if (vazio) return
  const min = minutosHoje()
  const ok = min >= META_MIN
  const s = sequencia()
  // últimos 7 dias
  const dias = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const p = Math.min(1, (leitura.dias[k] || 0) / (META_MIN * 60))
    dias.push(`<span class="dia${p >= 1 ? ' cheio' : ''}${i === 0 ? ' hoje' : ''}" style="--p:${p}"><i></i><b>${'DSTQQSS'[d.getDay()]}</b></span>`)
  }
  el.classList.toggle('ok', ok)
  el.innerHTML = `
    <div class="anel" style="--p:${Math.min(1, min / META_MIN)}"><span>${ok ? '✓' : Math.min(min, META_MIN)}</span></div>
    <div class="meta-txt">
      <p class="cont-rot">Leitura de hoje</p>
      <h2>${ok ? `Meta feita: ${min} min lidos` : `${min} de ${META_MIN} minutos`}</h2>
      <p>${ok ? (s > 1 ? `${s} dias seguidos. Que ritmo!` : 'Boa! Amanhã tem mais.') : min ? `Faltam ${META_MIN - min} min para a meta.` : 'Meta: 30 minutos de leitura por dia.'}${!ok && s ? ` Sequência: ${s} ${s > 1 ? 'dias' : 'dia'}.` : ''}</p>
    </div>
    <div class="semana" aria-label="Últimos 7 dias">${dias.join('')}</div>`
}

function comemorar() {
  const s = sequencia()
  $('#parabens-seq').textContent = s > 1 ? `${s} dias seguidos batendo a meta.` : 'Volte amanhã para começar uma sequência.'
  $('#parabens').hidden = false
  navigator.vibrate?.([120, 80, 120])
}
$('#parabens-ok').addEventListener('click', () => { $('#parabens').hidden = true; atividade() })
function teclas(e) {
  atividade()
  if ($('#leitor').hidden) return
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') view?.goLeft()
  else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); view?.goRight() }
  else if (e.key === 'Escape') history.back()
}
addEventListener('keydown', teclas)

function montarSumario() {
  const nav = $('#sumario')
  const toc = view?.book?.toc || []
  let html = ''
  const andar = (itens, n) => {
    for (const it of itens) {
      if (it.label) html += `<button data-href="${esc(it.href)}" data-n="${n}" style="--n:${n}">${esc(it.label.trim())}</button>`
      if (it.subitems?.length) andar(it.subitems, n + 1)
    }
  }
  andar(toc, 0)
  nav.innerHTML = html || '<p class="sem">Este livro não tem sumário.</p>'
}
$('#sumario').addEventListener('click', e => {
  const b = e.target.closest('[data-href]')
  if (!b) return
  view?.goTo(b.dataset.href).catch(console.error)
  fecharFolhas()
  $('#leitor').classList.remove('ui')
})

function fecharFolhas() { $('#folha-aa').hidden = true; $('#folha-sumario').hidden = true; $('#veu').hidden = true }
function abrirFolha(id) {
  fecharFolhas()
  $(id).hidden = false
  $('#veu').hidden = false
  if (id === '#folha-sumario') $('#sumario .atual')?.scrollIntoView({ block: 'center' })
}
$('#l-aa-btn').addEventListener('click', () => abrirFolha('#folha-aa'))
$('#l-sumario-btn').addEventListener('click', () => abrirFolha('#folha-sumario'))
$('#veu').addEventListener('click', fecharFolhas)
$('#folha-sumario [data-fechar]').addEventListener('click', fecharFolhas)
$('#l-voltar').addEventListener('click', () => history.state?.leitor ? history.back() : fecharLeitor())

// a barra de progresso
const slider = $('#l-slider')
slider.addEventListener('input', () => {
  const f = parseFloat(slider.value)
  slider.style.setProperty('--p', `${f * 100}%`)
  $('#l-pct').textContent = pct(f)
})
slider.addEventListener('change', () => view?.goToFraction(parseFloat(slider.value)))

// painel Aa
const mudar = (k, v) => { prefs[k] = v; salvarPrefs(); aplicarAparencia() }
$('#aa-slider').addEventListener('input', e => mudar('tamanho', +e.target.value))
$('#aa-menos').addEventListener('click', () => mudar('tamanho', Math.max(14, prefs.tamanho - 1)))
$('#aa-mais').addEventListener('click', () => mudar('tamanho', Math.min(32, prefs.tamanho + 1)))
$$('#aa-temas button').forEach(b => b.addEventListener('click', () => mudar('tema', b.dataset.tema)))
$$('#aa-cores button').forEach(b => b.addEventListener('click', () => mudar('cor', b.dataset.v)))
$$('#aa-virar button').forEach(b => b.addEventListener('click', () => mudar('virar', b.dataset.v)))
$('#aa-fonte').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) mudar('fonte', b.dataset.v) })
$$('#aa-linha button').forEach(b => b.addEventListener('click', () => mudar('linha', b.dataset.v)))
$$('#aa-margem button').forEach(b => b.addEventListener('click', () => mudar('margem', b.dataset.v)))
$('#aa-rolagem').addEventListener('change', e => mudar('rolagem', e.target.checked))

async function fecharLeitor() {
  if ($('#leitor').hidden) return
  clearTimeout(salvarT)
  if (livroAtual) await Livros.salvar(livroAtual)
  fecharFolhas()
  try { view?.close() } catch {}
  view?.remove()
  view = null; livroAtual = null
  $('#l-palco').innerHTML = ''
  $('#leitor').hidden = true
  document.body.style.overflow = ''
  aplicarAparencia()
  await desenharEstante()
}
addEventListener('popstate', () => { if (!history.state?.leitor) fecharLeitor() })
// salva ao sair do app
document.addEventListener('visibilitychange', () => { if (document.hidden && livroAtual) Livros.salvar(livroAtual) })

/* ================= Início ================= */
if ('serviceWorker' in navigator) {
  const tinha = !!navigator.serviceWorker.controller
  navigator.serviceWorker.register('sw.js').catch(() => {})
  // chegou versão nova do app: recarrega na hora se estiver na estante, ou quando voltar para ela
  let recarregar = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinha) return
    if ($('#leitor').hidden) location.reload()
    else recarregar = true
  })
  addEventListener('popstate', () => { if (recarregar && !history.state?.leitor) setTimeout(() => location.reload(), 300) })
}
if (history.state?.leitor) history.replaceState(null, '', location.href)
await desenharEstante()
await receberCompartilhados()
