import { motion } from 'framer-motion';
import Table from '../components/Table';
import Chart from '../components/Chart';
import { useEffect, useState } from 'react';

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'unit', label: 'Unidad' },
  { key: 'amount', label: 'Monto' },
  { key: 'status', label: 'Estado' },
];
const data = [
  { id: 1, unit: 'A-101', amount: '$1200', status: 'Pagado' },
  { id: 2, unit: 'B-202', amount: '$950', status: 'Pendiente' },
];

function getChartData(isDark: boolean) {
  return {
    labels: ['Enero', 'Feb', 'Mar', 'Abr', 'May', 'Jun'],
    datasets: [
      {
        label: 'Recibos emitidos',
        data: [12, 19, 8, 15, 10, 14],
        backgroundColor: isDark
          ? 'rgba(59,130,246,0.8)' // azul claro para dark
          : 'rgba(13,27,42,0.8)', // azul oscuro para light
        borderRadius: 6,
        borderSkipped: false,
      },
    ],
  };
}

export default function Dashboard() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    const updateTheme = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    window.addEventListener('storage', updateTheme);
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      window.removeEventListener('storage', updateTheme);
      observer.disconnect();
    };
  }, []);

  const chartOptions = {
    plugins: {
      legend: {
        labels: {
          color: isDark ? '#F3F4F6' : '#111827',
        },
      },
      title: {
        display: false,
        color: isDark ? '#F3F4F6' : '#111827',
        font: { size: 18 },
      },
    },
    scales: {
      x: {
        ticks: {
          color: isDark ? '#F3F4F6' : '#111827',
          font: { weight: 'bold', size: 14 },
        },
        grid: { color: isDark ? 'rgba(243,244,246,0.1)' : 'rgba(0,0,0,0.05)' },
      },
      y: {
        ticks: {
          color: isDark ? '#F3F4F6' : '#111827',
          font: { weight: 'bold', size: 14 },
        },
        grid: { color: isDark ? 'rgba(243,244,246,0.1)' : 'rgba(0,0,0,0.05)' },
      },
    },
    backgroundColor: isDark ? '#1e293b' : '#fff',
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-5xl mx-auto"
    >
      <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Panel de Administración</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded shadow p-4 col-span-1 md:col-span-2 transition-colors">
          <h2 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Recibos del último mes</h2>
          <div className="rounded-lg overflow-hidden">
            <Chart data={getChartData(isDark)} options={chartOptions} />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded shadow p-4 transition-colors">
          <h2 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Pendientes</h2>
          <span className="text-3xl font-bold text-red-500">2</span>
        </div>
      </div>
      <div className="mb-6">
        <h2 className="font-semibold mb-2">Listado de Recibos</h2>
        <Table columns={columns} data={data} />
      </div>
    </motion.section>
  );
}
