
import type { ReactNode } from 'react';
import InquilinoSidebar from '../components/InquilinoSidebar';

export default function InquilinoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-gray-100">
      <InquilinoSidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
