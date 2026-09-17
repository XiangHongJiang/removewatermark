/**
 * inpaint/utils.js — 图像处理基础工具函数
 */

const InpaintUtils = {
    /**
     * 高斯函数
     * @param {number} x
     * @param {number} sigma
     * @returns {number}
     */
    gaussian(x, sigma) {
        return Math.exp(-(x * x) / (2 * sigma * sigma));
    },

    /**
     * 颜色距离（RGB 空间）
     * @param {number} r1, g1, b1, r2, g2, b2
     * @returns {number}
     */
    colorDistance(r1, g1, b1, r2, g2, b2) {
        const dr = r1 - r2;
        const dg = g1 - g2;
        const db = b1 - b2;
        return Math.sqrt(dr * dr + dg * dg + db * db);
    },

    /**
     * 获取像素索引
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @returns {number}
     */
    pixelIndex(x, y, width) {
        return (y * width + x) * 4;
    },

    /**
     * 检查坐标是否在图片范围内
     */
    inBounds(x, y, width, height) {
        return x >= 0 && x < width && y >= 0 && y < height;
    },

    /**
     * 获取 mask 边界像素（mask 中值为1且邻域有值为0的像素）
     * @param {Uint8Array} mask
     * @param {number} width
     * @param {number} height
     * @returns {Array<{x: number, y: number}>}
     */
    getMaskBoundary(mask, width, height) {
        const boundary = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] === 0) continue;

                // 检查4邻域是否有非mask像素
                let isBoundary = false;
                const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
                for (const [nx, ny] of neighbors) {
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                        isBoundary = true;
                        break;
                    }
                    if (mask[ny * width + nx] === 0) {
                        isBoundary = true;
                        break;
                    }
                }
                if (isBoundary) {
                    boundary.push({ x, y });
                }
            }
        }
        return boundary;
    },

    /**
     * 膨胀 mask（将 mask 区域向外扩展 n 像素）
     * 用于扩大修复区域，确保水印边缘也被覆盖
     * @param {Uint8Array} mask
     * @param {number} width
     * @param {number} height
     * @param {number} radius
     * @returns {Uint8Array} - 膨胀后的 mask
     */
    dilateMask(mask, width, height, radius) {
        const result = new Uint8Array(mask);
        const r2 = radius * radius;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x] > 0) continue;

                // 检查邻域是否有 mask 像素
                let found = false;
                for (let dy = -radius; dy <= radius && !found; dy++) {
                    for (let dx = -radius; dx <= radius && !found; dx++) {
                        if (dx * dx + dy * dy > r2) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (this.inBounds(nx, ny, width, height) && mask[ny * width + nx] > 0) {
                            found = true;
                        }
                    }
                }
                if (found) {
                    result[y * width + x] = 1;
                }
            }
        }
        return result;
    },

    /**
     * 获取 mask 的包围盒
     * @param {Uint8Array} mask
     * @param {number} width
     * @param {number} height
     * @returns {{minX, minY, maxX, maxY} | null}
     */
    getMaskBoundingBox(mask, width, height) {
        let minX = width, minY = height, maxX = 0, maxY = 0;
        let found = false;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x] > 0) {
                    found = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!found) return null;
        return { minX, minY, maxX, maxY };
    },

    /**
     * 计算两个 patch 的 SSD（Sum of Squared Differences）
     * @param {Uint8ClampedArray} data
     * @param {number} width
     * @param {number} height
     * @param {number} ax, ay - patch A 中心
     * @param {number} bx, by - patch B 中心
     * @param {number} radius - patch 半径
     * @param {Uint8Array} mask - 用于跳过 mask 区域
     * @returns {number} - SSD 值（越小越相似）
     */
    patchSSD(data, width, height, ax, ay, bx, by, radius, mask) {
        let ssd = 0;
        let count = 0;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const ax2 = ax + dx;
                const ay2 = ay + dy;
                const bx2 = bx + dx;
                const by2 = by + dy;

                // 两个位置都必须在图片内
                if (!this.inBounds(ax2, ay2, width, height)) continue;
                if (!this.inBounds(bx2, by2, width, height)) continue;

                // 跳过 mask 区域（这些像素还没有有效值）
                if (mask[ay2 * width + ax2] > 0) continue;
                if (mask[by2 * width + bx2] > 0) continue;

                const aIdx = (ay2 * width + ax2) * 4;
                const bIdx = (by2 * width + bx2) * 4;

                const dr = data[aIdx] - data[bIdx];
                const dg = data[aIdx + 1] - data[bIdx + 1];
                const db = data[aIdx + 2] - data[bIdx + 2];

                ssd += dr * dr + dg * dg + db * db;
                count++;
            }
        }

        return count > 0 ? ssd / count : Infinity;
    },

    /**
     * 将一个 patch 的颜色复制到另一个位置
     * @param {Uint8ClampedArray} data
     * @param {number} width
     * @param {number} height
     * @param {number} srcX, srcY - 源位置
     * @param {number} dstX, dstY - 目标位置
     * @param {Uint8Array} mask - 只复制 mask 区域内的像素
     */
    copyPatch(data, width, height, srcX, srcY, dstX, dstY, mask) {
        const offsetX = srcX - dstX;
        const offsetY = srcY - dstY;

        for (let y = dstY; y < height; y++) {
            for (let x = dstX; x < width; x++) {
                if (mask[y * width + x] === 0) continue;

                const sx = x + offsetX;
                const sy = y + offsetY;
                if (!this.inBounds(sx, sy, width, height)) continue;

                const srcIdx = (sy * width + sx) * 4;
                const dstIdx = (y * width + x) * 4;

                data[dstIdx] = data[srcIdx];
                data[dstIdx + 1] = data[srcIdx + 1];
                data[dstIdx + 2] = data[srcIdx + 2];
            }
        }
    },

    /**
     * 简单的盒式模糊（用于平滑修复结果边缘）
     * @param {Uint8ClampedArray} data
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} mask - 只模糊 mask 区域
     * @param {number} radius
     * @returns {Uint8ClampedArray}
     */
    boxBlur(data, width, height, mask, radius) {
        const result = new Uint8ClampedArray(data);
        const diam = radius * 2 + 1;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x] === 0) continue;

                let r = 0, g = 0, b = 0, count = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (!this.inBounds(nx, ny, width, height)) continue;

                        const idx = (ny * width + nx) * 4;
                        r += data[idx];
                        g += data[idx + 1];
                        b += data[idx + 2];
                        count++;
                    }
                }

                if (count > 0) {
                    const idx = (y * width + x) * 4;
                    result[idx] = r / count;
                    result[idx + 1] = g / count;
                    result[idx + 2] = b / count;
                }
            }
        }

        return result;
    }
};
