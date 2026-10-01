import { useEffect, useRef, type ReactNode } from 'react';

/** 네이티브 <dialog> 모달 (포커스 가두기·Esc 닫기는 브라우저 기본 동작) */
export function ConfirmDialog({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onClose={onClose} onCancel={onClose}>
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
