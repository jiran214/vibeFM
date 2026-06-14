# vibeFM

AI 智能搜索歌单、挑选歌曲并制作电台节目的本地工具。

## 开发

```bash
npm install
npm run dev
```

## AI 配置

复制 `.env.example` 为项目根目录下的 `.env`，并填写 MiMo 或兼容服务的配置：

```dotenv
MIMO_API_KEY=your-mimo-api-key
MIMO_BASE_URL=https://api.mimo.com/v1
MIMO_MODEL=your-model
```

AI 模块使用 Chat Completions 接口。启动进程中已有的同名环境变量优先于 `.env`，便于在 CI 或临时运行时覆盖项目配置。

Core 调用示例：

```ts
import { requestAiText } from "./src/core/ai.js";

const text = await requestAiText([
  { role: "system", content: "你是一名电台节目策划。" },
  { role: "user", content: "为午夜歌单设计节目主题。" },
]);
```

## CLI

构建并注册本地命令：

```bash
npm run build:cli
npm link
```

创建节目空间：

```bash
vibefm create midnight-radio '适合深夜独处、情绪逐渐平静的电台节目'
```

节目描述会写入 `.vibefm/midnight-radio/info.json`，供后续 AI 生成流程使用。

创建节目空间并导入网易云歌单：

```bash
# 通过 URL 导入
vibefm create midnight-radio --playlist-url 'https://music.163.com/playlist?id=6792103822'

# 通过搜索关键词导入
vibefm create midnight-radio --playlist-query '深夜电台'
```

导入结果写入 `.vibefm/midnight-radio/playlist.json`。如果导入失败，会自动清理已创建的节目空间目录。

生成节目策划：

```bash
vibefm generate plan midnight-radio --count 10
```

命令会读取 `info.json` 和 `playlist.json`，使用 `prompts/` 下的运行时模板调用 AI，
并将校验后的结构化策划合并写入 `.vibefm/midnight-radio/info.json`。

生成节目文稿：

```bash
vibefm generate script midnight-radio
```

命令会校验 `info.json`（含 plan 数据）和 `playlist.json`，使用 `prompts/` 下的文稿模板调用 AI，
并将符合 `docs/dsl.md` 的 RadioScript Markdown 文稿写入
`.vibefm/<name>/script.md`。主持段落使用 `<host>`，歌曲播放节点使用
`<audio source="/audio/<id>.wav" role="main" />`。

解析文稿事件流：

```bash
vibefm generate events midnight-radio
```

命令会严格解析 `script.md`，把 host 转成带文本、空 source 的 audio 事件，
并将有序事件数组写入 `.vibefm/midnight-radio/events.json`。speech 阶段生成
`speech/<host-id>.wav` 后会回写对应事件的 source。

下载歌曲、生成口播并合成节目：

```bash
vibefm generate audio midnight-radio
vibefm generate speech midnight-radio
vibefm generate render midnight-radio
```

最终节目写入 `.vibefm/midnight-radio/output/program.mp3`，配套字幕写入
`.vibefm/midnight-radio/output/program.srt`。渲染要求
`ffmpeg` 和 `ffprobe` 位于 `PATH`，当前实现已使用 FFmpeg 8.1.1 验证。
公共 BGM 与音效分别放在 `assets/bgm/` 和 `assets/sfx/`。

删除节目空间：

```bash
vibefm delete midnight-radio
vibefm delete midnight-radio --force
```

所有最终结果均以 JSON 输出到 stdout。节目空间保存在当前目录的 `.vibefm/` 下。

## 验证

```bash
npm test
npm run typecheck
npm run build
```
