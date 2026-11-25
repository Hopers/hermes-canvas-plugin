import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Tldraw, setDefaultUiAssetUrls, setDefaultEditorAssetUrls } from '@tldraw/tldraw'
import ASSET_URLS from './asset-urls.generated.mjs'

// 双保险：①模块级默认表整体替换（覆盖直读 defaultUiAssetUrls 的消费者）
setDefaultUiAssetUrls(ASSET_URLS)
setDefaultEditorAssetUrls({ fonts: ASSET_URLS.fonts })
// ②组件 prop 再传一遍（覆盖走 context overrides 的消费者）
const assetUrls = ASSET_URLS

// 全屏模式：插件宿主经 build_canvas.py 注入 __CANVAS_FULL__（bundle 必然在 flag 之后执行，时序安全）
if (window.__CANVAS_FULL__) document.documentElement.classList.add('full')

// ---- 与 canvas-template.html 相同的紧凑标注协议（已验证的 tldraw v3 API 契约）----

const tiptapText = (rt) => {
  let out = ''
  const walk = (n) => {
    if (!n) return
    if (n.type === 'text' && typeof n.text === 'string') out += n.text
    if (n.content) n.content.forEach(walk)
  }
  walk(rt)
  return out
}

const listShapes = (editor) =>
  Array.from(editor.getCurrentPageShapeIds()).map((id) => editor.getShape(id))

// 幽灵形状（未接受的提案）不算板面内容：不落盘、不回传、不计入计数
const isGhost = (s) => !!(s && s.meta && s.meta.ghost)
const listRealShapes = (editor) => listShapes(editor).filter((s) => !isGhost(s))

// 实测边界：shape 顶层没有 w/h，text 的 props.w 只是折行宽度（autoSize 默认 8），
// 真值只能问编辑器要。测不到（极端情况）才退回 props。
const measured = (editor, s) => {
  try {
    const b = editor.getShapePageBounds(s.id)
    if (b && b.w > 0) return { x: b.x, y: b.y, w: b.w, h: b.h }
  } catch (e) { /* fall through */ }
  return { x: s.x, y: s.y, w: (s.props && s.props.w) || 0, h: (s.props && s.props.h) || 0 }
}

const buildCompact = (editor) => {
  const all = listRealShapes(editor)
  const marks = all
    .filter((s) => s.type !== 'image')
    .map((s) => {
      const b = measured(editor, s)
      const m = { t: s.type, x: Math.round(b.x), y: Math.round(b.y), id: s.id, label: s.label || undefined }
      if (b.w) m.w = Math.round(b.w)
      if (b.h) m.h = Math.round(b.h)
      if (s.type === 'geo') {
        m.geo = s.props.geo
        m.color = s.props.color
        m.dash = s.props.dash
      }
      if (s.type === 'arrow' && s.props.color) m.color = s.props.color
      if (s.type === 'text' && s.props.color) m.color = s.props.color
      if (s.type === 'text' && s.props.richText) m.text = tiptapText(s.props.richText)
      if (s.props.start && s.props.end)
        m.d = [Math.round(s.props.start.x), Math.round(s.props.start.y), Math.round(s.props.end.x), Math.round(s.props.end.y)]
      if (s.type === 'arrow' && s.props.end && s.props.end.boundShapeId) m.to = s.props.end.boundShapeId
      if (s.type === 'draw' && s.props.segments && s.props.segments[0]) {
        m.pts = (s.props.segments[0].points || [])
          .filter((_, i) => i % 3 === 0)
          .slice(0, 24)
          .map((p) => [Math.round(p.x), Math.round(p.y)])
      }
      return m
    })
  return { tag: 'CANVAS-V1-C', sentAt: new Date().toISOString(), imgs: all.filter((s) => s.type === 'image').length, marks }
}

// ---- 后端直连：原图落盘 + 画布状态持久化 ----
// Webapp 的 /view 是独立文档，响应里注入了 window.__CANVAS_TOKEN__；画布据此直接 POST 原图与
// 画布状态到同一插件后端。iframe 是 opaque origin（sandbox="allow-scripts"），所以走 query
// token 而不是 cookie，POST 一律用 multipart / text-plain 这类 simple request（无 preflight）。
const TOKEN = (() => {
  try {
    if (window.__CANVAS_TOKEN__) return window.__CANVAS_TOKEN__
    return new URL(location.href).searchParams.get('token') || ''
  } catch (e) {
    return ''
  }
})()
const hasBackend = !!TOKEN
const apiUrl = (path, extra) => {
  const base = new URL(path, location.href)
  base.searchParams.set('token', TOKEN)
  if (extra) for (const k of Object.keys(extra)) base.searchParams.set(k, extra[k])
  return base.href
}

