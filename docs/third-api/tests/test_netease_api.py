"""
网易云音乐API测试用例
测试搜索歌单、歌单详情、音乐播放三个接口
"""

import requests
import json
import base64
import binascii
import random
import string
from Crypto.Cipher import AES
import unittest


class NeteaseCrypto:
    """网易云音乐加密工具"""

    IV = b"0102030405060708"
    PRESET_KEY = b"0CoJUm6Qyw8W8jud"
    PUBLIC_KEY = "010001"
    MODULUS = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7"

    @staticmethod
    def pad(s):
        """PKCS7填充"""
        block_size = 16
        pad_len = block_size - len(s.encode('utf-8')) % block_size
        return s + chr(pad_len) * pad_len

    @classmethod
    def aes_encrypt(cls, text, key):
        """AES-CBC加密"""
        text = cls.pad(text).encode("utf-8")
        key = key.encode("utf-8")
        iv = cls.IV
        cipher = AES.new(key, AES.MODE_CBC, iv)
        encrypted = cipher.encrypt(text)
        return base64.b64encode(encrypted).decode("utf-8")

    @classmethod
    def rsa_encrypt(cls, text):
        """RSA加密"""
        text = text[::-1]
        rs = int(binascii.hexlify(text.encode()), 16)
        rs = pow(rs, int(cls.PUBLIC_KEY, 16), int(cls.MODULUS, 16))
        return format(rs, 'x').zfill(256)

    @classmethod
    def weapi_encrypt(cls, text):
        """生成weapi加密参数"""
        # 生成16位随机密钥
        secret_key = ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))

        # 第一次加密
        first_encrypt = cls.aes_encrypt(text, cls.PRESET_KEY.decode())
        # 第二次加密
        second_encrypt = cls.aes_encrypt(first_encrypt, secret_key)
        # RSA加密密钥
        enc_seckey = cls.rsa_encrypt(secret_key)

        return {
            "params": second_encrypt,
            "encSecKey": enc_seckey
        }


class NeteaseAPI:
    """网易云音乐API客户端"""

    BASE_URL = "https://music.163.com"

    def __init__(self, csrf_token=""):
        self.csrf_token = csrf_token
        self.session = requests.Session()

    def search_playlists(self, keyword, page=1, limit=30):
        """搜索歌单（使用无需加密的api接口）"""
        offset = (page - 1) * limit
        url = f"{self.BASE_URL}/api/search/get/web"

        params = {
            "s": keyword,
            "type": 1000,
            "limit": limit,
            "offset": offset,
        }

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            "Referer": "https://music.163.com/search/",
        }

        response = self.session.get(url, params=params, headers=headers)
        return response.json()

    def get_playlist_detail(self, playlist_id):
        """获取歌单详情（使用api接口）"""
        url = f"{self.BASE_URL}/api/playlist/detail?id={playlist_id}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            "Referer": f"https://music.163.com/playlist?id={playlist_id}",
        }

        response = self.session.get(url, headers=headers)
        return response.json()

    def get_song_url(self, song_id, quality="exhigh"):
        """获取歌曲播放URL"""
        url = f"{self.BASE_URL}/weapi/song/enhance/player/url/v1?csrf_token={self.csrf_token}"

        data = {
            "ids": [song_id],
            "level": quality,
            "encodeType": "aac",
            "csrf_token": self.csrf_token
        }

        encrypted = NeteaseCrypto.weapi_encrypt(json.dumps(data))

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            "Referer": f"https://music.163.com/song?id={song_id}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://music.163.com",
        }

        response = self.session.post(url, data=encrypted, headers=headers)
        return response.json()

    def get_song_detail(self, song_id):
        """获取歌曲详情"""
        url = f"{self.BASE_URL}/weapi/v3/song/detail?csrf_token={self.csrf_token}"

        data = {
            "c": json.dumps([{"id": song_id}]),
            "ids": json.dumps([song_id]),
            "csrf_token": self.csrf_token
        }

        encrypted = NeteaseCrypto.weapi_encrypt(json.dumps(data))

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            "Referer": f"https://music.163.com/song?id={song_id}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://music.163.com",
        }

        response = self.session.post(url, data=encrypted, headers=headers)
        return response.json()


