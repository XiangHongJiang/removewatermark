/**
 * selection.js — 区域选择交互（矩形框选 + 画笔涂抹）
 * 维护 mask: Uint8Array（与图片同尺寸，1=水印区域，0=正常）
 */

const SelectionManager = {
    mode: 'rect',          // 'rect' | 'brush'
    mask: null,            // Uint8Array
    maskWidth: 0,
    maskHeight: 0,
    brushSize: 20,

    isDrawing: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,

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
     * 清除所有选区
     */
    clear() {
        if (this.mask) {
            this.mask.fill(0);
        }
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
