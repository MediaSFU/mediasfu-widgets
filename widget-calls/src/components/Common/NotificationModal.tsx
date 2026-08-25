import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCheck,
  faExclamationTriangle,
  faInfo,
  faExclamationCircle
} from '@fortawesome/free-solid-svg-icons';
import './NotificationModal.css';

interface NotificationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  buttonText?: string;
  onClose: () => void;
}

const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  title,
  message,
  type = 'info',
  buttonText = 'OK',
  onClose
}) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return faCheck;
      case 'error':
        return faExclamationCircle;
      case 'warning':
        return faExclamationTriangle;
      default:
        return faInfo;
    }
  };

  const getIconColor = () => {
    switch (type) {
      case 'success':
        return '#28a745';
      case 'error':
        return '#dc3545';
      case 'warning':
        return '#ffc107';
      default:
        return '#17a2b8';
    }
  };

  return (
    <div className="notification-modal-overlay" onClick={onClose}>
      <div className="notification-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notification-modal-header">
          <div className="notification-icon" style={{ color: getIconColor() }}>
            <FontAwesomeIcon icon={getIcon()} size="2x" />
          </div>
          <h3 className="notification-title">{title}</h3>
        </div>

        <div className="notification-modal-content">
          <p className="notification-message">{message}</p>
        </div>

        <div className="notification-modal-actions">
          <button
            onClick={onClose}
            className={`notification-btn notification-btn-${type}`}
          >
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationModal;
