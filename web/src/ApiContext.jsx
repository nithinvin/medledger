// Supplies the API client to views; tests provide a fake instead.
import { createContext, useContext } from 'react';

export const ApiContext = createContext(null);

export function useApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside ApiContext.Provider');
  return api;
}
