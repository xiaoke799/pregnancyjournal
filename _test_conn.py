import urllib.request

headers = {"User-Agent": "test", "Authorization": "Bearer " + __import__('os').environ.get("GITHUB_TOKEN","")}

tests = [
    ("https://api.github.com/zen", "API"),
    ("https://github.com", "Web"),
    ("https://github.com/xiaoke799/pregnancyjournal.git/info/refs?service=git-upload-pack", "Git"),
]

for url, name in tests:
    try:
        req = urllib.request.Request(url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=10)
        print(f"{name}: OK ({resp.status})")
    except Exception as e:
        print(f"{name}: FAIL ({str(e)[:100]})")
