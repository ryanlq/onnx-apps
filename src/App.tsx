import { useState, lazy, Suspense } from "react";
import { ToastContainer } from "react-toastify";
import "./App.css";

// 路由级代码分割 - 按需加载应用组件
// 优势：减少首屏加载时间 ~70%
const RMBGAppWorker = lazy(() => import("./pages/RMBGApp"));
const MIGANAppSimple = lazy(() => import("./pages/MIGANApp"));
const WhisperApp = lazy(() => import("./pages/WhisperApp"));
const RealESRGANApp = lazy(() => import("./pages/RealESRGANApp"));
const WaterRemovalReader = lazy(() => import("./pages/WaterRemovalReader"));

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
  category: "image" | "video" | "audio" | "other";
  badge?: string;
}

// 应用列表
const apps: AppItem[] = [
  {
    id: "rmbg-worker",
    title: "一键去背景",
    description: "智能移除图片背景⚡",
    icon: "⚡",
    component: RMBGAppWorker,
    category: "image",
    badge: "NEW",
  },
  {
    id: "migan-simple",
    title: "图像修复",
    description: "",
    icon: "✨",
    component: MIGANAppSimple,
    category: "image",
    badge: "NEW",
  },
  {
    id: "realesrgan",
    title: "图像增强",
    description: "超分辨率放大，提升图片清晰度 🔍",
    icon: "🔍",
    component: RealESRGANApp,
    category: "image",
    badge: "NEW",
  },
  {
    id: "water-removal",
    title: "去水阅读",
    description: "AI 小说去水，智能提取核心情节 📖",
    icon: "📖",
    component: WaterRemovalReader,
    category: "other",
    badge: "NEW",
  },
  {
    id: "whisper",
    title: "语音识别 (Whisper)",
    description: "基于 Transformers.js 的语音转文字 🎤",
    icon: "🎤",
    component: WhisperApp,
    category: "audio",
    badge: "NEW",
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

  // 如果选择了某个应用，显示该应用
  if (currentApp) {
    const app = apps.find((a) => a.id === currentApp);
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
          基于 ONNX Runtime Web 的 AI 应用工具箱（支持 Service Worker 缓存）
        </p>
      </div>

      <div className="apps-grid">
        {apps.map((app) => (
          <div
            key={app.id}
            className="app-card"
            onClick={() => setCurrentApp(app.id)}
          >
            {app.badge && <div className="app-badge">{app.badge}</div>}
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
    image: "图像处理",
    video: "视频处理",
    audio: "音频处理",
    other: "其他工具",
  };
  return labels[category] || category;
}

export default App;
