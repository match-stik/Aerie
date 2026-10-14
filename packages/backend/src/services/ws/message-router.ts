// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import type { ClientMessage } from '@aerie/shared';

export type ClientMessageRouteMap = {
  [K in ClientMessage['type']]?: (message: Extract<ClientMessage, { type: K }>) => Promise<void> | void
};

export async function routeClientMessage(
  message: ClientMessage,
  routingMap: ClientMessageRouteMap,
  onUnhandled?: (message: ClientMessage) => void,
): Promise<void> {
  const handler = routingMap[message.type];
  if (!handler) {
    onUnhandled?.(message);
    return;
  }

  await handler(message as never);
}
