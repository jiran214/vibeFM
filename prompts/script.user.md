请生成完整的 RadioScript 电台脚本。

节目描述：
{{prompt}}

按照播放顺序的歌单列表：
{{tracks_info}}

必须严格遵循以下 DSL 文档：

{{dsl_markdown}}

额外要求：
- `voice_design_prompt`不要有语速描述
- 以 `# Opening` 开始正文，以 `# Ending` 结束节目。
- 每首歌曲前必须有 `<host>...</host>` 主持串词。
- 主歌曲 source 必须严格写成 `/audio/<歌曲ID>.wav`，例如 `<audio source="/audio/123.wav" role="main" volume="100%" />`。
- 主持串词应自然融合歌手歌曲主题、歌词表达、精选评论和前后歌曲的情绪衔接。
- 歌曲可以重复使用，串词时选择性使用bed audio
- 开头合适部分插入Vibe FM的介绍

