/**
 * canvas.js — Canvas 渲染与坐标转换管理
 * 维护两个 Canvas：main-canvas（图片）+ overlay-canvas（选区叠加层）
 */

const CanvasManager = {
    mainCanvas: null,
    overlayCanvas: null,
    mainCtx: null,
    overlayCtx: null,
    container: null,

    imgWidth: 0,
    imgHeight: 0,
    scale: 1,
    minScale: 0.1,
    maxScale: 10,
    offsetX: 0,
    offsetY: 0,

    // 平移状态
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    panStartScrollX: 0,
    panStartScrollY: 0,

    /**
     * 初始化 Canvas
     */
    init() {
        this.container = document.getElementById('canvas-container');
        this.mainCanvas = document.getElementById('main-canvas');
        this.overlayCanvas = document.getElementById('overlay-canvas');
        this.mainCtx = this.mainCanvas.getContext('2d', { willReadFrequently: true });
        this.overlayCtx = this.overlayCanvas.getContext('2d');
    },

    /**
     * 加载图片到 Canvas，自动适配容器尺寸
     * @param {HTMLImageElement} img
     */
    loadImage(img) {
        this.imgWidth = img.width;
        this.imgHeight = img.height;

        // 计算适配容器的缩放比例
        this._fitToContainer();

        // 设置 Canvas 尺寸为图片原始尺寸（处理用），CSS 尺寸为显示尺寸
        this.mainCanvas.width = img.width;
        this.mainCanvas.height = img.height;

        this.overlayCanvas.width = img.width;
        this.overlayCanvas.height = img.height;

        this._applyDisplaySize();

        // 绘制图片
        this.mainCtx.drawImage(img, 0, 0);
    },

    /**
     * 计算适配容器的缩放比例
     * 小图片会放大到至少占容器 70% 或最小操作尺寸 300px
     */
    _fitToContainer() {
        const containerRect = this.container.getBoundingClientRect();
        const maxW = containerRect.width - 20;
        const maxH = containerRect.height - 20;

        // 适配容器的比例（不限制上限，允许放大小图片）
        const fitScale = Math.min(maxW / this.imgWidth, maxH / this.imgHeight);

        // 对于小图片：确保显示尺寸至少 300px（较短边）
        const minDisplaySize = 300;
        const minScaleForDisplay = minDisplaySize / Math.min(this.imgWidth, this.imgHeight);

        // 取两者中较大的，但不超过 maxScale
        this.scale = Math.min(Math.max(fitScale, minScaleForDisplay), this.maxScale);
        if (this.scale < this.minScale) this.scale = this.minScale;
    },

    /**
     * 将当前 scale 应用到 Canvas 的 CSS 显示尺寸
     */
    _applyDisplaySize() {
        const displayW = Math.round(this.imgWidth * this.scale);
        const displayH = Math.round(this.imgHeight * this.scale);
        this.mainCanvas.style.width = displayW + 'px';
        this.mainCanvas.style.height = displayH + 'px';
        this.overlayCanvas.style.width = displayW + 'px';
        this.overlayCanvas.style.height = displayH + 'px';
    },

    /**
     * 缩放（以鼠标位置为中心）
     * @param {number} factor - 缩放因子（>1 放大, <1 缩小）
     * @param {number} centerX - 鼠标在容器中的 x（可选）
     * @param {number} centerY - 鼠标在容器中的 y（可选）
     */
    zoom(factor, centerX, centerY) {
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
        if (newScale === this.scale) return;

        // 如果有鼠标位置，以鼠标为中心缩放（调整滚动位置）
        if (centerX !== undefined && centerY !== undefined) {
            const imgPos = this.screenToImage(centerX, centerY);
            this.scale = newScale;
            this._applyDisplaySize();
            // 调整滚动使鼠标位置对应同一图片像素
            const newScreenX = this.container.scrollLeft + (centerX - this.container.getBoundingClientRect().left);
            const newScreenY = this.container.scrollTop + (centerY - this.container.getBoundingClientRect().top);
            // 简化：保持鼠标指向的图片像素不变
            const canvasRect = this.mainCanvas.getBoundingClientRect();
            const targetScreenX = imgPos.x * this.scale + canvasRect.left - this.container.getBoundingClientRect().left;
            const targetScreenY = imgPos.y * this.scale + canvasRect.top - this.container.getBoundingClientRect().top;
            this.container.scrollLeft += (targetScreenX - (newScreenX - this.container.scrollLeft));
            this.container.scrollTop += (targetScreenY - (newScreenY - this.container.scrollTop));
        } else {
            this.scale = newScale;
            this._applyDisplaySize();
        }
    },

    /**
     * 缩放到指定比例
     * @param {number} scale
     */
    zoomTo(scale) {
        this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
        this._applyDisplaySize();
    },

    /**
     * 适配容器（重置缩放）
     */
    fitToScreen() {
        this._fitToContainer();
        this._applyDisplaySize();
        this.container.scrollLeft = 0;
        this.container.scrollTop = 0;
    },

    /**
     * 获取当前缩放比例
     * @returns {number}
     */
    getScale() {
        return this.scale;
    },

    /**
     * 获取当前画布的 ImageData（原始分辨率）
     * @returns {ImageData}
     */
    getImageData() {
        return this.mainCtx.getImageData(0, 0, this.imgWidth, this.imgHeight);
    },

    /**
     * 将 ImageData 写入主 Canvas
     * @param {ImageData} imageData
     */
    putImageData(imageData) {
        this.mainCtx.putImageData(imageData, 0, 0);
    },

    /**
     * 屏幕坐标 → Canvas 图片像素坐标
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{x: number, y: number}}
     */
    screenToImage(clientX, clientY) {
        const rect = this.mainCanvas.getBoundingClientRect();
        const x = (clientX - rect.left) / this.scale;
        const y = (clientY - rect.top) / this.scale;
        return {
            x: Math.round(x),
            y: Math.round(y)
        };
    },

    /**
     * 清除 overlay 画布
     */
    clearOverlay() {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    },

    /**
     * 在 overlay 上绘制 mask（半透明红色）
     * @param {Uint8Array} mask
     */
    drawMask(mask) {
        this.clearOverlay();
        const ctx = this.overlayCtx;
        const w = this.imgWidth;
        const h = this.imgHeight;

        const overlayData = ctx.createImageData(w, h);
        const data = overlayData.data;

        for (let i = 0; i < mask.length; i++) {
            if (mask[i] > 0) {
                const idx = i * 4;
                data[idx] = 255;       // R
                data[idx + 1] = 50;    // G
                data[idx + 2] = 50;    // B
                data[idx + 3] = 140;   // A (半透明)
            }
        }

        ctx.putImageData(overlayData, 0, 0);
    },

    /**
     * 在 overlay 上绘制矩形选区（实时拖拽时）
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     */
    drawRect(x1, y1, x2, y2) {
        const ctx = this.overlayCtx;
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
        ctx.lineWidth = 2 / this.scale;
        ctx.setLineDash([6 / this.scale, 4 / this.scale]);
        ctx.strokeRect(
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.abs(x2 - x1),
            Math.abs(y2 - y1)
        );
        ctx.setLineDash([]);
    },

    /**
     * 开始平移（记录起始位置）
     * @param {number} clientX
     * @param {number} clientY
     */
    startPan(clientX, clientY) {
        this.isPanning = true;
        this.panStartX = clientX;
        this.panStartY = clientY;
        this.panStartScrollX = this.container.scrollLeft;
        this.panStartScrollY = this.container.scrollTop;
    },

    /**
     * 平移中
     * @param {number} clientX
     * @param {number} clientY
     */
    movePan(clientX, clientY) {
        if (!this.isPanning) return;
        this.container.scrollLeft = this.panStartScrollX - (clientX - this.panStartX);
        this.container.scrollTop = this.panStartScrollY - (clientY - this.panStartY);
    },

    /**
     * 结束平移
     */
    endPan() {
        this.isPanning = false;
    },

    /**
     * 在 overlay 上绘制画笔圆圈（实时涂抹时）
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     */
    drawBrushCursor(x, y, radius) {
        const ctx = this.overlayCtx;
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
        ctx.lineWidth = 1.5 / this.scale;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
    },

    /**
     * 获取主 Canvas 的 dataURL（用于对比/下载）
     * @param {string} format
     * @param {number} quality
     * @returns {string}
     */
    toDataURL(format = 'png', quality = 0.95) {
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        return this.mainCanvas.toDataURL(mime, quality);
    },

    /**
     * 获取原始图片尺寸
     * @returns {{width: number, height: number}}
     */
    getImageSize() {
        return { width: this.imgWidth, height: this.imgHeight };
    }
};
