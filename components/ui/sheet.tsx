'use client';

import * as React from 'react';

export interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({ open = true, children }) => {
  // Minimal implementation: just render children when open
  if (!open) return null;
  return <>{children}</>;
};

export interface SheetContentProps {
  side?: 'left' | 'right' | 'top' | 'bottom';
  className?: string;
  children: React.ReactNode;
}

export const SheetContent: React.FC<SheetContentProps> = ({
  className = '',
  children,
}) => {
  // Minimal implementation: simple positioned container
  return (
    <div className={className}>
      {children}
    </div>
  );
};

export interface SheetTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const SheetTrigger: React.FC<SheetTriggerProps> = ({
  children,
  ...props
}) => {
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
};


