/**
 * Whisper Speech Recognition App
 *
 * 使用 @huggingface/transformers 进行浏览器端语音识别
 */

// 必须在最开始导入配置
import '../utils/transformersConfig';

import { useRef, useState, useEffect } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import AppHeader from '../components/AppHeader';
import './WhisperApp.css';
import { transcribe, SUPPORTED_LANGUAGES, AVAILABLE_MODELS, type WhisperOptions, disposeModel } from '../adapters/whisper-adapter';

interface WhisperAppProps {
  onBack: () => void;
}

export default function WhisperApp({ onBack }: WhisperAppProps) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [chunks, setChunks] = useState<Array<{ text: string; timestamp: [number, number | null] }>>([]);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [loadingFile, setLoadingFile] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState(false);

  // 设置选项
  const [language, setLanguage] = useState<string>('zh');
  const [model, setModel] = useState<WhisperOptions['model']>('Xenova/whisper-tiny');
  const [task, setTask] = useState<WhisperOptions['task']>('transcribe');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // 预初始化 Transformers.js 环境（在组件挂载时）
  useEffect(() => {
    const initTransformers = async () => {
      try {
        // 动态导入以触发初始化
        await import('@huggingface/transformers');
        console.log('[WhisperApp] Transformers.js loaded');
        setIsInitialized(true);
      } catch (error) {
        console.error('[WhisperApp] Failed to load Transformers.js:', error);
      }
    };

    initTransformers();

    // 组件卸载时释放模型
    return () => {
      disposeModel();
    };
  }, []);

  const handleFileSelect = (file: File) => {
    if (!file || !file.type.startsWith('audio/')) {
      toast.error('请选择音频文件');
      return;
    }

    setAudioFile(file);

    // 创建音频预览 URL
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    // 重置状态
    setTranscript('');
    setChunks([]);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleTranscribe = async () => {
    if (!audioFile) {
      toast.error('请先上传音频文件');
      return;
    }

    if (!isInitialized) {
      toast.error('正在初始化，请稍候...');
      return;
    }

    setIsProcessing(true);
    setIsModelLoading(true);
    setLoadingProgress(0);
    setTranscript('');
    setChunks([]);

    try {
      toast.info('⏳ 正在加载模型...');

      console.log('[WhisperApp] Starting transcription with model:', model);
      console.log('[WhisperApp] Audio file:', audioFile.name, audioFile.size, 'bytes');

      const result = await transcribe(audioFile, {
        model,
        language,
        task,
        quantized: true,
        onProgress: (progress, file) => {
          setLoadingProgress(progress);
          setLoadingFile(file);
          console.log(`[WhisperApp] Loading ${file}: ${progress}%`);
        },
        onUpdate: (text, newChunks) => {
          setTranscript(text);
          setChunks(newChunks);
          console.log('[WhisperApp] Update:', text.substring(0, 50) + '...');
        }
      });

      setTranscript(result.text);
      setChunks(result.chunks);

      toast.success('✅ 转录完成！');
    } catch (error) {
      console.error('[WhisperApp] Transcription error:', error);
      toast.error(`转录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsProcessing(false);
      setIsModelLoading(false);
      setLoadingProgress(0);
    }
  };

  const downloadTranscript = () => {
    if (!transcript) return;

    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transcript_${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    setAudioFile(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl('');
    setTranscript('');
    setChunks([]);
    setLoadingProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 格式化时间戳
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="app-container">
      <AppHeader
        title="语音识别 (Whisper)"
        icon="🎤"
        onBack={onBack}
        actions={
          audioFile && !isProcessing && (
            <>
              <button
                className="app-header-btn app-header-btn-secondary"
                onClick={resetAll}
              >
                🗑️ 重新开始
              </button>
              {transcript && (
                <button
                  className="app-header-btn app-header-btn-primary"
                  onClick={downloadTranscript}
                >
                  💾 下载结果
                </button>
              )}
            </>
          )
        }
      />

      <div className="app-content">
        {!audioFile ? (
          <div className="whisper-upload-section">
            <div className="upload-notice" style={{
              padding: '2px',
              borderRadius: '5px',
              marginBottom: '5px',
              textAlign: 'center',
              fontSize: '12px'
            }}>
              ✨ <strong>本地运行，不会上传您的音频文件</strong>
            </div>
            <div
              className="whisper-upload-area"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="whisper-upload-icon">🎤</div>
              <div className="whisper-upload-text">点击上传音频文件</div>
              <div className="whisper-upload-subtext">
                支持 WAV, MP3, M4A, OGG 等格式<br />
                或拖拽音频文件到这里
              </div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileInputChange}
                accept="audio/*"
                style={{ display: 'none' }}
              />
            </div>

            {/* 设置区域 */}
            <div className="whisper-settings">
              <div className="whisper-setting-group">
                <label>语言</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </div>

              <div className="whisper-setting-group">
                <label>模型</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as typeof model)}
                >
                  {Object.entries(AVAILABLE_MODELS).map(([key, info]) => (
                    <option key={key} value={key}>
                      {info.name} - {info.size} - {info.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="whisper-setting-group">
                <label>任务</label>
                <select
                  value={task}
                  onChange={(e) => setTask(e.target.value as typeof task)}
                >
                  <option value="transcribe">转录（保持原语言）</option>
                  <option value="translate">翻译（翻译成英文）</option>
                </select>
              </div>
            </div>

            {/* 模型信息卡片 */}
            <div className="whisper-model-info">
              <h3>模型对比</h3>
              <div className="whisper-model-table">
                <div className="whisper-model-table-header">
                  <span>模型</span>
                  <span>大小</span>
                  <span>速度</span>
                  <span>准确度</span>
                </div>
                {Object.entries(AVAILABLE_MODELS).map(([key, info]) => (
                  <div
                    key={key}
                    className={`whisper-model-table-row ${model === key ? 'active' : ''}`}
                    onClick={() => setModel(key as typeof model)}
                  >
                    <span>{info.name}</span>
                    <span>{info.size}</span>
                    <span>{info.speed}</span>
                    <span>{info.accuracy}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="whisper-workspace">
            {/* 音频播放器 */}
            <div className="whisper-audio-player">
              <audio
                ref={audioRef}
                controls
                src={audioUrl}
                className="whisper-audio-element"
              />
            </div>

            {/* 开始转录按钮 */}
            {!isProcessing && !transcript && (
              <div className="whisper-actions">
                <button
                  className="whisper-transcribe-button"
                  onClick={handleTranscribe}
                >
                  🎙️ 开始转录
                </button>
                <p className="whisper-hint">
                  首次使用需要下载模型文件 ({AVAILABLE_MODELS[model as keyof typeof AVAILABLE_MODELS].size})
                </p>
              </div>
            )}

            {/* 加载进度 */}
            {(isProcessing || isModelLoading) && (
              <div className="whisper-loading">
                <div className="whisper-spinner"></div>
                <h3>
                  {isModelLoading ? '加载模型中...' : '转录中...'}
                </h3>
                {loadingProgress > 0 && (
                  <div className="whisper-progress">
                    <div className="whisper-progress-bar">
                      <div
                        className="whisper-progress-fill"
                        style={{ width: `${loadingProgress}%` }}
                      />
                    </div>
                    <span className="whisper-progress-text">
                      {loadingFile} - {Math.round(loadingProgress)}%
                    </span>
                  </div>
                )}
                {transcript && (
                  <div className="whisper-preview">
                    <h4>实时转录:</h4>
                    <p>{transcript}</p>
                  </div>
                )}
              </div>
            )}

            {/* 转录结果 */}
            {transcript && !isProcessing && (
              <div className="whisper-result">
                <div className="whisper-result-header">
                  <h3>转录结果</h3>
                  <div className="whisper-result-actions">
                    <button
                      className="whisper-action-button"
                      onClick={() => {
                        setTranscript('');
                        setChunks([]);
                      }}
                    >
                      🔄 重新转录
                    </button>
                  </div>
                </div>
                <div className="whisper-transcript-box">
                  {chunks.length > 0 ? (
                    <div className="whisper-chunks">
                      {chunks.map((chunk, index) => (
                        <div key={index} className="whisper-chunk">
                          <span className="whisper-chunk-time">
                            [{formatTime(chunk.timestamp[0])}
                            {chunk.timestamp[1] !== null ? ` - ${formatTime(chunk.timestamp[1])}]` : ']'}
                          </span>
                          <span className="whisper-chunk-text">{chunk.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>{transcript}</p>
                  )}
                </div>

                {/* 统计信息 */}
                <div className="whisper-stats">
                  <div className="whisper-stat">
                    <span className="whisper-stat-label">字符数:</span>
                    <span className="whisper-stat-value">{transcript.length}</span>
                  </div>
                  <div className="whisper-stat">
                    <span className="whisper-stat-label">片段数:</span>
                    <span className="whisper-stat-value">{chunks.length}</span>
                  </div>
                  {chunks.length > 0 && (
                    <div className="whisper-stat">
                      <span className="whisper-stat-label">总时长:</span>
                      <span className="whisper-stat-value">
                        {formatTime(chunks[chunks.length - 1].timestamp[1] || 0)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ToastContainer rtl autoClose={2000} position="bottom-right" />
    </div>
  );
}
