# BlindDuel 构建与发布说明

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File scripts/tools/build_release.ps1            # 构建到 dist/
powershell -ExecutionPolicy Bypass -File scripts/tools/build_release.ps1 -Serve     # 构建并本地预览 http://127.0.0.1:9000
powershell -ExecutionPolicy Bypass -File scripts/tools/build_release.ps1 -Zip       # 构建并产出 BlindDuel_release.zip
```

- 每次构建全量重建 dist/（先删后建，可重复）。
- 完整日志写入仓库根 `build_release.log`。
- 完整性校验（构建末尾）必须 PASSED 才能发布：
  - MISSING FILES = 有代码/JSON 引用了 dist 里不存在的文件 → 必须修；
  - CASE MISMATCH = 路径大小写不一致（itch.io 的 Linux 服务器会 404）→ 必须修。

## 环境隔离机制

- `scripts/ReleaseFlag.js`：仓库内恒为 `IS_RELEASE = false`（开发态，debug 全开）；
- 构建时 dist 中的该文件被覆写为 `true`，所有 debug 入口（X/C 键、Inspector、trace、
  调试面板、window.game 暴露、无限弹药）在发布包中失效；
- **源码里的 debug 开关永远不需要手工关闭**，发布干净由构建保证。

## 发布（itch.io）

1. `-Zip` 产出 `BlindDuel_release.zip`（内含根目录 index.html，由 babylon_demo.html 改名而来）；
2. itch.io 项目 → Uploads → 上传 zip → 勾选 "This file will be played in the browser"；
3. 先发 **Private** 页面自测，通过后再改 Public。

## 排除项与依据（26.11.26 审计）

| 排除项 | 依据 |
|---|---|
| Art/RawAssets/ | 美术源文件（.ase/.kra），运行时 sprite 全走 Art/Sprite/ |
| Audio/**/_raw/、Audio/sfx_converted/ | 原始素材/转码中间产物，运行时零引用 |
| Data/PushBox/、Data/TrailMarker/ | 编辑期 mask 源图，运行时零引用（provenance 仅工具消费） |
| Data/RootMotion/**/*.png | 同上；其 JSON（occupancy/atlas）为运行时资源，**保留** |
| Data/TestScripts/ | 被 AssetManifest 引用，**必须保留**（勿再排除） |
| docs/ 仅带 Credits.MD、AudioLicensesInfo.MD | 主菜单 Credits 运行时 fetch（CC 署名合规） |

## 已知注意点

- 运行时依赖 `_converted/` 音频目录（audio_clips.json 引用），勿从 git 或白名单中移除；
- dist 中的 JS 未压缩混淆，玩家可见代码属 Web 游戏正常特征，现阶段不做处理；
- 将来引入 Vite 的触发条件：需要 JS 压缩/合并/npm 依赖管理。届时 `IS_RELEASE`
  全局替换为 `import.meta.env.PROD` 即可，调用点不动。