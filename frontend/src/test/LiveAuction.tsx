import { useState } from "react";
import { useAdminControls } from "../hooks/useAdminControls";
import { useAuction } from "../hooks/useAuction";
import { useGuildState } from "../hooks/useGuildState";
import { testJobs, testMembers } from "./api";
import AuctionOverlays from "../views/AuctionOverlays";
import AuctionView from "../views/AuctionView";

/** Test harness: the auction page wired to the real hooks with a fixed admin member (Aria) and a sign-in toggle. */
export default function LiveAuction({ notify = () => {} }: { notify?: (message: string) => void }) {
  const [signedIn, setSignedIn] = useState(false);
  const [asAdmin, setAsAdmin] = useState(true);
  const ign = signedIn ? "Aria" : "";
  const auction = useAuction({ isAuthenticated: signedIn, ign, notify });
  const admin = useAdminControls({ lockedPages: auction.lockedPages, setLockedPages: auction.setLockedPages, notify });
  const guild = useGuildState({
    initialMembers: testMembers,
    initialJobs: testJobs,
    memberId: signedIn ? "m-aria" : "",
    isAdmin: signedIn && asAdmin,
    isThai: false,
    notify,
    onMemberRemoved: admin.dropAdminMember,
  });
  return (
    <>
      <button type="button" onClick={() => setSignedIn(true)}>
        test-sign-in
      </button>
      <button type="button" onClick={() => setAsAdmin(false)}>
        test-switch-user
      </button>
      <AuctionView
        visible
        isThai={false}
        isAuthenticated={signedIn}
        isAdmin={signedIn && asAdmin}
        ign={ign}
        members={guild.members}
        auction={auction}
        admin={admin}
        notify={notify}
      />
      <AuctionOverlays auction={auction} isThai={false} />
    </>
  );
}
