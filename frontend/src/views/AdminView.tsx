import { ArrowLeft, ArrowRight, Lock, Settings } from "lucide-react";
import type { GuildMember } from "../data/guild";
import type { AdminControls } from "../hooks/useAdminControls";
import type { AuctionState } from "../hooks/useAuction";

type Props = {
  isAdmin: boolean;
  auction: AuctionState;
  admin: AdminControls;
  members: GuildMember[];
  notify: (message: string) => void;
};

/**
 * Admin parts of the auction page, rendered in place between the round panel and the item list:
 * the round controls, the "manage administrators" panel and the page-lock picker.
 */
export default function AdminView({ isAdmin, auction, admin, members, notify }: Props) {
  const filteredGuildMembers = members
    .map((member) => member.name)
    .filter((member) => member.toLowerCase().includes(admin.adminSearch.toLowerCase().trim()));

  return (
    <>
      {isAdmin && (
        <section className="admin-panel">
          <div>
            <p className="eyebrow">ADMIN CONTROLS</p>
            <h2>Manage auction round</h2>
            <small>
              {auction.heldPagesRound
                ? "Held-page round: only locked pages are open."
                : `Round open except locked pages: ${
                    Array.from(auction.lockedPages)
                      .sort((a, b) => a - b)
                      .join(", ") || "none"
                  }`}
            </small>
          </div>
          <label>
            <span>ROUND MINUTES</span>
            <input
              type="number"
              min="1"
              max="120"
              value={auction.durationMinutes}
              onChange={(event) => auction.setDurationMinutes(Number(event.target.value))}
            />
          </label>
          <button type="button" className="admin-button secondary" onClick={admin.openAdminPagePicker}>
            <Lock size={14} /> Select pages ({auction.lockedPages.size})
          </button>
          <button
            type="button"
            className="admin-button"
            disabled={auction.countdown !== null}
            onClick={auction.startRound}
          >
            {auction.countdown !== null ? "Starting..." : "Start round"}
          </button>
          <button type="button" className="admin-button release" onClick={auction.releaseHeldPages}>
            Release held pages
          </button>
        </section>
      )}

      {admin.adminConfigOpen && (
        <section className="admin-config-page">
          <div className="config-header">
            <div>
              <p className="eyebrow">
                <Settings size={12} /> ADMIN MENU / CONFIG
              </p>
              <h2>Manage administrators</h2>
              <p>Choose which guild members can manage rounds, locks, and page settings.</p>
            </div>
            <button className="config-close" type="button" onClick={() => admin.setAdminConfigOpen(false)}>
              Close
            </button>
          </div>
          <label className="admin-search">
            <span>SEARCH MEMBERS</span>
            <input
              type="search"
              placeholder="Search by name..."
              value={admin.adminSearch}
              onChange={(event) => admin.setAdminSearch(event.target.value)}
            />
          </label>
          <div className="member-admin-list">
            {filteredGuildMembers.map((member) => (
              <label className="member-admin-row" key={member}>
                <span className="member-avatar">{member.charAt(0)}</span>
                <span>
                  <strong>{member}</strong>
                  <small>Discord guild member</small>
                </span>
                <input
                  type="checkbox"
                  checked={admin.adminMembers.includes(member)}
                  onChange={() => admin.toggleAdminMember(member)}
                />
              </label>
            ))}
            {filteredGuildMembers.length === 0 && <p className="empty-search">No guild members found.</p>}
          </div>
          <div className="config-footer">
            <span>
              {admin.adminMembers.length} admin
              {admin.adminMembers.length === 1 ? "" : "s"} selected
            </span>
            <button
              className="admin-button"
              type="button"
              onClick={() => {
                admin.setAdminConfigOpen(false);
                notify("Admin configuration saved.");
              }}
            >
              Save configuration
            </button>
          </div>
        </section>
      )}

      {admin.adminPagePickerOpen && (
        <div
          className="page-modal-backdrop"
          role="presentation"
          onClick={() => admin.setAdminPagePickerOpen(false)}
        >
          <section
            className="page-modal admin-page-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-page-picker-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="page-modal-header">
              <div>
                <p className="eyebrow">ADMIN PAGE LOCKS</p>
                <h2 id="admin-page-picker-title">Select pages to lock</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => admin.setAdminPagePickerOpen(false)}>
                ×
              </button>
            </div>
            <div className="page-modal-range">
              <button
                type="button"
                disabled={admin.adminPagePickerGroup === 1}
                onClick={() => admin.setAdminPagePickerGroup(1)}
              >
                <ArrowLeft size={14} />
              </button>
              <strong>{admin.adminPagePickerGroup === 1 ? "Pages 1 - 25" : "Pages 26 - 50"}</strong>
              <button
                type="button"
                disabled={admin.adminPagePickerGroup === 2}
                onClick={() => admin.setAdminPagePickerGroup(2)}
              >
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="page-modal-grid admin-page-grid">
              {Array.from({ length: 25 }, (_, index) => (admin.adminPagePickerGroup - 1) * 25 + index + 1).map(
                (page) => (
                  <button
                    type="button"
                    className={admin.pendingLockedPages.has(page) ? "active locked-choice" : ""}
                    key={page}
                    onClick={() => admin.togglePendingPage(page)}
                  >
                    {admin.pendingLockedPages.has(page) ? (
                      <>
                        <Lock size={12} /> Page {page}
                      </>
                    ) : (
                      `Page ${page}`
                    )}
                  </button>
                ),
              )}
            </div>
            <div className="admin-modal-footer">
              <span>{admin.pendingLockedPages.size} pages selected</span>
              <button type="button" className="admin-button" onClick={admin.applyPageLocks}>
                Apply locks
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
