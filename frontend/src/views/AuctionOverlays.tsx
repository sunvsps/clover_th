import { Check } from "lucide-react";
import type { AuctionState } from "../hooks/useAuction";
import { auctionCopy } from "./auctionCopy";

/** Full-screen overlays of the auction: the 3-2-1 start countdown and the "round ended" dialog. */
export default function AuctionOverlays({ auction, isThai }: { auction: AuctionState; isThai: boolean }) {
  const copy = auctionCopy(isThai, auction.roundNumber);
  return (
    <>
      {auction.countdown !== null && (
        <div className="countdown-backdrop" role="status" aria-live="assertive">
          <div className="countdown-modal">
            <span>ROUND {String(auction.roundNumber).padStart(2, "0")}</span>
            <strong>{auction.countdown}</strong>
            <small>Auction starting</small>
          </div>
        </div>
      )}
      {auction.roundEndedNotice && (
        <div className="round-ended-backdrop" role="alertdialog" aria-modal="true">
          <div className="round-ended-modal">
            <span className="ended-icon">
              <Check size={22} />
            </span>
            <p className="eyebrow">{copy.roundComplete}</p>
            <h2>{copy.roundEnded}</h2>
            <p>{copy.roundEndedDescription}</p>
            <button type="button" className="round-ended-close" onClick={auction.dismissRoundEnded}>
              {copy.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
