import { writeFile } from "node:fs/promises";

import {
  synthesizeSpeech,
  synthesizeSpeechStream,
  synthesizeWithVoiceClone,
  designVoice,
  decodeAudioData,
} from "./tts.js";

async function exampleBasicTts() {
  console.log("=== 基本文本转语音示例 ===");

  const result = await synthesizeSpeech("你好，这是一段测试语音。", "冰糖");

  const audioBuffer = decodeAudioData(result.audioData);
  await writeFile("output-basic.wav", audioBuffer);
  console.log("音频已保存到 output-basic.wav");
}

async function exampleStreamTts() {
  console.log("\n=== 流式文本转语音示例 ===");

  const stream = await synthesizeSpeechStream(
    "这是一段流式语音合成的测试文本。",
    "茉莉",
  );

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (chunk.done) {
      console.log("流式传输完成");
      break;
    }
    chunks.push(decodeAudioData(chunk.audioData));
    console.log(`收到音频块，大小: ${chunk.audioData.length} bytes`);
  }

  const fullAudio = Buffer.concat(chunks);
  await writeFile("output-stream.wav", fullAudio);
  console.log("流式音频已保存到 output-stream.wav");
}

async function exampleVoiceClone() {
  console.log("\n=== 语音克隆示例 ===");

  const result = await synthesizeWithVoiceClone(
    "这是克隆语音的测试文本。",
    "./sample-voice.mp3",
  );

  const audioBuffer = decodeAudioData(result.audioData);
  await writeFile("output-clone.wav", audioBuffer);
  console.log("克隆语音已保存到 output-clone.wav");
}

async function exampleVoiceDesign() {
  console.log("\n=== 语音设计示例 ===");

  const result = await designVoice(
    "年轻女性的声音，甜美可爱",
    "这是语音设计的测试文本。",
  );

  const audioBuffer = decodeAudioData(result.audioData);
  await writeFile("output-design.wav", audioBuffer);
  console.log("设计语音已保存到 output-design.wav");
}

async function main() {
  try {
    await exampleBasicTts();
    await exampleStreamTts();
    // 注意：语音克隆需要提供样本文件
    // await exampleVoiceClone();
    await exampleVoiceDesign();
  } catch (error) {
    console.error("示例执行失败:", error);
  }
}

main();
