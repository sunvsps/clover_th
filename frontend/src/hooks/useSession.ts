import { useState } from "react";

type Options = { notify: (message: string) => void };

/** Sign-in state of the current visitor (still the local demo sign-in: WP11 replaces it with Discord OAuth). */
export function useSession({ notify }: Options) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userName, setUserName] = useState("");
  const [ign, setIgn] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  function signIn() {
    setIsAuthenticated(true);
    setUserName("Mew");
    setIgn("Mew");
    setIsAdmin(true);
  }

  function signOut() {
    setIsAuthenticated(false);
    setIsAdmin(false);
  }

  function switchToUser() {
    setIsAdmin(false);
    notify("Switched to User view.");
  }

  return { isAuthenticated, userName, ign, isAdmin, signIn, signOut, switchToUser };
}

export type Session = ReturnType<typeof useSession>;
