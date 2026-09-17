/**
 * app.js — 主应用逻辑 & 状态管理
 *
 * 状态机: idle → imageLoaded → selecting → processing → done
 */

const App = {
    state: 'idle',          // idle | imageLoaded | selecting | processing | done
    originalImageData: null, // 原始图片数据（用于对比和重置）
    beforeImageData: null,   // 处理前的图片数据（用于对比）
    history: null,           // HistoryManager 实例

    // DOM 引用
    dom: {},

    /**
     * 初始化应用
     */
    init() {
        this._cacheDOM();
        this._bindEvents();
        this.history = new HistoryManager(30);
        CanvasManager.init();
    },

    /**
     * 缓存 DOM 引用
     */
    _cacheDOM() {
        this.dom = {
            uploadZone: document.getElementById('upload-zone'),
            fileInput: document.getElementById('file-input'),
            editor: document.getElementById('editor'),
            canvasContainer: document.getElementById('canvas-container'),
            overlayCanvas: document.getElementById('overlay-canvas'),
            canvasHint: document.getElementById('canvas-hint'),

            // 工具按钮
            toolRect: document.getElementById('tool-rect'),
            toolBrush: document.getElementById('tool-brush'),
            toolLasso: document.getElementById('tool-lasso'),
            brushSizeGroup: document.getElementById('brush-size-group'),
            brushSize: document.getElementById('brush-size'),
            brushSizeValue: document.getElementById('brush-size-value'),
            algoSelect: document.getElementById('algo-select'),
            strengthSlider: document.getElementById('strength-slider'),
            strengthValue: document.getElementById('strength-value'),

            // 半透明水印还原
            transparencyGroup: document.getElementById('transparency-group'),
            watermarkColor: document.getElementById('watermark-color'),
            btnSampleColor: document.getElementById('btn-sample-color'),
            alphaSlider: document.getElementById('alpha-slider'),
            alphaValue: document.getElementById('alpha-value'),
            btnUndo: document.getElementById('btn-undo'),
            btnRedo: document.getElementById('btn-redo'),
            btnClearSelection: document.getElementById('btn-clear-selection'),
            btnProcess: document.getElementById('btn-process'),
            btnReset: document.getElementById('btn-reset'),

            // 缩放控制
            btnZoomIn: document.getElementById('btn-zoom-in'),
            btnZoomOut: document.getElementById('btn-zoom-out'),
            btnZoomFit: document.getElementById('btn-zoom-fit'),
            zoomLevel: document.getElementById('zoom-level'),

            // 底部栏
            statusText: document.getElementById('status-text'),
            btnCompare: document.getElementById('btn-compare'),
            btnDownload: document.getElementById('btn-download'),

            // 对比弹窗
            compareModal: document.getElementById('compare-modal'),
            compareContainer: document.getElementById('compare-container'),
            compareBefore: document.getElementById('compare-before'),
            compareAfter: document.getElementById('compare-after'),
            compareBeforeWrapper: document.getElementById('compare-before-wrapper'),
            compareDivider: document.getElementById('compare-divider'),
            btnCloseCompare: document.getElementById('btn-close-compare'),

            // 处理遮罩
            processingOverlay: document.getElementById('processing-overlay'),
            processingText: document.getElementById('processing-text')
        };
    },

    /**
     * 绑定事件
     */
    _bindEvents() {
        // 上传
        this.dom.uploadZone.addEventListener('click', () => this.dom.fileInput.click());
        this.dom.fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) this._handleFile(e.target.files[0]);
        });
        this.dom.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dom.uploadZone.classList.add('dragover');
        });
        this.dom.uploadZone.addEventListener('dragleave', () => {
            this.dom.uploadZone.classList.remove('dragover');
        });
        this.dom.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dom.uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files[0]) this._handleFile(e.dataTransfer.files[0]);
        });

        // 工具切换
        this.dom.toolRect.addEventListener('click', () => this._setTool('rect'));
        this.dom.toolBrush.addEventListener('click', () => this._setTool('brush'));
        this.dom.toolLasso.addEventListener('click', () => this._setTool('lasso'));

        // 画笔大小
        this.dom.brushSize.addEventListener('input', (e) => {
            const size = parseInt(e.target.value);
            SelectionManager.setBrushSize(size);
            this.dom.brushSizeValue.textContent = size;
        });

        // 强度滑块
        this.dom.strengthSlider.addEventListener('input', (e) => {
            this.dom.strengthValue.textContent = e.target.value;
        });

        // 算法切换：显示/隐藏半透明参数
        this.dom.algoSelect.addEventListener('change', (e) => {
            const isTransparency = e.target.value === 'transparency';
            this.dom.transparencyGroup.style.display = isTransparency ? 'flex' : 'none';
            // 半透明模式自动切换到套索工具
            if (isTransparency && SelectionManager.mode === 'rect') {
                this._setTool('lasso');
            }
        });

        // 透明度滑块
        this.dom.alphaSlider.addEventListener('input', (e) => {
            this.dom.alphaValue.textContent = e.target.value;
        });

        // 采样水印颜色
        this.dom.btnSampleColor.addEventListener('click', () => this._sampleWatermarkColor());

        // 套索双击闭合
        this.dom.overlayCanvas.addEventListener('dblclick', (e) => {
            if (SelectionManager.mode !== 'lasso') return;
            this._closeLasso();
        });

        // 撤销/重做/清除
        this.dom.btnUndo.addEventListener('click', () => this._undo());
        this.dom.btnRedo.addEventListener('click', () => this._redo());
        this.dom.btnClearSelection.addEventListener('click', () => this._clearSelection());

        // 处理
        this.dom.btnProcess.addEventListener('click', () => this._process());

        // 重新上传
        this.dom.btnReset.addEventListener('click', () => this._reset());

        // 缩放控制
        this.dom.btnZoomIn.addEventListener('click', () => {
            CanvasManager.zoom(1.25);
            this._updateZoomDisplay();
        });
        this.dom.btnZoomOut.addEventListener('click', () => {
            CanvasManager.zoom(1 / 1.25);
            this._updateZoomDisplay();
        });
        this.dom.btnZoomFit.addEventListener('click', () => {
            CanvasManager.fitToScreen();
            this._updateZoomDisplay();
        });

        // 滚轮缩放
        this.dom.canvasContainer.addEventListener('wheel', (e) => {
            if (this.state === 'idle' || this.state === 'processing') return;
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const rect = this.dom.canvasContainer.getBoundingClientRect();
            CanvasManager.zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
            this._updateZoomDisplay();
        }, { passive: false });

        // 空格平移
        this.spaceDown = false;
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && this.state !== 'idle' && this.state !== 'processing') {
                e.preventDefault();
                this.spaceDown = true;
                this.dom.overlayCanvas.style.cursor = 'grab';
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.spaceDown = false;
                this.dom.overlayCanvas.style.cursor = this._currentCursor();
            }
        });

        // 下载
        this.dom.btnDownload.addEventListener('click', () => this._download());

        // 对比
        this.dom.btnCompare.addEventListener('click', () => this._showCompare());
        this.dom.btnCloseCompare.addEventListener('click', () => this._hideCompare());

        // Canvas 交互
        this.dom.overlayCanvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.dom.overlayCanvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.dom.overlayCanvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.dom.overlayCanvas.addEventListener('mouseleave', (e) => this._onMouseUp(e));

        // 触摸事件
        this.dom.overlayCanvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        this.dom.overlayCanvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        this.dom.overlayCanvas.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });

        // 对比滑块
        this.dom.compareDivider.addEventListener('mousedown', (e) => this._startCompareDrag(e));
        this.dom.compareDivider.addEventListener('touchstart', (e) => this._startCompareDrag(e), { passive: false });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => this._onKeyDown(e));
    },

    // ===== 文件处理 =====

    async _handleFile(file) {
        this._setStatus('正在加载图片...');
        try {
            const img = await FileHandler.loadImage(file);
            CanvasManager.loadImage(img);

            const { width, height } = CanvasManager.getImageSize();
            SelectionManager.init(width, height);

            this.originalImageData = CanvasManager.getImageData();
            this.beforeImageData = null;

            this.history.clear();
            this.history.push(this.originalImageData, SelectionManager.mask);

            this._setState('imageLoaded');
            this._setStatus(`图片已加载 · ${width}×${height}px`);
            this._showEditor();
            this._updateButtons();
            this._updateZoomDisplay();
        } catch (err) {
            this._setStatus('错误: ' + err.message);
            alert(err.message);
        }
    },

    // ===== 工具切换 =====

    _setTool(tool) {
        SelectionManager.setMode(tool);

        this.dom.toolRect.classList.toggle('active', tool === 'rect');
        this.dom.toolBrush.classList.toggle('active', tool === 'brush');
        this.dom.toolLasso.classList.toggle('active', tool === 'lasso');
        this.dom.brushSizeGroup.style.display = tool === 'brush' ? 'flex' : 'none';

        this.dom.overlayCanvas.style.cursor = tool === 'brush' ? 'cell' : 'crosshair';
    },

    // ===== Canvas 交互 =====

    _onMouseDown(e) {
        if (this.state !== 'imageLoaded' && this.state !== 'done') return;

        // 空格+拖拽 = 平移
        if (this.spaceDown) {
            CanvasManager.startPan(e.clientX, e.clientY);
            this.dom.overlayCanvas.style.cursor = 'grabbing';
            return;
        }

        const pos = CanvasManager.screenToImage(e.clientX, e.clientY);
        SelectionManager.startDraw(pos.x, pos.y);

        // 套索模式不需要进入 selecting 状态（点击式）
        if (SelectionManager.mode !== 'lasso') {
            this._setState('selecting');
        }
    },

    _onMouseMove(e) {
        // 平移中
        if (CanvasManager.isPanning) {
            CanvasManager.movePan(e.clientX, e.clientY);
            return;
        }

        // 套索模式：实时预览连线
        if (SelectionManager.mode === 'lasso' && SelectionManager.isDrawing) {
            const pos = CanvasManager.screenToImage(e.clientX, e.clientY);
            const drawInfo = SelectionManager.moveDraw(pos.x, pos.y);
            if (drawInfo) {
                CanvasManager.drawMask(SelectionManager.mask);
                CanvasManager.drawLasso(drawInfo.points, drawInfo.currentX, drawInfo.currentY, drawInfo.closed);
            }
            return;
        }

        if (this.state !== 'selecting') return;
        const pos = CanvasManager.screenToImage(e.clientX, e.clientY);
        const drawInfo = SelectionManager.moveDraw(pos.x, pos.y);

        if (drawInfo) {
            // 实时绘制选区预览
            CanvasManager.drawMask(SelectionManager.mask);
            if (drawInfo.type === 'rect') {
                CanvasManager.drawRect(drawInfo.x1, drawInfo.y1, drawInfo.x2, drawInfo.y2);
            }
        }
    },

    _onMouseUp(e) {
        // 结束平移
        if (CanvasManager.isPanning) {
            CanvasManager.endPan();
            this.dom.overlayCanvas.style.cursor = this.spaceDown ? 'grab' : this._currentCursor();
            return;
        }

        // 套索模式：点击式，不需要 mouseup 闭合
        if (SelectionManager.mode === 'lasso') return;

        if (this.state !== 'selecting') return;
        const pos = CanvasManager.screenToImage(
            e.clientX || (e.changedTouches && e.changedTouches[0].clientX),
            e.clientY || (e.changedTouches && e.changedTouches[0].clientY)
        );
        const changed = SelectionManager.endDraw(pos.x, pos.y);

        CanvasManager.drawMask(SelectionManager.mask);
        this._setState('imageLoaded');

        if (changed) {
            this.history.push(CanvasManager.getImageData(), SelectionManager.mask);
            this._updateButtons();
            const count = SelectionManager.getSelectionCount();
            this._setStatus(`已标记 ${count} 个像素为水印区域`);
        }
    },

    // ===== 套索闭合 =====

    _closeLasso() {
        const changed = SelectionManager.closeLasso();
        CanvasManager.drawMask(SelectionManager.mask);
        if (changed) {
            this.history.push(CanvasManager.getImageData(), SelectionManager.mask);
            this._updateButtons();
            const count = SelectionManager.getSelectionCount();
            this._setStatus(`套索已闭合 · 已标记 ${count} 个像素为水印区域`);
        }
    },

    // ===== 采样水印颜色 =====

    _sampleWatermarkColor() {
        if (!SelectionManager.hasSelection()) {
            alert('请先标记水印区域');
            return;
        }

        const imageData = CanvasManager.getImageData();
        const mask = SelectionManager.getMaskCopy();
        const color = TransparencyFill.estimateWatermarkColor(
            imageData.data,
            imageData.width,
            imageData.height,
            mask
        );

        // 转为 hex
        const hex = '#' +
            color.r.toString(16).padStart(2, '0') +
            color.g.toString(16).padStart(2, '0') +
            color.b.toString(16).padStart(2, '0');
        this.dom.watermarkColor.value = hex;
        this._setStatus(`已采样水印颜色: RGB(${color.r}, ${color.g}, ${color.b})`);
    },

    // ===== 触摸事件 =====

    _onTouchStart(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this._onMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
    },

    _onTouchMove(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this._onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
    },

    _onTouchEnd(e) {
        e.preventDefault();
        const touch = e.changedTouches[0];
        this._onMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
    },

    // ===== 键盘快捷键 =====

    _onKeyDown(e) {
        if (this.state === 'idle' || this.state === 'processing') return;

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this._undo();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            this._redo();
        } else if (e.key === 'Escape' && !this.dom.compareModal.classList.contains('hidden')) {
            this._hideCompare();
        } else if (e.key === 'Enter' && SelectionManager.mode === 'lasso' && SelectionManager.isDrawing) {
            // 回车闭合套索
            e.preventDefault();
            this._closeLasso();
        } else if (e.key === 'Escape' && SelectionManager.mode === 'lasso' && SelectionManager.isDrawing) {
            // ESC 取消套索
            e.preventDefault();
            SelectionManager.cancelLasso();
            CanvasManager.drawMask(SelectionManager.mask);
            this._setStatus('套索已取消');
        }
    },

    // ===== 撤销/重做 =====

    _undo() {
        const snapshot = this.history.undo();
        if (snapshot) {
            CanvasManager.putImageData(snapshot.imageData);
            SelectionManager.setMask(snapshot.mask);
            CanvasManager.drawMask(snapshot.mask);
            this._updateButtons();
            this._setStatus('已撤销');
        }
    },

    _redo() {
        const snapshot = this.history.redo();
        if (snapshot) {
            CanvasManager.putImageData(snapshot.imageData);
            SelectionManager.setMask(snapshot.mask);
            CanvasManager.drawMask(snapshot.mask);
            this._updateButtons();
            this._setStatus('已重做');
        }
    },

    // ===== 清除选区 =====

    _clearSelection() {
        SelectionManager.clear();
        CanvasManager.clearOverlay();
        this.history.push(CanvasManager.getImageData(), SelectionManager.mask);
        this._updateButtons();
        this._setStatus('已清除所有选区');
    },

    // ===== 去水印处理 =====

    async _process() {
        if (!SelectionManager.hasSelection()) {
            alert('请先在图片上标记水印区域');
            return;
        }

        const algo = this.dom.algoSelect.value;
        this._setState('processing');

        const statusMessages = {
            fast: '正在快速填充...',
            quality: '正在纹理合成（可能需要几秒）...',
            transparency: '正在还原半透明水印...'
        };
        this._showProcessing(statusMessages[algo] || '正在处理...');

        // 保存处理前数据用于对比
        this.beforeImageData = CanvasManager.getImageData();

        // 使用 requestAnimationFrame 让 UI 更新后再处理
        await new Promise(resolve => requestAnimationFrame(resolve));

        try {
            const imageData = CanvasManager.getImageData();
            const mask = SelectionManager.getMaskCopy();

            const onProgress = (p) => {
                const labels = {
                    fast: '正在快速填充',
                    quality: '正在纹理合成',
                    transparency: '正在还原半透明水印'
                };
                const label = labels[algo] || '正在处理';
                this.dom.processingText.textContent = `${label}... ${Math.round(p * 100)}%`;
            };

            if (algo === 'fast') {
                // ★ 根据强度滑块动态调整参数
                // strength: 1-6, 默认3
                // radius: 2 + strength (3-8), iterations: strength (1-6)
                // 缩小 radius 范围，让填充更局部化，减少对周围内容的模糊扩散
                const strength = parseInt(this.dom.strengthSlider.value);
                const radius = 2 + strength;
                const iterations = strength;
                FastFill.inpaint(imageData, mask, { radius, iterations, onProgress });
                CanvasManager.putImageData(imageData);
            } else if (algo === 'transparency') {
                // ★ 半透明水印还原
                const alpha = parseInt(this.dom.alphaSlider.value) / 100;
                const hex = this.dom.watermarkColor.value;
                const watermarkColor = {
                    r: parseInt(hex.slice(1, 3), 16),
                    g: parseInt(hex.slice(3, 5), 16),
                    b: parseInt(hex.slice(5, 7), 16)
                };
                const strength = parseInt(this.dom.strengthSlider.value);
                TransparencyFill.inpaint(imageData, mask, {
                    alpha,
                    watermarkColor,
                    radius: 2 + strength,
                    iterations: strength,
                    onProgress
                });
                CanvasManager.putImageData(imageData);
            } else {
                // ★ 高质量模式：优先使用 Web Worker，避免阻塞 UI
                await this._runPatchMatchWithWorker(imageData, mask, onProgress);
            }

            // 清除选区（已处理）
            SelectionManager.clear();
            CanvasManager.clearOverlay();

            this.history.push(CanvasManager.getImageData(), SelectionManager.mask);
            this._setState('done');
            this._setStatus('去水印完成！可继续标记新区域或下载结果');
            this._updateButtons();
        } catch (err) {
            this._setStatus('处理失败: ' + err.message);
            alert('处理失败: ' + err.message);
            this._setState('imageLoaded');
        } finally {
            this._hideProcessing();
        }
    },

    /**
     * 使用 Web Worker 执行 PatchMatch（不阻塞 UI）
     * file:// 协议下 Worker 不可用，自动降级到主线程
     */
    _runPatchMatchWithWorker(imageData, mask, onProgress) {
        return new Promise((resolve, reject) => {
            // 检测 Web Worker 支持
            if (typeof Worker === 'undefined') {
                this._runPatchMatchFallback(imageData, mask, onProgress).then(resolve).catch(reject);
                return;
            }

            let worker;
            try {
                worker = new Worker('js/inpaint/patch-match-worker.js');
            } catch (e) {
                // file:// 协议下 new Worker() 会同步抛异常，降级到主线程
                this._runPatchMatchFallback(imageData, mask, onProgress).then(resolve).catch(reject);
                return;
            }

            const requestId = Date.now();

            worker.onmessage = (e) => {
                const msg = e.data;
                if (msg.type === 'progress' && msg.requestId === requestId) {
                    onProgress(msg.progress);
                } else if (msg.type === 'done' && msg.requestId === requestId) {
                    CanvasManager.putImageData(msg.imageData);
                    worker.terminate();
                    resolve();
                } else if (msg.type === 'error' && msg.requestId === requestId) {
                    worker.terminate();
                    reject(new Error(msg.error));
                }
            };

            worker.onerror = () => {
                worker.terminate();
                // Worker 加载/执行失败，降级到主线程
                this._runPatchMatchFallback(imageData, mask, onProgress).then(resolve).catch(reject);
            };

            const strength = parseInt(this.dom.strengthSlider.value);
            const patchRadius = 2 + Math.floor(strength / 2);
            const totalSteps = strength + 1;

            worker.postMessage({
                imageData,
                mask,
                options: { patchRadius, iterations: totalSteps },
                requestId
            });
        });
    },

    /**
     * 降级方案：主线程执行 PatchMatch
     */
    _runPatchMatchFallback(imageData, mask, onProgress) {
        const strength = parseInt(this.dom.strengthSlider.value);
        const patchRadius = 2 + Math.floor(strength / 2);
        const totalSteps = strength + 1;

        return new Promise((resolve) => {
            setTimeout(() => {
                PatchMatch.inpaint(imageData, mask, {
                    patchRadius,
                    iterations: totalSteps,
                    onProgress
                });
                CanvasManager.putImageData(imageData);
                resolve();
            }, 50);
        });
    },

    // ===== 下载 =====

    _download() {
        const filename = FileHandler.generateFilename();
        const canvas = CanvasManager.mainCanvas;
        FileHandler.downloadCanvas(canvas, filename, 'png');
        this._setStatus('图片已下载');
    },

    // ===== 前后对比 =====

    _showCompare() {
        if (!this.beforeImageData) {
            alert('请先执行一次去水印处理');
            return;
        }

        // 生成处理前 dataURL
        const beforeCanvas = document.createElement('canvas');
        beforeCanvas.width = this.beforeImageData.width;
        beforeCanvas.height = this.beforeImageData.height;
        beforeCanvas.getContext('2d').putImageData(this.beforeImageData, 0, 0);
        this.dom.compareBefore.src = beforeCanvas.toDataURL('image/png');

        // 生成处理后 dataURL
        this.dom.compareAfter.src = CanvasManager.toDataURL('png');

        this.dom.compareModal.classList.remove('hidden');

        // 重置滑块到50%
        this._setComparePosition(50);
    },

    _hideCompare() {
        this.dom.compareModal.classList.add('hidden');
    },

    _startCompareDrag(e) {
        e.preventDefault();
        const moveHandler = (ev) => {
            const clientX = ev.clientX || (ev.touches && ev.touches[0].clientX);
            if (clientX === undefined) return;
            const rect = this.dom.compareContainer.getBoundingClientRect();
            const pct = ((clientX - rect.left) / rect.width) * 100;
            this._setComparePosition(Math.max(0, Math.min(100, pct)));
        };
        const upHandler = () => {
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup', upHandler);
            document.removeEventListener('touchmove', moveHandler);
            document.removeEventListener('touchend', upHandler);
        };
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
        document.addEventListener('touchmove', moveHandler, { passive: false });
        document.addEventListener('touchend', upHandler);
        moveHandler(e);
    },

    _setComparePosition(pct) {
        this.dom.compareBeforeWrapper.style.width = pct + '%';
        this.dom.compareDivider.style.left = pct + '%';
    },

    // ===== 重置 =====

    _reset() {
        if (!confirm('确定要重新上传图片吗？当前处理结果将丢失。')) return;

        this.dom.uploadZone.classList.remove('hidden');
        this.dom.editor.classList.add('hidden');
        this.dom.fileInput.value = '';
        this.dom.btnCompare.classList.add('hidden');
        this.dom.btnDownload.classList.add('hidden');

        this.originalImageData = null;
        this.beforeImageData = null;
        this.history.clear();
        SelectionManager.clear();

        this._setState('idle');
        this._setStatus('就绪');
    },

    // ===== UI 辅助 =====

    _showEditor() {
        this.dom.uploadZone.classList.add('hidden');
        this.dom.editor.classList.remove('hidden');
    },

    _setState(state) {
        this.state = state;
    },

    _setStatus(text) {
        this.dom.statusText.textContent = text;
    },

    _showProcessing(text) {
        this.dom.processingText.textContent = text;
        this.dom.processingOverlay.classList.remove('hidden');
    },

    _hideProcessing() {
        this.dom.processingOverlay.classList.add('hidden');
    },

    _updateButtons() {
        this.dom.btnUndo.disabled = !this.history.canUndo();
        this.dom.btnRedo.disabled = !this.history.canRedo();
        this.dom.btnProcess.disabled = !SelectionManager.hasSelection();

        if (this.state === 'done' || this.beforeImageData) {
            this.dom.btnCompare.classList.remove('hidden');
            this.dom.btnDownload.classList.remove('hidden');
        }

        // 提示文字
        if (this.state === 'imageLoaded' && !SelectionManager.hasSelection()) {
            this.dom.canvasHint.style.display = 'block';
        } else {
            this.dom.canvasHint.style.display = 'none';
        }

        this._updateZoomDisplay();
    },

    /**
     * 更新缩放百分比显示
     */
    _updateZoomDisplay() {
        const pct = Math.round(CanvasManager.getScale() * 100);
        this.dom.zoomLevel.textContent = pct + '%';
    },

    /**
     * 当前光标样式
     */
    _currentCursor() {
        return SelectionManager.mode === 'brush' ? 'cell' : 'crosshair';
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => App.init());
