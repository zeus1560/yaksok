"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { modalKeyAction, shouldCloseOnBackdrop } from "@/lib/ui/modal";
import { Button, IconButton } from "./ui";

// 공통 확인 창 (029 19-1, Figma Dialogs: ConfirmScheduleDialog·DialogHeader)
// - 화면 가운데, 폭 540px, 모서리 16px, 그림자, 덮개(#202b3c 28%), 닫기 버튼 44×44
// - 열릴 때 취소 버튼으로 포커스를 옮기고, 닫힐 때 연 버튼으로 돌려준다. Tab은 창 안에서만 돈다
// - 바깥 클릭·Esc·✕·취소 버튼으로 닫는다. 요청 중(busy)에는 모두 막는다(lib/ui/modal.ts)
// - 열고 닫기는 부모가 open으로 정한다. 확인 결과(요청)는 부모가 처리하고 busy를 넘긴다

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = "돌아가기",
  tone = "default",
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode; // 본문(안내 문구·후보 상자 등)
  confirmLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger"; // danger: 제목·확인 버튼 빨강(Figma DialogHeader Destructive)
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <ModalFrame
      title={title}
      tone={tone}
      busy={busy}
      onClose={onClose}
      actions={
        <div className="grid grid-cols-[2fr_3fr] gap-3">
          <Button variant="secondary" disabled={busy} onClick={onClose} data-autofocus>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      }
      error={error ?? null}
    >
      {children}
    </ModalFrame>
  );
}

function ModalFrame({
  title,
  tone,
  busy,
  onClose,
  actions,
  error,
  children,
}: {
  title: string;
  tone: "default" | "danger";
  busy: boolean;
  onClose: () => void;
  actions: ReactNode;
  error: string | null;
  children: ReactNode;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);
  // 이벤트 처리기에서 최신 값을 읽는다(렌더 중에는 읽지 않는다)
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);

  // 열릴 때: 연 요소를 기억하고 취소 버튼(없으면 창)으로 포커스를 옮긴다. 배경 스크롤을 막는다
  // 닫힐 때: 연 요소가 아직 화면에 있으면 포커스를 돌려준다
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    target?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // 요청이 시작되면 누른 버튼이 막혀 포커스가 창 밖으로 빠진다. 창에 붙잡아 둔다
  useEffect(() => {
    const panel = panelRef.current;
    if (busy && panel && !panel.contains(document.activeElement)) panel.focus();
  }, [busy]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const action = modalKeyAction({
        key: event.key,
        shiftKey: event.shiftKey,
        busy: busyRef.current,
        focusIndex: items.indexOf(document.activeElement as HTMLElement),
        focusableCount: items.length,
      });
      if (action.kind === "close") {
        event.preventDefault();
        onCloseRef.current();
      } else if (action.kind === "focus") {
        event.preventDefault();
        (action.index === -1 ? panel : items[action.index])?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault(); // 요청 중 Esc: 아무것도 하지 않는다
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const close = shouldCloseOnBackdrop({
          busy,
          pressedOnBackdrop: pressedOnBackdrop.current,
          releasedOnBackdrop: e.target === e.currentTarget,
        });
        pressedOnBackdrop.current = false;
        if (close) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        aria-busy={busy}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-dialog overflow-y-auto rounded-card bg-paper p-6 shadow-dialog outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id={`${id}-title`}
            className={`pt-2 text-xl font-bold leading-snug ${tone === "danger" ? "text-danger" : "text-text"}`}
          >
            {title}
          </h2>
          <IconButton aria-label="닫기" disabled={busy} onClick={onClose}>
            ✕
          </IconButton>
        </div>
        <div id={`${id}-body`} className="mt-4 space-y-3 text-sub">
          {children}
        </div>
        <div className="mt-6">{actions}</div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
