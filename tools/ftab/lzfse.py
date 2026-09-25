"""LZFSE / LZVN decoder.

Uses Apple's libcompression through ctypes when it is available (macOS) and
falls back to a pure-Python implementation of the published format
(https://github.com/lzfse/lzfse, BSD-3-Clause) everywhere else.

    from lzfse import decompress
    raw = decompress(stream)            # stream starts with 'bvx2'/'bvx1'/'bvxn'/'bvx-'
    raw = decompress(stream, size_hint)  # optional exact output size (faster on macOS)
"""
import ctypes
import ctypes.util
import struct

__all__ = ["decompress", "decompress_py"]

# ---------------------------------------------------------------------------
# libcompression fast path (macOS)
# ---------------------------------------------------------------------------
_COMPRESSION_LZFSE = 0x801
_libc = None
try:
    _p = ctypes.util.find_library("compression")
    if _p:
        _libc = ctypes.CDLL(_p)
        _libc.compression_decode_buffer.restype = ctypes.c_size_t
        _libc.compression_decode_buffer.argtypes = [
            ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t,
            ctypes.c_void_p, ctypes.c_int]
except OSError:  # pragma: no cover
    _libc = None


def _raw_size(src):
    """Sum of n_raw_bytes over all blocks (walks block headers only)."""
    p, total = 0, 0
    while p + 4 <= len(src):
        m = src[p:p + 4]
        if m == b"bvx$":
            return total
        if m == b"bvx-":
            n = struct.unpack_from("<I", src, p + 4)[0]
            total += n; p += 8 + n
        elif m == b"bvxn":
            n, pl = struct.unpack_from("<II", src, p + 4)
            total += n; p += 12 + pl
        elif m == b"bvx1":
            n, npay = struct.unpack_from("<II", src, p + 4)
            total += n; p += 772 + npay
        elif m == b"bvx2":
            n, = struct.unpack_from("<I", src, p + 4)
            v0, v1, v2 = struct.unpack_from("<QQQ", src, p + 8)
            hs = v2 & 0xffffffff
            total += n; p += hs + ((v0 >> 20) & 0xfffff) + ((v1 >> 40) & 0xfffff)
        else:
            raise ValueError("bad LZFSE block magic %r at %d" % (m, p))
    raise ValueError("LZFSE stream has no end-of-stream block")


def decompress(src, size_hint=None):
    src = bytes(src)
    if _libc is not None:
        n = size_hint or _raw_size(src)
        dst = ctypes.create_string_buffer(n + 1)
        got = _libc.compression_decode_buffer(dst, n + 1, src, len(src), None, _COMPRESSION_LZFSE)
        if got == n:
            return dst.raw[:n]
    return decompress_py(src)


# ---------------------------------------------------------------------------
# pure-Python decoder
# ---------------------------------------------------------------------------
L_SYMS, M_SYMS, D_SYMS, LIT_SYMS = 20, 20, 64, 256
L_STATES, M_STATES, D_STATES, LIT_STATES = 64, 64, 256, 1024
L_XBITS = [0] * 16 + [2, 3, 5, 8]
L_BASE = list(range(16)) + [16, 20, 28, 60]
M_XBITS = [0] * 16 + [3, 5, 8, 11]
M_BASE = list(range(16)) + [16, 24, 56, 312]
D_XBITS = [0, 0, 0, 0] + [b for b in range(1, 16) for _ in range(4)]
D_BASE = [0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 36, 44, 52, 60, 76, 92, 108, 124,
          156, 188, 220, 252, 316, 380, 444, 508, 636, 764, 892, 1020, 1276, 1532, 1788,
          2044, 2556, 3068, 3580, 4092, 5116, 6140, 7164, 8188, 10236, 12284, 14332,
          16380, 20476, 24572, 28668, 32764, 40956, 49148, 57340, 65532, 81916, 98300,
          114684, 131068, 163836, 196604, 229372]
_FREQ_NBITS = [2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14] * 2
_FREQ_VAL = [0, 2, 1, 4, 0, 3, 1, -1, 0, 2, 1, 5, 0, 3, 1, -1,
             0, 2, 1, 6, 0, 3, 1, -1, 0, 2, 1, 7, 0, 3, 1, -1]


def _clz32(x):
    return 32 - x.bit_length()


def _lit_table(nstates, freq):
    t = []
    nclz = _clz32(nstates)
    for sym, f in enumerate(freq):
        if not f:
            continue
        k = _clz32(f) - nclz
        j0 = ((2 * nstates) >> k) - f
        for j in range(f):
            if j < j0:
                t.append((k, ((f + j) << k) - nstates, sym))
            else:
                t.append((k - 1, (j - j0) << (k - 1), sym))
    if len(t) != nstates:
        t += [(0, 0, 0)] * (nstates - len(t))
    return t


