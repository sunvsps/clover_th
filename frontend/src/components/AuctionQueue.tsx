import { ArrowRight, History, ListOrdered, LogIn, LogOut, Tag, X } from "lucide-react";
import {
  findJob,
  itemLabel,
  jobStyle,
  queueCategories,
  type CategoryClaims,
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
  claims: CategoryClaims;
  pages: { category: QueueCategory; pages: number[] }[];
  roundOpen: boolean;
  log: QueueLogEntry[];
  onJoin: (category: QueueCategory) => void;
  onLeave: (category: QueueCategory, member: string) => void;
  onGoToAuction: () => void;
};

export default function AuctionQueue({ isThai, isAuthenticated, isAdmin, userName, jobs, members, queues, claims, pages, roundOpen, log, onJoin, onLeave, onGoToAuction }: Props) {
  const byName = new Map(members.map((member) => [member.name, member]));
  const me = byName.get(userName);
  const jobOf = (name: string) => findJob(jobs, byName.get(name)?.job ?? 0);
  const label = (category: QueueCategory) => {
    const entry = queueCategories.find((item) => item.id === category);
    return isThai ? entry?.labelTh : entry?.label;
  };
  const pagesFor = (category: QueueCategory) => pages.find((entry) => entry.category === category)?.pages ?? [];
  const formatTime = (time: number) => new Date(time).toLocaleString(isThai ? "th-TH" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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
              ? "ลงคิวไว้ล่วงหน้าสำหรับหมวด Gear / Card / Relic (ลงได้ทั้ง 3 คิว) เมื่อเปิดรอบ ให้ไปที่หน้าประมูลแล้วลงชื่อในช่องของหมวดนั้นได้ 1 ช่อง ถ้ามีหลายคนลงช่องเดียวกัน คนที่คิวสูงกว่าได้ก่อน ปิดรอบแล้วผู้ได้ของจะหลุดคิวและต้องลงคิวใหม่ ส่วนคนที่ไม่ได้ของหรือไม่ได้ลงชื่อยังรักษาลำดับไว้"
              : "Queue up ahead of time for Gear / Card / Relic (all three if you like). When a round opens, go to the auction page and claim one slot on that category's pages. If several people claim the same slot, the higher queue position wins. Winners leave the queue after the round and must re-register; everyone else keeps their spot."}
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

      <div className="queue-steps">
        <span>
          <b>1</b> {isThai ? "ลงคิวหมวดที่ต้องการ" : "Join the queues you want"}
        </span>
        <ArrowRight size={13} />
        <span>
          <b>2</b> {isThai ? "แอดมินติดป้ายหน้า + เปิดรอบ" : "Admin tags pages + starts the round"}
        </span>
        <ArrowRight size={13} />
        <span>
          <b>3</b> {isThai ? "ลงชื่อ 1 ช่องต่อหมวดในหน้าประมูล" : "Claim one slot per category on the auction page"}
        </span>
        <ArrowRight size={13} />
        <span>
          <b>4</b> {isThai ? "ปิดรอบ: คิวสูงสุดของแต่ละช่องได้ของ" : "Round ends: top queue position per slot wins"}
        </span>
      </div>

      <div className="queue-columns">
        {queueCategories.map((category) => {
          const entries = queues[category.id];
          const myIndex = entries.findIndex((entry) => entry.member === userName);
          const myClaim = claims[category.id][userName];
          const taggedPages = pagesFor(category.id);
          return (
            <section className={`queue-card ${roundOpen && taggedPages.length ? "live" : ""}`} key={category.id}>
              <header>
                <div>
                  <strong>{isThai ? category.labelTh : category.label}</strong>
                  <small>
                    {entries.length} {isThai ? "คนในคิว" : "in queue"}
                    {taggedPages.length > 0 && (
                      <em>
                        {" · "}
                        <Tag size={10} /> {isThai ? "หน้า" : "pages"} {taggedPages.join(", ")}
                      </em>
                    )}
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
                  {roundOpen && taggedPages.length > 0 && (
                    <button type="button" className="link-button" onClick={onGoToAuction}>
                      {myClaim ? (isThai ? `ลงชื่อไว้ที่ ${itemLabel(myClaim)}` : `Claimed ${itemLabel(myClaim)}`) : isThai ? "รอบเปิดอยู่ — ไปลงชื่อช่อง" : "Round open — go claim a slot"} <ArrowRight size={11} />
                    </button>
                  )}
                </p>
              )}
              <ol className="queue-list">
                {entries.map((entry) => (
                  <li key={entry.member} className={entry.member === userName ? "mine" : ""}>
                    <i className="job-dot" style={jobStyle(jobOf(entry.member))} />
                    <span className="queue-name">{entry.member}</span>
                    <small>{claims[category.id][entry.member] ? itemLabel(claims[category.id][entry.member]).replace(" / ", "·") : jobOf(entry.member)?.label ?? "—"}</small>
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
            <History size={14} /> {isThai ? "ประวัติผลประมูลหมวดคิว" : "Queue auction history"}
          </strong>
          <span>{log.length}</span>
        </div>
        {log.length === 0 ? (
          <p className="empty-search">{isThai ? "ยังไม่มีรายการ — จะบันทึกอัตโนมัติเมื่อปิดรอบ" : "Nothing yet — filled in automatically when a round ends."}</p>
        ) : (
          <ul className="history-list">
            {log.slice(0, 40).map((entry) => (
              <li key={entry.id} className={entry.result}>
                <span className="history-time">
                  R{String(entry.round).padStart(2, "0")} · {formatTime(entry.time)}
                </span>
                <span className="history-item">
                  <strong>{entry.itemName}</strong>
                  <small>{label(entry.category)}</small>
                </span>
                <span className="history-member">{entry.member}</span>
                <span className={`history-result ${entry.result}`}>{entry.result === "taken" ? (isThai ? "ได้ของ" : "Won") : isThai ? "สละสิทธิ์" : "Passed"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
