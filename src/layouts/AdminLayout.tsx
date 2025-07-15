import type { ReactNode } from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-background dark:bg-gray-900 transition-colors">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <Navbar />
        <main className="flex-1 p-4 flex flex-col min-h-[calc(100vh-4rem)]">{children}</main>
      </div>
    </div>
  );
}
