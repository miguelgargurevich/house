
import type { ReactNode } from 'react';
import MantenimientoSidebar from '../components/MantenimientoSidebar';

export default function MantenimientoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-gray-200">
      <MantenimientoSidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
