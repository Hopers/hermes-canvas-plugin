# hermes-canvas-plugin

Hermes Desktop 无限画布插件（私人用途）。

## 结构
- `desktop/plugin.js` — Desktop half：注册侧栏「画布」整页，iframe(srcdoc) 渲染 canvas.html，圈注经 postMessage → prompt.submit 直达当前会话
- `canvas.html` — 画布本体（tldraw via esm.sh CDN），由 agent 在服务器侧生成后 push 到本仓库

## 更新画布
agent（Hermes）改图后重写 canvas.html 并 push；Desktop 插件里点「🔄 刷新画布」即拉最新版。

## 安装
Desktop 里打开 `hermes://plugin/install?repo=Hopers/hermes-canvas-plugin`，确认对话框勾选 desktop 组件。
