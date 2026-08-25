import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faCheck, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import './ConfirmationModal.css';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'warning' | 'danger' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
  footerContent?: React.ReactNode;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'warning',
  onConfirm,
  onCancel,
  footerContent,
}) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'danger':
        return faExclamationTriangle;
      case 'warning':
        return faExclamationTriangle;
      default:
        return faExclamationTriangle;
    }
  };

  const getIconColor = () => {
    switch (type) {
      case 'danger':
        return '#dc3545';
      case 'warning':
        return '#ffc107';
      default:
        return '#17a2b8';
    }
  };

  return (
    <div className="confirmation-modal-overlay" onClick={onCancel}>
      <div className="confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirmation-modal-header">
          <div className="confirmation-icon" style={{ color: getIconColor() }}>
            <FontAwesomeIcon icon={getIcon()} size="2x" />
          </div>
          <h3 className="confirmation-title">{title}</h3>
        </div>

        <div className="confirmation-modal-content">
          <p className="confirmation-message">{message}</p>
        </div>

        {footerContent ? (
          <div className="confirmation-modal-footer">{footerContent}</div>
        ) : (
          <div className="confirmation-modal-actions">
            <button
              onClick={onCancel}
              className="confirmation-btn confirmation-btn-cancel"
            >
              <FontAwesomeIcon icon={faTimes} />
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`confirmation-btn confirmation-btn-confirm ${type}`}
            >
              <FontAwesomeIcon icon={faCheck} />
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfirmationModal;
