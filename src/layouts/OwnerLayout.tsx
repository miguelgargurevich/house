import type { ReactNode } from 'react';
import { UserIcon } from '@heroicons/react/24/outline';

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background dark:bg-gray-900 transition-colors">
      <header className="h-16 bg-primary dark:bg-gray-800 text-white flex items-center px-6 shadow justify-between">
        <span className="font-bold text-lg tracking-wide flex items-center gap-2">
          <UserIcon className="h-6 w-6" /> Mi Panel
        </span>
        {/* Aquí puedes agregar menú de usuario, logout, etc. */}
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
