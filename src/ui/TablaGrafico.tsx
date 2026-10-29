/**
 * Los mismos datos de un gráfico como tabla para lectores de pantalla (el canvas sólo tiene un nombre). El `sr-only` va en un `div`: en una
 * `<table>` no recorta y la tabla, más ancha que el celular, ensanchaba toda la página.
 */
export function TablaGrafico({ titulo, labels, series, format }: { titulo: string; labels: string[]; series: { label: string; data: (number | null)[] }[]; format: (n: number) => string }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{titulo}</caption>
        <thead>
          <tr><th scope="col">Mes</th>{series.map(s => <th key={s.label} scope="col">{s.label}</th>)}</tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}-${i}`}><th scope="row">{l}</th>{series.map(s => <td key={s.label}>{s.data[i] == null ? '—' : format(s.data[i]!)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
