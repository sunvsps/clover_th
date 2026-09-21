import { useState } from "react";
import { SUBTEAM_SIZE, type GuildMember, type Job } from "../data/guild";
import type { TeamAssignments } from "../components/TeamPlanner";

let localId = 0; // ids of members added by the local (mock) roster editor

type Options = {
  /** roster and jobs as loaded from the API; they seed the state (the edits below are still local mock state) */
  initialMembers: GuildMember[];
  initialJobs: Job[];
  isAdmin: boolean;
  isThai: boolean;
  notify: (message: string) => void;
  /** keeps the admin selection in step with roster changes */
  onMemberRemoved: (memberId: string) => void;
};

/**
 * Roster, jobs and team assignments, all keyed by memberId. The roster and jobs START from the API
 * data; team assignments and the roster/job edits are still LOCAL mock state until WP13/WP15 replace
 * them with API calls.
 */
export function useGuildState({
  initialMembers,
  initialJobs,
  isAdmin,
  isThai,
  notify,
  onMemberRemoved,
}: Options) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [members, setMembers] = useState<GuildMember[]>(initialMembers);
  const ignOf = (id: string) => members.find((member) => member.id === id)?.ign ?? id;
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignments>({});

  function assignMember(member: string, slot: string) {
    if (teamAssignments[member] === slot) return;
    const occupants = Object.values(teamAssignments).filter((assignedSlot) => assignedSlot === slot).length;
    if (occupants >= SUBTEAM_SIZE) {
      notify(
        isThai
          ? `ทีมย่อย ${slot.replace("-", "")} เต็มแล้ว (สูงสุด ${SUBTEAM_SIZE} คน)`
          : `Subteam ${slot.replace("-", "")} is full (max ${SUBTEAM_SIZE}).`,
      );
      return;
    }
    setTeamAssignments((assignments) => ({ ...assignments, [member]: slot }));
  }

  function removeMemberFromTeam(member: string) {
    setTeamAssignments((assignments) => {
      const nextAssignments = { ...assignments };
      delete nextAssignments[member];
      return nextAssignments;
    });
  }

  function clearTeams() {
    setTeamAssignments({});
    notify(isThai ? "ล้างการจัดทีมทั้งหมดแล้ว" : "All team assignments cleared.");
  }

  function addMember(name: string, job: number) {
    if (!isAdmin || !name) return false;
    if (members.some((member) => member.ign.toLowerCase() === name.toLowerCase())) {
      notify(isThai ? `มีชื่อ ${name} อยู่แล้ว` : `${name} is already on the roster.`);
      return false;
    }
    localId += 1;
    setMembers((current) => [...current, { id: `local-${localId}`, ign: name, job, custom: true }]);
    notify(isThai ? `เพิ่ม ${name} เข้ากิลด์แล้ว` : `${name} added to the roster.`);
    return true;
  }

  function renameMember(id: string, newIgn: string) {
    if (!isAdmin || !newIgn) return false;
    const oldIgn = ignOf(id);
    if (members.some((member) => member.ign.toLowerCase() === newIgn.toLowerCase() && member.id !== id)) {
      notify(isThai ? `มีชื่อ ${newIgn} อยู่แล้ว` : `${newIgn} is already on the roster.`);
      return false;
    }
    // ids never change, so assignments need no re-keying
    setMembers((current) => current.map((member) => (member.id === id ? { ...member, ign: newIgn } : member)));
    notify(isThai ? `เปลี่ยนชื่อ ${oldIgn} เป็น ${newIgn} แล้ว` : `${oldIgn} renamed to ${newIgn}.`);
    return true;
  }

  function setMemberJob(id: string, job: number) {
    if (!isAdmin) return;
    setMembers((current) => current.map((member) => (member.id === id ? { ...member, job } : member)));
    const label = jobs.find((entry) => entry.id === job)?.label ?? job;
    const name = ignOf(id);
    notify(isThai ? `เปลี่ยนอาชีพของ ${name} เป็น ${label} แล้ว` : `${name} is now ${label}.`);
  }

  function saveJobs(next: Job[]) {
    if (!isAdmin) return false;
    const removed = jobs.filter((job) => !next.some((entry) => entry.id === job.id));
    const stillUsed = removed.find((job) => members.some((member) => member.job === job.id));
    if (stillUsed) {
      notify(isThai ? `ลบ ${stillUsed.label} ไม่ได้ ยังมีสมาชิกใช้อยู่` : `Cannot delete ${stillUsed.label}: still in use.`);
      return false;
    }
    setJobs(next);
    notify(isThai ? "บันทึกรายการอาชีพแล้ว" : "Job list saved.");
    return true;
  }

  function removeMember(id: string) {
    if (!isAdmin) return;
    const name = ignOf(id);
    setMembers((current) => current.filter((member) => member.id !== id));
    removeMemberFromTeam(id);
    onMemberRemoved(id);
    notify(isThai ? `ลบ ${name} ออกจากรายชื่อแล้ว` : `${name} removed from the roster.`);
  }

  return {
    jobs,
    members,
    teamAssignments,
    assignMember,
    removeMemberFromTeam,
    clearTeams,
    addMember,
    renameMember,
    setMemberJob,
    saveJobs,
    removeMember,
  };
}
