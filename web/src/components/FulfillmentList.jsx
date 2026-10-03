export default function FulfillmentList({ fulfillments }) {
  if (!fulfillments?.length) return <p className="text-sm text-slate-500">No fulfillments yet.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-500">
        <tr>
          <th>#</th>
          <th>Pharmacy</th>
          <th>Pharmacist</th>
          <th>Quantity</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        {fulfillments.map((f) => (
          <tr key={f.fulfillmentId} className="border-t border-slate-100">
            <td>{f.sequence + 1}</td>
            <td>{f.pharmacyMSP}</td>
            <td>{f.pharmacistId}</td>
            <td>{f.quantityDispensed}</td>
            <td>{f.fulfilledAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
