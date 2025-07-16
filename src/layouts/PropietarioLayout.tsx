
import type { ReactNode } from 'react';
import PropietarioSidebar from '../components/PropietarioSidebar';

export default function PropietarioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-white">
      <PropietarioSidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
