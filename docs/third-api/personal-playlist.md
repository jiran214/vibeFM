网易云音乐：每日推荐歌曲 / 我的收藏歌单 API 文档

基于 wangwalk/neteasecli 的请求方式整理。该项目统一通过 ApiClient.request() 发起请求，默认使用 weapi 加密；实际请求路径会从 /xxx 转成 /weapi/xxx，请求体为 params + encSecKey。 

⸻

1. 通用配置

Base URL

https://music.163.com

通用请求方式

POST
Content-Type: application/x-www-form-urlencoded

通用 Headers

-H 'Content-Type: application/x-www-form-urlencoded'
-H 'Referer: https://music.163.com/'
-H 'User-Agent: Mozilla/5.0'
-H "Cookie: MUSIC_U=xxx; __csrf=xxx; NMTID=xxx"

Cookie

这两个接口都属于用户态数据，建议必须登录后请求。

COOKIE='MUSIC_U=你的值; __csrf=你的值; NMTID=你的值'
CSRF='你的__csrf值'

⸻

2. weapi 加密

请求体不是普通 JSON，而是：

params=<加密参数>&encSecKey=<加密密钥>

项目中的 weapi() 逻辑是：

JSON.stringify(data)
  -> AES-CBC 使用 preset key 加密
  -> AES-CBC 使用随机 secretKey 再加密
  -> RSA 加密 secretKey
  -> 输出 params + encSecKey

对应源码在 crypto.ts。 

weapi.js

