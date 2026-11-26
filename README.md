# GGX EN Patch for Android

A fan English patch for **マブラヴ ガールズガーデンX** (Muv-Luv Girls Garden X) and its all-ages version
**マブラヴ ガールズガーデン**, the Japanese DMM GAMES / FANZA GAMES Android apps. It's the Android edition of the
[PC patch](https://github.com/sorakee/MLGG-EnTL) and uses the same translations.

**GGX EN Patcher** builds an English copy of the game from the official app on your phone. You play the copy,
"Muv-Luv Girls Garden X (EN)". It's installed next to the official app, which stays installed so the DMM GAMES STORE
can keep updating it.

Unofficial and not affiliated with the publishers. No game files are distributed here since the patcher uses the copy
already on your phone.

> [!WARNING]
> **Use at your own risk.** Modding the client may break the game's terms of service. We are not responsible for
> bans or any other consequences.

The patch only changes what your phone displays and never alters what the game sends. Its own network use
(translations, patch updates, [reports](#reports)) goes only to the patch's hosts. Note that the (EN) copy is still
the full game, so the game's analytics may report its different package name (`….en`) and signature.

## Requirements

- An arm64 Android phone, Android 8 or newer.
- The official game from the DMM GAMES STORE.
- About 4 GB free, since the English copy downloads its own game data.

## Install

1. Install the game from the DMM GAMES STORE. You don't need to open it.
2. Install `GGXEnPatcher-<version>.apk` from [Releases](../../releases).
3. Open the patcher, set your [options](#options), and tap **Install the English version**. Allow it to install
   apps. Building takes a minute or two.
4. Tap **Install** when Android asks.
5. Open the (EN) app, log in with your DMM account, and let it download its data.

From now on, play the (EN) app. Keep the official app installed, but you don't need to open it.

## Updates

- **Game updates:** after the store updates the official app, open the patcher and tap **Update the English
  version**, then **Install**. Your data and login are kept.
- **Translations** download automatically on every launch.
- **Patch fixes** (patcher 0.2.0+) also download automatically. They only run if signed by the translators,
  which is checked on every start. Otherwise, or after three failed starts in a row, the built-in version is used.
  If a fix needs a new patcher, the log says so: install it and tap **Rebuild**.

## Options

Set in the patcher. Tap **Rebuild** after changing any.

| Option | Default | Notes |
| --- | --- | --- |
| Adult scene text (X only) | on | |
| Turn off the mosaic (X only) | off | Only changes what your phone draws. |
| Let voice lines finish when you advance | off | |
| Shrink long English labels to fit | on | |
| Download fixes to the patch itself | on | If off, only a new patcher + **Rebuild** updates it. |
| Share links to story scenes the translators lack | on | See [Reports](#reports). |
| Send untranslated menu text to the translators | on | See [Reports](#reports). |

## Your signing key

Each English copy is signed with a key made on your phone, and Android only accepts updates signed with the same
key. **Tap Export key and keep the file somewhere safe.** If you reinstall the patcher or switch phones, use
**Import key** first. Without it, you'll have to uninstall the English copy, along with its data, before installing
a new one.

## Reports

Unless you turn them off, the English copy sends two kinds of report to the patch's report service:

- the id and the game's own download link for any story scene the translators don't have yet;
- Japanese menu text with no English yet (player names, chat and news are left out).

Nothing about you or your account is sent.

## Troubleshooting

- **"Install failed … signatures"**: the copy on your phone uses a different key. Import that key, or uninstall
  the copy and reinstall.
- **"…engine build the patcher doesn't know yet"**: the game changed its Unity version. Wait for a patcher update.
- **"already a patched copy"**: an early test build is installed under the official name. Uninstall it and
  reinstall the official app.
- Log: `Android/data/<package>/files/ggxen/log.txt` (readable from a PC over USB).

To uninstall, remove the (EN) app like any other. The official app and the patcher are separate.

## How it works

The patcher reads the official APK, renames the package to `<official package>.en`, and adds:

- `libggxen.so`: [Frida Gadget](https://frida.re), added to `libmain.so`'s dependencies;
- `libggxen-loader.so` ([`agent/loader`](agent/loader)): starts the built-in agent, or a downloaded one whose
  Ed25519 signature and SHA-256 match (kept in `files/ggxen-agent/`);
- `libggxen-agent.so` ([`agent/src`](agent/src)): a TypeScript port of the PC plugin on
  [frida-il2cpp-bridge](https://github.com/vfsfitvnm/frida-il2cpp-bridge);
- `libggxen.config.so` and `libggxen-settings.so`: gadget config (no network port) and your options.

It then signs the result with your key and installs it. Like the PC plugin, the agent matches exact Japanese text:
story lines as they play, data tables after they load, and menu labels as they're drawn. Translations are stored in
`Android/data/<package>/files/ggxen/translations/`. Agent updates are listed in `android/manifest-android.json` on
the pack host and signed with `agent/publish.mjs`.

## Building from source

- **Agent and loader:** `cd agent && npm ci && npm run build`. For your own builds, run `node publish.mjs keygen`
  to replace the trusted key in `agent/loader/key.ts`.
- **Patcher assets:** add a decompressed `frida-gadget-17.26.2-android-arm64.so`
  ([release](https://github.com/frida/frida/releases/tag/17.26.2)) and at least one official `apk/<name>/base.apk`,
  then:
  `python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -I make_patcher_assets.py`
- **Patcher app:** JDK 17, Android SDK 36, Gradle 9.9: `cd patcher && gradle assembleRelease`, with `GGXEN_SIGNING`
  pointing to a properties file (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). On Windows, the
  project path must be ASCII-only.
- **Development:** `build.sh --dev` builds a copy whose gadget listens on loopback, and `dev_attach.py` attaches over
  `adb forward`. **Never share a dev build:** any app on the phone can connect to it.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## License

MIT ([LICENSE](LICENSE)). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
