declare module 'onnx-web-framework' {
  export default class ONNXWebFramework {
    constructor(options?: any);

    initialize(): Promise<void>;

    loadModel(
      name: string,
      modelPath: string | Uint8Array | ArrayBuffer,
      options?: any
    ): Promise<any>;

    run(modelName: string, input: any): Promise<any>;

    getModelInfo(modelName: string): any;

    listModels(): string[];

    unloadModel(modelName: string): Promise<void>;

    dispose(): Promise<void>;
  }

  export { ONNXWebFramework };
}