class TestNeteaseAPI(unittest.TestCase):
    """网易云音乐API测试用例"""

    def setUp(self):
        """测试前初始化"""
        self.api = NeteaseAPI()
        self.test_keyword = "周杰伦"
        self.test_playlist_id = 6792103822
        self.test_song_id = 5257138

    def test_01_search_playlists(self):
        """测试搜索歌单接口"""
        print("\n=== 测试搜索歌单接口 ===")

        # 执行搜索
        result = self.api.search_playlists(self.test_keyword, page=1, limit=10)

        # 验证响应状态
        self.assertEqual(result.get("code"), 200, f"搜索接口返回错误: {result}")

        # 验证结果结构
        self.assertIn("result", result, "响应缺少result字段")
        self.assertIn("playlists", result["result"], "结果缺少playlists字段")
        self.assertIn("playlistCount", result["result"], "结果缺少playlistCount字段")

        # 验证歌单列表
        playlists = result["result"]["playlists"]
        self.assertGreater(len(playlists), 0, "搜索结果为空")

        # 验证歌单字段
        first_playlist = playlists[0]
        required_fields = ["id", "name", "coverImgUrl", "trackCount", "playCount"]
        for field in required_fields:
            self.assertIn(field, first_playlist, f"歌单缺少{field}字段")

        # 打印结果
        print(f"搜索关键词: {self.test_keyword}")
        print(f"找到歌单数量: {result['result']['playlistCount']}")
        print(f"返回歌单数量: {len(playlists)}")
        print("\n前3个歌单:")
        for i, pl in enumerate(playlists[:3]):
            print(f"  {i+1}. {pl['name']} (ID: {pl['id']}, 歌曲数: {pl['trackCount']}, 播放: {pl['playCount']})")

        # 保存第一个歌单ID供后续测试使用
        TestNeteaseAPI.found_playlist_id = playlists[0]["id"]

    def test_02_playlist_detail(self):
        """测试歌单详情接口"""
        print("\n=== 测试歌单详情接口 ===")

        # 使用搜索到的歌单ID
        playlist_id = getattr(TestNeteaseAPI, 'found_playlist_id', self.test_playlist_id)

        # 获取歌单详情
        result = self.api.get_playlist_detail(playlist_id)

        # 验证响应状态
        self.assertEqual(result.get("code"), 200, f"歌单详情接口返回错误: {result}")

        # 验证结果结构
        self.assertIn("result", result, "响应缺少result字段")

        playlist = result["result"]
        self.assertIn("tracks", playlist, "结果缺少tracks字段")
        self.assertIn("name", playlist, "结果缺少name字段")

        # 验证歌曲列表
        tracks = playlist["tracks"]
        self.assertGreater(len(tracks), 0, "歌单歌曲列表为空")

        # 验证歌曲字段
        first_track = tracks[0]
        required_fields = ["id", "name", "artists", "album"]
        for field in required_fields:
            self.assertIn(field, first_track, f"歌曲缺少{field}字段")

        # 验证歌手信息
        self.assertGreater(len(first_track["artists"]), 0, "歌曲缺少歌手信息")
        self.assertIn("name", first_track["artists"][0], "歌手缺少name字段")

        # 打印结果
        print(f"歌单ID: {playlist_id}")
        print(f"歌单名称: {playlist.get('name', 'N/A')}")
        print(f"歌曲数量: {len(tracks)}")
        print("\n前5首歌曲:")
        for i, track in enumerate(tracks[:5]):
            artists = "/".join([a["name"] for a in track["artists"]])
            print(f"  {i+1}. {track['name']} - {artists}")

        # 保存第一个歌曲ID供后续测试使用
        TestNeteaseAPI.found_song_id = tracks[0]["id"]

    def test_03_music_playback(self):
        """测试音乐播放接口"""
        print("\n=== 测试音乐播放接口 ===")

        # 使用歌单中的歌曲ID
        song_id = getattr(TestNeteaseAPI, 'found_song_id', self.test_song_id)

        # 获取歌曲播放URL
        result = self.api.get_song_url(song_id, quality="exhigh")

        # 验证响应状态
        self.assertEqual(result.get("code"), 200, f"播放接口返回错误: {result}")

        # 验证结果结构
        self.assertIn("data", result, "响应缺少data字段")
        self.assertGreater(len(result["data"]), 0, "播放数据为空")

        # 验证播放数据
        song_data = result["data"][0]
        required_fields = ["id", "url", "br", "size", "type", "time"]
        for field in required_fields:
            self.assertIn(field, song_data, f"播放数据缺少{field}字段")

        # 验证URL有效性
        self.assertIsNotNone(song_data["url"], "播放URL为空")
        self.assertTrue(song_data["url"].startswith("http"), "播放URL格式错误")

        # 验证音质信息
        self.assertGreater(song_data["br"], 0, "码率应大于0")
        self.assertGreater(song_data["size"], 0, "文件大小应大于0")
        self.assertGreater(song_data["time"], 0, "时长应大于0")

        # 打印结果
        print(f"歌曲ID: {song_id}")
        print(f"音质等级: {song_data.get('level', 'N/A')}")
        print(f"码率: {song_data['br']}bps")
        print(f"文件大小: {song_data['size'] / 1024 / 1024:.2f}MB")
        print(f"时长: {song_data['time'] / 1000:.0f}秒")
        print(f"文件类型: {song_data['type']}")
        print(f"播放URL: {song_data['url'][:100]}...")

        # 验证URL可访问性（可选）
        try:
            head_response = requests.head(song_data["url"], timeout=5)
            print(f"URL状态: {head_response.status_code}")
        except Exception as e:
            print(f"URL验证跳过: {e}")


