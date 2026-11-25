#!/usr/bin/env python3
"""Assemble the self-contained canvas.html (v2, local engine).

Usage: build_canvas.py <init.json> [output.html]
Reads shell.html / canvas-bundle.js / tldraw-min.css from this directory,
injects the INIT payload, writes the final canvas (default /root/.hermes/canvas/canvas.html).
"""
import json
import sys
from pathlib import Path

BUILD = Path(__file__).parent

def main() -> None:
    init_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('/root/.hermes/canvas/canvas.html')

    shell = (BUILD / 'shell.html').read_text(encoding='utf-8')
    js = (BUILD / 'canvas-bundle.js').read_text(encoding='utf-8')
    css = (BUILD / 'tldraw-min.css').read_text(encoding='utf-8')
    anton = (BUILD / 'design-assets' / 'anton.b64').read_text(encoding='utf-8').strip()
    init = json.loads(init_path.read_text(encoding='utf-8'))

    shell = shell.replace('ANTON_B64', anton)
    inject = (
        '<style>\n' + css + '\n</style>\n'
        '<script>window.__CANVAS_FULL__ = true;</script>\n'
        '<script>window.__INITIAL__ = ' + json.dumps(init, ensure_ascii=False) + ';</script>\n'
        '<script>\n' + js + '\n</script>'
    )
    marker = '<script src="./entry.jsx"></script>'
    assert marker in shell, 'shell.html marker missing'
    html = shell.replace(marker, inject)
    # 2026-10-28 防宿主注入锚点劫持：3.5MB 压缩引擎的 JS 字符串里含裸 `</body>`（tldraw DOMParser
    # 模板/gist embed 模板），聊天宿主 ::preview 的 withInlineChrome 在「第一个 </body>」前插
    # intentScript——插进 JS 字符串中间会把 <script> 块拦腰截断、引擎静默死（白板）。
    # 解法：真 </body>（文件末尾）以外的全部转义为 <\/body>（JS 求值等价，宿主正则匹配不上）。
    import re as _re
    parts = _re.split(r'(</body\s*>)', html, flags=_re.I)
    idxs = [i for i, p in enumerate(parts) if _re.fullmatch(r'</body\s*>', p, _re.I)]
    if idxs:
        keep = idxs[-1]  # 最后一个是真标签
        html = ''.join(
            p if (i >= keep or not _re.fullmatch(r'</body\s*>', p, _re.I)) else p.replace('/', '\\/', 1)
            for i, p in enumerate(parts)
        )
    out_path.write_text(html, encoding='utf-8')
    print(f'assembled {out_path} ({len(html.encode("utf-8"))} bytes), shapes={len(init.get("shapes", []))}')

if __name__ == '__main__':
    main()
