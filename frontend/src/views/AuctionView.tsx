import { ArrowLeft, ArrowRight, Check, CircleHelp, Copy, Lock, LockOpen, Package, Trash2, Users } from "lucide-react";
import type { GuildMember } from "../data/guild";
import type { AdminControls } from "../hooks/useAdminControls";
import type { AuctionState } from "../hooks/useAuction";
import AdminView from "./AdminView";
import { auctionCopy } from "./auctionCopy";

type Props = {
  /** false = the auction page is hidden (another feature view is active) but stays mounted, as before */
  visible: boolean;
  isThai: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  ign: string;
  members: GuildMember[];
  auction: AuctionState;
  admin: AdminControls;
  notify: (message: string) => void;
};

/** The item reservation board: intro, round status, admin controls, item pages, and the reservation summary. */
export default function AuctionView({ visible, isThai, isAuthenticated, isAdmin, ign, members, auction, admin, notify }: Props) {
  const copy = auctionCopy(isThai, auction.roundNumber);
  const {
    roundNumber,
    countdown,
    isAuctionStarted,
    timeLeft,
    isAuctionClosed,
    formattedTime,
    lockedPages,
    heldPagesRound,
    currentPage,
    setCurrentPage,
    pageBlocks,
    reservations,
    receivedItems,
    claimedCount,
  } = auction;

  return (
    <div id="top" className={`content ${!visible ? "hidden-view" : ""}`}>
      <section className="intro-row">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> {copy.liveBoard}
          </p>
          <h1>
            Guild item queue<span>.</span>
          </h1>
          <p className="intro-copy">
            {copy.intro}
            {isThai ? (
              ""
            ) : (
              <>
                {" "}
                <strong>Clover_TH</strong>.
              </>
            )}
          </p>
        </div>
        <div className="season-card">
          <span>ROUND {roundNumber === 0 ? "--" : String(roundNumber).padStart(2, "0")}</span>
          <strong>{copy.guildAuction}</strong>
          <small>{isAuctionClosed ? "Round closed" : `${formattedTime} remaining`}</small>
        </div>
      </section>

      <section className={`round-panel ${isAuctionClosed ? "closed" : ""}`}>
        <div className="round-status">
          <span className="timer-icon">{isAuctionClosed ? <Lock size={17} /> : <LockOpen size={17} />}</span>
          <div>
            <strong>
              {!isAuctionStarted ? copy.waiting : timeLeft <= 0 ? "Round time is over" : copy.auctionOpen}
            </strong>
            <small>
              {isAuctionClosed
                ? "Reservations are paused"
                : isThai
                  ? "จองก่อนหมดเวลา"
                  : "Reserve before the timer reaches zero"}
            </small>
          </div>
        </div>
        <div className="timer">
          <span>{copy.timeLeft}</span>
          <strong>{roundNumber === 0 && countdown === null ? "--:--" : formattedTime}</strong>
        </div>
      </section>

      <AdminView isAdmin={isAdmin} auction={auction} admin={admin} members={members} notify={notify} />

      <section className="section-heading">
        <div>
          <p className="eyebrow">{copy.dropList}</p>
          <h2>{copy.available}</h2>
        </div>
        <div className="top-page-nav">
          <span>
            Pages <strong>{currentPage === 1 ? "1 - 25" : "26 - 50"}</strong>
          </span>
          <button
            className="page-group-button"
            type="button"
            onClick={() => setCurrentPage((page) => (page === 1 ? 2 : 1))}
          >
            {currentPage === 1 ? (
              <>
                {copy.next} <ArrowRight size={14} />
              </>
            ) : (
              <>
                <ArrowLeft size={14} /> {copy.previous}
              </>
            )}
          </button>
        </div>
      </section>
      <section className="page-blocks" aria-label="Auction item pages">
        {pageBlocks.map((pageBlock) => {
          const pageIsLocked = heldPagesRound ? !lockedPages.has(pageBlock.page) : lockedPages.has(pageBlock.page);
          return (
            <section
              className={`page-block ${pageIsLocked ? "page-locked" : ""}`}
              key={pageBlock.page}
              aria-label={`Page ${pageBlock.page}`}
            >
              <div className="page-label">
                Page <strong>{pageBlock.page}</strong>
                {pageIsLocked && (
                  <small>
                    <Lock size={11} /> Locked
                  </small>
                )}
              </div>
              <div className="item-grid">
                {pageBlock.items.map((item, itemIndex) => {
                  const isMine = item.status === "claimed" && item.claimedBy === ign.trim();
                  return (
                    <article className={`item-card ${item.status}`} key={item.id}>
                      <div className="item-info">
                        <h3>Item {itemIndex + 1}</h3>
                        {item.status === "claimed" && (
                          <small className="reserved-by">Reserved by {item.claimedBy}</small>
                        )}
                      </div>
                      <button
                        className="claim-button"
                        type="button"
                        disabled={
                          !isAuthenticated ||
                          pageIsLocked ||
                          (isAuctionClosed && !isMine) ||
                          (item.status === "claimed" && !isMine)
                        }
                        onClick={() => auction.claimItem(item.id)}
                      >
                        {isMine ? (
                          <>
                            <Trash2 size={14} /> {copy.cancel}
                          </>
                        ) : (
                          <>
                            <Package size={14} /> {copy.reserve}
                          </>
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </section>

      <div className="page-group-bottom">
        <span>
          Pages <strong>{currentPage === 1 ? "1 - 25" : "26 - 50"}</strong>
        </span>
        <button
          className="page-group-button"
          type="button"
          onClick={() => setCurrentPage((page) => (page === 1 ? 2 : 1))}
        >
          {currentPage === 1 ? (
            <>
              Next <ArrowRight size={14} />
            </>
          ) : (
            <>
              <ArrowLeft size={14} /> Previous
            </>
          )}
        </button>
      </div>

      <section className="summary-section">
        <div className="section-heading summary-heading">
          <div>
            <p className="eyebrow">THE PAPER TRAIL</p>
            <h2>{copy.summary}</h2>
          </div>
          <button className="copy-button" type="button" onClick={auction.copySummary}>
            <Copy size={15} /> {copy.copyList}
          </button>
        </div>
        <div className="summary-meta">
          <span>
            <Users size={15} /> {reservations.length} members
          </span>
          <span>
            <Package size={15} /> {claimedCount} items reserved
          </span>
        </div>
        <div className="summary-grid">
          {reservations.map((reservation) => {
            const isOwnReservation = reservation.member === ign.trim();
            const sortedItems = [...reservation.items].sort((firstItem, secondItem) => {
              const firstMatch = firstItem.match(/Page (\d+) \/ Item (\d+)/);
              const secondMatch = secondItem.match(/Page (\d+) \/ Item (\d+)/);
              if (!firstMatch || !secondMatch) return 0;
              return (
                Number(firstMatch[1]) - Number(secondMatch[1]) || Number(firstMatch[2]) - Number(secondMatch[2])
              );
            });
            const allReceived = sortedItems.every((item) => receivedItems.has(`${reservation.member}:${item}`));
            return (
              <article className="summary-card" key={reservation.member}>
                <div className="member-heading">
                  <span className="member-avatar">{reservation.member.charAt(0).toUpperCase()}</span>
                  <strong>{reservation.member}</strong>
                  <span className="item-count">
                    {sortedItems.length} {sortedItems.length === 1 ? "item" : "items"}
                  </span>
                  {isOwnReservation && (
                    <button
                      type="button"
                      className="receive-all-button"
                      onClick={() =>
                        allReceived
                          ? auction.undoAllReceived(reservation.member, sortedItems)
                          : auction.markAllReceived(reservation.member, sortedItems)
                      }
                    >
                      {allReceived ? copy.undoAll : copy.receivedAll}
                    </button>
                  )}
                </div>
                {sortedItems.map((item) => {
                  const isReceived = receivedItems.has(`${reservation.member}:${item}`);
                  return (
                    <div className={`reserved-item ${isReceived ? "received" : ""}`} key={item}>
                      <span />
                      {item}
                      {isReceived ? (
                        <button
                          type="button"
                          className="undo-received-button"
                          onClick={() => auction.undoReceived(reservation.member, item)}
                        >
                          {copy.undo}
                        </button>
                      ) : isOwnReservation ? (
                        <button
                          type="button"
                          className="receive-button"
                          onClick={() => auction.markItemReceived(reservation.member, item)}
                        >
                          <Check size={12} /> {copy.received}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      </section>
      <footer>
        <span>CLOVER_TH</span>
        <span>
          Built for fair drops · <CircleHelp size={13} /> Need help?
        </span>
      </footer>
    </div>
  );
}
