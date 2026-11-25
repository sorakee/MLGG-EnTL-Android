# GGX EN Patch for Android

A fan English patch for **マブラヴ ガールズガーデンX** (Muv-Luv Girls Garden X) and **マブラヴ ガールズガーデン**
(the all-ages version), the Japanese DMM GAMES / FANZA GAMES Android apps. It is the Android edition of the
[GGX EN Patch](https://github.com/sorakee/MLGG-EnTL) for PC and uses the same translations: story, speaker names,
choices, titles, the game's data text (items, skills, missions…) and the menus.

You install **GGX EN Patcher**, an app that builds an English copy of the game from the official app on your
phone. The English copy, "Muv-Luv Girls Garden X (EN)", is installed **next to** the official app and is the one
you play. The official app stays installed so the DMM GAMES STORE can keep updating it.

This is an unofficial fan project, not affiliated with or endorsed by the game's publishers. Nothing of the game
is distributed here: the patcher works with the copy already on your phone.

> [!WARNING]
> **Use this patch at your own risk.** Modifying the game client may be against the game's terms of service.
> The developers of this patch are not responsible for any action taken against your account, including
> suspension or a ban, or for any other consequence of using it.

The patch only changes what your phone shows: it sends nothing to the game's servers and never changes what the
game sends. Its own network use is the translation download and the [reports](#reports), both to the patch's own
hosts. The (EN) copy is still the full game, though, and the game's own analytics may report its package name
(`….en`) and signature, which differ from the official app's.

## Requirements

- An Android phone with a 64-bit (arm64) processor, Android 8 or newer.
- The official game installed from the DMM GAMES STORE (X from FANZA GAMES, or the all-ages app).
- Room for a second copy of the game's data (about 4 GB): the English copy downloads its own.

## Install

1. Install the game from the DMM GAMES STORE as usual. You don't need to open it.
2. Download `GGXEnPatcher-<version>.apk` from [Releases](../../releases) and install it (allow your browser or file
   manager to install apps when Android asks).
3. Open **GGX EN Patcher**, pick your options (below), and tap **Install the English version** under your game.
   The first time, allow the patcher to install apps. Building takes a minute or two.
4. Tap **Install** when Android asks.
5. Open **Muv-Luv Girls Garden X (EN)** (or **Muv-Luv Girls Garden (EN)**), log in with your DMM account as usual and
   let it download its data.

Play the (EN) app from now on. Keep the official app installed, but you don't need to open it.

## Game updates

When the DMM GAMES STORE updates the official app, open the patcher and tap **Update the English version**, then
**Install**. Your English copy keeps its data and login; nothing is downloaded again except what the game update
itself brings.

Translation updates need nothing from you: the English copy downloads new translations on every launch, the same
weekly updates the PC patch gets.

## Options

Set in the patcher and built into the English copy; after changing one, tap **Rebuild**.

| Option | Default | What it does |
| --- | --- | --- |
| Adult scene text (X only) | on | Also downloads the adult scenes' text. |
| Turn off the mosaic (X only) | off | Changes only what your phone draws. |
| Let voice lines finish when you advance | off | In story scenes, a voice line isn't cut off when you tap on. |
| Shrink long English labels to fit | on | English runs longer than Japanese. |
| Share links to story scenes the translators lack | on | See [Reports](#reports). |
| Send untranslated menu text to the translators | on | See [Reports](#reports). |

## Your signing key

The patcher signs every English copy it builds with a key made on your phone. Android only installs an update
over the English copy if it is signed with the **same** key. Tap **Export key** in the patcher and keep the file
somewhere safe (cloud storage, your PC). If you reinstall the patcher or move to a new phone, **Import key** first.
Without the old key, you have to uninstall the English copy (its downloaded data goes with it) before installing
a new one.

## Reports

Like the PC patch, the English copy helps the translators unless you turn it off:

- When you open a story scene the translators have no copy of, it sends that scene's id and the download link the
  game itself used. Nothing about you or your account is sent.
- Japanese menu text that has no English yet goes to the translators (player names, chat and news are left out).

Both go to the patch's own report service. Turn them off in the patcher's options and tap **Rebuild**.

## Troubleshooting

- **"Install failed … signatures"**: the English copy on the phone was signed with another key. Import that key,
  or uninstall the English copy and install again.
- **"This game version uses an engine build the patcher doesn't know yet"**: the game changed its Unity version;
  wait for a patcher update.
- **"already a patched copy"**: the app installed under the official name is a patched build from an early test.
  Uninstall it and install the official app from the DMM GAMES STORE.
- The English copy writes a log to `Android/data/<package>/files/ggxen/log.txt` (readable with a PC over USB).

## Uninstall

Uninstall the (EN) app like any other app. The official app and the patcher are separate; remove them too if you
like.

## How it works

The patcher reads the official app's APK (any app can read an installed app's APK), renames its package to
`<official package>.en` (manifest and resource table) and its label, and adds:

- `libggxen.so`: [Frida Gadget](https://frida.re), loaded at startup (it is added to `libmain.so`'s dependencies);
- `libggxen-agent.so`: the agent, a TypeScript port of the PC plugin
  (see [`agent/src`](agent/src)) built on [frida-il2cpp-bridge](https://github.com/vfsfitvnm/frida-il2cpp-bridge);
- `libggxen.config.so` and `libggxen-settings.so`: the gadget's config (run the agent, no network port) and your
  options.

It then signs the result with your key and hands it to Android's installer. In the game, the agent matches text by
its exact Japanese, as the PC plugin does: story lines as the scenario plays, the game's data tables a few seconds
after they load, and menu labels as they are drawn. Translation packs come from the same host as the PC patch and
are kept in `Android/data/<package>/files/ggxen/translations/`.

## Building from source

- **Agent:** `cd agent && npm ci && npm run build` (→ `agent/dist/agent.js`).
- **Patcher assets:** put `frida-gadget-17.26.2-android-arm64.so` (from the
  [Frida release](https://github.com/frida/frida/releases/tag/17.26.2), decompressed) and at least one official
  `apk/<name>/base.apk` (for `libmain.so`) in place, then
  `python -m venv .venv && .venv/Scripts/pip install -r requirements.txt` and
  `.venv/Scripts/python -I make_patcher_assets.py`.
- **Patcher app:** JDK 17, Android SDK platform 36, Gradle 9.9: `cd patcher && gradle assembleRelease`, with
  `GGXEN_SIGNING` naming a properties file (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) to sign it.
  On Windows the Android Gradle Plugin refuses project paths with non-ASCII characters.
- **Development:** `build.sh --dev` builds a test copy whose gadget listens on the phone's loopback (never share
  one: any app on the phone could connect); `dev_attach.py` loads the agent through `adb forward`.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## License

MIT (see [LICENSE](LICENSE)); third-party components in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
