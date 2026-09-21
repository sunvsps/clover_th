import { useState } from "react";

type Options = {
  lockedPages: Set<number>;
  setLockedPages: (pages: Set<number>) => void;
  notify: (message: string) => void;
};

/** Admin-only UI state: the page-lock picker and the "manage administrators" panel. */
export function useAdminControls({ lockedPages, setLockedPages, notify }: Options) {
  const [adminPagePickerOpen, setAdminPagePickerOpen] = useState(false);
  const [adminPagePickerGroup, setAdminPagePickerGroup] = useState(1);
  const [pendingLockedPages, setPendingLockedPages] = useState<Set<number>>(() => new Set());
  const [adminConfigOpen, setAdminConfigOpen] = useState(false);
  const [adminMembers, setAdminMembers] = useState<string[]>([]);
  const [adminSearch, setAdminSearch] = useState("");

  function openAdminPagePicker() {
    setPendingLockedPages(new Set(lockedPages));
    setAdminPagePickerGroup(1);
    setAdminPagePickerOpen(true);
  }

  function togglePendingPage(page: number) {
    setPendingLockedPages((pages) => {
      const nextPages = new Set(pages);
      if (nextPages.has(page)) nextPages.delete(page);
      else nextPages.add(page);
      return nextPages;
    });
  }

  function applyPageLocks() {
    setLockedPages(new Set(pendingLockedPages));
    setAdminPagePickerOpen(false);
    notify(
      pendingLockedPages.size
        ? `Locked pages: ${Array.from(pendingLockedPages)
            .sort((a, b) => a - b)
            .join(", ")}`
        : "All pages unlocked.",
    );
  }

  function toggleAdminMember(member: string) {
    setAdminMembers((members) =>
      members.includes(member)
        ? members.filter((currentMember) => currentMember !== member)
        : [...members, member],
    );
  }

  return {
    adminPagePickerOpen,
    setAdminPagePickerOpen,
    adminPagePickerGroup,
    setAdminPagePickerGroup,
    pendingLockedPages,
    adminConfigOpen,
    setAdminConfigOpen,
    adminMembers,
    adminSearch,
    setAdminSearch,
    openAdminPagePicker,
    togglePendingPage,
    applyPageLocks,
    toggleAdminMember,
    /** roster changes keep the admin selection in step */
    renameAdminMember: (oldName: string, newName: string) =>
      setAdminMembers((current) => current.map((member) => (member === oldName ? newName : member))),
    dropAdminMember: (name: string) =>
      setAdminMembers((current) => current.filter((member) => member !== name)),
  };
}

export type AdminControls = ReturnType<typeof useAdminControls>;
