import type { ReactNode } from 'react';

interface TableProps {
  columns: { key: string; label: string; render?: (row: any) => ReactNode }[];
  data: any[];
}

export default function Table({ columns, data }: TableProps) {
  return (
    <div className="overflow-x-auto rounded shadow bg-white dark:bg-gray-900 transition-colors">
      <table className="min-w-full text-sm text-gray-800 dark:text-gray-100">
        <thead className="bg-primary dark:bg-gray-800 text-white dark:text-yellow-100 transition-colors">
          <tr>
            {columns.map(col => (
              <th key={col.key} className="px-4 py-2 text-left font-semibold dark:text-yellow-100">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={columns.length} className="text-center py-6 text-gray-400 dark:text-gray-500">Sin datos</td></tr>
          ) : (
            data.map((row, i) => (
              <tr key={i} className="even:bg-gray-50 dark:even:bg-gray-800 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-2 dark:text-gray-100">
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
