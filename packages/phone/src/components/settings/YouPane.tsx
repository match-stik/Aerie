// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { Upload, Smartphone, UserRound, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { Toggle } from "../Toggle";
import type { SettingsState } from './use-settings-state';

export function YouPane({ s }: { s: SettingsState }) {
  const { avatarInputRef, colors, handleImageUpload, theme, appSettings, onSettingsChange } = s;
  return (
    <>
    {/* Your Avatar — their person's bubble face + ring color, the
        user-side counterpart of the companion voice avatars */}
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>
        Your Avatar
      </h3>
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-full overflow-hidden border-2 flex items-center justify-center shrink-0"
          style={{
            borderColor: appSettings.userAvatarColor || "transparent",
            background: "rgba(127,127,127,0.15)",
          }}
        >
          {appSettings.userAvatar ? (
            <img src={appSettings.userAvatar} alt="Your avatar" className="w-full h-full object-cover" />
          ) : (
            <UserRound size={24} className="opacity-50" />
          )}
        </div>
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => avatarInputRef.current?.click()}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold uppercase tracking-widest",
                colors.panelBg, colors.panelBorder, colors.accentText, "hover:opacity-80",
              )}
            >
              <Upload size={12} strokeWidth={2} />
              Upload
            </button>
            {appSettings.userAvatar && (
              <button
                onClick={() => onSettingsChange({ userAvatar: undefined })}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold uppercase tracking-widest opacity-70",
                  colors.panelBg, colors.panelBorder, colors.textMain, "hover:opacity-100",
                )}
              >
                <Trash2 size={12} strokeWidth={2} />
                Remove
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest cursor-pointer">
            <span className={cn(colors.textMuted)}>Ring color</span>
            <input
              type="color"
              value={appSettings.userAvatarColor || "#f97316"}
              onChange={(e) => onSettingsChange({ userAvatarColor: e.target.value })}
              className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>
          <div className="flex items-center gap-2">
            <span className={cn("text-[11px] font-bold uppercase tracking-widest", colors.textMuted)}>My status matches theirs</span>
            <Toggle
              on={!!appSettings.ownerCardMatchesTheme}
              onClick={() => onSettingsChange({ ownerCardMatchesTheme: !appSettings.ownerCardMatchesTheme })}
              colors={colors}
              ariaLabel="My contact card uses the theme's accent like theirs"
            />
          </div>
        </div>
      </div>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleImageUpload(e, "avatar")}
      />
    </section>

    {/* App Identity */}
    <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
      <h3 className={cn("micro-label", colors.accentText)}>
        App Identity
      </h3>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4 sm:gap-6">
          <div
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-[calc(20px*var(--shape-scale,1))] sm:rounded-[calc(24px*var(--shape-scale,1))] flex items-center justify-center transition-all duration-500 shrink-0"
            style={{ backgroundColor: colors.accent }}
          >
            <Smartphone
              className="aerie-on-accent w-8 h-8 sm:w-10 sm:h-10"
              strokeWidth={1.5}
            />
          </div>
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={appSettings.osName ?? ""}
              onChange={(e) =>
                onSettingsChange({ osName: e.target.value })
              }
              className={cn(
                "aerie-field w-full rounded-xl px-3 py-2 focus:outline-none text-lg italic tracking-tight mb-1",
                colors.textMain,
              )}
              placeholder="e.g. Aerie OS"
            />
            <p
              className={cn(
                "text-[10px] sm:text-[11px] leading-relaxed font-medium break-words whitespace-normal text-left",
                colors.textMuted,
              )}
            >
              Your personal OS name.
            </p>
          </div>
        </div>

        <div className="pt-4">
          <h3 className={cn("micro-label mb-3", colors.accentText)}>
            Group Chat Name
          </h3>
          <input
            type="text"
            value={appSettings.groupChatName ?? ""}
            onChange={(e) =>
              onSettingsChange({ groupChatName: e.target.value })
            }
            className={cn(
              "aerie-field w-full rounded-xl px-3 py-2 focus:outline-none text-sm",
              colors.textMain,
            )}
            placeholder="Aerie"
          />
          <p
            className={cn(
              "text-[10px] sm:text-[11px] leading-relaxed font-medium mt-1",
              colors.textMuted,
            )}
          >
            Appears at the top of your chat interface.
          </p>
        </div>

      </div>
    </section>

    </>
  );
}
