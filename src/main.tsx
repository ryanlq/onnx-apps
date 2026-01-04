import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initONNXConfig } from './config/onnx'

// 初始化 ONNX Runtime 配置（必须在 App 之前）
initONNXConfig()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
