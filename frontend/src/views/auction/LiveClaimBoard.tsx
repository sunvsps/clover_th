import { useState } from "react";
import { Check, Hand, Undo2 } from "lucide-react";
import { claimItem, releaseItem, type AuctionItem, type Round } from "../../api";
import { auctionErrorText, categoryLabel, groupByCategory, type Phase } from "./auctionModel";

type Props = {
  round: Round;
  phase: Phase;
  isThai: boolean;
  memberId: string;
  ignOf: (memberId: string) => string;
  notify: (message: string) => void;
  apply: (item: AuctionItem, myWinCount: number) => void;
  refresh: () => void;
};

/** Type 1 (live claim): items by category; claim, release, winners with names, and the N/cap counter. */
export default function LiveClaimBoard({ round, phase, isThai, memberId, ignOf, notify, apply, refresh }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [busy, setBusy] = useState<Set<number>>(() => new Set());
  const cap = round.winCap ?? 5;
  const canAct = phase === "open";

  async function act(item: AuctionItem, kind: "claim" | "release") {
    if (busy.has(item.id)) return;
    setBusy((b) => new Set(b).add(item.id));
    try {
      const result = await (kind === "claim" ? claimItem(round.id, item.id) : releaseItem(round.id, item.id));
      apply(result.item, result.myWinCount);
      notify(
        kind === "claim"
          ? t(`${item.name} is yours (${result.myWinCount}/${cap}).`, `${item.name} เป็นของคุณแล้ว (${result.myWinCount}/${cap})`)
          : t(`${item.name} released (${result.myWinCount}/${cap}).`, `ปล่อย ${item.name} แล้ว (${result.myWinCount}/${cap})`),
      );
    } catch (err) {
      notify(auctionErrorText(err, isThai, ignOf));
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(item.id);
        return next;
      });
      refresh(); // show the truth, e.g. who won the item we lost
    }
  }

  return (
    <div className="claim-board">
      <div className="claim-counter" role="status" aria-label={t("Your claims", "จำนวนที่คุณจอง")}>
        <Check size={14} /> {t("Your items", "ไอเท็มของคุณ")}: <strong>{round.myWinCount}/{cap}</strong>
      </div>
      {groupByCategory(round.items).map(({ category, items }) => (
        <section className="category-block" key={category} data-category={category}>
          <h3>
            {categoryLabel(category, isThai)} <small>{items.length}</small>
          </h3>
          <div className="item-grid">
            {items.map((item) => {
              const mine = item.winner?.memberId === memberId;
              const taken = item.winner !== null && !mine;
              return (
                <div className={`item-card ${taken ? "claimed" : "available"} ${mine ? "mine" : ""}`} key={item.id} data-item={item.name}>
                  <div className="item-info">
                    <h3>{item.name}</h3>
                    <small>{item.rarity ?? ""}</small>
                  </div>
                  {mine ? (
                    <button type="button" className="release-button" disabled={!canAct || busy.has(item.id)} onClick={() => void act(item, "release")}>
                      <Undo2 size={12} /> {t("Release", "ปล่อย")}
                    </button>
                  ) : taken ? (
                    <span className="item-owner">{t("Claimed by", "จองโดย")} {ignOf(item.winner!.memberId)}</span>
                  ) : (
                    <button type="button" className="claim-button" disabled={!canAct || busy.has(item.id)} onClick={() => void act(item, "claim")}>
                      <Hand size={12} /> {t("Claim", "จอง")}
                    </button>
                  )}
                  {mine && <span className="item-owner mine">{t("Yours", "ของคุณ")}</span>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
