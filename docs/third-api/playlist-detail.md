# 歌单详情接口

## 接口概述

- **接口名称**: 获取歌单详情
- **请求方式**: GET
- **请求URL**: `https://music.163.com/api/playlist/detail`
- **Content-Type**: `application/json`
- **加密方式**: 无加密（直接请求）

## 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | int | 是 | 歌单ID |

## 请求示例

```
GET https://music.163.com/api/playlist/detail?id=6792103822
```

## 响应参数

```json
{
  "result": {
    "subscribers": [],                      // 订阅者列表
    "subscribed": false,                    // 当前用户是否已订阅
    "creator": {                            // 创建者信息
      "defaultAvatar": false,
      "province": 1000000,
      "authStatus": 0,
      "followed": false,
      "avatarUrl": "http://...",
      "accountStatus": 0,
      "gender": 1,
      "city": 1010000,
      "birthday": 1646323200000,
      "userId": 361038766,
      "userType": 200,
      "nickname": "Buradarrr",
      "signature": "接合作【定制歌单…】等",
      "description": "",
      "detailDescription": "",
      "avatarImgId": 109951169650255070,
      "backgroundImgId": 109951166663360940,
      "backgroundUrl": "http://...",
      "authority": 0,
      "mutual": false,
      "expertTags": null,
      "experts": null,
      "djStatus": 10,
      "vipType": 0,
      "remarkName": null,
      "authenticationTypes": 528448,
      "avatarDetail": null,
      "avatarImgIdStr": "109951169650255065",
      "backgroundImgIdStr": "109951166663360950",
      "anchor": true,
      "avatarImgId_str": "109951169650255065"
    },
    "artists": null,
    "tracks": [                             // 歌曲列表
      {
        "name": "屋顶",                     // 歌曲名称
        "id": 5257138,                      // 歌曲ID
        "position": 1,                      // 位置
        "alias": [],                        // 别名
        "status": 0,                        // 状态
        "fee": 8,                           // 费用类型
        "copyrightId": 7001,                // 版权ID
        "disc": "1",                        // 碟片号
        "no": 1,                            // 曲目号
        "artists": [                        // 歌手列表
          {
            "name": "周杰伦",
            "id": 6452,
            "picId": 0,
            "img1v1Id": 0,
            "briefDesc": "",
            "picUrl": "http://...",
            "img1v1Url": "http://...",
            "albumSize": 0,
            "alias": [],
            "trans": "",
            "musicSize": 0,
            "topicPerson": 0
          }
        ],
        "album": {                          // 专辑信息
          "name": "男女情歌对唱冠军全记录",
          "id": 512175,
          "type": "专辑",
          "size": 26,
          "picId": 109951165671182690,
          "blurPicUrl": "http://...",
          "picUrl": "http://...",
          "publishTime": 1170604800000,
          "description": "",
          "tags": "",
          "company": "",
          "briefDesc": "",
          "artist": {...},
          "songs": [],
            "alias": [],
            "status": 0,
            "copyrightId": 7001,
            "disc": "1",
            "no": 1,
            "artists": [...],
            "album": {...}
          }
        }
      }
    ],
    // ... 其他字段
  },
  "code": 200
}
```

## 响应字段说明

### 顶层字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| subscribers | array | 订阅者列表 |
| subscribed | bool | 当前用户是否已订阅 |
| creator | object | 创建者信息 |
| tracks | array | 歌曲列表 |

### tracks数组字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| name | string | 歌曲名称 |
| id | int | 歌曲ID |
| position | int | 在歌单中的位置 |
| alias | array | 别名列表 |
| fee | int | 费用类型（0=免费，8=VIP） |
| artists | array | 歌手列表 |
| album | object | 专辑信息 |
| duration | int | 时长（毫秒） |

### artists数组字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| name | string | 歌手名称 |
| id | int | 歌手ID |
| picUrl | string | 歌手图片URL |
| alias | array | 别名列表 |

### album对象字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| name | string | 专辑名称 |
| id | int | 专辑ID |
| picUrl | string | 专辑封面URL |
| publishTime | int | 发布时间戳 |
| description | string | 专辑描述 |

## 使用示例

```python
import requests

# 获取歌单详情
def get_playlist_detail(playlist_id):
    url = f"https://music.163.com/api/playlist/detail?id={playlist_id}"
    
    headers = {
        "Referer": "https://music.163.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }
    
    response = requests.get(url, headers=headers)
    return response.json()

# 使用示例
playlist_id = 6792103822
result = get_playlist_detail(playlist_id)

# 获取歌曲列表
tracks = result.get("result", {}).get("tracks", [])
for track in tracks:
    print(f"歌曲: {track['name']}, 歌手: {track['artists'][0]['name']}")
```

## 注意事项

1. 此接口为GET请求，无需加密
2. 歌单ID从搜索接口或URL中获取
3. tracks数组包含歌单中的所有歌曲、
4. 每首歌曲包含完整的歌手和专辑信息
5. fee字段标识歌曲是否需要VIP权限
