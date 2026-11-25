"""hermes-canvas agent half.

Registers the `canvas_write` tool: the agent-side entry point of the canvas
round-trip. Any script, tool output or generated image can be pushed onto
the board by writing a fresh canvas.html; the Desktop half picks it up via
"Refresh" with zero reinstall.

The canvas content itself lives on the Hermes server
($HERMES_HOME/canvas/canvas.html) — never in this repository.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

try:  # profile-safe home resolution (never hardcode ~/.hermes)
    from hermes_constants import get_hermes_home
except ImportError:  # standalone use outside a Hermes runtime
    import os

    def get_hermes_home() -> Path:
        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def _canvas_dir() -> Path:
    return get_hermes_home() / "canvas"


def canvas_write(html: str, check: bool = True) -> str:
    """Write a complete, self-contained canvas.html to the canvas dir.

    Accepts either a full HTML document or a JSON string of
    ``{"assets": [...], "shapes": [...]}`` — the JSON is wrapped in a
    minimal esm.sh-powered shell (needs network at view time). The
    preferred route is editing demo/canvas.html's ``__INITIAL__`` segment
    directly (zero-network, zero build) and passing the full HTML here.
    """
    out_dir = _canvas_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "canvas.html"

    body = html.strip()
    if body.startswith("{"):
        payload = json.loads(body)
        html_doc = _minimal_shell(payload)
    elif body.lower().startswith("<!doctype") or body.lower().startswith("<html"):
        html_doc = body
    else:
        return json.dumps({
            "success": False,
            "error": "canvas_write expects a full HTML document or a JSON {assets,shapes} payload",
        })

    if check and "<script>" not in html_doc:
        return json.dumps({"success": False, "error": "refusing to write: no <script> found (not a canvas document?)"})

    out_path.write_text(html_doc, encoding="utf-8")
    # The board's saved state wins over __INITIAL__ on load, so a fresh write must drop it —
    # otherwise the agent's new board is invisible behind the user's last session.
    (out_dir / "state.json").unlink(missing_ok=True)
    return json.dumps({
        "success": True,
        "path": str(out_path),
        "bytes": out_path.stat().st_size,
        "hint": "tell the user to hit Refresh in the Desktop canvas page",
    }, ensure_ascii=False)


# Minimal quick-write shell. Plain string + .replace() — f-strings and JS
# braces do not mix. This variant loads the engine from esm.sh, so it is
# only a fallback (the zero-network route is editing demo/canvas.html's
# __INITIAL__ segment — see README "Making boards").
_MINIMAL_SHELL = """<!DOCTYPE html>
<html lang="zh" data-theme="dark">
<head><meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; background: #0a0a0a; }
  #canvas { position: absolute; inset: 0; }
</style>
</head>
<body>
<div id="canvas"></div>
<script>window.__INITIAL__ = __INIT_JSON__;</script>
<script type="module">
  // Pinned deps so tldraw shares the exact React instance we render with
  // (a second React copy = hooks break silently, canvas renders empty).
  const R = 'https://esm.sh/react@18.3.1';
  const RD = 'https://esm.sh/react-dom@18.3.1';
  const TL = 'https://esm.sh/@tldraw/tldraw@3.13.0?deps=react@18.3.1,react-dom@18.3.1';
  const mount = document.getElementById('canvas');
  mount.textContent = 'loading engine from esm.sh...';
  try {
    const React = await import(R);
    const { createRoot } = await import(RD + '/client');
    const { Tldraw } = await import(TL);
    createRoot(mount).render(React.createElement(Tldraw, {
      onMount: (editor) => {
        window.__CANVAS_EDITOR__ = editor;
        const init = window.__INITIAL__;
        if (init && Array.isArray(init.assets) && init.assets.length) editor.createAssets(init.assets);
        if (init && Array.isArray(init.shapes) && init.shapes.length) editor.createShapes(init.shapes);
      }
    }));
  } catch (e) {
    mount.textContent = 'canvas boot failed: ' + e.message;
  }
