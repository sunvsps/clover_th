import { Router } from "express";
import { prisma } from "../lib/prisma";

export const todosRouter = Router();

todosRouter.get("/", async (_req, res) => {
  const todos = await prisma.todo.findMany({ orderBy: { createdAt: "desc" } });
  res.json(todos);
});

todosRouter.post("/", async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "title is required" });
  }
  const todo = await prisma.todo.create({ data: { title } });
  res.status(201).json(todo);
});

todosRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const { title, completed } = req.body;
  const todo = await prisma.todo.update({
    where: { id },
    data: { title, completed },
  });
  res.json(todo);
});

todosRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  await prisma.todo.delete({ where: { id } });
  res.status(204).send();
});
