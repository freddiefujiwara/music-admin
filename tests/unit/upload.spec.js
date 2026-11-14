import { describe, expect, it, vi } from 'vitest'
import {
  MAX_MP3_BYTES,
  arrayBufferToBase64,
  fileToBase64,
  measureDurationSeconds,
} from '../../src/utils/upload.js'

describe('arrayBufferToBase64', () => {
  it('encodes bytes as base64', () => {
    const buffer = new Uint8Array([1, 2, 3, 250]).buffer
    expect(arrayBufferToBase64(buffer)).toBe(Buffer.from([1, 2, 3, 250]).toString('base64'))
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('')
  })

  it('handles buffers larger than one chunk', () => {
    const bytes = new Uint8Array(0x8000 + 5).map((_, i) => i % 251)
    expect(arrayBufferToBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString('base64'))
  })
})

describe('fileToBase64', () => {
  it('reads a file through FileReader', async () => {
    class FakeReader {
      readAsArrayBuffer() {
        this.result = new Uint8Array([9, 8]).buffer
        this.onload()
      }
    }
    await expect(fileToBase64({}, FakeReader)).resolves.toBe(
      Buffer.from([9, 8]).toString('base64'),
    )
  })

  it('rejects when the read fails', async () => {
    class FakeReader {
      readAsArrayBuffer() {
        this.error = new Error('nope')
        this.onerror()
      }
    }
    await expect(fileToBase64({}, FakeReader)).rejects.toThrow('nope')
  })

  it('rejects with a generic error when the reader has none', async () => {
    class FakeReader {
      readAsArrayBuffer() {
        this.onerror()
      }
    }
    await expect(fileToBase64({}, FakeReader)).rejects.toThrow('file read failed')
  })
})

describe('measureDurationSeconds', () => {
  const makeAudio = (duration, { fail = false } = {}) => {
    const listeners = {}
    return {
      duration,
      addEventListener: (name, fn) => { listeners[name] = fn },
      fire: (name) => listeners[name] && listeners[name](),
      set src(value) {
        this._src = value
        queueMicrotask(() => this.fire(fail ? 'error' : 'loadedmetadata'))
      },
      get src() { return this._src },
    }
  }

  it('resolves the rounded duration and revokes the object URL', async () => {
    const revoke = vi.fn()
    const audio = makeAudio(100.6)
    const seconds = await measureDurationSeconds({}, {
      createObjectURL: () => 'blob:x',
      revokeObjectURL: revoke,
      AudioImpl: function () { return audio },
    })
    expect(seconds).toBe(101)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })

  it('resolves 0 when the audio fails to load', async () => {
    const audio = makeAudio(NaN, { fail: true })
    await expect(measureDurationSeconds({}, {
      createObjectURL: () => 'blob:x',
      revokeObjectURL: () => {},
      AudioImpl: function () { return audio },
    })).resolves.toBe(0)
  })

  it('resolves 0 for a non-finite duration', async () => {
    const audio = makeAudio(Infinity)
    await expect(measureDurationSeconds({}, {
      createObjectURL: () => 'blob:x',
      revokeObjectURL: () => {},
      AudioImpl: function () { return audio },
    })).resolves.toBe(0)
  })

  it('resolves 0 when no object URL can be created', async () => {
    await expect(measureDurationSeconds({}, {
      createObjectURL: () => { throw new Error('no') },
      revokeObjectURL: () => {},
      AudioImpl: function () { return makeAudio(10) },
    })).resolves.toBe(0)
  })
})

describe('MAX_MP3_BYTES', () => {
  it('mirrors the server limit of 10 MB', () => {
    expect(MAX_MP3_BYTES).toBe(10 * 1024 * 1024)
  })
})
