import { useState } from 'react';
import { useApi, setToken } from '../hooks/useApi';

type User = { email: string; role: 'admin' | 'owner' } | null;

export default function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const { apiFetch } = useApi();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Ajusta la ruta y payload según tu backend
      const data = await apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.token) {
        setToken(data.token);
        onLogin({ email: data.user.email, role: data.user.rol });
        window.location.href = '/'; // Redirige al home o dashboard
      } else {
        setError('Credenciales incorrectas');
      }
    } catch (err: any) {
      setError(err?.error || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-8 rounded shadow-md w-full max-w-sm">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-900 dark:text-gray-100">Iniciar sesión</h2>
        {error && <div className="mb-4 text-red-500">{error}</div>}
        <div className="mb-4">
          <label className="block mb-1 font-medium text-gray-900 dark:text-gray-100">Email</label>
          <input
            type="email"
            className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="mb-6">
          <label className="block mb-1 font-medium text-gray-900 dark:text-gray-100">Contraseña</label>
          <input
            type="password"
            className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-primary text-white py-2 rounded hover:bg-primary/90 transition-colors font-semibold"
          disabled={loading}
        >
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
