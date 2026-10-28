"""Run the statistics service as a child on Windows and stop it with the terminal.

The Linux launcher replaces its own process with os.execve, which lets Ctrl+C reach the
service directly. On Windows os.execve detaches, so the launcher instead keeps ownership:
it forwards the console's Ctrl+C as Ctrl+Break to the service's own process group and waits
for it to end. Nothing here sees the token; it arrives in the child's environment.
"""
import signal
import subprocess
import sys

CREATE_NEW_PROCESS_GROUP = getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x00000200)
STOP_TIMEOUT = 8


def run_windows(binary, environment, *, popen=subprocess.Popen):
    """Wait for the service, forwarding Ctrl+C. Returns the service exit code."""
    if sys.platform != 'win32':
        raise RuntimeError('The Windows service runner is only used on Windows.')
    child = popen([str(binary)], env=environment, creationflags=CREATE_NEW_PROCESS_GROUP)
    try:
        return child.wait()
    except KeyboardInterrupt:
        print('\nStopping the statistics service…', flush=True)
        break_event = getattr(signal, 'CTRL_BREAK_EVENT', None)
        try:
            if break_event is not None:
                child.send_signal(break_event)
            else:
                child.terminate()
        except (OSError, ValueError):
            pass
        try:
            return child.wait(timeout=STOP_TIMEOUT)
        except subprocess.TimeoutExpired:
            child.terminate()
            try:
                return child.wait(timeout=STOP_TIMEOUT)
            except subprocess.TimeoutExpired:
                child.kill()
                return child.wait()
