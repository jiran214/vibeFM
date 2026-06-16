<div align="center">

[English](README_EN.md) | 中文

# vibeFM — AI 电台节目生成器

**从网易云音乐歌单到完整电台节目，全程 AI 自动化。智能挑选歌曲、生成主播文稿、语音合成、音频混音，一键生成专业级电台节目。**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.9-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: GPL](https://img.shields.io/badge/License-GPL-blue.svg)](LICENSE)

<br/>
<br/>

<table>
  <tr>
    <td align="center" width="33%"><img src="assets/首页.png" width="100%" alt="首页" /></td>
    <td align="center" width="33%"><img src="assets/节目列表.png" width="100%" alt="节目列表" /></td>
    <td align="center" width="33%"><img src="assets/播放页.png" width="100%" alt="播放页" /></td>
  </tr>
  <tr>
    <td align="center"><em>首页</em></td>
    <td align="center"><em>节目列表</em></td>
    <td align="center"><em>播放页 · 字幕同步</em></td>
  </tr>
</table>

</div>

---

### 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [使用方法](#使用方法)
- [自定义 Prompt](#自定义-prompt)
- [项目结构](#项目结构)
- [免责声明](#免责声明)

### 功能特性

- **智能歌单导入** — 支持网易云音乐歌单 URL 或关键词搜索导入
- **AI 歌曲挑选** — 根据节目主题，AI 智能挑选最适合的歌曲
- **节目文稿生成** — 自动生成专业的电台节目脚本，包含开场、串词、结尾
- **语音合成** — 使用 TTS 技术生成主播口播音频
- **音频合成** — FFmpeg 混音，生成带字幕的完整电台节目

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML + CSS + Tailwind CSS |
| 后端 | Next.js App Router API Routes |
| AI | OpenAI 兼容 API（支持自定义 Base URL） |
| 音频 | FFmpeg 8.1.1+ |
| 语言 | TypeScript |

### 快速开始

#### 环境要求

- Node.js >= 20.9.0
- FFmpeg 8.1.1+（需在 PATH 中）

#### 安装与配置

```bash
# 安装依赖
npm install

# 复制配置文件
cp .env.example .env
```

填入小米大模型配置（在 [MiMo 平台](https://platform.xiaomimimo.com/console/api-keys) 注册获取 API Key）：

```env
MIMO_API_KEY=your-api-key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5-pro
MIMO_TTS_MODEL=mimo-v2.5-tts-voicedesign
```

#### 获取网易云音乐 Cookie

> **重要**：运行以下命令自动从浏览器提取网易云音乐 Cookie，这是导入歌单和下载歌曲的前提。

```bash
npm run cli -- cookie
```

#### 检测环境

```bash
npm run cli -- test
```

<details>
<summary>成功输出示例</summary>

```json
{
  "success": true,
  "data": {
    "cookie": { "account": { "valid": true, "isVip": true } },
    "ai": { "model": "mimo-v2.5-pro", "response": "ok" }
  }
}
```

</details>

### 使用方法

#### Web 界面

```bash
npm run dev
```

访问 http://localhost:3000 使用 Web 界面。

#### CLI 命令

```bash
# 创建节目空间
npm run cli -- create <名称> [描述]

# 通过 URL 导入歌单
npm run cli -- create <名称> --playlist-url 'https://music.163.com/playlist?id=xxx'

# 通过关键词搜索导入歌单
npm run cli -- create <名称> --playlist-query '关键词'

# 生成完整节目（运行失败可重复执行）
npm run cli -- generate all <名称> --count 5

# 查看节目列表 / 详情
npm run cli -- show list
npm run cli -- show <名称>
```

### 自定义 Prompt

节目生成的每个阶段都可以通过修改 Prompt 模板来控制 AI 的输出风格：

```
prompts/
├── plan.system.md    # 节目策划 - 系统指令
├── plan.user.md      # 节目策划 - 用户模板
├── script.system.md  # 节目文稿 - 系统指令
└── script.user.md    # 节目文稿 - 用户模板
```

> 修改 Prompt 后无需重新编译，下次运行命令即生效。

### 项目结构

```
vibeFM/
├── src/
│   ├── app/          # Next.js API 路由
│   ├── cli/          # CLI 命令实现
│   └── core/         # 核心业务逻辑
├── public/           # 前端页面
├── prompts/          # AI Prompt 模板
├── docs/             # 项目文档
├── assets/           # 公共素材（BGM、音效）
└── .vibefm/          # 节目工作空间
```

### 免责声明

本项目仅供学习交流使用，部分功能依赖非官方接口。请勿用于商业用途，如有侵权请联系我。

### 许可证

[GPL](LICENSE)

---

<div align="center">

**[↑ 回到顶部](#vibefm)**

</div>
