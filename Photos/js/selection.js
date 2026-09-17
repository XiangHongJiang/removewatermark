/**
 * selection.js — 区域选择交互（矩形框选 + 画笔涂抹 + 多边形套索）
 * 维护 mask: Uint8Array（与图片同尺寸，1=水印区域，0=正常）
 */

const SelectionManager = {
    mode: 'rect',          // 'rect' | 'brush' | 'lasso'
    mask: null,            // Uint8Array
    maskWidth: 0,
    maskHeight: 0,
    brushSize: 20,

    isDrawing: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,

    // 套索模式：多边形顶点列表
    lassoPoints: [],       // [{x, y}, ...]
    lassoClosed: false,

    // 回调
    onSelectionChange: null,
    onBrushDraw: null,

    /**
     * 初始化
     * @param {number} width - 图片宽度
     * @param {number} height - 图片高度
     */
    init(width, height) {
        this.maskWidth = width;
        this.maskHeight = height;
        this.mask = new Uint8Array(width * height);
        this.isDrawing = false;
        this.lassoPoints = [];
        this.lassoClosed = false;
    },

    /**
     * 设置选择模式
     * @param {string} mode - 'rect' | 'brush'
     */
    setMode(mode) {
        this.mode = mode;
    },

    /**
     * 设置画笔大小
     * @param {number} size
     */
    setBrushSize(size) {
        this.brushSize = size;
    },

    /**
     * 开始绘制
     * @param {number} imgX - 图片坐标 x
     * @param {number} imgY - 图片坐标 y
     */
    startDraw(imgX, imgY) {
        // 套索模式：点击添加顶点
        if (this.mode === 'lasso') {
            // 如果已闭合，开始新的多边形
            if (this.lassoClosed) {
                this.lassoPoints = [];
                this.lassoClosed = false;
            }
            this.lassoPoints.push({ x: imgX, y: imgY });
            this.isDrawing = true;
            return;
        }

        this.isDrawing = true;
        this.startX = imgX;
        this.startY = imgY;
        this.lastX = imgX;
        this.lastY = imgY;

        if (this.mode === 'brush') {
            this._drawBrushAt(imgX, imgY);
        }
    },

    /**
     * 绘制中（鼠标移动）
     * @param {number} imgX
     * @param {number} imgY
     * @returns {{type: string, x1, y1, x2, y2}|null} - 实时绘制信息
     */
    moveDraw(imgX, imgY) {
        if (!this.isDrawing) return null;

        if (this.mode === 'rect') {
            return {
                type: 'rect',
                x1: this.startX,
                y1: this.startY,
                x2: imgX,
                y2: imgY
            };
        } else if (this.mode === 'brush') {
            // 在两点之间插值绘制，避免快速移动时出现间隙
            this._drawBrushLine(this.lastX, this.lastY, imgX, imgY);
            this.lastX = imgX;
            this.lastY = imgY;
            return {
                type: 'brush',
                x: imgX,
                y: imgY,
                radius: this.brushSize
            };
        } else if (this.mode === 'lasso') {
            // 套索模式：返回顶点列表 + 当前鼠标位置用于预览
            return {
                type: 'lasso',
                points: this.lassoPoints.slice(),
                currentX: imgX,
                currentY: imgY,
                closed: this.lassoClosed
            };
        }
        return null;
    },

    /**
     * 结束绘制
     * @param {number} imgX
     * @param {number} imgY
     * @returns {boolean} - 是否产生了新的选区
     */
    endDraw(imgX, imgY) {
        if (!this.isDrawing) return false;

        // 套索模式：不在此处结束（需要双击/回车闭合）
        if (this.mode === 'lasso') {
            return false;
        }

        this.isDrawing = false;

        if (this.mode === 'rect') {
            const x1 = Math.min(this.startX, imgX);
            const y1 = Math.min(this.startY, imgY);
            const x2 = Math.max(this.startX, imgX);
            const y2 = Math.max(this.startY, imgY);

            // 忽略过小的选区（误触）
            if (x2 - x1 < 2 || y2 - y1 < 2) return false;

            this._fillRect(x1, y1, x2, y2);
            return true;
        }

        return true;
    },

    /**
     * 套索模式：闭合多边形并填充 mask
     * @returns {boolean} - 是否成功闭合
     */
    closeLasso() {
        if (this.mode !== 'lasso' || this.lassoPoints.length < 3) {
            this.lassoPoints = [];
            this.lassoClosed = false;
            this.isDrawing = false;
            return false;
        }

        this._fillPolygon(this.lassoPoints);
        this.lassoClosed = true;
        this.isDrawing = false;
        return true;
    },

    /**
     * 套索模式：取消当前绘制
     */
    cancelLasso() {
        this.lassoPoints = [];
        this.lassoClosed = false;
        this.isDrawing = false;
    },

    /**
     * 矩形区域填充 mask
     */
    _fillRect(x1, y1, x2, y2) {
        x1 = Math.max(0, Math.floor(x1));
        y1 = Math.max(0, Math.floor(y1));
        x2 = Math.min(this.maskWidth, Math.ceil(x2));
        y2 = Math.min(this.maskHeight, Math.ceil(y2));

        for (let y = y1; y < y2; y++) {
            const rowStart = y * this.maskWidth;
            for (let x = x1; x < x2; x++) {
                this.mask[rowStart + x] = 1;
            }
        }
    },

    /**
     * 在指定位置画一个圆形画笔
     */
    _drawBrushAt(cx, cy) {
        const r = this.brushSize;
        const r2 = r * r;
        const x1 = Math.max(0, Math.floor(cx - r));
        const y1 = Math.max(0, Math.floor(cy - r));
        const x2 = Math.min(this.maskWidth, Math.ceil(cx + r));
        const y2 = Math.min(this.maskHeight, Math.ceil(cy + r));

        for (let y = y1; y < y2; y++) {
            const dy = y - cy;
            const rowStart = y * this.maskWidth;
            for (let x = x1; x < x2; x++) {
                const dx = x - cx;
                if (dx * dx + dy * dy <= r2) {
                    this.mask[rowStart + x] = 1;
                }
            }
        }
    },

    /**
     * 在两点之间插值画笔
     */
    _drawBrushLine(x1, y1, x2, y2) {
        const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const steps = Math.max(1, Math.ceil(dist / (this.brushSize / 3)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            this._drawBrushAt(x, y);
        }
    },

    /**
     * 多边形填充（扫描线算法）
     * @param {Array<{x,y}>} points
     */
    _fillPolygon(points) {
        if (points.length < 3) return;

        const w = this.maskWidth;
        const h = this.maskHeight;

        // 找到 y 范围
        let minY = Infinity, maxY = -Infinity;
        for (const p of points) {
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        minY = Math.max(0, Math.floor(minY));
        maxY = Math.min(h - 1, Math.ceil(maxY));

        // 对每条扫描线
        for (let y = minY; y <= maxY; y++) {
            const intersections = [];
            const n = points.length;

            for (let i = 0; i < n; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % n];

                // 检查边是否与扫描线相交
                if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
                    const t = (y - p1.y) / (p2.y - p1.y);
                    const x = p1.x + t * (p2.x - p1.x);
                    intersections.push(x);
                }
            }

            // 排序交点
            intersections.sort((a, b) => a - b);

            // 填充交点对之间的像素
            for (let i = 0; i < intersections.length; i += 2) {
                const x1 = Math.max(0, Math.floor(intersections[i]));
                const x2 = Math.min(w - 1, Math.ceil(intersections[i + 1]));
                for (let x = x1; x <= x2; x++) {
                    this.mask[y * w + x] = 1;
                }
            }
        }
    },

    /**
     * 清除所有选区
     */
    clear() {
        if (this.mask) {
            this.mask.fill(0);
        }
        this.lassoPoints = [];
        this.lassoClosed = false;
    },

    /**
     * 获取 mask 副本
     * @returns {Uint8Array}
     */
    getMaskCopy() {
        return new Uint8Array(this.mask);
    },

    /**
     * 恢复 mask（用于撤销/重做）
     * @param {Uint8Array} mask
     */
    setMask(mask) {
        this.mask = new Uint8Array(mask);
    },

    /**
     * 检查是否有选区
     * @returns {boolean}
     */
    hasSelection() {
        for (let i = 0; i < this.mask.length; i++) {
            if (this.mask[i] > 0) return true;
        }
        return false;
    },

    /**
     * 获取选区像素数量
     * @returns {number}
     */
    getSelectionCount() {
        let count = 0;
        for (let i = 0; i < this.mask.length; i++) {
            if (this.mask[i] > 0) count++;
        }
        return count;
    }
};
