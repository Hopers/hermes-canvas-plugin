#!/usr/bin/env python3
"""Download tldraw runtime assets from cdn.tldraw.com and emit them as a
data-URL asset module (asset-urls.generated.mjs).

Reproduces the asset table that tldraw would otherwise fetch at runtime:
16 fonts + ~155-icon merged sprite + ~19 embed icons + translations, all
inlined as base64 data: URLs. Icons reference a single merged SVG sprite
(SPRITE + "#icon-name") so the base64 payload is stored once for all icons.

Every name list is derived from the installed node_modules — no hand-kept
lists to drift out of sync when you bump the tldraw version.

Run once after `npm install` (needs network). Output is gitignored — re-run
whenever you bump the tldraw version.

Usage: gen_assets.py [version]        (default: read from node_modules)

Also writes the tldraw license to licenses/tldraw-LICENSE.md (see NOTICE.md
for why: the built canvas embeds tldraw code, redistribution requires the
license copy to travel with it).
"""
from __future__ import annotations

import base64
import json
import re
import sys
import urllib.request
from pathlib import Path

BUILD = Path(__file__).parent
CDN = "https://cdn.tldraw.com"

# Semantic font keys consumed by tldraw's editor asset table
# (mirrors tldraw/dist-esm/lib/utils/static-assets/assetUrls.mjs)
FONT_FILES = {
    "tldraw_mono": "IBMPlexMono-Medium.woff2",
    "tldraw_mono_italic": "IBMPlexMono-MediumItalic.woff2",
    "tldraw_mono_bold": "IBMPlexMono-Bold.woff2",
    "tldraw_mono_italic_bold": "IBMPlexMono-BoldItalic.woff2",
    "tldraw_serif": "IBMPlexSerif-Medium.woff2",
    "tldraw_serif_italic": "IBMPlexSerif-MediumItalic.woff2",
    "tldraw_serif_bold": "IBMPlexSerif-Bold.woff2",
    "tldraw_serif_italic_bold": "IBMPlexSerif-BoldItalic.woff2",
    "tldraw_sans": "IBMPlexSans-Medium.woff2",
    "tldraw_sans_italic": "IBMPlexSans-MediumItalic.woff2",
    "tldraw_sans_bold": "IBMPlexSans-Bold.woff2",
    "tldraw_sans_italic_bold": "IBMPlexSans-BoldItalic.woff2",
    "tldraw_draw": "Shantell_Sans-Informal_Regular.woff2",
    "tldraw_draw_italic": "Shantell_Sans-Informal_Regular_Italic.woff2",
    "tldraw_draw_bold": "Shantell_Sans-Informal_Bold.woff2",
    "tldraw_draw_italic_bold": "Shantell_Sans-Informal_Bold_Italic.woff2",
}

# UI language to fetch translations for (tldraw en is always needed; zh-cn
# because the editorial shell is Chinese — add your own locales here)
TRANSLATIONS = ["en", "zh-cn"]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "hermes-canvas-asset-gen"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def data_url(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def node_modules() -> Path | None:
    nm = BUILD / "node_modules" / "tldraw"
    return nm if (nm / "package.json").exists() else None


def detect_version() -> str:
    nm = node_modules()
    if nm:
        return json.loads((nm / "package.json").read_text())["version"]
    print("cannot detect tldraw version — run `npm install` first or pass it explicitly", file=sys.stderr)
    sys.exit(1)


def icon_names(nm: Path) -> list[str]:
    """Parse icon-types.mjs (the authoritative icon list for this version)."""
    src = (nm / "dist-esm" / "lib" / "ui" / "icon-types.mjs").read_text(encoding="utf-8")
    names = re.findall(r'"([a-z0-9-]+)"', src)
    if not names:
        sys.exit("could not parse icon types from node_modules")
    return names


def embed_icon_names(nm: Path) -> list[str]:
    """Parse defaultEmbedDefinitions.mjs for embed icon types."""
    src = (nm / "dist-esm" / "lib" / "defaultEmbedDefinitions.mjs").read_text(encoding="utf-8")
    return sorted(set(re.findall(r'type:\s*"([a-z_0-9]+)"', src)))


def main() -> None:
    version = sys.argv[1] if len(sys.argv) > 1 else detect_version()
    nm = node_modules()
    if not nm:
        sys.exit("node_modules/tldraw not found — run `npm install` first")
    base = f"{CDN}/{version}"
    print(f"tldraw {version}: fetching assets from {base}")

    icons_list = icon_names(nm)
    embeds_list = embed_icon_names(nm)
    print(f"  derived {len(icons_list)} icon names, {len(embeds_list)} embed icon names")

    fonts: dict[str, str] = {}
    for key, fname in FONT_FILES.items():
        fonts[key] = data_url(fetch(f"{base}/fonts/{fname}"), "font/woff2")
        print(f"  font {fname} ({len(fonts[key]) // 1024} KB inline)")

    sprite = data_url(fetch(f"{base}/icons/icon/0_merged.svg"), "image/svg+xml")

    embeds: dict[str, str] = {}
    for t in embeds_list:
        embeds[t] = data_url(fetch(f"{base}/embed-icons/{t}.png"), "image/png")

    trans: dict[str, str] = {}
    for loc in TRANSLATIONS:
        trans[loc] = data_url(fetch(f"{base}/translations/{loc}.json"), "application/json")

    # license copy for redistribution compliance (see NOTICE.md)
    (BUILD / "licenses").mkdir(exist_ok=True)
    lic = fetch("https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md")
    (BUILD / "licenses" / "tldraw-LICENSE.md").write_bytes(lic)

    parts = [
        f"// AUTO-GENERATED by gen_assets.py — tldraw {version} assets as data URLs",
        f'const SPRITE = "{sprite}";',
        "export default {",
        "  fonts: " + json.dumps(fonts) + ",",
        "  icons: {",
        ",\n".join(f'    "{name}": SPRITE + "#{name}"' for name in icons_list),
        "  },",
        "  embedIcons: " + json.dumps(embeds) + ",",
        "  translations: " + json.dumps(trans) + ",",
        "}",
    ]
    out = BUILD / "asset-urls.generated.mjs"
    out.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print(
        f"wrote {out.name} ({out.stat().st_size // 1024} KB): "
        f"{len(fonts)} fonts, {len(icons_list)} icons, {len(embeds)} embedIcons, {len(trans)} translations"
    )


if __name__ == "__main__":
    main()
