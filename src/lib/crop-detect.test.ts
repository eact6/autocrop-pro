import { describe, it, expect } from "vitest";
import { detectImageCrop, applyPadding, unionCrops, evenCrop } from "../../website/cropper/crop-detect.js";

function makeRgba(
    width: number,
    height: number,
    fill: [number, number, number],
): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        data[i * 4] = fill[0];
        data[i * 4 + 1] = fill[1];
        data[i * 4 + 2] = fill[2];
        data[i * 4 + 3] = 255;
    }
    return data;
}

function putPixel(
    data: Uint8ClampedArray,
    width: number,
    x: number,
    y: number,
    rgb: [number, number, number],
) {
    const i = (y * width + x) * 4;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
}

describe("detectImageCrop", () => {
    it("returns full frame for a white image at tolerance 0", () => {
        const data = makeRgba(100, 100, [255, 255, 255]);
        const result = detectImageCrop(data, 100, 100, { tolerance: 0 });
        expect(result).toEqual({ w: 100, h: 100, x: 0, y: 0 });
    });

    it("detects a 50x50 white square with 25px black borders", () => {
        const data = makeRgba(100, 100, [0, 0, 0]);
        for (let y = 25; y < 75; y++) {
            for (let x = 25; x < 75; x++) {
                putPixel(data, 100, x, y, [255, 255, 255]);
            }
        }
        const result = detectImageCrop(data, 100, 100, { tolerance: 50 });
        expect(result).toEqual({ x: 25, y: 25, w: 50, h: 50 });
    });

    it("at tolerance 0 treats any non-zero pixel as content", () => {
        const data = makeRgba(200, 200, [0, 0, 0]);
        for (let y = 80; y < 120; y++) {
            for (let x = 0; x < 200; x++) {
                putPixel(data, 200, x, y, [255, 255, 255]);
            }
        }
        const result = detectImageCrop(data, 200, 200, { tolerance: 0 });
        expect(result).toEqual({ x: 0, y: 80, w: 200, h: 40 });
    });

    it("returns full dimensions when every pixel is content", () => {
        const data = makeRgba(64, 64, [128, 128, 128]);
        const result = detectImageCrop(data, 64, 64, { tolerance: 50 });
        expect(result).toEqual({ w: 64, h: 64, x: 0, y: 0 });
    });

    it("handles a 1x1 image", () => {
        const data = makeRgba(1, 1, [128, 128, 128]);
        const result = detectImageCrop(data, 1, 1, { tolerance: 50 });
        expect(result).toEqual({ w: 1, h: 1, x: 0, y: 0 });
    });

    it("treats near-black (5,5,5) as border at tolerance 20", () => {
        const data = makeRgba(200, 200, [5, 5, 5]);
        for (let y = 50; y < 150; y++) {
            for (let x = 50; x < 150; x++) {
                putPixel(data, 200, x, y, [200, 200, 200]);
            }
        }
        const result = detectImageCrop(data, 200, 200, { tolerance: 20 });
        expect(result).toEqual({ x: 50, y: 50, w: 100, h: 100 });
    });

    it("returns empty crop for 0x0", () => {
        const result = detectImageCrop(new Uint8ClampedArray(0), 0, 0, { tolerance: 20 });
        expect(result).toEqual({ w: 0, h: 0, x: 0, y: 0 });
    });
});

describe("applyPadding", () => {
    it("expands a center crop by 10px on each side", () => {
        const padded = applyPadding({ x: 40, y: 40, w: 20, h: 20 }, 100, 100, 10);
        expect(padded).toEqual({ x: 30, y: 30, w: 40, h: 40 });
    });

    it("clamps padding at the image edge", () => {
        const padded = applyPadding({ x: 0, y: 0, w: 20, h: 20 }, 100, 100, 10);
        expect(padded).toEqual({ x: 0, y: 0, w: 40, h: 40 });
    });
});

describe("evenCrop", () => {
    it("rounds crop rect to even values", () => {
        expect(evenCrop({ x: 11, y: 7, w: 101, h: 51 }, 200, 200)).toEqual({
            x: 10,
            y: 6,
            w: 100,
            h: 50,
        });
    });
});

describe("unionCrops", () => {
    it("returns the bounding union of sampled frames", () => {
        const union = unionCrops(
            [
                { x: 10, y: 20, w: 80, h: 40 },
                { x: 8, y: 18, w: 90, h: 50 },
            ],
            200,
            200,
        );
        expect(union).toEqual({ x: 8, y: 18, w: 90, h: 50 });
    });

    it("returns the full frame when given no crops", () => {
        expect(unionCrops([], 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    });
});
