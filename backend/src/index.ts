import "dotenv/config";
import cors from "cors";
import express from "express";
import { todosRouter } from "./routes/todos";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/todos", todosRouter);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
