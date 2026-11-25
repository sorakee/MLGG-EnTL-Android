// Logging: logcat (tag GGXEN; `adb logcat -s GGXEN`) and <base>/log.txt, rewritten each launch.
// In script mode the gadget sends console output to stdout, which Android discards.

const write = new NativeFunction(
    Process.getModuleByName("liblog.so").getExportByName("__android_log_write"), "int", ["int", "pointer", "pointer"]);
const tag = Memory.allocUtf8String("GGXEN");
let file: File | null = null;

export function openLogFile(path: string): void {
    try {
        file = new File(path, "w");
    } catch (e) {
        file = null;
        warn(`can't write ${path}: ${e}`);
    }
}

function out(priority: number, level: string, message: string): void {
    write(priority, tag, Memory.allocUtf8String(message));
    if (file !== null) {
        try {
            file.write(`${new Date().toISOString()} [${level}] ${message}\n`);
            file.flush();
        } catch {
            file = null;
        }
    }
}

export const info = (m: string) => out(4, "Info", m);
export const warn = (m: string) => out(5, "Warning", m);
export const error = (m: string) => out(6, "Error", m);
export const errorOf = (where: string, e: any) => error(`${where}: ${e?.stack ?? e}`);
