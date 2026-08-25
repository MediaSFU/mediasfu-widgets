import React from 'react';
import './LoadingSpinner.css';

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  message?: string;
  overlay?: boolean;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  message,
  overlay = false
}) => {
  const spinnerClass = `loading-spinner ${size}`;

  if (overlay) {
    return (
      <div className="spinner-overlay">
        <div className="spinner-content">
          <div className={spinnerClass}>
            <div className="spinner-ring"></div>
            <div className="spinner-ring"></div>
            <div className="spinner-ring"></div>
            <div className="spinner-ring"></div>
          </div>
          {message && <p className="spinner-message">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="spinner-container">
      <div className={spinnerClass}>
        <div className="spinner-ring"></div>
        <div className="spinner-ring"></div>
        <div className="spinner-ring"></div>
        <div className="spinner-ring"></div>
      </div>
      {message && <p className="spinner-message">{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
