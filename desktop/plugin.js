// Hermes 无限画布插件 — 桌面整页版
// repo: Hopers/hermes-canvas-plugin (private)
// 布局: desktop/plugin.js (desktop half, 由 app 安装时拷入 desktop-plugins/)
// 画布内容: repo 根 canvas.html, 经 raw.githubusercontent 拉取后 srcdoc 注入 iframe（绕开 content-type/缓存问题）
import { host, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

const CANVAS_API = 'https://api.github.com/repos/Hopers/hermes-canvas-plugin/contents/canvas.html'
// Accept: vnd.github.raw 让 contents API 直接返回文件内容（不经 raw.githubusercontent 的 CDN 缓存）

function CanvasPage() {
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [lastSent, setLastSent] = useState('')
  const frameRef = useRef(null)

  const load = async () => {
    setState('loading')
    setErr('')
    try {
      const res = await fetch(CANVAS_API, {
        headers: { Accept: 'application/vnd.github.raw' },
        cache: 'no-cache',
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      if (!html || html.length < 500) throw new Error('画布内容异常(' + html.length + 'B)')
      if (frameRef.current) {
        frameRef.current.srcdoc = html
        setState('ready')
      }
    } catch (e) {
      setState('error')
      setErr(String((e && e.message) || e))
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
          state === 'loading' ? jsx('span', { style: statStyle, children: '加载中…（冷启动约 10s）' }) : null,
          state === 'error'
            ? jsx('span', { style: { fontSize: '11px', color: 'var(--ui-text-error, #f38ba8)' }, children: '加载失败: ' + err + ' — 点刷新重试' })
            : null,
          lastSent ? jsx('span', { style: statStyle, children: '最近回传 ' + lastSent + ' ✓' }) : null,
          jsx('span', {
            style: { marginLeft: 'auto', fontSize: '11px', color: 'var(--ui-text-quaternary)' },
            children: '在画布上圈注 → 点画布内「回传画布」→ 标注直达当前会话',
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

export default {
  id: 'hermes-canvas',
  name: '无限画布',
  register(ctx) {
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/canvas' },
        render: () => jsx(CanvasPage, {}),
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
