<div align="center">

English | [中文](README.md)

# vibeFM — A Radio Station That Doesn't Exist

**An AI radio show generator built around RadioScript DSL: starting from a NetEase Cloud Music playlist, it handles song selection, broadcast scripting, text-to-speech, and audio mixing — transforming a playlist into an editable, reproducible, complete radio show.**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.9-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![License: GPL](https://img.shields.io/badge/License-GPL-blue.svg)](LICENSE)

<br/>
<br/>

<table>
  <tr>
    <td align="center" width="33%"><img src="assets/首页.png" width="100%" alt="Homepage" /></td>
    <td align="center" width="33%"><img src="assets/播放1.png" width="100%" alt="Player" /></td>
    <td align="center" width="33%"><img src="assets/播放2.png" width="100%" alt="Subtitles" /></td>
  </tr>
  <tr>
    <td align="center"><em>Homepage</em></td>
    <td align="center"><em>Player</em></td>
    <td align="center"><em>Synced Subtitles</em></td>
  </tr>
</table>

</div>

---

### Table of Contents

- [Core Philosophy](#core-philosophy)
- [Features](#features)
- [RadioScript DSL](#radioscript-dsl)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Custom Prompts](#custom-prompts)
- [Project Structure](#project-structure)
- [Disclaimer](#disclaimer)

### Core Philosophy

vibeFM doesn't just let AI decide "what to play next" — it first generates an editable, parseable, executable RadioScript, then uses the program to complete TTS, music, background audio, crossfades, and final mixing.

```text
Playlist + Show Theme
      ↓
AI generates RadioScript
      ↓
Parsed into timeline events
      ↓
TTS / Music / BGM / Transitions
      ↓
FFmpeg renders complete show
```

> Turn a playlist into a show, not just a playback queue.

### Features

- **Smart Playlist Import** — Import from NetEase Cloud Music via URL or keyword search
- **AI Show Planning** — Song selection, structure design, and emotional pacing based on the show theme and playlist content
- **RadioScript Generation** — Outputs a human-editable, machine-parseable, stably reproducible radio show script
- **Host Voice Synthesis** — Generate consistent host narration based on `voice_design_prompt`
- **Audio Performance Arrangement** — Supports main music, background music, volume, start time, duration, and crossfades
- **Complete Show Rendering** — FFmpeg composites a complete radio show with synchronized subtitles
- **Web & CLI Dual Entry** — Operate via web UI or integrate into automated workflows

### RadioScript DSL

RadioScript is a "Markdown + HTML-like tags" format designed for AI generation and audio rendering. It decouples content generation from audio execution, making shows readable, editable, parseable, and re-renderable.

```markdown
---
title: The Room That Still Has Its Light On
voice_design_prompt: A gentle, restrained late-night radio host with a hint of weariness
---

# Opening

<host>Good evening, this is vibeFM. Tonight, we start from a playlist and listen to a few songs perfect for being alone.</host>

<audio source="/audio/123456.wav" role="main" volume="100%" fade_in="2s">
  <audio source="/audio/123456.wav" role="bed" volume="18%" start="45s" duration="20s" fade_in="2s" fade_out="2s" />
</audio>

# Ending

<host>Thanks for listening. May tonight's sounds keep a little of what you never said.</host>
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 + Tailwind CSS |
| Backend | Next.js App Router API Routes |
| AI | OpenAI-compatible API (customizable base URL) |
| Audio | RadioScript DSL + FFmpeg 8.1.1+ |
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

Both the show planning and RadioScript generation stages can be customized by editing prompt templates to control show structure, host style, and audio arrangement strategy:

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

This project is for educational and technical research purposes only. Some features rely on unofficial interfaces. Users should independently verify music sources, account permissions, platform terms, and relevant copyright requirements. Do not use this project for unauthorized content distribution or commercial purposes.

### License

[GPL](LICENSE)