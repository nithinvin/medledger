import { useState } from 'react';
import { Button, TextField } from './fields.jsx';

export default function PrescriptionLookup({ onLookup, busy, initialId = '' }) {
  const [id, setId] = useState(initialId);
  const submit = (event) => {
    event.preventDefault();
    if (id.trim()) onLookup(id.trim());
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="flex-1">
        <TextField label="Prescription ID" value={id} onChange={(e) => setId(e.target.value)} placeholder="UUID" />
      </div>
      <Button type="submit" disabled={busy || !id.trim()}>
        Look up
      </Button>
    </form>
  );
}
