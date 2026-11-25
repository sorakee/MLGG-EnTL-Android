# Third-party software

The patcher app ships, and the patched game contains, the following software. Each keeps its own licence.

| Component | Where | Licence |
| --- | --- | --- |
| [Frida Gadget](https://frida.re) 17.26.2 (`frida-gadget-17.26.2-android-arm64.so`, unmodified, installed as `libggxen.so`) | patched game | [wxWindows Library Licence 3.1](https://github.com/frida/frida/blob/main/COPYING) |
| [frida-il2cpp-bridge](https://github.com/vfsfitvnm/frida-il2cpp-bridge) 0.14.0 | agent (bundled into `agent.js`) | MIT |
| [fflate](https://github.com/101arrowz/fflate) 0.8.2 | agent (bundled into `agent.js`) | MIT |
| [ARSCLib](https://github.com/REAndroid/ARSCLib) 1.4.0 | patcher app | Apache License 2.0 |
| [apksig](https://android.googlesource.com/platform/tools/apksig/) 9.5.0 | patcher app | Apache License 2.0 |
| [LIEF](https://lief.re) 0.16.6 | build tools only (`make_patcher_assets.py`, `patch_apk.py`) | Apache License 2.0 |

The game itself is not part of this project: the patcher reads the copy installed on the player's phone and
never redistributes it.
