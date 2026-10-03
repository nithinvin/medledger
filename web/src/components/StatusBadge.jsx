// Status badge colors per docs/design/application.md#web-ui.
const STYLES = {
  ISSUED: 'bg-slate-100 text-slate-700 ring-slate-300',
  PARTIALLY_FULFILLED: 'bg-amber-100 text-amber-800 ring-amber-300',
  FULLY_FULFILLED: 'bg-green-100 text-green-800 ring-green-300',
  EXPIRED: 'bg-gray-200 text-gray-600 ring-gray-300',
  REVOKED: 'bg-red-100 text-red-800 ring-red-300',
};

export default function StatusBadge({ status }) {
  const style = STYLES[status] ?? 'bg-white text-slate-500 ring-slate-200';
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${style}`}
      data-status={status}
    >
      {status ?? 'UNKNOWN'}
    </span>
  );
}
