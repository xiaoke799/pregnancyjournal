"""修复 FPK 包中 cmd/ 脚本的权限位（Windows fnpack 不保留可执行位）"""
import tarfile
import shutil
import sys
import os

src = sys.argv[1]
tmp = src + ".tmp"

with tarfile.open(src, "r:gz") as tin, tarfile.open(tmp, "w:gz") as tout:
    for member in tin.getmembers():
        f = tin.extractfile(member) if member.isfile() else None
        data = f.read() if f else None
        # cmd/ 下的脚本需要 755
        name = member.name.lstrip("./")
        if name.startswith("cmd/") and member.isfile():
            member.mode = 0o755
            print(f"chmod 755: {member.name}")
        elif member.isdir():
            member.mode = 0o755
        else:
            member.mode = 0o644
        if data is not None:
            tout.addfile(member, __import__("io").BytesIO(data))
        else:
            tout.addfile(member)

shutil.move(tmp, src)
print("done:", src, os.path.getsize(src), "bytes")