const crypto = require('crypto');
const IV = '0102030405060708';
const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const PUBLIC_KEY =
`-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;
function aesEncrypt(text, key, iv = IV) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  return cipher.update(text, 'utf8', 'base64') + cipher.final('base64');
}
function rsaEncrypt(text) {
  const reversed = text.split('').reverse().join('');
  const buffer = Buffer.alloc(128, 0);
  Buffer.from(reversed).copy(buffer, 128 - reversed.length);
  return crypto.publicEncrypt(
    {
      key: PUBLIC_KEY,
      padding: crypto.constants.RSA_NO_PADDING
    },
    buffer
  ).toString('hex');
}
function randomKey(size = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < size; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}
const input = JSON.parse(process.argv[2]);
const secretKey = randomKey();
const params1 = aesEncrypt(JSON.stringify(input), PRESET_KEY);
const params = aesEncrypt(params1, secretKey);
const encSecKey = rsaEncrypt(secretKey);
console.log(`params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`);

⸻

3. 每日推荐歌曲列表

neteasecli 当前源码里没有直接封装每日推荐歌曲接口，但可以沿用同样的 weapi 请求方式。

接口

POST /weapi/v1/discovery/recommend/songs

原始参数

{
  "csrf_token": "你的 csrf token"
}

curl 示例

CSRF='你的__csrf值'
COOKIE='MUSIC_U=你的值; __csrf=你的值; NMTID=你的值'
BODY=$(node weapi.js "{
  \"csrf_token\": \"$CSRF\"
}")
curl "https://music.163.com/weapi/v1/discovery/recommend/songs?csrf_token=${CSRF}" \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Referer: https://music.163.com/' \
  -H 'User-Agent: Mozilla/5.0' \
  -H "Cookie: $COOKIE" \
  --data "$BODY"

常见返回结构

{
  "code": 200,
  "recommend": [
    {
      "id": 33894312,
      "name": "歌曲名",
      "artists": [
        {
          "id": 123,
          "name": "歌手名"
        }
      ],
      "album": {
        "id": 456,
        "name": "专辑名",
        "picUrl": "封面图"
      },
      "duration": 240000,
      "reason": "推荐理由"
    }
  ]
}

推荐解析字段

{
  "song_id": "id",
  "title": "name",
  "artists": "artists[].name",
  "album": "album.name",
  "cover_url": "album.picUrl",
  "duration_ms": "duration",
  "recommend_reason": "reason"
}

jq 示例

curl_result | jq '{
  code,
  songs: [.recommend[]? | {
    id,
    name,
    artists: [.artists[]?.name],
    album: .album.name,
    cover_url: .album.picUrl,
    duration_ms: .duration,
    reason
  }]
}'

⸻

4. 获取当前登录用户 ID

我的收藏歌单列表通常需要 uid。项目里的逻辑是：如果没有传 uid，先请求 /nuser/account/get 获取当前登录用户的 profile.userId。 

接口

POST /weapi/nuser/account/get

原始参数

{
  "csrf_token": "你的 csrf token"
}

curl 示例

CSRF='你的__csrf值'
COOKIE='MUSIC_U=你的值; __csrf=你的值; NMTID=你的值'
BODY=$(node weapi.js "{
  \"csrf_token\": \"$CSRF\"
}")
curl "https://music.163.com/weapi/nuser/account/get?csrf_token=${CSRF}" \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Referer: https://music.163.com/' \
  -H 'User-Agent: Mozilla/5.0' \
  -H "Cookie: $COOKIE" \
  --data "$BODY"

返回字段

{
  "code": 200,
  "profile": {
    "userId": 123456,
    "nickname": "用户名"
  }
}

提取 UID

UID=$(curl_result | jq -r '.profile.userId')

⸻

5. 我的收藏歌单列表

项目中 getUserPlaylists(uid?) 使用的是 /user/playlist，参数为 uid, limit:1000, offset:0。  返回后提取 id/name/description/coverImgUrl/trackCount/creator。 

接口

POST /weapi/user/playlist

原始参数

{
  "uid": "用户ID",
  "limit": 1000,
  "offset": 0,
  "csrf_token": "你的 csrf token"
}

curl 示例

UID='你的用户ID'
CSRF='你的__csrf值'
COOKIE='MUSIC_U=你的值; __csrf=你的值; NMTID=你的值'
BODY=$(node weapi.js "{
  \"uid\": \"$UID\",
  \"limit\": 1000,
  \"offset\": 0,
  \"csrf_token\": \"$CSRF\"
}")
curl "https://music.163.com/weapi/user/playlist?csrf_token=${CSRF}" \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Referer: https://music.163.com/' \
  -H 'User-Agent: Mozilla/5.0' \
  -H "Cookie: $COOKIE" \
  --data "$BODY"

分页参数

limit  = 每页数量
offset = 偏移量

示例：

# 第 1 页
limit=50
offset=0
# 第 2 页
limit=50
offset=50
# 第 3 页
limit=50
offset=100

常见返回结构

{
  "code": 200,
  "playlist": [
    {
      "id": 123456789,
      "name": "我喜欢的音乐",
      "description": "歌单描述",
      "coverImgUrl": "封面图",
      "trackCount": 128,
      "subscribed": false,
      "creator": {
        "userId": 123456,
        "nickname": "用户名"
      }
    }
  ]
}

推荐解析字段

{
  "playlist_id": "id",
  "name": "name",
  "description": "description",
  "cover_url": "coverImgUrl",
  "track_count": "trackCount",
  "creator_id": "creator.userId",
  "creator_name": "creator.nickname",
  "subscribed": "subscribed"
}

jq 示例

curl_result | jq '{
  code,
  playlists: [.playlist[]? | {
    id,
    name,
    description,
    cover_url: .coverImgUrl,
    track_count: .trackCount,
    subscribed,
    creator: {
      id: .creator.userId,
      name: .creator.nickname
    }
  }]
}'

⸻

6. 区分“我创建的歌单”和“我收藏的歌单”

/user/playlist 会返回用户相关歌单，通常包含：

1. 自己创建的歌单
2. 收藏/订阅的歌单

可以用 creator.userId == 当前 UID 判断是否为自己创建。

jq 分类示例

curl_result | jq --argjson uid "$UID" '{
  created_playlists: [
    .playlist[]?
    | select(.creator.userId == $uid)
    | {
      id,
      name,
      track_count: .trackCount,
      cover_url: .coverImgUrl
    }
  ],
  subscribed_playlists: [
    .playlist[]?
    | select(.creator.userId != $uid)
    | {
      id,
      name,
      track_count: .trackCount,
      cover_url: .coverImgUrl,
      creator: .creator.nickname
    }
  ]
}'

如果你只要“收藏的歌单”，取 creator.userId != 当前 UID。

⸻

7. 一键 Shell 封装

netease_weapi_post() {
  local endpoint="$1"
  local json="$2"
  local body
  body=$(node weapi.js "$json")
  curl "https://music.163.com/weapi${endpoint}?csrf_token=${CSRF}" \
    -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H 'Referer: https://music.163.com/' \
    -H 'User-Agent: Mozilla/5.0' \
    -H "Cookie: $COOKIE" \
    --data "$body"
}

获取每日推荐歌曲

netease_weapi_post "/v1/discovery/recommend/songs" "{
  \"csrf_token\": \"$CSRF\"
}"

获取当前用户信息

netease_weapi_post "/nuser/account/get" "{
  \"csrf_token\": \"$CSRF\"
}"

获取我的歌单列表

netease_weapi_post "/user/playlist" "{
  \"uid\": \"$UID\",
  \"limit\": 1000,
  \"offset\": 0,
  \"csrf_token\": \"$CSRF\"
}"

⸻

8. 给应用层的统一输出结构

建议你在后端统一转成这种格式：

{
  "daily_recommend_songs": [
    {
      "song_id": "33894312",
      "title": "歌曲名",
      "artists": ["歌手名"],
      "album": "专辑名",
      "cover_url": "https://...",
      "duration_ms": 240000,
      "recommend_reason": "推荐理由"
    }
  ],
  "playlists": {
    "created": [
      {
        "playlist_id": "123",
        "name": "我喜欢的音乐",
        "description": "",
        "cover_url": "https://...",
        "track_count": 100
      }
    ],
    "subscribed": [
      {
        "playlist_id": "456",
        "name": "收藏的歌单",
        "description": "",
        "cover_url": "https://...",
        "track_count": 80,
        "creator_name": "歌单作者"
      }
    ]
  }
}

⸻

9. 注意事项

1. 每日推荐歌曲和我的歌单都需要登录 Cookie。
2. Cookie 失效时可能返回 301、401、403 或空数据。
3. /user/playlist 返回的是用户相关歌单，需要按 creator.userId 判断创建/收藏。
4. 这些是网易云非公开接口，线上使用要加缓存、限频和错误处理。
5. 不建议高频抓取，避免账号风控。