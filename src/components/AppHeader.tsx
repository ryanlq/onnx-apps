import React from 'react';
import './AppHeader.css';

interface AppHeaderProps {
  title: string;
  icon?: string;
  actions?: React.ReactNode;
  onBack?: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({ title, icon, actions, onBack }) => {
  return (
    <div className="app-header">
      <div className="app-header-left">
        {onBack && (
          <button className="app-header-back-btn" onClick={onBack} aria-label="返回首页">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </button>
        )}
        {icon && <span className="app-header-icon">{icon}</span>}
        <h3 className="app-header-title">{title}</h3>
      </div>
      {actions && <div className="app-header-actions">{actions}</div>}
    </div>
  );
};

export default AppHeader;
