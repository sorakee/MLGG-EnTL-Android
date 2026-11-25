// Frida provides console; the DOM lib would clash with Frida's File class.
declare const console: { log(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void };
