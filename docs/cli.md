## 基本命令

命令的输出必须为json，在控制台打印

### 0. 获取 Cookie

```bash
vibefm cookie
```

从本地浏览器（Chrome/Safari/Firefox）自动提取网易云音乐的 cookie，保存到项目根目录 `.cookie` 文件。后续音频下载等命令会读取该文件。

### 0.1 环境检测

```bash
vibefm test
```

检测运行环境是否就绪，包括：

- **网易云 Cookie**：读取 `.cookie` 文件，调用网易云 API 验证 cookie 是否有效，并检测是否为会员账号
- **AI 模型配置**：检查 `.env` 中的 `MIMO_API_KEY`、`MIMO_BASE_URL`、`MIMO_MODEL` 是否完整，并发送测试请求验证连通性

两项检测独立进行，即使其中一项失败也会继续检测另一项。失败时输出错误提示，并以退出码 `1` 表示存在问题。

成功输出示例：

```json
{
  "success": true,
  "data": {
    "action": "test",
    "cookie": {
      "cookiePath": "/path/to/.cookie",
      "account": {
        "valid": true,
        "isVip": true,
        "userId": 12345,
        "nickname": "testuser",
        "vipType": 11
      }
    },
    "ai": {
      "model": "mimo-v2.5-pro",
      "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
      "response": "ok"
    },
    "errors": []
  }
}
```

Cookie 不存在时提示运行 `npm run cli -- cookie` 自动获取。

### 1. 创建节目空间

```bash
vibefm create <节目空间命名> [prompt] [--playlist-url <url>] [--playlist-query <query>]
```

示例：

```bash
# 仅创建节目空间
vibefm create midnight-radio '适合深夜独处、情绪逐渐平静的电台节目'

# 创建节目空间并导入歌单（通过 URL）
vibefm create midnight-radio --playlist-url 'https://music.163.com/playlist?id=6792103822'

# 创建节目空间并导入歌单（通过搜索关键词）
vibefm create midnight-radio --playlist-query '深夜电台'

# 创建节目空间，同时指定 prompt 和导入歌单
vibefm create midnight-radio '适合深夜独处的电台' --playlist-url 'https://music.163.com/playlist?id=6792103822'
```

`.vibefm` 下创建文件夹，用于保存该节目的所有数据和产物。

参数说明：
- `prompt`：后续 AI 生成使用的节目描述。不指定歌单参数时必填；指定歌单参数时可选（默认为空字符串）。若未指定 prompt 且无歌单参数，会从环境变量 `DEFAULT_PROMPT` 读取默认值
- `--playlist-url <url>`：网易云歌单 URL，导入歌单到节目空间
- `--playlist-query <query>`：歌单搜索关键词，自动搜索并导入第一个匹配的歌单
- `--playlist-url` 和 `--playlist-query` 互斥，不能同时指定

指定歌单参数时，命令会：
1. 创建节目空间目录和 `info.json`
2. 导入歌单数据到 `playlist.json`
3. 如果导入失败，自动清理已创建的节目空间目录

成功输出示例（带歌单导入）：

```json
{
  "success": true,
  "data": {
    "action": "create",
    "workspace": {
      "name": "midnight-radio",
      "path": "/path/to/.vibefm/midnight-radio"
    },
    "info": {
      "path": "/path/to/.vibefm/midnight-radio/info.json",
      "prompt": ""
    },
    "playlist": {
      "id": "6792103822",
      "name": "周杰伦-Jay 『网易云精选』",
      "trackCount": 139,
      "path": "/path/to/.vibefm/midnight-radio/playlist.json"
    }
  }
}
```

### 2. 删除节目空间

```bash
vibefm delete <节目空间命名>
```

常用参数：

```text
--force    不经确认直接删除
```

### 3. 查询节目空间

查看所有节目空间：

```bash
vibefm show list
```

返回所有已创建的节目空间列表，包含名称、prompt、歌单标题和封面图：

```json
{
  "success": true,
  "data": {
    "action": "show-list",
    "items": [
      {
        "name": "midnight-radio",
        "prompt": "适合深夜独处的电台",
        "title": "周杰伦精选",
        "playlistImageUrl": "https://..."
      }
    ]
  }
}
```

查看单个节目详情：

```bash
vibefm show <节目空间命名>
```

返回节目的歌单标题、封面图，以及 AI 挑选的歌曲列表（已完成 plan 时）：

