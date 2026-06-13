RadioScript 是一种 AI 电台节目脚本格式。

它用 Markdown 写节目内容，用少量标签标记音频事件，程序解析后交给 TTS、音乐接口和 FFmpeg 渲染成完整节目。

设计原则：人能读、AI 好生成、程序好解析、FFmpeg 好执行

使用 `vibefm generate events <节目空间命名>` 可将脚本转换为有序的
`events.json`。事件流会忽略 Markdown 标题，为每个 host 分配 `host-001`
形式的 ID，将百分比音量转换为 `0..1`，并将 `s` 时间转换为秒数。

基础结构如下

# Opening
[host voice_design_prompt="温柔、低声、语速偏慢、有深夜电台感"]
主播口播内容。
[/host]
[play id="歌曲ID"]

事件类型

1. [host]

主播口播。内容会交给 TTS 生成语音。

[host voice_design_prompt="温柔、克制、语速偏慢、有陪伴感"]
(磁性)晚上好，欢迎来到今晚的节目。
[/host]

参数：

voice_design_prompt  通过自然语言描述，让模型理解并生成对应风格的语音

由 `generate script` 生成的脚本要求每个 `[host]` 都提供非空
`voice_design_prompt`，且标签内必须有可播读文本。

具体参考：`docs/tts-voice-control.md`
⸻

2. [play]

播放歌曲。

[play id="33894312" fade_in="2s" fade_out="3s"]

常用参数：

id        歌曲 ID
fade_in   淡入
fade_out  淡出

⸻

3. [bgm]

背景音乐。

[bgm name="soft_piano" volume="25" fade_in="2s"]

停止背景音乐：

[bgm stop fade_out="2s"]

常用参数：

name      BGM 名称
volume    音量百分比
fade_in   淡入
fade_out  淡出

⸻

4. [sfx]

音效。

[sfx name="radio_noise" volume="20"]

常用参数：

name    音效名称
volume  音量百分比

⸻

5. [pause]

停顿。

[pause 1.5s]

⸻

6. [transition]

转场。

[transition type="soft" duration="3s"]

常用参数：

type      转场类型
    soft        柔和静音过渡，插入指定时长静音
    fade        前后音频交叉淡化，时长不得超过任一相邻片段
    silence     纯静音停顿
    cut         直接切换
duration  转场时长

`[sfx name="..."]` 从项目根目录 `assets/sfx` 查找公共素材，`[bgm
name="..."]` 从 `assets/bgm` 查找。名称可包含扩展名；省略扩展名时渲染器
依次查找 `wav`、`mp3`、`m4a`、`aac`、`flac`、`ogg`、`opus`。

⸻

最小事件集合

[host]        主播口播
[play]        播放歌曲
[bgm]         背景音乐
[pause]       停顿
[transition]  转场

完整示例：包含所有类型

# Opening
[bgm name="soft_ambient" volume="25" fade_in="3s"]
[host voice_design_prompt="温柔、低声、语速偏慢、有深夜电台感"]
晚上好，欢迎来到《城市夜行》。
这是一档适合在夜里听的音乐节目。
不用急着回答什么，也不用急着变好。
今晚，我们只是在几首歌里，慢慢走一段路。
[/host]
[pause 1s]
[host voice_design_prompt="温柔、轻声、带一点陪伴感"]
第一首歌，送给还没有睡的人。
[/host]
[bgm stop fade_out="2s"]
[transition type="soft" duration="2s"]
[play id="33894312" fade_in="2s" fade_out="3s"]
# Block 1
[bgm name="soft_piano" volume="20" fade_in="2s"]
[host voice_design_prompt="克制、低声、略带怀旧感、语速中等"]
刚才这首歌，像是一个人走在城市边缘。
我看到有听众在评论里写：
“有些夜晚不是难过，只是突然安静下来。”
这句话很适合放在今晚。
[/host]
[pause 1.2s]
[host voice_design_prompt="温柔、自然、语速中等"]
接下来这首歌，节奏会轻一点。
像是从一条昏暗的街，慢慢走到有灯的地方。
[/host]
[bgm stop fade_out="2s"]
[transition type="radio" duration="3s"]
[play id="123456" fade_in="2s" fade_out="3s"]
# Ending
[bgm name="soft_ambient" volume="22" fade_in="3s"]
[host voice_design_prompt="温柔、放松、语速慢、有晚安感"]
今晚的《城市夜行》到这里就要结束了。
如果这些歌刚好陪你走过一段路，
那它们的任务就完成了。
愿你今晚睡得安稳。
我们下次再见。
[/host]
[pause 1s]
[bgm stop fade_out="5s"]
