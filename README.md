# vibeFM

AI 智能电台节目生成器 — 从歌单到完整电台节目，一键完成。

> **依赖小米大模型**：本项目使用 [MiMo](https://platform.xiaomimimo.com/console/api-keys) 提供的 AI 模型服务，包括文本生成和语音合成（TTS）。

## 功能特性

- **智能歌单导入**：支持网易云音乐歌单 URL 或关键词搜索导入
- **AI 歌曲挑选**：根据节目主题，AI 智能挑选最适合的歌曲
- **节目文稿生成**：自动生成专业的电台节目脚本，包含开场、串词、结尾
- **语音合成**：使用 TTS 技术生成主播口播音频
- **音频合成**：FFmpeg 混音，生成带字幕的完整电台节目

## 技术栈

- **前端**：HTML + CSS + Tailwind CSS
- **后端**：Next.js App Router API Routes
- **AI**：OpenAI 兼容 API（支持自定义 Base URL）
- **音频处理**：FFmpeg 8.1.1+
- **语言**：TypeScript

## 快速开始

### 环境要求

- Node.js >= 20.9.0
- FFmpeg 8.1.1+（需在 PATH 中）

### 安装

```bash
npm install
```

### 配置

1. 复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

2. 填入小米大模型配置（在 [MiMo 平台](https://platform.xiaomimimo.com/console/api-keys) 注册获取 API Key）：

```env
MIMO_API_KEY=your-api-key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5-pro
MIMO_TTS_MODEL=mimo-v2.5-tts-voicedesign
```

### 获取网易云音乐 Cookie（必须）

> **重要**：运行以下命令自动从浏览器提取网易云音乐 Cookie，这是导入歌单和下载歌曲的前提。

```bash
npm run cli -- cookie
```

### 检测环境

运行 `test` 命令验证 Cookie 和 AI 配置是否正确，你也可以在首页的右上角点击测试

```bash
npm run cli -- test
```

成功输出示例：

```json
{
  "success": true,
  "data": {
    "cookie": { "account": { "valid": true, "isVip": true } },
    "ai": { "model": "mimo-v2.5-pro", "response": "ok" }
  }
}
```

## 使用方法

### Web 界面

启动开发服务器：

```bash
npm run dev
```

访问 http://localhost:3000 使用 Web 界面。

### CLI 命令

```bash
# 创建节目空间
npm run cli -- create <名称> [描述]

# 导入歌单（通过 URL）
npm run cli -- create <名称> --playlist-url 'https://music.163.com/playlist?id=xxx'

# 导入歌单（通过搜索）
npm run cli -- create <名称> --playlist-query '关键词'

# 生成完整节目（运行失败可重复执行）
npm run cli -- generate all <名称> --count 5

# 查看节目列表
npm run cli -- show list

# 查看节目详情
npm run cli -- show <名称>
```

## 自定义 Prompt 控制生成

节目生成的每个阶段都可以通过修改 Prompt 模板来控制 AI 的输出风格：

### Prompt 文件位置

```
prompts/
├── plan.system.md    # 节目策划 - 系统指令
├── plan.user.md      # 节目策划 - 用户模板（含占位符）
├── script.system.md  # 节目文稿 - 系统指令
└── script.user.md    # 节目文稿 - 用户模板（含占位符）
```

### 修改示例

**控制节目风格**（编辑 `plan.system.md`）：

```markdown
你是一名深夜电台节目策划，擅长营造孤独、治愈的氛围...
```

**控制主播风格**（编辑 `script.system.md`）：

```markdown
你是Vibe FM音乐电台节目文稿作者。主播风格：温柔低沉、娓娓道来...
```

**进阶控制节目编排**（编辑 `script.user.md`）

> **注意**：修改 Prompt 后无需重新编译，下次运行命令即生效。

## 项目结构

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

## 免责声明

本项目仅供学习交流使用，部分功能依赖非官方接口。请勿用于商业用途，如有侵权请联系删除。

## 许可证

GPL
