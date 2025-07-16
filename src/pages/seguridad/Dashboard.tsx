import RoleGuard from '../../components/RoleGuard';

export default function SeguridadDashboard() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Panel de Seguridad</h1>
      <p>Bienvenido. Aquí puedes ver y gestionar tareas de vigilancia y reportes de incidencias.</p>
      <RoleGuard allowed={['seguridad', 'superadmin']}>
        <button className="mt-4 px-4 py-2 bg-primary text-white rounded">Crear reporte de incidencia</button>
      </RoleGuard>
    </div>
  );
}
