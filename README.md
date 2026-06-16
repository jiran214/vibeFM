<div align="center">

[中文](README_CN.md) | [English](README_EN.md)

# vibeFM — AI Radio Show Generator | AI 电台节目生成器

**从网易云音乐歌单到完整电台节目，全程 AI 自动化。智能挑选歌曲、生成主播文稿、语音合成、音频混音，一键生成专业级电台节目。**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.9-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: GPL](https://img.shields.io/badge/License-GPL-blue.svg)](LICENSE)

<br/>

<img src="assets/首页.png" width="90%" alt="vibeFM - AI 智能电台节目生成器界面截图" />

<br/>

### [中文文档](README_CN.md) · [English Docs](README_EN.md)

</div>

---

## What is vibeFM? | 这是什么？

vibeFM 是一个 **AI 驱动的电台节目自动生成工具**。输入网易云音乐歌单链接或关键词，AI 自动挑选歌曲、撰写主播串词文稿、生成语音音频，最终合成带字幕的完整电台节目。

**Use cases | 使用场景：**
- 个人音乐电台：从喜欢的歌单自动生成电台节目
- 播客内容制作：AI 辅助撰写和录制音乐类播客
- 音乐推荐节目：根据主题智能挑选歌曲并解说
- 学习参考：AI 内容生成、TTS、音频处理的完整示例

---

## Features | 功能特性

| 功能 | 说明 |
|------|------|
| **智能歌单导入** | 支持网易云音乐歌单 URL 或关键词搜索导入 |
| **AI 歌曲挑选** | 根据节目主题，AI 智能挑选最适合的歌曲 |
| **节目文稿生成** | 自动生成专业电台脚本：开场白、歌曲串词、结尾 |
| **语音合成 (TTS)** | 使用 AI TTS 技术生成主播口播音频 |
| **音频混音** | FFmpeg 合成完整电台节目，带同步字幕 |
| **Web 界面** | 可视化管理节目，支持在线播放和字幕同步 |
| **CLI 命令行** | 完整 CLI 支持，适合批量处理和自动化 |

---

## Quick Start | 快速开始

```bash
npm install && cp .env.example .env
# 配置 MiMo API Key: https://platform.xiaomimimo.com/console/api-keys
npm run cli -- cookie    # 获取网易云音乐 Cookie
npm run cli -- test      # 检测环境
npm run dev              # 启动 Web 界面 → http://localhost:3000
```

> 详细安装步骤请查看 [中文文档](README_CN.md#快速开始) / [English Docs](README_EN.md#quick-start)

---

## How It Works | 工作原理

```
歌单导入 → AI 选曲 → 生成文稿 → 语音合成 → 音频混音 → 成品节目
  ↓           ↓          ↓          ↓          ↓          ↓
网易云API   MiMo AI   MiMo AI    MiMo TTS    FFmpeg    MP3+字幕
```

---

## FAQ | 常见问题

**Q: 支持哪些音乐平台？**
A: 目前支持网易云音乐，可通过 URL 或关键词搜索导入歌单。

**Q: 需要什么 AI 服务？**
A: 使用小米 MiMo 大模型，支持 OpenAI 兼容 API，可自定义 Base URL。

**Q: 生成一个节目需要多久？**
A: 取决于歌曲数量和 AI 响应速度，通常 5 首歌的节目约需 3-5 分钟。

**Q: 可以自定义主播风格吗？**
A: 可以，通过修改 `prompts/` 目录下的 Prompt 模板自定义 AI 输出风格。

**Q: 支持其他语言吗？**
A: 文稿生成支持中英文，Prompt 模板可扩展至其他语言。

---

## Tech Stack | 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML + CSS + Tailwind CSS |
| 后端 | Next.js App Router API Routes |
| AI | MiMo / OpenAI 兼容 API |
| 音频 | FFmpeg 8.1.1+ |
| 语言 | TypeScript 5.x |

---

## Related Keywords | 相关关键词

`AI radio generator` · `automated radio show` · `playlist to radio` · `music podcast generator` · `AI content generation` · `TTS text-to-speech` · `NetEase Cloud Music` · `网易云音乐` · `电台节目生成` · `AI 主播` · `音乐电台自动化` · `播客制作工具`

---

<div align="center">

**[↑ Back to top](#vibefm--ai-radio-show-generator--ai-电台节目生成器)**

</div>
