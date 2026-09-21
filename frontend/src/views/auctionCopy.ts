/** UI strings of the auction board, English and Thai. */
export function auctionCopy(isThai: boolean, roundNumber: number) {
  return {
    liveBoard: isThai ? "กระดานจองไอเท็มแบบเรียลไทม์" : "LIVE RESERVATION BOARD",
    guildAuction: isThai ? "ประมูลไอเท็มกิลด์" : "Guild auction",
    waiting: isThai ? "รอแอดมินเริ่มประมูล" : "Waiting for admin to start",
    auctionOpen: isThai ? "เปิดประมูลแล้ว" : "Auction is open",
    timeLeft: isThai ? "เวลาที่เหลือ" : "TIME LEFT",
    dropList: isThai ? "รายการไอเท็ม" : "THE DROP LIST",
    available: isThai ? "ไอเท็มที่เปิดจอง" : "Available items",
    intro: isThai
      ? "ระบบการจองประมูลไอเท็ม Clover_TH Guild"
      : "Reserve your auction drops in a fair, visible queue for",
    reserve: isThai ? "จอง" : "Reserve",
    cancel: isThai ? "ยกเลิก" : "Remove",
    next: isThai ? "ถัดไป" : "Next",
    previous: isThai ? "ก่อนหน้า" : "Previous",
    summary: isThai ? "สรุปการจอง" : "Reservation summary",
    copyList: isThai ? "คัดลอกรายการ" : "Copy list",
    receivedAll: isThai ? "รับของทั้งหมด" : "Received all",
    undoAll: isThai ? "ยกเลิกรับทั้งหมด" : "Undo all",
    received: isThai ? "รับของแล้ว" : "Received",
    undo: isThai ? "ยกเลิก" : "Undo",
    roundComplete: isThai ? "รอบการประมูลสิ้นสุดแล้ว" : "ROUND COMPLETE",
    roundEnded: isThai
      ? `รอบที่ ${String(roundNumber).padStart(2, "0")} สิ้นสุดแล้ว`
      : `Round ${String(roundNumber).padStart(2, "0")} has ended`,
    roundEndedDescription: isThai
      ? "ปิดการจองแล้ว แอดมินสามารถเริ่มรอบถัดไปได้เมื่อพร้อม"
      : "Reservations are now closed. The admin can start the next round when ready.",
    close: isThai ? "ปิด" : "Close",
  };
}
