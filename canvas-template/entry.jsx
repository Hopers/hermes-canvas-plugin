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

const buildCompact = (editor) => {
  const all = listShapes(editor)
  const marks = all
    .filter((s) => s.type !== 'image')
    .map((s) => {
      const m = { t: s.type, x: Math.round(s.x), y: Math.round(s.y), id: s.id, label: s.label || undefined }
      if (s.props) {
        if (s.props.w) m.w = Math.round(s.props.w)
        if (s.props.h) m.h = Math.round(s.props.h)
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
      }
      return m
    })
  return { tag: 'CANVAS-V1-C', sentAt: new Date().toISOString(), imgs: all.filter((s) => s.type === 'image').length, marks }
}

const push = (text) => {
  if (window.hermes && typeof window.hermes.send === 'function') {
    window.hermes.send(text)
    return 'widget'
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ __hermesCanvas: true, text }, '*')
    return 'plugin'
  }
  throw new Error('无回传通道（既无 hermes.send 也无 parent）')
}

// hermes.send 通道（widget 宿主）：prompt 上限 500 字符、1条/秒 → 分片 420 字、间隔 1.2s
const sendChunked = (text, done, st) => {
  const via = window.hermes && typeof window.hermes.send === 'function' ? 'widget' : 'plugin'
  if (via === 'plugin') {
    try { push(text) } catch (e) { st('回传失败: ' + e.message, true); return }
    done(1)
    return
  }
  if (text.length <= 460) {
    try { push(text) } catch (e) { st('回传失败: ' + e.message, true); return }
    done(1)
    return
  }
  const parts = []
  for (let i = 0; i < text.length; i += 420) parts.push(text.slice(i, i + 420))
  let idx = 0
  const next = () => {
    if (idx >= parts.length) { done(parts.length); return }
    const header = 'CANVAS-V1-C#' + (idx + 1) + '/' + parts.length + ' '
    try {
      window.hermes.send(header + parts[idx])
      idx++
      setTimeout(next, 1200)
    } catch (e) { st('分片 ' + (idx + 1) + ' 回传失败: ' + e.message, true) }
  }
  next()
}

// ---- UI 接线（编辑部风格 shell）----

const stEl = document.getElementById('status')
const st = (t, fail) => {
  stEl.textContent = t
  stEl.classList.toggle('fail', !!fail)
  window.__PROBE__ = t
}
const clockEl = document.getElementById('clock')
const figEl = document.getElementById('fig-shapes')

const refreshMeta = () => {
  if (!editor) return
  const n = [...editor.getCurrentPageShapeIds()].length
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

const onload = (ed) => {
  editor = ed
  window.__CANVAS_EDITOR__ = ed
  applyScheme()
  try {
    ed.user.updateUserPreferences({ colorScheme: 'dark', locale: 'zh-cn' })
  } catch (e) { /* 静默 */ }
  try {
    const init = window.__INITIAL__
    if (init && Array.isArray(init.assets) && init.assets.length) ed.createAssets(init.assets)
    if (init && Array.isArray(init.shapes) && init.shapes.length) {
      ed.createShapes(init.shapes)
      st('READY — 载入 ' + init.shapes.length + ' 个形状。圈选 / 移动对 / AI 图框，完成后回传。')
    } else {
      st('READY — 空白画布。自由涂画，或用下方工具开始。')
    }
  } catch (e) {
    st('INIT ERROR — ' + e.message, true)
  }
  for (const id of ['addpair', 'addslot', 'wipe', 'clear-canvas', 'send']) {
    const b = document.getElementById(id)
    if (b) b.disabled = false
  }
  refreshMeta()
  try { ed.store.listen(() => refreshMeta()) } catch (e) { /* 静默 */ }
}

document.getElementById('send').onclick = () => {
  if (!editor) return
  st('序列化标注中…')
  try {
    const p = buildCompact(editor)
    const text = JSON.stringify(p)
    sendChunked(text, (n) => {
      document.getElementById('clock').textContent = '已回传 @ ' + new Date().toLocaleTimeString()
      st('SENT — ' + p.marks.length + ' 个标注（' + n + ' 片）\nHermes 会基于标注继续处理，稍等它改写本文件。')
    }, st)
  } catch (e) {
    st('序列化异常: ' + (e && e.message), true)
  }
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
  const ids = listShapes(editor).filter((s) => s.type !== 'image').map((s) => s.id)
  if (ids.length) editor.deleteShapes(ids)
  st('WIPED — 已清除 ' + ids.length + ' 个标注（图片保留）')
}

// 重置：清空全部（含图片），回到空白
document.getElementById('clear-canvas').onclick = () => {
  if (!editor) return
  const ids = listShapes(editor).map((s) => s.id)
  if (ids.length) editor.deleteShapes(ids)
  st('RESET — 画布已清空（下次 Hermes 重写本文件时恢复初始内容）')
}

st('初始化引擎（本地 bundle，无网络请求）…')
createRoot(document.getElementById('canvas')).render(
  createElement(Tldraw, { onMount: onload, assetUrls })
)
