/**
 * inpaint/patch-match.js — 简化版 PatchMatch 纹理合成（高质量模式）
 *
 * 原理：为每个需要修复的像素寻找图片中其他位置最相似的 patch，
 * 用该 patch 的颜色来填充。通过"随机初始化 + 迭代传播 + 随机搜索"
 * 三个步骤高效地找到近似最优解。
 *
 * 算法步骤：
 * 1. 随机初始化：为每个 mask 像素随机分配一个偏移量（指向非 mask 区域）
 * 2. 迭代传播：检查左/上（或右/下）邻居的偏移量是否更优，如果是则采用
 * 3. 随机搜索：以当前最佳偏移为中心，按递减半径随机搜索更优解
 * 4. 重复 2-3 多轮
 * 5. 用最佳偏移填充 mask 区域
 *
 * 适合有纹理的背景（草地、墙面、天空、布料等）
 */

const PatchMatch = {
    /**
     * 执行 PatchMatch 纹理合成
     * @param {ImageData} imageData
     * @param {Uint8Array} mask - 1=需要修复
     * @param {object} options
     * @param {number} options.patchRadius - patch 半径（默认3）
     * @param {number} options.iterations - 迭代次数（默认4）
     * @param {function} options.onProgress - 进度回调 (0-1)
     */
    inpaint(imageData, mask, options = {}) {
        const patchRadius = options.patchRadius || 3;
        const iterations = options.iterations || 4;
        const onProgress = options.onProgress || (() => {});

        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const utils = InpaintUtils;

        // 膨胀 mask 1 像素
        const dilatedMask = utils.dilateMask(mask, width, height, 1);

        // ★ 动态 known 数组：已填充像素也视为已知
        const known = new Uint8Array(width * height);
        for (let i = 0; i < known.length; i++) {
            known[i] = dilatedMask[i] > 0 ? 0 : 1;
        }

        // 获取 mask 包围盒，缩小搜索范围
        const bbox = utils.getMaskBoundingBox(dilatedMask, width, height);
        if (!bbox) {
            onProgress(1);
            return imageData;
        }

        // 扩展包围盒，给 patch 匹配留余量
        const searchPad = patchRadius * 3;
        const minX = Math.max(0, bbox.minX - searchPad);
        const minY = Math.max(0, bbox.minY - searchPad);
        const maxX = Math.min(width - 1, bbox.maxX + searchPad);
        const maxY = Math.min(height - 1, bbox.maxY + searchPad);

        // 收集 mask 像素列表
        const maskPixels = [];
        for (let y = bbox.minY; y <= bbox.maxY; y++) {
            for (let x = bbox.minX; x <= bbox.maxX; x++) {
                if (dilatedMask[y * width + x] > 0) {
                    maskPixels.push({ x, y });
                }
            }
        }

        if (maskPixels.length === 0) {
            onProgress(1);
            return imageData;
        }

        // 初始化偏移场：offsetX[idx], offsetY[idx] 存储每个 mask 像素的最佳匹配偏移
        const numPixels = maskPixels.length;
        const offsetX = new Int32Array(numPixels);
        const offsetY = new Int32Array(numPixels);
        const errors = new Float32Array(numPixels);

        // 步骤1：随机初始化
        for (let i = 0; i < numPixels; i++) {
            const { x, y } = maskPixels[i];
            let bestOX = 0, bestOY = 0, bestErr = Infinity;

            // 尝试随机偏移，选一个合理的初始值
            for (let attempt = 0; attempt < 5; attempt++) {
                const ox = Math.floor(Math.random() * (maxX - minX + 1)) + minX - x;
                const oy = Math.floor(Math.random() * (maxY - minY + 1)) + minY - y;
                const sx = x + ox;
                const sy = y + oy;

                if (!utils.inBounds(sx, sy, width, height)) continue;
                if (dilatedMask[sy * width + sx] > 0) continue;

                const err = utils.patchSSD(data, width, height, x, y, sx, sy, patchRadius, dilatedMask);
                if (err < bestErr) {
                    bestErr = err;
                    bestOX = ox;
                    bestOY = oy;
                }
            }

            offsetX[i] = bestOX;
            offsetY[i] = bestOY;
            errors[i] = bestErr;
        }

        // 构建 pixel → index 映射（用于传播阶段查找邻居）
        const pixelToIndex = new Map();
        for (let i = 0; i < numPixels; i++) {
            pixelToIndex.set(maskPixels[i].y * width + maskPixels[i].x, i);
        }

        // 步骤2-3：迭代传播 + 随机搜索
        for (let iter = 0; iter < iterations; iter++) {
            const forward = iter % 2 === 0;

            const order = forward ? maskPixels : maskPixels.slice().reverse();

            for (let i = 0; i < order.length; i++) {
                const { x, y } = order[i];
                const idx = pixelToIndex.get(y * width + x);

                // 传播：检查邻居的偏移是否更优
                const neighbors = forward
                    ? [[x - 1, y], [x, y - 1]]
                    : [[x + 1, y], [x, y + 1]];

                for (const [nx, ny] of neighbors) {
                    const nKey = ny * width + nx;
                    if (!pixelToIndex.has(nKey)) continue;

                    const nIdx = pixelToIndex.get(nKey);
                    const candidateOX = offsetX[nIdx];
                    const candidateOY = offsetY[nIdx];
                    const sx = x + candidateOX;
                    const sy = y + candidateOY;

                    if (!utils.inBounds(sx, sy, width, height)) continue;
                    if (dilatedMask[sy * width + sx] > 0) continue;

                    const err = utils.patchSSD(data, width, height, x, y, sx, sy, patchRadius, dilatedMask);
                    if (err < errors[idx]) {
                        errors[idx] = err;
                        offsetX[idx] = candidateOX;
                        offsetY[idx] = candidateOY;
                    }
                }

                // 随机搜索：以当前最佳偏移为中心，递减半径搜索
                let searchRadius = Math.max(width, height);
                const alpha = 0.5;

                while (searchRadius > 1) {
                    const cx = x + offsetX[idx];
                    const cy = y + offsetY[idx];

                    const rx = cx + Math.floor((Math.random() * 2 - 1) * searchRadius);
                    const ry = cy + Math.floor((Math.random() * 2 - 1) * searchRadius);

                    if (utils.inBounds(rx, ry, width, height) && dilatedMask[ry * width + rx] === 0) {
                        const err = utils.patchSSD(data, width, height, x, y, rx, ry, patchRadius, dilatedMask);
                        if (err < errors[idx]) {
                            errors[idx] = err;
                            offsetX[idx] = rx - x;
                            offsetY[idx] = ry - y;
                        }
                    }

                    searchRadius *= alpha;
                }

                if (i % 200 === 0) {
                    onProgress((iter + i / order.length) / iterations);
                }
            }
        }

        // 步骤4：用最佳偏移填充 mask 区域，并更新 known
        for (let i = 0; i < numPixels; i++) {
            const { x, y } = maskPixels[i];
            const sx = x + offsetX[i];
            const sy = y + offsetY[i];

            if (utils.inBounds(sx, sy, width, height)) {
                const srcIdx = (sy * width + sx) * 4;
                const dstIdx = (y * width + x) * 4;
                data[dstIdx] = data[srcIdx];
                data[dstIdx + 1] = data[srcIdx + 1];
                data[dstIdx + 2] = data[srcIdx + 2];
                data[dstIdx + 3] = 255;
                // ★ 标记为已知，后续迭代可参与匹配
                known[y * width + x] = 1;
            }
        }

        // 边缘平滑过渡
        const smoothed = utils.boxBlur(data, width, height, dilatedMask, 1);
        for (let i = 0; i < smoothed.length; i++) {
            if (dilatedMask[Math.floor(i / 4)] > 0) {
                data[i] = smoothed[i];
            }
        }

        onProgress(1);
        return imageData;
    }
};
