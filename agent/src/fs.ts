// The few file operations Frida's File class lacks, through bionic's libc (arm64 layouts).

const libc = Process.getModuleByName("libc.so");
const fn = (name: string, ret: NativeFunctionReturnType, args: NativeFunctionArgumentType[]): any =>
    new NativeFunction(libc.getExportByName(name), ret, args);

const opendir = fn("opendir", "pointer", ["pointer"]);
const readdir = fn("readdir", "pointer", ["pointer"]);
const closedir = fn("closedir", "int", ["pointer"]);
const mkdir = fn("mkdir", "int", ["pointer", "int"]);
const rename = fn("rename", "int", ["pointer", "pointer"]);
const unlink = fn("unlink", "int", ["pointer"]);
const stat = fn("stat", "int", ["pointer", "pointer"]);

const DIRENT_TYPE = 18;  // struct dirent: u64 d_ino, s64 d_off, u16 d_reclen, u8 d_type, char d_name[]
const DIRENT_NAME = 19;
const DT_REG = 8;
const STAT_SIZE = 48;  // struct stat (asm-generic): s64 st_size at 48, st_mtim at 88
const STAT_MTIME = 88;

/** Regular files in a folder (names only); empty if the folder doesn't exist. */
export function listFiles(dir: string): string[] {
    const d = opendir(Memory.allocUtf8String(dir)) as NativePointer;
    if (d.isNull()) return [];
    const names: string[] = [];
    try {
        for (; ;) {
            const e = readdir(d) as NativePointer;
            if (e.isNull()) break;
            if (e.add(DIRENT_TYPE).readU8() === DT_REG) names.push(e.add(DIRENT_NAME).readUtf8String()!);
        }
    } finally {
        closedir(d);
    }
    return names;
}

export function mkdirs(dir: string): void {
    let path = "";
    for (const part of dir.split("/")) {
        if (part === "") continue;
        path += "/" + part;
        mkdir(Memory.allocUtf8String(path), 0o770);  // EEXIST is fine
    }
}

export function move(from: string, to: string): void {
    if ((rename(Memory.allocUtf8String(from), Memory.allocUtf8String(to)) as number) !== 0)
        throw new Error(`rename ${from} -> ${to} failed`);
}

export function remove(path: string): void {
    unlink(Memory.allocUtf8String(path));
}

/** Size and modification time (ms), or null if the file doesn't exist. */
export function statFile(path: string): { size: number, mtime: number } | null {
    const buf = Memory.alloc(256);
    if ((stat(Memory.allocUtf8String(path), buf) as number) !== 0) return null;
    return {
        size: buf.add(STAT_SIZE).readS64().toNumber(),
        mtime: buf.add(STAT_MTIME).readS64().toNumber() * 1000 + Math.floor(buf.add(STAT_MTIME + 8).readS64().toNumber() / 1e6),
    };
}

export const exists = (path: string) => statFile(path) !== null;

/** The app's native library folder, where the gadget (libggxen.so) is. While the gadget starts, it isn't in
 *  Frida's module list yet: then from /proc/self/maps. Call it at startup only, not from the game's main thread
 *  (a module lookup there can deadlock with a library load on another thread: see index.ts). */
export function libDir(): string {
    const dirOf = (path: string) => path.substring(0, path.lastIndexOf("/"));
    const gadget = Process.findModuleByName("libggxen.so");
    if (gadget !== null) return dirOf(gadget.path);
    for (const line of File.readAllText("/proc/self/maps").split("\n")) {
        const i = line.indexOf("/");
        if (i >= 0 && line.endsWith("/libggxen.so")) return dirOf(line.substring(i));
    }
    throw new Error("can't find libggxen.so");
}

/** The first bytes of a file as Latin-1 text (pack headers are ASCII). */
export function readHead(path: string, n: number): string {
    const f = new File(path, "rb");
    try {
        const bytes = new Uint8Array(f.readBytes(n));
        let s = "";
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return s;
    } finally {
        f.close();
    }
}
