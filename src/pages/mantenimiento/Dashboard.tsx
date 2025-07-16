import RoleGuard from '../../components/RoleGuard';

export default function MantenimientoDashboard() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Panel de Mantenimiento</h1>
      <p>Bienvenido. Aquí puedes ver y gestionar tareas de mantenimiento.</p>
      <RoleGuard allowed={['mantenimiento', 'superadmin']}>
        <button className="mt-4 px-4 py-2 bg-primary text-white rounded">Crear nueva tarea</button>
      </RoleGuard>
    </div>
  );
}
