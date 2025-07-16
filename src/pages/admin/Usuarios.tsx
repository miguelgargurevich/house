import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useApi } from '../../hooks/useApi';
import { PencilSquareIcon, TrashIcon, UserPlusIcon } from '@heroicons/react/24/outline';


interface Usuario {
  id: number;
  nombre: string;
  email: string;
  telefono: string;
  rol: string;
  password_hash?: string;
}

export default function UsuariosPage() {
  const api = useApi();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<Usuario>({
    defaultValues: { nombre: '', email: '', telefono: '', rol: '' }
  });
  const [editId, setEditId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Paginación
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const totalPages = Math.ceil(usuarios.length / pageSize);
  const paginatedUsuarios = usuarios.slice((page - 1) * pageSize, page * pageSize);

  const fetchUsuarios = () => {
    setLoading(true);
    api.apiFetch('/api/usuarios')
      .then(setUsuarios)
      .catch((err: any) => setError(err?.error || 'Error al cargar usuarios'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsuarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  const onSubmit = async (data: Usuario) => {
    setFormError(null);
    try {
      if (editId) {
        await api.apiFetch(`/api/usuarios/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
      } else {
        await api.apiFetch('/api/usuarios', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
      reset();
      setEditId(null);
      fetchUsuarios();
    } catch (err: any) {
      setFormError(err?.error || 'Error al guardar usuario');
    }
  };

  const handleEdit = (usuario: Usuario) => {
    setValue('nombre', usuario.nombre);
    setValue('email', usuario.email);
    setValue('telefono', usuario.telefono);
    setValue('rol', usuario.rol);
    setEditId(usuario.id);
    setFormError(null);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('¿Eliminar usuario?')) return;
    try {
      await api.apiFetch(`/api/usuarios/${id}`, { method: 'DELETE' });
      fetchUsuarios();
    } catch (err: any) {
      setError(err?.error || 'Error al eliminar usuario');
    }
  };

  const handleCancel = () => {
    reset();
    setEditId(null);
    setFormError(null);
  };

  if (loading) return <div className="p-8 text-center text-lg text-gray-500 dark:text-gray-300">Cargando usuarios...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <UserPlusIcon className="h-7 w-7 text-primary dark:text-accent" />
        <span className="text-gray-900 dark:text-gray-100">Usuarios</span>
      </h1>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mb-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border border-gray-100 dark:border-gray-800"
      >
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Nombre</label>
          <input
            {...register('nombre', { required: 'El nombre es obligatorio' })}
            placeholder="Nombre completo"
            className="input input-bordered w-full bg-transparent border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-3 py-2 text-base"
          />
          {errors?.nombre && <span className="text-xs text-red-500 mt-1">{errors.nombre.message}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Email</label>
          <input
            {...register('email', {
              required: 'El email es obligatorio',
              pattern: {
                value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
                message: 'Formato de email inválido',
              },
            })}
            placeholder="correo@ejemplo.com"
            type="email"
            className="input input-bordered w-full bg-transparent border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-3 py-2 text-base"
          />
          {errors?.email && <span className="text-xs text-red-500 mt-1">{errors.email.message}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Teléfono</label>
          <input
            {...register('telefono', { required: 'El teléfono es obligatorio' })}
            placeholder="Teléfono"
            className="input input-bordered w-full bg-transparent border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-3 py-2 text-base"
          />
          {errors?.telefono && <span className="text-xs text-red-500 mt-1">{errors.telefono.message}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Rol</label>
          <div className="relative">
            <select
              {...register('rol', { required: 'El rol es obligatorio' })}
              className="appearance-none input input-bordered w-full bg-transparent border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-3 py-2 text-base pr-8 text-gray-900 dark:text-gray-100"
            >
              <option value="">Selecciona un rol</option>
              <option value="admin">Admin</option>
              <option value="superadmin">Superadmin</option>
              <option value="owner">Propietario</option>
            </select>
            <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </div>
          {errors?.rol && <span className="text-xs text-red-500 mt-1">{errors.rol.message}</span>}
        </div>
        <div className="col-span-1 md:col-span-2 flex gap-3 mt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg shadow hover:bg-primary/90 transition-colors font-semibold text-base"
          >
            {editId ? <PencilSquareIcon className="h-5 w-5" /> : <UserPlusIcon className="h-5 w-5" />} {editId ? 'Actualizar' : 'Crear'}
          </button>
          {editId && (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-5 py-2.5 rounded-lg shadow hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-semibold text-base"
            >
              Cancelar
            </button>
          )}
        </div>
        {formError && <div className="col-span-1 md:col-span-2 text-red-500 text-sm mt-1">{formError}</div>}
      </form>
      <div className="overflow-x-auto rounded-xl shadow border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">ID</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Nombre</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">ID</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Nombre</th>
              <th className="hidden md:table-cell px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Email</th>
              <th className="hidden md:table-cell px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Teléfono</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Rol</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {paginatedUsuarios.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-6 text-gray-400 dark:text-gray-500">No hay usuarios</td>
              </tr>
            )}
            {paginatedUsuarios.map((u) => (
              <tr key={u.id} className="hover:bg-accent/10 dark:hover:bg-accent/10 transition-colors">
                <td className="px-4 py-2 text-sm font-mono text-gray-500 dark:text-gray-400">{u.id}</td>
                <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100">{u.nombre}</td>
                <td className="hidden md:table-cell px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{u.email}</td>
                <td className="hidden md:table-cell px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{u.telefono}</td>
                <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 capitalize">{u.rol}</td>
                <td className="px-4 py-2 flex gap-2 justify-center">
                  <button onClick={() => handleEdit(u)} className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors" title="Editar">
                    <PencilSquareIcon className="h-5 w-5 text-yellow-700 dark:text-yellow-300" />
                  </button>
                  <button onClick={() => handleDelete(u.id)} className="p-2 rounded-lg bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 transition-colors" title="Eliminar">
                    <TrashIcon className="h-5 w-5 text-red-700 dark:text-red-300" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Paginación */}
        <div className="flex justify-between items-center px-4 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Página {page} de {totalPages || 1}
          </span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || totalPages === 0}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>

  );
}
