# TTS 模块使用指南

## 概述

TTS 模块提供了基于 MiMo-V2.5-TTS 系列模型的文本转语音功能，支持：
- 预设语音合成
- 流式语音合成
- 语音克隆
- 语音设计

## 配置

### 1. 环境变量

在 `.env` 文件中添加：

```env
MIMO_API_KEY=your-mimo-api-key
```

### 2. 获取 API Key

访问 [MiMo 平台](https://mimo.mi.com) 注册并获取 API Key。

## 使用方法

### 基本文本转语音

```typescript
import { synthesizeSpeech, decodeAudioData } from "./tts";
import { writeFile } from "node:fs/promises";

async function basicExample() {
  const result = await synthesizeSpeech("你好，世界！", "冰糖");
  const audioBuffer = decodeAudioData(result.audioData);
  await writeFile("output.wav", audioBuffer);
}
```

### 流式语音合成

```typescript
import { synthesizeSpeechStream, decodeAudioData } from "./tts";
import { writeFile } from "node:fs/promises";

async function streamExample() {
  const stream = await synthesizeSpeechStream("这是一段长文本...", "茉莉");

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (chunk.done) break;
    chunks.push(decodeAudioData(chunk.audioData));
  }

  const fullAudio = Buffer.concat(chunks);
  await writeFile("output-stream.wav", fullAudio);
}
```

### 语音克隆

```typescript
import { synthesizeWithVoiceClone, decodeAudioData } from "./tts";
import { writeFile } from "node:fs/promises";

async function cloneExample() {
  const result = await synthesizeWithVoiceClone(
    "这是克隆语音的文本。",
    "./voice-sample.mp3"  // 提供语音样本文件路径
  );
  const audioBuffer = decodeAudioData(result.audioData);
  await writeFile("output-clone.wav", audioBuffer);
}
```

### 语音设计

```typescript
import { designVoice, decodeAudioData } from "./tts";
import { writeFile } from "node:fs/promises";

async function designExample() {
  const result = await designVoice(
    "年轻女性的声音，甜美可爱",  // 语音描述
    "这是设计语音的文本。"        // 可选：要合成的文本
  );
  const audioBuffer = decodeAudioData(result.audioData);
  await writeFile("output-design.wav", audioBuffer);
}
```

## API 参考

### synthesizeSpeech(text, voice?, options?)

基本文本转语音函数。

**参数：**
- `text` (string): 要合成的文本
- `voice` (TtsVoice): 预设语音，默认 "冰糖"
- `options` (object): 可选配置
  - `model` (TtsModel): 模型标识符
  - `audio` (TtsAudioConfig): 音频配置

**返回：** `Promise<TtsResponse>`

### synthesizeSpeechStream(text, voice?, options?)

流式文本转语音函数。

**参数：** 同 `synthesizeSpeech`

**返回：** `Promise<AsyncGenerator<TtsStreamChunk>>`

### synthesizeWithVoiceClone(text, voiceSamplePath, options?)

语音克隆函数。

**参数：**
- `text` (string): 要合成的文本
- `voiceSamplePath` (string): 语音样本文件路径
- `options` (object): 可选配置

**返回：** `Promise<TtsResponse>`

### designVoice(description, text?, options?)

语音设计函数。

**参数：**
- `description` (string): 语音描述
- `text` (string): 可选，要合成的文本
- `options` (object): 可选配置

**返回：** `Promise<TtsResponse>`

### decodeAudioData(base64Data)

解码 base64 音频数据。

**参数：**
- `base64Data` (string): base64 编码的音频数据

**返回：** `Buffer`

## 预设语音列表

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

## 错误处理

模块会抛出 `TtsRequestError` 错误，包含以下错误代码：

- `INVALID_TTS_CONFIG`: 配置错误
- `TTS_REQUEST_FAILED`: API 请求失败
- `EMPTY_TTS_RESPONSE`: 响应中没有音频数据
- `INVALID_AUDIO_FORMAT`: 音频格式错误

## 示例文件

运行示例：

```bash
npx ts-node src/core/tts-example.ts
```

## 注意事项

1. 语音克隆功能需要提供语音样本文件（支持 mp3 和 wav 格式）
2. 语音样本文件大小限制：base64 编码后最大 10MB
3. 流式输出使用 PCM16 格式，采样率 24kHz
4. 非流式输出使用 WAV 格式
