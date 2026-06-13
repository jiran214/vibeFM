# 音乐播放接口

## 接口概述

- **接口名称**: 获取歌曲播放URL
- **请求方式**: POST
- **请求URL**: `https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token={csrf_token}`
- **Content-Type**: `application/x-www-form-urlencoded`
- **加密方式**: weapi加密（params + encSecKey）

## 请求参数

请求体经过weapi加密，原始参数如下：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| ids | array | 是 | 歌曲ID数组，如 `[5257138]` |
| level | string | 否 | 音质等级：standard, exhigh, lossless, hires, jyeffect, jymaster, sky, immersive |
| encodeType | string | 否 | 编码类型：aac, flac |
| spdc | string | 否 | 特殊参数 |

## 请求示例

```javascript
// 原始参数
{
  "ids": [5257138],           // 歌曲ID数组
  "level": "exhigh",          // 音质等级
  "encodeType": "aac"         // 编码类型
}

// 请求体（加密后）
params=加密后的params&encSecKey=加密后的encSecKey
```

## 响应参数

```json
{
  "data": [
    {
      "id": 5257138,                          // 歌曲ID
      "url": "http://m704.music.126.net/...",  // 播放URL（有效期1200秒）
      "br": 256002,                            // 码率
      "size": 10266692,                        // 文件大小（字节）
      "md5": "a8949c55404a93ec677fa2959fdfdd2f", // 文件MD5
      "code": 200,                             // 状态码
      "expi": 1200,                            // URL有效期（秒）
      "type": "m4a",                           // 文件类型
      "gain": 0.0,                             // 增益
      "peak": 1.0249,                          // 峰值
      "closedGain": 0.0,                       // 关闭增益
      "closedPeak": 0.0,                       // 关闭峰值
      "fee": 8,                                // 费用类型
      "uf": null,                              // 用户标志
      "payed": 1,                              // 是否已支付
      "flag": 260,                             // 标志
      "canExtend": false,                      // 是否可扩展
      "freeTrialInfo": null,                   // 免费试听信息
      "level": "exhigh",                       // 音质等级
      "encodeType": "aac",                     // 编码类型
      "channelLayout": null,                   // 声道布局
      "freeTrialPrivilege": {                  // 免费试听权限
        "resConsumable": false,
        "userConsumable": false,
        "listenType": null,
        "cannotListenReason": null,
        "playReason": null,
        "freeLimitTagType": null
      },
      "freeTimeTrialPrivilege": {              // 免费试听时间权限
        "resConsumable": false,
        "userConsumable": false,
        "type": 0,
        "remainTime": 0
      },
      "urlSource": 0,                          // URL来源
      "rightSource": 0,                        // 权限来源
      "podcastCtrp": null,                     // 播客控制
      "effectTypes": null,                     // 效果类型
      "time": 319039,                          // 时长（毫秒）
      "message": null,                         // 消息
      "levelConfuse": null,                    // 等级混淆
      "musicId": "6709986425",                 // 音乐ID
      "accompany": null,                       // 伴奏
      "sr": 44100,                             // 采样率
      "auEff": null,                           // 音频效果
      "immerseType": null,                     // 沉浸类型
      "beatType": 0                            // 节拍类型
    }
  ],
  "code": 200
}
```

## 响应字段说明

### data数组字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | int | 歌曲ID |
| url | string | 播放URL（有效期1200秒） |
| br | int | 码率（bps） |
| size | int | 文件大小（字节） |
| md5 | string | 文件MD5哈希 |
| code | int | 状态码（200=成功） |
| expi | int | URL有效期（秒） |
| type | string | 文件类型（m4a, flac等） |
| fee | int | 费用类型（0=免费，8=VIP） |
| payed | int | 是否已支付（0=未支付，1=已支付） |
| level | string | 音质等级 |
| encodeType | string | 编码类型 |
| time | int | 时长（毫秒） |
| sr | int | 采样率 |

### 音质等级说明

| 等级 | 说明 | 码率范围 |
|------|------|----------|
| standard | 标准 | 128kbps |
| exhigh | 极高 | 320kbps |
| lossless | 无损 | 999kbps |
| hires | 高解析度 | >1000kbps |
| jyeffect | 音效 | - |
| jymaster | 母带 | - |
| sky | 空间音频 | - |
| immersive | 沉浸式 | - |

## 使用示例

```python
import requests
import json

# 获取歌曲播放URL
def get_song_url(song_id, quality="exhigh"):
    url = "https://music.163.com/weapi/song/enhance/player/url/v1"
    
    # 原始参数
    data = {
        "ids": [song_id],
        "level": quality,
        "encodeType": "aac"
    }
    
    # 加密参数（需要实现weapi加密）
    encrypted_data = weapi_encrypt(json.dumps(data))
    
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://music.163.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }
    
    response = requests.post(url, data=encrypted_data, headers=headers)
    return response.json()

# 使用示例
song_id = 5257138
result = get_song_url(song_id, quality="exhigh")

if result["code"] == 200:
    song_data = result["data"][0]
    print(f"播放URL: {song_data['url']}")
    print(f"音质: {song_data['level']}")
    print(f"码率: {song_data['br']}bps")
    print(f"时长: {song_data['time']}ms")
```

## 相关接口

### 获取歌曲详情

- **接口**: `POST /weapi/v3/song/detail`
- **说明**: 获取歌曲的详细信息，包括歌手、专辑等

### 获取歌词

- **接口**: `POST /weapi/song/lyric`
- **说明**: 获取歌曲的歌词信息

## 注意事项

1. 播放URL有效期为1200秒（20分钟），过期需要重新获取
2. VIP歌曲需要用户登录并有VIP权限
3. 请求参数需要经过weapi加密
4. 不同音质等级返回不同码率的音频文件
5. 文件类型可能是m4a（aac编码）或flac（无损编码）
6. 建议在获取URL后立即开始播放，避免URL过期