def _val_table(nstates, freq, xbits, base):
    t = []
    nclz = _clz32(nstates)
    for sym, f in enumerate(freq):
        if not f:
            continue
        k = _clz32(f) - nclz
        j0 = ((2 * nstates) >> k) - f
        vb, vbase = xbits[sym], base[sym]
        for j in range(f):
            if j < j0:
                t.append((k + vb, vb, ((f + j) << k) - nstates, vbase))
            else:
                t.append((k - 1 + vb, vb, (j - j0) << (k - 1), vbase))
    if len(t) != nstates:
        t += [(0, 0, 0, 0)] * (nstates - len(t))
    return t


class _BackBits:
    """Backward bit reader (fse_in_stream64)."""
    __slots__ = ("buf", "pos", "start", "accum", "nbits")

    def __init__(self, buf, end, start, n):
        self.buf, self.start = buf, start
        if n:
            self.pos = end - 8
            self.accum = int.from_bytes(buf[self.pos:end], "little")
            self.nbits = n + 64
        else:
            self.pos = end - 7
            self.accum = int.from_bytes(buf[self.pos:end], "little")
            self.nbits = n + 56
        if not (56 <= self.nbits < 64) or (self.accum >> self.nbits):
            raise ValueError("corrupt FSE stream init")

    def flush(self):
        nb = (63 - self.nbits) & ~7
        if not nb:
            return
        nbytes = nb >> 3
        self.pos -= nbytes
        if self.pos < self.start:
            # The reference decoder bounds reads by the start of the whole source
            # buffer, so the final refill may reach into header bytes whose bits
            # are never consumed.  Zero-pad before offset 0.
            if self.pos + nbytes <= self.start and self.start == 0:
                raise ValueError("FSE stream underflow")
            if self.pos < 0:
                inc = int.from_bytes(bytes(-self.pos) + self.buf[0:self.pos + nbytes], "little")
                self.accum = (self.accum << nb) | inc
                self.nbits += nb
                return
        inc = int.from_bytes(self.buf[self.pos:self.pos + nbytes], "little")
        self.accum = (self.accum << nb) | inc
        self.nbits += nb

    def pull(self, n):
        self.nbits -= n
        r = self.accum >> self.nbits
        self.accum &= (1 << self.nbits) - 1
        return r


def _v2_header(src, p):
    n_raw, = struct.unpack_from("<I", src, p + 4)
    v0, v1, v2 = struct.unpack_from("<QQQ", src, p + 8)
    g = lambda v, o, n: (v >> o) & ((1 << n) - 1)
    h = dict(
        n_raw=n_raw,
        n_literals=g(v0, 0, 20), n_lit_payload=g(v0, 20, 20), n_matches=g(v0, 40, 20),
        literal_bits=g(v0, 60, 3) - 7,
        literal_state=[g(v1, 0, 10), g(v1, 10, 10), g(v1, 20, 10), g(v1, 30, 10)],
        n_lmd_payload=g(v1, 40, 20), lmd_bits=g(v1, 60, 3) - 7,
        header_size=g(v2, 0, 32), l_state=g(v2, 32, 10), m_state=g(v2, 42, 10),
        d_state=g(v2, 52, 10))
    freqs = []
    q, end = p + 32, p + h["header_size"]
    accum = nb = 0
    if q != end:
        for _ in range(L_SYMS + M_SYMS + D_SYMS + LIT_SYMS):
            while q < end and nb + 8 <= 32:
                accum |= src[q] << nb; nb += 8; q += 1
            b = accum & 31
            n = _FREQ_NBITS[b]
            if n == 8:
                v = 8 + ((accum >> 4) & 0xf)
            elif n == 14:
                v = 24 + ((accum >> 4) & 0x3ff)
            else:
                v = _FREQ_VAL[b]
            if n > nb:
                raise ValueError("corrupt LZFSE v2 header")
            freqs.append(v); accum >>= n; nb -= n
    else:
        freqs = [0] * (L_SYMS + M_SYMS + D_SYMS + LIT_SYMS)
    h["l_freq"] = freqs[:20]; h["m_freq"] = freqs[20:40]
    h["d_freq"] = freqs[40:104]; h["lit_freq"] = freqs[104:360]
    return h



