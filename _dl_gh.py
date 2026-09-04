import urllib.request, os, zipfile

url = "https://github.com/cli/cli/releases/download/v2.98.0/gh_2.98.0_windows_amd64.zip"
outfile = os.path.join(os.environ["TEMP"], "gh.zip")
print("Downloading...")
urllib.request.urlretrieve(url, outfile)
print(f"Downloaded {os.path.getsize(outfile)} bytes")

extract_dir = os.path.join(os.environ["TEMP"], "gh_cli")
os.makedirs(extract_dir, exist_ok=True)
with zipfile.ZipFile(outfile, 'r') as z:
    z.extractall(extract_dir)

gh_exe = os.path.join(extract_dir, "bin", "gh.exe")
print(f"gh.exe: {gh_exe}, exists: {os.path.exists(gh_exe)}")
