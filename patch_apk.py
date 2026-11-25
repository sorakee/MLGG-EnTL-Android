"""Patch a Muv-Luv Girls Garden(X) APK with the GGX EN Patch agent (Frida Gadget).

    python -I android/patch_apk.py <in.apk> <out-unsigned.apk> [--agent android/agent/dist/agent.js]

Adds to lib/arm64-v8a/:
  libggxen.so          Frida Gadget (android/tools/frida-gadget-*-android-arm64.so)
  libggxen.config.so   Gadget config: run the script next to it, no listening port
  libggxen-agent.so    the agent script (named .so so the installer extracts it beside the gadget)
and adds libggxen.so to libmain.so's DT_NEEDED, so it loads before Unity starts.
Sign the output afterwards with the project key (android/keys).
"""
import argparse, io, json, sys, zipfile
from pathlib import Path

import lief

HERE = Path(__file__).resolve().parent
LIB = 'lib/arm64-v8a/'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--agent', default=str(HERE / 'agent/dist/agent.js'))
    ap.add_argument('--gadget', default=None)
    ap.add_argument('--dev', action='store_true', help='gadget listens for the PC instead of running the script')
    ap.add_argument('--runtime', default='v8', choices=['qjs', 'v8'])
    a = ap.parse_args()
    gadget = Path(a.gadget) if a.gadget else sorted((HERE / 'tools').glob('frida-gadget-*-android-arm64.so'))[-1]

    zin = zipfile.ZipFile(a.src)
    names = zin.namelist()
    if LIB + 'libggxen.so' in names:
        sys.exit('already patched')

    libmain = lief.ELF.parse(io.BytesIO(zin.read(LIB + "libmain.so")))
    if 'libggxen.so' not in [lib for lib in libmain.libraries]:
        libmain.add_library('libggxen.so')
    builder = lief.ELF.Builder(libmain)
    builder.build()
    new_libmain = bytes(builder.get_build())

    if a.dev:
        # Development: the gadget listens on the phone's loopback; reach it with
        # `adb forward tcp:27042 tcp:27042` and android/dev_attach.py.
        interaction = {'type': 'listen', 'address': '127.0.0.1', 'port': 27042,
                       'on_port_conflict': 'pick-next', 'on_load': 'resume'}
    else:
        interaction = {'type': 'script', 'path': './libggxen-agent.so', 'on_change': 'ignore'}
    config = json.dumps({'interaction': interaction, 'runtime': a.runtime, 'teardown': 'minimal'}).encode()
    extra = {
        LIB + 'libggxen.so': gadget.read_bytes(),
        LIB + 'libggxen.config.so': config,
        LIB + 'libggxen-agent.so': Path(a.agent).read_bytes(),
    }

    with zipfile.ZipFile(a.dst, 'w') as zout:
        for info in zin.infolist():
            if info.filename.startswith('META-INF/') and info.filename.split('/')[-1].upper().endswith(('.SF', '.RSA', '.EC', '.DSA', 'MANIFEST.MF')):
                continue  # old v1 signature files; the re-sign writes new ones
            data = new_libmain if info.filename == LIB + 'libmain.so' else zin.read(info.filename)
            zi = zipfile.ZipInfo(info.filename, info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zout.writestr(zi, data)
        ref = zin.getinfo(LIB + 'libmain.so')
        for name, data in extra.items():
            zi = zipfile.ZipInfo(name, ref.date_time)
            zi.compress_type = ref.compress_type
            zout.writestr(zi, data)
    print(f'gadget {gadget.name}, agent {len(extra[LIB + "libggxen-agent.so"]):,} bytes, '
          f'libmain NEEDED: {list(lief.ELF.parse(io.BytesIO(new_libmain)).libraries)}')
    print(f'wrote {a.dst}')


if __name__ == '__main__':
    main()