def _decode_fse_block(src, p, h, out, prev_d):
    lit_t = _lit_table(LIT_STATES, h["lit_freq"])
    l_t = _val_table(L_STATES, h["l_freq"], L_XBITS, L_BASE)
    m_t = _val_table(M_STATES, h["m_freq"], M_XBITS, M_BASE)
    d_t = _val_table(D_STATES, h["d_freq"], D_XBITS, D_BASE)
    pay = p + h["header_size"]
    # literals
    lit_end = pay + h["n_lit_payload"]
    bs = _BackBits(src, lit_end, 0, h["literal_bits"])
    st = list(h["literal_state"])
    lits = bytearray(h["n_literals"])
    for i in range(0, h["n_literals"], 4):
        bs.flush()
        for k in range(4):
            nb, delta, sym = lit_t[st[k]]
            lits[i + k] = sym
            st[k] = delta + bs.pull(nb)
    # L, M, D
    lmd_end = lit_end + h["n_lmd_payload"]
    bs = _BackBits(src, lmd_end, 0, h["lmd_bits"])
    ls, ms, ds = h["l_state"], h["m_state"], h["d_state"]
    lp = 0
    D = prev_d
    target = len(out) + h["n_raw"]
    for _ in range(h["n_matches"]):
        bs.flush()
        tb, vb, delta, base = l_t[ls]; x = bs.pull(tb); ls = delta + (x >> vb); L = base + (x & ((1 << vb) - 1))
        tb, vb, delta, base = m_t[ms]; x = bs.pull(tb); ms = delta + (x >> vb); M = base + (x & ((1 << vb) - 1))
        tb, vb, delta, base = d_t[ds]; x = bs.pull(tb); ds = delta + (x >> vb); nd = base + (x & ((1 << vb) - 1))
        if nd:
            D = nd
        if L:
            out += lits[lp:lp + L]; lp += L
        if M:
            _copy_match(out, D, M)
    if len(out) != target:
        raise ValueError("LZFSE block size mismatch (%d != %d)" % (len(out), target))
    return lmd_end, D


def _copy_match(out, D, M):
    if D <= 0 or D > len(out):
        raise ValueError("bad match distance")
    s = len(out) - D
    if D >= M:
        out += out[s:s + M]
    else:
        chunk = out[s:]
        reps, rem = divmod(M, D)
        out += chunk * reps + chunk[:rem]


def _decode_lzvn(src, p, end, out, n_raw):
    target = len(out) + n_raw
    D = 0
    while p < end:
        opc = src[p]
        if opc == 0x06:           # eos
            break
        if opc in (0x0E, 0x16):   # nop
            p += 1; continue
        if opc in (0x1E, 0x26, 0x2E, 0x36, 0x3E) or 0x70 <= opc <= 0x7F or 0xD0 <= opc <= 0xDF:
            raise ValueError("undefined LZVN opcode 0x%02x" % opc)
        if 0xE0 <= opc <= 0xEF:   # literal
            if opc == 0xE0:
                L = src[p + 1] + 16; p += 2
            else:
                L = opc & 0xF; p += 1
            out += src[p:p + L]; p += L; continue
        if opc >= 0xF0:           # match with previous distance
            if opc == 0xF0:
                M = src[p + 1] + 16; p += 2
            else:
                M = opc & 0xF; p += 1
            _copy_match(out, D, M); continue
        if 0xA0 <= opc <= 0xBF:   # medium distance
            L = (opc >> 3) & 3
            w = src[p + 1] | (src[p + 2] << 8)
            M = (((opc & 7) << 2) | (w & 3)) + 3
            D = w >> 2; p += 3
        else:
            L = opc >> 6
            M = ((opc >> 3) & 7) + 3
            low = opc & 7
            if low == 7:
                D = src[p + 1] | (src[p + 2] << 8); p += 3
            elif low == 6:
                p += 1
            else:
                D = (low << 8) | src[p + 1]; p += 2
        if L:
            out += src[p:p + L]; p += L
        _copy_match(out, D, M)
    if len(out) != target:
        raise ValueError("LZVN block size mismatch")


def decompress_py(src):
    src = bytes(src)
    out = bytearray()
    p = 0
    while True:
        m = src[p:p + 4]
        if m == b"bvx$":
            return bytes(out)
        if m == b"bvx-":
            n, = struct.unpack_from("<I", src, p + 4)
            out += src[p + 8:p + 8 + n]; p += 8 + n
        elif m == b"bvxn":
            n, pl = struct.unpack_from("<II", src, p + 4)
            _decode_lzvn(src, p + 12, p + 12 + pl, out, n); p += 12 + pl
        elif m == b"bvx2":
            p, _ = _decode_fse_block(src, p, _v2_header(src, p), out, 0)
        elif m == b"bvx1":
            raise NotImplementedError("uncompressed-header LZFSE v1 blocks are not supported")
        else:
            raise ValueError("bad LZFSE block magic %r at %d" % (m, p))
