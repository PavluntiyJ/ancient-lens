"""STRATZ credentials in the desktop secret store; never in application files.

Linux uses the Secret Service (`secret-tool`). Windows uses the Credential Manager through
advapi32, so a saved token survives restarts without a new package or a plaintext file. The
same helper also exposes the token to the app's launcher; it never appears in an argument list.
"""
import ctypes
import subprocess
import sys

ATTRIBUTES = ['application', 'org.ancientlens', 'service', 'stratz']
# Both the Python launcher and the Rust app use this exact target name.
WINDOWS_TARGET = 'Ancient Lens/STRATZ'
CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2
ERROR_NOT_FOUND = 1168


def valid_token(token):
    return bool(token) and len(token) <= 4096 and not any(c in token for c in '\r\n\0')


def _windows():
    return sys.platform == 'win32'


def secret_command(args, **kwargs):
    try:
        return subprocess.run(['secret-tool', *args, *ATTRIBUTES],
                              capture_output=True, text=True, timeout=60, **kwargs)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('Could not open the system keyring. Make sure it is unlocked and libsecret is installed.') from None


def _load_linux():
    result = secret_command(['lookup'])
    if result.returncode:
        if result.stderr.strip():
            raise RuntimeError('The system keyring is unavailable or locked.')
        return None
    token = result.stdout.rstrip('\n')
    if not valid_token(token):
        raise RuntimeError('The saved STRATZ token is invalid. Connect STRATZ again.')
    return token


def _save_linux(token):
    result = secret_command(['store', '--label=Ancient Lens — STRATZ'], input=token)
    if result.returncode:
        raise RuntimeError('Could not save the STRATZ token in the system keyring.')


class _FileTime(ctypes.Structure):
    _fields_ = [('dwLowDateTime', ctypes.c_uint32), ('dwHighDateTime', ctypes.c_uint32)]


class _Credential(ctypes.Structure):
    _fields_ = [
        ('Flags', ctypes.c_uint32),
        ('Type', ctypes.c_uint32),
        ('TargetName', ctypes.c_wchar_p),
        ('Comment', ctypes.c_wchar_p),
        ('LastWritten', _FileTime),
        ('CredentialBlobSize', ctypes.c_uint32),
        ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)),
        ('Persist', ctypes.c_uint32),
        ('AttributeCount', ctypes.c_uint32),
        ('Attributes', ctypes.c_void_p),
        ('TargetAlias', ctypes.c_wchar_p),
        ('UserName', ctypes.c_wchar_p),
    ]


def _advapi32():
    if not _windows():
        raise RuntimeError('Windows Credential Manager is unavailable on this system.')
    api = ctypes.WinDLL('advapi32', use_last_error=True)
    api.CredWriteW.argtypes = [ctypes.POINTER(_Credential), ctypes.c_uint32]
    api.CredWriteW.restype = ctypes.c_int
    api.CredReadW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32,
                              ctypes.POINTER(ctypes.POINTER(_Credential))]
    api.CredReadW.restype = ctypes.c_int
    api.CredDeleteW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
    api.CredDeleteW.restype = ctypes.c_int
    api.CredFree.argtypes = [ctypes.c_void_p]
    api.CredFree.restype = None
    return api


def _cred_write(target, token):
    api = _advapi32()
    data = token.encode('utf-16-le')
    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    credential = _Credential(
        Flags=0,
        Type=CRED_TYPE_GENERIC,
        TargetName=target,
        Comment='Ancient Lens statistics service',
        CredentialBlobSize=len(data),
        CredentialBlob=ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)),
        Persist=CRED_PERSIST_LOCAL_MACHINE,
        UserName='Ancient Lens',
    )
    if not api.CredWriteW(ctypes.byref(credential), 0):
        raise RuntimeError('Could not save the STRATZ token in Windows Credential Manager.')


def _cred_read(target):
    api = _advapi32()
    pointer = ctypes.POINTER(_Credential)()
    if not api.CredReadW(target, CRED_TYPE_GENERIC, 0, ctypes.byref(pointer)):
        if ctypes.get_last_error() == ERROR_NOT_FOUND:
            return None
        raise RuntimeError('Windows Credential Manager is unavailable or locked.')
    try:
        credential = pointer.contents
        raw = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
        return raw.decode('utf-16-le')
    finally:
        api.CredFree(ctypes.cast(pointer, ctypes.c_void_p))


def _cred_delete(target):
    api = _advapi32()
    if not api.CredDeleteW(target, CRED_TYPE_GENERIC, 0) and ctypes.get_last_error() != ERROR_NOT_FOUND:
        raise RuntimeError('Could not remove the STRATZ token from Windows Credential Manager.')


def _load_windows():
    token = _cred_read(WINDOWS_TARGET)
    if token is None:
        return None
    if not valid_token(token):
        raise RuntimeError('The saved STRATZ token is invalid. Connect STRATZ again.')
    return token


def _save_windows(token):
    _cred_write(WINDOWS_TARGET, token)


def load_token():
    return _load_windows() if _windows() else _load_linux()


def save_token(token):
    if not valid_token(token):
        raise RuntimeError('Invalid STRATZ token format.')
    if _windows():
        _save_windows(token)
    else:
        _save_linux(token)
    if load_token() != token:
        raise RuntimeError('Could not verify that the STRATZ token was saved.')


def delete_token():
    """Remove the saved token; absent entries are not an error."""
    if _windows():
        _cred_delete(WINDOWS_TARGET)
    else:
        secret_command(['clear'])