</script>
</body>
</html>"""


def _minimal_shell(payload: dict[str, Any]) -> str:
    init = json.dumps(payload, ensure_ascii=False)
    return _MINIMAL_SHELL.replace("__INIT_JSON__", init)


# ---- 读板面（canvas_read）----
# 此前 agent 只能盲写：canvas_write 整板覆盖，写完看不见用户后来画了什么。
# 这三个函数把「现在板上有什么」压成摘要还给 agent，add/update/delete 才有依据。
def _load_state() -> dict | None:
    try:
        return json.loads((_canvas_dir() / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _load_initial() -> dict | None:
    """state.json 被 canvas_write 删掉时，回落到 agent 上次写的 __INITIAL__。"""
    try:
        html = (_canvas_dir() / "canvas.html").read_text(encoding="utf-8")
    except OSError:
        return None
    marker = "window.__INITIAL__ = "
    i = html.find(marker)
    if i < 0:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(html[i + len(marker):])
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def _shape_text(shape: dict) -> str:
    if shape.get("label"):
        return str(shape["label"])[:80]
    rt = (shape.get("props") or {}).get("richText")
    if isinstance(rt, dict):
        out: list[str] = []

        def walk(node: Any) -> None:
            if not isinstance(node, dict):
                return
            if node.get("type") == "text" and isinstance(node.get("text"), str):
                out.append(node["text"])
            for child in node.get("content") or []:
                walk(child)

        walk(rt)
        return "".join(out)[:80]
    return ""


def _measured(s: dict, props: dict) -> tuple:
    """(x, y, w, h, exact) —— 优先用画布存的实测边界 meta.mb。

    shape 顶层没有 w/h；text 的 props.w 是折行宽度（autoSize 默认 8）、props.h 不存在，
    直接读 props 会得到「宽 8 高 0」的假值，还会让整板 bounds 被低估。
    """
    mb = (s.get("meta") or {}).get("mb")
    if isinstance(mb, (list, tuple)) and len(mb) == 4 and all(isinstance(v, (int, float)) for v in mb):
        return float(mb[0]), float(mb[1]), float(mb[2]), float(mb[3]), True
    return (float(s.get("x") or 0), float(s.get("y") or 0),
            float(props.get("w") or 0), float(props.get("h") or 0), False)


def _summarize(shapes: list) -> dict:
    by_type: dict[str, int] = {}
    marks: list[dict] = []
    images: list[dict] = []
    xs: list[float] = []
    ys: list[float] = []
    xe: list[float] = []
    ye: list[float] = []
    for s in shapes:
        if not isinstance(s, dict):
            continue
        t = str(s.get("type") or "?")
        by_type[t] = by_type.get(t, 0) + 1
        props = s.get("props") or {}
        x, y, w, h, exact = _measured(s, props)
        # 没测过的文字不报假尺寸：w/h 给 None，且不参与 bounds 计算
        unknown_text = (not exact) and t == "text"
        xs.append(x); ys.append(y)
        xe.append(x if unknown_text else x + w)
        ye.append(y if unknown_text else y + h)
        row = {
            "id": s.get("id"), "x": round(x), "y": round(y),
            "w": None if unknown_text else round(w),
            "h": None if unknown_text else round(h),
        }
        if t == "image":
            images.append({**row, "asset": props.get("assetId")})
        else:
            marks.append({**row, "t": t, "text": _shape_text(s)})
    marks.sort(key=lambda m: (m["y"], m["x"]))
    return {
        "total": len(shapes),
        "by_type": by_type,
        "bounds": {
            "x": round(min(xs)) if xs else 0,
            "y": round(min(ys)) if ys else 0,
            "w": round(max(xe) - min(xs)) if xe else 0,
            "h": round(max(ye) - min(ys)) if ye else 0,
        },
        "images": images[:20],
        "images_truncated": max(0, len(images) - 20),
        "marks": marks[:60],
        "marks_truncated": max(0, len(marks) - 60),
    }


def canvas_read() -> str:
    """Board summary for the agent: counts, bounds, labels, images, pending proposals."""
    state = _load_state()
    shapes = state.get("shapes") if isinstance(state, dict) else None
    source = "state.json"
    if not isinstance(shapes, list) or not shapes:
        shapes = (_load_initial() or {}).get("shapes") or []
        source = "__INITIAL__"
    pending = sorted(p.name[:-5] for p in (_canvas_dir() / "proposals").glob("*.json"))
    return json.dumps({
        "ok": True,
        "source": source,
        "saved_at": (state or {}).get("savedAt") if isinstance(state, dict) else None,
        **_summarize(shapes),
        "pending_proposals": pending,
    }, ensure_ascii=False)


# ---- 提议层（canvas_propose）----
# 从 hermes-whiteboard 吸收：agent 只有提案权。改动写成 proposal 落到画布的幽灵层，
# 用户点「接受」才真的落到板上，一次撤销回滚整批；「忽略」则原样丢弃。
MAX_OPS = 60
MAX_PENDING_PROPOSALS = 20
_OP_KINDS = ("add", "update", "delete")


def _proposals_dir() -> Path:
    return _canvas_dir() / "proposals"


def canvas_propose(ops: Any = None, summary: str = "") -> str:
    """Stage a batch of board changes for the person to accept or dismiss in the canvas."""
    if not isinstance(ops, list) or not ops:
        return json.dumps({"success": False, "error": "ops must be a non-empty array"}, ensure_ascii=False)
    if len(ops) > MAX_OPS:
        return json.dumps({"success": False, "error": f"at most {MAX_OPS} ops per proposal"}, ensure_ascii=False)
    text = (summary or "").strip()[:200]
    if not text:
        return json.dumps({"success": False, "error": "summary is required (one line, what these changes do)"}, ensure_ascii=False)

    d = _proposals_dir()
    d.mkdir(parents=True, exist_ok=True)
    pending = [p for p in d.glob("*.json") if not p.name.startswith(".")]
    if len(pending) >= MAX_PENDING_PROPOSALS:
        return json.dumps({
            "success": False,
            "error": f"{len(pending)} proposals already waiting on the board; accept or dismiss those first",
            "pending": sorted(p.name[:-5] for p in pending),
        }, ensure_ascii=False)

    state = _load_state()
    known = {s.get("id") for s in (state or {}).get("shapes", []) if isinstance(s, dict)} if isinstance(state, dict) else set()
    if not known:
        known = {s.get("id") for s in ((_load_initial() or {}).get("shapes") or []) if isinstance(s, dict)}

    problems: list[str] = []
    clean: list[dict] = []
    for i, op in enumerate(ops):
        if not isinstance(op, dict):
            problems.append(f"ops[{i}] is not an object")
            continue
        kind = str(op.get("op") or "")
        if kind not in _OP_KINDS:
            problems.append(f"ops[{i}]: op must be add/update/delete")
            continue
        if kind == "add":
            shape = op.get("shape")
            if not isinstance(shape, dict) or not shape.get("type"):
                problems.append(f"ops[{i}]: add needs shape{{type,...}}")
                continue
            # add 撞 id 会静默覆盖：tldraw 的 createShapes 不报错，直接把板上那个形状
            # 换成幽灵（实测 w 200→50、opacity→0.4），用户再点「忽略」就真删了他的东西。
            new_id = str(shape.get("id") or "")
            if new_id and new_id in known:
                problems.append(f"ops[{i}]: add id {new_id!r} is already on the board — use update, or drop the id and let the canvas mint one")
                continue
            clean.append({"op": "add", "shape": shape, "reason": str(op.get("reason") or "")[:120] or None})
            continue
        sid = str(op.get("id") or "")
        if not sid:
            problems.append(f"ops[{i}]: {kind} needs id")
            continue
        if known and sid not in known:
            problems.append(f"ops[{i}]: no shape {sid!r} on the board")
            continue
        if kind == "update":
            raw_patch = op.get("patch")
            patch = raw_patch if isinstance(raw_patch, dict) else {}
            if "props" not in patch and not any(k in patch for k in ("x", "y", "parentId", "opacity", "meta")):
                problems.append(f"ops[{i}]: update needs a patch with x/y/props/…")
                continue
            clean.append({"op": "update", "id": sid, "patch": patch, "reason": str(op.get("reason") or "")[:120] or None})
        else:
            clean.append({"op": "delete", "id": sid, "reason": str(op.get("reason") or "")[:120] or None})

    if problems:
        return json.dumps({
            "success": False,
            "error": "; ".join(problems[:6]),
            "hint": "call canvas_read first — it lists the ids currently on the board",
            "available_ids": sorted(i for i in known if i)[:40],
        }, ensure_ascii=False)

    stamp = time.strftime("%Y%m%d-%H%M%S")
    pid = f"p-{stamp}-{secrets.token_hex(3)}"
    doc = {
        "id": pid,
        "summary": text,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "ops": clean,
    }
    target = d / f"{pid}.json"
    tmp = target.with_name(f".{target.name}.part")
    tmp.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    tmp.replace(target)
    return json.dumps({
        "success": True,
        "id": pid,
        "ops": len(clean),
        "summary": text,
        "pending": len(pending) + 1,
        "hint": "the canvas polls every 4s and shows these as a ghost layer; the person accepts or dismisses",
    }, ensure_ascii=False)


# ---- hooks：板↔会话联动 ----
# 设计取舍（用户 2026-11-25 拍板）：
#   · 不做 WS/长连接，维持现有轮询；状态灯搭 /proposals 的便车，零新增请求
#   · 「回传画布」通道保留不动——它是显式、全保真（精确坐标 + 标注语义）
#   · hook 只做两件事：认出回传并把该会话登记为「板主」；板主会话每轮自动附带板面摘要
#   · 不做隐藏会话：推理和回答都留在用户会话里
def _links_path() -> Path:
    return _canvas_dir() / "links.json"


def _status_path() -> Path:
    return _canvas_dir() / "session-status.json"


def _read_json(path: Path, default: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp, path)


def _link_session(session_id: str) -> None:
    """记住哪条会话在跟这块板对话；hook 只给这条会话自动带板面上下文。"""
    if not session_id:
        return
    path = _links_path()
    doc = _read_json(path, {})
    if not isinstance(doc, dict):
        doc = {}
    if doc.get("session_id") != session_id:
        doc.update({"session_id": session_id, "linkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        doc.pop("board_hash", None)  # 换会话了，摘要要重新注入一次
        _write_json(path, doc)


def _set_status(state: str, detail: str = "", session_id: str = "") -> None:
    """状态灯的数据源：画布从 /proposals 里顺带读走。"""
    _write_json(_status_path(), {
        "state": state,
        "detail": (detail or "")[:200],
        "session_id": session_id,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def _board_snapshot() -> tuple[str, str]:
    """(摘要文本, 指纹)。指纹没变就不重复注入——注入会写进用户消息，重复=白占上下文。"""
    state = _load_state()
    shapes = state.get("shapes") if isinstance(state, dict) else None
    if not isinstance(shapes, list) or not shapes:
        shapes = (_load_initial() or {}).get("shapes") or []
    s = _summarize(shapes)
    pending = sorted(p.name[:-5] for p in (_canvas_dir() / "proposals").glob("*.json"))
    b = s["bounds"]
    by_type = ", ".join(f"{k} {v}" for k, v in sorted(s["by_type"].items())) or "空板"
    lines = [
        f"[canvas 自动附带] 板面 {s['total']} 个形状（{by_type}），范围 x{b['x']} y{b['y']} {b['w']}×{b['h']}",
        f"待审提案 {len(pending)} 条" + ("" if not pending else "：" + ", ".join(pending[:3])),
    ]
    imgs = s["images"][:3]
    if imgs:
        lines.append("图片：" + "；".join(f"{i['id']} @({i['x']},{i['y']}) {i['w']}×{i['h']}" for i in imgs))
    texts = [m for m in s["marks"] if m.get("text")][:5]
    if texts:
        lines.append("文字：" + "；".join(f"{m['id']}「{str(m['text'])[:20]}」" for m in texts))
    lines.append("要改板：canvas_read 取全量 id → canvas_propose 提案（别 canvas_write 整板覆盖，会盖掉用户的手改）。")
    digest = hashlib.sha1(json.dumps(
        [s["total"], s["by_type"], b, pending,
         [(m["id"], m["x"], m["y"]) for m in s["marks"]],
         [(i["id"], i["x"], i["y"]) for i in s["images"]]],
        sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    return "\n".join(lines), digest


def _hook_pre_llm_call(**kw: Any) -> dict | None:
    """① 认出「回传画布」并登记板主；② 板主会话每轮自动附带板面摘要。"""
    try:
        sid = str(kw.get("session_id") or "")
        msg = kw.get("user_message")
        msg = msg if isinstance(msg, str) else ""
        if "CANVAS-V1-C" in msg:
            _link_session(sid)
            _set_status("working", "收到回传，正在看板", sid)
            return None  # payload 本身就是全量标注，不必再叠一层摘要
        link = _read_json(_links_path(), {})
        if not sid or not isinstance(link, dict) or link.get("session_id") != sid:
            return None
        _set_status("working", "", sid)
        context, digest = _board_snapshot()
        if link.get("board_hash") == digest:
            return None  # 板没变：上一轮已注入过
        link["board_hash"] = digest
        _write_json(_links_path(), link)
        return {"context": context}
    except Exception:
        return None


def _hook_post_llm_call(**kw: Any) -> None:
    """一轮答完：状态灯转绿，并把回答首行带给画布。"""
    try:
        sid = str(kw.get("session_id") or "")
        link = _read_json(_links_path(), {})
        if not sid or not isinstance(link, dict) or link.get("session_id") != sid:
            return
        resp = kw.get("assistant_response")
        first = ""
        if isinstance(resp, str):
            first = next((ln.strip() for ln in resp.splitlines() if ln.strip()), "")
        _set_status("done", first[:120], sid)
    except Exception:
        pass


def _hook_on_session_end(**kw: Any) -> None:
    """失败/被打断才改状态——成功那轮已由 post_llm_call 写成 done。"""
    try:
        sid = str(kw.get("session_id") or "")
        link = _read_json(_links_path(), {})
        if not sid or not isinstance(link, dict) or link.get("session_id") != sid:
            return
        if kw.get("failed"):
            _set_status("error", str(kw.get("turn_exit_reason") or "失败"), sid)
        elif kw.get("interrupted"):
            _set_status("stopped", str(kw.get("turn_exit_reason") or "被打断"), sid)
    except Exception:
        pass


def register(ctx: Any) -> None:
    ctx.register_tool(
        name="canvas_write",
        toolset="hermes-canvas",
        schema={
            "name": "canvas_write",
            "description": (
                "Write the Hermes infinite canvas (canvas.html). Preferred: pass the demo/canvas.html "
                "with its __INITIAL__ JSON segment swapped for your board (zero-network). Fallback: a "
                "bare JSON {assets,shapes} payload gets wrapped in a minimal esm.sh shell. The Desktop "
                "canvas page picks it up on Refresh."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "html": {
                        "type": "string",
                        "description": "Full HTML document, or JSON {assets:[],shapes:[]} string",
                    }
                },
                "required": ["html"],
            },
        },
        handler=lambda args, **kw: canvas_write(html=args.get("html", "")),
        check_fn=lambda: True,
        requires_env=[],
        description="Write the Hermes infinite canvas",
        emoji="🎨",
    )
    ctx.register_tool(
        name="canvas_read",
        toolset="hermes-canvas",
        schema={
            "name": "canvas_read",
            "description": (
                "Read what is currently on the Hermes canvas: shape counts by type, board bounds, up to 60 "
                "marks (id, type, x/y/w/h, text) and up to 20 image refs, plus any proposals still waiting "
                "for review. Call this BEFORE canvas_propose — add/update/delete must target real shape ids."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        handler=lambda args, **kw: canvas_read(),
        check_fn=lambda: True,
        requires_env=[],
        description="Read the current Hermes canvas board",
        emoji="📖",
    )
    ctx.register_tool(
        name="canvas_propose",
        toolset="hermes-canvas",
        schema={
            "name": "canvas_propose",
            "description": (
                "Propose canvas changes instead of rewriting the whole board. Ops are staged and shown as a "
                "ghost layer in the canvas; the person accepts or dismisses them. Each op: "
                "{op:'add', shape:{type,x,y,props}}, {op:'update', id, patch:{x,y,props}}, "
                "{op:'delete', id}. Always canvas_read first — updates and deletes must name existing ids."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ops": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "add / update / delete operations, at most 60",
                    },
                    "summary": {
                        "type": "string",
                        "description": "One line telling the person what these changes do",
                    },
                },
                "required": ["ops", "summary"],
            },
        },
        handler=lambda args, **kw: canvas_propose(ops=args.get("ops"), summary=args.get("summary", "")),
        check_fn=lambda: True,
        requires_env=[],
        description="Propose canvas changes for review",
        emoji="✏️",
    )
    # 板↔会话联动：认出回传 → 登记板主 → 板主每轮自动带板面摘要 + 状态灯
    ctx.register_hook("pre_llm_call", _hook_pre_llm_call)
    ctx.register_hook("post_llm_call", _hook_post_llm_call)
    ctx.register_hook("on_session_end", _hook_on_session_end)
