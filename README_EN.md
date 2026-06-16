<div align="center">

English | [中文](README_CN.md)

# vibeFM — AI Radio Show Generator

**From NetEase Cloud Music playlist to complete radio show, fully automated by AI. Smart song selection, broadcast script generation, text-to-speech, and audio mixing — all in one click.**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.9-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: GPL](https://img.shields.io/badge/License-GPL-blue.svg)](LICENSE)

<br/>
<br/>

<table>
  <tr>
    <td align="center" width="33%"><img src="assets/首页.png" width="100%" alt="Homepage" /></td>
    <td align="center" width="33%"><img src="assets/节目列表.png" width="100%" alt="Show List" /></td>
    <td align="center" width="33%"><img src="assets/播放页.png" width="100%" alt="Player" /></td>
  </tr>
  <tr>
    <td align="center"><em>Homepage</em></td>
    <td align="center"><em>Show List</em></td>
    <td align="center"><em>Player · Synced Subtitles</em></td>
  </tr>
</table>

</div>

---

> **Powered by MiMo**: This project uses [MiMo](https://platform.xiaomimimo.com/console/api-keys) AI services for text generation and text-to-speech (TTS).

### Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Custom Prompts](#custom-prompts)
- [Project Structure](#project-structure)
- [Disclaimer](#disclaimer)

### Features

- **Smart Playlist Import** — Import from NetEase Cloud Music via URL or keyword search
- **AI Song Selection** — AI picks the best songs based on the show theme
- **Script Generation** — Auto-generate professional radio scripts with intro, transitions, and outro
- **Text-to-Speech** — Generate host narration audio using TTS
- **Audio Mixing** — FFmpeg mixing with synchronized subtitles for a complete radio show

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML + CSS + Tailwind CSS |
| Backend | Next.js App Router API Routes |
| AI | OpenAI-compatible API (customizable base URL) |
| Audio | FFmpeg 8.1.1+ |
| Language | TypeScript |

### Quick Start

#### Prerequisites

- Node.js >= 20.9.0
- FFmpeg 8.1.1+ (in PATH)

#### Installation

```bash
npm install
cp .env.example .env
```

Fill in your MiMo API config (get API Key from [MiMo Platform](https://platform.xiaomimimo.com/console/api-keys)):

```env
MIMO_API_KEY=your-api-key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5-pro
MIMO_TTS_MODEL=mimo-v2.5-tts-voicedesign
```

#### Get NetEase Cloud Music Cookie

> **Important**: Run the command below to automatically extract the Cookie from your browser. This is required for importing playlists and downloading songs.

```bash
npm run cli -- cookie
```

#### Verify Setup

```bash
npm run cli -- test
```

<details>
<summary>Example output on success</summary>

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

### Usage

#### Web Interface

```bash
npm run dev
```

Visit http://localhost:3000.

#### CLI Commands

```bash
# Create a show workspace
npm run cli -- create <name> [description]

# Import playlist via URL
npm run cli -- create <name> --playlist-url 'https://music.163.com/playlist?id=xxx'

# Import playlist via keyword search
npm run cli -- create <name> --playlist-query 'keyword'

# Generate a complete show (safe to re-run on failure)
npm run cli -- generate all <name> --count 5

# List / view shows
npm run cli -- show list
npm run cli -- show <name>
```

### Custom Prompts

Control the AI's output style at each stage by editing prompt templates:

```
prompts/
├── plan.system.md    # Show planning - system prompt
├── plan.user.md      # Show planning - user template
├── script.system.md  # Script writing - system prompt
└── script.user.md    # Script writing - user template
```

> Changes take effect on the next command run — no rebuild required.

### Project Structure

```
vibeFM/
├── src/
│   ├── app/          # Next.js API routes
│   ├── cli/          # CLI command implementations
│   └── core/         # Core business logic
├── public/           # Frontend pages
├── prompts/          # AI prompt templates
├── docs/             # Documentation
├── assets/           # Shared assets (BGM, sound effects)
└── .vibefm/          # Show workspaces
```

### Disclaimer

This project is for educational and learning purposes only. Some features rely on unofficial interfaces. Do not use for commercial purposes. If there is any infringement, please contact me.

### License

[GPL](LICENSE)

---

<div align="center">

**[↑ Back to top](#vibefm)**

</div>
