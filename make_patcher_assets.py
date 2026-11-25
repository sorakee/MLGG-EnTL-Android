"""Fill android/patcher/app/src/main/assets for the patcher app.

    android/.venv/Scripts/python -I android/make_patcher_assets.py

  libggxen.so            Frida Gadget (android/tools/frida-gadget-*-android-arm64.so, newest)
  agent.js               android/agent/dist/agent.js (run `npm run build` in android/agent first)
  libmain/<sha256>.so    for every android/apk/*/base.apk: its libmain.so with libggxen.so added to DT_NEEDED,
                         named by the SHA-256 of the original (the patcher looks it up that way). libmain.so
                         only changes with the Unity version; a new one needs a new patcher release.
"""
import hashlib, io, shutil, sys, zipfile
from pathlib import Path

import lief

HERE = Path(__file__).resolve().parent
ASSETS = HERE / 'patcher/app/src/main/assets'


def patched_libmain(data: bytes) -> bytes:
    elf = lief.ELF.parse(io.BytesIO(data))
    if 'libggxen.so' not in list(elf.libraries):
        elf.add_library('libggxen.so')
    b = lief.ELF.Builder(elf)
    b.build()
    return bytes(b.get_build())


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    (ASSETS / 'libmain').mkdir(parents=True, exist_ok=True)
    gadget = sorted((HERE / 'tools').glob('frida-gadget-*-android-arm64.so'))[-1]
    shutil.copyfile(gadget, ASSETS / 'libggxen.so')
    agent = HERE / 'agent/dist/agent.js'
    shutil.copyfile(agent, ASSETS / 'agent.js')
    print(f'gadget {gadget.name}, agent {agent.stat().st_size:,} bytes')
    seen = {}
    for apk in sorted((HERE / 'apk').glob('*/base.apk')):
        data = zipfile.ZipFile(apk).read('lib/arm64-v8a/libmain.so')
        sha = hashlib.sha256(data).hexdigest()
        seen.setdefault(sha, []).append(apk.parent.name)
        out = ASSETS / 'libmain' / f'{sha}.so'
        if not out.exists():
            out.write_bytes(patched_libmain(data))
    for sha, apks in seen.items():
        print(f'libmain {sha[:16]}… from {", ".join(apks)}')


if __name__ == '__main__':
    main()
