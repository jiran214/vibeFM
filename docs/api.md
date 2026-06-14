# vibeFM API 文档

## 基础信息

- 基础路径: `/api`
- 响应格式: JSON
- 认证: 无（本地服务）

## 统一响应格式

```json
{
  "success": true,
  "data": { ... }
}
```

错误响应:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description"
  }
}
```

## 端点列表

### 节目管理

#### GET /api/workspaces

获取节目列表。

**响应:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "name": "demo",
        "prompt": "为情所困",
        "title": "周杰伦-Jay 『网易云精选』",
        "playlistImageUrl": "https://...",
        "progress": 100
      }
    ]
  }
}
```

#### POST /api/workspaces

创建新节目。

**请求体:**

```json
{
  "name": "my-show",
  "prompt": "适合深夜独处的电台节目",
  "playlistUrl": "https://music.163.com/playlist?id=xxx",
  "playlistQuery": null
}
```

- `name`: 节目名称（必填）
- `prompt`: 节目描述
- `playlistUrl`: 网易云歌单链接
- `playlistQuery`: 歌单搜索关键词（与playlistUrl二选一）

**响应:**

```json
{
  "success": true,
  "data": {
    "action": "create",
    "workspace": { "name": "my-show", "path": "/path/to/workspace" },
    "info": { "path": "/path/to/info.json", "prompt": "..." },
    "playlist": {
      "id": "123456",
      "name": "歌单名称",
      "trackCount": 50,
      "path": "/path/to/playlist.json"
    }
  }
}
```

#### GET /api/workspaces/[name]

获取节目详情。

**响应:**

```json
{
  "success": true,
  "data": {
    "name": "demo",
    "title": "周杰伦-Jay 『网易云精选』",
    "playlistImageUrl": "https://...",
    "playlistName": "周杰伦-Jay 『网易云精选』",
    "progress": 100,
    "tracks": [
      { "id": 123, "name": "歌曲名", "artists": ["歌手1"] }
    ],
    "stages": [
      { "stage": "plan", "status": "completed" },
      { "stage": "detail", "status": "completed" },
      { "stage": "script", "status": "completed" },
      { "stage": "events", "status": "completed" },
      { "stage": "audio", "status": "completed" },
      { "stage": "speech", "status": "completed" },
      { "stage": "render", "status": "completed" }
    ],
    "hasOutput": true
  }
}
```

#### DELETE /api/workspaces/[name]

删除节目。

**响应:**

```json
{
  "success": true,
  "data": {
    "action": "delete",
    "workspace": { "name": "demo", "path": "/path/to/workspace" },
    "deleted": true
  }
}
```

#### POST /api/workspaces/[name]/generate

生成节目（长时间运行）。

**请求体:**

```json
{
  "count": 5,
  "quality": "exhigh",
  "voice": "茉莉",
  "force": false
}
```

- `count`: AI挑选的歌曲数量
- `quality`: 音频质量（standard/exhigh/lossless/hires）
- `voice`: 主播语音（bingtang/jasmine/soda/birch/Mia/Chloe/Milo/Dean/mimo_default）
- `force`: 是否强制重新生成

**响应:**

```json
{
  "success": true,
  "data": {
    "action": "generate",
    "workspace": { "name": "demo", "path": "/path/to/workspace" },
    "output": "/path/to/output/program.mp3",
    "manifest": "/path/to/output/manifest.json",
    "stages": [
      { "stage": "plan", "status": "completed" },
      { "stage": "detail", "status": "completed" },
      { "stage": "script", "status": "completed" },
      { "stage": "events", "status": "completed" },
      { "stage": "audio", "status": "completed" },
      { "stage": "speech", "status": "completed" },
      { "stage": "render", "status": "completed" }
    ]
  }
}
```

### 文件服务

#### GET /api/workspaces/[name]/files/[...path]

获取workspace内的文件。

**示例:**

- `/api/workspaces/demo/files/output/program.mp3` - 节目音频
- `/api/workspaces/demo/files/output/program.srt` - 节目字幕
- `/api/workspaces/demo/files/output/manifest.json` - 输出清单

**特性:**

- 支持Range请求（音频seek）
- 自动设置Content-Type
- 路径安全检查（防止目录遍历）

### 歌单管理

#### GET /api/playlists/search?q=xxx

搜索网易云歌单。

**查询参数:**

- `q`: 搜索关键词（必填）

**响应:**

```json
{
  "success": true,
  "data": {
    "playlistId": "123456",
    "playlistName": "歌单名称",
    "trackCount": 50
  }
}
```

#### POST /api/playlists/import

导入歌单到节目。

**请求体:**

```json
{
  "workspaceName": "demo",
  "playlistUrl": "https://music.163.com/playlist?id=xxx"
}
```

**响应:**

```json
{
  "success": true,
  "data": {
    "action": "import",
    "playlist": {
      "id": "123456",
      "name": "歌单名称",
      "trackCount": 50,
      "path": "/path/to/playlist.json"
    }
  }
}
```

### 系统测试

#### GET /api/test

测试网易云认证和AI配置。

**响应:**

```json
{
  "success": true,
  "data": {
    "cookie": {
      "cookiePath": "/path/to/.cookie",
      "account": {
        "valid": true,
        "isVip": true,
        "userId": 123456,
        "nickname": "用户名",
        "vipType": 11
      }
    },
    "ai": {
      "model": "mimo-v2.5-pro",
      "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
      "response": "ok"
    },
    "errors": []
  }
}
```

## 错误码

| 错误码 | HTTP状态码 | 说明 |
|--------|-----------|------|
| INVALID_ARGUMENTS | 400 | 参数错误 |
| WORKSPACE_NOT_FOUND | 404 | 节目不存在 |
| WORKSPACE_ALREADY_EXISTS | 409 | 节目已存在 |
| INVALID_WORKSPACE_NAME | 400 | 节目名称无效 |
| INVALID_PLAYLIST_URL | 400 | 歌单链接无效 |
| NO_SEARCH_RESULTS | 404 | 搜索无结果 |
| PLAYLIST_REQUEST_FAILED | 502 | 歌单请求失败 |
| SEARCH_REQUEST_FAILED | 502 | 搜索请求失败 |
| AI_REQUEST_FAILED | 502 | AI请求失败 |
| INTERNAL_ERROR | 500 | 内部错误 |

## 前端页面

### 首页

- URL: `/index.html`
- 功能: 创建节目、查看节目列表、测试连接

### 详情页

- URL: `/show.html?name=[节目名]`
- 功能: 播放节目、查看字幕、节目详情

## 注意事项

1. 所有API调用core层，外层不写业务逻辑
2. 节目列表接口支持轮询，progress < 100的节目不可点击进入详情
3. 生成接口是长时间运行的，建议轮询进度
4. 文件服务支持Range请求，用于音频seek
