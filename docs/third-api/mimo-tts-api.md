# MiMo-V2.5-TTS API 文档

## 概述

MiMo-V2.5-TTS 系列模型提供文本转语音服务，支持三种模型：
- `mimo-v2.5-tts` - 预设语音合成
- `mimo-v2.5-tts-voicedesign` - 语音设计
- `mimo-v2.5-tts-voiceclone` - 语音克隆

## API 端点

```
POST https://api.xiaomimimo.com/v1/chat/completions
```

## 请求头

| Header | Value | 必填 |
|--------|-------|------|
| `api-key` | `$MIMO_API_KEY` | 是 |
| `Content-Type` | `application/json` | 是 |

## 请求参数

### 顶层参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `model` | string | 是 | 模型标识符 |
| `messages` | array | 是 | 消息数组 |
| `audio` | object | 是 | 音频输出配置 |
| `stream` | boolean | 否 | 启用流式输出，默认 false |

### messages 数组

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `role` | string | 是 | `"user"` 或 `"assistant"` |
| `content` | string | 条件 | 文本内容 |

**重要**：待合成的目标文本必须放在 `"role": "assistant"` 的消息中。

### audio 对象

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `format` | string | 是 | 输出格式：`"wav"`（非流式）或 `"pcm16"`（流式） |
| `voice` | string | 条件 | 预设语音ID或base64编码的音频样本 |
| `optimize_text_preview` | boolean | 否 | 仅用于 voicedesign，智能润色文本 |

### 预设语音 ID

| 语音名称 | 语音ID | 语言 | 性别 |
|----------|--------|------|------|
| 冰糖 | `冰糖` | 中文 | 女 |
| 茉莉 | `茉莉` | 中文 | 女 |
| 苏打 | `苏打` | 中文 | 男 |
| 白桦 | `白桦` | 中文 | 男 |
| Mia | `Mia` | 英文 | 女 |
| Chloe | `Chloe` | 英文 | 女 |
| Milo | `Milo` | 英文 | 男 |
| Dean | `Dean` | 英文 | 男 |

### 语音克隆格式

voice 字段接受 base64 编码的音频字符串：
```
data:{MIME_TYPE};base64,$BASE64_AUDIO
```

- 支持格式：`mp3`、`wav`
- Base64 最大大小：10 MB

## 响应格式

响应遵循 OpenAI 兼容的 chat completion 格式。

- **非流式**：`completion.choices[0].message.audio.data` - base64 编码的音频
- **流式**：`chunk.choices[0].delta.audio.data` - base64 编码的 PCM16 音频块（24kHz, 16-bit, 小端序, 单声道）

## 示例

### 非流式（预设语音）

```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header 'Content-Type: application/json' \
    --data-raw '{
        "model": "mimo-v2.5-tts",
        "messages": [
            {"role": "user", "content": "明亮、活泼的语气"},
            {"role": "assistant", "content": "嘿，猜猜怎么着？我通过了！"}
        ],
        "audio": {"format": "wav", "voice": "冰糖"}
    }'
```

### 流式（预设语音）

```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header 'Content-Type: application/json' \
    --data-raw '{
        "model": "mimo-v2.5-tts",
        "messages": [
            {"role": "user", "content": "明亮、活泼的语气"},
            {"role": "assistant", "content": "嘿，猜猜怎么着？我通过了！"}
        ],
        "audio": {"format": "pcm16", "voice": "冰糖"},
        "stream": true
    }'
```

### 语音设计

```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header 'Content-Type: application/json' \
    --data-raw '{
        "model": "mimo-v2.5-tts-voicedesign",
        "messages": [
            {"role": "user", "content": "年轻男性的声音"},
            {"role": "assistant", "content": "是的，我吃了三明治。"}
        ],
        "audio": {"format": "wav", "optimize_text_preview": true}
    }'
```

### 语音克隆

```bash
# 先将音频文件转换为 base64
VOICE_BASE64=$(base64 -i voice.mp3)

curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header 'Content-Type: application/json' \
    --data-raw "{
        \"model\": \"mimo-v2.5-tts-voiceclone\",
        \"messages\": [
            {\"role\": \"user\", \"content\": \"\"},
            {\"role\": \"assistant\", \"content\": \"是的，我吃了三明治。\"}
        ],
        \"audio\": {
            \"format\": \"wav\",
            \"voice\": \"data:audio/mpeg;base64,$VOICE_BASE64\"
        }
    }"
```

## 流式输出规格

- 采样率：24,000 Hz
- 位深：16-bit PCM (PCM16LE)
- 声道：单声道

## 定价

目前限时免费，可在平台控制台查看使用量。
