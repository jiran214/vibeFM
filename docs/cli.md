## 基本命令

命令的输出必须为json，在控制台打印

### 0. 获取 Cookie

```bash
vibefm cookie
```

从本地浏览器（Chrome/Safari/Firefox）自动提取网易云音乐的 cookie，保存到项目根目录 `.cookie` 文件。后续音频下载等命令会读取该文件。

### 1. 创建节目空间

```bash
vibefm create <节目空间命名> <prompt>
```

示例：

```bash
vibefm create midnight-radio '适合深夜独处、情绪逐渐平静的电台节目'
```

`.vibefm` 下创建文件夹，用于保存该节目的所有数据和产物。`prompt` 为后续 AI 生成使用的节目描述，必填且不可为空，保存到：

```text
.vibefm/<节目空间命名>/info.json
```

文件内容：

```json
{
  "prompt": "适合深夜独处、情绪逐渐平静的电台节目"
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
vibefm show <节目空间命名>
vibefm show <节目空间命名> --section plan
vibefm show <节目空间命名> --section script
```

```

### 4. 导入歌单

```bash
vibefm import <节目空间命名> <网易云歌单URL>
```

示例：

```bash
vibefm import midnight-radio 'https://music.163.com/playlist?id=6792103822'
```

要求节目空间已通过 `vibefm create` 创建。命令会获取完整歌曲列表，并将规范化后的歌单、歌曲及来源信息写入：

```text
.vibefm/<节目空间命名>/playlist.json
```

成功输出示例：

```json
{
  "success": true,
  "data": {
    "action": "import",
    "workspace": {
      "name": "midnight-radio",
      "path": "/path/to/.vibefm/midnight-radio"
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

再次导入会原子更新现有 `playlist.json`，避免请求或写入失败时留下不完整文件。

### 5. 生成节目策划

```bash
vibefm generate plan <节目空间命名> --count 10
```

要求节目空间内已存在有效的 `info.json` 和 `playlist.json`。`--count`
必须是正整数，且不能超过歌单歌曲数量。

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

生成结果会经过结构、数量、歌曲 ID 和情绪曲线校验，再原子写入：

```text
.vibefm/<节目空间命名>/plan.json
```

内容包括：

- 节目主题
- 选中歌曲
- 选曲理由
- 情绪曲线
- 主播风格
- 歌曲播放顺序

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
      "path": "/path/to/.vibefm/midnight-radio/plan.json",
      "trackCount": 10,
      "theme": "午夜回声"
    }
  }
}
```

模型返回非 JSON、歌曲重复、引用歌单外歌曲、数量不符或情绪曲线未完整覆盖
入选歌曲时，命令立即失败，不会覆盖已有 `plan.json`。

### 6. 生成节目文稿

```bash
vibefm generate script <节目空间命名>
```

要求节目空间内已存在有效的 `info.json` 和 `plan.json`。等待 AI 返回期间，
CLI 会将 `AI 正在生成节目文稿，请稍候...` 输出到 `stderr`；最终结果仍以
JSON 输出到 `stdout`。

命令从项目根目录读取：

```text
prompts/script.system.md
prompts/script.user.md
```

`script.user.md` 必须保留 `{{info_json}}` 和 `{{plan_json}}` 占位符。
AI 直接生成 `docs/dsl.md` 定义的 RadioScript Markdown DSL，包括开场、歌曲
介绍与歌曲间串词、歌手信息表达、歌词主题解读、故事表达、结尾和音频事件。

core 会校验 `# Opening`、`# Ending`、`[host]` 闭合和非空内容、
`voice_design_prompt`，以及 `[play]` 的歌曲数量、ID 和顺序。通过后原子写入：

```text
.vibefm/<节目空间命名>/script.md
```