class TestNeteaseAPIIntegration(unittest.TestCase):
    """集成测试：完整流程测试"""

    def test_full_flow(self):
        """测试完整流程：搜索歌单 -> 获取详情 -> 播放歌曲"""
        print("\n=== 集成测试：完整流程 ===")

        api = NeteaseAPI()

        # Step 1: 搜索歌单
        print("\n[Step 1] 搜索歌单...")
        search_result = api.search_playlists("周杰伦", limit=5)
        self.assertEqual(search_result["code"], 200, f"搜索失败: {search_result}")

        playlists = search_result["result"]["playlists"]
        self.assertGreater(len(playlists), 0, "搜索结果为空")

        playlist_id = playlists[0]["id"]
        print(f"选择歌单: {playlists[0]['name']} (ID: {playlist_id})")

        # Step 2: 获取歌单详情
        print("\n[Step 2] 获取歌单详情...")
        detail_result = api.get_playlist_detail(playlist_id)
        self.assertEqual(detail_result["code"], 200, f"获取详情失败: {detail_result}")

        tracks = detail_result["result"]["tracks"]
        self.assertGreater(len(tracks), 0, "歌单无歌曲")

        song_id = tracks[0]["id"]
        song_name = tracks[0]["name"]
        artists = "/".join([a["name"] for a in tracks[0]["artists"]])
        print(f"选择歌曲: {song_name} - {artists} (ID: {song_id})")

        # Step 3: 获取播放URL
        print("\n[Step 3] 获取播放URL...")
        url_result = api.get_song_url(song_id)
        self.assertEqual(url_result["code"], 200, f"获取URL失败: {url_result}")

        song_data = url_result["data"][0]
        self.assertIsNotNone(song_data["url"], "播放URL为空")

        print(f"播放URL获取成功")
        print(f"  - 音质: {song_data.get('level', 'N/A')}")
        print(f"  - 码率: {song_data['br']}bps")
        print(f"  - 时长: {song_data['time'] / 1000:.0f}秒")

        print("\n✓ 完整流程测试通过!")


def run_tests():
    """运行所有测试"""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    suite.addTests(loader.loadTestsFromTestCase(TestNeteaseAPI))
    suite.addTests(loader.loadTestsFromTestCase(TestNeteaseAPIIntegration))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    return result


if __name__ == "__main__":
    print("=" * 60)
    print("网易云音乐API测试")
    print("=" * 60)

    # run_tests()
    print(NeteaseAPI().get_playlist_detail(2138376251))
