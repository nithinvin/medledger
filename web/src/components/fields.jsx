// Small form primitives with consistent styling and labels.
export function TextField({ label, ...props }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" {...props} />
    </label>
  );
}

export function Button({ children, variant = 'primary', ...props }) {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
  };
  return (
    <button
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]}`}
      {...props}
    >
      {children}
    </button>
  );
}
