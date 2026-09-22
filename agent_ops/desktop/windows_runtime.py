"""Small Win32 primitives for one owned background process tree."""

import ctypes
from ctypes import wintypes as w


def kernel():
    dll = ctypes.WinDLL("kernel32", use_last_error=True)
    definitions = {
        "CreateMutexW": ([w.LPVOID, w.BOOL, w.LPCWSTR], w.HANDLE),
        "OpenMutexW": ([w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE),
        "CreateEventW": ([w.LPVOID, w.BOOL, w.BOOL, w.LPCWSTR], w.HANDLE),
        "WaitForSingleObject": ([w.HANDLE, w.DWORD], w.DWORD),
        "CloseHandle": ([w.HANDLE], w.BOOL),
        "CreateJobObjectW": ([w.LPVOID, w.LPCWSTR], w.HANDLE),
        "OpenJobObjectW": ([w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE),
        "QueryInformationJobObject": ([w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD, ctypes.POINTER(w.DWORD)], w.BOOL),
        "SetInformationJobObject": ([w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD], w.BOOL),
        "AssignProcessToJobObject": ([w.HANDLE, w.HANDLE], w.BOOL),
        "GetCurrentProcess": ([], w.HANDLE),
        "OpenProcess": ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
        "GetProcessTimes": ([w.HANDLE, ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME)], w.BOOL),
        "QueryFullProcessImageNameW": ([w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)], w.BOOL),
    }
    for name, (args, result) in definitions.items():
        function = getattr(dll, name)
        function.argtypes, function.restype = args, result
    return dll


class Mutex:
    def __init__(self, name):
        self.api = kernel()
        ctypes.set_last_error(0)
        self.handle = self.api.CreateMutexW(None, False, name)
        error = ctypes.get_last_error()
        if not self.handle:
            raise ctypes.WinError(error)
        self.created = error != 183

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


def mutex_exists(name):
    api = kernel()
    handle = api.OpenMutexW(0x00100000, False, name)
    if handle:
        api.CloseHandle(handle)
        return True
    if ctypes.get_last_error() == 2:
        return False
    raise ctypes.WinError(ctypes.get_last_error())


class BasicLimit(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", w.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", w.DWORD), ("Affinity", ctypes.c_size_t), ("PriorityClass", w.DWORD), ("SchedulingClass", w.DWORD)]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class ExtendedLimit(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", BasicLimit), ("IoInfo", IoCounters), ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]


class OwnedJob:
    """Assign the dedicated host before spawning, so descendants cannot escape a launch race.

    Closing the handle terminates this host AND its descendants. Only use in the
    dedicated background executable, never in the UI bridge or an operational PC daemon.
    """
    def __init__(self, name=None):
        self.api = kernel()
        ctypes.set_last_error(0)
        self.handle = self.api.CreateJobObjectW(None, name)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == 183:
            self.api.CloseHandle(self.handle)
            raise RuntimeError("The runtime job name is already owned.")
        limits = ExtendedLimit()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE, no breakaway.
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.api.CloseHandle(self.handle)
            raise ctypes.WinError(ctypes.get_last_error())
        if not self.api.AssignProcessToJobObject(self.handle, self.api.GetCurrentProcess()):
            self.api.CloseHandle(self.handle)
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        self.api.CloseHandle(self.handle)


def job_process_ids(name):
    """Read OS job membership even after an intermediate launcher has exited."""
    api = kernel()
    handle = api.OpenJobObjectW(0x0004, False, name)  # JOB_OBJECT_QUERY only.
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        capacity = 64
        while capacity <= 32768:
            class ProcessList(ctypes.Structure):
                _fields_ = [("assigned", w.DWORD), ("count", w.DWORD), ("pids", ctypes.c_size_t * capacity)]
            record = ProcessList()
            if api.QueryInformationJobObject(handle, 3, ctypes.byref(record), ctypes.sizeof(record), None):
                if record.count <= capacity and record.count >= record.assigned:
                    return list(record.pids[:record.count])
            elif ctypes.get_last_error() != 234:  # ERROR_MORE_DATA
                raise ctypes.WinError(ctypes.get_last_error())
            capacity = max(capacity * 2, record.assigned)
        raise RuntimeError("Runtime job process list exceeds the observation limit.")
    finally:
        api.CloseHandle(handle)


def process_identity(pid):
    api = kernel()
    handle = api.OpenProcess(0x1000 | 0x00100000, False, int(pid))
    if not handle:
        return None
    try:
        if api.WaitForSingleObject(handle, 0) != 258:
            return None
        created, exited, kernel_time, user = (w.FILETIME() for _ in range(4))
        if not api.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel_time), ctypes.byref(user)):
            return None
        name = ctypes.create_unicode_buffer(32768)
        size = w.DWORD(len(name))
        if not api.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)):
            return None
        return {"pid": int(pid), "created": (created.dwHighDateTime << 32) | created.dwLowDateTime, "image": name.value}
    finally:
        api.CloseHandle(handle)
