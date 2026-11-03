// Hermes 无限画布插件 v0.5 — unified package, ctx.rest 唯一数据源
// 数据流: ctx.rest('/canvas') 走 Desktop↔服务器现有连接（零公网暴露，服务器即写即得）
// 无 CDN 兜底：通道故障直接报错暴露问题，不静默降级（用户拍板 2026-09-29）
// 回传: iframe postMessage → prompt.submit 直达当前会话
import { host, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

function CanvasPage({ ctx }) {
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [src, setSrc] = useState('')
  const [lastSent, setLastSent] = useState('')
  const frameRef = useRef(null)
  const tokenRef = useRef('')

  // The Webapp serves the canvas as its own document (GET /api/plugins/hermes-canvas/view).
  // An iframe `src` gets that response's CSP; `srcdoc` would inherit the host page's — and the
  // Webapp's page policy has no 'unsafe-inline', so every inline script in the canvas is blocked
  // and the board sits on its boot line. Native Desktop has no such policy, so it keeps srcdoc.
  const isBrowserHost = () => document.documentElement.dataset.hermesDesktopHost === 'browser'

  const applySrc = (token) => {
    if (!frameRef.current) return
    const url = new URL('api/plugins/hermes-canvas/view', location.href)
    url.searchParams.set('t', String(Date.now()))
    // The frame is an opaque origin (sandbox="allow-scripts"), so it cannot ride the session
    // cookie. This token is what lets it POST originals and save board state.
    if (token) url.searchParams.set('token', token)
    frameRef.current.removeAttribute('srcdoc')
    frameRef.current.src = url.href
    setSrc('SERVER · ' + new Date().toLocaleTimeString())
    setState('ready')
  }

  const applyHtml = (html) => {
    if (frameRef.current) {
      frameRef.current.srcdoc = html
      setSrc('SERVER · ' + new Date().toLocaleTimeString())
      setState('ready')
    }
  }

  const load = async () => {
    if (!ctx) return
    setState('loading')
    setErr('')
    if (isBrowserHost()) {
      try {
        const minted = await ctx.rest('/token')
        tokenRef.current = minted && minted.token ? minted.token : ''
        applySrc(tokenRef.current)
      } catch (e) {
        applySrc('') // the route mints one itself; the frame still boots
      }
      return
    }
    try {
      const data = await ctx.rest('/canvas')
      if (data && data.ok === true && typeof data.html === 'string' && data.html.length > 500) {
        applyHtml(data.html)
        return
      }
      if (data && data.ok === false && data.error) throw new Error(data.error)
      throw new Error('bad payload')
    } catch (e) {
      setState('error')
      setErr(((e && e.message) || String(e)) + ' — 服务器通道不可用（agent 半边未启用 / canvas.html 尚未生成），点刷新重试')
    }
  }

  useEffect(() => {
    void load()
    const onMsg = async (ev) => {
      const d = ev.data
      if (!d) return
      // The canvas frame is an opaque origin and its own fetch has no session cookie, so the
      // gateway's auth gate 401s it ("Failed to fetch" before any header is read). This page
      // has the cookie — uploads and board state are proxied through here.
      if (d.__hermesCanvasRpc === true) {
        const reply = (body) => {
          try {
            ev.source && ev.source.postMessage({ __hermesCanvasRpcResult: true, id: d.id, ...body }, '*')
          } catch (e) { /* 窗口已走 */ }
        }
        const q = (extra) => {
          const parts = [`token=${encodeURIComponent(tokenRef.current || '')}`]
          if (extra) parts.push(extra)
          return parts.join('&')
        }
        try {
          if (d.op === 'asset') {
            const payload = d.payload || {}
            if (!payload.file) throw new Error('没有收到图片数据')
            const fd = new FormData()
            fd.append('file', payload.file, payload.name || 'paste.png')
            const r = await fetch(
              `api/plugins/hermes-canvas/asset?${q('name=' + encodeURIComponent(payload.name || 'paste.png'))}`,
              { method: 'POST', body: fd }
            )
            const j = await r.json().catch(() => null)
            if (!r.ok) throw new Error((j && j.detail) || 'HTTP ' + r.status)
            reply({ ok: true, data: j })
            return
          }
          if (d.op === 'state-save') {
            const r = await fetch(`api/plugins/hermes-canvas/state?${q()}`, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: (d.payload && d.payload.json) || '{}',
            })
            const j = await r.json().catch(() => null)
            if (!r.ok) throw new Error((j && j.detail) || 'HTTP ' + r.status)
            reply({ ok: true, data: j })
            return
          }
          if (d.op === 'state-load') {
            const r = await fetch(`api/plugins/hermes-canvas/state?${q()}`)
            const j = await r.json().catch(() => null)
            if (!r.ok) throw new Error((j && j.detail) || 'HTTP ' + r.status)
            reply({ ok: true, data: j })
            return
          }
          if (d.op === 'asset-get') {
            const name = (d.payload && d.payload.name) || ''
            if (!name) throw new Error('没有文件名')
            const r = await fetch(
              `api/plugins/hermes-canvas/asset/${encodeURIComponent(name)}?${q()}`
            )
            if (!r.ok) throw new Error('HTTP ' + r.status)
            reply({ ok: true, data: await r.blob() })
            return
          }
          throw new Error('未知操作 ' + d.op)
        } catch (e) {
          reply({ ok: false, error: (e && e.message) || String(e) })
        }
        return
      }
      if (d.__hermesCanvas !== true || typeof d.text !== 'string') return
      const sid = host.state.focusedSessionId.get()
      if (!sid) {
        host.notify({ kind: 'error', message: '画布回传：当前没有聚焦的会话' })
        return
      }
      try {
        await host.request('prompt.submit', { session_id: sid, text: d.text })
        setLastSent(new Date().toLocaleTimeString())
        host.notify({ kind: 'info', message: '画布标注已回传给 Hermes' })
      } catch (e) {
        host.notify({ kind: 'error', message: '画布回传失败: ' + ((e && e.message) || e) })
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const statStyle = { fontSize: '11px', color: 'var(--ui-text-tertiary)' }

  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', height: '100%' },
    children: [
      jsxs('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '6px 12px', fontSize: '12px',
          borderBottom: '1px solid var(--ui-stroke-secondary)',
          color: 'var(--ui-text-primary)',
          flexShrink: 0,
        },
        children: [
          jsx('span', { children: '画布' }),
          jsx('button', {
            type: 'button',
            onClick: () => void load(),
            style: {
              border: '1px solid var(--ui-stroke-secondary)', borderRadius: '6px',
              background: 'var(--ui-control-background, transparent)',
              color: 'var(--ui-text-secondary)', padding: '2px 10px',
              fontSize: '11px', cursor: 'pointer', display: 'inline-flex',
              alignItems: 'center', gap: '5px',
            },
            children: [
              jsx('svg', {
                viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8',
                strokeLinecap: 'round', strokeLinejoin: 'round', style: { width: '12px', height: '12px' },
                children: [
                  jsx('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
                  jsx('path', { d: 'M21 3v6h-6' }),
                ],
              }),
              jsx('span', { children: '刷新画布' }),
            ],
          }),
          src ? jsx('span', { style: statStyle, children: src }) : null,
          state === 'loading' ? jsx('span', { style: statStyle, children: '加载中…（冷启动约 10s）' }) : null,
          state === 'error'
            ? jsx('span', { style: { fontSize: '11px', color: 'var(--ui-text-error, #f38ba8)' }, children: '加载失败: ' + err + ' — 点刷新重试' })
            : null,
          lastSent ? jsx('span', { style: statStyle, children: '最近回传 ' + lastSent + '' }) : null,
          jsx('span', {
            style: { marginLeft: 'auto', fontSize: '11px', color: 'var(--ui-text-quaternary)' },
            children: '圈注 → 回传画布 → 标注直达当前会话',
          }),
        ],
      }),
      jsx('iframe', {
        ref: frameRef,
        sandbox: 'allow-scripts',
        title: 'hermes-canvas',
        style: {
          flex: '1', width: '100%', border: 'none',
          background: 'var(--ui-editor-background, #1b1d24)',
        },
      }),
    ],
  })
}

let pageCtx = null
const CanvasPageWithCtx = () => jsx(CanvasPage, { ctx: pageCtx })

export default {
  id: 'hermes-canvas',
  name: '无限画布',
  register(ctx) {
    pageCtx = ctx
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/canvas' },
        render: () => jsx(CanvasPageWithCtx, {}),
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/canvas', label: '画布', codicon: 'layout' },
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'hermes-canvas.open',
          label: '打开无限画布',
          keywords: ['canvas', '画布', 'huabu'],
          run: () => host.navigate('/canvas'),
        },
      },
    ])
  },
}
