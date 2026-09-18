const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export const api = {
  getTodos: () => request<Todo[]>("/api/todos"),
  createTodo: (title: string) =>
    request<Todo>("/api/todos", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  toggleTodo: (id: string, completed: boolean) =>
    request<Todo>(`/api/todos/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ completed }),
    }),
  deleteTodo: (id: string) =>
    request<void>(`/api/todos/${id}`, { method: "DELETE" }),
};
