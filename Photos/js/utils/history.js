/**
 * history.js — 撤销/重做操作栈
 * 每个快照保存当前 Canvas 的 ImageData 和 mask 的副本
 */

class HistoryManager {
    constructor(maxSize = 30) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxSize = maxSize;
    }

    /**
     * 保存当前状态快照
     * @param {ImageData} imageData - Canvas 像素数据
     * @param {Uint8Array} mask - 水印区域 mask
     */
    push(imageData, mask) {
        const snapshot = {
            imageData: this._cloneImageData(imageData),
            mask: mask ? new Uint8Array(mask) : null
        };
        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    /**
     * 撤销：弹出当前状态，返回上一个状态
     * @returns {snapshot|null}
     */
    undo() {
        if (this.undoStack.length <= 1) return null;
        const current = this.undoStack.pop();
        this.redoStack.push(current);
        return this.undoStack[this.undoStack.length - 1];
    }

    /**
     * 重做：从 redoStack 恢复
     * @returns {snapshot|null}
     */
    redo() {
        if (this.redoStack.length === 0) return null;
        const snapshot = this.redoStack.pop();
        this.undoStack.push(snapshot);
        return snapshot;
    }

    canUndo() {
        return this.undoStack.length > 1;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }

    _cloneImageData(imageData) {
        const clone = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );
        return clone;
    }
}
