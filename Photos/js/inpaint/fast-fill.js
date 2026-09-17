/**
 * inpaint/fast-fill.js — 边界扩散填充算法（快速模式）
 *
 * 修复版：维护动态 known 数组，已填充像素立即变为已知，
 * 参与后续像素的填充计算，实现真正的扩散填充。
 *
 * 算法步骤：
 * 1. 初始化 known 数组：原始非mask像素=已知，mask像素=未知
 * 2. 计算每个未知像素到最近已知像素的距离（BFS）
 * 3. 按距离从近到远填充，每个像素用邻域已知像素的高斯加权平均
 * 4. ★ 填充后立即标记为已知，参与后续像素计算
 * 5. 重复 2-4 多轮以精化
 */

const FastFill = {
    /**
     * 执行快速填充
     * @param {ImageData} imageData
     * @param {Uint8Array} mask - 1=需要修复
     * @param {object} options
     * @param {number} options.radius - 采样半径（默认5）
     * @param {number} options.iterations - 迭代次数（默认3）
     * @param {function} options.onProgress - 进度回调 (0-1)
     */
    inpaint(imageData, mask, options = {}) {
        const radius = options.radius || 5;
        const iterations = options.iterations || 3;
        const onProgress = options.onProgress || (() => {});

        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const utils = InpaintUtils;

        // 膨胀 mask 1 像素，确保边缘也被覆盖
        const dilatedMask = utils.dilateMask(mask, width, height, 1);

        // ★ 核心修复：维护动态 known 数组
        // known[pixel] = 1 表示该像素已有有效颜色（原始非mask像素 + 已填充像素）
        // 这样已填充的像素可以立即参与后续像素的填充计算，实现真正的扩散
        const known = new Uint8Array(width * height);
        for (let i = 0; i < known.length; i++) {
            known[i] = dilatedMask[i] > 0 ? 0 : 1;
        }

        for (let iter = 0; iter < iterations; iter++) {
            // 计算每个未知像素到最近已知像素的距离
            const distances = this._computeDistances(dilatedMask, known, width, height);

            // 按距离排序，从近到远填充
            const order = this._getFillOrder(distances, width, height);

            const total = order.length;
            const batchSize = Math.max(1, Math.floor(total / 50));

            for (let i = 0; i < total; i++) {
                const { x, y } = order[i];
                const filled = this._fillPixel(data, width, height, x, y, known, radius);

                // ★ 已填充的像素立即标记为已知，参与后续像素的计算
                if (filled) {
                    known[y * width + x] = 1;
                }

                if (i % batchSize === 0) {
                    onProgress((iter + i / total) / iterations);
                }
            }
        }

        // 边缘平滑
        const smoothed = utils.boxBlur(data, width, height, dilatedMask, 1);
        for (let i = 0; i < smoothed.length; i++) {
            if (dilatedMask[Math.floor(i / 4)] > 0) {
                data[i] = smoothed[i];
            }
        }

        onProgress(1);
        return imageData;
    },

    /**
     * 计算每个未知像素到最近已知像素的距离（BFS）
     * @param {Uint8Array} mask - 膨胀后的 mask
     * @param {Uint8Array} known - 已知像素标记（1=已知）
     */
    _computeDistances(mask, known, width, height) {
        const distances = new Float32Array(width * height);
        distances.fill(Infinity);

        const queue = [];

        // 初始化：已知像素距离为0，未知边界像素距离为1
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (known[idx] > 0) {
                    distances[idx] = 0;
                } else if (mask[idx] > 0) {
                    // 检查邻域是否有已知像素
                    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
                    for (const [nx, ny] of neighbors) {
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                        if (known[ny * width + nx] > 0) {
                            distances[idx] = 1;
                            queue.push({ x, y, d: 1 });
                            break;
                        }
                    }
                }
            }
        }

        // BFS 扩散
        while (queue.length > 0) {
            const { x, y, d } = queue.shift();
            const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            for (const [nx, ny] of neighbors) {
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                const nidx = ny * width + nx;
                if (mask[nidx] > 0 && distances[nidx] > d + 1) {
                    distances[nidx] = d + 1;
                    queue.push({ x: nx, y: ny, d: d + 1 });
                }
            }
        }

        return distances;
    },

    /**
     * 按距离从小到大排序，返回填充顺序
     */
    _getFillOrder(distances, width, height) {
        const pixels = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const d = distances[y * width + x];
                if (d > 0 && d < Infinity) {
                    pixels.push({ x, y, d });
                }
            }
        }
        pixels.sort((a, b) => a.d - b.d);
        return pixels;
    },

    /**
     * 用邻域已知像素的高斯加权平均填充单个像素
     * ★ 修复：使用 known 数组，已填充像素也参与计算
     * @returns {boolean} 是否成功填充
     */
    _fillPixel(data, width, height, x, y, known, radius) {
        const utils = InpaintUtils;
        const sigma = radius * 0.8;

        let totalWeight = 0;
        let r = 0, g = 0, b = 0;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx === 0 && dy === 0) continue;

                const nx = x + dx;
                const ny = y + dy;
                if (!utils.inBounds(nx, ny, width, height)) continue;

                // ★ 使用 known 数组：已填充的像素也算已知
                if (known[ny * width + nx] === 0) continue;

                const dist2 = dx * dx + dy * dy;
                const weight = utils.gaussian(Math.sqrt(dist2), sigma);
                const idx = (ny * width + nx) * 4;

                r += data[idx] * weight;
                g += data[idx + 1] * weight;
                b += data[idx + 2] * weight;
                totalWeight += weight;
            }
        }

        if (totalWeight > 0) {
            const idx = (y * width + x) * 4;
            data[idx] = Math.round(r / totalWeight);
            data[idx + 1] = Math.round(g / totalWeight);
            data[idx + 2] = Math.round(b / totalWeight);
            data[idx + 3] = 255;
            return true;
        }
        return false;
    }
};
