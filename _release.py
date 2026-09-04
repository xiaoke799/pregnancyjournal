import urllib.request
import json
import base64
import os

token = os.environ.get("GITHUB_TOKEN", "")
headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "pregnancyjournal-release"
}

# Step 1: Create the release
print("Creating release...")
create_data = json.dumps({
    "tag_name": "v0.0.27",
    "name": "v0.0.27 - 飞牛OS统一网关迁移",
    "body": """## v0.0.27 - 迁移至飞牛 OS 统一网关

### 重大变更 / Breaking Change
- 访问路径从 `/cgi/ThirdParty/pregnancyjournal/index.cgi` 变更为 `/app/pregnancyjournal`
- 由 CGI 模式切换为统一网关常驻服务模式

### 变更内容 / Changes
- app/ui/config: 改用 gatewayPrefix + gatewaySocket
- server.js: TCP 端口 → Unix Socket 监听 (${TRIM_APPDEST}/target/app.sock)
- auth.js: 读取 fnOS 网关 Header (X-Trim-Userid / X-Trim-Isadmin / X-Trim-Username)
- 移除 CGI 路径剥离中间件
- 每日推送调度器适配 Unix Socket 自调用

### 优势 / Benefits
- 常驻服务，无 CGI fork 响应更快
- 支持 WebSocket
- 获取 NAS 登录态

### 系统要求 / Requirements
- FnOS >= 0.9.21
- x86-64（暂不支持 ARM）""",
    "draft": False,
    "prerelease": False
}).encode("utf-8")

req = urllib.request.Request(
    "https://api.github.com/repos/xiaoke799/pregnancyjournal/releases",
    data=create_data,
    headers=headers,
    method="POST"
)

try:
    resp = urllib.request.urlopen(req, timeout=30)
    release = json.loads(resp.read().decode())
    release_id = release["id"]
    upload_url = release["upload_url"].replace("{?name,label}", "")
    print(f"Release created! ID: {release_id}")
    print(f"URL: {release['html_url']}")
except urllib.error.HTTPError as e:
    print(f"Error {e.code}: {e.read().decode()}")
    exit(1)

# Step 2: Upload .fpk asset
fpk_path = r"D:\pregnancy-journal\pregnancyjournal_v0.0.27-gateway.fpk"
fpk_size = os.path.getsize(fpk_path)
print(f"\nUploading {os.path.basename(fpk_path)} ({fpk_size/1024/1024:.1f} MB)...")

with open(fpk_path, "rb") as f:
    fpk_data = f.read()

upload_url_full = f"{upload_url}?name=pregnancyjournal_v0.0.27-gateway.fpk"
req2 = urllib.request.Request(
    upload_url_full,
    data=fpk_data,
    headers={
        **headers,
        "Content-Type": "application/octet-stream",
        "Content-Length": str(fpk_size)
    },
    method="POST"
)

try:
    resp2 = urllib.request.urlopen(req2, timeout=120)
    asset = json.loads(resp2.read().decode())
    print(f"Asset uploaded!")
    print(f"Download: {asset['browser_download_url']}")
except urllib.error.HTTPError as e:
    print(f"Upload Error {e.code}: {e.read().decode()}")