```json
{
  "success": true,
  "data": {
    "action": "show",
    "name": "midnight-radio",
    "title": "周杰伦精选",
    "playlistImageUrl": "https://...",
    "tracks": [
      { "id": 123, "name": "晴天", "artists": ["周杰伦"] }
    ]
  }
}
```

未生成 plan 时 `tracks` 为空数组。

### 4. 生成节目策划

```bash
vibefm generate plan <节目空间命名> [--count 10]
```

要求节目空间内已存在有效的 `info.json` 和 `playlist.json`。`--count`
可选，默认值从环境变量 `DEFAULT_TRACK_COUNT` 读取（默认 5）。
`count` 必须是正整数，且不能超过歌单歌曲数量。

等待 AI 返回期间，CLI 会将 `AI 正在生成节目策划，请稍候...` 输出到
`stderr`。最终成功或失败结果仍单独以 JSON 输出到 `stdout`，便于脚本解析。

命令从项目根目录的以下文件运行时读取 Prompt 模板：

```text
prompts/plan.system.md
prompts/plan.user.md
```

`plan.user.md` 必须保留 `{{count}}`、`{{info_json}}` 和
`{{playlist_json}}` 占位符。`info.json` 会完整加入 Prompt；歌单会先由代码压缩，
每首歌只提供 ID、标题、歌手和专辑，避免发送图片、时长等无关字段。

生成结果会经过结构、数量和歌曲 ID 校验，再原子写入 `info.json`，合并后结构：

```json
{
  "prompt": "原始描述",
  "think": "如何设计这期电台节目",
  "track_ids": [123, 456]
}
```

成功输出示例：

```json
{
  "success": true,
  "data": {
    "action": "generate-plan",
    "workspace": {
      "name": "midnight-radio",
      "path": "/path/to/.vibefm/midnight-radio"
    },
    "plan": {
      "path": "/path/to/.vibefm/midnight-radio/info.json",
      "trackCount": 10,
      "think": "从夜晚的躁动逐渐走向平静"
    }
  }
}
```

模型返回非 JSON、额外字段、歌曲重复、引用歌单外歌曲或数量不符时，
命令立即失败，不会覆盖已有 `info.json`。

### 5. 搜索歌词和评论

```bash
vibefm generate detail <节目空间命名> [--limit <number>]
```

要求节目空间内已存在有效的 `info.json`（含 `track_ids`）。命令逐首获取
歌曲的 LRC 歌词（含时间戳）和热门评论，合并写回 `info.json`。

- `--limit <number>`：每首歌获取的评论数量，默认 10
- 歌词接口：`POST /weapi/song/lyric`
- 评论接口：`POST /weapi/v1/resource/comments/R_SO_4_{SONG_ID}`

等待请求期间，CLI 会将 `正在搜索歌词和评论，请稍候...` 输出到 `stderr`。

合并后 `info.json` 结构：

```json
{
  "prompt": "原始描述",
  "think": "如何设计这期电台节目",
  "track_ids": [123, 456],
  "tracks_lyrics": [
    { "id": 123, "lyrics": [{ "time": "00:12.34", "text": "歌词..." }] }
  ],
  "tracks_comments": [
    { "id": 123, "comments": ["评论文本1", "评论文本2"] }
  ]
}
```

成功输出示例：

```json
{
  "success": true,
  "data": {
    "action": "generate-detail",
    "workspace": {
      "name": "midnight-radio",
      "path": "/path/to/.vibefm/midnight-radio"
    },
    "detail": {
      "trackCount": 10,
      "lyricsCount": 8,
      "commentsCount": 65
    }
  }
}
```

### 6. 生成节目文稿

```bash
vibefm generate script <节目空间命名>
```

要求节目空间内已存在有效的 `info.json`（含 plan 数据）和 `playlist.json`。等待 AI 返回期间，
CLI 会将 `AI 正在生成节目文稿，请稍候...` 输出到 `stderr`；最终结果仍以
JSON 输出到 `stdout`。

命令从项目根目录读取：

```text
prompts/script.system.md
prompts/script.user.md
```

`script.user.md` 必须保留 `{{prompt}}`、`{{tracks_info}}`
和 `{{dsl_markdown}}` 占位符。
AI 直接生成 `prompts/dsl.md` 定义的 RadioScript Markdown DSL，包括开场、歌曲
介绍与歌曲间串词、歌手信息表达、歌词主题解读、故事表达、结尾和音频事件。

