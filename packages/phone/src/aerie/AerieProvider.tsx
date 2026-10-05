// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Runs the Aerie connection lifecycle: checks auth on mount, then connects
// the WebSocket once the user is authenticated (or auth is disabled).

import { useEffect, type ReactNode } from 'react';
import { checkAuth } from './api';
import { connect, disconnect } from './socket';
import { useAuth } from './hooks';

export function AerieProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    void checkAuth();
  }, []);

  useEffect(() => {
    if (auth.checking) return;
    const canConnect = auth.authenticated || !auth.required;
    if (canConnect) {
      connect();
      return () => disconnect();
    }
    disconnect();
  }, [auth.checking, auth.authenticated, auth.required]);

  return <>{children}</>;
}
