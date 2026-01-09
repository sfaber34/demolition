let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

let WASM_VECTOR_LEN = 0;

const WorldHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_worldhandle_free(ptr >>> 0, 1));

/**
 * A tiny WASM-friendly wrapper around `World`.
 */
export class WorldHandle {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WorldHandle.prototype);
        obj.__wbg_ptr = ptr;
        WorldHandleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldHandleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_worldhandle_free(ptr, 0);
    }
    /**
     * Set run seed from a 0x-prefixed hex string (bytes32). Invalid input => sets to zero.
     * @param {string} seed_hex
     */
    set_seed_hex(seed_hex) {
        const ptr0 = passStringToWasm0(seed_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.worldhandle_set_seed_hex(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Create a new world with the given run seed (0x... bytes32).
     * @param {string} seed_hex
     * @returns {WorldHandle}
     */
    static new_with_seed(seed_hex) {
        const ptr0 = passStringToWasm0(seed_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldhandle_new_with_seed(ptr0, len0);
        return WorldHandle.__wrap(ret);
    }
    /**
     * Get the full world state as JSON (debug convenience).
     * @returns {string}
     */
    snapshot_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.worldhandle_snapshot_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Return keccak256 hash of the stable binary encoding of the world.
     * @returns {string}
     */
    state_hash_hex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.worldhandle_state_hash_hex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    constructor() {
        const ret = wasm.worldhandle_new();
        this.__wbg_ptr = ret >>> 0;
        WorldHandleFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Step the world by `dt_ms` milliseconds.
     * @param {number} dt_ms
     */
    step(dt_ms) {
        wasm.worldhandle_step(this.__wbg_ptr, dt_ms);
    }
    /**
     * Start playing (mirrors TS engine start/restart behavior).
     */
    start() {
        wasm.worldhandle_start(this.__wbg_ptr);
    }
}
if (Symbol.dispose) WorldHandle.prototype[Symbol.dispose] = WorldHandle.prototype.free;

export function __wbg___wbindgen_throw_dd24417ed36fc46e(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};

export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
};
