请生成完整的 RadioScript 电台脚本。

节目基础信息：
{{info_json}}

节目策划：
{{plan_json}}

按播放顺序补充后的歌曲信息：
{{tracks_json}}

必须严格遵循以下 DSL 文档：

{{dsl_markdown}}

额外要求：
- frontmatter 必须提供节目 `title` 和默认 `voice_design_prompt`。
- 以 `# Opening` 开始正文，以 `# Ending` 结束节目。
- 每首歌曲前必须有 `<host>...</host>` 主持串词。
- 主歌曲 source 必须严格写成 `/audio/<歌曲ID>.wav`，例如 `<audio source="/audio/123.wav" role="main" volume="100%" />`。
- 主持串词应自然融合歌手、歌曲主题、故事表达和前后歌曲的情绪衔接，并可直接播读。
