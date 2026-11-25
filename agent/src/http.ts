// HTTP through the game's UnityWebRequest. Requests are queued from anywhere and started and finished from
// the main-thread tick (UnityWebRequest aborts off the main thread and before the first frame).
import { cls, str } from "./game.js";
import { VERSION } from "./ctx.js";
import * as log from "./log.js";

export interface Request { url: string, binary?: boolean, post?: string, timeout?: number }
export interface Response { ok: boolean, code: number, error: string | null, bytes: ArrayBuffer | null, text: string | null }

const queue: { req: Request, done: (r: Response) => void }[] = [];
const running: { uwr: Il2Cpp.Object, req: Request, done: (r: Response) => void }[] = [];

export function request(req: Request, done: (r: Response) => void): void {
    queue.push({ req, done });
}

function begin(req: Request): Il2Cpp.Object {
    const UWR = cls("UnityEngine.UnityWebRequestModule", "UnityEngine.Networking.UnityWebRequest");
    const uwr = req.post === undefined
        ? UWR.method<Il2Cpp.Object>("Get", 1).overload("System.String").invoke(Il2Cpp.string(req.url))
        : UWR.method<Il2Cpp.Object>("Post", 3).overload("System.String", "System.String", "System.String")
            .invoke(Il2Cpp.string(req.url), Il2Cpp.string(req.post), Il2Cpp.string("application/json"));
    uwr.method("set_timeout").invoke(req.timeout ?? 120);
    uwr.method("SetRequestHeader").invoke(Il2Cpp.string("User-Agent"), Il2Cpp.string(`GGXEnPatch-Android/${VERSION}`));
    uwr.method("SendWebRequest").invoke();
    return uwr;
}

function finish(uwr: Il2Cpp.Object, req: Request): Response {
    const code = Number(uwr.method<any>("get_responseCode").invoke());
    const error = str(uwr.method("get_error").invoke());
    const handler = uwr.method<Il2Cpp.Object>("get_downloadHandler").invoke();
    let bytes: ArrayBuffer | null = null, text: string | null = null;
    if (!handler.isNull()) {
        if (req.binary) {
            const data = handler.method<Il2Cpp.Array<number>>("get_data").invoke();
            if (!data.isNull()) bytes = data.handle.add(0x20).readByteArray(data.length);  // past the il2cpp array header
        } else {
            text = str(handler.method("get_text").invoke());
        }
    }
    uwr.method("Dispose").invoke();
    return { ok: error === null && code >= 200 && code < 300, code, error, bytes, text };
}

/** Main thread, every frame. */
export function tick(): void {
    for (let i = running.length - 1; i >= 0; i--) {
        const r = running[i];
        if (!r.uwr.method<boolean>("get_isDone").invoke()) continue;
        running.splice(i, 1);
        let res: Response;
        try {
            res = finish(r.uwr, r.req);
        } catch (e) {
            res = { ok: false, code: 0, error: String(e), bytes: null, text: null };
        }
        try {
            r.done(res);
        } catch (e) {
            log.errorOf("http callback", e);
        }
    }
    while (queue.length > 0 && running.length < 3) {
        const q = queue.shift()!;
        try {
            running.push({ uwr: begin(q.req), req: q.req, done: q.done });
        } catch (e) {
            q.done({ ok: false, code: 0, error: String(e), bytes: null, text: null });
        }
    }
}
