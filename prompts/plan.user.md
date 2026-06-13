请根据节目基础信息和压缩歌单，挑选 {{count}} 首歌曲并生成节目策划。

节目基础信息（完整 info.json）：
{{info_json}}

压缩歌单：
{{playlist_json}}

压缩歌单中每首歌曲的数组格式依次为：`[id, 标题, 歌手名数组, 专辑名]`。

输出必须严格符合以下 JSON 结构：

{
  "theme": {
    "title": "节目主题标题",
    "description": "节目主题说明"
  },
  "hostStyle": {
    "persona": "主播人设",
    "tone": "主播语气",
    "delivery": "表达节奏与方式"
  },
  "emotionalArc": [
    {
      "stage": "情绪阶段名称",
      "description": "阶段说明",
      "trackIds": [123]
    }
  ],
  "tracks": [
    {
      "id": 123,
      "selectionReason": "选曲理由",
      "emotion": "该歌曲在节目中的情绪"
    }
  ]
}

要求：
- `tracks` 必须恰好包含 {{count}} 首不同歌曲，其数组顺序就是播放顺序。
- 每个歌曲 id 必须来自压缩歌单。
- `emotionalArc` 只能引用已选歌曲，并且每首已选歌曲必须且只能出现一次。
- 所有字符串字段必须提供非空内容。