core 会校验 frontmatter、`# Opening`、`# Ending`、`<host>` 闭合和非空内容，
以及 `role="main"` 音频的数量、source 和顺序。歌曲 source 必须严格为
`/audio/<id>.wav`。通过后原子写入：

```text
```text
.vibefm/<节目空间命名>/script.md
```

文件可直接阅读和编辑，支持 `<host>`、`<audio>`、`<pause />` 和
`<crossfade />`。

成功输出示例：

```json
{
  "success": true,
  "data": {
    "action": "generate-script",
    "workspace": {
      "name": "midnight-radio",
      "path": "/path/to/.vibefm/midnight-radio"
    },
    "script": {
      "path": "/path/to/.vibefm/midnight-radio/script.md",
      "trackCount": 10,
      "theme": "午夜回声",
      "format": "radio-script-dsl"
    }
  }
}
```

AI 返回非 DSL、标签未闭合、主持内容为空、歌曲数量不符或歌曲 ID 未按策划
顺序排列时，命令立即失败，不会覆盖已有 `script.md`。

### 7. 解析文稿为事件流

```bash
vibefm generate events <节目空间命名>
```

要求节目空间内已存在有效的 `script.md`。命令按 DSL 中的先后顺序解析
`<host>`、`<audio>`、`<pause />` 和 `<crossfade />`，并原子写入：

```text
.vibefm/<节目空间命名>/events.json
```

转换规则：

- 每个 host 按出现顺序分配稳定 ID，并转成 `role: "host"` 的 audio 事件
- host audio 初始 `source` 为空，同时保留 `text` 和 `voiceDesignPrompt`
- `volume="25%"` 转换为 `volume: 0.25`
- `fade_in="3s"`、`duration="2s"` 等时间转换为秒数
- Markdown 标题不进入事件流
- 成对的 bed audio 转成 start/stop 事件
- 未知事件、未知属性、非法时间或非法百分比会导致命令失败
- 解析失败时不会覆盖已有 `events.json`

`events.json` 是事件数组，示例：

```json
[
  {
    "type": "audio",
    "action": "start",
    "source": "/audio/33894312.wav",
    "role": "bed",
    "volume": 0.25,
    "fadeIn": 3
  },
  {
    "type": "audio",
    "id": "host-001",
    "source": "",
    "role": "host",
    "voiceDesignPrompt": "温柔、低声、语速偏慢",
    "text": "晚上好，欢迎来到《城市夜行》。"
  },
  {
    "type": "audio",
    "source": "/audio/33894312.wav",
    "role": "main",
    "fadeIn": 2,
    "fadeOut": 3
  }
]
```

成功输出示例：

```json
{
  "success": true,
  "data": {
    "action": "generate-events",
    "workspace": {
      "name": "midnight-radio",
      "path": "/path/to/.vibefm/midnight-radio"
    },
    "events": {
      "path": "/path/to/.vibefm/midnight-radio/events.json",
      "eventCount": 24,
      "hostCount": 6,
      "playCount": 5
    }
  }
}
```

### 8. 下载歌曲音频

```bash
vibefm generate audio <节目空间命名>
```

命令只读取 `info.json.track_ids`，按数组顺序请求并下载歌曲，文件保存为
`audio/<id>.wav`，同时写入 `audio/manifest.json`。

### 9. 文稿分批转语音

```bash
vibefm generate speech <节目空间命名> [--voice <voice>] [--force]
```

要求节目空间内已存在完整的 `events.json`。命令按事件流顺序获取所有
`type: "audio", role: "host"` 事件，每个 host 分别调用一次 TTS：

- `voiceDesignPrompt` 作为 TTS 的自然语言风格指令
- `text` 作为待合成的口播文本
- `--voice` 指定预设音色，默认使用 `冰糖`
- 已存在的语音默认跳过，`--force` 强制重新生成

调用 TTS 前会校验事件数组、各事件必要字段、数值范围及 host ID
唯一性。`events.json` 缺失或不完整时不会开始语音合成。

输出到工作空间内：

```text
speech/<host id>.wav
speech/manifest.json
```

例如 `host-001` 对应 `speech/host-001.wav`。生成后会把对应 audio 事件的
source 更新为 `/speech/host-001.wav` 并原子回写 `events.json`。单段失败时会
写入静音占位 WAV，并在 manifest 和命令输出的 warnings 中记录错误。

### 10. 合成节目

```bash
vibefm generate render <节目空间命名>
```

要求 `ffmpeg`、`ffprobe` 可从 `PATH` 调用，当前使用 FFmpeg 8.1.1
验证。命令读取并完整校验：

- `events.json`
- `playlist.json`，用于按歌曲 ID 获取字幕中的歌名
- `speech/manifest.json` 及所有被引用的 `synthesized` 口播文件
- `audio/manifest.json` 及所有被引用的 `downloaded` 歌曲文件
- `assets/bgm/<name>.<ext>` 公共 BGM
- `assets/sfx/<name>.<ext>` 公共音效

`placeholder`、缺失文件、空文件、不安全的 manifest 路径或无法探测时长的
音频都会在启动 FFmpeg 前中止。素材扩展名可为 `wav`、`mp3`、`m4a`、
`aac`、`flac`、`ogg` 或 `opus`；DSL 中省略扩展名时按此顺序查找。

事件处理规则：

- `role: "host"`、`main`、`effect` 按事件顺序进入主时间线
- `pause` 生成指定时长的静音
- `crossfade` 使用 `acrossfade` 交叉淡化相邻片段
- bed 从 start 持续到 stop，不足时循环，并按音量和淡入淡出参数混入
- host 的 `duckTo`、`duckFade` 用于在口播期间压低并恢复当前 bed
- host 片段生成口播字幕，main 片段生成 `播放《歌名》中...` 字幕
- crossfade 时下一条字幕从实际淡入时间开始，并结束前一条字幕以避免重叠

所有素材先统一为 48 kHz、双声道浮点音频，再执行拼接和混音。最终使用
`loudnorm` 归一化到 -16 LUFS、LRA 11、True Peak -1.5 dB，编码为
192 kbps MP3。滤镜图通过 FFmpeg 8 的 `-/filter_complex` 文件参数传入，
避免事件较多时超过命令行长度限制。

输出：

```text
output/program.mp3
output/program.srt
output/manifest.json
```

`program.srt` 使用 SubRip 格式，`manifest.json` 包含 `subtitlePath`。
成品、字幕和 manifest 均通过临时文件生成；FFmpeg 失败不会覆盖已有产物。

### 11. 查看节目状态

```bash
vibefm status <节目空间命名>
```

展示各阶段状态：

```text
playlist    completed
plan        completed
detail      completed
script      completed
events      completed
audio       pending
speech      pending
render      pending
```

### 12. 一次性完成全部工作流

```bash
vibefm generate all <节目空间命名> [--count <number>] [--quality <level>] [--voice <voice>] [--force]
```

按以下顺序一次性执行完整生成流程：

```text
plan -> detail -> script -> events -> audio -> speech -> render
```

参数与单阶段命令保持一致：

- `--count <number>`：策划选择的歌曲数量。仅当 `plan` 尚未完成、需要实际执行时可选，未指定时使用环境变量 `DEFAULT_TRACK_COUNT` 的值（默认 5）
- `--commentLimit <number>`：每首歌获取的评论数量，默认 10
- `--quality <level>`：歌曲音质，默认 `standard`
- `--voice <voice>`：主播预设音色，默认 `冰糖`
- `--force`：从 `audio` 阶段开始强制重做歌曲音频、主播语音和最终合成

工作流将连续完成的前置阶段标记为跳过，从第一个未完成阶段继续执行，并重做其
所有下游阶段，避免上游更新后继续使用旧的下游产物。各阶段以原子生成的最终产物
作为完成标记；音频和语音阶段内部仍会复用已经生成的单个 WAV 文件。

例如首次生成：

```bash
vibefm generate all demo --count 5 --quality exhigh --voice 茉莉
```

中断后继续：

```bash
vibefm generate all demo
```

如果中断发生在 `plan` 完成之前，继续执行时仍需再次提供 `--count`。

阶段进度条输出到 `stderr`，成功结果仍以单行 JSON 输出到 `stdout`：

```text
[------------------------] 0/6  节目策划  进行中
[====--------------------] 1/6  节目策划  已完成
[========----------------] 2/6  节目文稿  已完成
```

成功 JSON 的 `stages` 会记录本次各阶段是 `completed` 还是 `skipped`，
`render.path` 指向最终的 `output/program.mp3`。