文件可直接阅读和编辑，支持 `[host]`、`[play]`、`[bgm]`、`[sfx]`、
`[pause]` 和 `[transition]`。不再生成或接受旧的 `[[PLAY:id]]` 标记。

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
`[host]`、`[play]`、`[bgm]`、`[sfx]`、`[pause]` 和 `[transition]`，并原子写入：

```text
.vibefm/<节目空间命名>/events.json
```

转换规则：

- 每个 host 按出现顺序分配稳定 ID：`host-001`、`host-002`……
- `volume="25"` 转换为 `volume: 0.25`
- `fade_in="3s"`、`duration="2s"` 等时间转换为秒数
- Markdown 标题不进入事件流
- 未知事件、未知属性、非法时间、超出 `0..100` 的音量会导致命令失败
- 解析失败时不会覆盖已有 `events.json`

`events.json` 是事件数组，示例：

```json
[
  {
    "type": "bgm",
    "action": "start",
    "name": "soft_ambient",
    "volume": 0.25,
    "fadeIn": 3
  },
  {
    "type": "host",
    "id": "host-001",
    "voiceDesignPrompt": "温柔、低声、语速偏慢",
    "text": "晚上好，欢迎来到《城市夜行》。"
  },
  {
    "type": "play",
    "id": "33894312",
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

### 9. 文稿分批转语音

```bash
vibefm generate speech <节目空间命名> [--voice <voice>] [--force]
```

要求节目空间内已存在完整的 `events.json`。命令按事件流顺序获取所有
`type: "host"` 事件，每个 host 分别调用一次 TTS：

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

例如 `host-001` 对应 `speech/host-001.wav`。单段合成失败时会写入静音
占位 WAV，并在 `manifest.json` 和命令输出的 `warnings` 中记录错误。

### 10. 合成节目

```bash
vibefm generate render <节目空间命名>
```

要求 `ffmpeg`、`ffprobe` 可从 `PATH` 调用，当前使用 FFmpeg 8.1.1
验证。命令读取并完整校验：

- `events.json`
- `speech/manifest.json` 及所有被引用的 `synthesized` 口播文件
- `audio/manifest.json` 及所有被引用的 `downloaded` 歌曲文件
- `assets/bgm/<name>.<ext>` 公共 BGM
- `assets/sfx/<name>.<ext>` 公共音效

`placeholder`、缺失文件、空文件、不安全的 manifest 路径或无法探测时长的
音频都会在启动 FFmpeg 前中止。素材扩展名可为 `wav`、`mp3`、`m4a`、
`aac`、`flac`、`ogg` 或 `opus`；DSL 中省略扩展名时按此顺序查找。

事件处理规则：

- `host`、`play`、`sfx` 按事件顺序进入主时间线
- `pause`、`soft`、`silence` 生成指定时长的静音
- `fade` 使用 `acrossfade` 交叉淡化相邻片段，时长不能超过任一相邻片段
- `cut` 直接连接相邻片段
- `radio`、`whoosh` 使用 `assets/sfx/radio.*`、`assets/sfx/whoosh.*`
- BGM 从 `start` 持续到 `stop`，不足时循环，并按音量和淡入淡出参数混入

所有素材先统一为 48 kHz、双声道浮点音频，再执行拼接和混音。最终使用
`loudnorm` 归一化到 -16 LUFS、LRA 11、True Peak -1.5 dB，编码为
192 kbps MP3。滤镜图通过 FFmpeg 8 的 `-/filter_complex` 文件参数传入，
避免事件较多时超过命令行长度限制。

输出：

```text
output/program.mp3
output/manifest.json
```

成品和 manifest 均通过临时文件生成；FFmpeg 失败不会覆盖已有成品。

### 11. 查看节目状态

```bash
vibefm status <节目空间命名>
```

展示各阶段状态：

```text
playlist    completed
plan        completed
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
plan -> script -> events -> audio -> speech -> render
```

参数与单阶段命令保持一致：

- `--count <number>`：策划选择的歌曲数量。仅当 `plan` 尚未完成、需要实际执行时必填
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
