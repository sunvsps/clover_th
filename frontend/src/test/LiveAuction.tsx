import { useAdminControls } from "../hooks/useAdminControls";
import { useAuction } from "../hooks/useAuction";
import { useGuildState } from "../hooks/useGuildState";
import { useSession } from "../hooks/useSession";
import AuctionOverlays from "../views/AuctionOverlays";
import AuctionView from "../views/AuctionView";

/** Test harness: the auction page wired to the real hooks (no top bar / feature views), with a sign-in button. */
export default function LiveAuction({ notify = () => {} }: { notify?: (message: string) => void }) {
  const session = useSession({ notify });
  const auction = useAuction({ isAuthenticated: session.isAuthenticated, ign: session.ign, notify });
  const admin = useAdminControls({ lockedPages: auction.lockedPages, setLockedPages: auction.setLockedPages, notify });
  const guild = useGuildState({
    isAuthenticated: session.isAuthenticated,
    isAdmin: session.isAdmin,
    userName: session.userName,
    isThai: false,
    notify,
    onMemberRenamed: admin.renameAdminMember,
    onMemberRemoved: admin.dropAdminMember,
  });
  return (
    <>
      <button type="button" onClick={session.signIn}>
        test-sign-in
      </button>
      <button type="button" onClick={session.switchToUser}>
        test-switch-user
      </button>
      <AuctionView
        visible
        isThai={false}
        isAuthenticated={session.isAuthenticated}
        isAdmin={session.isAdmin}
        ign={session.ign}
        members={guild.members}
        auction={auction}
        admin={admin}
        notify={notify}
      />
      <AuctionOverlays auction={auction} isThai={false} />
    </>
  );
}
