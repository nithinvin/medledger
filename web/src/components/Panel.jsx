export default function Panel({ title, children, tone = 'default' }) {
  const border = tone === 'warning' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white';
  return (
    <section className={`rounded-lg border p-4 shadow-sm ${border}`}>
      <h2 className="mb-3 text-base font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}
