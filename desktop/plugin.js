// Hermes 无限画布插件 v0.4 — unified package, ctx.rest 优先
// 主路: ctx.rest('/canvas') 走 Desktop↔服务器现有连接（零公网暴露，服务器即写即得）
// 兜底: agent 半边未挂载时退回 CDN 瀑布（jsdelivr → raw）
// 回传: iframe postMessage → prompt.submit 直达当前会话
import { host, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

const CANVAS_SOURCES = [
  'https://cdn.jsdelivr.net/gh/Hopers/hermes-canvas-plugin@main/canvas.html',
  'https://raw.githubusercontent.com/Hopers/hermes-canvas-plugin/main/canvas.html',
  'https://api.github.com/repos/Hopers/hermes-canvas-plugin/contents/canvas.html',
]

function CanvasPage({ ctx }) {
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [src, setSrc] = useState('')
  const [lastSent, setLastSent] = useState('')
  const frameRef = useRef(null)

  const load = async () => {
    if (!ctx) return
    setState('loading')
    setErr('')
    // 主路：ctx.rest 走现有连接，服务器即写即得
    try {
      const data = await ctx.rest('/canvas')
      if (data && data.ok === true && typeof data.html === 'string' && data.html.length > 500) {
        if (frameRef.current) {
          frameRef.current.srcdoc = data.html
          setSrc('server ✓ ' + new Date((data.mtime || 0) * 1000).toLocaleTimeString())
          setState('ready')
        }
        return
      }
      if (data && data.ok === false && data.error) throw new Error(data.error)
      throw new Error('bad payload')
    } catch (restErr) {
      // 兜底：CDN 瀑布
      let lastErr = 'rest: ' + ((restErr && restErr.message) || String(restErr))
      for (const url of CANVAS_SOURCES) {
        try {
          const headers = url.includes('api.github.com')
            ? { Accept: 'application/vnd.github.raw' }
            : undefined
          const res = await fetch(url, { headers, cache: 'no-cache' })
          if (!res.ok) { lastErr += ' | HTTP ' + res.status + ' @ ' + new URL(url).host; continue }
          const html = await res.text()
          if (!html || html.length < 500 || !html.includes('<script')) { lastErr += ' | bad @ ' + new URL(url).host; continue }
          if (frameRef.current) {
            frameRef.current.srcdoc = html
            setSrc('cdn-fallback @ ' + new URL(url).host)
            setState('ready')
          }
          return
        } catch (e) {
          lastErr += ' | ' + ((e && e.message) || String(e)) + ' @ ' + new URL(url).host
        }
      }
      setState('error')
      setErr(lastErr)
    }
  }

  useEffect(() => {
    void load()
    const onMsg = async (ev) => {
      const d = ev.data
      if (!d || d.__hermesCanvas !== true || typeof d.text !== 'string') return
      const sid = host.state.focusedSessionId.get()
      if (!sid) {
        host.notify({ kind: 'error', message: '画布回传：当前没有聚焦的会话' })
        return
      }
      try {
        await host.request('prompt.submit', { session_id: sid, text: d.text })
        setLastSent(new Date().toLocaleTimeString())
        host.notify({ kind: 'info', message: '🎨 画布标注已回传给 Hermes' })
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
          jsx('span', { children: '🎨 无限画布' }),
          jsx('button', {
            type: 'button',
            onClick: () => void load(),
            style: {
              border: '1px solid var(--ui-stroke-secondary)', borderRadius: '6px',
              background: 'var(--ui-control-background, transparent)',
              color: 'var(--ui-text-secondary)', padding: '2px 10px',
              fontSize: '11px', cursor: 'pointer',
            },
            children: '🔄 刷新画布',
          }),
          src ? jsx('span', { style: statStyle, children: src }) : null,
          state === 'loading' ? jsx('span', { style: statStyle, children: '加载中…（冷启动约 10s）' }) : null,
          state === 'error'
            ? jsx('span', { style: { fontSize: '11px', color: 'var(--ui-text-error, #f38ba8)' }, children: '加载失败: ' + err + ' — 点刷新重试' })
            : null,
          lastSent ? jsx('span', { style: statStyle, children: '最近回传 ' + lastSent + ' ✓' }) : null,
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
