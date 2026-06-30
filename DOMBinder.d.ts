/**
 * lite-dom-binder.d.ts
 */

export class DOMBinder {
    /**
     * Initializes the binder and pre-allocates a shadow buffer for dirty-checking.
     * @param maxEntities The maximum number of DOM nodes this binder will track.
     */
    constructor(maxEntities: number);

    /**
     * The hot-path CSSOM updater. Bypasses framework diffing.
     *
     * @param elements Array of cached HTMLElements.
     * @param matrixBuffer Flat Float32Array of 4x4 matrices (stride 16).
     * @param count Number of active entities to process.
     */
    updateDOMTransforms(elements: (HTMLElement | null | undefined)[], matrixBuffer: Float32Array, count: number): void;

    /**
     * Forces every bound entity to repaint on the next call by poisoning the shadow buffer with NaNs.
     */
    invalidate(): void;
}