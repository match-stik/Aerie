// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The apps that need nothing from the chat but a way out and the theme. App.tsx
// draws whichever one is open; an app that needs more stays spelled out there.

import type { ComponentType } from 'react';
import { StatusApp } from './StatusApp';
import { MemoryApp } from './MemoryApp';
import { IntegrationsApp } from './IntegrationsApp';
import { AgentApp } from './AgentApp';
import { CommandCenterApp } from './CommandCenterApp';
import { CanvasApp } from './CanvasApp';
import { PressApp } from './PressApp';
import { WeatherApp } from './WeatherApp';
import { FieldNotesApp } from './FieldNotesApp';
import { JournalApp } from './JournalApp';
import { LettersApp } from './LettersApp';
import { ThresholdsApp } from './ThresholdsApp';
import { ToysApp } from './ToysApp';
import { SpotifyApp } from './SpotifyApp';
import { StudioApp } from './StudioApp';
import { ArtifactsApp } from './ArtifactsApp';
import { FilesApp } from './FilesApp';
import { PetApp } from './PetApp';
import { InboxApp } from './InboxApp';

interface PlainAppProps {
  onClose: () => void;
  themeConfig: any;
  themeMode: 'light' | 'dark';
}

export const PLAIN_APPS: Record<string, ComponentType<PlainAppProps>> = {
  status: StatusApp,
  memory: MemoryApp,
  integrations: IntegrationsApp,
  agent: AgentApp,
  commandcenter: CommandCenterApp,
  canvas: CanvasApp,
  press: PressApp,
  weather: WeatherApp,
  fieldnotes: FieldNotesApp,
  journal: JournalApp,
  letters: LettersApp,
  thresholds: ThresholdsApp,
  toys: ToysApp,
  spotify: SpotifyApp,
  studio: StudioApp,
  artifacts: ArtifactsApp,
  files: FilesApp,
  pet: PetApp,
  inbox: InboxApp,
};
