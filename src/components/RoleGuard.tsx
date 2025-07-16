import type { ReactNode } from 'react';
import { useUser } from '../hooks/useUser';

interface RoleGuardProps {
  allowed: string[];
  children: ReactNode;
}

export default function RoleGuard({ allowed, children }: RoleGuardProps) {
  const user = useUser();
  if (!user || !allowed.includes(user.role)) {
    return null;
  }
  return <>{children}</>;
}