// ---- 宿主 RPC ----
// The canvas frame is an opaque origin (sandbox="allow-scripts"), so its own fetch carries no
// session cookie and the gateway's auth gate answers 401 — which the browser surfaces as
// "Failed to fetch" before any of our headers are read. The plugin host DOES have that cookie,
// so uploads and state go through it: postMessage up, host fetches, result comes back.
const hasHost = (() => {
  try {
    return !!window.parent && window.parent !== window
  } catch (e) {
    return false
  }
})()

const rpcPending = {}
const rpc = (op, payload, timeoutMs) =>
  new Promise((resolve, reject) => {
    if (!hasHost) {
      reject(new Error('no host'))
      return
    }
    const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    const timer = setTimeout(() => {
      delete rpcPending[id]
      reject(new Error('宿主超时（' + op + '）'))
    }, timeoutMs || 60000)
    rpcPending[id] = {
      resolve: (d) => { clearTimeout(timer); resolve(d) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    }
    window.parent.postMessage({ __hermesCanvasRpc: true, id, op, payload }, '*')
  })

window.addEventListener('message', (e) => {
  const d = e.data
  if (!d || d.__hermesCanvasRpcResult !== true) return
  const p = rpcPending[d.id]
  if (!p) return
  delete rpcPending[d.id]
  if (d.ok) p.resolve(d.data)
  else p.reject(new Error(d.error || 'rpc failed'))
})

const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/tiff': '.tif',
}

// 原图上传：优先走宿主（带 cookie），没有宿主才直连；失败抛错，由调用方回退到本地 data URL
const uploadAsset = async (file) => {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const ext = EXT_BY_MIME[file.type] || '.png'
  const name = 'paste-' + stamp + '-' + Math.random().toString(36).slice(2, 8) + ext
  if (hasHost) {
    const j = await rpc('asset', { file, name, mime: file.type }, 120000)
    if (!j || j.ok !== true || !j.name) throw new Error('宿主上传返回异常')
    return { ...j, url: new URL('asset/' + j.name + '?token=' + encodeURIComponent(TOKEN), location.href).href }
  }
  const fd = new FormData()
  fd.append('file', file, name)
  const r = await fetch(apiUrl('asset', { name }), { method: 'POST', body: fd, credentials: 'omit' })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const j = await r.json()
  if (!j || j.ok !== true || !j.name) throw new Error('bad payload')
  return { ...j, url: new URL('asset/' + j.name + '?token=' + encodeURIComponent(TOKEN), location.href).href }
}

const imageSize = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve([img.naturalWidth || img.width, img.naturalHeight || img.height])
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })

// 用后端 URL 建 tldraw asset + image shape：原图不经过任何重绘，回传只带文件名
// displaySrc 是本地 blob（免 401），serverUrl 存进 meta 供回传与恢复使用
const placeImage = async (displaySrc, file, mime, serverUrl) => {
  const [w, h] = await imageSize(displaySrc)
  const assetId = 'asset:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const view = editor.getViewportPageBounds()
  const maxW = Math.min(view.w * 0.6, w)
  const scale = maxW / w
  editor.createAssets([{
    typeName: 'asset',
    type: 'image',
    id: assetId,
    props: {
      name: (file && file.name) || 'paste',
      src: displaySrc,
      w,
      h,
      mimeType: mime || (file && file.type) || 'image/png',
      isAnimated: false,
    },
    meta: serverUrl ? { serverUrl } : {},
  }])
  editor.createShapes([{
    type: 'image',
    x: Math.round(view.x + (view.w - w * scale) / 2),
    y: Math.round(view.y + (view.h - h * scale) / 2),
    props: { assetId, w: Math.round(w * scale), h: Math.round(h * scale) },
  }])
  return { w, h }
}

// 贴图拦截：capture 阶段先于 tldraw 的 document 监听，自己上传后建 shape，原图直接进服务器
document.addEventListener('paste', (e) => {
  if (!editor || !hasBackend) return
  try {
    if (editor.getEditingShapeId() !== null) return // 正在编辑文字，交给 tldraw
  } catch (err) {
    return
  }
  const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(
    (f) => f && typeof f.type === 'string' && f.type.indexOf('image/') === 0
  )
  if (!files.length) return
  e.preventDefault()
  e.stopImmediatePropagation()
  ;(async () => {
    st('保存原图 ' + files.length + ' 张到服务器…')
    for (const f of files) {
      let up = null
      try {
        up = await uploadAsset(f)
      } catch (err) {
        st('上传失败（' + ((err && err.message) || err) + '），这张只留在本地', true)
      }
      // 显示用 data URL：tldraw 只认 data:/http(s)，blob: 会被 schema 拒收
      let dataUrl = null
      try {
        dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader()
          fr.onload = () => res(fr.result)
          fr.onerror = () => rej(new Error('读取本地图片失败'))
          fr.readAsDataURL(f)
        })
      } catch (err) {
        st('读取图片失败: ' + ((err && err.message) || err), true)
        continue
      }
      try {
        await placeImage(dataUrl, f, (up && up.mime) || f.type, up && up.url)
        if (up) st('原图已存档 ' + up.name + '（' + Math.round(up.size / 1024) + ' KB，未压缩）')
      } catch (err) {
        st('贴图失败: ' + ((err && err.message) || err), true)
      }
    }
    refreshMeta()
  })()
}, true)

