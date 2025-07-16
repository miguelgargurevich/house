import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useApi, setToken } from '../hooks/useApi';

type User = { email: string; role: string };

interface LoginForm {
  email: string;
  password: string;
}

export default function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const { apiFetch } = useApi();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    defaultValues: {
      email: 'miguel.gargurevich@admin.com',
      password: 'admin1234'
    }
  });

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (res.token && res.user.rol === 'superadmin') {
        setToken(res.token);
        onLogin({ email: res.user.email, role: res.user.rol });
        reset();
        navigate('/superadmin/dashboard', { replace: true });
      } else {
        setError('Solo el rol superadmin puede ingresar en esta demo');
      }
    } catch (err: any) {
      setError(err?.error || 'Error de autenticación');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
      <form onSubmit={handleSubmit(onSubmit)} className="bg-white dark:bg-gray-800 p-8 rounded shadow-md w-full max-w-sm">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-900 dark:text-gray-100">Iniciar sesión</h2>
        {error && <div className="mb-4 text-red-500">{error}</div>}
        <div className="mb-4">
          <label className="block mb-1 font-medium text-gray-900 dark:text-gray-100">Email</label>
          <input
            type="email"
            className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700"
            autoFocus
            {...register('email', {
              required: 'El email es obligatorio',
              pattern: {
                value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
                message: 'Formato de email inválido',
              },
            })}
          />
          {errors.email && <span className="text-xs text-red-500 mt-1">{errors.email.message}</span>}
        </div>
        <div className="mb-6">
          <label className="block mb-1 font-medium text-gray-900 dark:text-gray-100">Contraseña</label>
          <input
            type="password"
            className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700"
            {...register('password', { required: 'La contraseña es obligatoria' })}
          />
          {errors.password && <span className="text-xs text-red-500 mt-1">{errors.password.message}</span>}
        </div>
        <button
          type="submit"
          className="w-full bg-primary text-white py-2 rounded hover:bg-primary/90 transition-colors font-semibold"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
