/**
 * file.js — 文件上传与下载工具
 */

const FileHandler = {
    MAX_SIZE: 20 * 1024 * 1024, // 20MB
    ACCEPTED_TYPES: ['image/jpeg', 'image/png', 'image/webp'],

    /**
     * 从 File 对象加载图片
     * @param {File} file
     * @returns {Promise<HTMLImageElement>}
     */
    loadImage(file) {
        return new Promise((resolve, reject) => {
            if (!this.ACCEPTED_TYPES.includes(file.type)) {
                reject(new Error('不支持的文件格式，请上传 JPG/PNG/WebP 图片'));
                return;
            }
            if (file.size > this.MAX_SIZE) {
                reject(new Error('文件过大，请上传 20MB 以内的图片'));
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsDataURL(file);
        });
    },

    /**
     * 将 Canvas 导出为文件并触发下载
     * @param {HTMLCanvasElement} canvas
     * @param {string} filename
     * @param {string} format - 'png' | 'jpeg'
     * @param {number} quality - JPEG 质量 0-1
     */
    downloadCanvas(canvas, filename, format = 'png', quality = 0.95) {
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : 'png';

        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, mime, quality);
    },

    /**
     * 将 Canvas 转为 dataURL
     * @param {HTMLCanvasElement} canvas
     * @param {string} format
     * @param {number} quality
     * @returns {string}
     */
    canvasToDataURL(canvas, format = 'png', quality = 0.95) {
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        return canvas.toDataURL(mime, quality);
    },

    /**
     * 生成带时间戳的文件名
     * @param {string} prefix
     * @returns {string}
     */
    generateFilename(prefix = 'watermark-removed') {
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        return `${prefix}_${ts}`;
    }
};
