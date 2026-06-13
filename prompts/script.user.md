请根据节目基础信息和节目策划，生成完整的 RadioScript 电台脚本。

节目基础信息：
{{info_json}}

节目策划：
{{plan_json}}

必须使用以下 DSL 结构：
- 以 `# Opening` 开始。用至少一个 `[host voice_design_prompt="..."]...[/host]` 完成开场并介绍第一首歌，然后输出第一首 `[play]`。
- 每播放完一首且后面还有歌曲时，输出 `# Block N`，用 `[host voice_design_prompt="..."]...[/host]` 完成上一首回顾、情绪过渡和下一首介绍，再输出下一首 `[play]`。
- 最后一首 `[play]` 之后输出 `# Ending`，用非空 `[host voice_design_prompt="..."]...[/host]` 完成结尾。
- 播放事件格式为 `[play id="歌曲id" fade_in="2s" fade_out="3s"]`。id 必须来自策划，数量和顺序不得改变。
- 可以按需要使用 `[bgm]`、`[pause]`、`[transition]`，语法必须符合 RadioScript；不要使用旧的 `[[PLAY:id]]` 标记。
- 主持串词应自然融合歌手、歌词主题、故事和前后歌曲的情绪衔接，且可以直接播读。
- 所有标签必须闭合，所有主持段落不得留空。

示例格式：

# Opening

[bgm name="soft_ambient" volume="25" fade_in="2s"]
[host voice_design_prompt="温柔、克制、语速偏慢、有陪伴感"]
开场白和第一首歌曲介绍。
[/host]
[bgm stop fade_out="2s"]
[transition type="soft" duration="2s"]
[play id="123456" fade_in="2s" fade_out="3s"]

# Block 1
[host voice_design_prompt="自然、沉静、语速中等"]
上一首歌曲回顾、情绪过渡和第二首歌曲介绍。
[/host]
[play id="789012" fade_in="2s" fade_out="3s"]

# Ending
[host voice_design_prompt="温柔、放松、语速慢、有晚安感"]
结束语内容。
[/host]
