import { useState } from "react";
import { defaultJobs, guildMembers, SUBTEAM_SIZE, type Attendance, type GuildMember, type Job } from "../data/guild";
import type { AttendanceBook } from "../components/WeeklySchedule";
import type { TeamAssignments } from "../components/TeamPlanner";

type Options = {
  isAuthenticated: boolean;
  isAdmin: boolean;
  userName: string;
  isThai: boolean;
  notify: (message: string) => void;
  /** keeps the admin selection in step with roster changes */
  onMemberRenamed: (oldName: string, newName: string) => void;
  onMemberRemoved: (name: string) => void;
};

/** Roster, jobs, weekly attendance and team assignments (local demo behaviour, unchanged by the WP11a extraction). */
export function useGuildState({
  isAuthenticated,
  isAdmin,
  userName,
  isThai,
  notify,
  onMemberRenamed,
  onMemberRemoved,
}: Options) {
  const [jobs, setJobs] = useState<Job[]>(defaultJobs);
  const [members, setMembers] = useState<GuildMember[]>(guildMembers);
  const [attendance, setAttendance] = useState<AttendanceBook>({});
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

  function updateAttendance(key: string, member: string, status: Attendance | null) {
    if (!isAuthenticated) {
      notify(isThai ? "กรุณาเข้าสู่ระบบด้วย Discord ก่อนลงทะเบียน" : "Sign in with Discord before registering.");
      return;
    }
    if (member !== userName && !isAdmin) return;
    setAttendance((book) => {
      const entry = { ...(book[key] ?? {}) };
      if (status) entry[member] = status;
      else delete entry[member];
      return { ...book, [key]: entry };
    });
    const who = member === userName ? (isThai ? "คุณ" : "You") : member;
    notify(
      status === "joined"
        ? isThai ? `${who} ลงทะเบียนเล่นแล้ว` : `${who} registered as playing.`
        : status === "leave"
          ? isThai ? `บันทึกการลาของ ${who} แล้ว` : `Leave saved for ${who}.`
          : isThai ? `ล้างสถานะของ ${who} แล้ว` : `Status cleared for ${who}.`,
    );
  }

  function addMember(name: string, job: number) {
    if (!isAdmin || !name) return false;
    if (members.some((member) => member.name.toLowerCase() === name.toLowerCase())) {
      notify(isThai ? `มีชื่อ ${name} อยู่แล้ว` : `${name} is already on the roster.`);
      return false;
    }
    setMembers((current) => [...current, { name, job, custom: true }]);
    notify(isThai ? `เพิ่ม ${name} เข้ากิลด์แล้ว` : `${name} added to the roster.`);
    return true;
  }

  function renameMember(oldName: string, newName: string) {
    if (!isAdmin || !newName) return false;
    if (members.some((member) => member.name.toLowerCase() === newName.toLowerCase() && member.name !== oldName)) {
      notify(isThai ? `มีชื่อ ${newName} อยู่แล้ว` : `${newName} is already on the roster.`);
      return false;
    }
    setMembers((current) => current.map((member) => (member.name === oldName ? { ...member, name: newName } : member)));
    setTeamAssignments((current) => {
      if (!(oldName in current)) return current;
      const { [oldName]: slot, ...rest } = current;
      return { ...rest, [newName]: slot };
    });
    setAttendance((book) =>
      Object.fromEntries(
        Object.entries(book).map(([key, entry]) => {
          if (!(oldName in entry)) return [key, entry];
          const { [oldName]: status, ...rest } = entry;
          return [key, { ...rest, [newName]: status }];
        }),
      ),
    );
    onMemberRenamed(oldName, newName);
    notify(isThai ? `เปลี่ยนชื่อ ${oldName} เป็น ${newName} แล้ว` : `${oldName} renamed to ${newName}.`);
    return true;
  }

  function setMemberJob(name: string, job: number) {
    if (!isAdmin) return;
    setMembers((current) => current.map((member) => (member.name === name ? { ...member, job } : member)));
    const label = jobs.find((entry) => entry.id === job)?.label ?? job;
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

  function removeMember(name: string) {
    if (!isAdmin) return;
    setMembers((current) => current.filter((member) => member.name !== name));
    removeMemberFromTeam(name);
    onMemberRemoved(name);
    notify(isThai ? `ลบ ${name} ออกจากรายชื่อแล้ว` : `${name} removed from the roster.`);
  }

  return {
    jobs,
    members,
    attendance,
    teamAssignments,
    assignMember,
    removeMemberFromTeam,
    clearTeams,
    updateAttendance,
    addMember,
    renameMember,
    setMemberJob,
    saveJobs,
    removeMember,
  };
}
