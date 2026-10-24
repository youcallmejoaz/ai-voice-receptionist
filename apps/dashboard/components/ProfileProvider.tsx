"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

export interface ProfileSummary {
  id: string;
  name: string;
  industry: string;
  agentName: string;
  synced: boolean;
  calendarOutage: boolean;
}

interface Ctx {
  profiles: ProfileSummary[];
  current: ProfileSummary | null;
  setCurrent: (id: string) => void;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<Ctx>({ profiles: [], current: null, setCurrent: () => {}, refresh: async () => {} });
const KEY = "avr.profile";

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await api<ProfileSummary[]>("/api/profiles");
    setProfiles(list);
    setCurrentId((prev) => {
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(KEY);
      } catch {}
      const want = prev ?? saved;
      return list.some((p) => p.id === want) ? want : (list[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const setCurrent = (id: string) => {
    setCurrentId(id);
    try {
      window.localStorage.setItem(KEY, id);
    } catch {}
  };

  return (
    <ProfileContext.Provider value={{ profiles, current: profiles.find((p) => p.id === currentId) ?? null, setCurrent, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

export const useProfiles = () => useContext(ProfileContext);
