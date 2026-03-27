// gif_encoder.js — pure-JS GIF89a encoder, no external dependencies
// Exposes: window.__scpGifEncode(blobUrl, opts, onProgress) → Promise<Blob>

(function () {
  'use strict';

  // ── LZW encoder ───────────────────────────────────────────────────────────
  // Returns a Uint8Array of packed LZW bytes (NOT a plain JS array).
  function lzwEncode(indexStream) {
    const clearCode = 256;
    const eofCode   = 257;

    // Use a typed output buffer — grows by doubling
    let outBuf  = new Uint8Array(Math.max(1024, (indexStream.length >> 1)));
    let outPos  = 0;
    let bitBuf  = 0;
    let bitLen  = 0;

    function ensureCap(need) {
      if (outPos + need < outBuf.length) return;
      const next = new Uint8Array(outBuf.length * 2);
      next.set(outBuf);
      outBuf = next;
    }

    function emitCode(code, size) {
      bitBuf |= (code << bitLen);
      bitLen += size;
      while (bitLen >= 8) {
        ensureCap(1);
        outBuf[outPos++] = bitBuf & 0xff;
        bitBuf >>>= 8;
        bitLen  -= 8;
      }
    }

    function flush() {
      if (bitLen > 0) {
        ensureCap(1);
        outBuf[outPos++] = bitBuf & 0xff;
        bitBuf = 0; bitLen = 0;
      }
    }

    let codeSize = 9;
    let nextCode = 258;
    let maxCode  = 1 << codeSize; // 512 initially

    // Code table: key = (prefix << 8) | nextByte  → code
    let table = new Map();

    emitCode(clearCode, codeSize);

    function resetTable() {
      table.clear();
      codeSize = 9;
      nextCode = 258;
      maxCode  = 1 << codeSize;
    }

    if (indexStream.length === 0) {
      emitCode(eofCode, codeSize);
      flush();
      return outBuf.subarray(0, outPos);
    }

    let prefix = indexStream[0];

    for (let i = 1; i < indexStream.length; i++) {
      const byte = indexStream[i];
      const key  = (prefix << 8) | byte;

      if (table.has(key)) {
        prefix = table.get(key);
      } else {
        emitCode(prefix, codeSize);

        if (nextCode < 4096) {
          table.set(key, nextCode++);
          if (nextCode > maxCode && codeSize < 12) {
            codeSize++;
            maxCode = 1 << codeSize;
          }
        }

        if (nextCode >= 4096) {
          emitCode(clearCode, codeSize);
          resetTable();
        }

        prefix = byte;
      }
    }

    emitCode(prefix,  codeSize);
    emitCode(eofCode, codeSize);
    flush();

    return outBuf.subarray(0, outPos);
  }

  // ── Color quantization ────────────────────────────────────────────────────
  function buildPalette(imageData) {
    const data = imageData.data;
    const freq = new Map();

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]   >> 2;
      const g = data[i+1] >> 2;
      const b = data[i+2] >> 2;
      const key = (r << 12) | (g << 6) | b;
      freq.set(key, (freq.get(key) || 0) + 1);
    }

    const sorted  = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const palette = [];
    for (let i = 0; i < Math.min(256, sorted.length); i++) {
      const key = sorted[i][0];
      const r = ((key >> 12) & 0x3f) << 2;
      const g = ((key >>  6) & 0x3f) << 2;
      const b =  (key        & 0x3f) << 2;
      palette.push([r, g, b]);
    }
    while (palette.length < 256) palette.push([0, 0, 0]);
    return palette;
  }

  function buildFastMap(palette) {
    const map = new Map();
    for (let i = 0; i < palette.length; i++) {
      const [r, g, b] = palette[i];
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      if (!map.has(key)) map.set(key, i);
    }
    return map;
  }

  function nearestColor(r, g, b, palette) {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i][0];
      const dg = g - palette[i][1];
      const db = b - palette[i][2];
      const d  = dr*dr + dg*dg + db*db;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  function quantizeFrame(imageData, palette, fastMap) {
    const data    = imageData.data;
    const indices = new Uint8Array(imageData.width * imageData.height);
    const cache   = new Map();

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);

      let idx = fastMap.get(key);
      if (idx === undefined) {
        idx = cache.get(key);
        if (idx === undefined) {
          idx = nearestColor(r, g, b, palette);
          cache.set(key, idx);
        }
      }
      indices[p] = idx;
    }
    return indices;
  }

  // ── Streaming GIF builder ─────────────────────────────────────────────────
  // Instead of one giant flat array → Uint8Array, we collect small Uint8Array
  // chunks and return new Blob(chunks) — avoids any single huge allocation.

  function u16LE(v) {
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  }

  function buildGifHeader(palette, width, height) {
    // Fixed-size header: 6 (sig) + 7 (LSD) + 768 (GCT) + 19 (Netscape ext) = 800 bytes
    const buf = new Uint8Array(800);
    let p = 0;

    // GIF89a signature
    buf[p++]=0x47; buf[p++]=0x49; buf[p++]=0x46; buf[p++]=0x38; buf[p++]=0x39; buf[p++]=0x61;

    // Logical Screen Descriptor
    buf[p++] = width  & 0xff; buf[p++] = (width  >> 8) & 0xff;
    buf[p++] = height & 0xff; buf[p++] = (height >> 8) & 0xff;
    buf[p++] = 0b11110111; // GCT present, 8-bit colour
    buf[p++] = 0;           // background colour index
    buf[p++] = 0;           // pixel aspect ratio

    // Global Colour Table (256 × 3 = 768 bytes)
    for (let i = 0; i < 256; i++) {
      buf[p++] = palette[i][0];
      buf[p++] = palette[i][1];
      buf[p++] = palette[i][2];
    }

    // Netscape Application Extension (loop forever)
    buf[p++] = 0x21; buf[p++] = 0xff; buf[p++] = 11;
    // "NETSCAPE2.0"
    const ns = [0x4e,0x45,0x54,0x53,0x43,0x41,0x50,0x45,0x32,0x2e,0x30];
    for (let i = 0; i < 11; i++) buf[p++] = ns[i];
    buf[p++] = 3; buf[p++] = 1;
    buf[p++] = 0; buf[p++] = 0; // loop count = 0 (forever)
    buf[p++] = 0; // block terminator

    return buf; // p should equal 800
  }

  function buildFrameChunk(indices, width, height, delayCs) {
    // Graphic Control Extension: 8 bytes
    // Image Descriptor: 10 bytes
    // LZW min code size: 1 byte
    // LZW sub-blocks: variable
    // Trailer not included here — written separately

    const lzwData = lzwEncode(indices);

    // Calculate sub-block overhead: ceil(lzwData.length / 255) block-size bytes + 1 terminator
    const numBlocks   = Math.ceil(lzwData.length / 255);
    const subBlockLen = lzwData.length + numBlocks + 1; // data + size-bytes + terminator

    const frameSize = 8 + 10 + 1 + subBlockLen;
    const buf = new Uint8Array(frameSize);
    let p = 0;

    // Graphic Control Extension
    buf[p++] = 0x21; buf[p++] = 0xf9; buf[p++] = 4;
    buf[p++] = 0b00000000; // disposal=0, no user input, no transparency
    buf[p++] = delayCs & 0xff; buf[p++] = (delayCs >> 8) & 0xff;
    buf[p++] = 0; // transparent colour index (unused)
    buf[p++] = 0; // block terminator

    // Image Descriptor
    buf[p++] = 0x2c;
    buf[p++] = 0; buf[p++] = 0; // left
    buf[p++] = 0; buf[p++] = 0; // top
    buf[p++] = width  & 0xff; buf[p++] = (width  >> 8) & 0xff;
    buf[p++] = height & 0xff; buf[p++] = (height >> 8) & 0xff;
    buf[p++] = 0; // packed: no local colour table, not interlaced

    // LZW minimum code size
    buf[p++] = 8;

    // LZW data as GIF sub-blocks (max 255 bytes each)
    let src = 0;
    while (src < lzwData.length) {
      const blockSize = Math.min(255, lzwData.length - src);
      buf[p++] = blockSize;
      buf.set(lzwData.subarray(src, src + blockSize), p);
      p   += blockSize;
      src += blockSize;
    }
    buf[p++] = 0; // block terminator

    return buf;
  }

  // ── Main encoder ─────────────────────────────────────────────────────────
  async function scpGifEncode(blobUrl, opts, onProgress) {
    const fps      = (opts && opts.fps)      || 10;
    const maxWidth = (opts && opts.maxWidth) || 800;
    const delayCs  = Math.round(100 / fps);

    // Load video into hidden element
    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    video.muted   = true;
    video.preload = 'auto';
    video.src     = blobUrl;
    document.documentElement.appendChild(video);

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });

    // Compute output dimensions
    const vw       = video.videoWidth  || 640;
    const vh       = video.videoHeight || 480;
    const scale    = Math.min(1, maxWidth / vw);
    const width    = Math.floor(vw * scale);
    const height   = Math.floor(vh * scale);
    const duration = video.duration;

    // Off-screen canvas
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const totalFrames = Math.max(1, Math.floor(duration * fps));

    function seekTo(time) {
      return new Promise((resolve, reject) => {
        if (Math.abs(video.currentTime - time) < 0.001) { resolve(); return; }
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.addEventListener('error',  () => reject(new Error('seek error')), { once: true });
        video.currentTime = time;
      });
    }

    // ── Streaming encode ──────────────────────────────────────────────────
    // Collect Uint8Array chunks — never build one giant flat array.
    const chunks = [];
    let palette  = null;
    let fastMap  = null;

    for (let i = 0; i < totalFrames; i++) {
      await seekTo(i / fps);
      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      // Build palette from frame 0 and write header immediately
      if (i === 0) {
        palette = buildPalette(imageData);
        fastMap = buildFastMap(palette);
        chunks.push(buildGifHeader(palette, width, height));
      }

      // Quantize + encode + stream this frame right away (no accumulation)
      const indices = quantizeFrame(imageData, palette, fastMap);
      chunks.push(buildFrameChunk(indices, width, height, delayCs));

      if (onProgress) onProgress(Math.round(((i + 1) / totalFrames) * 100));

      // Yield every 5 frames to keep the page responsive
      if ((i + 1) % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }

    // GIF trailer (1 byte)
    chunks.push(new Uint8Array([0x3b]));

    // Free video element
    video.src = '';
    document.documentElement.removeChild(video);

    // Blob constructor accepts an array of ArrayBuffer/TypedArray/string —
    // it concatenates them efficiently without a single huge allocation.
    return new Blob(chunks, { type: 'image/gif' });
  }

  window.__scpGifEncode = scpGifEncode;
})();
