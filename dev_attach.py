"""Development: load the agent into a --dev patched game through adb and print its output.

    adb forward tcp:27042 tcp:27042
    android/.venv/Scripts/python -I android/dev_attach.py [--seconds 60] [--agent android/agent/dist/agent.js]
"""
import argparse, sys, time
from pathlib import Path

import frida

HERE = Path(__file__).resolve().parent


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--agent', default=str(HERE / 'agent/dist/agent.js'))
    ap.add_argument('--seconds', type=float, default=60)
    ap.add_argument('--host', default='127.0.0.1:27042')
    a = ap.parse_args()

    device = frida.get_device_manager().add_remote_device(a.host)
    procs = device.enumerate_processes()
    print('processes:', [(p.pid, p.name) for p in procs])
    session = device.attach(procs[0].pid)
    session.on('detached', lambda reason, crash: print(f'detached: {reason} {crash or ""}'))
    script = session.create_script(Path(a.agent).read_text(encoding='utf-8'), runtime='v8')

    def on_message(msg, data):
        if msg['type'] == 'send':
            print('send:', msg['payload'])
        else:
            print('error:', msg.get('stack') or msg)
    script.on('message', on_message)
    script.set_log_handler(lambda level, text: print(f'[{level}] {text}'))
    script.load()
    end = time.time() + a.seconds
    while time.time() < end:
        time.sleep(0.5)
    script.unload()
    session.detach()


if __name__ == '__main__':
    main()
