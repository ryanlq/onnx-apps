import { useState, lazy, Suspense, useEffect } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import { preloadWasmFiles } from './utils/wasmCache';
import './App.css';

// 路由级代码分割 - 按需加载应用组件
// 优势：减少首屏加载时间 ~70%
const RMBGAppWorker = lazy(() => import('./pages/RMBGApp'));
const MIGANAppSimple = lazy(() => import('./pages/MIGANApp'));
const WhisperApp = lazy(() => import('./pages/WhisperApp'));

// 加载状态组件
function AppLoader() {
  return (
    <div className="app-loader">
      <div className="loader-spinner"></div>
      <p>加载中...</p>
    </div>
  );
}

// 定义应用类型
interface AppItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  component: React.ComponentType<{ onBack: () => void }>;
  category: 'image' | 'video' | 'audio' | 'other';
  badge?: string;
}

// 应用列表
const apps: AppItem[] = [

  {
    id: 'rmbg-worker',
    title: '一键去背景 (Worker版)',
    description: '智能移除图片背景（Worker 非阻塞模式）⚡',
    icon: '⚡',
    component: RMBGAppWorker,
    category: 'image',
    badge: 'NEW'
  },
  {
    id: 'migan-simple',
    title: '图像修复 (MI-GAN 简化版)',
    description: '使用 OpenCV.js 的简化实现 ✨',
    icon: '✨',
    component: MIGANAppSimple,
    category: 'image',
    badge: 'NEW'
  },
  {
    id: 'whisper',
    title: '语音识别 (Whisper)',
    description: '基于 Transformers.js 的语音转文字 🎤',
    icon: '🎤',
    component: WhisperApp,
    category: 'audio',
    badge: 'NEW'
  },
  // 可以在这里添加更多应用
  // {
  //   id: 'another-app',
  //   title: '另一个应用',
  //   description: '应用描述',
  //   icon: '🔧',
  //   component: AnotherApp,
  //   category: 'image'
  // }
];

function App() {
  const [currentApp, setCurrentApp] = useState<string | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);

  // 在首页预加载 WASM 文件到 IndexedDB
  useEffect(() => {
    if (!currentApp) {
      const loadWasm = async () => {
        setIsPreloading(true);
        try {
          await preloadWasmFiles();
          toast.success('WASM 文件已缓存，可以正常使用应用');
        } catch (error) {
          console.error('WASM 预加载失败:', error);
          toast.error('WASM 预加载失败，请刷新页面重试');
        } finally {
          setIsPreloading(false);
        }
      };

      loadWasm();
    }
  }, [currentApp]);

  // 如果选择了某个应用，显示该应用
  if (currentApp) {
    const app = apps.find(a => a.id === currentApp);
    if (app) {
      const AppComponent = app.component;
      return (
        <Suspense fallback={<AppLoader />}>
          <div className="app-wrapper">
            <AppComponent onBack={() => setCurrentApp(null)} />
          </div>
        </Suspense>
      );
    }
  }

  // 显示首页应用列表
  return (
    <div className="home-container">
      <div className="home-header">
        <h1 className="home-title">ONNX Web 应用集合</h1>
        <p className="home-subtitle">
          {isPreloading ? '正在预加载 WASM 文件...' : '基于 ONNX Runtime Web 的 AI 应用工具箱'}
        </p>
        {isPreloading && (
          <div style={{ marginTop: '16px' }}>
            <div className="loader-spinner" style={{ width: '32px', height: '32px', margin: '0 auto' }}></div>
          </div>
        )}
      </div>

      <div className="apps-grid">
        {apps.map((app) => (
          <div
            key={app.id}
            className="app-card"
            onClick={() => setCurrentApp(app.id)}
          >
            {app.badge && (
              <div className="app-badge">{app.badge}</div>
            )}
            <div className="app-icon">{app.icon}</div>
            <h3 className="app-title">{app.title}</h3>
            <p className="app-description">{app.description}</p>
            <div className="app-category">
              <span className={`category-badge ${app.category}`}>
                {getCategoryLabel(app.category)}
              </span>
            </div>
          </div>
        ))}

        {/* 占位卡片：展示即将推出的功能 */}
        <div className="app-card placeholder">
          <div className="app-icon">🔧</div>
          <h3 className="app-title">更多功能</h3>
          <p className="app-description">敬请期待...</p>
          <div className="app-category">
            <span className="category-badge other">开发中</span>
          </div>
        </div>
      </div>

      <div className="home-footer">
        <p>Powered by ONNX Runtime Web</p>
      </div>
      <ToastContainer />
    </div>
  );
}

// 获取分类标签
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    image: '图像处理',
    video: '视频处理',
    audio: '音频处理',
    other: '其他工具'
  };
  return labels[category] || category;
}

export default App;
