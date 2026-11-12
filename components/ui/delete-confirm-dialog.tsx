// Placeholder DeleteConfirmDialog component
// Feature: 007-chaque-ann-e

import React from 'react';
import { useTranslations } from 'next-intl';

interface DeleteConfirmDialogProps {
  isOpen?: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  description?: string;
}

export function DeleteConfirmDialog({
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  message,
  description
}: DeleteConfirmDialogProps) {
  const t = useTranslations('common');
  const handleClose = onCancel ?? onClose ?? (() => {});

  if (isOpen === false) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">{title ?? t('confirm.title')}</h3>
        <p className="text-gray-600 mb-6">{description ?? message ?? t('confirm.deleteMessage')}</p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            {t('actions.cancel')}
          </button>
          <button
            onClick={() => {
              onConfirm();
              handleClose();
            }}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            {t('actions.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
