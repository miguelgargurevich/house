import RoleGuard from '../../components/RoleGuard';

export default function PropietarioDashboard() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Panel de Propietario</h1>
      <p>Bienvenido. Aquí puedes ver tus propiedades, pagos realizados y pendientes.</p>
      <RoleGuard allowed={['propietario', 'superadmin']}>
        <button className="mt-4 px-4 py-2 bg-primary text-white rounded">Ver pagos pendientes</button>
      </RoleGuard>
    </div>
  );
}
