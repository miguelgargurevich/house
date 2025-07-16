import type { ReactNode } from 'react';
import AdminSidebar from '../components/AdminSidebar';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-background dark:bg-gray-900 transition-colors">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Puedes agregar un Navbar aquí si lo deseas */}
        <main className="flex-1 p-4 flex flex-col min-h-[calc(100vh-4rem)]">{children}</main>
      </div>
    </div>
  );
}