// ---- 画布状态持久化（sandbox 无 localStorage，存服务器）----
const STATE_DEBOUNCE_MS = 1500
let saveTimer = null
let saving = false

const snapshot = () => {
  if (!editor) return null
  const shapes = listRealShapes(editor).map((s) => {
    const copy = JSON.parse(JSON.stringify(s))
    // 存一份实测边界：canvas_read 只读 state.json，没有编辑器可问。
    // text 的 props.w 是折行宽度（autoSize 默认 8），props.h 根本不存在 —— 不测就是假值。
    const b = measured(editor, s)
    copy.meta = Object.assign({}, copy.meta || {}, { mb: [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)] })
    return copy
  })
  const assetIds = new Set(shapes.filter((s) => s.type === 'image').map((s) => s.props && s.props.assetId))
  const assets = []
  for (const id of assetIds) {
    try {
      const a = editor.getAsset(id)
      if (!a) continue
      const copy = JSON.parse(JSON.stringify(a))
      // state 只存服务器 URL：原图字节留在 assets/ 里，别把 11MB 的 data URL 塞进 state
      if (copy.meta && copy.meta.serverUrl && copy.props) copy.props.src = copy.meta.serverUrl
      assets.push(copy)
    } catch (e) { /* 跳过 */ }
  }
  return { v: 1, savedAt: new Date().toISOString(), shapes, assets }
}

const saveState = async () => {
  if (!hasBackend || !editor || saving) return
  const payload = snapshot()
  if (!payload) return
  saving = true
  try {
    const json = JSON.stringify(payload)
    if (hasHost) {
      await rpc('state-save', { json }, 20000)
    } else {
      await fetch(apiUrl('state'), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // simple request：无 preflight
        body: json,
        credentials: 'omit',
      })
    }
  } catch (e) {
    /* 后端短暂不可达：下一次编辑会再存 */
  } finally {
    saving = false
  }
}

const scheduleSave = () => {
  if (!hasBackend) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveState, STATE_DEBOUNCE_MS)
}

const loadState = async () => {
  if (!hasBackend) return null
  try {
    let j = null
    if (hasHost) {
      j = await rpc('state-load', {}, 20000)
    } else {
      const r = await fetch(apiUrl('state'), { credentials: 'omit' })
      if (!r.ok) return null
      j = await r.json()
    }
    const s = j && j.state
    if (!s || !Array.isArray(s.shapes)) return null
    return s
  } catch (e) {
    return null
  }
}

// tldraw 3.13 的 store.listen 在本页从不回调（实测连 scope/source 过滤都一样 hits=0），
// 所以不靠它：1.5s 轮询画布签名，变了才刷新计数并排一次保存。
let lastBoardSig = null
const boardSignature = () => {
  if (!editor) return ''
  const shapes = listRealShapes(editor)
  return shapes
    .map((s) => s.id + '|' + Math.round(s.x) + ',' + Math.round(s.y) + '|' +
      (s.props && s.props.richText ? JSON.stringify(s.props.richText).length : 0) + '|' +
      (s.props && s.props.assetId ? s.props.assetId : ''))
    .join(';') + '#' + shapes.length
}

const startBoardWatch = () => {
  setInterval(() => {
    if (!editor) return
    const sig = boardSignature()
    if (lastBoardSig === null) {
      lastBoardSig = sig
      return
    }
    if (sig === lastBoardSig) return
    lastBoardSig = sig
    refreshMeta()
    scheduleSave()
  }, 1500)
}

// 恢复时把服务器原图经宿主取回，转成 data URL：tldraw 的 asset.src 只认 data:/http(s)，
// 直接给 blob: 会被 schema 拒收（"invalid protocol"），所以字节在这里落地成 data URL，
// 而 state 里始终只存服务器 URL（见 snapshot）。
const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('blob read failed'))
    fr.readAsDataURL(blob)
  })

const hydrateAssets = async (assets) => {
  for (const a of assets || []) {
    const serverUrl = a && a.meta && a.meta.serverUrl
    if (!serverUrl || !a.props) continue
    const name = assetNameFromSrc(serverUrl)
    if (!name) continue
    try {
      let blob = null
      if (hasHost) {
        blob = await rpc('asset-get', { name }, 120000)
      } else {
        const r = await fetch(serverUrl, { credentials: 'omit' })
        if (r.ok) blob = await r.blob()
      }
      if (blob && blob.size) a.props.src = await blobToDataUrl(blob)
    } catch (e) {
      /* 取不回就保留 state 里的 src */
    }
  }
  return assets
}

