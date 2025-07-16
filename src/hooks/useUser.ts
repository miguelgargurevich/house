import { useState, useEffect } from 'react';

export type User = { email: string; role: string } | null;

export function useUser(): User {
  const [user, setUser] = useState<User>(null);
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser({ email: payload.email, role: payload.rol });
      } catch {
        setUser(null);
      }
    } else {
      setUser(null);
    }
  }, []);
  return user;
}
