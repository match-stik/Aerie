// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Vite dev server's two addresses, allowed to reach the house only while
// somebody is actually developing it (third outside audit, Nov 17 2026: any
// page served on localhost:5173 or :5174 could open the chat socket on a
// running house, and a cookie is not tied to a port, so a signed-in browser
// would send it along). "Developing" means the backend is running from its
// TypeScript source (npm run dev) or NODE_ENV says development out loud. A
// built house started with npm start or pm2 is neither, so it never lists them.

export const DEV_SERVER_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'] as const;

export function devOriginsAllowed(
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url,
): boolean {
  if (env.NODE_ENV === 'production') return false;
  if (env.NODE_ENV === 'development') return true;
  return moduleUrl.endsWith('.ts');
}
