import RoleGuard from '../../components/RoleGuard';

export default function InquilinoDashboard() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Panel de Inquilino</h1>
      <p>Bienvenido. Aquí puedes ver tus deudas, pagos y subir comprobantes.</p>
      <RoleGuard allowed={['inquilino', 'superadmin']}>
        <button className="mt-4 px-4 py-2 bg-primary text-white rounded">Subir comprobante de pago</button>
      </RoleGuard>
    </div>
  );
}
