/**
 * lite-dom-binder.js
 * Bypasses framework diffing by piping Float32Array transform matrices
 * directly to the CSSOM. Includes zero-GC dirty checking to prevent
 * unnecessary CSSOM writes.
 */

export class DOMBinder {
    /**
     * @param {number} maxEntities - Maximum number of DOM nodes this binder will track.
     */
    constructor(maxEntities) {
        this.maxEntities = maxEntities | 0;

        // Pre-allocated shadow buffer tracking last-rendered state.
        // 64 bytes per entity (16 floats × 4). 10,000 entities ≈ 640 KB.
        this.prevMatrixBuffer = new Float32Array(this.maxEntities * 16);

        // NaN-poison the shadow so the first dirty check fires for every
        // entity — guarantees an initial paint regardless of source contents,
        // including the legitimate edge case of an all-zero matrix.
        this.prevMatrixBuffer.fill(NaN);
    }

    /**
     * Hot-path CSSOM updater. Runs in O(count), with one matrix3d string
     * allocation per *changed* entity (zero allocations for stable entities).
     *
     * @param {(HTMLElement | null | undefined)[]} elements - Cached DOM nodes.
     * @param {Float32Array} matrixBuffer - Flat 4×4 matrix data, stride 16.
     * @param {number} count - Number of active entities to process.
     */
    updateDOMTransforms(elements, matrixBuffer, count) {
        const m = matrixBuffer;
        const p = this.prevMatrixBuffer;

        // Clamp count against both element array length AND constructor capacity.
        // Reads past prevMatrixBuffer would return undefined, which !== any
        // float, causing perpetual writes with no shadow update.
        const elemLimit = elements.length;
        const limit = elemLimit < this.maxEntities ? elemLimit : this.maxEntities;
        const safeCount = count > limit ? limit : count;

        for (let i = 0; i < safeCount; i = (i + 1) | 0) {
            const o = i * 16;
            const el = elements[i];

            if (!el) continue;

            // Unrolled 16-component dirty check. Branch predictor handles this
            // beautifully — typical scenes have most entities stable per frame.
            if (
                m[o]      !== p[o]      || m[o + 1]  !== p[o + 1]  ||
                m[o + 2]  !== p[o + 2]  || m[o + 3]  !== p[o + 3]  ||
                m[o + 4]  !== p[o + 4]  || m[o + 5]  !== p[o + 5]  ||
                m[o + 6]  !== p[o + 6]  || m[o + 7]  !== p[o + 7]  ||
                m[o + 8]  !== p[o + 8]  || m[o + 9]  !== p[o + 9]  ||
                m[o + 10] !== p[o + 10] || m[o + 11] !== p[o + 11] ||
                m[o + 12] !== p[o + 12] || m[o + 13] !== p[o + 13] ||
                m[o + 14] !== p[o + 14] || m[o + 15] !== p[o + 15]
            ) {
                // Update shadow first so a subsequent identical frame is a no-op.
                p[o]      = m[o];      p[o + 1]  = m[o + 1];
                p[o + 2]  = m[o + 2];  p[o + 3]  = m[o + 3];
                p[o + 4]  = m[o + 4];  p[o + 5]  = m[o + 5];
                p[o + 6]  = m[o + 6];  p[o + 7]  = m[o + 7];
                p[o + 8]  = m[o + 8];  p[o + 9]  = m[o + 9];
                p[o + 10] = m[o + 10]; p[o + 11] = m[o + 11];
                p[o + 12] = m[o + 12]; p[o + 13] = m[o + 13];
                p[o + 14] = m[o + 14]; p[o + 15] = m[o + 15];

                // The only allocation in the pipeline. matrix3d forces a
                // composite-only update path in modern browsers.
                el.style.transform = `matrix3d(${m[o]},${m[o+1]},${m[o+2]},${m[o+3]},${m[o+4]},${m[o+5]},${m[o+6]},${m[o+7]},${m[o+8]},${m[o+9]},${m[o+10]},${m[o+11]},${m[o+12]},${m[o+13]},${m[o+14]},${m[o+15]})`;
            }
        }
    }

    /**
     * Forces every bound entity to repaint on the next call by re-poisoning
     * the shadow buffer with NaN. Useful after page-level events that may
     * have desynced the DOM from your matrix state — route changes, theme
     * toggles, fullscreen transitions, etc.
     */
    invalidate() {
        this.prevMatrixBuffer.fill(NaN);
    }
}
