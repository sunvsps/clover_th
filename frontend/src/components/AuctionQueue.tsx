import { useState, type FormEvent } from "react";
import { Check, Crown, Gavel, History, ListOrdered, LogIn, LogOut, Shield, SkipForward, X } from "lucide-react";
import {
  findJob,
  jobStyle,
  queueCategories,
  type AuctionOffer,
  type GuildMember,
  type Job,
  type QueueCategory,
  type QueueLogEntry,
  type Queues,
} from "../data/guild";

type Props = {
  isThai: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  userName: string;
  jobs: Job[];
  members: GuildMember[];
  queues: Queues;
  offer: AuctionOffer | null;
  log: QueueLogEntry[];
  onJoin: (category: QueueCategory) => void;
  onLeave: (category: QueueCategory, member: string) => void;
  onOpenOffer: (category: QueueCategory, itemName: string, job: number | null) => void;
  onResolve: (member: string, result: "taken" | "declined") => void;
  onCloseOffer: () => void;
};

export default function AuctionQueue({ isThai, isAuthenticated, isAdmin, userName, jobs, members, queues, offer, log, onJoin, onLeave, onOpenOffer, onResolve, onCloseOffer }: Props) {
  const [offerCategory, setOfferCategory] = useState<QueueCategory>("gear");
  const [offerItem, setOfferItem] = useState("");
  const [offerJob, setOfferJob] = useState<number | null>(null);

  const byName = new Map(members.map((member) => [member.name, member]));
  const me = byName.get(userName);
  const jobOf = (name: string) => findJob(jobs, byName.get(name)?.job ?? 0);
  const label = (category: QueueCategory) => {
    const entry = queueCategories.find((item) => item.id === category);
    return isThai ? entry?.labelTh : entry?.label;
  };
  const matches = (name: string) => offer !== null && (offer.job === null || byName.get(name)?.job === offer.job);
  const offerQueue = offer ? queues[offer.category] : [];
  const candidate = offer ? offerQueue.find((entry) => matches(entry.member)) ?? null : null;
  const iAmCandidate = candidate?.member === userName;
  const formatTime = (time: number) => new Date(time).toLocaleString(isThai ? "th-TH" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function submitOffer(event: FormEvent) {
    event.preventDefault();
    if (!offerItem.trim()) return;
    onOpenOffer(offerCategory, offerItem.trim(), offerJob);
    setOfferItem("");
  }

  const resultLabel = (result: QueueLogEntry["result"]) =>
    result === "taken" ? (isThai ? "รับของ" : "Taken") : result === "declined" ? (isThai ? "สละสิทธิ์" : "Declined") : isThai ? "ไม่มีคิวที่ตรง" : "No taker";

  return (
    <section className="feature-page queue-page">
      <div className="feature-heading">
        <div>
          <p className="eyebrow">
            <ListOrdered size={13} /> AUCTION QUEUE
          </p>
          <h2>{isThai ? "จองคิวประมูล" : "Auction queue"}</h2>
          <p>
            {isThai
              ? "ลงคิวไว้ล่วงหน้าว่าอยากประมูลของประเภทไหน (ลงได้ทั้ง 3 คิว) เมื่อถึงเวลาประมูล ระบบจะไล่คิวจากคนแรก คนที่ของไม่ตรงอาชีพจะถูกข้ามแต่ยังรักษาลำดับไว้ ส่วนคนที่ของตรงอาชีพต้องรับของหรือสละสิทธิ์ — ทั้งสองกรณีจะออกจากคิวและต้องลงคิวใหม่"
              : "Queue up in advance for the item types you want (all three if you like). When an item comes up, the queue is walked from the front: members whose job does not match are skipped but keep their spot; the first matching member must take it or pass — either way they leave the queue and must re-register."}
          </p>
        </div>
        {isAuthenticated && (
          <div className="schedule-stats">
            <span>
              <i className="job-dot" style={jobStyle(me ? jobOf(userName) : undefined)} /> {userName}
              <strong>{me ? jobOf(userName)?.label : isThai ? "ไม่อยู่ในรายชื่อ" : "Not on roster"}</strong>
            </span>
          </div>
        )}
      </div>

      {isAuthenticated && !me && (
        <p className="queue-warning">
          {isThai
            ? "ชื่อของคุณยังไม่อยู่ในรายชื่อกิลด์ จึงยังลงคิวไม่ได้ — ให้แอดมินเพิ่มชื่อในหน้าจัดทีมก่อน"
            : "Your name is not on the guild roster yet, so you cannot join a queue. Ask an admin to add you from the team planner."}
        </p>
      )}

      {(offer || isAdmin) && (
        <section className={`offer-panel ${offer ? "live" : ""}`}>
          {offer ? (
            <>
              <div className="offer-head">
                <div>
                  <p className="eyebrow">
                    <Gavel size={11} /> {isThai ? "กำลังประมูล" : "NOW ON AUCTION"}
                  </p>
                  <h3>{offer.itemName}</h3>
                  <small>
                    {label(offer.category)} · {offer.job === null ? (isThai ? "ทุกอาชีพ" : "Any job") : findJob(jobs, offer.job)?.label} · {formatTime(offer.openedAt)}
                  </small>
                </div>
                {isAdmin && (
                  <button type="button" className="copy-button" onClick={onCloseOffer}>
                    <X size={13} /> {isThai ? "ปิดรายการ" : "Close offer"}
                  </button>
                )}
              </div>
              <div className="offer-walk">
                {offerQueue.length === 0 && <p className="empty-search">{isThai ? "คิวนี้ว่าง" : "This queue is empty."}</p>}
                {offerQueue.map((entry, index) => {
                  const isCandidate = candidate?.member === entry.member;
                  const beforeCandidate = candidate ? index < offerQueue.indexOf(candidate) : true;
                  const state = isCandidate ? "candidate" : beforeCandidate ? "skipped" : "waiting";
                  return (
                    <div className={`walk-row ${state}`} key={entry.member}>
                      <span className="walk-pos">{index + 1}</span>
                      <i className="job-dot" style={jobStyle(jobOf(entry.member))} />
                      <span className="walk-name">
                        {entry.member}
                        <small>{jobOf(entry.member)?.label ?? "—"}</small>
                      </span>
                      <span className="walk-state">
                        {state === "candidate" && (
                          <>
                            <Crown size={11} /> {isThai ? "ถึงคิว — ตรงอาชีพ" : "Up now — job matches"}
                          </>
                        )}
                        {state === "skipped" && (
                          <>
                            <SkipForward size={11} /> {isThai ? "ข้าม (คนละอาชีพ) — รักษาลำดับ" : "Skipped (other job) — keeps spot"}
                          </>
                        )}
                        {state === "waiting" && (isThai ? "รอ" : "Waiting")}
                      </span>
                      {isCandidate && (isAdmin || iAmCandidate) && (
                        <span className="walk-actions">
                          <button type="button" className="join-button" onClick={() => onResolve(entry.member, "taken")}>
                            <Check size={13} /> {isThai ? "รับของ" : "Take"}
                          </button>
                          <button type="button" className="leave-button" onClick={() => onResolve(entry.member, "declined")}>
                            <X size={13} /> {isThai ? "สละสิทธิ์" : "Pass"}
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {offerQueue.length > 0 && !candidate && (
                  <p className="empty-search">
                    {isThai ? "ไม่มีคนในคิวที่อาชีพตรงกับของชิ้นนี้ ทุกคนรักษาลำดับไว้ แอดมินปิดรายการได้เลย" : "Nobody in the queue matches this item's job. Everyone keeps their spot; the admin can close the offer."}
                  </p>
                )}
              </div>
            </>
          ) : (
            <form className="offer-form" onSubmit={submitOffer}>
              <p className="eyebrow">
                <Shield size={11} /> {isThai ? "แอดมิน: เปิดของประมูล" : "ADMIN: PUT AN ITEM UP"}
              </p>
              <div className="offer-fields">
                <label>
                  <span>{isThai ? "ประเภท" : "Type"}</span>
                  <select value={offerCategory} onChange={(event) => setOfferCategory(event.target.value as QueueCategory)}>
                    {queueCategories.map((category) => (
                      <option value={category.id} key={category.id}>
                        {isThai ? category.labelTh : category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grow">
                  <span>{isThai ? "ชื่อของ" : "Item"}</span>
                  <input type="text" value={offerItem} maxLength={60} placeholder={isThai ? "เช่น Muramasa [1]" : "e.g. Muramasa [1]"} onChange={(event) => setOfferItem(event.target.value)} />
                </label>
                <label>
                  <span>{isThai ? "สำหรับอาชีพ" : "For job"}</span>
                  <select value={offerJob ?? ""} onChange={(event) => setOfferJob(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">{isThai ? "ทุกอาชีพ" : "Any job"}</option>
                    {jobs.map((job) => (
                      <option value={job.id} key={job.id}>
                        {job.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="admin-button" disabled={!offerItem.trim()}>
                  <Gavel size={13} /> {isThai ? "เริ่มไล่คิว" : "Start"}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      <div className="queue-columns">
        {queueCategories.map((category) => {
          const entries = queues[category.id];
          const myIndex = entries.findIndex((entry) => entry.member === userName);
          const isLive = offer?.category === category.id;
          return (
            <section className={`queue-card ${isLive ? "live" : ""}`} key={category.id}>
              <header>
                <div>
                  <strong>{isThai ? category.labelTh : category.label}</strong>
                  <small>
                    {entries.length} {isThai ? "คนในคิว" : "in queue"}
                    {isLive && <em>{isThai ? " · กำลังประมูล" : " · live"}</em>}
                  </small>
                </div>
                {isAuthenticated && me && (myIndex >= 0 ? (
                  <button type="button" className="copy-button danger" onClick={() => onLeave(category.id, userName)}>
                    <LogOut size={13} /> {isThai ? "ออกจากคิว" : "Leave"}
                  </button>
                ) : (
                  <button type="button" className="admin-button" onClick={() => onJoin(category.id)}>
                    <LogIn size={13} /> {isThai ? "ลงคิว" : "Join queue"}
                  </button>
                ))}
              </header>
              {myIndex >= 0 && (
                <p className="my-position">
                  {isThai ? `คุณอยู่ลำดับที่ ${myIndex + 1}` : `You are #${myIndex + 1}`}
                  {isLive && candidate?.member === userName && <strong>{isThai ? " — ถึงคิวคุณแล้ว!" : " — you're up!"}</strong>}
                </p>
              )}
              <ol className="queue-list">
                {entries.map((entry) => (
                  <li key={entry.member} className={entry.member === userName ? "mine" : ""}>
                    <i className="job-dot" style={jobStyle(jobOf(entry.member))} />
                    <span className="queue-name">{entry.member}</span>
                    <small>{jobOf(entry.member)?.label ?? "—"}</small>
                    {isAdmin && (
                      <button type="button" className="chip-tool remove" title={isThai ? "เอาออกจากคิว" : "Remove from queue"} aria-label="Remove" onClick={() => onLeave(category.id, entry.member)}>
                        <X size={10} />
                      </button>
                    )}
                  </li>
                ))}
                {entries.length === 0 && <li className="empty">{isThai ? "ยังไม่มีใครลงคิว" : "Nobody in this queue yet."}</li>}
              </ol>
            </section>
          );
        })}
      </div>

      <section className="queue-history">
        <div className="pool-title">
          <strong>
            <History size={14} /> {isThai ? "ประวัติการประมูล" : "Auction history"}
          </strong>
          <span>{log.length}</span>
        </div>
        {log.length === 0 ? (
          <p className="empty-search">{isThai ? "ยังไม่มีรายการ" : "Nothing yet."}</p>
        ) : (
          <ul className="history-list">
            {log.slice(0, 30).map((entry) => (
              <li key={entry.id} className={entry.result}>
                <span className="history-time">{formatTime(entry.time)}</span>
                <span className="history-item">
                  <strong>{entry.itemName}</strong>
                  <small>
                    {label(entry.category)} · {entry.job === null ? (isThai ? "ทุกอาชีพ" : "Any job") : findJob(jobs, entry.job)?.label}
                  </small>
                </span>
                <span className="history-member">{entry.member ?? "—"}</span>
                <span className={`history-result ${entry.result}`}>{resultLabel(entry.result)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
