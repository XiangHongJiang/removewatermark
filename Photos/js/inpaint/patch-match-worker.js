/**
 * inpaint/patch-match-worker.js — Web Worker 版 PatchMatch
 *
 * 在后台线程执行纹理合成，避免阻塞 UI。
 * 通过 importScripts 引入依赖。
 */

importScripts('utils.js', 'patch-match.js');

self.onmessage = function(e) {
    const { imageData, mask, options, requestId } = e.data;

    try {
        // 包装 onProgress，通过 postMessage 报告进度
        const wrappedOptions = {
            ...options,
            onProgress: (p) => {
                self.postMessage({ type: 'progress', progress: p, requestId });
            }
        };

        const result = PatchMatch.inpaint(imageData, mask, wrappedOptions);

        self.postMessage({
            type: 'done',
            imageData: result,
            requestId
        });
    } catch (err) {
        self.postMessage({
            type: 'error',
            error: err.message,
            requestId
        });
    }
};
