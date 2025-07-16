import type { ReactNode } from 'react';
import SuperAdminSidebar from '../components/SuperAdminSidebar';
import Navbar from '../components/Navbar';
import CookieConsentModal from '../components/CookieConsentModal';

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-background dark:bg-gray-900 transition-colors">
      <SuperAdminSidebar />
      <div className="flex-1 flex flex-col">
        <Navbar />
        <main className="flex-1 p-4">{children}</main>
        <CookieConsentModal />
      </div>
    </div>
  );
}
