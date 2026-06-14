# 项目简介
vibeFM
AI智能搜索歌单，挑选歌曲，制作电台节目

# 搜索输入
模式一： 输入网易云歌单url，从中让ai挑选n首，生成电台
模式二： 用户输入描述文本，搜索前n个歌单，ai挑选n首歌曲，生成电台（暂不实现）

# 数据流
- 音乐列表
- 转描述文本
- prompt组合
- AI生成结构化数据
    主题
    挑选歌曲
    情绪曲线
    主播风格
- 补充信息
- AI生成文稿：开场，串词：歌手、歌词、故事，结尾
- 音频下载、处理
- 成品音频文件

# 数据存储
基于本地文件存储在workspace下
每个文件夹对应一个电台节目

# 分层架构
- core：业务逻辑、生成节目、处理数据。不关心 HTTP、命令行参数
- cli：解析命令行参数、打印结果，不写复杂业务逻辑
- server：接收 HTTP 请求、返回 JSON，不写复杂业务逻辑（暂不实现）
- ui：基于server接口的ui（暂不实现）

# ai生成说明
- 每个步骤生成时，在core层，都要检查依赖文件是否存在和完整

# 重要文档
- `docs/技术决策.md` （新增功能请主动修改文档内容）
- `docs/cli.md` 命令说明
- `docs/dsl.md` 电台节目脚本规则
- `logs` AI生成日志

# 支持cli命令
npm run cli -- cookie
npm run cli -- create demo --prompt 为情所困
npm run cli -- delete demo
npm run cli -- import segu 'https://music.163.com/playlist?id=7421536874&uct2=U2FsdGVkX18WnNMZOw/O3afBTzBE50bCzs6EtnNtr9U='
npm run cli -- generate plan demo --count 5
npm run cli -- generate script demo
npm run cli -- generate events demo
npm run cli -- generate audio demo
npm run cli -- generate speech demo
npm run cli -- generate render demo
npm run cli -- generate all demo --count 5 --quality exhigh --voice 茉莉

# 注意
- 开发debug必须使用tdd

