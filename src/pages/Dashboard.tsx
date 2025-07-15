import { motion } from 'framer-motion';

import { useEffect, useState } from 'react';
import Chart from '../components/Chart';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { ChartBarIcon, CheckCircleIcon, ExclamationCircleIcon, HomeModernIcon } from '@heroicons/react/24/solid';


const initialData = [
  { id: 1, unit: 'A-101', amount: '$1200', status: 'Pagado' },
  { id: 2, unit: 'B-202', amount: '$950', status: 'Pendiente' },
  { id: 3, unit: 'C-303', amount: '$1100', status: 'Pagado' },
  { id: 4, unit: 'D-404', amount: '$1300', status: 'Pendiente' },
  { id: 5, unit: 'E-505', amount: '$900', status: 'Pagado' },
  { id: 6, unit: 'F-606', amount: '$1050', status: 'Pagado' },
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
  const [data] = useState(initialData);
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const totalPages = Math.ceil(data.length / pageSize);

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

  // Modern cards data
  const cards = [
    {
      title: 'Recibos emitidos',
      value: 6,
      icon: <ChartBarIcon className="w-7 h-7 text-blue-500" />, // azul
      bg: 'bg-blue-50 dark:bg-blue-900',
    },
    {
      title: 'Pagados',
      value: data.filter(d => d.status === 'Pagado').length,
      icon: <CheckCircleIcon className="w-7 h-7 text-green-500" />, // verde
      bg: 'bg-green-50 dark:bg-green-900',
    },
    {
      title: 'Pendientes',
      value: data.filter(d => d.status === 'Pendiente').length,
      icon: <ExclamationCircleIcon className="w-7 h-7 text-red-500" />, // rojo
      bg: 'bg-red-50 dark:bg-red-900',
    },
  ];

  // Paginación
  const paginatedData = data.slice((page - 1) * pageSize, page * pageSize);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-5xl mx-auto px-2 md:px-0"
    >
        <h1 className="flex items-center gap-2 text-3xl font-bold mb-8 mt-4 text-gray-900 dark:text-gray-100 tracking-tight">
          <HomeModernIcon className="h-8 w-8 text-primary dark:text-accent" />
          Panel de Administración
        </h1>

      {/* Modern cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map((card) => (
          <div
            key={card.title}
            className={`flex items-center gap-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 ${card.bg} transition-colors`}
          >
            <div>{card.icon}</div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{card.value}</div>
              <div className="text-gray-600 dark:text-gray-300 text-sm font-medium">{card.title}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8 transition-colors">
        <h2 className="font-semibold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <ChartBarIcon className="w-5 h-5 text-blue-500" /> Recibos del último mes
        </h2>
        <div className="rounded-lg overflow-hidden">
          {/* Chart component */}
          <Chart data={getChartData(isDark)} options={chartOptions} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ArrowPathIcon className="w-5 h-5 text-indigo-500" /> Listado de Recibos
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">ID</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Unidad</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Monto</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {paginatedData.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-4 py-2 text-gray-900 dark:text-gray-100 font-medium">{row.id}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{row.unit}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{row.amount}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold
                      ${row.status === 'Pagado'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex justify-end items-center gap-2 mt-4">
          <button
            className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            aria-label="Anterior"
          >
            <span aria-hidden="true">←</span>
          </button>
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Página {page} de {totalPages}
          </span>
          <button
            className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            aria-label="Siguiente"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </motion.section>
  );
}