// ---- 提议层：agent 提案 → 幽灵形状 → 接受 / 忽略 ----
// 设计抄自 hermes-whiteboard：页面是唯一真相，agent 只有提案权。
// 幽灵形状带 meta.ghost —— 不落盘（snapshot 过滤）、不回传（buildCompact 过滤）、不计入 FIG 计数；
// 用户点「接受」才转正，点「忽略」就原样丢弃，一次点击回滚整批。
const PROPOSAL_POLL_MS = 4000
const ghostShapes = new Map() // proposalId -> Set<shapeId>
let pendingProposals = []

const proposalsApi = async (op, payload) => {
  if (!hasBackend) throw new Error('无后端')
  if (hasHost) return rpc(op, payload || {}, 20000)
  const rel = op === 'proposals-ack'
    ? 'proposals/' + encodeURIComponent((payload && payload.id) || '') + '/ack'
    : 'proposals'
  const u = new URL(rel, location.href)
  u.searchParams.set('token', TOKEN)
  const r = await fetch(u.href, {
    method: op === 'proposals-ack' ? 'POST' : 'GET',
    credentials: 'omit',
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

// update / delete 没有可半透明的预览，用虚线框把目标框出来；add 直接给半透明形状
const ghostForOp = (op, pid) => {
  const meta = { ghost: true, proposal: pid }
  if (op.op === 'add') {
    const s = JSON.parse(JSON.stringify(op.shape || {}))
    s.id = s.id || nextId('shape:ghost')
    // 撞 id 防御：createShapes 会静默覆盖同名形状（后端已拦，这是第二道）
    const clash = editor.getShape(s.id)
    if (clash && !isGhost(clash)) {
      st('跳过提案项：id ' + s.id + ' 已被板上的形状占用', true)
      return null
    }
    s.meta = { ...meta, ghostOp: 'add' }
    // tldraw v3 的 opacity 是 shape 根字段（0..1），不在 props 里
    s.opacity = 0.4
    return s
  }
  const target = editor.getShape(op.id)
  // 标记框要用实测尺寸：text 的 props.w 是折行宽度（默认 8），拿它画框只有一个针尖大
  const b = target ? measured(editor, target) : null
  const w = (b && b.w) || 140
  const h = (b && b.h) || 90
  const isDel = op.op === 'delete'
  return {
    id: nextId('shape:ghostMark'),
    type: 'geo',
    x: target ? target.x : 40,
    y: target ? target.y : 40,
    opacity: 0.6,
    props: {
      geo: 'rectangle', w, h, dash: 'dashed',
      color: isDel ? 'red' : 'blue', fill: 'none', size: 's',
    },
    meta: { ...meta, ghostOp: op.op, targetId: op.id },
  }
}

const showProposal = (p) => {
  if (!editor || !p || ghostShapes.has(p.id)) return
  const shapes = (p.ops || []).map((op) => ghostForOp(op, p.id)).filter(Boolean)
  if (!shapes.length) return
  try {
    editor.createShapes(shapes)
  } catch (e) {
    st('提案渲染失败: ' + ((e && e.message) || e), true)
    return
  }
  ghostShapes.set(p.id, new Set(shapes.map((s) => s.id)))
}

const removeProposalGhosts = (pid) => {
  const set = ghostShapes.get(pid)
  if (!set) return
  ghostShapes.delete(pid)
  if (!editor) return
  // 只删仍是幽灵的：add 幽灵在接受时已经转正，不能再删掉
  const ids = [...set].filter((id) => {
    try {
      const s = editor.getShape(id)
      return !!s && isGhost(s)
    } catch (e) {
      return false
    }
  })
  if (ids.length) editor.deleteShapes(ids)
}

const focusProposal = (p) => {
  const set = ghostShapes.get(p.id)
  if (!editor || !set || !set.size) return
  const first = [...set][0]
  const b = editor.getShapePageBounds ? editor.getShapePageBounds(first) : null
  if (b && editor.zoomToBounds) editor.zoomToBounds(b)
  else editor.select(...set)
}

const acceptProposal = async (p) => {
  if (!editor) return
  // add：幽灵原地转正。tldraw 的 updateShapes 对 meta 是**合并**语义——写 {} 清不掉、
  // 写 undefined 直接抛错，只有显式写 null 才抹得掉（实测 meta:{ghost:null} → isGhost=false）。
  // 原地转正比「删了重建」好：一条历史记录、不丢 z-order / parentId / 绑定关系。
  for (const op of p.ops || []) {
    if (op.op !== 'add') continue
    const sid = op.shape && op.shape.id
    const g = sid ? editor.getShape(sid) : null
    if (g && isGhost(g)) {
      try {
        editor.updateShapes([{
          id: sid, type: g.type, opacity: 1,
          meta: { ghost: null, ghostOp: null, proposal: null },
        }])
        continue
      } catch (e) { /* 转正失败就走下面的落板兜底 */ }
    }
    // 幽灵不在（页面刷新过）或转正失败：按原样落板
    const s = JSON.parse(JSON.stringify(op.shape || {}))
    s.id = sid || nextId('shape:prop')
    s.meta = s.meta && !s.meta.ghost ? s.meta : {}
    s.opacity = typeof s.opacity === 'number' ? s.opacity : 1
    try {
      // 同一道防御：别让落板把板上已有的形状覆盖掉
      const clash = editor.getShape(s.id)
      if (clash && !isGhost(clash)) {
        st('跳过提案项：id ' + s.id + ' 已被板上的形状占用', true)
        continue
      }
      editor.createShapes([s])
    } catch (e) { st('提案落板失败: ' + ((e && e.message) || e), true) }
  }
  removeProposalGhosts(p.id)
  for (const op of p.ops || []) {
    if (op.op === 'update') {
      const cur = editor.getShape(op.id)
      if (!cur) continue
      editor.updateShapes([{ id: op.id, type: cur.type, ...(op.patch || {}) }])
    } else if (op.op === 'delete') {
      try { editor.deleteShapes([op.id]) } catch (e) { /* 已被删过 */ }
    }
  }
  try { await proposalsApi('proposals-ack', { id: p.id }) } catch (e) { /* 下轮轮询会自愈 */ }
  pendingProposals = pendingProposals.filter((x) => x.id !== p.id)
  scheduleSave()
  refreshMeta()
  renderProposalPanel()
  st('已接受提案：' + (p.summary || p.id))
}

const dismissProposal = async (p) => {
  removeProposalGhosts(p.id)
  try { await proposalsApi('proposals-ack', { id: p.id }) } catch (e) { /* 下轮轮询会自愈 */ }
  pendingProposals = pendingProposals.filter((x) => x.id !== p.id)
  renderProposalPanel()
  st('已忽略提案：' + (p.summary || p.id))
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

// AGENT 区：状态行（12px，比元信息重）+ 提案行，一起渲染进模板里的 #agent-slot
// （画布状态行上方、工具栏之上，文档流）——不用 fixed 浮层，永远不会压按钮
const renderAgentZone = () => {
  const slot = document.getElementById('agent-slot')
  if (!slot) return
  const st = sessionStatus
  const hasStatus = !!(st && st.state)
  if (!hasStatus && !pendingProposals.length) {
    slot.hidden = true
    slot.textContent = ''
    return
  }
  slot.hidden = false
  slot.textContent = ''
  if (hasStatus) {
    const line = el('div', 'aline' + (st.state === 'working' ? ' working' : ''))
    const dot = el('span', 'dot')
    dot.style.background = STATUS_COLOR[st.state] || 'var(--mut)'
    const what = el('span', 'what', (STATUS_LABEL[st.state] || st.state) + (st.detail ? ' — ' + st.detail : ''))
    what.title = st.detail || ''
    line.append(el('span', 'who', 'AGENT'), dot, what)
    slot.append(line)
  }
  if (pendingProposals.length) {
    const head = el('div', 'arow head')
    const all = el('button', 'abtn ok', '全部接受')
    all.onclick = () => void (async () => {
      for (const p of [...pendingProposals]) await acceptProposal(p)
    })()
    head.append(el('span', 'alabel', '提案'), el('span', 'acount', pendingProposals.length + ' 批待审'), all)
    slot.append(head)
    for (const p of pendingProposals) {
      const row = el('div', 'arow')
      const txt = el('div', 'atext', (p.summary || p.id) + ' · ' + ((p.ops || []).length) + ' 项')
      txt.title = '点一下把视角移到这批改动'
      txt.onclick = () => focusProposal(p)
      const ok = el('button', 'abtn ok', '接受')
      ok.onclick = () => void acceptProposal(p)
      const no = el('button', 'abtn ghost', '忽略')
      no.onclick = () => void dismissProposal(p)
      row.append(txt, ok, no)
      slot.append(row)
    }
  }
}
const renderProposalPanel = renderAgentZone

let sessionStatus = null

const STATUS_COLOR = { working: '#f5b942', done: '#4ade80', error: '#f87171', stopped: '#f87171' }
const STATUS_LABEL = { working: '干活中', done: '完成', error: '出错', stopped: '被打断' }

// 状态与提案同属一个 AGENT 区，搭 /proposals 便车一起重绘，不新增请求
const renderSessionStatus = renderAgentZone

const pollProposals = async () => {
  if (!hasBackend || !editor || document.hidden) return
  try {
    const j = await proposalsApi('proposals-list')
    const list = (j && j.proposals) || []
    for (const p of list) if (!ghostShapes.has(p.id)) showProposal(p)
    // 另一端已经处理掉的提案，本地幽灵跟着撤
    for (const pid of [...ghostShapes.keys()]) {
      if (!list.some((p) => p.id === pid)) removeProposalGhosts(pid)
    }
    pendingProposals = list
    renderProposalPanel()
    sessionStatus = (j && j.status) || null
    renderSessionStatus()
  } catch (e) {
    /* 轮询失败不打扰：下一轮再试 */
  }
}

const startProposalWatch = () => {
  void pollProposals()
  setInterval(pollProposals, PROPOSAL_POLL_MS)
}

// ---- 回传：有后端就带 asset 文件名（原图引用），没有才退回 640px WebP ----
const IMG_MAX_SIDE = 640
const IMG_BUDGET_B64 = 300000 // 仅无后端时使用（聊天 widget 宿主）

const compressAsset = (src, maxSide) =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        cv.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(cv.toDataURL('image/webp', 0.8))
      } catch (e) {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })

const assetNameFromSrc = (src) => {
  const m = /\/asset\/([^/?#]+)/.exec(src || '')
  return m ? decodeURIComponent(m[1]) : ''
}

const buildImages = async (editor) => {
  const all = listRealShapes(editor).filter((s) => s.type === 'image')
  const out = []
  let used = 0
  for (const s of all) {
    let asset = null
    try {
      asset = editor.getAsset(s.props && s.props.assetId)
    } catch (e) {
      asset = null
    }
    const src = (asset && asset.props && asset.props.src) || ''
    const serverUrl = (asset && asset.meta && asset.meta.serverUrl) || (src.indexOf('blob:') === 0 ? '' : src)
    const base = {
      id: s.id,
      x: Math.round(s.x),
      y: Math.round(s.y),
      w: Math.round((s.props && s.props.w) || 0),
      h: Math.round((s.props && s.props.h) || 0),
    }
    const name = assetNameFromSrc(serverUrl)
    if (name) {
      // 后端模式：只带引用，原图在服务器上，agent 直接读原文件
      out.push({
        ...base,
        mime: (asset && asset.props && asset.props.mimeType) || 'image/png',
        asset: name,
        naturalW: (asset && asset.props && asset.props.w) || 0,
        naturalH: (asset && asset.props && asset.props.h) || 0,
      })
      continue
    }
    if (src.slice(0, 5) !== 'data:') continue // blob:/外链不可读
    if (used >= IMG_BUDGET_B64) continue
    const u = await compressAsset(src, IMG_MAX_SIDE)
    if (!u) continue
    const b64 = u.slice(u.indexOf(',') + 1)
    if (used + b64.length > IMG_BUDGET_B64) continue
    used += b64.length
    const mime = (u.match(/^data:(image\/[a-z0-9.+-]+);/i) || [])[1] || 'image/webp'
    out.push({ ...base, mime, b64 })
  }
  return { images: out, skipped: all.length - out.length }
}

// 2026-10-28 升级到 Desktop 新版 ack 契约：send() 返回 Promise<{ok:true}|{ok:false,error}>，
// 必须等待确认，拒绝/超时明确报错（老代码 fire-and-forget，静默丢还显示 SENT —— 已实锤断链根因）
const push = async (text) => {
  if (window.hermes && typeof window.hermes.send === 'function') {
    const r = window.hermes.send(text)
    if (r && typeof r.then === 'function') {
      const ack = await r
      if (!ack || ack.ok !== true) {
        const code = (ack && ack.error) || 'no-ack'
        const extra = ack && ack.retryAfterMs ? '（' + Math.ceil(ack.retryAfterMs / 1000) + 's 后可重试）' : ''
        throw new Error('宿主拒收 [' + code + ']' + extra)
      }
      return 'widget'
    }
    return 'widget-legacy' // 老版 Desktop：不回 ack，发了但无法确认
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ __hermesCanvas: true, text }, '*')
    return 'plugin' // 插件宿主：结果看 Desktop 通知气泡
  }
  throw new Error('无回传通道（既无 hermes.send 也无 parent）')
}

// hermes.send 通道（widget 宿主）：prompt 上限 500 字符、1条/秒 → 分片 420 字、间隔 1.2s（每片等 ack）
const sendChunked = (text, done, st) => {
  const via = window.hermes && typeof window.hermes.send === 'function' ? 'widget' : 'plugin'
  if (via === 'plugin') {
    push(text).then(() => done(1, 'plugin')).catch((e) => st('回传失败: ' + e.message, true))
    return
  }
  if (text.length <= 460) {
    push(text).then((route) => done(1, route)).catch((e) => st('回传失败: ' + e.message, true))
    return
  }
  const parts = []
  for (let i = 0; i < text.length; i += 420) parts.push(text.slice(i, i + 420))
  let idx = 0
  const next = () => {
    if (idx >= parts.length) { done(parts.length, 'widget'); return }
    const header = 'CANVAS-V1-C#' + (idx + 1) + '/' + parts.length + ' '
    push(header + parts[idx])
      .then(() => { idx++; setTimeout(next, 1200) })
      .catch((e) => st('分片 ' + (idx + 1) + ' 回传失败: ' + e.message, true))
  }
  next()
}

// ---- UI 接线（编辑部风格 shell）----

const stEl = document.getElementById('status')
let stTimer = null
const st = (t, fail) => {
  stEl.textContent = t
  stEl.classList.toggle('fail', !!fail)
  stEl.hidden = false
  if (stTimer) clearTimeout(stTimer)
  // 非失败消息是一次性通知（READY / SENT / 已忽略提案），几秒后收起，别永久占一层；
  // 失败要常驻——回传被宿主拒收时人得看得见
  if (!fail) stTimer = setTimeout(() => { stEl.hidden = true }, 6000)
  window.__PROBE__ = t
}
const clockEl = document.getElementById('clock')
const figEl = document.getElementById('fig-shapes')

// 存的是 ISO UTC，显示必须按浏览器本地时区换算——直接截字符串会永远显示 UTC
const fmtLocal = (iso) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

const refreshMeta = () => {
  if (!editor) return
  const n = listRealShapes(editor).length
  if (figEl) figEl.textContent = 'FIG. 01 — ' + n + ' SHAPES'
  if (clockEl) clockEl.textContent = 'EDIT @ ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

// 主题：固定暗色（用户拍板 2026-09-29：删除亮色模式，刷新不重置）
const applyScheme = () => {
  document.documentElement.dataset.theme = 'dark'
  if (editor) {
    try {
      editor.user.updateUserPreferences({ colorScheme: 'dark', locale: 'zh-cn' })
    } catch (e) { /* 老版本无此 API 时静默 */ }
  }
}

let editor = null
window.__CANVAS_EDITOR__ = null

const onload = async (ed) => {
  editor = ed
  window.__CANVAS_EDITOR__ = ed
  applyScheme()
  try {
    ed.user.updateUserPreferences({ colorScheme: 'dark', locale: 'zh-cn' })
  } catch (e) { /* 静默 */ }

  // 先恢复服务器上的画布状态（用户最后一次编辑），没有再落到 agent 写的 __INITIAL__
  let restored = null
  try {
    restored = await loadState()
  } catch (e) {
    restored = null
  }
  try {
    if (restored && Array.isArray(restored.shapes) && restored.shapes.length) {
      if (Array.isArray(restored.assets) && restored.assets.length) {
        await hydrateAssets(restored.assets)
        ed.createAssets(restored.assets)
      }
      ed.createShapes(restored.shapes)
      const when = fmtLocal(restored.savedAt)
      st('READY — 恢复上次画布（' + restored.shapes.length + ' 个形状' + (when ? '，存于 ' + when : '') + '）。圈注后回传。')
    } else {
      const init = window.__INITIAL__
      if (init && Array.isArray(init.assets) && init.assets.length) ed.createAssets(init.assets)
      if (init && Array.isArray(init.shapes) && init.shapes.length) {
        ed.createShapes(init.shapes)
        st('READY — 载入 ' + init.shapes.length + ' 个形状。圈选 / 移动对 / AI 图框，完成后回传。')
      } else {
        st('READY — 空白画布。贴图（Ctrl+V）或自由涂画。')
      }
    }
  } catch (e) {
    st('INIT ERROR — ' + e.message, true)
  }
  for (const id of ['addpair', 'addslot', 'wipe', 'clear-canvas', 'send']) {
    const b = document.getElementById(id)
    if (b) b.disabled = false
  }
  refreshMeta()
  startBoardWatch()
  startProposalWatch()
}

document.getElementById('send').onclick = () => {
  if (!editor) return
  const via = window.hermes && typeof window.hermes.send === 'function' ? 'widget' : 'plugin'
  st(via === 'plugin' ? '序列化标注+图片中…' : '序列化标注中…')
  ;(async () => {
    try {
      const p = buildCompact(editor)
      if (via === 'plugin') {
        const r = await buildImages(editor)
        p.images = r.images
        const text = JSON.stringify(p)
        sendChunked(text, (n, route) => {
          document.getElementById('clock').textContent = '已回传 @ ' + new Date().toLocaleTimeString()
          const refs = r.images.filter((i) => i.asset).length
          const inline = r.images.length - refs
          let m = 'SENT(插件) — ' + p.marks.length + ' 个标注'
          if (refs) m += ' + ' + refs + ' 张原图引用（服务器上有原文件）'
          if (inline) m += ' + ' + inline + ' 张内联缩略图'
          if (r.skipped > 0) m += '（' + r.skipped + ' 张不可读略过）'
          m += '\n已整包发往聚焦会话，成败看 Desktop 通知气泡。'
          st(m)
        }, st)
        return
      }
      const text = JSON.stringify(p)
      sendChunked(text, (n, route) => {
        document.getElementById('clock').textContent = '已回传 @ ' + new Date().toLocaleTimeString()
        if (route === 'widget-legacy') {
          st('SENT（宿主未确认）— ' + p.marks.length + ' 个标注（' + n + ' 片）\n本 Desktop 版本过老不回执。若 Hermes 无响应，请升级 Desktop，或手动复制此 JSON 发给它：' + text.slice(0, 300))
        } else {
          let hint = '\nHermes 会基于标注继续处理，稍等它改写本文件。'
          if (!p.marks.length && p.imgs > 0) hint = '\n注意：贴入的图本身不会回传（仅计数），Hermes 看不到图内容。要传图请用侧栏画布插件页（贴图直传），或把图发到聊天。'
          st('SENT — ' + p.marks.length + ' 个标注（' + n + ' 片）' + hint)
        }
      }, st)
    } catch (e) {
      st('序列化异常: ' + (e && e.message), true)
    }
  })()
}

// ---- 移动对 / AI图框 脚手架（EditHere + Cowart 语义吸纳）----

let uidCounter = 0
const nextId = (p) => p + ':' + Date.now().toString(36) + (uidCounter++).toString(36)

// 移动对：红框A + 红框B + A→B箭头（用户把 A 框到源内容、B 拖到目标位置、可拉扯 B 定缩放）
document.getElementById('addpair').onclick = () => {
  if (!editor) return
  const aid = nextId('shape:mvA')
  const bid = nextId('shape:mvB')
  try {
    editor.createShapes([
      { id: aid, type: 'geo', x: 150, y: 150, props: { geo: 'rectangle', w: 160, h: 160, dash: 'dashed', color: 'red', fill: 'none', size: 's' } },
      { id: bid, type: 'geo', x: 450, y: 200, props: { geo: 'rectangle', w: 200, h: 240, dash: 'dashed', color: 'red', fill: 'none', size: 's' } },
      { id: nextId('shape:mvArrow'), type: 'arrow', x: 320, y: 230, props: { color: 'red', dash: 'dashed', start: { x: 0, y: 0 }, end: { x: 120, y: -10 } } },
    ])
    editor.select(aid)
    st('移动对已创建：红框A=源内容（拖去框住要挪的东西），红框B=目标（拖到想去的位置，拉边定尺寸）。可创建多组。')
  } catch (e) {
    st('创建移动对失败: ' + e.message, true)
  }
}

// AI图框：蓝色虚线框 + 框内文字「AI: 描述」
document.getElementById('addslot').onclick = () => {
  if (!editor) return
  const fid = nextId('shape:aislot')
  const tid = nextId('shape:aitext')
  try {
    editor.createShapes([
      { id: fid, type: 'geo', x: 450, y: 500, props: { geo: 'rectangle', w: 320, h: 320, dash: 'dashed', color: 'blue', fill: 'none', size: 's' } },
      { id: tid, type: 'text', x: 458, y: 508, props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AI: 在这里写要生成的画面描述' }] }] }, color: 'blue', size: 's' } },
    ])
    editor.select(tid)
    st('AI图框已创建：双击蓝框里的文字改成你的描述，框的尺寸=生成图的画幅。可创建多个。')
  } catch (e) {
    st('创建AI图框失败: ' + e.message, true)
  }
}

document.getElementById('wipe').onclick = () => {
  if (!editor) return
  const ids = listRealShapes(editor).filter((s) => s.type !== 'image').map((s) => s.id)
  if (ids.length) editor.deleteShapes(ids)
  st('WIPED — 已清除 ' + ids.length + ' 个标注（图片保留）')
}

// 重置：清空全部（含图片），回到空白
document.getElementById('clear-canvas').onclick = () => {
  if (!editor) return
  const ids = listRealShapes(editor).map((s) => s.id)
  if (ids.length) editor.deleteShapes(ids)
  st('RESET — 画布已清空（下次 Hermes 重写本文件时恢复初始内容）')
}

st('初始化引擎（本地 bundle，无网络请求）…')
createRoot(document.getElementById('canvas')).render(
  createElement(Tldraw, { onMount: onload, assetUrls })
)
