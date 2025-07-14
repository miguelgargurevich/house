// ...existing code...

export default function OwnerReceipt() {
  // ...existing code...

  return (
    <section className="max-w-xl mx-auto text-gray-900 dark:text-gray-100 w-full">
      <h1 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">Detalle de Recibo</h1>
      {/* Detalle del recibo aquí */}
      <div className="bg-white dark:bg-gray-800 rounded shadow p-4 mb-4 transition-colors text-gray-900 dark:text-gray-100">Información del recibo (próximamente)</div>
      <form className="flex flex-col gap-4">
        <label className="font-medium text-gray-900 dark:text-gray-100">Adjuntar comprobante (voucher):
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.pdf"
            className="block mt-2 text-gray-900 dark:text-gray-100"
            // ...existing code...
          />
        </label>
        <button
          type="submit"
          className="bg-accent text-primary font-semibold px-4 py-2 rounded hover:bg-accent/80 transition"
        >
          Subir comprobante
        </button>
      </form>
      {/* Feedback visual (toast) y validación IA mock aquí */}
    </section>
  );
}
