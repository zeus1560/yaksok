"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// 헤더의 "닉네임 · 역할" (029 G-2). 값은 /me(MEMBER-API-05) 기준이며 화면 표시용이다 — 권한 판정에 쓰지 않는다
// 약속 화면(InviteFlow·PromiseRoom)이 /me를 받은 뒤 알려 주고, 화면을 떠나면 지운다

export type Identity = { nickname: string; role: "host" | "member" } | null;

const IdentityContext = createContext<{
  identity: Identity;
  setIdentity: (next: Identity) => void;
} | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity>(null);
  return (
    <IdentityContext.Provider value={{ identity, setIdentity }}>
      {children}
    </IdentityContext.Provider>
  );
}

// 화면이 그려져 있는 동안 헤더에 보인다. 값이 바뀌면 다시 알리고, 화면이 사라지면 지운다
export function useHeaderIdentity(identity: Identity) {
  const context = useContext(IdentityContext);
  const setIdentity = context?.setIdentity;
  const nickname = identity?.nickname ?? null;
  const role = identity?.role ?? null;
  useEffect(() => {
    if (!setIdentity) return;
    setIdentity(nickname && role ? { nickname, role } : null);
    return () => setIdentity(null);
  }, [setIdentity, nickname, role]);
}

export function roleLabel(role: "host" | "member"): string {
  return role === "host" ? "방장" : "참여자";
}

export function IdentityLabel() {
  const identity = useContext(IdentityContext)?.identity ?? null;
  if (!identity) return null;
  return (
    <p aria-label="내 닉네임과 역할" className="min-w-0 truncate text-sm font-medium text-text">
      {identity.nickname} · {roleLabel(identity.role)}
    </p>
  );
}
