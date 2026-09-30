# hermes-canvas — Hermes Desktop 无限画布

接入 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的开放式无限画布。agent 把图片排成**单文件自包含 HTML**（tldraw 引擎全量内联，运行时零网络请求）放到服务器上，Desktop 侧栏页面加载它——你在上面圈选、画箭头、写字、摆「移动对」「AI 图框」结构化标注，一键回传，标注直达当前会话。agent 读标注、改图/生图、重排画布，循环往复。

```
┌─────────────┐  canvas.html   ┌──────────────┐  标注 JSON      ┌─────────┐
│ agent 侧    │ ─────────────► │ Desktop 页面 │ ──────────────► │ 会话    │
│ canvas_write│  (ctx.rest)    │ （侧栏）      │ (prompt.submit) │         │
└─────────────┘                └──────────────┘                 └─────────┘
        ▲                                                             │
        └──────────── agent 按标注重建画布 ◄──────────────────────────┘
```

**为什么是单文件？** 画布跑在沙箱 iframe 里（聊天 widget、插件页），外部请求本来就封；顺带永远离线可用、拷到哪都能开。

## 特性

- **零网络 tldraw**——引擎、16 字体、图标 sprite、翻译全部 data: URL 内联，实测零外网请求
- **标注回传协议**——紧凑 `CANVAS-V1-C` JSON，自由涂画之上还有结构化标注（移动对 / AI 图框），协议规范见 [docs/PROTOCOL.md](docs/PROTOCOL.md)
- **一份文件，两种宿主**——聊天 `::preview` widget 与 Desktop 侧栏页通吃，回传通道自动探测
- **自带 agent 工具**——`canvas_write` 落板；agent 推新内容不用动插件代码
- **模板完全开源**——`canvas-template/` 独立构建管线（npm + esbuild + 一个 Python 脚本），换壳换字体随你

## 安装

前提：一台 Hermes 服务器（装 agent 半边）+ Hermes Desktop。

```bash
# Hermes 服务器上
hermes plugins install Hopers/hermes-canvas-plugin --enable
```

或 Desktop 里打开
`hermes://plugin/install?repo=Hopers/hermes-canvas-plugin`，确认对话框勾选 **agent + desktop** 两个组件。

侧栏出现「画布」页。第一块画板：让 agent 调 `canvas_write` 工具，或用模板自建：

```bash
git clone https://github.com/Hopers/hermes-canvas-plugin
cd hermes-canvas-plugin/canvas-template
npm install && python3 gen_assets.py && npm run bundle
python3 build_canvas.py init.json        # → $HERMES_HOME/canvas/canvas.html
```

画布页点「刷新」。循环：

1. agent 把图排上板（WebP data URL，≤640px）
2. 你圈选 / 箭头 / 文字 / 摆移动对 / AI 图框
3. 点「回传画布」——标注以 `CANVAS-V1-C` JSON 进入会话
4. agent 解析（[协议](docs/PROTOCOL.md)）、改图或生图、重建画板；你点刷新

## 仓库结构

```
├── plugin.yaml            # unified package 清单（agent + desktop 两半）
├── __init__.py            # agent 半边：canvas_write 工具
├── dashboard/
│   ├── manifest.json      # 后端路由挂载
│   └── plugin_api.py      # GET /api/plugins/hermes-canvas/canvas → canvas.html
├── desktop/plugin.js      # Desktop 半边：侧栏页，iframe + prompt.submit 中继
├── canvas-template/       # canvas.html 独立构建管线
│   ├── shell.html         #   页面壳（编辑部风格，随便换）
│   ├── entry.jsx          #   引擎接线 + 标注协议
│   ├── gen_assets.py      #   CDN → data:URL 资产模块（顺带抓许可证）
│   ├── build_canvas.py    #   组装器（壳 + CSS + bundle + init.json）
│   └── design-assets/     #   可选 Anton 展示字体（OFL）
└── docs/
    ├── PROTOCOL.md        # CANVAS-V1-C 线格式
    └── TLDRAW-NOTES.md    # tldraw v3 零网络内联实战笔记
```

## 更新

- **画布内容更新**——agent 重写服务器上 canvas.html，插件里点刷新即可，无需重装
- **插件代码更新**——push 本仓库后：服务器 `hermes plugins update hermes-canvas`；Desktop 重开 `hermes://plugin/install?repo=Hopers/hermes-canvas-plugin&force=1`（两半都勾）

## 值得借鉴的设计决策

- **ctx.rest 唯一数据通道**——Desktop 经既有认证连接拉画布，零公网暴露、零 CDN 缓存问题；通道故障直接报错，不静默降级（故意的）
- **画布内容永不进 git**——画板是服务器本地状态（`$HERMES_HOME/canvas/canvas.html`），仓库只带机器不带内容
- **紧凑标注而非 shape 全量**——完整 shape JSON 在 widget 通道 ~600 字符就爆；紧凑格式 + 语义 id 前缀，分片也装得下
- **宁可响亮报错，不静默兜底**——画布悄悄显示上周旧图比一条能行动的报错横幅糟糕得多

## 许可

代码 MIT（[LICENSE](LICENSE)）。构建产物内联 tldraw（允许随应用打包、需随附许可证，见 [NOTICE](NOTICE.md)）；资产构建期拉取、永不进仓库。Anton 字体 OFL 1.1。
