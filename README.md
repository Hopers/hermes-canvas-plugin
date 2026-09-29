# hermes-canvas-plugin

Hermes Desktop 无限画布插件（私人用途）。

## 结构（unified package v0.5）
- `plugin.yaml` + `__init__.py` — agent half：register() no-op，只为携带后端
- `dashboard/manifest.json` + `dashboard/plugin_api.py` — 后端路由 `/api/plugins/hermes-canvas/canvas`，读服务器 `/root/.hermes/canvas/canvas.html` 返回
- `desktop/plugin.js` — Desktop half：侧栏「画布」整页，ctx.rest 拉取（走 Desktop↔服务器现有连接，零公网暴露、无 CDN 兜底），圈注经 postMessage → prompt.submit 直达当前会话

画布内容不进本仓库——只存在于服务器 `/root/.hermes/canvas/`。

## 更新
- 改图：agent 重写服务器 canvas.html，插件里点「🔄 刷新画布」即得（无需重装插件）
- 改插件代码：push 本仓库后，Desktop 重开 `hermes://plugin/install?repo=Hopers/hermes-canvas-plugin&force=1`（agent + desktop 都勾）；服务器侧同步 `hermes plugins update hermes-canvas`

## 安装
Desktop 里打开 `hermes://plugin/install?repo=Hopers/hermes-canvas-plugin`，确认对话框勾选 agent + desktop 两个组件。
