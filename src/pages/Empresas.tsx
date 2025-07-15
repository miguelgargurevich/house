import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { BuildingStorefrontIcon, PencilSquareIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline';

interface Empresa {
  id: number;
  nombre: string;
  cuit: string;
  email: string;
  telefono: string;
}

export default function EmpresasPage() {
  const api = useApi();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Empresa>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Paginación
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const totalPages = Math.ceil(empresas.length / pageSize);
  const paginatedEmpresas = empresas.slice((page - 1) * pageSize, page * pageSize);

  const fetchEmpresas = () => {
    setLoading(true);
    api.apiFetch('/api/empresas')
      .then(setEmpresas)
      .catch((err: any) => setError(err?.error || 'Error al cargar empresas'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEmpresas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      if (editId) {
        await api.apiFetch(`/api/empresas/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
      } else {
        await api.apiFetch('/api/empresas', {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      setForm({});
      setEditId(null);
      fetchEmpresas();
    } catch (err: any) {
      setFormError(err?.error || 'Error al guardar empresa');
    }
  };

  const handleEdit = (empresa: Empresa) => {
    setForm(empresa);
    setEditId(empresa.id);
    setFormError(null);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('¿Eliminar empresa?')) return;
    try {
      await api.apiFetch(`/api/empresas/${id}`, { method: 'DELETE' });
      fetchEmpresas();
    } catch (err: any) {
      setError(err?.error || 'Error al eliminar empresa');
    }
  };

  const handleCancel = () => {
    setForm({});
    setEditId(null);
    setFormError(null);
  };

  if (loading) return <div className="p-8 text-center text-lg text-gray-500 dark:text-gray-300">Cargando empresas...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <BuildingStorefrontIcon className="h-7 w-7 text-primary dark:text-accent" />
        <span className="text-gray-900 dark:text-gray-100">Empresas Administradoras</span>
      </h1>
      <form
        onSubmit={handleSubmit}
        className="mb-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border border-gray-100 dark:border-gray-800"
      >
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Nombre</label>
          <input
            name="nombre"
            placeholder="Nombre de la empresa"
            value={form.nombre || ''}
            onChange={handleChange}
            className="input input-bordered w-full bg-transparent border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-3 py-2 text-base"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">CUIT</label>
          <input
            name="cuit"
            placeholder="CUIT"
            value={form.cuit || ''}
            onChange={handleChange}
            className="input input-bordered w-full bg-transparent border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-3 py-2 text-base"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Email</label>
          <input
            name="email"
            placeholder="correo@empresa.com"
            value={form.email || ''}
            onChange={handleChange}
            className="input input-bordered w-full bg-transparent border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-3 py-2 text-base"
            type="email"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">Teléfono</label>
          <input
            name="telefono"
            placeholder="Teléfono"
            value={form.telefono || ''}
            onChange={handleChange}
            className="input input-bordered w-full bg-transparent border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg px-3 py-2 text-base"
            required
          />
        </div>
        <div className="col-span-1 md:col-span-2 flex gap-3 mt-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg shadow hover:bg-primary/90 transition-colors font-semibold text-base"
          >
            {editId ? <PencilSquareIcon className="h-5 w-5" /> : <PlusIcon className="h-5 w-5" />} {editId ? 'Actualizar' : 'Crear'}
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
              <th className="hidden md:table-cell px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">CUIT</th>
              <th className="hidden md:table-cell px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Email</th>
              <th className="hidden md:table-cell px-4 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Teléfono</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {paginatedEmpresas.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-6 text-gray-400 dark:text-gray-500">No hay empresas</td>
              </tr>
            )}
            {paginatedEmpresas.map((e) => (
              <tr key={e.id} className="hover:bg-accent/10 dark:hover:bg-accent/10 transition-colors">
                <td className="px-4 py-2 text-sm font-mono text-gray-500 dark:text-gray-400">{e.id}</td>
                <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100">{e.nombre}</td>
                <td className="hidden md:table-cell px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{e.cuit}</td>
                <td className="hidden md:table-cell px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{e.email}</td>
                <td className="hidden md:table-cell px-4 py-2 text-sm text-gray-700 dark:text-gray-300">{e.telefono}</td>
                <td className="px-4 py-2 flex gap-2 justify-center">
                  <button onClick={() => handleEdit(e)} className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors" title="Editar">
                    <PencilSquareIcon className="h-5 w-5 text-yellow-700 dark:text-yellow-300" />
                  </button>
                  <button onClick={() => handleDelete(e.id)} className="p-2 rounded-lg bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 transition-colors" title="Eliminar">
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
