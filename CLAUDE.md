# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm run dev              # 启动 Next.js 开发服务器 (webpack)
npm run build            # 构建 Web 应用 + CLI
npm run start            # 启动生产服务器
npm run typecheck        # 类型检查 (tsconfig.json + tsconfig.cli.json)
npm test                 # 运行全部测试

# 运行单个测试文件
tsx --test src/core/workspaces.test.ts
node --test public/ui.test.mjs

# CLI 开发模式
npm run cli -- create demo '为情所困'
npm run cli -- generate all demo --count 5
```

## 环境变量

`.env` 文件中配置，参考 `.env.example`：
- `MIMO_API_KEY` — MiMo AI API 密钥（必填）
- `MIMO_BASE_URL` — AI API 地址（默认 `https://api.xiaomimimo.com/v1`）
- `MIMO_MODEL` — LLM 模型（默认 `mimo-v2.5-pro`）
- `MIMO_TTS_MODEL` — TTS 模型（默认 `mimo-v2.5-tts-voicedesign`）
- `DEFAULT_TRACK_COUNT` — 默认选歌数量（默认 5）

## 架构概述

四层架构，严格单向依赖：`cli → core ← server`，`ui → server`。

- **core** (`src/core/`) — 全部业务逻辑。不依赖 HTTP、CLI。每个函数接收 `baseDirectory` 参数，通过依赖注入 mock 外部服务。
- **cli** (`src/cli/`) — 命令行解析 + JSON 输出。`stdout` 输出结构化 JSON，`stderr` 输出进度信息。
- **server** (`src/app/api/`) — Next.js App Router API 路由。薄封装层，解析 HTTP 后调用 core。
- **ui** (`public/`) — 纯 HTML/CSS/JS，无构建步骤。通过 ES module `import` 调用 API。

## 核心工作流

7 阶段流水线（`src/core/workflow.ts`）：`plan → detail → script → events → audio → speech → render`

每个阶段检查产物是否存在并跳过已完成阶段。`--force` 从 audio 阶段起重做。

## 工作空间数据模型

每个电台节目是 `.vibefm/<timestamp>/` 下的一个目录：
- `info.json` — prompt、plan (track_ids, think)、歌词、评论
- `playlist.json` — 网易云歌单规范化数据
- `script.md` — AI 生成的 RadioScript DSL 文稿
- `events.json` — 解析后的事件时间线
- `audio/` — 下载的音乐 WAV + manifest
- `speech/` — TTS 语音 WAV + manifest
- `output/` — 成品 `program.mp3` + `program.srt` + manifest

## RadioScript DSL

定义在 `prompts/dsl.md`。Markdown 格式 + 自定义标签：
- `<host>` — 主播口播（可带 duck 参数）
- `<audio>` — 音乐播放（role: main/bed/effect）
- `<pause />` — 静音
- `<crossfade />` — 交叉淡入淡出
- voice control: `(磁性)`、`(粤语)` 等括号标记

## 测试

- 运行器：Node.js 内置 `node:test`，TypeScript 通过 `tsx --test` 执行
- 断言库：`node:assert/strict`
- 不使用 mock 库，通过依赖注入手写 mock
- 测试文件与源文件同目录：`workspaces.ts` / `workspaces.test.ts`
- 每个步骤生成时，core 层都要检查依赖文件是否存在和完整

## 编码规范

- TypeScript strict mode，ESM（`"type": "module"`）
- 内部导入使用 `.js` 扩展名（TypeScript 解析为 `.ts`）
- 函数 camelCase，Error 类 PascalCase + `Error` 后缀，错误码 SCREAMING_SNAKE_CASE
- 文件写入使用原子操作（临时文件 + rename）
- 不引入外部工具库（无 lodash、zod），验证逻辑手写
- 无 ESLint/Prettier，代码风格保持一致即可
- 用户面向消息和文档用中文，代码标识符用英文

## 重要文档

- `docs/技术决策.md` — 架构决策记录（ADR），新增功能须同步更新
- `docs/cli.md` — CLI 命令详细说明
- `prompts/dsl.md` — RadioScript DSL 规范
- `docs/api.md` — 接口文档
- `docs/third-api/` — 第三方 API 文档（网易云、MiMo TTS）
