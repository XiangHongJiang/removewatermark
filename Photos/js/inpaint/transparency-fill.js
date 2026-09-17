/**
 * inpaint/transparency-fill.js — 半透明水印还原算法
 *
 * 原理：半透明水印公式：观察值 = 原图 × (1-α) + 水印色 × α
 * 反推原图：原图 = (观察值 - 水印色 × α) / (1-α)
 *
 * 步骤：
 * 1. 用户选择水印区域 + 采样水印颜色 + 估计透明度
 * 2. 对 mask 边界像素：从周围非mask像素采样背景色
 * 3. 对 mask 内部像素：用反推公式计算原图颜色
 * 4. 多轮迭代：已还原像素作为已知，帮助相邻像素更准确还原
 * 5. 边界羽化平滑
 *
 * 适合：半透明文字水印、彩色印章、浅色覆盖层
 */

const TransparencyFill = {
    /**
     * 执行半透明水印还原
     * @param {ImageData} imageData
     * @param {Uint8Array} mask - 1=水印区域
     * @param {object} options
     * @param {number} options.alpha - 估计的水印透明度 0-1
     * @param {{r,g,b}} options.watermarkColor - 估计的水印颜色
     * @param {number} options.radius - 背景采样半径（默认5）
     * @param {number} options.iterations - 迭代次数（默认3）
     * @param {function} options.onProgress - 进度回调 (0-1)
     */
    inpaint(imageData, mask, options = {}) {
        const alpha = Math.max(0.01, Math.min(0.99, options.alpha || 0.5));
        const wmR = options.watermarkColor ? options.watermarkColor.r : 255;
        const wmG = options.watermarkColor ? options.watermarkColor.g : 255;
        const wmB = options.watermarkColor ? options.watermarkColor.b : 255;
        const radius = options.radius || 5;
        const iterations = options.iterations || 3;
        const onProgress = options.onProgress || (() => {});

        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const utils = InpaintUtils;

        // 维护动态 known 数组
        const known = new Uint8Array(width * height);
        for (let i = 0; i < known.length; i++) {
            known[i] = mask[i] > 0 ? 0 : 1;
        }

        // 预计算 1/(1-alpha)
        const invAlpha = 1 / (1 - alpha);

        for (let iter = 0; iter < iterations; iter++) {
            // 计算填充顺序（从边界到内部）
            const distances = this._computeDistances(mask, known, width, height);
            const order = this._getFillOrder(distances, width, height);

            const total = order.length;
            const batchSize = Math.max(1, Math.floor(total / 50));

            for (let i = 0; i < total; i++) {
                const { x, y } = order[i];

                // 先用周围已知像素估算背景色
                const bg = this._sampleBackground(data, width, height, x, y, known, radius);

                if (bg) {
                    // 反推原图：原图 = (观察值 - 水印色 × α) / (1-α)
                    // 但观察值 = 原图 × (1-α) + 水印色 × α
                    // 如果用估算背景代替原图，则：
                    // 修正值 = 背景估算 + (观察值 - (背景估算 × (1-α) + 水印色 × α)) / (1-α) × 混合
                    // 简化：直接用反推公式
                    const idx = (y * width + x) * 4;
                    const obsR = data[idx];
                    const obsG = data[idx + 1];
                    const obsB = data[idx + 2];

                    // 反推原图颜色
                    let origR = (obsR - wmR * alpha) * invAlpha;
                    let origG = (obsG - wmG * alpha) * invAlpha;
                    let origB = (obsB - wmB * alpha) * invAlpha;

                    // 与背景估算做加权混合（70% 反推 + 30% 背景），提高稳定性
                    origR = origR * 0.7 + bg.r * 0.3;
                    origG = origG * 0.7 + bg.g * 0.3;
                    origB = origB * 0.7 + bg.b * 0.3;

                    // 钳制到有效范围
                    data[idx] = Math.max(0, Math.min(255, Math.round(origR)));
                    data[idx + 1] = Math.max(0, Math.min(255, Math.round(origG)));
                    data[idx + 2] = Math.max(0, Math.min(255, Math.round(origB)));
                    data[idx + 3] = 255;

                    known[y * width + x] = 1;
                }

                if (i % batchSize === 0) {
                    onProgress((iter + i / total) / iterations);
                }
            }
        }

        // 边界羽化
        const feathered = utils.featherMaskEdges(data, width, height, mask, 1);
        for (let i = 0; i < feathered.length; i++) {
            data[i] = feathered[i];
        }

        onProgress(1);
        return imageData;
    },

    /**
     * 计算每个未知像素到最近已知像素的距离（BFS）
     */
    _computeDistances(mask, known, width, height) {
        const distances = new Float32Array(width * height);
        distances.fill(Infinity);

        const queue = [];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (known[idx] > 0) {
                    distances[idx] = 0;
                } else if (mask[idx] > 0) {
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
     * 从周围已知像素采样背景颜色（高斯加权）
     */
    _sampleBackground(data, width, height, x, y, known, radius) {
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
            return {
                r: r / totalWeight,
                g: g / totalWeight,
                b: b / totalWeight
            };
        }
        return null;
    },

    /**
     * 从 mask 区域采样平均颜色（用于自动估计水印颜色）
     * @param {Uint8ClampedArray} data
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} mask
     * @returns {{r,g,b}}
     */
    estimateWatermarkColor(data, width, height, mask) {
        let r = 0, g = 0, b = 0, count = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x] > 0) {
                    const idx = (y * width + x) * 4;
                    r += data[idx];
                    g += data[idx + 1];
                    b += data[idx + 2];
                    count++;
                }
            }
        }

        if (count === 0) return { r: 255, g: 255, b: 255 };

        return {
            r: Math.round(r / count),
            g: Math.round(g / count),
            b: Math.round(b / count)
        };
    }
};
