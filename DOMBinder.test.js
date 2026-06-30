import { describe, it, expect, beforeEach } from 'vitest';
import { DOMBinder } from './DOMBinder.js';

const makeMockElement = () => ({ style: { transform: '' } });

describe('DOMBinder', () => {

    describe('Construction', () => {
        it('allocates a shadow buffer of size maxEntities * 16', () => {
            const binder = new DOMBinder(10);
            expect(binder.prevMatrixBuffer).toBeInstanceOf(Float32Array);
            expect(binder.prevMatrixBuffer.length).toBe(160);
        });

        it('NaN-poisons the shadow buffer to force first-frame paint', () => {
            const binder = new DOMBinder(2);
            for (let i = 0; i < binder.prevMatrixBuffer.length; i++) {
                expect(Number.isNaN(binder.prevMatrixBuffer[i])).toBe(true);
            }
        });

        it('handles maxEntities = 0 without throwing', () => {
            const binder = new DOMBinder(0);
            expect(binder.prevMatrixBuffer.length).toBe(0);
            expect(() => binder.updateDOMTransforms([], new Float32Array(0), 0)).not.toThrow();
        });

        it('coerces non-integer maxEntities via | 0', () => {
            const binder = new DOMBinder(3.7);
            expect(binder.maxEntities).toBe(3);
            expect(binder.prevMatrixBuffer.length).toBe(48);
        });
    });

    describe('First-frame paint guarantee', () => {
        it('writes to DOM on first frame even when matrix is all zeros', () => {
            const binder = new DOMBinder(1);
            const els = [makeMockElement()];
            const buf = new Float32Array(16); // all zeros
            binder.updateDOMTransforms(els, buf, 1);
            expect(els[0].style.transform).toBe('matrix3d(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)');
        });

        it('emits the exact matrix3d string format with comma separators', () => {
            const binder = new DOMBinder(1);
            const els = [makeMockElement()];
            const buf = new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                10, 20, 30, 1,
            ]);
            binder.updateDOMTransforms(els, buf, 1);
            expect(els[0].style.transform).toBe('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1)');
        });
    });

    describe('Dirty checking', () => {
        it('skips DOM write when matrix unchanged across frames', () => {
            const binder = new DOMBinder(1);
            const els = [makeMockElement()];
            const buf = new Float32Array(16);

            binder.updateDOMTransforms(els, buf, 1); // frame 1: writes
            els[0].style.transform = '<sentinel>';
            binder.updateDOMTransforms(els, buf, 1); // frame 2: should NOT write

            expect(els[0].style.transform).toBe('<sentinel>');
        });

        it('writes when ANY single matrix component changes (all 16 positions matter)', () => {
            const binder = new DOMBinder(1);
            const els = [makeMockElement()];
            const buf = new Float32Array(16);

            // Settle: write happens on first frame, second frame is no-op.
            binder.updateDOMTransforms(els, buf, 1);
            binder.updateDOMTransforms(els, buf, 1);

            for (let pos = 0; pos < 16; pos++) {
                buf[pos] = 1.0;
                els[0].style.transform = '<sentinel>';
                binder.updateDOMTransforms(els, buf, 1);
                expect(els[0].style.transform).not.toBe('<sentinel>');
                buf[pos] = 0; // reset; the next iteration's write will then be triggered by a change in pos+1
            }
        });

        it('only writes to changed entities, leaving stable ones alone', () => {
            const binder = new DOMBinder(3);
            const els = [makeMockElement(), makeMockElement(), makeMockElement()];
            const buf = new Float32Array(48);

            binder.updateDOMTransforms(els, buf, 3); // first frame: all 3 write

            els[0].style.transform = '<a>';
            els[1].style.transform = '<b>';
            els[2].style.transform = '<c>';

            // Change only entity 1 (offset 16..31)
            buf[16 + 5] = 42;
            binder.updateDOMTransforms(els, buf, 3);

            expect(els[0].style.transform).toBe('<a>');
            expect(els[1].style.transform).not.toBe('<b>');
            expect(els[2].style.transform).toBe('<c>');
        });

        it('updates shadow buffer on write so next identical frame is a no-op', () => {
            const binder = new DOMBinder(1);
            const els = [makeMockElement()];
            const buf = new Float32Array(16);
            buf[0] = 1.0;

            binder.updateDOMTransforms(els, buf, 1); // writes (initial)
            binder.updateDOMTransforms(els, buf, 1); // no-op

            els[0].style.transform = '<sentinel>';
            binder.updateDOMTransforms(els, buf, 1); // also no-op
            expect(els[0].style.transform).toBe('<sentinel>');
        });
    });

    describe('Bounds and edge cases', () => {
        it('respects safeCount when count > elements.length', () => {
            const binder = new DOMBinder(10);
            const els = [makeMockElement(), makeMockElement()];
            const buf = new Float32Array(160);
            expect(() => binder.updateDOMTransforms(els, buf, 10)).not.toThrow();
            expect(els[0].style.transform).toContain('matrix3d');
            expect(els[1].style.transform).toContain('matrix3d');
        });

        it('respects safeCount when count > maxEntities', () => {
            const binder = new DOMBinder(2);
            // User passes more elements than the binder was sized for.
            const els = [makeMockElement(), makeMockElement(), makeMockElement(), makeMockElement()];
            const buf = new Float32Array(64);
            expect(() => binder.updateDOMTransforms(els, buf, 4)).not.toThrow();
            // First two should be written; last two should not be touched
            expect(els[0].style.transform).toContain('matrix3d');
            expect(els[1].style.transform).toContain('matrix3d');
            expect(els[2].style.transform).toBe('');
            expect(els[3].style.transform).toBe('');
        });

        it('skips null/undefined elements without throwing', () => {
            const binder = new DOMBinder(3);
            const els = [makeMockElement(), null, makeMockElement()];
            const buf = new Float32Array(48);
            expect(() => binder.updateDOMTransforms(els, buf, 3)).not.toThrow();
            expect(els[0].style.transform).toContain('matrix3d');
            expect(els[2].style.transform).toContain('matrix3d');
        });

        it('handles count = 0 gracefully (no work performed)', () => {
            const binder = new DOMBinder(2);
            const els = [makeMockElement(), makeMockElement()];
            const buf = new Float32Array(32);
            binder.updateDOMTransforms(els, buf, 0);
            expect(els[0].style.transform).toBe('');
            expect(els[1].style.transform).toBe('');
        });

        it('handles negative count as no work (loop guard i < 0)', () => {
            const binder = new DOMBinder(2);
            const els = [makeMockElement(), makeMockElement()];
            const buf = new Float32Array(32);
            expect(() => binder.updateDOMTransforms(els, buf, -5)).not.toThrow();
            expect(els[0].style.transform).toBe('');
        });
    });

    describe('invalidate()', () => {
        it('forces a re-paint on next call by re-poisoning the shadow', () => {
            const binder = new DOMBinder(1);
            const els = [makeMockElement()];
            const buf = new Float32Array(16);

            binder.updateDOMTransforms(els, buf, 1);
            els[0].style.transform = '<sentinel>';

            binder.invalidate();
            binder.updateDOMTransforms(els, buf, 1);
            expect(els[0].style.transform).not.toBe('<sentinel>');
        });

        it('forces re-paint for ALL bound entities, not just one', () => {
            const binder = new DOMBinder(3);
            const els = [makeMockElement(), makeMockElement(), makeMockElement()];
            const buf = new Float32Array(48);

            binder.updateDOMTransforms(els, buf, 3);

            els[0].style.transform = '<a>';
            els[1].style.transform = '<b>';
            els[2].style.transform = '<c>';

            binder.invalidate();
            binder.updateDOMTransforms(els, buf, 3);

            expect(els[0].style.transform).not.toBe('<a>');
            expect(els[1].style.transform).not.toBe('<b>');
            expect(els[2].style.transform).not.toBe('<c>');
        });

        it('subsequent identical frame after invalidate becomes a no-op again', () => {
            const binder = new DOMBinder(1);
            const els = [makeMockElement()];
            const buf = new Float32Array(16);

            binder.updateDOMTransforms(els, buf, 1);
            binder.invalidate();
            binder.updateDOMTransforms(els, buf, 1); // re-paints
            els[0].style.transform = '<sentinel>';
            binder.updateDOMTransforms(els, buf, 1); // should be no-op

            expect(els[0].style.transform).toBe('<sentinel>');
        });
    });
});
