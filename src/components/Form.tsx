import type { ReactNode } from 'react';

interface FormProps {
  onSubmit: (e: React.FormEvent) => void;
  children: ReactNode;
  className?: string;
}

export default function Form({ onSubmit, children, className }: FormProps) {
  return (
    <form onSubmit={onSubmit} className={`flex flex-col gap-4 ${className || ''}`}>{children}</form>
  );
}
