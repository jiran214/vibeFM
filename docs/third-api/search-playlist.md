# 搜索歌单接口

## 接口概述

网易云音乐提供两种搜索接口：

### 方式一：无需加密（推荐）

- **请求方式**: GET
- **请求URL**: `https://music.163.com/api/search/get/web`
- **无需加密**，直接传参即可

### 方式二：weapi加密

- **请求方式**: POST
- **请求URL**: `https://music.163.com/weapi/cloudsearch/get/web?csrf_token={csrf_token}`
- **Content-Type**: `application/x-www-form-urlencoded`
- **加密方式**: weapi加密（params + encSecKey）

---

## 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| s | string | 是 | 搜索关键词，如"周杰伦" |
| type | int | 是 | 搜索类型，1000表示歌单 |
| limit | int | 否 | 每页数量，默认30 |
| offset | int | 否 | 偏移量，用于分页 |

### type参数说明

| 值 | 说明 |
|----|------|
| 1 | 单曲 |
| 10 | 专辑 |
| 100 | 歌手 |
| 1000 | 歌单 |
| 1004 | MV |
| 1006 | 歌词 |
| 1009 | 电台 |

## 响应参数

```json
{
  "result": {
    "playlists": [
      {
        "id": 6792103822,
        "name": "周杰伦-Jay 『网易云精选』",
        "coverImgUrl": "http://p1.music.126.net/...",
        "creator": {
          "nickname": "Buradarrr",
          "userId": 361038766,
          "userType": 200,
          "avatarUrl": null,
          "authStatus": 0
        },
        "subscribed": false,
        "trackCount": 138,
        "userId": 361038766,
        "playCount": 30788066,
        "bookCount": 133660,
        "specialType": 0,
        "playlistType": "UGC",
        "description": "【持续更新】欢迎投稿...",
        "highQuality": false
      }
    ],
    "playlistCount": 465
  },
  "code": 200
}
```

## 响应字段说明

### playlists数组字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | int | 歌单ID |
| name | string | 歌单名称 |
| coverImgUrl | string | 封面图片URL |
| creator | object | 创建者信息 |
| creator.nickname | string | 创建者昵称 |
| creator.userId | int | 创建者用户ID |
| creator.userType | int | 用户类型（0=普通用户，4=认证用户，200=达人） |
| subscribed | bool | 是否已收藏 |
| trackCount | int | 歌曲数量 |
| playCount | int | 播放次数 |
| bookCount | int | 收藏次数 |
| specialType | int | 特殊类型（0=普通，300=翻唱） |
| playlistType | string | 歌单类型（UGC=用户生成） |
| description | string | 歌单描述 |
| highQuality | bool | 是否高质量歌单 |

## 使用示例

### Python（无需加密）

```python
import requests

def search_playlists(keyword, page=1, limit=30):
    url = "https://music.163.com/api/search/get/web"
    params = {
        "s": keyword,
        "type": 1000,
        "limit": limit,
        "offset": (page - 1) * limit
    }
    headers = {
        "User-Agent": "Mozilla/5.0 ...",
        "Referer": "https://music.163.com/search/"
    }
    response = requests.get(url, params=params, headers=headers)
    return response.json()

# 使用
result = search_playlists("周杰伦")
for pl in result["result"]["playlists"]:
    print(f"{pl['name']} - {pl['trackCount']}首")
```

### cURL

```bash
curl "https://music.163.com/api/search/get/web?s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1000&limit=10&offset=0" \
  -H "User-Agent: Mozilla/5.0 ..." \
  -H "Referer: https://music.163.com/search/"
```

## 注意事项

1. **推荐使用GET方式**的 `/api/search/get/web`，无需加密，调用简单
2. 搜索类型type=1000表示搜索歌单
3. 分页通过offset参数实现
4. weapi加密方式仅在需要与浏览器行为完全一致时使用
