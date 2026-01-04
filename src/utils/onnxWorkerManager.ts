/**
 * ONNX Worker Manager - 全局单例管理器
 *
 * 统一管理 ONNX Web Worker，实现模型共享和资源复用
 */

// @ts-ignore - Framework uses JavaScript, types are in separate file
import { createOnnxWorkerProxy } from 'onnx-web-framework';
import workerUrl from 'onnx-web-framework/worker?worker&url';

interface ModelInfo {
  modelName: string;
  inputNames: string[];
  outputNames: string[];
}

interface LoadModelOptions {
  onProgress?: (progress: number, loaded: number, total: number) => void;
}

class ONNXWorkerManager {
  private static instance: ONNXWorkerManager | null = null;
  private proxy: any = null;
  private worker: Worker | null = null;
  private initialized = false;
  private loadedModels: Set<string> = new Set();
  private initializingPromise: Promise<any> | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ONNXWorkerManager {
    if (!this.instance) {
      this.instance = new ONNXWorkerManager();
    }
    return this.instance;
  }

  /**
   * 获取 Worker Proxy
   * 首次调用时会自动初始化
   */
  async getProxy(): Promise<any> {
    if (!this.initialized) {
      // 防止重复初始化
      if (this.initializingPromise) {
        return this.initializingPromise;
      }

      this.initializingPromise = this._initialize();
      await this.initializingPromise;
      this.initializingPromise = null;
    }
    return this.proxy;
  }

  /**
   * 内部初始化方法
   */
  private async _initialize(): Promise<void> {
    try {
      console.log('[ONNXWorkerManager] 正在初始化全局 Worker...');

      this.worker = new Worker(workerUrl, { type: 'module' });
      this.proxy = createOnnxWorkerProxy(this.worker);

      await this.proxy.initialize({
        executionProviders: ['wasm'],
        wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/'
      });

      this.initialized = true;
      console.log('[ONNXWorkerManager] ✅ 全局 Worker 初始化完成（使用 CDN WASM，Service Worker 缓存）');
    } catch (error) {
      console.error('[ONNXWorkerManager] ❌ 初始化失败:', error);
      this.initializingPromise = null;
      throw error;
    }
  }

  /**
   * 加载模型（如果尚未加载）
   *
   * @param modelName - 模型名称
   * @param modelPath - 模型文件路径
   * @param options - 加载选项，包含进度回调
   * @returns 模型信息
   */
  async loadModel(modelName: string, modelPath: string, options?: LoadModelOptions): Promise<ModelInfo> {
    const proxy = await this.getProxy();

    // 检查模型是否已加载
    if (this.loadedModels.has(modelName)) {
      console.log(`[ONNXWorkerManager] 模型 '${modelName}' 已加载，跳过`);
      return {
        modelName,
        inputNames: [], // 实际使用时可以从 session 获取
        outputNames: []
      };
    }

    try {
      console.log(`[ONNXWorkerManager] 正在加载模型 '${modelName}' 从 ${modelPath}...`);

      const modelResponse = await fetch(modelPath);
      if (!modelResponse.ok) {
        throw new Error(`Failed to fetch model: ${modelResponse.statusText}`);
      }

      const contentLength = modelResponse.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      // 读取响应体并跟踪进度
      const reader = modelResponse.body?.getReader();
      if (!reader) {
        throw new Error('Response body is null');
      }

      const chunks: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        // 调用进度回调
        if (options?.onProgress && total > 0) {
          const progress = Math.round((loaded / total) * 100);
          options.onProgress(progress, loaded, total);
        }
      }

      // 合并所有 chunks
      const modelBuffer = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        modelBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      console.log(`[ONNXWorkerManager] 模型 '${modelName}' 下载完成，大小:`, modelBuffer.byteLength, 'bytes');

      const modelInfo = await proxy.loadModel(modelName, modelBuffer);
      this.loadedModels.add(modelName);

      console.log(`[ONNXWorkerManager] ✅ 模型 '${modelName}' 加载成功`);
      console.log(`[ONNXWorkerManager] 输入名称:`, modelInfo.inputNames);
      console.log(`[ONNXWorkerManager] 输出名称:`, modelInfo.outputNames);

      return {
        modelName,
        inputNames: modelInfo.inputNames || [],
        outputNames: modelInfo.outputNames || []
      };
    } catch (error) {
      console.error(`[ONNXWorkerManager] ❌ 加载模型 '${modelName}' 失败:`, error);
      throw error;
    }
  }

  /**
   * 检查模型是否已加载
   */
  isModelLoaded(modelName: string): boolean {
    return this.loadedModels.has(modelName);
  }

  /**
   * 获取已加载的模型列表
   */
  getLoadedModels(): string[] {
    return Array.from(this.loadedModels);
  }

  /**
   * 运行推理
   *
   * @param modelName - 模型名称
   * @param inputs - 输入张量字典
   * @returns 推理结果
   */
  async run(modelName: string, inputs: Record<string, any>): Promise<any> {
    const proxy = await this.getProxy();

    if (!this.loadedModels.has(modelName)) {
      throw new Error(`Model '${modelName}' not loaded. Call loadModel() first.`);
    }

    return await proxy.run(modelName, inputs);
  }

  /**
   * 释放所有资源
   * 注意：这会释放所有已加载的模型，需要重新初始化
   */
  async dispose(): Promise<void> {
    if (!this.initialized) {
      console.warn('[ONNXWorkerManager] 尚未初始化，无需释放');
      return;
    }

    console.log('[ONNXWorkerManager] 正在释放全局 Worker...');

    try {
      if (this.proxy) {
        await this.proxy.dispose();
        this.proxy = null;
      }

      this.worker = null;
      this.loadedModels.clear();
      this.initialized = false;
      this.initializingPromise = null;

      console.log('[ONNXWorkerManager] ✅ 全局 Worker 已释放');
    } catch (error) {
      console.error('[ONNXWorkerManager] ❌ 释放失败:', error);
      throw error;
    }
  }

  /**
   * 重置单例（主要用于测试）
   */
  static reset(): void {
    if (this.instance) {
      this.instance.dispose();
      this.instance = null;
    }
  }
}

export default ONNXWorkerManager;
